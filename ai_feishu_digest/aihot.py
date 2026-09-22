import os
import re
import sys
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Optional
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

import requests

from net import assert_public_http_url


BJ_TZ = ZoneInfo("Asia/Shanghai")
AIHOT_BASE_URL = "https://aihot.news"
AIHOT_USER_AGENT = os.getenv(
    "AIHOT_USER_AGENT",
    "ai-feishu-digest/0.1 (+https://github.com/xiaobeike/ai_feishu_digest)",
)
SECTION_QUOTA = 2
SELECTED_POOL_LIMIT = 100
SELECTED_SOURCE_CAP = 3

# Shown in the digest when the curated daily report was not available, so a
# degraded digest is never mistaken for the normal one.
SOURCE_NOTES = {
    "aihot-daily": "",
    "aihot-selected": "今日日报尚未发布，本条为 AIHOT 精选池（最近 24 小时）",
}

PRIORITY_KEYWORDS: tuple[tuple[str, int], ...] = (
    ("具身智能", 80),
    ("具身ai", 80),
    ("具身 ai", 80),
    ("具身", 45),
    ("人形机器人", 70),
    ("机器人控制", 75),
    ("机器人任务", 70),
    ("机器人本体", 70),
    ("机械臂", 80),
    ("灵巧手", 70),
    ("视频动作", 45),
    ("动作基础模型", 55),
    ("物理智能", 50),
    ("空间智能", 45),
    ("ai 毛绒", 85),
    ("ai毛绒", 85),
    ("毛绒", 60),
    ("ai 玩具", 75),
    ("ai玩具", 75),
    ("陪伴机器人", 75),
    ("陪伴硬件", 75),
    ("语音对话", 80),
    ("实时语音", 75),
    ("语音助手", 65),
    ("语音模型", 65),
    ("对话模型", 55),
    ("大模型", 65),
    ("模型发布", 60),
    ("开源模型", 60),
    ("基础模型", 55),
    ("llm", 65),
    ("large language model", 65),
    ("gpt", 55),
    ("claude", 55),
    ("gemini", 55),
    ("qwen", 55),
    ("deepseek", 55),
    ("llama", 55),
    ("robotics", 70),
    ("robot control", 70),
    ("humanoid", 70),
    ("embodied", 80),
    ("manipulation", 50),
    ("plush", 85),
    ("ai toy", 65),
    ("companion ai", 65),
    ("voice assistant", 65),
    ("voice model", 65),
    ("speech", 45),
    ("video-action", 55),
    ("robbyant", 80),
    ("lingbot", 80),
    ("behavior", 45),
)


@dataclass(frozen=True)
class DigestItem:
    title: str
    summary: str
    url: str
    source_name: str
    permalink: str
    category: str = ""
    published_at: Optional[datetime] = None
    score: Optional[int] = None
    section_label: str = ""
    curated: bool = False
    daily_order: int = 9999


def _headers() -> dict[str, str]:
    return {"User-Agent": AIHOT_USER_AGENT, "Accept": "application/json"}


_AIHOT_PATH_RE = re.compile(r"^/api/v1/[A-Za-z0-9/_.\-]{0,200}$")
ALLOWED_AIHOT_HOSTS = ("aihot.news",)


def _request_json(path: str, *, params: Optional[dict[str, Any]] = None, timeout_s: int = 30) -> dict[str, Any]:
    # The target is built from a validated relative path plus a host from a literal
    # allowlist, so no caller can steer the request to another origin.
    if not _AIHOT_PATH_RE.match(path or ""):
        raise RuntimeError(f"Refusing to request unexpected AI HOT path: {path!r}")

    url = f"https://{ALLOWED_AIHOT_HOSTS[0]}{path}"
    parts = urlsplit(url)
    if parts.scheme != "https" or (parts.hostname or "").lower() not in ALLOWED_AIHOT_HOSTS:
        raise RuntimeError(f"Refusing to request unexpected AI HOT url: {url}")
    assert_public_http_url(url)

    # Redirects stay off: following one would leave the allowed host.
    r = requests.get(url, params=params, headers=_headers(), timeout=timeout_s, allow_redirects=False)
    if not 200 <= r.status_code < 300:
        raise RuntimeError(f"AI HOT {path} failed: HTTP {r.status_code}{_problem_detail(r)}")
    data = r.json()
    if not isinstance(data, dict):
        raise RuntimeError(f"AI HOT returned non-object JSON for {path}")
    return data


