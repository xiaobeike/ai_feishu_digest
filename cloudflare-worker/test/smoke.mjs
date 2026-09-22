// Smoke test for the digest worker.
//
// Every check runs with dry=1, so the worker builds the real Feishu / WeCom
// payloads and returns them instead of posting. No webhook is ever contacted —
// the webhook URLs below are deliberately unroutable placeholders.
//
// Usage: npm test

const worker = (await import(new URL("../src/worker.js", import.meta.url))).default;

const ctx = { waitUntil() {} };
const NEVER_POST = "https://open.feishu.cn/open-apis/bot/v2/hook/DO-NOT-SEND";
const NEVER_POST_WEIXIN = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=DO-NOT-SEND";

const results = [];
function check(name, condition, detail = "") {
  results.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

function beijingDate(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(Date.now() + offsetDays * 86400000));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

async function run(env, query = "?dry=1") {
  const response = await worker.fetch(new Request(`https://worker.test/run${query}`), env, ctx);
  return { status: response.status, body: await response.json() };
}

const hasCjk = (value) => /[\u4e00-\u9fff]/.test(String(value || ""));
const cardLines = (payload) =>
  payload.card.elements.filter((element) => element.tag === "div").map((element) => element.text.content);

const baseEnv = {
  FEISHU_WEBHOOK_URL: NEVER_POST,
  WEIXIN_WEBHOOK: NEVER_POST_WEIXIN,
  FEISHU_SIGNING_SECRET: "smoke-test-secret",
  DIGEST_LIMIT: "10"
};

// 1. Normal path: the curated daily report exists.
{
  const today = beijingDate();
  const { status, body } = await run({ ...baseEnv, DIGEST_DATE: today });
  check("daily: HTTP 200", status === 200, `status=${status}`);
  check("daily: uses the curated report", body.source === "aihot-daily", `source=${body.source}`);
  check("daily: 10 items", body.count === 10, `count=${body.count}`);
  check("daily: titles are Chinese", body.itemTitles.every(hasCjk));
  check("daily: no fallback note in card", !cardLines(body.feishu.payload).some((line) => line.includes("精选池")));
  check("daily: one button per item", body.feishu.payload.card.elements.filter((e) => e.tag === "action").length === body.count);
  check("daily: card is signed", typeof body.feishu.payload.sign === "string" && body.feishu.payload.sign.length > 0);
}

// 2. The regression that caused the all-English push: the daily report for the
//    requested date is not published yet. The digest must stay Chinese.
{
  const tomorrow = beijingDate(1);
  const { status, body } = await run({ ...baseEnv, DIGEST_DATE: tomorrow });
  check("late daily: HTTP 200", status === 200, `status=${status}`);
  check("late daily: stays on AI HOT", body.source !== "rss-fallback", `source=${body.source}`);
  check("late daily: titles are Chinese", body.itemTitles.every(hasCjk));
  check("late daily: card notes the degraded source", cardLines(body.feishu.payload).some((line) => line.includes("精选池")));
  check("late daily: reason recorded", body.fallbackReason.includes("404"), body.fallbackReason);
}

// 3. AI HOT unreachable entirely: the third-party RSS fallback still works.
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.includes("aihot.news")) return Promise.resolve(new Response("upstream down", { status: 503 }));
    return realFetch(input, init);
  };
  try {
    const { status, body } = await run({ ...baseEnv, DIGEST_DATE: beijingDate() });
    check("aihot down: HTTP 200", status === 200, `status=${status}`);
    check("aihot down: uses rss fallback", body.source === "rss-fallback", `source=${body.source}`);
    check("aihot down: still returns items", body.count > 0, `count=${body.count}`);
    check("aihot down: card notes the fallback", cardLines(body.feishu.payload).some((line) => line.includes("备用 RSS")));
  } finally {
    globalThis.fetch = realFetch;
  }
}

// 4. Outbound requests must refuse private and non-HTTP targets.
{
  const targets = [
    ["http://127.0.0.1:9/hook", "loopback"],
    ["http://10.0.0.5/hook", "private range"],
    ["http://169.254.169.254/latest/meta-data", "link-local metadata"],
    ["file:///etc/passwd", "non-http scheme"]
  ];
  for (const [url, label] of targets) {
    const { status, body } = await run({ ...baseEnv, DIGEST_DATE: beijingDate(), FEISHU_WEBHOOK_URL: url }, "?dry=0");
    check(`guard: rejects ${label}`, status === 500 && /non-public host|Unsupported URL scheme/.test(body.error || ""), body.error);
  }
}

// 5. WeCom payload: chunked, with the same fallback note on the last card.
{
  const { body } = await run({ ...baseEnv, DIGEST_DATE: beijingDate(1) });
  const payloads = body.weixin.payloads || [];
  const articles = payloads.flatMap((payload) => payload.news.articles);
  check("weixin: 10 articles in 2 chunks", articles.length === 10 && payloads.length === 2, `${articles.length}/${payloads.length}`);
  check("weixin: note on last article", articles[articles.length - 1].description.includes("精选池"));
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("failed:");
  for (const result of failed) console.log(`  - ${result.name} ${result.detail}`);
  process.exit(1);
}
