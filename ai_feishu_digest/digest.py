import calendar
import html
import json
import os
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional
from zoneinfo import ZoneInfo

import feedparser

from llm import llm_enabled, zh_title_and_summary
from translate_baidu import baidu_enabled, translate_lines_zh


BJ_TZ = ZoneInfo("Asia/Shanghai")


@dataclass(frozen=True)
class Item:
    source: str
    title: str
    link: str
    published_utc: datetime
    summary: str


def _parse_struct_time_to_utc(st) -> Optional[datetime]:
    if not st:
        return None
    try:
        ts = calendar.timegm(st)
        return datetime.fromtimestamp(ts, tz=timezone.utc)
    except Exception:
        return None


def _entry_published_utc(entry) -> Optional[datetime]:
    dt = _parse_struct_time_to_utc(getattr(entry, "published_parsed", None))
    if dt:
        return dt
    return _parse_struct_time_to_utc(getattr(entry, "updated_parsed", None))


def _normalize_title(title: str) -> str:
    title = re.sub(r"\s+", " ", (title or "").strip())
    return title


def _strip_html(s: str) -> str:
    s = s or ""
    s = html.unescape(s)
    s = re.sub(r"<[^>]+>", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _clean_arxiv_summary(s: str) -> str:
    s = (s or "").strip()
    if not s:
        return ""
    s = re.sub(r"\s+", " ", s)

    m = re.search(r"Abstract\s*:?\s*(.*)", s, flags=re.IGNORECASE)
    if m:
        s = m.group(1).strip()
    return s


def _shorten(s: str, max_len: int) -> str:
    s = (s or "").strip()
    if len(s) <= max_len:
        return s
    return s[: max_len - 3].rstrip() + "..."


def _shorten_zh(s: str, max_chars: int) -> str:
    s = (s or "").strip()
    if len(s) <= max_chars:
        return s
    cut = s[: max_chars - 3].rstrip()
    cut = re.sub(r"[A-Za-z0-9]+$", "", cut).rstrip()
    return cut + "..."


def _one_sentence(s: str) -> str:
    s = (s or "").strip()
    if not s:
        return ""
    for p in ("。", "！", "？", ". ", "! ", "? ", ".", "!", "?"):
        i = s.find(p)
        if i != -1:
            end = i + (2 if p in (". ", "! ", "? ") else 1)
            return s[:end].strip()
    return s


def _dedup_key(title: str, link: str) -> str:
    title = re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()
    link = (link or "").strip().lower()
    return f"{title}::{link}"


def load_config(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _score_item(title: str, summary: str, keywords: list[str]) -> int:
    text = f"{title}\n{summary}".lower()
    score = 0
    for kw in keywords:
        k = (kw or "").strip().lower()
        if not k:
            continue
        if k in text:
            score += 1
    return score


def filter_and_rank(items: list[Item], cfg: dict) -> list[Item]:
    keywords = cfg.get("keywords") or []
    if not isinstance(keywords, list):
        keywords = []

    scored: list[tuple[int, Item]] = []
    for it in items:
        scored.append((_score_item(it.title, it.summary, keywords), it))

    scored.sort(key=lambda x: (x[0], x[1].published_utc), reverse=True)

    cap_default = int(cfg.get("cap_per_source", 3))
    cap_arxiv = int(cfg.get("cap_arxiv", 2))
    want = int(cfg.get("limit", 10))

    out: list[Item] = []
    counts: dict[str, int] = {}

    def try_add(it: Item) -> bool:
        cap = cap_arxiv if "arxiv" in it.source.lower() else cap_default
        n = counts.get(it.source, 0)
        if n >= cap:
            return False
        counts[it.source] = n + 1
        out.append(it)
        return True

    for score, it in scored:
        if score <= 0:
            continue
        try_add(it)
        if len(out) >= want:
            break

    if len(out) < want:
        for score, it in scored:
            if score > 0:
                continue
            try_add(it)
            if len(out) >= want:
                break
    return out


def fetch_items(cfg: dict) -> list[Item]:
    hours = int(cfg.get("hours", 24))
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

    seen: set[str] = set()
    out: list[Item] = []

    for src in cfg.get("sources", []):
        name = src.get("name") or "(unknown)"
        url = src.get("url")
        if not url:
            continue

        feed = feedparser.parse(url)
        for entry in getattr(feed, "entries", []) or []:
            title = _normalize_title(getattr(entry, "title", ""))
            link = (getattr(entry, "link", "") or "").strip()
            summary = _strip_html(getattr(entry, "summary", "") or getattr(entry, "description", ""))
            if "arxiv" in name.lower():
                summary = _clean_arxiv_summary(summary)
            published_utc = _entry_published_utc(entry)
            if not title or not link or not published_utc:
                continue
            if published_utc < cutoff:
                continue

            key = _dedup_key(title, link)
            if key in seen:
                continue
            seen.add(key)
            out.append(Item(source=name, title=title, link=link, published_utc=published_utc, summary=summary))

    out.sort(key=lambda x: x.published_utc, reverse=True)
    return out


def render_markdown(items: list[Item], limit: int, hours: int) -> str:
    now_bj = datetime.now(BJ_TZ)
    date_str = now_bj.strftime("%Y-%m-%d")
    header = f"# AI/科技日报（{date_str}）"

    lines: list[str] = [header]
    if not items:
        lines.append("No items found in the time window.")
        lines.append("")
        return "\n".join(lines)

    take = items[:limit]

    prefer_llm = os.getenv("PREFER_LLM", "").strip().lower() in ("1", "true", "yes")

    zh_map = {}
    if prefer_llm and llm_enabled():
        req = []
        for i, it in enumerate(take, start=1):
            req.append({"idx": i, "source": it.source, "title": it.title, "summary": it.summary})
        zh_map = zh_title_and_summary(items=req)

    baidu_title_map: dict[int, str] = {}
    baidu_summary_map: dict[int, str] = {}
    if baidu_enabled():
        need_title_idx: list[int] = []
        need_title_lines: list[str] = []
        need_sum_idx: list[int] = []
        need_sum_lines: list[str] = []

        for i, it in enumerate(take, start=1):
            zh = zh_map.get(i, {}) if isinstance(zh_map, dict) else {}
            if (not str(zh.get("title_zh", "")).strip()) and it.title:
                need_title_idx.append(i)
                need_title_lines.append(it.title)

            if it.summary and (not str(zh.get("summary_zh", "")).strip()):
                need_sum_idx.append(i)
                need_sum_lines.append(_shorten(it.summary, 160))

        if need_title_lines:
            got = translate_lines_zh(need_title_lines)
            if len(got) == len(need_title_idx):
                for idx, s in zip(need_title_idx, got):
                    if isinstance(s, str) and s.strip():
                        baidu_title_map[idx] = s.strip()

        if need_sum_lines:
            got = translate_lines_zh(need_sum_lines)
            if len(got) == len(need_sum_idx):
                for idx, s in zip(need_sum_idx, got):
                    if isinstance(s, str) and s.strip():
                        baidu_summary_map[idx] = s.strip()

    for i, it in enumerate(take, start=1):
        zh = zh_map.get(i, {})
        if zh.get("title_zh"):
            title_show = zh["title_zh"]
        elif i in baidu_title_map:
            title_show = baidu_title_map[i]
        else:
            title_show = it.title
        summary_show = zh.get("summary_zh", "").strip()
        if not summary_show and it.summary:
            if i in baidu_summary_map:
                summary_show = baidu_summary_map[i]
            if not summary_show:
                summary_show = _shorten(it.summary, 140)

        title_show = _shorten_zh(title_show, 72)
        summary_show = _shorten_zh(_one_sentence(summary_show), 72)

        lines.append(f"{i}. {title_show}")
        if summary_show:
            lines.append(f"- {summary_show}")
        lines.append(f"- [全文]({it.link})")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    cfg_path = Path(__file__).with_name("feeds.json")
    cfg = load_config(cfg_path)
    hours = int(cfg.get("hours", 24))
    limit = int(cfg.get("limit", 10))

    items = fetch_items(cfg)
    ranked = filter_and_rank(items, cfg)
    md = render_markdown(ranked, limit=limit, hours=hours)
    sys.stdout.write(md)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
