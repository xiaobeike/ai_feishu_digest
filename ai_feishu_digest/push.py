import argparse
import os
from pathlib import Path

from feishu import send_feishu_post
from weixin import send_weixin_markdown


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--markdown-file", required=True)
    ap.add_argument("--title", default="AI/Tech Daily Digest")
    args = ap.parse_args()

    md = Path(args.markdown_file).read_text(encoding="utf-8")

    feishu_webhook = os.environ.get("FEISHU_WEBHOOK_URL", "").strip()
    weixin_webhook = os.environ.get("WEIXIN_WEBHOOK", "").strip()

    sent = 0

    if feishu_webhook:
        send_feishu_post(webhook_url=feishu_webhook, title=args.title, markdown=md)
        sent += 1

    if weixin_webhook:
        send_weixin_markdown(webhook_url=weixin_webhook, markdown=md)
        sent += 1

    if sent == 0:
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
