import hashlib
import os
import secrets
import sys
import time
from typing import List
from urllib.parse import urlsplit

import requests

from net import assert_public_http_url


BAIDU_TRANSLATE_URL = "https://fanyi-api.baidu.com/api/trans/vip/translate"
ALLOWED_BAIDU_HOSTS = ("fanyi-api.baidu.com",)


def _env_first(*keys: str) -> str:
    for k in keys:
        v = os.environ.get(k, "")
        if v and v.strip():
            return v.strip()
    return ""


def baidu_enabled() -> bool:
    appid = _env_first("BAIDU_FANYI_APPID", "BAIDU_TRANSLATE_APPID", "BAIDU_APPID")
    key = _env_first("BAIDU_FANYI_KEY", "BAIDU_TRANSLATE_KEY", "BAIDU_APIKEY", "BAIDU_API_KEY", "BAIDU_KEY")
    return bool(appid and key)


def _sign(appid: str, q: str, salt: str, key: str) -> str:
    raw = f"{appid}{q}{salt}{key}".encode("utf-8")
    return hashlib.md5(raw).hexdigest()


def translate_lines_zh(lines: List[str], *, timeout_s: int = 20) -> List[str]:
    """Translate a list of single-line strings to Simplified Chinese using Baidu Fanyi API."""

    if not lines:
        return []

    appid = _env_first("BAIDU_FANYI_APPID", "BAIDU_TRANSLATE_APPID", "BAIDU_APPID")
    key = _env_first("BAIDU_FANYI_KEY", "BAIDU_TRANSLATE_KEY", "BAIDU_APIKEY", "BAIDU_API_KEY", "BAIDU_KEY")
    if not appid or not key:
        return lines

    # Baidu answers with one result per non-empty line, so blank lines are left out
    # of the request and answers are mapped back by index. A partial answer is used
    # as-is instead of throwing away the whole batch.
    targets = [(index, (line or "").replace("\n", " ").strip()) for index, line in enumerate(lines)]
    targets = [(index, text) for index, text in targets if text]
    if not targets:
        return lines

    q = "\n".join(text for _, text in targets)

    salt = f"{int(time.time())}{secrets.randbelow(9000) + 1000}"
    sign = _sign(appid, q, salt, key)

    url = BAIDU_TRANSLATE_URL
    parts = urlsplit(url)
    if parts.scheme != "https" or (parts.hostname or "").lower() not in ALLOWED_BAIDU_HOSTS:
        raise RuntimeError(f"Refusing to request unexpected translate host: {parts.hostname or '(none)'}")
    assert_public_http_url(url)

    data = {
        "q": q,
        "from": "auto",
        "to": "zh",
        "appid": appid,
        "salt": salt,
        "sign": sign,
    }

    # Redirects stay off: following one would leave the allowed host.
    r = requests.post(url, data=data, timeout=timeout_s, allow_redirects=False)
    r.raise_for_status()
    payload = r.json()

    if isinstance(payload, dict) and payload.get("error_code"):
        code = str(payload.get("error_code"))
        msg = str(payload.get("error_msg", ""))
        sys.stderr.write(f"Baidu translate error_code={code} error_msg={msg}\n")
        return lines

    trans = payload.get("trans_result")
    if not isinstance(trans, list):
        sys.stderr.write("Baidu translate returned no trans_result\n")
        return lines

    out = list(lines)
    for position, obj in enumerate(trans):
        if position >= len(targets):
            break
        dst = obj.get("dst") if isinstance(obj, dict) else None
        if isinstance(dst, str) and dst.strip():
            out[targets[position][0]] = dst.strip()
    return out
