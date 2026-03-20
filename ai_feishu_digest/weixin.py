import json
import os
import sys

import requests


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


def send_weixin_markdown(webhook_url: str, markdown: str) -> None:
    debug = os.environ.get("PUSH_DEBUG", "").strip() in ("1", "true", "TRUE", "yes", "YES")
    chunks = _chunk_text_utf8(markdown, max_bytes=3200)
    for idx, chunk in enumerate(chunks, start=1):
        payload = {"msgtype": "markdown", "markdown": {"content": chunk}}
        r = requests.post(webhook_url, data=json.dumps(payload), headers={"Content-Type": "application/json"}, timeout=30)
        r.raise_for_status()

        try:
            resp = r.json()
        except Exception:
            resp = None
        if isinstance(resp, dict) and resp.get("errcode") not in (None, 0):
            sys.stderr.write(f"Weixin webhook errcode={resp.get('errcode')} errmsg={resp.get('errmsg')}\n")
            raise RuntimeError("Weixin webhook send failed")
        if debug:
            sys.stderr.write(f"Weixin webhook ok chunk {idx}/{len(chunks)}\n")
