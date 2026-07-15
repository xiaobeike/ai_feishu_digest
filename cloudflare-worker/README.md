# Cloudflare Worker 定时推送

这个目录是无服务器版本：Cloudflare Worker 每天北京时间 08:20 直接抓取 AI HOT，生成最多 10 条「智能前沿日报」，并推送到飞书和企业微信。

它不依赖 GitHub Actions，也不需要你自己的服务器。

## 行为

- 主数据源：AI HOT 当天日报与公开条目
- 备用数据源：AI HOT 接口失败、服务器错误、日报缺失或空数据时，自动抓取旧 RSS 源
- 备用翻译：配置百度翻译密钥后，RSS 兜底内容会翻译成中文；未配置时保留英文
- 优先主题：具身智能、机械臂、AI 毛绒/陪伴硬件、语音对话、大模型
- 推送格式：
  - 飞书：互动卡片，每条都有「阅读全文」按钮
  - 企业微信：图文卡片，最多 8 条一组，10 条时自动拆成两条消息
- 手动触发：建议配置 `CRON_SECRET`，避免公开 `/run` 被别人触发推送

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

如果希望旧 RSS 兜底内容翻译成中文，再配置百度翻译：

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
crons = ["20 0 * * *"]
```

Cloudflare Cron 使用 UTC，这等于北京时间 08:20。

## 手动测试

部署后可以访问健康检查：

```bash
curl https://<worker-url>/health
```

如果配置了 `CRON_SECRET`，手动触发：

```bash
curl -X POST https://<worker-url>/run \
  -H "Authorization: Bearer <CRON_SECRET>"
```

如果没有配置 `CRON_SECRET`，`/run` 会直接触发推送。建议正式使用时配置 `CRON_SECRET`。

## 迁移提醒

Worker 部署并验证成功后，建议关闭 GitHub Actions 的定时触发，避免每天重复推送。

保留 GitHub Actions 的 `workflow_dispatch` 手动触发即可。
