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

// fetch() is called with strings, URL objects and Requests; URL has .href, not .url.
function requestUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return (input && input.url) || String(input);
}

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
  check("daily: no fallback note in card", !cardLines(body.feishu.payload).some((line) => line.includes("尚未发布")));
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
  check("late daily: card notes the degraded source", cardLines(body.feishu.payload).some((line) => line.includes("尚未发布")));
  check("late daily: reason recorded", body.fallbackReason.includes("404"), body.fallbackReason);
}

// 3. AI HOT unreachable entirely: the third-party RSS fallback still works.
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = requestUrl(input);
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
  check("weixin: note on last article", articles[articles.length - 1].description.includes("尚未发布"));
}

// 6. The API is down but the site is up: AI HOT's own Chinese RSS feed is used,
//    so the digest stays Chinese without needing any translation service.
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = requestUrl(input);
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
    const url = requestUrl(input);
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
    const url = requestUrl(input);
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
    const url = requestUrl(input);
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

// 10. A thin daily report must be topped up from the pool. On 2026-09-28 the
//     report held a single section with two items and the digest sent just those
//     two; the pool fill had been dropped during the v1 migration.
{
  const realFetch = globalThis.fetch;
  const dailyItem = (n) => ({
    title: `薄日报条目 ${n}`,
    summary: `摘要 ${n}`,
    source: { name: "测试源" },
    links: { aihot: `https://aihot.news/items/thin-${n}`, original: `https://example.com/thin-${n}` }
  });
  globalThis.fetch = async (input, init) => {
    const url = requestUrl(input);
    if (url.includes("/api/v1/dailies/")) {
      const report = {
        date: beijingDate(),
        generatedAt: new Date().toISOString(),
        windowStart: new Date(Date.now() - 86400000).toISOString(),
        windowEnd: new Date().toISOString(),
        links: { aihot: "https://aihot.news/daily/thin" },
        lead: null,
        sections: [{ label: "行业动态", items: [dailyItem(1), dailyItem(2)] }],
        flashes: []
      };
      return new Response(JSON.stringify({ schemaVersion: 1, report }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return realFetch(input, init);
  };
  try {
    const { body } = await run({ ...baseEnv, DIGEST_DATE: beijingDate() });
    check("thin daily: filled up to the limit", body.count === 10, `count=${body.count}`);
    check("thin daily: still the curated report", body.source === "aihot-daily", `source=${body.source}`);
    check("thin daily: the report's own items come first", body.itemTitles[0] === "薄日报条目 1", body.itemTitles[0]);
    check("thin daily: no fallback note", !cardLines(body.feishu.payload).some((line) => line.includes("尚未发布")));
  } finally {
    globalThis.fetch = realFetch;
  }
}

// ---------------------------------------------------------------------------
// 竞品流水线（/run?job=competitor）——全部 dry 或桩定 webhook，绝不碰真实群。
// ---------------------------------------------------------------------------

function memoryKV() {
  const store = new Map();
  return {
    store,
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, String(value));
    }
  };
}

function rssChannel(items) {
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>stub</title>${items.join("")}</channel></rss>`;
}

function rssItem({ title, media, url, snippet = "", ageHours = 2 }) {
  return `<item><title>${title}</title><link>${url}</link>`
    + `<guid isPermaLink="false">${url}</guid>`
    + `<pubDate>${new Date(Date.now() - ageHours * 3600000).toUTCString()}</pubDate>`
    + `<description>&lt;p&gt;${snippet}&lt;/p&gt;</description>`
    + `<source url="https://media.example.com/">${media}</source></item>`;
}

// 极简 LLM 桩：标题含公司名则 keep 并回摘要，否则判不相关；行业模式全收。
function llmStubResponse(input, init) {
  const body = JSON.parse(String(init?.body || "{}"));
  const user = body.messages ? body.messages[body.messages.length - 1].content : "";
  const results = [];
  const names = ["钧控", "灵手", "大医匠", "暖小贝", "力驰", "具身风暴", "德壹", "易启未来", "如身机器人", "荣泰健康", "奥佳华", "Aescape", "AiTreat", "Capsix Robotics", "Phybot", "Massage Robotics"];
  const industryMode = user.includes("AI 按摩/理疗机器人行业");
  const re = /"i":(\d+),"title":"((?:[^"\\]|\\.)*)"/g;
  let match;
  while ((match = re.exec(user))) {
    const i = Number(match[1]);
    const title = match[2].replace(/\\"/g, '"');
    const company = names.find((name) => title.includes(name));
    // 模拟真模型的判断：含公司名但讲的是别的事（物流等）判为不相关。
    const sameNameNoise = /物流/.test(title);
    if (industryMode || (company && !sameNameNoise)) {
      // 全档位都回传新玩家线索，模拟真实的提取输出。
      const clue = { companies: industryMode ? ["星尘康养机器人"] : ["某新玩家机器人"] };
      results.push({ i, keep: true, company: company || "", summary: `${company || "行业"}新闻摘要${i}`, ...clue });
    } else {
      results.push({ i, keep: false, company: "", summary: "" });
    }
  }
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify({ results }) } }] }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

// 搜索桩：按 q 参数里的片段返回条目；未命中返回空 RSS；allorigins 代理请求
// 会解出内层 URL 再匹配（模拟代理转发）；engine 可以为同一故事返回不同 URL。
function searchStub({ google = {}, bing = {} } = {}) {
  return async (input) => {
    let url = requestUrl(input);
    if (url.includes("allorigins")) {
      url = new URL(url).searchParams.get("url") || "";
    }
    if (!url.includes("news.google.com") && !url.includes("bing.com")) {
      throw new Error(`competitor test got unexpected request: ${url}`);
    }
    const isBing = url.includes("bing.com");
    const handlers = isBing ? bing : google;
    const q = new URL(url).searchParams.get("q") || "";
    for (const [fragment, items] of Object.entries(handlers)) {
      if (q.includes(fragment)) {
        return new Response(rssChannel(items), { status: 200, headers: { "content-type": "application/xml" } });
      }
    }
    return new Response(rssChannel([]), { status: 200, headers: { "content-type": "application/xml" } });
  };
}

const deyeeItem = (url) => rssItem({
  title: "德壹发布新一代理疗机器人",
  media: "网易新闻",
  url,
  snippet: "德壹医疗在深圳发布新一代具身智能理疗机器人。",
  ageHours: 2
});
const lichiNoiseItem = () => rssItem({
  title: "力驰物流开通东南亚新航线",
  media: "澎湃新闻",
  url: "https://example.com/lichi-logistics",
  snippet: "力驰物流宣布开通东南亚新航线。",
  ageHours: 3
});

// 11. 正常路径：公司档命中，LLM 过滤掉同名无关新闻，卡片带出处与摘要。
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = requestUrl(input);
    if (url.includes("open.bigmodel.cn")) return llmStubResponse(input, init);
    if (url.includes("news.google.com")) {
      const q = new URL(url).searchParams.get("q") || "";
      const items = [];
      if (q.includes("德壹")) items.push(deyeeItem("https://example.com/deyee-1"));
      if (q.includes("力驰")) items.push(lichiNoiseItem());
      return new Response(rssChannel(items), { status: 200, headers: { "content-type": "application/xml" } });
    }
    if (url.includes("bing.com")) {
      const q = new URL(url).searchParams.get("q") || "";
      // 同一故事、不同 URL：跨引擎去重必须合成一条。
      const items = q.includes("德壹") ? [deyeeItem("https://example.com/deyee-1-bing")] : [];
      return new Response(rssChannel(items), { status: 200, headers: { "content-type": "application/xml" } });
    }
    return realFetch(input, init);
  };
  try {
    const kv = memoryKV();
    const { status, body } = await run({ ...baseEnv, ZHIPU_API_KEY: "test-key", COMPETITOR_STATE: kv }, "?job=competitor&dry=1");
    check("competitor: HTTP 200", status === 200, `status=${status}`);
    check("competitor: job marked", body.job === "competitor", JSON.stringify(body).slice(0, 120));
    check("competitor: hits companies tier", body.tier === "companies", `tier=${body.tier}`);
    check("competitor: noise filtered by LLM", body.count === 1, `count=${body.count}`);
    check("competitor: grouped under 德壹", body.groups[0] && body.groups[0].company === "德壹", JSON.stringify(body.groups));
    check("competitor: indigo card", body.feishu.payload.card.header.template === "indigo");
    const lines = cardLines(body.feishu.payload);
    check("competitor: card carries article link", lines.some((line) => line.includes("](https://example.com/deyee-1)")), JSON.stringify(lines));
    check("competitor: card carries source media", lines.some((line) => line.includes("网易新闻")));
    check("competitor: card carries LLM summary", lines.some((line) => line.includes("新闻摘要")));
    check("competitor: new-player clue shown in company tier", lines.some((line) => line.includes("新玩家线索：某新玩家机器人")));
    check("competitor: no degrade note", !lines.some((line) => line.includes("LLM 过滤不可用")));
    check("competitor: payload signed", typeof body.feishu.payload.sign === "string" && body.feishu.payload.sign.length > 0);
    check("competitor: dry-run leaves KV untouched", kv.store.size === 0, `kv=${kv.store.size}`);
  } finally {
    globalThis.fetch = realFetch;
  }
}

// 12. LLM 挂掉：退回关键词过滤，尾注自报家门，条目不丢。
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = requestUrl(input);
    if (url.includes("open.bigmodel.cn")) return new Response("boom", { status: 500 });
    if (url.includes("news.google.com")) {
      const q = new URL(url).searchParams.get("q") || "";
      const items = [];
      if (q.includes("德壹")) items.push(deyeeItem("https://example.com/deyee-1"));
      if (q.includes("力驰")) items.push(lichiNoiseItem());
      return new Response(rssChannel(items), { status: 200, headers: { "content-type": "application/xml" } });
    }
    return new Response(rssChannel([]), { status: 200, headers: { "content-type": "application/xml" } });
  };
  try {
    const { body } = await run({ ...baseEnv, ZHIPU_API_KEY: "test-key" }, "?job=competitor&dry=1");
    check("llm down: falls back to companies tier", body.tier === "companies", `tier=${body.tier}`);
    check("llm down: keyword mode keeps both items", body.count === 2, `count=${body.count}`);
    check("llm down: card notes the fallback", cardLines(body.feishu.payload).some((line) => line.includes("LLM 过滤不可用")));
    check("llm down: rss summary used as fallback text", cardLines(body.feishu.payload).some((line) => line.includes("德壹医疗在深圳")));
  } finally {
    globalThis.fetch = realFetch;
  }
}

// 13. 公司档全空：降级到国外竞品档。
{
  const realFetch = globalThis.fetch;
  const aescapeItem = () => rssItem({
    title: "Aescape expands robotic massage to Massage Envy",
    media: "TechCrunch",
    url: "https://example.com/aescape-1",
    snippet: "Aescape announced a national rollout of its robotic massage tables.",
    ageHours: 3
  });
  globalThis.fetch = async (input, init) => {
    const url = requestUrl(input);
    if (url.includes("open.bigmodel.cn")) return llmStubResponse(input, init);
    return searchStub({ google: { Aescape: [aescapeItem()] } })(input);
  };
  try {
    const { body } = await run({ ...baseEnv, ZHIPU_API_KEY: "test-key" }, "?job=competitor&dry=1");
    check("foreign: downgrades to foreign tier", body.tier === "foreign", `tier=${body.tier}`);
    check("foreign: card notes the downgrade", cardLines(body.feishu.payload).some((line) => line.includes("国外同类竞品")));
    check("foreign: grouped under Aescape", body.groups[0] && body.groups[0].company === "Aescape", JSON.stringify(body.groups));
  } finally {
    globalThis.fetch = realFetch;
  }
}

// 14. 公司档和国外档都空：行业档兜底。
{
  const realFetch = globalThis.fetch;
  const industryItem = () => rssItem({
    title: "按摩机器人迎来政策利好",
    media: "36氪",
    url: "https://example.com/industry-1",
    snippet: "多地出台政策支持康养机器人产业发展。",
    ageHours: 5
  });
  globalThis.fetch = async (input, init) => {
    const url = requestUrl(input);
    if (url.includes("open.bigmodel.cn")) return llmStubResponse(input, init);
    return searchStub({ google: { 按摩机器人: [industryItem()] } })(input);
  };
  try {
    const { body } = await run({ ...baseEnv, ZHIPU_API_KEY: "test-key" }, "?job=competitor&dry=1");
    check("industry: downgrades to industry tier", body.tier === "industry", `tier=${body.tier}`);
    check("industry: card notes the downgrade", cardLines(body.feishu.payload).some((line) => line.includes("行业报道")));
    check("industry: grouped under industry", body.groups[0] && body.groups[0].company === "AI 按摩机器人行业", JSON.stringify(body.groups));
    check("industry: new-player clue shown", cardLines(body.feishu.payload).some((line) => line.includes("新玩家线索：星尘康养机器人")), JSON.stringify(cardLines(body.feishu.payload)));
  } finally {
    globalThis.fetch = realFetch;
  }
}

// 15. 三档全空：灰色「今日无更新」卡片，绝不静默。
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = searchStub();
  try {
    const { status, body } = await run({ ...baseEnv, ZHIPU_API_KEY: "test-key" }, "?job=competitor&dry=1");
    check("all empty: ok with zero items", status === 200 && body.ok === true && body.count === 0, `ok=${body.ok} count=${body.count}`);
    check("all empty: none tier", body.tier === "none", `tier=${body.tier}`);
    check("all empty: grey notice card", body.feishu.payload.card.header.template === "grey");
    check("all empty: notice explains itself", cardLines(body.feishu.payload).some((line) => line.includes("未搜到相关新闻")));
  } finally {
    globalThis.fetch = realFetch;
  }
}

// 16. 搜索源全挂（直连和代理都 503）：橙色告警卡片，ok=false。
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = requestUrl(input);
    if (url.includes("news.google.com") || url.includes("bing.com") || url.includes("allorigins")) {
      return new Response("down", { status: 503 });
    }
    throw new Error(`competitor test got unexpected request: ${url}`);
  };
  try {
    const { status, body } = await run({ ...baseEnv, ZHIPU_API_KEY: "test-key" }, "?job=competitor&dry=1");
    check("engines down: reports failure", status === 200 && body.ok === false, `ok=${body.ok}`);
    check("engines down: orange notice card", body.feishu.payload.card.header.template === "orange");
    check("engines down: notice explains itself", cardLines(body.feishu.payload).some((line) => line.includes("搜索源暂时全部不可用")));
  } finally {
    globalThis.fetch = realFetch;
  }
}

// 17. 直连被 Google 503 封锁：抖动重试后熔断，走 allorigins 代理救回条目。
{
  const realFetch = globalThis.fetch;
  let googleDirectCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = requestUrl(input);
    if (url.includes("open.bigmodel.cn")) return llmStubResponse(input, init);
    if (url.includes("allorigins")) {
      const inner = new URL(url).searchParams.get("url") || "";
      const q = new URL(inner).searchParams.get("q") || "";
      const items = q.includes("德壹") ? [deyeeItem("https://example.com/deyee-proxy")] : [];
      return new Response(rssChannel(items), { status: 200, headers: { "content-type": "application/xml" } });
    }
    if (url.includes("news.google.com")) {
      googleDirectCalls += 1;
      return new Response("blocked", { status: 503 });
    }
    if (url.includes("bing.com")) return new Response(rssChannel([]), { status: 200, headers: { "content-type": "application/xml" } });
    return realFetch(input, init);
  };
  try {
    const { body } = await run({ ...baseEnv, ZHIPU_API_KEY: "test-key" }, "?job=competitor&dry=1");
    check("proxy fallback: rescued via allorigins", body.tier === "companies" && body.count === 1, `tier=${body.tier} count=${body.count}`);
    check("proxy fallback: grouped under 德壹", body.groups[0] && body.groups[0].company === "德壹", JSON.stringify(body.groups));
    check("proxy fallback: direct was tried before breaker", googleDirectCalls >= 2, `googleDirectCalls=${googleDirectCalls}`);
  } finally {
    globalThis.fetch = realFetch;
  }
}

// 17. 真实推送（dry=0，webhook 已桩定）：推送成功后写入 KV，第二天同文不再推。
{
  const realFetch = globalThis.fetch;
  const kv = memoryKV();
  globalThis.fetch = async (input, init) => {
    const url = requestUrl(input);
    if (url.includes("open.feishu.cn")) {
      return new Response(JSON.stringify({ code: 0 }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("open.bigmodel.cn")) return llmStubResponse(input, init);
    if (url.includes("news.google.com") || url.includes("bing.com")) {
      return searchStub({ google: { 德壹: [deyeeItem("https://example.com/deyee-1")] } })(input);
    }
    throw new Error(`competitor test got unexpected request: ${url}`);
  };
  try {
    const { body } = await run(
      { ...baseEnv, WEIXIN_WEBHOOK: "", ZHIPU_API_KEY: "test-key", COMPETITOR_STATE: kv },
      "?job=competitor&dry=0"
    );
    check("kv: push delivered", body.feishu && body.feishu.ok === true, JSON.stringify(body.feishu).slice(0, 120));
    check("kv: seen marks written after push", kv.store.size === 1, `kv=${kv.store.size}`);
    const second = await run({ ...baseEnv, WEIXIN_WEBHOOK: "", ZHIPU_API_KEY: "test-key", COMPETITOR_STATE: kv }, "?job=competitor&dry=1");
    check("kv: seen item filtered on next run", second.body.tier === "none" && second.body.count === 0, `tier=${second.body.tier} count=${second.body.count}`);
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
