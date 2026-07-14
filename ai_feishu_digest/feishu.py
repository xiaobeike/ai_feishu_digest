import base64
import hashlib
import hmac
import json
import os
import re
import time
from dataclasses import dataclass

import requests


@dataclass
class DigestCardItem:
    title: str
    summary: str = ""
    source: str = ""
    url: str = ""


def _shorten(s: str, max_chars: int) -> str:
    s = re.sub(r"\s+", " ", (s or "")).strip()
    if len(s) <= max_chars:
        return s
    return s[: max_chars - 3].rstrip() + "..."


def _escape_lark_md(s: str) -> str:
    s = s or ""
    for ch in ("\\", "*", "_", "~", "`"):
        s = s.replace(ch, f"\\{ch}")
    return s


def _split_markdown_to_post_lines(md: str) -> list[list[dict]]:
    rows: list[list[dict]] = []
    for raw in (md or "").splitlines():
        line = raw.rstrip("\n")
        if not line.strip():
            rows.append([{"tag": "text", "text": " "}])
            continue
        rows.append([{"tag": "text", "text": line}])
    return rows


def _parse_digest_markdown(md: str) -> tuple[str, str, list[DigestCardItem]]:
    card_title = ""
    subtitle = ""
    items: list[DigestCardItem] = []
    current: DigestCardItem | None = None

    link_re = re.compile(r"^\s*-\s*\[(?:阅读全文|全文)\]\(([^)]+)\)\s*$")
    item_re = re.compile(r"^\s*\d+\.\s+(.+?)\s*$")

    for raw in (md or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("#") and not card_title:
            card_title = line.lstrip("#").strip()
            continue
        if line.startswith(">") and not subtitle:
            subtitle = line.lstrip(">").strip()
            continue

        m = item_re.match(line)
        if m:
            if current:
                items.append(current)
            current = DigestCardItem(title=m.group(1).strip())
            continue

        if not current:
            continue

        m = link_re.match(line)
        if m:
            current.url = m.group(1).strip()
            continue

        if line.startswith("- 来源："):
            current.source = line.removeprefix("- 来源：").strip()
            continue

        if line.startswith("- ") and not current.summary:
            current.summary = line[2:].strip()

    if current:
        items.append(current)

    return card_title or "AI/Tech Daily Digest", subtitle, items[:10]


def _feishu_sign(payload: dict) -> None:
    signing_secret = os.environ.get("FEISHU_SIGNING_SECRET", "").strip()
    if signing_secret:
        ts = str(int(time.time()))
        string_to_sign = f"{ts}\n{signing_secret}".encode("utf-8")
        hmac_code = hmac.new(string_to_sign, digestmod=hashlib.sha256).digest()
        payload["timestamp"] = ts
        payload["sign"] = base64.b64encode(hmac_code).decode("utf-8")


def _post_payload(title: str, markdown: str) -> dict:
    return {
        "msg_type": "post",
        "content": {
            "post": {
                "zh_cn": {
                    "title": title,
                    "content": _split_markdown_to_post_lines(markdown),
                }
            }
        },
    }


def _card_payload(title: str, markdown: str) -> dict:
    parsed_title, subtitle, items = _parse_digest_markdown(markdown)
    card_title = parsed_title or title

    elements: list[dict] = []
    if subtitle:
        elements.append(
            {
                "tag": "div",
                "text": {
                    "tag": "lark_md",
                    "content": _escape_lark_md(subtitle),
                },
            }
        )
        elements.append({"tag": "hr"})

    for idx, item in enumerate(items, start=1):
        title_line = f"**{idx}. {_escape_lark_md(_shorten(item.title, 80))}**"
        meta = _escape_lark_md(_shorten(item.source, 70)) if item.source else ""
        summary = _escape_lark_md(_shorten(item.summary, 110)) if item.summary else ""
        content_parts = [title_line]
        if summary:
            content_parts.append(summary)
        if meta:
            content_parts.append(f"<font color='grey'>{meta}</font>")

        elements.append(
            {
                "tag": "div",
                "text": {
                    "tag": "lark_md",
                    "content": "\n".join(content_parts),
                },
            }
        )
        if item.url:
            elements.append(
                {
                    "tag": "action",
                    "actions": [
                        {
                            "tag": "button",
                            "text": {"tag": "plain_text", "content": "阅读全文"},
                            "type": "primary" if idx <= 3 else "default",
                            "url": item.url,
                        }
                    ],
                }
            )
        if idx != len(items):
            elements.append({"tag": "hr"})

    if not items:
        elements.append(
            {
                "tag": "div",
                "text": {"tag": "lark_md", "content": _escape_lark_md(markdown[:3000])},
            }
        )

    return {
        "msg_type": "interactive",
        "card": {
            "config": {"wide_screen_mode": True},
            "header": {
                "template": "blue",
                "title": {"tag": "plain_text", "content": card_title},
            },
            "elements": elements,
        },
    }


def _post_webhook(webhook_url: str, payload: dict) -> None:
    _feishu_sign(payload)
    r = requests.post(webhook_url, data=json.dumps(payload), headers={"Content-Type": "application/json"}, timeout=30)
    r.raise_for_status()
    try:
        resp = r.json()
    except Exception:
        resp = None
    if isinstance(resp, dict):
        code = resp.get("code", resp.get("StatusCode", 0))
        if code not in (None, 0):
            raise RuntimeError(f"Feishu webhook send failed: {resp}")


def send_feishu_post(webhook_url: str, title: str, markdown: str) -> None:
    message_format = os.getenv("FEISHU_MESSAGE_FORMAT", "card").strip().lower()
    if message_format in ("post", "rich_text", "richtext"):
        payload = _post_payload(title, markdown)
    else:
        payload = _card_payload(title, markdown)
    _post_webhook(webhook_url, payload)
