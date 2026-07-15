# ai_feishu_digest

每天早上 8:20（北京时间）自动抓取 AI HOT 中文 AI 日报与公开条目，生成最多 10 条中文简报，并推送到群（企业微信群机器人 / 飞书群机器人）。

## 功能

- 默认数据源：AI HOT 公开 API（匿名只读，无需 token）
- 重点主题优先：具身智能、机械臂、AI 毛绒/陪伴硬件、语音对话、大模型相关条目优先展示；不足 10 条时按 AI HOT 官方推荐补齐
- 最多 10 条：避免群消息过长
- 自动降级：AI HOT 接口失败、日报缺失或返回空数据时，会自动切回原来的 RSS + 翻译逻辑
- 旧 RSS 聚合保留：设置 `DIGEST_SOURCE=rss` 可强制使用原来的 RSS + 翻译逻辑
- 推送：
  - 企业微信群机器人：`WEIXIN_WEBHOOK`（默认图文卡片，超过 8 条会自动拆分）
  - 飞书群机器人：`FEISHU_WEBHOOK_URL`（默认互动卡片，可选签名）
- Cloudflare Worker：每天 08:20（北京时间）自动执行；GitHub Actions 仅保留手动运行

## 目录结构

- `ai_feishu_digest/aihot.py`：AI HOT 拉取 + 去重 + 具身智能优先排序
- `ai_feishu_digest/feeds.json`：旧 RSS 源、关键词、每源上限等配置
- `ai_feishu_digest/digest.py`：抓取 + 过滤/排序 + 生成 Markdown
- `ai_feishu_digest/push.py`：根据环境变量推送到微信/飞书（有哪个推哪个，两个都有就都推）
- `ai_feishu_digest/weixin.py`：企业微信推送（默认图文卡片，可切回 Markdown）
- `ai_feishu_digest/feishu.py`：飞书推送（默认互动卡片）
- `cloudflare-worker/`：Cloudflare Worker 定时推送版本
- `.github/workflows/ai-feishu-digest.yml`：GitHub Actions 手动备用任务

## 本地运行

建议直接在仓库目录运行（避免你机器上存在多份拷贝导致行为不一致）：

```bash
cd /path/to/ai_feishu_digest
```

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r ai_feishu_digest/requirements.txt

# 推企业微信群机器人（二选一或都选）
export WEIXIN_WEBHOOK='https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=REPLACE_ME'
# 可选：切回企业微信 Markdown 文本格式
# export WEIXIN_MESSAGE_FORMAT=markdown

# 推飞书群机器人（可选）
export FEISHU_WEBHOOK_URL='https://open.feishu.cn/open-apis/bot/v2/hook/REPLACE_ME'
# 如果飞书机器人开启了签名校验，再加：
# export FEISHU_SIGNING_SECRET='REPLACE_ME'

# 默认使用 AI HOT，不需要翻译密钥。
# 如需切回旧 RSS 数据源，再打开：
# export DIGEST_SOURCE=rss

# 旧 RSS 中文翻译（仅 DIGEST_SOURCE=rss 时需要）
export BAIDU_FANYI_APPID='REPLACE_ME'
export BAIDU_APIKEY='REPLACE_ME'

# （可选）LLM 中文化/摘要：OpenAI 兼容接口
# 默认不会启用（即便你配了 LLM 环境变量）。如需启用，再显式打开：
# export PREFER_LLM=1
# 然后配置以下环境变量（三选一命名即可）：
# export LLM_BASE_URL='https://api.openai.com'          # 或 OPENAI_BASE_URL
# export LLM_API_KEY='REPLACE_ME'                      # 或 OPENAI_API_KEY
# export LLM_MODEL='gpt-4o-mini'                       # 或 OPENAI_MODEL