def _problem_detail(response: requests.Response) -> str:
    try:
        payload = response.json()
    except Exception:
        return ""
    if not isinstance(payload, dict):
        return ""
    detail = str(payload.get("detail") or payload.get("title") or payload.get("code") or "").strip()
    return f" ({detail})" if detail else ""


def _parse_dt(s: Any) -> Optional[datetime]:
    if not isinstance(s, str) or not s.strip():
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def _shorten(s: str, max_chars: int) -> str:
    s = re.sub(r"\s+", " ", (s or "")).strip()
    if len(s) <= max_chars:
        return s
    return s[: max_chars - 3].rstrip() + "..."


def _item_key(it: DigestItem) -> str:
    return (it.permalink or it.url or it.title).strip().lower()


def _read_url(it: DigestItem) -> str:
    return (it.url or it.permalink or "").strip()


def _normalized_title(title: str) -> str:
    s = (title or "").lower()
    replacements = (
        (r"apple\s+intelligence", "苹果智能"),
        (r"apple\s*ai", "苹果智能"),
        (r"apple\s*智能", "苹果智能"),
        (r"苹果\s*ai", "苹果智能"),
        (r"qwen", "千问"),
        (r"通义千问", "千问"),
        (r"deepseek", "深度求索"),
        (r"chatgpt", "gpt"),
    )
    for pattern, repl in replacements:
        s = re.sub(pattern, repl, s)
    return re.sub(r"[^0-9a-zA-Z\u4e00-\u9fff]+", "", s)


def _topic_tokens(title: str) -> set[str]:
    normalized = _normalized_title(title)
    tokens: set[str] = set()
    aliases = {
        "苹果智能": ("苹果智能", "苹果"),
        "千问": ("千问",),
        "阿里": ("阿里",),
        "grok": ("grok",),
        "openai": ("openai",),
        "anthropic": ("anthropic",),
        "claude": ("claude",),
        "gemini": ("gemini",),
        "深度求索": ("深度求索",),
        "机器人": ("机器人", "机械臂", "具身"),
        "语音": ("语音", "audio", "speech"),
        "多模态": ("多模态", "multimodal"),
    }
    for token, variants in aliases.items():
        if any(variant in normalized for variant in variants):
            tokens.add(token)
    return tokens


def _bigrams(s: str) -> set[str]:
    if len(s) < 2:
        return {s} if s else set()
    return {s[i : i + 2] for i in range(len(s) - 1)}


def _looks_like_same_story(a: DigestItem, b: DigestItem) -> bool:
    if _item_key(a) == _item_key(b):
        return True
    ta = _normalized_title(a.title)
    tb = _normalized_title(b.title)
    if not ta or not tb:
        return False
    if min(len(ta), len(tb)) >= 12 and (ta in tb or tb in ta):
        return True
    shared_topics = _topic_tokens(a.title) & _topic_tokens(b.title)
    if "苹果智能" in shared_topics and len(shared_topics) >= 2:
        return True
    aa = _bigrams(ta)
    bb = _bigrams(tb)
    if not aa or not bb:
        return False
    overlap = len(aa & bb) / len(aa | bb)
    return overlap >= 0.42


def _priority_score(it: DigestItem) -> int:
    text = f"{it.title}\n{it.summary}\n{it.source_name}\n{it.category}\n{it.section_label}".lower()
    score = 0
    for keyword, weight in PRIORITY_KEYWORDS:
        if keyword.lower() in text:
            score += weight
    return score


