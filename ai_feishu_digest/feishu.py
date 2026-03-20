import base64
import hashlib
import hmac
import json
import os
import time

import requests


def _split_markdown_to_post_lines(md: str) -> list[list[dict]]:
    rows: list[list[dict]] = []
    for raw in (md or "").splitlines():
        line = raw.rstrip("\n")
        if not line.strip():
            rows.append([{"tag": "text", "text": " "}])
            continue
        rows.append([{"tag": "text", "text": line}])
    return rows


def send_feishu_post(webhook_url: str, title: str, markdown: str) -> None:
    payload = {
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

    signing_secret = os.environ.get("FEISHU_SIGNING_SECRET", "").strip()
    if signing_secret:
        ts = str(int(time.time()))
        string_to_sign = f"{ts}\n{signing_secret}".encode("utf-8")
        hmac_code = hmac.new(signing_secret.encode("utf-8"), string_to_sign, digestmod=hashlib.sha256).digest()
        payload["timestamp"] = ts
        payload["sign"] = base64.b64encode(hmac_code).decode("utf-8")

    r = requests.post(webhook_url, data=json.dumps(payload), headers={"Content-Type": "application/json"}, timeout=30)
    r.raise_for_status()
