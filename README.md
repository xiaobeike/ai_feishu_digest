# ai_feishu_digest

每天早上 8 点（北京时间）自动抓取 AI/AI 开发者/AI 技术相关 RSS，生成中文简报，并推送到群（企业微信群机器人 / 飞书群机器人）。

## 功能

- RSS 聚合：可配置多个媒体/官方博客/社区源
- AI 优先：用关键词打分 + 近期优先，科技新闻作为补充
- 中文化：优先用百度翻译（不需要大模型）；也支持可选的 OpenAI 兼容 LLM
- 推送：
  - 企业微信群机器人：`WEIXIN_WEBHOOK`
  - 飞书群机器人：`FEISHU_WEBHOOK_URL`（可选签名）
- GitHub Actions：每天 08:00（北京时间）自动执行，并上传本次生成的 `out.md` 作为 artifact

## 目录结构

- `ai_feishu_digest/feeds.json`：RSS 源、关键词、每源上限等配置
- `ai_feishu_digest/digest.py`：抓取 + 过滤/排序 + 生成 Markdown
- `ai_feishu_digest/push.py`：根据环境变量推送到微信/飞书（有哪个推哪个，两个都有就都推）
- `ai_feishu_digest/weixin.py`：企业微信推送（自动按字节切分，尽量保证只发一条）
- `ai_feishu_digest/feishu.py`：飞书推送
- `.github/workflows/ai-feishu-digest.yml`：定时任务

## 本地运行

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r ai_feishu_digest/requirements.txt

# 推企业微信群机器人（二选一或都选）
export WEIXIN_WEBHOOK='https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=REPLACE_ME'

# 推飞书群机器人（可选）
export FEISHU_WEBHOOK_URL='https://open.feishu.cn/open-apis/bot/v2/hook/REPLACE_ME'
# 如果飞书机器人开启了签名校验，再加：
# export FEISHU_SIGNING_SECRET='REPLACE_ME'

# 中文翻译（推荐：百度翻译，不走大模型）
export BAIDU_FANYI_APPID='REPLACE_ME'
export BAIDU_APIKEY='REPLACE_ME'

python ai_feishu_digest/digest.py > ai_feishu_digest/out.md
python ai_feishu_digest/push.py --markdown-file ai_feishu_digest/out.md
```

## GitHub Actions 配置（每天 08:00 北京时间）

1) 确保仓库里包含：

- `ai_feishu_digest/`
- `.github/workflows/ai-feishu-digest.yml`

2) 在仓库 Settings → Secrets and variables → Actions 添加 Secrets（Actions 不会读取你本地 `.zshrc`）：

- 推企业微信群机器人：
  - `WEIXIN_WEBHOOK`
- 中文翻译（百度翻译）：
  - `BAIDU_FANYI_APPID`
  - `BAIDU_APIKEY`

如果没有配置百度翻译（或配置错误），推送内容会保持为英文标题/摘要。
- 推飞书（可选）：
  - `FEISHU_WEBHOOK_URL`
  - `FEISHU_SIGNING_SECRET`（可选）

3) 验证是否能在 GitHub 环境正确抓取数据：

- Actions 页面手动运行一次（workflow 已支持 `workflow_dispatch`）
- 下载本次 run 的 artifact：`ai-tech-digest`，检查 `out.md` 内容是否正常

备注：部分媒体 RSS 可能对 GitHub Runner IP 有限流/403；可以通过替换源、减少源或调整频率解决。

## 自定义（AI 优先）

编辑 `ai_feishu_digest/feeds.json`：

- `keywords`：AI/LLM/Agent/RAG 等关键词，命中越多排名越靠前
- `cap_arxiv`：限制 arXiv 每天最多出现多少条（避免论文刷屏）
- `cap_per_source`：限制单个媒体来源的占比