def _has_strong_priority_signal(it: DigestItem) -> bool:
    text = f"{it.title}\n{it.summary}\n{it.source_name}\n{it.category}\n{it.section_label}".lower()
    strong_terms = (
        "具身",
        "机械臂",
        "灵巧手",
        "毛绒",
        "陪伴硬件",
        "陪伴机器人",
        "语音对话",
        "实时语音",
        "语音助手",
        "视频动作",
        "动作基础模型",
        "机器人控制",
        "机器人任务",
        "机器人本体",
        "robotics",
        "robot control",
        "humanoid",
        "embodied",
        "manipulation",
        "robbyant",
        "lingbot",
        "ai toy",
        "companion ai",
    )
    if any(term in text for term in strong_terms):
        return True

    large_model_terms = (
        "大模型",
        "前沿模型",
        "模型发布",
        "开源模型",
        "基础模型",
        "llm",
        "large language model",
    )
    is_model_channel = it.category == "ai-models" or it.section_label == "模型发布/更新"
    title = it.title.lower()
    return is_model_channel or any(term in title for term in large_model_terms)


def _is_priority(it: DigestItem) -> bool:
    return _priority_score(it) >= 60 and (it.curated or _has_strong_priority_signal(it))


def _links_of(obj: dict[str, Any]) -> tuple[str, str]:
    links = obj.get("links")
    if not isinstance(links, dict):
        return "", ""
    return str(links.get("original") or "").strip(), str(links.get("aihot") or "").strip()


def _source_name_of(obj: dict[str, Any]) -> str:
    source = obj.get("source")
    if not isinstance(source, dict):
        return ""
    return str(source.get("name") or "").strip()


def _daily_item(obj: dict[str, Any], section_label: str, daily_order: int) -> DigestItem:
    original, aihot = _links_of(obj)
    return DigestItem(
        title=str(obj.get("title") or "").strip(),
        summary=str(obj.get("summary") or "").strip(),
        url=original or aihot,
        source_name=_source_name_of(obj),
        permalink=aihot or original,
        section_label=section_label,
        curated=True,
        daily_order=daily_order,
    )


def _selected_item(obj: dict[str, Any]) -> DigestItem:
    original, aihot = _links_of(obj)
    score = obj.get("score")
    return DigestItem(
        title=str(obj.get("title") or "").strip(),
        summary=str(obj.get("summary") or "").strip(),
        url=original or aihot,
        source_name=_source_name_of(obj),
        permalink=aihot or original,
        category=str(obj.get("category") or "").strip(),
        published_at=_parse_dt(obj.get("publishedAt")),
        score=int(score) if isinstance(score, (int, float)) else None,
        curated=bool(obj.get("selected")),
    )


def _merge_items(old: DigestItem, new: DigestItem) -> DigestItem:
    daily_order = min(old.daily_order, new.daily_order)
    return DigestItem(
        title=new.title or old.title,
        summary=new.summary or old.summary,
        url=new.url or old.url,
        source_name=new.source_name or old.source_name,
        permalink=new.permalink or old.permalink,
        category=new.category or old.category,
        published_at=new.published_at or old.published_at,
        score=new.score if new.score is not None else old.score,
        section_label=old.section_label or new.section_label,
        curated=old.curated or new.curated,
        daily_order=daily_order,
    )


def _append_unique(out: list[DigestItem], seen: set[str], it: DigestItem, limit: int) -> bool:
    key = _item_key(it)
    if key in seen or any(_looks_like_same_story(it, old) for old in out):
        return False
    seen.add(key)
    out.append(it)
    return len(out) >= limit