python ai_feishu_digest/digest.py > ai_feishu_digest/out.md
python ai_feishu_digest/push.py --markdown-file ai_feishu_digest/out.md
```

## 本地预览（不推送）

生成飞书卡片近似预览 + 企业微信图文卡片预览：

```bash
python ai_feishu_digest/preview.py
```

生成后打开 `ai_feishu_digest/preview.html`。这个命令不会读取 webhook，也不会发送到群。

也可以预览已有 Markdown：

```bash
python ai_feishu_digest/preview.py --markdown-file ai_feishu_digest/out.md
```

本地与 GitHub Actions 共用同一套代码逻辑：都通过环境变量读取 webhook 和翻译密钥。
区别仅在于环境变量来源：本地来自你的 shell（`export ...`），GitHub 来自仓库 Secrets（workflow 注入到 `env`）。

## GitHub Actions 配置（手动备用）

1) 确保仓库里包含：

- `ai_feishu_digest/`
- `.github/workflows/ai-feishu-digest.yml`

2) 在仓库 Settings → Secrets and variables → Actions 添加 Secrets（Actions 不会读取你本地 `.zshrc`）：

- 推企业微信群机器人：
  - `WEIXIN_WEBHOOK`
  - `WEIXIN_MESSAGE_FORMAT=markdown`（可选，切回 Markdown）
- 默认 AI HOT 数据源不需要翻译密钥。旧 RSS 数据源才需要中文翻译（百度翻译）：
  - `BAIDU_FANYI_APPID`
  - `BAIDU_APIKEY`

如果没有配置百度翻译（或配置错误），推送内容会保持为英文标题/摘要。

（可选）LLM 中文化/摘要：
- 需要先显式开启：`PREFER_LLM=1`
- 再配置：`LLM_MODEL`（必填）以及 `LLM_BASE_URL/LLM_API_KEY`（按你的服务需要）
- 兼容别名：`OPENAI_BASE_URL/OPENAI_API_KEY/OPENAI_MODEL`
- 推飞书（可选，默认卡片式消息）：
  - `FEISHU_WEBHOOK_URL`
  - `FEISHU_SIGNING_SECRET`（可选）
  - `FEISHU_MESSAGE_FORMAT=post`（可选，切回旧富文本 post）

3) 验证是否能在 GitHub 环境正确抓取数据：

- Actions 页面手动运行一次（workflow 已支持 `workflow_dispatch`）
- 下载本次 run 的 artifact：`ai-tech-digest`，检查 `out.md` 内容是否正常

备注：GitHub Actions 当前只保留 `workflow_dispatch` 手动触发，正式定时由 Cloudflare Worker 接管，避免 GitHub schedule 延迟到上午 11 点左右。部分旧 RSS 媒体可能对 GitHub Runner IP 有限流/403；可以通过替换源、减少源或调整频率解决。

## Cloudflare Worker 准点方案

如果 GitHub Actions 的 schedule 延迟太久，可以改用 Cloudflare Worker。Worker 不需要自有服务器，会在 Cloudflare 上每天北京时间 08:20 直接运行并推送。

代码在 `cloudflare-worker/`：

```bash
cd cloudflare-worker
npm install
npx wrangler login
npx wrangler secret put FEISHU_WEBHOOK_URL
npx wrangler secret put WEIXIN_WEBHOOK
npx wrangler deploy
```

如果飞书机器人启用了签名校验：

```bash
npx wrangler secret put FEISHU_SIGNING_SECRET
```

当前 Worker 已经具备 AI HOT 主源 + RSS 备用源：AI HOT 接口失败、服务器错误、日报缺失或空数据时，会自动切到旧 RSS 源，并继续用飞书互动卡片和企业微信图文卡片推送。详细说明见 `cloudflare-worker/README.md`。

## GitHub 调试方法

1) 先看 artifact

- 每次 workflow 运行都会上传 `ai-tech-digest/out.md`
- 这是 GitHub Runner 真实生成的最终内容，用它判断“抓取是否成功/是否已翻译/格式是否符合”

2) 再看 Actions 日志

- workflow 中包含 `Debug digest source` 步骤：
  - 打印当前 `DIGEST_SOURCE` 与 `AIHOT_USER_AGENT`
  - 只打印 `BAIDU_FANYI_APPID/BAIDU_APIKEY` 是否 set（不会泄露密钥）
  - 不会无条件调用百度翻译，避免旧 RSS 备用能力影响默认 AI HOT 主流程

3) 推送问题排查（企业微信）

- 可在 workflow 中临时增加 `PUSH_DEBUG=1`（或本地 `export PUSH_DEBUG=1`）
- 这样会在日志中打印企业微信 webhook 分片发送情况（是否拆成多条，以及每段是否 ok）

## 自定义（AI 优先）

编辑 `ai_feishu_digest/feeds.json`：

- `keywords`：AI/LLM/Agent/RAG 等关键词，命中越多排名越靠前
- `cap_arxiv`：限制 arXiv 每天最多出现多少条（避免论文刷屏）
- `cap_per_source`：限制单个媒体来源的占比
