import argparse
import html
import os
from pathlib import Path

from aihot import render_aihot_markdown
from feishu import _parse_digest_markdown


def _render_card_html(markdown: str, title: str) -> str:
    card_title, subtitle, items = _parse_digest_markdown(markdown)
    card_title = card_title or title

    rows = []
    if subtitle:
        rows.append(f'<div class="subtitle">{html.escape(subtitle)}</div>')

    for idx, item in enumerate(items, start=1):
        summary = html.escape(item.summary)
        source = html.escape(item.source)
        url = html.escape(item.url, quote=True)
        button_class = "button primary" if idx <= 3 else "button"
        rows.append(
            f"""
            <section class="news-item">
              <div class="news-title"><span>{idx}</span>{html.escape(item.title)}</div>
              {f'<p>{summary}</p>' if summary else ''}
              {f'<div class="source">{source}</div>' if source else ''}
              {f'<a class="{button_class}" href="{url}" target="_blank" rel="noreferrer">阅读全文</a>' if url else ''}
            </section>
            """
        )

    return f"""
    <article class="feishu-card">
      <header>{html.escape(card_title)}</header>
      {''.join(rows)}
    </article>
    """


def _render_weixin_html(markdown: str) -> str:
    return f"""
    <article class="weixin-card">
      <header>企业微信 Markdown 预览</header>
      <pre>{html.escape(markdown)}</pre>
    </article>
    """


def build_preview_html(markdown: str, *, title: str) -> str:
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{html.escape(title)} Preview</title>
  <style>
    :root {{
      color-scheme: light;
      --bg: #f4f6f8;
      --panel: #ffffff;
      --text: #1f2329;
      --muted: #646a73;
      --line: #dee3ea;
      --blue: #2864ff;
      --blue-dark: #1f4fd1;
      --wechat: #1aad19;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }}
    main {{
      width: min(1180px, calc(100vw - 32px));
      margin: 32px auto;
      display: grid;
      grid-template-columns: minmax(320px, 520px) minmax(320px, 1fr);
      gap: 24px;
      align-items: start;
    }}
    h1 {{
      grid-column: 1 / -1;
      margin: 0;
      font-size: 22px;
      font-weight: 750;
    }}
    .hint {{
      grid-column: 1 / -1;
      margin: -12px 0 0;
      color: var(--muted);
    }}
    .feishu-card,
    .weixin-card {{
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: 0 10px 28px rgba(31, 35, 41, 0.08);
      overflow: hidden;
    }}
    .feishu-card header {{
      background: var(--blue);
      color: #fff;
      padding: 14px 18px;
      font-size: 17px;
      font-weight: 750;
    }}
    .subtitle {{
      padding: 14px 18px;
      color: var(--muted);
      border-bottom: 1px solid var(--line);
    }}
    .news-item {{
      padding: 16px 18px;
      border-bottom: 1px solid var(--line);
    }}
    .news-item:last-child {{ border-bottom: 0; }}
    .news-title {{
      display: flex;
      gap: 10px;
      align-items: flex-start;
      font-weight: 700;
      font-size: 15px;
    }}
    .news-title span {{
      flex: 0 0 24px;
      height: 24px;
      border-radius: 12px;
      background: #edf2ff;
      color: var(--blue);
      display: inline-grid;
      place-items: center;
      font-size: 12px;
      font-weight: 800;
      margin-top: -1px;
    }}
    .news-item p {{
      margin: 10px 0 8px 34px;
      color: #333842;
    }}
    .source {{
      margin-left: 34px;
      color: var(--muted);
      font-size: 12px;
    }}
    .button {{
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin: 12px 0 0 34px;
      min-width: 88px;
      height: 32px;
      padding: 0 14px;
      border-radius: 6px;
      border: 1px solid var(--line);
      color: var(--text);
      text-decoration: none;
      font-weight: 650;
      background: #fff;
    }}
    .button.primary {{
      border-color: var(--blue);
      background: var(--blue);
      color: #fff;
    }}
    .button:hover {{
      border-color: var(--blue-dark);
      color: var(--blue-dark);
    }}
    .button.primary:hover {{
      background: var(--blue-dark);
      color: #fff;
    }}
    .weixin-card header {{
      padding: 14px 18px;
      color: #fff;
      background: var(--wechat);
      font-weight: 750;
    }}
    pre {{
      margin: 0;
      padding: 16px 18px;
      white-space: pre-wrap;
      word-break: break-word;
      font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }}
    @media (max-width: 840px) {{
      main {{
        grid-template-columns: 1fr;
        width: min(720px, calc(100vw - 24px));
        margin: 20px auto;
      }}
    }}
  </style>
</head>
<body>
  <main>
    <h1>{html.escape(title)} 本地预览</h1>
    <p class="hint">这个页面只预览样式，不会调用飞书或企业微信 webhook。实际飞书渲染可能有细微差异。</p>
    {_render_card_html(markdown, title)}
    {_render_weixin_html(markdown)}
  </main>
</body>
</html>
"""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--markdown-file", help="Use an existing generated markdown file instead of fetching AI HOT.")
    parser.add_argument("--output", default=str(Path(__file__).with_name("preview.html")))
    parser.add_argument("--title", default="AI/Tech Daily Digest")
    args = parser.parse_args()

    if args.markdown_file:
        markdown = Path(args.markdown_file).read_text(encoding="utf-8")
    else:
        limit = int(os.getenv("DIGEST_LIMIT", "10"))
        date_str = os.getenv("DIGEST_DATE", "").strip() or None
        markdown = render_aihot_markdown(date_str=date_str, limit=limit)

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(build_preview_html(markdown, title=args.title), encoding="utf-8")
    print(out.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