def _select_section_balanced(
    section_buckets: list[list[DigestItem]],
    public_fillers: list[DigestItem],
    limit: int,
) -> list[DigestItem]:
    ranked: list[DigestItem] = []
    seen: set[str] = set()

    for bucket in section_buckets:
        picked = 0
        for it in bucket:
            before = len(ranked)
            if _append_unique(ranked, seen, it, limit):
                return ranked
            if len(ranked) > before:
                picked += 1
            if picked >= SECTION_QUOTA:
                break

    while len(ranked) < limit:
        progressed = False
        for bucket in section_buckets:
            before = len(ranked)
            for it in bucket:
                if _append_unique(ranked, seen, it, limit):
                    return ranked
                if len(ranked) > before:
                    progressed = True
                    break
        if not progressed:
            break

    public_ranked = sorted(
        public_fillers,
        key=lambda it: (
            it.score or 0,
            it.published_at or datetime.min.replace(tzinfo=BJ_TZ),
        ),
        reverse=True,
    )
    for it in public_ranked:
        if _append_unique(ranked, seen, it, limit):
            return ranked
    return ranked


def _priority_sort_key(it: DigestItem) -> tuple[int, int, datetime]:
    return (_priority_score(it), it.score or 0, it.published_at or datetime.min.replace(tzinfo=BJ_TZ))


def _public_sort_key(it: DigestItem) -> tuple[int, datetime]:
    return (it.score or 0, it.published_at or datetime.min.replace(tzinfo=BJ_TZ))


def _rank_selected_pool(items: list[DigestItem], limit: int) -> list[DigestItem]:
    deduped: dict[str, DigestItem] = {}
    for it in items:
        key = _item_key(it)
        old = deduped.get(key)
        deduped[key] = it if old is None else _merge_items(old, it)

    values = list(deduped.values())
    priority = sorted((it for it in values if _is_priority(it)), key=_priority_sort_key, reverse=True)
    rest = sorted((it for it in values if not _is_priority(it)), key=_public_sort_key, reverse=True)
    ordered = [*priority, *rest]

    chosen: list[DigestItem] = []
    counts: dict[str, int] = {}

    def add(it: DigestItem) -> None:
        if any(_looks_like_same_story(it, old) for old in chosen):
            return
        if counts.get(it.source_name, 0) >= SELECTED_SOURCE_CAP:
            return
        counts[it.source_name] = counts.get(it.source_name, 0) + 1
        chosen.append(it)

    for it in ordered:
        add(it)
        if len(chosen) >= limit:
            return chosen

    # A per-source cap can starve the result on a narrow news day; fill the rest.
    for it in ordered:
        if len(chosen) >= limit:
            break
        if any(_looks_like_same_story(it, old) for old in chosen):
            continue
        chosen.append(it)
    return chosen


def _fetch_report(date_str: Optional[str]) -> dict[str, Any]:
    path = f"/api/v1/dailies/{date_str}" if date_str else "/api/v1/dailies/latest"
    payload = _request_json(path)
    report = payload.get("report")
    if not isinstance(report, dict):
        raise RuntimeError(f"AI HOT {path} returned no report")
    return report


def _report_buckets(report: dict[str, Any]) -> list[list[DigestItem]]:
    section_buckets: list[list[DigestItem]] = []
    daily_order = 0
    for section in report.get("sections") or []:
        if not isinstance(section, dict):
            continue
        label = str(section.get("label") or "").strip()
        bucket: list[DigestItem] = []
        for obj in section.get("items") or []:
            if isinstance(obj, dict):
                it = _daily_item(obj, label, daily_order)
                daily_order += 1
                if it.title and (it.url or it.permalink):
                    bucket.append(it)
        section_buckets.append(bucket)
    return section_buckets


def _fetch_pool(mode: str, limit: int = SELECTED_POOL_LIMIT) -> list[DigestItem]:
    payload = _request_json(
        "/api/v1/items",
        params={"mode": mode, "window": "24h", "limit": limit},
    )
    out: list[DigestItem] = []
    for obj in payload.get("items") or []:
        if not isinstance(obj, dict):
            continue
        it = _selected_item(obj)
        if it.title and (it.url or it.permalink):
            out.append(it)
    return out


