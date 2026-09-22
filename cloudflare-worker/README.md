# Cloudflare Worker 定时推送

这个目录是无服务器版本：Cloudflare Worker 每天北京时间 09:20 直接抓取 AI HOT 日报，生成最多 10 条「智能前沿日报」，并推送到飞书和企业微信。

它不依赖 GitHub Actions，也不需要你自己的服务器。

## 行为

- 数据源：AI HOT 公开 API v1（`/api/v1/*`，匿名只读，无需 token）
- 栏目均衡：按日报栏目顺序，每个栏目先取前 2 条；栏目不足时从其他栏目剩余条目补齐
- 去重：同 URL、标题包含关系或标题相似度较高的条目只保留一条
- 分级降级（**前三级都保持中文**）：
  1. 当天日报 `/api/v1/dailies/{date}`
  2. 当天日报尚未发布时，改用 AI HOT 精选池 `/api/v1/items?mode=selected&window=24h`
  3. AI HOT 接口不可用时，改用 AIHOT 精选 RSS `https://aihot.news/feed.xml`（中文，不需要翻译）
  4. 以上都不可用时，才抓取旧 RSS 源（英文，靠百度翻译变中文）
- 降级说明：走到 2～4 级时，飞书卡片末尾会加一行灰色说明，企业微信会把它追加到最后一条的简介里
- 不会静默失败：全部数据源都不可用时推送一条失败通知（橙色卡片）；webhook 推送失败自动重试 3 次
- 百度翻译只在第 4 级用到；失败时会把 `error_code` 打到日志（`npx wrangler tail` 可见），不再静默回退成英文
- 推送格式：
  - 飞书：互动卡片，每条都有「阅读全文」按钮
  - 企业微信：图文卡片，最多 8 条一组，10 条时自动拆成两条消息
- 手动触发：建议配置 `CRON_SECRET`，避免公开 `/run` 被别人触发推送

## 为什么触发时间是 09:20

AI HOT 日报按设计在北京时间 08:00 发布，但偶尔会晚：2026-09-22 的日报晚到 08:59。旧的 08:20 触发赶在发布之前，`/api/v1/dailies/{date}` 返回 404，于是整条推送降级成了英文 RSS，群里收到的就全是英文。

现在触发时间留出 80 分钟余量，并且即使日报仍然缺失，降级链也会先停在中文的 AI HOT 精选池，不会再直接掉到英文源。

## 准备

安装依赖：

```bash
cd cloudflare-worker
npm install
```

登录 Cloudflare：

```bash
npx wrangler login
```

## 配置密钥

至少配置一个 webhook：

```bash
npx wrangler secret put FEISHU_WEBHOOK_URL
npx wrangler secret put WEIXIN_WEBHOOK
```

如果飞书机器人启用了签名校验，再配置：

```bash
npx wrangler secret put FEISHU_SIGNING_SECRET
```

百度翻译只在最后一级（旧 RSS 兜底）用到。正常情况下降级会停在中文的 AI HOT 精选池，用不到它；只有你希望连英文 RSS 兜底也翻译成中文时才需要配置：

```bash
npx wrangler secret put BAIDU_FANYI_APPID
npx wrangler secret put BAIDU_APIKEY
```

可选：配置一个手动触发密钥。配置后访问 `/run` 时需要带 `Authorization: Bearer <CRON_SECRET>`：

```bash
npx wrangler secret put CRON_SECRET
```

## 部署

```bash
npx wrangler deploy
```

`wrangler.toml` 中的 cron 是：

```toml
crons = ["20 1 * * *"]
```

Cloudflare Cron 使用 UTC，这等于北京时间 09:20。

## 测试

冒烟测试会跑完整逻辑，但用 `dry=1` 让 Worker 返回构造好的 payload 而不调用任何 webhook：

```bash
npm test
```

它覆盖：正常日报路径、日报未发布时的降级路径、AI HOT 完全不可用时的 RSS 兜底，以及出站 URL 校验（拒绝环回/私有/链路本地地址和非 http(s) 协议）。测试用的 webhook 是占位地址，不会被访问。

## 手动测试

部署后可以访问健康检查：

```bash
curl https://<worker-url>/health
```

只看会推送什么内容、不真的发出去（返回完整 payload）：

```bash
curl 'https://<worker-url>/run?dry=1'
```

真的触发一次推送（如果配置了 `CRON_SECRET`，需要带 Authorization）：

```bash
curl -X POST https://<worker-url>/run \
  -H "Authorization: Bearer <CRON_SECRET>"
```

如果没配置 `CRON_SECRET`，`/run` 会直接触发推送。建议正式使用时配置 `CRON_SECRET`。

## 出站请求安全校验

所有出站请求在发出前都会校验：只允许 http/https、拒绝 localhost/环回/私有/链路本地/保留地址。AI HOT 路径固定在 `aihot.news`，RSS 与百度翻译使用代码内的固定地址。

## 迁移提醒

Worker 部署并验证成功后，建议关闭 GitHub Actions 的定时触发，避免每天重复推送。

保留 GitHub Actions 的 `workflow_dispatch` 手动触发即可。
