"""Smoke test for the digest pipeline.

Run it with:  .venv/bin/python ai_feishu_digest/test_smoke.py

Every webhook call is intercepted, so this never posts to Feishu or WeCom.
"""

import os
import sys
from datetime import datetime, timedelta, timezone
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import aihot  # noqa: E402
import llm  # noqa: E402
import net  # noqa: E402
import push  # noqa: E402
from feishu import _post_webhook  # noqa: E402
from weixin import _post_weixin_payload  # noqa: E402


RESULTS = []


def check(name: str, condition: bool, detail: str = "") -> None:
    RESULTS.append((name, bool(condition), detail))
    print(f"{'PASS' if condition else 'FAIL'}  {name}{f'  — {detail}' if detail else ''}")


def has_cjk(value: str) -> bool:
    return any("\u4e00" <= char <= "\u9fff" for char in str(value or ""))


def beijing_today() -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=8)).strftime("%Y-%m-%d")


def beijing_tomorrow() -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=8) + timedelta(days=1)).strftime("%Y-%m-%d")


def refuses(callable_obj, *args, **kwargs) -> bool:
    try:
        callable_obj(*args, **kwargs)
    except Exception:
        return True
    return False


# 1. The normal path uses the v1 daily report and stays Chinese.
meta, items = aihot.fetch_aihot_digest(limit=10)
check("daily: uses the curated report", meta["source"] == "aihot-daily", f"source={meta['source']}")
check("daily: 10 items", len(items) == 10, f"count={len(items)}")
check("daily: titles are Chinese", all(has_cjk(item.title) for item in items))
check("daily: urls are absolute", all(item.url.startswith("http") for item in items))

# 2. The regression that caused the all-English push: the daily report for the
#    requested date is not published yet. The digest must stay Chinese.
late_meta, late_items = aihot.fetch_aihot_digest(date_str=beijing_tomorrow(), limit=10)
check("late daily: stays on AI HOT", late_meta["source"] == "aihot-selected", f"source={late_meta['source']}")
check("late daily: titles are Chinese", all(has_cjk(item.title) for item in late_items))
check("late daily: reason recorded", "404" in late_meta["fallbackReason"], late_meta["fallbackReason"])

late_markdown = aihot.render_aihot_markdown(date_str=beijing_tomorrow(), limit=10)
check("late daily: markdown carries the note", aihot.SOURCE_NOTES["aihot-selected"] in late_markdown)

# 3. The API is down but the site is up: AI HOT's own Chinese RSS feed is used, so
#    the digest stays Chinese without depending on any translation service.
_real_request_json = aihot._request_json


def _api_down(path, **kwargs):
    if path.startswith("/api/v1/"):
        raise RuntimeError("simulated API outage")
    return _real_request_json(path, **kwargs)


aihot._request_json = _api_down
try:
    feed_meta, feed_items = aihot.fetch_aihot_digest(limit=10)
finally:
    aihot._request_json = _real_request_json

check("aihot feed: uses the Chinese feed", feed_meta["source"] == "aihot-feed", f"source={feed_meta['source']}")
check("aihot feed: titles are Chinese", all(has_cjk(item.title) for item in feed_items))
check("aihot feed: summaries are Chinese", all(has_cjk(item.summary) for item in feed_items if item.summary))
check("aihot feed: summaries drop the feed trailer", all("阅读原文" not in item.summary for item in feed_items))
check("aihot feed: source names are kept", all(item.source_name for item in feed_items))

# 3. Outbound requests refuse private and non-HTTP targets.
for url, label in (
    ("http://127.0.0.1:9/hook", "loopback"),
    ("http://10.0.0.5/hook", "private range"),
    ("http://169.254.169.254/latest/meta-data", "link-local metadata"),
    ("http://[::1]/hook", "ipv6 loopback"),
    ("file:///etc/passwd", "non-http scheme"),
):
    check(f"guard: rejects {label}", refuses(net.assert_public_http_url, url))

check("guard: allows a public host", net.assert_public_http_url("https://aihot.news/api/v1/items"))

# 4. AI HOT paths cannot escape the pinned host.
check("guard: rejects a foreign path", refuses(aihot._request_json, "//evil.example/api/v1/items"))
check("guard: rejects an absolute url path", refuses(aihot._request_json, "https://evil.example/api/v1/items"))

# 5. Webhook targets must be allowlisted https hosts, and nothing is posted on refusal.
with mock.patch("requests.post") as posted:
    check("webhook: rejects loopback", refuses(_post_webhook, "http://127.0.0.1:9/hook", {}))
    check("webhook: rejects a non-allowlisted host", refuses(_post_webhook, "https://evil.example/hook", {}))
    check("webhook: rejects plain http", refuses(_post_webhook, "http://open.feishu.cn/hook", {}))
    check("webhook: wecom rejects loopback", refuses(_post_weixin_payload, "http://127.0.0.1:9/hook", {}))
    check("webhook: nothing was posted", posted.call_count == 0, f"calls={posted.call_count}")

# 6. Dry run builds the real payloads and still posts nothing.
with mock.patch("requests.post") as posted:
    exit_code = push._dry_run(
        late_markdown,
        "AI/Tech Daily Digest",
        "https://open.feishu.cn/open-apis/bot/v2/hook/DO-NOT-SEND",
        "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=DO-NOT-SEND",
    )
    check("dry run: exits clean", exit_code == 0)
    check("dry run: nothing was posted", posted.call_count == 0, f"calls={posted.call_count}")

# 7. The LLM endpoint is operator-configurable, so it is validated before use.
llm_items = [{"idx": 1, "source": "test", "title": "Hello world", "summary": "A test item."}]
for base_url, label in (
    ("http://127.0.0.1:9/v1", "loopback"),
    ("http://10.0.0.5/v1", "private range"),
    ("http://169.254.169.254/v1", "link-local metadata"),
    ("http://api.example.com/v1", "plain http"),
):
    with mock.patch("requests.post") as posted, mock.patch.dict(
        os.environ, {"LLM_BASE_URL": base_url, "LLM_MODEL": "test-model"}, clear=False
    ):
        check(f"llm: rejects {label}", refuses(llm.zh_title_and_summary, items=llm_items))
        check(f"llm: nothing posted for {label}", posted.call_count == 0, f"calls={posted.call_count}")

with mock.patch("requests.post") as posted, mock.patch.dict(
    os.environ,
    {"LLM_BASE_URL": "http://127.0.0.1:9/v1", "LLM_MODEL": "test-model", "LLM_ALLOW_PRIVATE_HOSTS": "1"},
    clear=False,
):
    # The opt-in is what lets a local server through, so the request is attempted.
    try:
        llm.zh_title_and_summary(items=llm_items)
    except Exception:
        pass  # the mocked response is not a real completion
    check("llm: opt-in reaches a local server", posted.call_count == 1, f"calls={posted.call_count}")

print()
failed = [result for result in RESULTS if not result[1]]
print(f"{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
if failed:
    print("failed:")
    for name, _, detail in failed:
        print(f"  - {name} {detail}")
    raise SystemExit(1)
