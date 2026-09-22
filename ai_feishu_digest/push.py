import argparse
import os
from pathlib import Path

from feishu import build_feishu_payload, send_feishu_post
from weixin import build_weixin_news_payloads, send_weixin_digest


def _dry_run(markdown: str, title: str, feishu_webhook: str, weixin_webhook: str) -> int:
    """Build every message and print a summary without calling any webhook."""

    print("dry run: no webhook will be called")
    if not feishu_webhook and not weixin_webhook:
        print("neither FEISHU_WEBHOOK_URL nor WEIXIN_WEBHOOK is set; nothing would be sent")

    if feishu_webhook:
        payload = build_feishu_payload(title, markdown)
        elements = payload.get("card", {}).get("elements", [])
        print(f"\n[feishu] would post to {feishu_webhook}")
        print(f"[feishu] msg_type={payload.get('msg_type')} elements={len(elements)}")
        for element in elements:
            if element.get("tag") == "div":
                print("  | " + element["text"]["content"].replace("\n", "\n  | "))

    if weixin_webhook:
        payloads = build_weixin_news_payloads(markdown)
        print(f"\n[weixin] would post to {weixin_webhook}")
        print(f"[weixin] chunks={len(payloads)}")
        for payload in payloads:
            for article in payload["news"]["articles"]:
                print(f"  - {article['title']}")

    print("\ndry run complete")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--markdown-file", required=True)
    ap.add_argument("--title", default="AI/Tech Daily Digest")
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="Build the messages and print them instead of posting to any webhook.",
    )
    args = ap.parse_args()

    md = Path(args.markdown_file).read_text(encoding="utf-8")

    feishu_webhook = os.environ.get("FEISHU_WEBHOOK_URL", "").strip()
    weixin_webhook = os.environ.get("WEIXIN_WEBHOOK", "").strip()

    if args.dry_run:
        return _dry_run(md, args.title, feishu_webhook, weixin_webhook)

    sent = 0

    if feishu_webhook:
        send_feishu_post(webhook_url=feishu_webhook, title=args.title, markdown=md)
        sent += 1

    if weixin_webhook:
        send_weixin_digest(webhook_url=weixin_webhook, markdown=md)
        sent += 1

    if sent == 0:
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
