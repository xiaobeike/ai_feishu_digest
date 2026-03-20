import hashlib
import os
import random
import sys
import time
from typing import List

import requests


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

    safe_lines = [(s or "").replace("\n", " ").strip() for s in lines]
    q = "\n".join(safe_lines)

    salt = str(int(time.time())) + str(random.randint(1000, 9999))
    sign = _sign(appid, q, salt, key)

    url = "https://fanyi-api.baidu.com/api/trans/vip/translate"
    data = {
        "q": q,
        "from": "auto",
        "to": "zh",
        "appid": appid,
        "salt": salt,
        "sign": sign,
    }

    r = requests.post(url, data=data, timeout=timeout_s)
    r.raise_for_status()
    payload = r.json()

    if isinstance(payload, dict) and payload.get("error_code"):
        code = str(payload.get("error_code"))
        msg = str(payload.get("error_msg", ""))
        sys.stderr.write(f"Baidu translate error_code={code} error_msg={msg}\n")
        return lines

    trans = payload.get("trans_result")
    if not isinstance(trans, list):
        return lines

    out: List[str] = []
    for obj in trans:
        if isinstance(obj, dict) and isinstance(obj.get("dst"), str):
            out.append(obj["dst"].strip())

    if len(out) != len(lines):
        return lines
    return out
