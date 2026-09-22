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

// 6. The API is down but the site is up: AI HOT's own Chinese RSS feed is used,
//    so the digest stays Chinese without needing any translation service.
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.includes("aihot.news/api/")) return Promise.resolve(new Response("api down", { status: 503 }));
    return realFetch(input, init);
  };
  try {
    const { body } = await run({ ...baseEnv, DIGEST_DATE: beijingDate() });
    check("aihot feed: uses the Chinese feed", body.source === "aihot-feed", `source=${body.source}`);
    check("aihot feed: titles are Chinese", body.itemTitles.every(hasCjk));
    check("aihot feed: card notes the fallback", cardLines(body.feishu.payload).some((line) => line.includes("精选 RSS")));
    check("aihot feed: summaries have no feed trailer", cardLines(body.feishu.payload).every((line) => !line.includes("阅读原文")));
  } finally {
    globalThis.fetch = realFetch;
  }
}

// 7. Every source is down: a notice is sent instead of going silent.
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.includes("aihot.news")) return Promise.resolve(new Response("down", { status: 503 }));
    if (url.includes("feed") || url.includes("rss") || url.includes("arxiv") || url.includes("blog")) {
      return Promise.resolve(new Response("down", { status: 503 }));
    }
    return realFetch(input, init);
  };
  try {
    const { status, body } = await run({ ...baseEnv, DIGEST_DATE: beijingDate() });
    check("all down: reports failure", status === 200 && body.ok === false, `ok=${body.ok} reason=${body.reason}`);
    check("all down: count is zero", body.count === 0, `count=${body.count}`);
    check("all down: notice payload built", Boolean(body.feishu.payload), JSON.stringify(body.feishu).slice(0, 80));
    check(
      "all down: notice explains itself",
      cardLines(body.feishu.payload).some((line) => line.includes("没能生成日报"))
    );
  } finally {
    globalThis.fetch = realFetch;
  }
}

// 8. The English RSS fallback must reach Baidu and come back translated. This is
//    the path that silently stayed English on 2026-09-22.
{
  const realFetch = globalThis.fetch;
  const baiduRequests = [];
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.includes("aihot.news")) return new Response("down", { status: 503 });
    if (url.includes("fanyi-api.baidu.com")) {
      const q = new URLSearchParams(String(init?.body || "")).get("q") || "";
      baiduRequests.push(q);
      // Answer one entry per line, like Baidu does.
      const trans_result = q.split("\n").map((src) => ({ src, dst: `中文译文${src.length}` }));
      return new Response(JSON.stringify({ from: "en", to: "zh", trans_result }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return realFetch(input, init);
  };
  try {
    const { body } = await run({
      ...baseEnv,
      DIGEST_DATE: beijingDate(),
      BAIDU_FANYI_APPID: "test-appid",
      BAIDU_APIKEY: "test-key"
    });
    check("baidu: two batched requests", baiduRequests.length === 2, `requests=${baiduRequests.length}`);
    check("baidu: no blank lines sent", baiduRequests.every((q) => !q.includes("\n\n")));
    check("baidu: titles were translated", body.itemTitles.every((title) => title.startsWith("中文译文")), body.itemTitles[0]);
  } finally {
    globalThis.fetch = realFetch;
  }
}

// 9. A flaky webhook is retried rather than losing the digest.
{
  const realFetch = globalThis.fetch;
  let webhookCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.includes("open.feishu.cn")) {
      webhookCalls += 1;
      if (webhookCalls < 3) return new Response("boom", { status: 500 });
      return new Response(JSON.stringify({ code: 0 }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("qyapi.weixin.qq.com")) {
      throw new Error("this test must not reach the WeCom webhook");
    }
    return realFetch(input, init);
  };
  try {
    // WEIXIN_WEBHOOK is cleared so the only webhook in play is the stubbed Feishu one.
    const { body } = await run(
      { ...baseEnv, WEIXIN_WEBHOOK: "", DIGEST_DATE: beijingDate() },
      "?dry=0"
    );
    check("retry: webhook attempted three times", webhookCalls === 3, `calls=${webhookCalls}`);
    check("retry: digest delivered on the third try", body.feishu && body.feishu.ok === true, JSON.stringify(body).slice(0, 200));
  } finally {
    globalThis.fetch = realFetch;
  }
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("failed:");
  for (const result of failed) console.log(`  - ${result.name} ${result.detail}`);
  process.exit(1);
}
