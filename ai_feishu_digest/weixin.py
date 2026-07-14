import json
import os
import sys

import requests

from feishu import _parse_digest_markdown


def _utf8_len(s: str) -> int:
    return len((s or "").encode("utf-8"))


def _chunk_text_utf8(s: str, max_bytes: int) -> list[str]:
    s = s or ""
    if _utf8_len(s) <= max_bytes:
        return [s]

    chunks: list[str] = []
    cur: list[str] = []
    cur_bytes = 0

    for line in s.splitlines(keepends=True):
        line_bytes = _utf8_len(line)

        if line_bytes > max_bytes:
            buf = line.encode("utf-8")
            i = 0
            while i < len(buf):
                part = buf[i : i + max_bytes].decode("utf-8", errors="ignore")
                if cur_bytes + _utf8_len(part) > max_bytes and cur:
                    chunks.append("".join(cur))
                    cur = []
                    cur_bytes = 0
                cur.append(part)
                cur_bytes += _utf8_len(part)
                if cur_bytes >= max_bytes:
                    chunks.append("".join(cur))
                    cur = []
                    cur_bytes = 0
                i += max_bytes
            continue

        if cur and (cur_bytes + line_bytes > max_bytes):
            chunks.append("".join(cur))
            cur = []
            cur_bytes = 0
        cur.append(line)
        cur_bytes += line_bytes

    if cur:
        chunks.append("".join(cur))
    return chunks


def _post_weixin_payload(webhook_url: str, payload: dict) -> None:
    r = requests.post(webhook_url, data=json.dumps(payload), headers={"Content-Type": "application/json"}, timeout=30)
    r.raise_for_status()

    try:
        resp = r.json()
    except Exception:
        resp = None
    if isinstance(resp, dict) and resp.get("errcode") not in (None, 0):
        sys.stderr.write(f"Weixin webhook errcode={resp.get('errcode')} errmsg={resp.get('errmsg')}\n")
        raise RuntimeError("Weixin webhook send failed")


def send_weixin_markdown(webhook_url: str, markdown: str) -> None:
    debug = os.environ.get("PUSH_DEBUG", "").strip() in ("1", "true", "TRUE", "yes", "YES")
    chunks = _chunk_text_utf8(markdown, max_bytes=3200)
    for idx, chunk in enumerate(chunks, start=1):
        payload = {"msgtype": "markdown", "markdown": {"content": chunk}}
        _post_weixin_payload(webhook_url, payload)
        if debug:
            sys.stderr.write(f"Weixin webhook ok chunk {idx}/{len(chunks)}\n")


def _shorten(s: str, max_chars: int) -> str:
    s = " ".join((s or "").split())
    if len(s) <= max_chars:
        return s
    return s[: max_chars - 3].rstrip() + "..."


def _chunk_list(items: list, size: int) -> list[list]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def send_weixin_news(webhook_url: str, markdown: str) -> None:
    title, _, items = _parse_digest_markdown(markdown)
    articles = []
    for item in items[:10]:
        if not item.url:
            continue
        article_title = _shorten(item.title, 64)
        description_parts = []
        if item.summary:
            description_parts.append(_shorten(item.summary, 90))
        if item.source:
            description_parts.append(_shorten(item.source, 36))
        articles.append(
            {
                "title": article_title,
                "description": "\n".join(description_parts),
                "url": item.url,
                "picurl": "",
            }
        )

    if not articles:
        send_weixin_markdown(webhook_url=webhook_url, markdown=markdown)
        return

    debug = os.environ.get("PUSH_DEBUG", "").strip() in ("1", "true", "TRUE", "yes", "YES")
    sent_any = False
    try:
        for idx, group in enumerate(_chunk_list(articles, 8), start=1):
            if len(group) == 1 and title:
                group[0]["description"] = f"{title}\n{group[0].get('description', '')}".strip()
            payload = {"msgtype": "news", "news": {"articles": group}}
            _post_weixin_payload(webhook_url, payload)
            sent_any = True
            if debug:
                sys.stderr.write(f"Weixin news webhook ok chunk {idx}\n")
    except Exception:
        if sent_any:
            raise
        send_weixin_markdown(webhook_url=webhook_url, markdown=markdown)


def send_weixin_digest(webhook_url: str, markdown: str) -> None:
    message_format = os.environ.get("WEIXIN_MESSAGE_FORMAT", "news").strip().lower()
    if message_format in ("markdown", "md"):
        send_weixin_markdown(webhook_url=webhook_url, markdown=markdown)
    else:
        send_weixin_news(webhook_url=webhook_url, markdown=markdown)
