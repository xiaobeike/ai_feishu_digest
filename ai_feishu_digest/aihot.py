import os
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Optional
from urllib.parse import urljoin
from zoneinfo import ZoneInfo

import requests


BJ_TZ = ZoneInfo("Asia/Shanghai")
AIHOT_BASE_URL = "https://aihot.virxact.com"
AIHOT_USER_AGENT = os.getenv(
    "AIHOT_USER_AGENT",
    "ai-feishu-digest/0.1 (+https://github.com/xiaobeike/ai_feishu_digest)",
)
SECTION_QUOTA = 2

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


def _request_json(path: str, *, params: Optional[dict[str, Any]] = None, timeout_s: int = 30) -> dict[str, Any]:
    url = urljoin(AIHOT_BASE_URL, path)
    r = requests.get(url, params=params, headers=_headers(), timeout=timeout_s)
    r.raise_for_status()
    data = r.json()
    if not isinstance(data, dict):
        raise RuntimeError(f"AI HOT returned non-object JSON for {path}")
    return data


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


def _daily_item(obj: dict[str, Any], section_label: str, daily_order: int) -> DigestItem:
    source_url = str(obj.get("sourceUrl") or "").strip()
    permalink = str(obj.get("permalink") or "").strip()
    return DigestItem(
        title=str(obj.get("title") or "").strip(),
        summary=str(obj.get("summary") or "").strip(),
        url=source_url,
        source_name=str(obj.get("sourceName") or "").strip(),
        permalink=permalink or source_url,
        section_label=section_label,
        curated=True,
        daily_order=daily_order,
    )


def _public_item(obj: dict[str, Any]) -> DigestItem:
    url = str(obj.get("url") or "").strip()
    permalink = str(obj.get("permalink") or "").strip()
    score = obj.get("score")
    return DigestItem(
        title=str(obj.get("title") or "").strip(),
        summary=str(obj.get("summary") or "").strip(),
        url=url,
        source_name=str(obj.get("source") or "").strip(),
        permalink=permalink or url,
        category=str(obj.get("category") or "").strip(),
        published_at=_parse_dt(obj.get("publishedAt")),
        score=score if isinstance(score, int) else None,
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


def fetch_aihot_digest(*, date_str: Optional[str] = None, limit: int = 10) -> tuple[dict[str, Any], list[DigestItem]]:
    if os.getenv("AIHOT_FORCE_FAIL", "").strip().lower() in ("1", "true", "yes"):
        raise RuntimeError("AIHOT_FORCE_FAIL is set")

    date_str = date_str or datetime.now(BJ_TZ).strftime("%Y-%m-%d")
    daily = _request_json(f"/api/public/daily/{date_str}")

    section_buckets: list[list[DigestItem]] = []
    daily_order = 0
    for section in daily.get("sections") or []:
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

    public_fillers: list[DigestItem] = []
    window_start = daily.get("windowStart")
    window_end_dt = _parse_dt(daily.get("windowEnd"))
    if isinstance(window_start, str) and window_start:
        public_items = _request_json(
            "/api/public/items",
            params={"mode": "all", "since": window_start, "take": 100},
        )
        for obj in public_items.get("items") or []:
            if not isinstance(obj, dict):
                continue
            it = _public_item(obj)
            if not it.title or not (it.url or it.permalink):
                continue
            if window_end_dt and it.published_at and it.published_at > window_end_dt:
                continue
            public_fillers.append(it)

    return daily, _select_section_balanced(section_buckets, public_fillers, limit)


def render_aihot_markdown(*, date_str: Optional[str] = None, limit: int = 10) -> str:
    daily, items = fetch_aihot_digest(date_str=date_str, limit=limit)
    date_show = str(daily.get("date") or date_str or datetime.now(BJ_TZ).strftime("%Y-%m-%d"))

    lines = [f"# 智能前沿日报（{date_show}）", ""]
    if not items:
        lines.append("No items found in the daily window.")
        lines.append("")
        return "\n".join(lines)

    for i, it in enumerate(items, start=1):
        lines.append(f"{i}. {_shorten(it.title, 90)}")
        if it.summary:
            lines.append(f"- {_shorten(it.summary, 110)}")
        meta = []
        if it.source_name:
            meta.append(it.source_name)
        if it.section_label:
            meta.append(it.section_label)
        elif it.category:
            meta.append(it.category)
        if it.score is not None:
            meta.append(f"score {it.score}")
        if meta:
            lines.append(f"- 来源：{' · '.join(meta)}")
        read_url = _read_url(it)
        lines.append(f"- [阅读全文]({read_url})")
    lines.append("")
    return "\n".join(lines)
