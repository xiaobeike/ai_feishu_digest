import json
import os
from typing import Any, Dict, List, Optional

import requests


def _env_first(*keys: str) -> str:
    for k in keys:
        v = os.environ.get(k, "")
        if v and v.strip():
            return v.strip()
    return ""


def llm_enabled() -> bool:
    base_url = _env_first("LLM_BASE_URL", "OPENAI_BASE_URL")
    api_key = _env_first("LLM_API_KEY", "OPENAI_API_KEY")
    model = _env_first("LLM_MODEL", "OPENAI_MODEL")
    return bool((base_url or api_key) and model)


def _chat_completions_url(base_url: str) -> str:
    base_url = base_url.rstrip("/")
    if base_url.endswith("/v1"):
        return f"{base_url}/chat/completions"
    return f"{base_url}/v1/chat/completions"


def zh_title_and_summary(
    *,
    items: List[Dict[str, Any]],
    timeout_s: int = 60,
) -> Dict[int, Dict[str, str]]:
    """Return mapping: idx -> {title_zh, summary_zh}."""

    base_url = _env_first("LLM_BASE_URL", "OPENAI_BASE_URL") or "https://api.openai.com"
    api_key = _env_first("LLM_API_KEY", "OPENAI_API_KEY")
    model = _env_first("LLM_MODEL", "OPENAI_MODEL")
    if not model:
        return {}

    req_items = []
    for it in items:
        try:
            idx = int(str(it.get("idx", "0")))
        except Exception:
            idx = 0
        req_items.append(
            {
                "idx": idx,
                "source": it.get("source", ""),
                "title": it.get("title", ""),
                "summary": it.get("summary", ""),
            }
        )

    system = (
        "You are a bilingual editor. Translate titles into Simplified Chinese and write a short Chinese overview. "
        "Keep it factual and neutral."
    )
    user = (
        "For each item, produce JSON array with objects: "
        "{idx:int, title_zh:string, summary_zh:string}. "
        "Rules: title_zh <= 30 Chinese characters, no quotes; summary_zh is ONE sentence <= 45 Chinese characters; "
        "do not include URLs; do not add extra fields; return ONLY valid JSON.\n\n"
        f"Items:\n{json.dumps(req_items, ensure_ascii=True)}"
    )

    payload: Dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": 0.2,
    }

    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    url = _chat_completions_url(base_url)
    r = requests.post(url, headers=headers, data=json.dumps(payload), timeout=timeout_s)
    r.raise_for_status()
    data = r.json()

    content: Optional[str] = None
    try:
        content = data["choices"][0]["message"]["content"]
    except Exception:
        content = None
    if not content:
        return {}

    try:
        arr = json.loads(content)
    except Exception:
        return {}

    out: Dict[int, Dict[str, str]] = {}
    if not isinstance(arr, list):
        return out

    for obj in arr:
        if not isinstance(obj, dict):
            continue
        try:
            idx = int(str(obj.get("idx", "0")))
        except Exception:
            continue
        title_zh = str(obj.get("title_zh", "")).strip()
        summary_zh = str(obj.get("summary_zh", "")).strip()
        if not title_zh and not summary_zh:
            continue
        out[idx] = {"title_zh": title_zh, "summary_zh": summary_zh}
    return out