def _try_daily(
    date_str: Optional[str], limit: int, reasons: list[str]
) -> Optional[tuple[dict[str, Any], list[DigestItem]]]:
    label = date_str or "latest"
    try:
        report = _fetch_report(date_str)
        buckets = _report_buckets(report)
        items = _select_section_balanced(buckets, [], limit)
        if len(items) < limit:
            # Top up a thin report from the wider 24h pool instead of sending fewer items.
            try:
                items = _select_section_balanced(buckets, _fetch_pool("all"), limit)
            except Exception as exc:
                reasons.append(f"AI HOT pool fill failed: {exc}")
        if not items:
            reasons.append(f"AI HOT daily {label} has no usable items")
            return None
        date_show = str(report.get("date") or date_str or "")
        return {"date": date_show, "source": "aihot-daily"}, items
    except Exception as exc:
        reasons.append(f"AI HOT daily {label} failed: {exc}")
        return None


def fetch_aihot_digest(*, date_str: Optional[str] = None, limit: int = 10) -> tuple[dict[str, Any], list[DigestItem]]:
    """Fetch the digest, degrading to Chinese sources before giving up.

    The curated daily report is the intended source, but AI HOT publishes it around
    08:00 Beijing and it can run late. Every step below stays Chinese, so a late
    publish degrades the digest instead of turning it English.
    """

    if os.getenv("AIHOT_FORCE_FAIL", "").strip().lower() in ("1", "true", "yes"):
        raise RuntimeError("AIHOT_FORCE_FAIL is set")

    requested_date = date_str or datetime.now(BJ_TZ).strftime("%Y-%m-%d")
    reasons: list[str] = []

    result = _try_daily(requested_date, limit, reasons)
    if result is None:
        # The report may have landed while the first request was in flight.
        latest = _try_daily(None, limit, reasons)
        if latest is not None and latest[0].get("date") == requested_date:
            result = latest

    if result is None:
        try:
            items = _rank_selected_pool(_fetch_pool("selected"), limit)
            if items:
                result = ({"date": requested_date, "source": "aihot-selected"}, items)
            else:
                reasons.append("AI HOT selected pool has no usable items")
        except Exception as exc:
            reasons.append(f"AI HOT selected pool failed: {exc}")

    if result is None:
        raise RuntimeError("AI HOT unavailable: " + "; ".join(reasons))

    meta, items = result
    meta["fallbackReason"] = "; ".join(reasons)
    return meta, items


def render_aihot_markdown(*, date_str: Optional[str] = None, limit: int = 10) -> str:
    meta, items = fetch_aihot_digest(date_str=date_str, limit=limit)
    date_show = str(meta.get("date") or date_str or datetime.now(BJ_TZ).strftime("%Y-%m-%d"))
    note = SOURCE_NOTES.get(str(meta.get("source") or ""), "")
    if meta.get("fallbackReason"):
        sys.stderr.write(f"AI HOT source={meta.get('source')}: {meta['fallbackReason']}\n")

    lines = [f"# 智能前沿日报（{date_show}）", ""]
    if not items:
        lines.append("No items found in the daily window.")
        lines.append("")
        return "\n".join(lines)

    for i, it in enumerate(items, start=1):
        lines.append(f"{i}. {_shorten(it.title, 90)}")
        if it.summary:
            lines.append(f"- {_shorten(it.summary, 110)}")
        meta_line = []
        if it.source_name:
            meta_line.append(it.source_name)
        if it.section_label:
            meta_line.append(it.section_label)
        elif it.category:
            meta_line.append(it.category)
        if it.score is not None:
            meta_line.append(f"score {it.score}")
        if meta_line:
            lines.append(f"- 来源：{' · '.join(meta_line)}")
        read_url = _read_url(it)
        lines.append(f"- [阅读全文]({read_url})")
    if note:
        lines.append("")
        lines.append(f"> {note}")
    lines.append("")
    return "\n".join(lines)
