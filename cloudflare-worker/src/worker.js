const AIHOT_BASE_URL = "https://aihot.news";
const AIHOT_SELECTED_FEED_URL = "https://aihot.news/feed.xml";
const BAIDU_TRANSLATE_URL = "https://fanyi-api.baidu.com/api/trans/vip/translate";
const DEFAULT_LIMIT = 10;
const FALLBACK_WINDOW_HOURS = 24;
const SECTION_QUOTA = 2;
const SELECTED_POOL_LIMIT = 100;
const SELECTED_SOURCE_CAP = 3;
const AIHOT_TIMEOUT_MS = 20000;
const WEBHOOK_ATTEMPTS = 3;

// Shown in the card footer when the curated daily report was not available, so a
// degraded digest is never mistaken for the normal one.
const SOURCE_NOTES = {
  "aihot-daily": "",
  "aihot-selected": "今日日报尚未发布，本条为 AIHOT 最近 24 小时内容",
  "aihot-feed": "AI HOT 接口不可用，本条为 AIHOT 精选 RSS（最近 50 条）",
  "rss-fallback": "AI HOT 暂时不可用，本条来自备用 RSS 源"
};

// ---------------------------------------------------------------------------
// 竞品情报速报（每天 08:30 北京时间，独立于上面的 AIHOT 日报）
//
// 名单来自《竞品运营策略分析》文档。queries 是 Google News / Bing News 的
// 搜索串；aliases 用于关键词预过滤（LLM 不可用时的兜底）。改名单只改这几张表。
// ---------------------------------------------------------------------------

const COMPETITOR_CRON = "30 0 * * *"; // 00:30 UTC = 08:30 北京
const COMPETITOR_TIMEOUT_MS = 15000;
const COMPETITOR_LLM_TIMEOUT_MS = 30000;
const COMPETITOR_LLM_CANDIDATE_CAP = 40;
// Workers 每个请求最多 6 条同时出站连接，超出的会排队并被超时器误杀；
// 每个查询内部 google+bing 并行占 2 条，所以并发池设 3，最多 6 条。
const COMPETITOR_QUERY_CONCURRENCY = 3;
// 搜索引擎用浏览器 UA（自报家门的 bot UA 更容易被 Google 503）；连续失败达到
// 阈值就熔断直连、走 allorigins 公共代理（代理用它自己的出口 IP，绕开封锁）。
const NEWS_BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const NEWS_PROXY_PREFIX = "https://api.allorigins.win/raw?url=";
const ENGINE_BREAKER_THRESHOLD = 3;
// DeepSeek Search 作为救援引擎：RSS 双引擎（含代理）失败或零结果时补搜一次。
// 0.005 元/次、无结果不计费；单次运行最多发 RESCUE_BUDGET 次，控制子请求与费用。
const DEEPSEEK_SEARCH_URL = "https://api.deepseek.com/v1/tools/search";
const DEEPSEEK_RESCUE_BUDGET = 12;
const COMPETITOR_PER_COMPANY_CAP = 3;
const COMPETITOR_SEEN_TTL_DAYS = 30;
const COMPETITOR_SEEN_KEY = "competitor:seen";
const ZHIPU_CHAT_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
const DEFAULT_ZHIPU_MODEL = "glm-4.7-flash";
// 主模型限流（1305 访问量过大）时的免费备胎，按顺序尝试。
const ZHIPU_FALLBACK_MODELS = ["glm-4-flash"];
const COMPETITOR_LIMIT_FALLBACK = 10;
const COMPETITOR_WINDOW_HOURS_FALLBACK = 24;
// 公司/国外条目不足 5 条时，用行业新闻补位到 5 条；新闻充足时不补位，总量上限 COMPETITOR_LIMIT。
const COMPETITOR_FILL_TARGET = 5;

const COMPANIES = [
  {
    name: "钧控",
    desc: "上海钧控机器人/浙江钧控智能科技，AI 中医理疗按摩机器人",
    aliases: ["钧控", "junctrl"],
    queries: ['"钧控"']
  },
  {
    name: "灵手",
    desc: "深圳市灵手科技，3D 视觉理疗按摩机器人",
    aliases: ["灵手", "lscure"],
    queries: ['"灵手" ("机器人" OR "理疗" OR "按摩" OR "艾灸" OR "科技")']
  },
  {
    name: "大医匠",
    desc: "深圳市大医匠科技，艾灸理疗机器人",
    aliases: ["大医匠"],
    queries: ['"大医匠"']
  },
  {
    name: "暖小贝",
    desc: "暖小贝（武汉海象智康/海沁医疗），共享按摩理疗机器人门店",
    aliases: ["暖小贝", "海沁医疗"],
    queries: ['"暖小贝" OR "海沁医疗"']
  },
  {
    name: "力驰",
    desc: "深圳力驰传感技术，按摩理疗机器人与六维力传感器",
    aliases: ["力驰", "力驰传感"],
    queries: ['"力驰" ("机器人" OR "理疗" OR "按摩" OR "推拿" OR "传感")']
  },
  {
    name: "具身风暴",
    desc: "广东具身风暴机器人，具身智能按摩理疗机器人",
    aliases: ["具身风暴", "俏妃AI云智护", "robotstorm"],
    queries: ['"具身风暴" OR "俏妃AI云智护"']
  },
  {
    name: "德壹",
    desc: "深圳市德壹医疗科技，具身智能按摩理疗机器人",
    aliases: ["德壹", "deyeemed"],
    queries: ['"德壹" ("机器人" OR "按摩" OR "理疗" OR "艾灸" OR "医疗")']
  },
  // ↓ 2026-11-07 市面调研补充的文档外玩家（公开报道核实）
  {
    name: "易启未来",
    desc: "杭州易启未来智能科技（网易伏羲孵化），R1 智能按摩机器人，自营门店「易轻松」",
    aliases: ["易启未来", "易轻松"],
    queries: ['"易启未来" OR "易轻松"']
  },
  {
    name: "如身机器人",
    desc: "上海如身机器人，「修身」多合一理疗按摩机器人（无烟艾灸+电磁热疗），康养机构投放",
    aliases: ["如身机器人", "如身科技"],
    queries: ['"如身机器人" OR "如身科技"']
  },
  {
    name: "荣泰健康",
    desc: "荣泰健康（按摩椅龙头），RT9000 AI 按摩机器人与具身智能动向；纯财报股价类不算",
    aliases: ["荣泰健康", "RT9000"],
    queries: ['"荣泰健康" ("按摩机器人" OR "理疗" OR "具身智能" OR "RT9000")']
  },
  {
    name: "奥佳华",
    desc: "奥佳华 OGAWA（按摩椅龙头），OG9598/OG8598X AI 按摩机器人产品线；纯财报股价类不算",
    aliases: ["奥佳华", "OG9598", "OG8598"],
    queries: ['"奥佳华" ("按摩机器人" OR "AI按摩" OR "OG9598" OR "OG8598")']
  }
];

// 国外同类竞品：只在公司档当天没有新消息时才查。搜索不限语言，
// 中文媒体对它们的报道同样会被收进来。
const FOREIGN_COMPANIES = [
  {
    name: "Aescape",
    desc: "美国纽约，AI 按摩机器人桌，已进驻 Massage Envy/Equinox",
    aliases: ["aescape"],
    queries: ['Aescape ("massage" OR "robot" OR "robotic")']
  },
  {
    name: "AiTreat",
    desc: "新加坡，EMMA 中医推拿机器人",
    aliases: ["aitreat"],
    queries: ['AiTreat ("massage" OR "robot" OR "EMMA")']
  },
  {
    name: "Capsix Robotics",
    desc: "意大利，iYU 机械臂按摩机器人（KUKA LBR Med）",
    aliases: ["capsix", "iyu"],
    queries: ['"Capsix Robotics"', '"iYU" ("massage" OR "robot")']
  },
  {
    name: "Phybot",
    desc: "以色列 Phybotics，LACO 机械臂按摩机器人",
    aliases: ["phybot"],
    queries: ['Phybot']
  },
  {
    name: "Massage Robotics",
    desc: "美国，自主按摩机器人",
    aliases: ["massage robotics"],
    queries: ['"Massage Robotics" ("robot" OR "massage")']
  }
];

const INDUSTRY_GROUP = "AI 按摩机器人行业";
// 新玩家线索要过滤掉名单内的公司，只标真正的名单外玩家。
const KNOWN_COMPETITOR_NAMES = [...COMPANIES, ...FOREIGN_COMPANIES].map((company) => company.name.toLowerCase());
const INDUSTRY_QUERIES = [
  '"按摩机器人" OR "理疗机器人"',
  '"艾灸机器人" OR "推拿机器人"',
  '具身智能 ("按摩" OR "理疗" OR "康养" OR "养老")',
  '"massage robot" OR "massage robotics"'
];
const INDUSTRY_FILTER_KEYWORDS = ["按摩", "理疗", "艾灸", "推拿", "刮痧", "康养", "养生", "spa"];

const FALLBACK_FEEDS = [
  ["OpenAI", "https://openai.com/blog/rss.xml"],
  ["Hugging Face", "https://huggingface.co/blog/feed.xml"],
  ["AWS ML Blog", "https://aws.amazon.com/blogs/machine-learning/feed/"],
  ["Google AI", "https://blog.google/technology/ai/rss/"],
  ["NVIDIA Dev Blog", "https://developer.nvidia.com/blog/feed/"],
  ["TensorFlow", "https://blog.tensorflow.org/feeds/posts/default?alt=rss"],
  ["arXiv cs.AI", "https://export.arxiv.org/rss/cs.AI"],
  ["arXiv cs.LG", "https://export.arxiv.org/rss/cs.LG"],
  ["The Verge", "https://www.theverge.com/rss/index.xml"],
  ["TechCrunch", "https://techcrunch.com/feed/"],
  ["WIRED", "https://www.wired.com/feed/rss"],
  ["Ars Technica", "https://feeds.arstechnica.com/arstechnica/index"],
  ["MIT Technology Review", "https://www.technologyreview.com/feed/"]
];

const FALLBACK_KEYWORDS = [
  "ai",
  "a.i.",
  "artificial intelligence",
  "llm",
  "large language model",
  "gpt",
  "claude",
  "gemini",
  "deepseek",
  "qwen",
  "llama",
  "rag",
  "agent",
  "agents",
  "embedding",
  "fine-tune",
  "finetune",
  "lora",
  "diffusion",
  "transformer",
  "multimodal",
  "inference",
  "benchmark",
  "eval",
  "大模型",
  "模型",
  "推理",
  "训练",
  "微调",
  "智能体"
];

const PRIORITY_KEYWORDS = [
  ["具身智能", 80],
  ["具身ai", 80],
  ["具身 ai", 80],
  ["具身", 45],
  ["人形机器人", 70],
  ["机器人控制", 75],
  ["机器人任务", 70],
  ["机器人本体", 70],
  ["机械臂", 80],
  ["灵巧手", 70],
  ["视频动作", 45],
  ["动作基础模型", 55],
  ["物理智能", 50],
  ["空间智能", 45],
  ["ai 毛绒", 85],
  ["ai毛绒", 85],
  ["毛绒", 60],
  ["ai 玩具", 75],
  ["ai玩具", 75],
  ["陪伴机器人", 75],
  ["陪伴硬件", 75],
  ["语音对话", 80],
  ["实时语音", 75],
  ["语音助手", 65],
  ["语音模型", 65],
  ["对话模型", 55],
  ["大模型", 65],
  ["模型发布", 60],
  ["开源模型", 60],
  ["基础模型", 55],
  ["llm", 65],
  ["large language model", 65],
  ["gpt", 55],
  ["claude", 55],
  ["gemini", 55],
  ["qwen", 55],
  ["deepseek", 55],
  ["llama", 55],
  ["robotics", 70],
  ["robot control", 70],
  ["humanoid", 70],
  ["embodied", 80],
  ["manipulation", 50],
  ["plush", 85],
  ["ai toy", 65],
  ["companion ai", 65],
  ["voice assistant", 65],
  ["voice model", 65],
  ["speech", 45],
  ["video-action", 55],
  ["robbyant", 80],
  ["lingbot", 80],
  ["behavior", 45]
];

export default {
  async scheduled(event, env, ctx) {
    // Two cron pipelines coexist, each with its own code path so neither can
    // break the other: 01:20 UTC (09:20 Beijing) runs the AIHOT digest, and
    // 00:30 UTC (08:30 Beijing) runs the competitor report.
    const dryRun = isTruthy(env.DRY_RUN);
    if (event.cron === COMPETITOR_CRON) {
      // 崩溃防护：流水线若抛异常，给群里发一张橙色错误卡，绝不静默。
      // （2026-11-08 08:30 曾发生 scriptThrewException 且无任何提示。）
      ctx.waitUntil(
        runCompetitorDigest(env, { trigger: "scheduled", cron: event.cron }, { dryRun }).catch(async (error) => {
          console.error(`competitor digest crashed: ${error instanceof Error && error.stack ? error.stack : errorMessage(error)}`);
          if (dryRun) return;
          try {
            const title = `竞品情报速报异常（${todayInBeijing()}）`;
            const payload = buildCompetitorNoticePayload(
              title,
              `流水线执行中断：${shorten(errorMessage(error), 150)}。可手动排查：/run?job=competitor&dry=1`,
              "orange"
            );
            if (env.FEISHU_WEBHOOK_URL) await sendFeishu(env, payload);
          } catch (noticeError) {
            console.error(`competitor crash notice failed: ${errorMessage(noticeError)}`);
          }
        })
      );
      return;
    }
    ctx.waitUntil(
      runDigest(env, { trigger: "scheduled", cron: event.cron }, { dryRun })
    );
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return jsonResponse({ ok: true, service: "ai-feishu-digest-worker" });
    }

    if (url.pathname === "/run") {
      const expected = (env.CRON_SECRET || "").trim();
      if (expected) {
        const got = request.headers.get("authorization") || "";
        if (got !== `Bearer ${expected}`) {
          return jsonResponse({ ok: false, error: "unauthorized" }, 401);
        }
      }

      // dry=1 builds the full message and returns it without calling any webhook.
      // job=competitor runs the 08:30 report instead of the AIHOT digest.
      // window=N overrides the competitor freshness window (hours) for manual catch-up pushes.
      const dryRun = isTruthy(url.searchParams.get("dry")) || isTruthy(env.DRY_RUN);
      const job = url.searchParams.get("job") || "digest";
      const windowOverride = url.searchParams.get("window");
      try {
        const result = job === "competitor"
          ? await runCompetitorDigest(env, { trigger: "manual" }, { dryRun, windowHours: windowOverride })
          : await runDigest(env, { trigger: "manual" }, { dryRun });
        return jsonResponse(result);
      } catch (error) {
        return jsonResponse({ ok: false, error: errorMessage(error) }, 500);
      }
    }

    return jsonResponse({ ok: true, endpoints: ["/health", "/run", "/run?dry=1", "/run?job=competitor&dry=1"] });
  }
};

async function runDigest(env, meta = {}, options = {}) {
  const dryRun = Boolean(options.dryRun);
  const limit = clampInt(env.DIGEST_LIMIT, 1, 10, DEFAULT_LIMIT);
  const { date, items, source, fallbackReason } = await fetchDigestWithFallback(env, limit);
  const title = `智能前沿日报（${date || todayInBeijing()}）`;

  // Every source failed. Say so rather than going silent, so a missing digest is
  // never mistaken for "there was no news today".
  if (!items.length) {
    const notice = "所有数据源都不可用，今天没能生成日报。";
    console.error(`digest unavailable: ${fallbackReason}`);
    const feishuPayload = env.FEISHU_WEBHOOK_URL ? buildFeishuNoticePayload(title, notice) : null;
    const weixinPayloads = env.WEIXIN_WEBHOOK ? [{ msgtype: "text", text: { content: `${title}\n${notice}` } }] : null;

    if (dryRun) {
      if (feishuPayload) await signFeishu(env, feishuPayload);
      return {
        ok: false,
        dryRun: true,
        reason: "no items",
        source,
        fallbackReason,
        title,
        count: 0,
        feishu: feishuPayload ? { skipped: false, dryRun: true, payload: feishuPayload } : { skipped: true },
        weixin: weixinPayloads ? { skipped: false, dryRun: true, payloads: weixinPayloads } : { skipped: true }
      };
    }

    const feishu = feishuPayload ? await sendFeishu(env, feishuPayload) : { skipped: true };
    const weixin = weixinPayloads ? await sendWeixin(env, weixinPayloads) : { skipped: true };
    return { ok: false, reason: "no items", source, fallbackReason, title, count: 0, feishu, weixin };
  }

  const note = SOURCE_NOTES[source] || "";

  const feishuPayload = env.FEISHU_WEBHOOK_URL ? buildFeishuPayload(title, items, note) : null;
  const weixinPayloads = env.WEIXIN_WEBHOOK ? buildWeixinPayloads(items, note) : null;

  const itemTitles = items.map((item) => item.title);
  const summary = {
    ok: true,
    trigger: meta.trigger || "unknown",
    cron: meta.cron || null,
    source,
    fallbackReason,
    title,
    date,
    count: items.length,
    itemTitles
  };
  console.log(JSON.stringify({ source, fallbackReason, title, date, count: items.length, titles: itemTitles }));

  if (dryRun) {
    // Sign it too, so the returned payload is exactly what production would post.
    if (feishuPayload) await signFeishu(env, feishuPayload);
    return {
      ...summary,
      dryRun: true,
      feishu: feishuPayload
        ? { skipped: false, dryRun: true, payload: feishuPayload }
        : { skipped: true },
      weixin: weixinPayloads
        ? { skipped: false, dryRun: true, payloads: weixinPayloads }
        : { skipped: true }
    };
  }

  const feishuResult = feishuPayload ? await sendFeishu(env, feishuPayload) : { skipped: true };
  const weixinResult = weixinPayloads ? await sendWeixin(env, weixinPayloads) : { skipped: true };

  return { ...summary, feishu: feishuResult, weixin: weixinResult };
}

// The curated daily report is the intended source, but AIHOT publishes it around
// 08:00 Beijing and it can run late. Every step below stays Chinese, so a late
// publish degrades the digest instead of turning it English.
async function fetchDigestWithFallback(env, limit) {
  const requestedDate = env.DIGEST_DATE || todayInBeijing();
  const reasons = [];

  const daily = await tryFetchDaily(env, requestedDate, limit, reasons);
  if (daily) return { ...daily, fallbackReason: "" };

  // The report may have landed while the first request was in flight.
  const latest = await tryFetchDaily(env, null, limit, reasons);
  if (latest && latest.date === requestedDate) return { ...latest, fallbackReason: reasons.join("; ") };

  const pool = await tryFetchSelectedPool(env, limit, reasons);
  if (pool) return { ...pool, fallbackReason: reasons.join("; ") };

  // AI HOT's own RSS feed is Chinese and needs no translation, so it beats the
  // English third-party feeds even when the API itself is unusable.
  const feed = await tryFetchAihotFeed(env, limit, reasons);
  if (feed) return { ...feed, fallbackReason: reasons.join("; ") };

  const items = await fetchFallbackDigest(env, limit);
  return {
    date: requestedDate,
    items,
    source: "rss-fallback",
    fallbackReason: reasons.join("; ")
  };
}

async function tryFetchDaily(env, date, limit, reasons) {
  const label = date || "latest";
  try {
    const report = await fetchDailyReport(env, date);
    const buckets = sectionBuckets(report);
    let items = selectSectionBalanced(buckets, [], limit);
    if (items.length && items.length < limit) {
      // A thin report is topped up from the wider pool rather than sending the
      // user two items on a slow news day.
      try {
        items = selectSectionBalanced(buckets, await fetchPool(env, "all"), limit);
      } catch (error) {
        reasons.push(`AI HOT pool fill failed: ${errorMessage(error)}`);
      }
    }
    if (!items.length) {
      reasons.push(`AI HOT daily ${label} has no usable items`);
      return null;
    }
    return { date: report.date || date || todayInBeijing(), items, source: "aihot-daily" };
  } catch (error) {
    reasons.push(`AI HOT daily ${label} failed: ${errorMessage(error)}`);
    return null;
  }
}

async function fetchPool(env, mode) {
  const payload = await requestAihot(env, "/api/v1/items", {
    mode,
    window: "24h",
    limit: String(SELECTED_POOL_LIMIT)
  });
  return (payload.items || [])
    .map(selectedPoolItem)
    .filter((item) => item.title && item.url);
}

async function tryFetchSelectedPool(env, limit, reasons) {
  try {
    const selected = rankSelectedPool(await fetchPool(env, "selected"), limit);
    // The curated pool is often thin (three items on 2026-09-28), so it is topped
    // up from the wider pool instead of sending a three-item digest.
    const items = selected.length && selected.length < limit
      ? topUpFromPool(selected, await fetchPool(env, "all"), limit)
      : selected;
    if (!items.length) {
      reasons.push("AI HOT selected pool has no usable items");
      return null;
    }
    return { date: todayInBeijing(), items, source: "aihot-selected" };
  } catch (error) {
    reasons.push(`AI HOT selected pool failed: ${errorMessage(error)}`);
    return null;
  }
}

// Appends pool items that are not already covered, preferring a spread of sources
// and falling back to an uncapped pass when the cap cannot fill the digest.
function topUpFromPool(chosen, pool, limit) {
  const out = [...chosen];
  const counts = new Map();
  for (const item of out) counts.set(item.sourceName, (counts.get(item.sourceName) || 0) + 1);

  const ranked = [...pool].sort((a, b) => comparePublic(b, a));
  const add = (item, applyCap) => {
    if (out.length >= limit) return;
    if (out.some((old) => looksLikeSameStory(item, old))) return;
    const count = counts.get(item.sourceName) || 0;
    if (applyCap && count >= SELECTED_SOURCE_CAP) return;
    counts.set(item.sourceName, count + 1);
    out.push(item);
  };

  for (const item of ranked) add(item, true);
  for (const item of ranked) add(item, false);
  return out;
}

// AI HOT's own RSS feed: Chinese titles and summaries, so it needs no translation.
async function tryFetchAihotFeed(env, limit, reasons) {
  try {
    const response = await fetchWithTimeout(AIHOT_SELECTED_FEED_URL, {
      headers: {
        "accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
        "user-agent": env.AIHOT_USER_AGENT || "ai-feishu-digest-worker/0.1"
      }
    }, AIHOT_TIMEOUT_MS);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const xml = await response.text();
    const candidates = parseFeedXml(xml, "AIHOT 精选")
      .map((item) => ({
        ...item,
        summary: aihotFeedSummary(item.summary),
        sourceName: aihotFeedSource(item.author) || "AIHOT 精选",
        category: "",
        sectionLabel: "AIHOT 精选",
        curated: true
      }))
      .filter((item) => item.title && item.url);

    const items = rankSelectedPool(candidates, limit);
    if (!items.length) {
      reasons.push("AI HOT feed has no usable items");
      return null;
    }
    return { date: todayInBeijing(), items, source: "aihot-feed" };
  } catch (error) {
    reasons.push(`AI HOT feed failed: ${errorMessage(error)}`);
    return null;
  }
}

// Each feed summary ends with a "阅读原文" link and a "via AIHOT" credit.
function aihotFeedSummary(description) {
  const text = clean(description);
  for (const marker of ["🔗", "via AIHOT"]) {
    const cut = text.indexOf(marker);
    if (cut !== -1) return clean(text.slice(0, cut));
  }
  return text;
}

// <author>noreply@aihot.news (X：小米 MiMo (@XiaomiMiMo))</author>
function aihotFeedSource(author) {
  // The source name is the whole parenthetical, which may itself contain parentheses.
  const match = String(author || "").match(/\((.+)\)/);
  return match ? clean(match[1]) : "";
}

async function fetchDailyReport(env, date) {
  const path = date ? `/api/v1/dailies/${encodeURIComponent(date)}` : "/api/v1/dailies/latest";
  const payload = await requestAihot(env, path);
  const report = payload ? payload.report : null;
  if (!report || typeof report !== "object") {
    throw new Error(`AI HOT ${path} returned no report`);
  }
  return report;
}

function sectionBuckets(report) {
  const buckets = [];
  let dailyOrder = 0;
  for (const section of report.sections || []) {
    const label = String(section.label || "");
    const bucket = [];
    for (const raw of section.items || []) {
      const item = dailyItem(raw, label, dailyOrder++);
      if (item.title && item.url) bucket.push(item);
    }
    buckets.push(bucket);
  }
  return buckets;
}

async function requestAihot(env, path, params = {}) {
  const url = new URL(path, AIHOT_BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const response = await fetchWithTimeout(url, {
    headers: {
      "accept": "application/json",
      "user-agent": env.AIHOT_USER_AGENT || "ai-feishu-digest-worker/0.1"
    }
  }, AIHOT_TIMEOUT_MS);
  if (!response.ok) {
    throw new Error(`AI HOT ${path} failed: ${response.status}${await problemDetail(response)}`);
  }
  return response.json();
}

async function problemDetail(response) {
  const payload = await response.json().catch(() => null);
  const detail = payload ? clean(payload.detail || payload.title || payload.code) : "";
  return detail ? ` (${detail})` : "";
}

function linksOf(raw) {
  const links = raw && typeof raw.links === "object" && raw.links ? raw.links : {};
  return { original: clean(links.original), aihot: clean(links.aihot) };
}

function sourceNameOf(raw) {
  const source = raw && typeof raw.source === "object" && raw.source ? raw.source : {};
  return clean(source.name);
}

function dailyItem(raw, sectionLabel, dailyOrder) {
  const links = linksOf(raw);
  return {
    title: clean(raw.title),
    summary: clean(raw.summary),
    url: links.original || links.aihot,
    sourceName: sourceNameOf(raw),
    category: "",
    sectionLabel,
    score: null,
    publishedAt: null,
    curated: true,
    dailyOrder
  };
}

function selectedPoolItem(raw) {
  const links = linksOf(raw);
  return {
    title: clean(raw.title),
    summary: clean(raw.summary),
    url: links.original || links.aihot,
    sourceName: sourceNameOf(raw),
    category: clean(raw.category),
    sectionLabel: "",
    score: Number.isFinite(raw.score) ? raw.score : null,
    publishedAt: parseDate(raw.publishedAt),
    curated: Boolean(raw.selected),
    dailyOrder: 9999
  };
}

function rankSelectedPool(items, limit) {
  const deduped = new Map();
  for (const item of items) {
    const key = itemKey(item);
    const old = deduped.get(key);
    if (!old) {
      deduped.set(key, item);
      continue;
    }
    deduped.set(key, mergeItems(old, item));
  }

  const values = [...deduped.values()];
  const priority = values.filter(isPriority).sort((a, b) => comparePriority(b, a));
  const rest = values.filter((item) => !isPriority(item)).sort((a, b) => comparePublic(b, a));

  const selected = [];
  const counts = new Map();
  const add = (item) => {
    if (selected.some((old) => looksLikeSameStory(item, old))) return;
    const count = counts.get(item.sourceName) || 0;
    if (count >= SELECTED_SOURCE_CAP) return;
    counts.set(item.sourceName, count + 1);
    selected.push(item);
  };

  for (const item of [...priority, ...rest]) {
    add(item);
    if (selected.length >= limit) return selected;
  }

  // A per-source cap can starve the result on a narrow news day; fill the rest.
  for (const item of [...priority, ...rest]) {
    if (selected.length >= limit) break;
    if (selected.some((old) => looksLikeSameStory(item, old))) continue;
    selected.push(item);
  }
  return selected;
}

async function fetchFallbackDigest(env, limit) {
  const cutoff = Date.now() - FALLBACK_WINDOW_HOURS * 60 * 60 * 1000;
  const results = await Promise.allSettled(
    FALLBACK_FEEDS.map(([name, url]) => fetchFeedItems(env, name, url, cutoff))
  );

  const allItems = [];
  for (const result of results) {
    if (result.status === "fulfilled") allItems.push(...result.value);
  }
  const ranked = rankFallbackItems(allItems, limit);
  return translateFallbackItems(env, ranked);
}

async function fetchFeedItems(env, sourceName, url, cutoffMs) {
  const response = await fetchWithTimeout(url, {
    headers: {
      "accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      "user-agent": env.AIHOT_USER_AGENT || "ai-feishu-digest-worker/0.1"
    }
  }, 15000);
  if (!response.ok) throw new Error(`${sourceName} feed failed: ${response.status}`);

  const xml = await response.text();
  return parseFeedXml(xml, sourceName)
    .filter((item) => item.title && item.url && item.publishedAt && dateMs(item.publishedAt) >= cutoffMs)
    .map((item) => ({ ...item, curated: false, dailyOrder: 9999 }));
}

function isPrivateIpv4(host) {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  if (octets.some((value) => !Number.isInteger(value) || value > 255)) return false;
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateHost(host) {
  const name = String(host || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!name) return true;
  if (name === "localhost" || name.endsWith(".localhost")) return true;
  if ([".local", ".internal", ".home.arpa"].some((suffix) => name.endsWith(suffix))) return true;
  if (name.includes(":")) {
    if (name === "::" || name === "::1") return true;
    if (/^f[cd]/.test(name) || /^fe[89ab]/.test(name)) return true;
    const mapped = name.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateIpv4(mapped[1]) : false;
  }
  return isPrivateIpv4(name);
}

function assertPublicHttpUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported URL scheme: ${parsed.protocol}`);
  }
  if (isPrivateHost(parsed.hostname)) {
    throw new Error(`Refusing to request non-public host: ${parsed.hostname}`);
  }
  return parsed;
}

async function fetchWithTimeout(url, init, timeoutMs) {
  assertPublicHttpUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function parseFeedXml(xml, sourceName) {
  const blocks = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((match) => match[0]);
  if (!blocks.length) {
    blocks.push(...[...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((match) => match[0]));
  }

  return blocks.map((block) => {
    const atomLink = getXmlAttr(block, "link", "href");
    const title = xmlText(block, "title");
    const url = clean(atomLink || xmlText(block, "link") || xmlText(block, "guid"));
    const rawSummary = xmlText(block, "description") || xmlText(block, "summary") || xmlText(block, "content");
    const published = xmlText(block, "pubDate") || xmlText(block, "published") || xmlText(block, "updated");
    const summary = sourceName.toLowerCase().includes("arxiv")
      ? cleanArxivSummary(stripHtml(rawSummary))
      : stripHtml(rawSummary);
    return {
      title: stripHtml(title),
      summary,
      url,
      sourceName,
      // Google News 用 <source url="...">媒体名</source> 标注出处媒体，
      // Bing News 用 <News:Source>；竞品流水线用它们标出处。
      newsSource: xmlText(block, "source"),
      newsSourceUrl: getXmlAttr(block, "source", "url"),
      author: xmlText(block, "author"),
      category: "rss",
      sectionLabel: "备用来源",
      score: null,
      publishedAt: parseDate(published)
    };
  });
}

function rankFallbackItems(items, limit) {
  const deduped = new Map();
  for (const item of items) {
    const key = itemKey(item);
    if (!deduped.has(key)) deduped.set(key, item);
  }

  const counts = new Map();
  const ranked = [...deduped.values()]
    .map((item) => ({ item, score: fallbackScore(item) }))
    .sort((a, b) => b.score - a.score || dateMs(b.item.publishedAt) - dateMs(a.item.publishedAt));

  const selected = [];
  for (const { item, score } of ranked) {
    if (score <= 0) continue;
    if (!addFallbackItem(selected, counts, item, limit)) break;
  }
  if (selected.length < limit) {
    for (const { item, score } of ranked) {
      if (score > 0) continue;
      if (!addFallbackItem(selected, counts, item, limit)) break;
    }
  }
  return selected;
}

function addFallbackItem(selected, counts, item, limit) {
  if (selected.some((old) => looksLikeSameStory(item, old))) return true;
  const cap = item.sourceName.toLowerCase().includes("arxiv") ? 1 : 3;
  const count = counts.get(item.sourceName) || 0;
  if (count >= cap) return true;
  counts.set(item.sourceName, count + 1);
  selected.push(item);
  return selected.length < limit;
}

function fallbackScore(item) {
  const text = `${item.title}\n${item.summary}`.toLowerCase();
  let score = 0;
  for (const keyword of FALLBACK_KEYWORDS) {
    if (text.includes(keyword)) score += 1;
  }
  return score + Math.floor(priorityScore(item) / 100);
}

async function translateFallbackItems(env, items) {
  const appid = clean(env.BAIDU_FANYI_APPID || env.BAIDU_TRANSLATE_APPID || env.BAIDU_APPID);
  const key = clean(env.BAIDU_FANYI_KEY || env.BAIDU_TRANSLATE_KEY || env.BAIDU_APIKEY || env.BAIDU_API_KEY || env.BAIDU_KEY);
  if (!appid || !key || !items.length) {
    console.log("baidu translate skipped: credentials missing");
    return items;
  }

  const titleLines = items.map((item) => item.title);
  const summaryLines = items.map((item) => shorten(oneSentence(item.summary), 160));
  // The free Baidu tier allows roughly one request per second, so the two
  // batches go out one after the other rather than in parallel.
  const titlesZh = await baiduTranslateLines(titleLines, appid, key);
  const summariesZh = await baiduTranslateLines(summaryLines, appid, key);

  return items.map((item, index) => ({
    ...item,
    title: clean(titlesZh[index]) || item.title,
    summary: clean(summariesZh[index]) || item.summary
  }));
}

// Baidu answers with one result per non-empty line, so blank lines are left out
// of the request and answers are mapped back by index. A partial answer is used
// as-is instead of throwing away the whole batch.
async function baiduTranslateLines(lines, appid, key) {
  const targets = [];
  lines.forEach((line, index) => {
    const text = clean(line).replace(/\n/g, " ");
    if (text) targets.push({ index, text });
  });
  if (!targets.length) return lines;

  const q = targets.map((target) => target.text).join("\n");
  const salt = `${Date.now()}${Math.floor(Math.random() * 9000 + 1000)}`;
  const sign = md5(`${appid}${q}${salt}${key}`);
  const body = new URLSearchParams({
    q,
    from: "auto",
    to: "zh",
    appid,
    salt,
    sign
  });

  const response = await fetchWithTimeout(BAIDU_TRANSLATE_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  }, 20000);
  if (!response.ok) {
    console.error(`baidu translate HTTP ${response.status}`);
    return lines;
  }

  const payload = await response.json().catch(() => null);
  if (!payload || payload.error_code || !Array.isArray(payload.trans_result)) {
    console.error(`baidu translate rejected: ${JSON.stringify(payload || {}).slice(0, 300)}`);
    return lines;
  }

  const out = [...lines];
  payload.trans_result.forEach((entry, position) => {
    const target = targets[position];
    const translated = target ? clean(entry && entry.dst) : "";
    if (target && translated) out[target.index] = translated;
  });
  return out;
}

function selectSectionBalanced(sectionBuckets, publicFillers, limit) {
  const ranked = [];
  const seen = new Set();

  for (const bucket of sectionBuckets) {
    let picked = 0;
    for (const item of bucket) {
      const before = ranked.length;
      if (appendUnique(ranked, seen, item, limit)) return ranked;
      if (ranked.length > before) picked += 1;
      if (picked >= SECTION_QUOTA) break;
    }
  }

  while (ranked.length < limit) {
    let progressed = false;
    for (const bucket of sectionBuckets) {
      const before = ranked.length;
      for (const item of bucket) {
        if (appendUnique(ranked, seen, item, limit)) return ranked;
        if (ranked.length > before) {
          progressed = true;
          break;
        }
      }
    }
    if (!progressed) break;
  }

  const publicRanked = [...publicFillers].sort((a, b) => comparePublic(b, a));
  for (const item of publicRanked) {
    if (appendUnique(ranked, seen, item, limit)) return ranked;
  }
  return ranked;
}

function appendUnique(ranked, seen, item, limit) {
  const key = itemKey(item);
  if (seen.has(key) || ranked.some((old) => looksLikeSameStory(item, old))) return false;
  seen.add(key);
  ranked.push(item);
  return ranked.length >= limit;
}

function comparePriority(a, b) {
  return (
    priorityScore(a) - priorityScore(b) ||
    (a.score || 0) - (b.score || 0) ||
    dateMs(a.publishedAt) - dateMs(b.publishedAt) ||
    b.dailyOrder - a.dailyOrder
  );
}

function comparePublic(a, b) {
  return (
    (a.score || 0) - (b.score || 0) ||
    dateMs(a.publishedAt) - dateMs(b.publishedAt)
  );
}

function mergeItems(oldItem, newItem) {
  return {
    title: newItem.title || oldItem.title,
    summary: newItem.summary || oldItem.summary,
    url: newItem.url || oldItem.url,
    sourceName: newItem.sourceName || oldItem.sourceName,
    category: newItem.category || oldItem.category,
    sectionLabel: oldItem.sectionLabel || newItem.sectionLabel,
    score: newItem.score ?? oldItem.score,
    publishedAt: newItem.publishedAt || oldItem.publishedAt,
    curated: oldItem.curated || newItem.curated,
    dailyOrder: Math.min(oldItem.dailyOrder, newItem.dailyOrder)
  };
}

function priorityScore(item) {
  const text = `${item.title}\n${item.summary}\n${item.sourceName}\n${item.category}\n${item.sectionLabel}`.toLowerCase();
  let score = 0;
  for (const [keyword, weight] of PRIORITY_KEYWORDS) {
    if (text.includes(keyword.toLowerCase())) score += weight;
  }
  return score;
}

function isPriority(item) {
  return priorityScore(item) >= 60 && (item.curated || hasStrongPrioritySignal(item));
}

function hasStrongPrioritySignal(item) {
  const text = `${item.title}\n${item.summary}\n${item.sourceName}\n${item.category}\n${item.sectionLabel}`.toLowerCase();
  const strongTerms = [
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
    "companion ai"
  ];
  if (strongTerms.some((term) => text.includes(term))) return true;

  const title = item.title.toLowerCase();
  const largeModelTerms = ["大模型", "前沿模型", "模型发布", "开源模型", "基础模型", "llm", "large language model"];
  return item.category === "ai-models" || item.sectionLabel === "模型发布/更新" || largeModelTerms.some((term) => title.includes(term));
}

function looksLikeSameStory(a, b) {
  if (itemKey(a) === itemKey(b)) return true;
  const ta = normalizeTitle(a.title);
  const tb = normalizeTitle(b.title);
  if (!ta || !tb) return false;
  if (Math.min(ta.length, tb.length) >= 12 && (ta.includes(tb) || tb.includes(ta))) return true;
  const sharedTopics = [...topicTokens(a.title)].filter((topic) => topicTokens(b.title).has(topic));
  if (sharedTopics.includes("苹果智能") && sharedTopics.length >= 2) return true;
  const aa = bigrams(ta);
  const bb = bigrams(tb);
  if (!aa.size || !bb.size) return false;
  const intersection = [...aa].filter((x) => bb.has(x)).length;
  const union = new Set([...aa, ...bb]).size;
  return intersection / union >= 0.42;
}

// ---------------------------------------------------------------------------
// 竞品情报流水线：搜索 → 预过滤 → LLM 过滤 → 分组 → 飞书卡片。
// 三级降级：七家公司 → 国外同类竞品 → 行业报道，全空也发一条“今日无更新”。
// ---------------------------------------------------------------------------

async function runCompetitorDigest(env, meta = {}, options = {}) {
  const dryRun = Boolean(options.dryRun);
  const limit = clampInt(env.COMPETITOR_LIMIT, 1, 20, COMPETITOR_LIMIT_FALLBACK);
  // 手动补推可用 ?window=N 覆盖时效窗口（小时）；定时触发走配置值。
  const windowHours = clampInt(
    options.windowHours != null && options.windowHours !== "" ? options.windowHours : env.COMPETITOR_WINDOW_HOURS,
    6, 72, COMPETITOR_WINDOW_HOURS_FALLBACK
  );
  const cutoff = Date.now() - windowHours * 60 * 60 * 1000;
  const seen = await loadSeenMarks(env);
  const reasons = [];
  const sampleErrors = [];
  // 引擎熔断状态：本运行内直连连续失败的次数，跨查询共享。
  const breaker = { google: 0, bing: 0 };
  const rescue = { remaining: DEEPSEEK_RESCUE_BUDGET };
  let enginesOk = false;

  const collectOneTier = async (companies, locale, label) => {
    const collected = await collectCompanyCandidates(env, companies, cutoff, locale, breaker, rescue);
    if (collected.reachable) enginesOk = true;
    if (collected.errors.length) {
      reasons.push(`${label}搜索 ${collected.errors.length} 个请求失败`);
      if (sampleErrors.length < 3) sampleErrors.push(collected.errors[0]);
    }
    const prefiltered = collected.items.filter((item) => matchesAnyAlias(item, companies));
    return seen ? prefiltered.filter((item) => !isSeenMarked(seen, item)) : prefiltered;
  };

  // —— 第一优先：11 家公司，有多少推多少（上限 limit=10，直链优先，跳转链接兜底）——
  const companyFresh = (await collectOneTier(COMPANIES, "zh", "公司档"))
    .filter((item) => !isFinanceDataUrl(item.url));
  let companyGroups = [];
  let companyLlm = null;
  if (companyFresh.length) {
    const filtered = await llmFilterCompetitorItems(env, companyFresh, COMPANIES);
    companyLlm = { used: filtered.used, reason: filtered.reason };
    companyGroups = selectCompetitorGroups(COMPANIES, filtered.kept, limit);
  }

  // —— 第二优先：国外同类竞品（仅当公司层面一条都没有时）——
  let foreignGroups = [];
  let foreignLlm = null;
  if (!companyGroups.length) {
    const foreignFresh = await collectOneTier(FOREIGN_COMPANIES, "", "国外竞品档");
    if (foreignFresh.length) {
      const filtered = await llmFilterCompetitorItems(env, foreignFresh, FOREIGN_COMPANIES);
      foreignLlm = { used: filtered.used, reason: filtered.reason };
      foreignGroups = selectCompetitorGroups(FOREIGN_COMPANIES, filtered.kept, COMPETITOR_FILL_TARGET);
    }
  }

  // —— 行业新闻补位：公司/国外条目不足 5 条时，凑满 5 条 ——
  const pushedSoFar = [...companyGroups, ...foreignGroups].flatMap((group) => group.items);
  let industryItems = [];
  let industryLlm = null;
  const room = COMPETITOR_FILL_TARGET - pushedSoFar.length;
  if (room > 0) {
    const industryCollected = await collectIndustryCandidates(env, cutoff, breaker, rescue);
    if (industryCollected.reachable) enginesOk = true;
    if (industryCollected.errors.length) {
      reasons.push(`行业档搜索 ${industryCollected.errors.length} 个请求失败`);
      if (sampleErrors.length < 3) sampleErrors.push(industryCollected.errors[0]);
    }
    const industryFresh = seen ? industryCollected.items.filter((item) => !isSeenMarked(seen, item)) : industryCollected.items;
    if (industryFresh.length) {
      const filtered = await llmFilterCompetitorItems(env, industryFresh, []);
      industryLlm = { used: filtered.used, reason: filtered.reason };
      // 与已选公司/国外条目去重，直链优先，Google 跳转链接兜底。
      const linkQuality = (item) => (isGoogleNewsRedirect(item.url) ? 0 : 1);
      industryItems = filtered.kept
        .filter((item) => !pushedSoFar.some((old) => itemKey(old) === itemKey(item) || competitorSameStory(old, item)))
        .sort((a, b) => linkQuality(b) - linkQuality(a) || b.dateMs - a.dateMs)
        .slice(0, room)
        .map((item) => ({ ...item, company: INDUSTRY_GROUP }));
    }
  }

  const groups = [...companyGroups, ...foreignGroups];
  if (industryItems.length) groups.push({ name: INDUSTRY_GROUP, items: industryItems });
  const tier = companyGroups.length ? "companies" : foreignGroups.length ? "foreign" : industryItems.length ? "industry" : "none";
  const llmInfo = companyGroups.length ? companyLlm : foreignGroups.length ? foreignLlm : industryLlm;

  const title = `竞品情报速报（${todayInBeijing()}）`;

  // Every search engine failed. Say so rather than going silent, so a missing
  // report is never mistaken for "there was no news today".
  if (!groups.length && !enginesOk) {
    const notice = `竞品搜索源暂时全部不可用（统计窗口：近 ${windowHours} 小时）。${reasons.length ? reasons.join("；") : ""}`;
    console.error(`competitor digest unavailable: ${reasons.join("; ")}`);
    if (sampleErrors.length) console.error(`competitor sample errors: ${sampleErrors.slice(0, 3).join(" | ")}`);
    const noticePayload = buildCompetitorNoticePayload(title, notice, "orange");
    if (dryRun) {
      await signFeishu(env, noticePayload);
      return {
        ok: false,
        job: "competitor",
        dryRun: true,
        tier: "",
        count: 0,
        title,
        reasons,
        sampleErrors,
        feishu: { skipped: false, dryRun: true, payload: noticePayload }
      };
    }
    const feishu = env.FEISHU_WEBHOOK_URL ? await sendFeishu(env, noticePayload) : { skipped: true };
    return { ok: false, job: "competitor", tier: "", count: 0, title, reasons, feishu };
  }

  // Engines worked but nothing new surfaced: an explicit grey card.
  if (!groups.length) {
    const notice = `近 ${windowHours} 小时未搜到相关新闻：${COMPANIES.length} 家公司、国外同类竞品、行业报道均无新增。`;
    const noticePayload = buildCompetitorNoticePayload(title, notice, "grey");
    if (dryRun) {
      await signFeishu(env, noticePayload);
      return {
        ok: true,
        job: "competitor",
        dryRun: true,
        tier: "none",
        count: 0,
        title,
        reasons,
        feishu: { skipped: false, dryRun: true, payload: noticePayload }
      };
    }
    const feishu = env.FEISHU_WEBHOOK_URL ? await sendFeishu(env, noticePayload) : { skipped: true };
    return { ok: true, job: "competitor", tier: "none", count: 0, title, reasons, feishu };
  }

  const noteParts = [];
  if (foreignGroups.length) noteParts.push("含国外同类竞品动态");
  if (industryItems.length) {
    noteParts.push(
      companyGroups.length || foreignGroups.length
        ? "部分条目为 AI 按摩机器人行业动态补充"
        : `近 ${windowHours} 小时公司层面暂无新消息，本条为 AI 按摩机器人行业报道`
    );
  }
  if (llmInfo && !llmInfo.used) noteParts.push(`LLM 过滤不可用（${llmInfo.reason}），本条按关键词过滤`);
  if (reasons.length) noteParts.push(reasons.join("；"));
  const note = noteParts.join("；");

  const pushedItems = groups.flatMap((group) => group.items);
  const feishuPayload = env.FEISHU_WEBHOOK_URL ? buildCompetitorFeishuPayload(title, groups, note) : null;

  const summary = {
    ok: true,
    job: "competitor",
    trigger: meta.trigger || "unknown",
    cron: meta.cron || null,
    tier,
    llm: llmInfo,
    windowHours,
    title,
    count: pushedItems.length,
    groups: groups.map((group) => ({ company: group.name, titles: group.items.map((item) => item.title) }))
  };
  console.log(JSON.stringify({
    job: "competitor",
    tier,
    llm: llmInfo,
    windowHours,
    title,
    count: pushedItems.length,
    groupTitles: summary.groups
  }));

  if (dryRun) {
    // Sign it too, so the returned payload is exactly what production would post.
    if (feishuPayload) await signFeishu(env, feishuPayload);
    return {
      ...summary,
      dryRun: true,
      feishu: feishuPayload ? { skipped: false, dryRun: true, payload: feishuPayload } : { skipped: true }
    };
  }

  const feishuResult = feishuPayload ? await sendFeishu(env, feishuPayload) : { skipped: true };
  // Seen marks are only written after a real push, so a dry run never burns items.
  if (feishuResult.ok && pushedItems.length) {
    await markSeen(env, pushedItems);
  }
  return { ...summary, feishu: feishuResult };
}

async function collectCompanyCandidates(env, companies, cutoff, locale, breaker, rescue) {
  const tasks = companies.flatMap((company) =>
    company.queries.map((query) => ({ company: company.name, query, rescueQuery: `"${company.aliases[0]}"` }))
  );
  const settled = await mapWithConcurrency(tasks, COMPETITOR_QUERY_CONCURRENCY, async (task) => {
    const items = await fetchCompetitorQueryResults(env, task.query, cutoff, locale, breaker, rescue, task.rescueQuery);
    return items.map((item) => ({ ...item, company: task.company }));
  });

  const items = [];
  const errors = [];
  for (const result of settled) {
    if (result.status === "fulfilled") items.push(...result.value);
    else errors.push(errorMessage(result.reason));
  }
  items.sort((a, b) => b.dateMs - a.dateMs);
  return {
    items: dedupeCompetitorItems(items),
    errors,
    // “引擎可用”看的是有没有请求成功，而不是搜没搜到东西——零新闻不等于全挂。
    reachable: settled.some((result) => result.status === "fulfilled")
  };
}

// Promise.allSettled + 有界并发：保持 allSettled 语义，同时不让出站连接超限。
async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index]).then(
        (value) => ({ status: "fulfilled", value }),
        (reason) => ({ status: "rejected", reason })
      );
    }
  });
  await Promise.all(workers);
  return results;
}

async function collectIndustryCandidates(env, cutoff, breaker, rescue) {
  const settled = await mapWithConcurrency(INDUSTRY_QUERIES, COMPETITOR_QUERY_CONCURRENCY, (query) =>
    fetchCompetitorQueryResults(env, query, cutoff, "zh", breaker, rescue, '"按摩机器人"')
  );

  const items = [];
  const errors = [];
  for (const result of settled) {
    if (result.status === "fulfilled") items.push(...result.value);
    else errors.push(errorMessage(result.reason));
  }
  const prefiltered = items.filter((item) => {
    const text = `${item.title}\n${item.summary}`.toLowerCase();
    return INDUSTRY_FILTER_KEYWORDS.some((keyword) => text.includes(keyword));
  });
  prefiltered.sort((a, b) => b.dateMs - a.dateMs);
  return {
    items: dedupeCompetitorItems(prefiltered),
    errors,
    reachable: settled.some((result) => result.status === "fulfilled")
  };
}

// One query hits both engines; as long as one returns items the query succeeds.
// RSS 全失败或零结果时，用 DeepSeek Search 补搜一次（成功才计费），受单次运行
// 的救援预算约束；未配置 DEEPSEEK_API_KEY 时静默跳过。
async function fetchCompetitorQueryResults(env, query, cutoff, locale, breaker, rescue, rescueQuery) {
  const engines = [
    ["google", googleNewsUrl(query, locale)],
    ["bing", bingNewsUrl(query)]
  ];
  const settled = await Promise.allSettled(
    engines.map(([name, url]) => fetchCompetitorFeed(env, name, url, cutoff, breaker))
  );

  const items = [];
  const errors = [];
  for (const result of settled) {
    if (result.status === "fulfilled") items.push(...result.value);
    else errors.push(errorMessage(result.reason));
  }
  if (items.length || !rescueQuery) {
    if (!items.length && errors.length) throw new Error(errors.join("; "));
    return items;
  }

  if (!clean(env.DEEPSEEK_API_KEY) || rescue.remaining <= 0) {
    if (errors.length) throw new Error(errors.join("; "));
    return items;
  }
  rescue.remaining -= 1;
  try {
    console.log(JSON.stringify({ rescue: "fired", query: rescueQuery, rssErrors: errors.length }));
    const rescued = await fetchDeepSeekSearchResults(env, rescueQuery, cutoff);
    if (rescued.length) return rescued;
  } catch (error) {
    errors.push(`deepseek rescue: ${errorMessage(error)}`);
  }
  if (errors.length) throw new Error(errors.join("; "));
  return items;
}

// DeepSeek Search 救援：query 上限 128 字符，追加 after: 日期对齐时效窗口。
async function fetchDeepSeekSearchResults(env, query, cutoff) {
  const key = clean(env.DEEPSEEK_API_KEY);
  if (!key) return [];
  const after = ` after:${dateLabelInBeijing(new Date(cutoff))}`;
  const response = await fetchWithTimeout(DEEPSEEK_SEARCH_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${key}`
    },
    body: JSON.stringify({ query: `${query}${after}`.slice(0, 128), count: 10 })
  }, COMPETITOR_TIMEOUT_MS);
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`deepseek search HTTP ${response.status}${detail ? `: ${shorten(detail, 100)}` : ""}`);
  }
  const data = await response.json().catch(() => null);
  const results = data && Array.isArray(data.results) ? data.results : [];
  return results.map((entry) => {
    const published = parseDate(entry.date);
    return {
      company: "",
      title: clean(entry.title),
      summary: clean(entry.snippet || entry.summary),
      url: clean(entry.url),
      sourceName: clean(entry.site_name) || "DeepSeek 搜索",
      publishedAt: published,
      dateMs: dateMs(published),
      dateLabel: dateLabelInBeijing(published),
      summaryZh: ""
    };
  })
    .filter((item) => item.title && item.url)
    .filter((item) => !item.publishedAt || dateMs(item.publishedAt) >= cutoff);
}

// 单引擎抓取：直连 → 失败抖动重试 → 连续失败熔断后走公共代理。
// breaker 记录每个引擎的连续失败次数，只在本次运行内有效。
async function fetchCompetitorFeed(env, engineName, url, cutoff, breaker) {
  const attempts = [];
  if (breaker[engineName] < ENGINE_BREAKER_THRESHOLD) {
    attempts.push({ label: engineName, url });
  }
  attempts.push({ label: `${engineName}-proxy`, url: NEWS_PROXY_PREFIX + encodeURIComponent(url.href) });

  let lastError = null;
  for (const attempt of attempts) {
    try {
      const items = await fetchCompetitorFeedDirect(env, attempt.label, attempt.url, cutoff);
      if (attempt.label === engineName) breaker[engineName] = 0;
      return items;
    } catch (error) {
      lastError = error;
      if (attempt.label !== engineName) break;
      breaker[engineName] += 1;
      // 直连刚失败先原地重试一次（带抖动），很多 429/503 是瞬时限流。
      if (breaker[engineName] <= ENGINE_BREAKER_THRESHOLD) {
        await sleep(500 + Math.floor(Math.random() * 500));
        try {
          const items = await fetchCompetitorFeedDirect(env, engineName, url, cutoff);
          breaker[engineName] = 0;
          return items;
        } catch (retryError) {
          lastError = retryError;
          breaker[engineName] += 1;
        }
      }
    }
  }
  throw lastError;
}

async function fetchCompetitorFeedDirect(env, engineName, url, cutoff) {
  const response = await fetchWithTimeout(url, {
    headers: {
      "accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      "user-agent": NEWS_BROWSER_UA
    }
  }, COMPETITOR_TIMEOUT_MS);
  if (!response.ok) throw new Error(`${engineName} news search failed: HTTP ${response.status}`);

  const xml = await response.text();
  return parseFeedXml(xml, engineName)
    .filter((item) => item.title && item.url)
    // Google/Bing always carry a pubDate; an undated item is kept rather than
    // silently dropped, at the cost of possibly being a little older.
    .filter((item) => !item.publishedAt || dateMs(item.publishedAt) >= cutoff)
    .map((item) => {
      // Google News titles end with " - 媒体名"; the <source> element already
      // carries the media name, so strip the suffix to keep titles clean.
      let title = item.title;
      const media = clean(item.newsSource);
      if (media && title.endsWith(` - ${media}`)) {
        title = clean(title.slice(0, title.length - media.length - 3));
      }
      return {
        company: "",
        title,
        summary: item.summary,
        url: unwrapBingLink(item.url),
        sourceName: media || engineName,
        publishedAt: item.publishedAt,
        dateMs: dateMs(item.publishedAt),
        dateLabel: dateLabelInBeijing(item.publishedAt),
        summaryZh: ""
      };
    });
}

function googleNewsUrl(query, locale) {
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", query);
  if (locale) {
    url.searchParams.set("hl", "zh-CN");
    url.searchParams.set("gl", "CN");
    url.searchParams.set("ceid", "CN:zh-Hans");
  }
  return url;
}

function bingNewsUrl(query) {
  const url = new URL("https://www.bing.com/news/search");
  url.searchParams.set("q", query);
  // 必须是小写 format=rss：大写（或带 setmkt）会被 Bing 重定向到 HTML 首页。
  url.searchParams.set("format", "rss");
  return url;
}

// Bing RSS 的链接是 apiclick.aspx 跳转页，真实原文藏在 url 参数里；解出来
// 直接给原文链接，出处干净且不受 Bing 跳转页改版影响。
function unwrapBingLink(link) {
  if (!/bing\.com\/news\/apiclick/i.test(link)) return link;
  try {
    const inner = new URL(link.replace(/&amp;/g, "&")).searchParams.get("url");
    if (inner && /^https?:\/\//i.test(inner)) return inner;
  } catch {
    // 落回原始跳转链接
  }
  return link;
}

// First gate: the title/summary must contain one of the company's aliases.
// Cheap, deterministic, and it caps how much has to go through the LLM.
// 证券行情/个股数据页不是新闻（Bing 会把行情页混进公司搜索结果）。
function isFinanceDataUrl(url) {
  return /data\.eastmoney\.com|finance\.baidu\.com\/stock|sse\.com\.cn|szse\.cn|stockstar\.com|xueqiu\.com|10jqka\.com|quote\.|\/stock\/|stockcalendar/i.test(String(url || ""));
}

function matchesAnyAlias(item, companies) {
  const text = `${item.title}\n${item.summary}`.toLowerCase();
  return companies.some((company) => company.aliases.some((alias) => text.includes(alias.toLowerCase())));
}

function attributeByAlias(item, companies) {
  const text = `${item.title}\n${item.summary}`.toLowerCase();
  for (const company of companies) {
    if (company.aliases.some((alias) => text.includes(alias.toLowerCase()))) return company.name;
  }
  return "";
}

function isKnownCompetitorName(name) {
  const lower = String(name || "").toLowerCase();
  if (!lower) return true;
  return KNOWN_COMPETITOR_NAMES.some((known) => lower.includes(known) || known.includes(lower));
}

// Second gate: one GLM call decides relevance for every candidate and writes a
// one-line Chinese summary. Any failure degrades to keyword-only filtering.
async function llmFilterCompetitorItems(env, items, companies) {
  const key = clean(env.ZHIPU_API_KEY);
  if (!key) {
    return { kept: keywordFallbackCompetitorItems(items, companies), used: false, reason: "未配置 ZHIPU_API_KEY" };
  }

  // 序号在这里定死：prompt 里的 i 和回查判定用的是同一个下标。
  const capped = items.slice(0, COMPETITOR_LLM_CANDIDATE_CAP)
    .map((item, index) => ({ ...item, index: index + 1 }));
  const payload = {
    model: clean(env.ZHIPU_MODEL) || DEFAULT_ZHIPU_MODEL,
    temperature: 0.1,
    max_tokens: 4096,
    messages: [
      { role: "system", content: "你是竞品新闻过滤助手。只输出 JSON，不要输出任何其他内容。" },
      { role: "user", content: buildCompetitorLlmPrompt(capped, companies) }
    ]
  };

  let content = null;
  let lastError = null;
  // 依次尝试：主模型关思考（最快）→ 主模型默认参数 → 备胎模型。
  // glm-4.7 系列默认开启思考，关掉更快，但个别版本不认识该参数。
  const attempts = [
    { ...payload, thinking: { type: "disabled" } },
    payload,
    ...ZHIPU_FALLBACK_MODELS.map((model) => ({ ...payload, model }))
  ];
  for (let attempt = 0; attempt < attempts.length && !content; attempt += 1) {
    try {
      content = await callZhipuChat(env, attempts[attempt]);
    } catch (error) {
      lastError = error;
      console.error(`competitor llm attempt ${attempt + 1}/${attempts.length} failed: ${errorMessage(error)}`);
    }
  }
  if (!content) {
    return { kept: keywordFallbackCompetitorItems(items, companies), used: false, reason: errorMessage(lastError) };
  }

  const parsed = parseLlmResults(content);
  if (!parsed) {
    return { kept: keywordFallbackCompetitorItems(items, companies), used: false, reason: "LLM 输出无法解析" };
  }

  const byIndex = new Map(parsed.map((entry) => [Number(entry.i), entry]));
  const names = new Set(companies.map((company) => company.name));
  const llmKept = capped.filter((item) => {
    const verdict = byIndex.get(item.index);
    // A missing verdict keeps the item: better one extra item than a lost one.
    return !verdict || verdict.keep !== false;
  }).map((item) => {
    const verdict = byIndex.get(item.index);
    const company = verdict && names.has(clean(verdict.company))
      ? clean(verdict.company)
      : (item.company || attributeByAlias(item, companies));
    const summaryZh = verdict ? shorten(clean(verdict.summary), 60) : "";
    // 全档位顺带发现名单外的新玩家；已知公司名（含子串匹配）不算线索。
    const newCompanies = verdict && Array.isArray(verdict.companies)
      ? verdict.companies.map(clean).filter(Boolean).filter((name) => !isKnownCompetitorName(name)).slice(0, 3)
      : [];
    return { ...item, company, summaryZh: summaryZh || shorten(oneSentence(item.summary), 60), newCompanies };
  });
  // 超出候选上限的条目没进过 LLM，按关键词兜底补上摘要，不丢也不静默。
  const beyond = items.slice(COMPETITOR_LLM_CANDIDATE_CAP)
    .map((item) => ({ ...item, summaryZh: shorten(oneSentence(item.summary), 60) }));
  return { kept: [...llmKept, ...beyond], used: true, reason: "" };
}

async function callZhipuChat(env, payload) {
  const response = await fetchWithTimeout(ZHIPU_CHAT_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${clean(env.ZHIPU_API_KEY)}`
    },
    body: JSON.stringify(payload)
  }, COMPETITOR_LLM_TIMEOUT_MS);
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`zhipu chat HTTP ${response.status}${detail ? `: ${shorten(detail, 120)}` : ""}`);
  }
  const data = await response.json().catch(() => null);
  const content = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : "";
  if (!clean(content)) throw new Error("zhipu chat returned no content");
  return content;
}

function buildCompetitorLlmPrompt(items, companies) {
  const targets = companies.length
    ? companies.map((company, index) => `${index + 1}. ${company.name} —— ${company.desc}`).join("\n")
    : "AI 按摩/理疗机器人行业（按摩机器人、理疗机器人、艾灸机器人、推拿机器人、具身智能康养等）";
  const rule = companies.length
    ? "判断每条新闻是否真实与上述某个主体相关，剔除仅同名或同词的无关新闻（其他行业、地名、人名等）；股票行情页、个股日历、公司官网主页等非新闻页面一律判为不相关。"
    : "判断每条新闻是否与该行业相关（新品、技术、融资、展会、政策、门店、评论均可），剔除明显无关的条目。";
  const clueRule = "同时提取条目中出现的公司/品牌名（companies 数组，尤其是做 AI 按摩理疗机器人的新玩家，最多 3 个，可为空数组）。";
  const candidates = items.map((item, index) => ({
    i: index + 1,
    title: item.title,
    source: item.sourceName,
    published: item.dateLabel,
    snippet: shorten(item.summary, 120)
  }));
  return [
    `目标主体：\n${targets}`,
    `规则：${rule}${clueRule}\n相关条目用中文给出不超过 40 字的一句话摘要；不相关时 keep 为 false、摘要为空字符串。`,
    `候选条目（JSON）：\n${JSON.stringify(candidates)}`,
    "输出格式（覆盖全部条目，i 用原序号）：{\"results\":[{\"i\":1,\"keep\":true,\"company\":\"主体名\",\"summary\":\"一句话\",\"companies\":[\"条目里出现的公司名\"]}]}"
  ].join("\n\n");
}

function parseLlmResults(content) {
  const text = String(content || "").replace(/```json|```/gi, "");
  // 首选 {"results":[...]}；模型偶尔直接回一个裸数组，也接住。
  const objStart = text.indexOf("{");
  const objEnd = text.lastIndexOf("}");
  if (objStart !== -1 && objEnd > objStart) {
    try {
      const payload = JSON.parse(text.slice(objStart, objEnd + 1));
      if (Array.isArray(payload.results)) return payload.results;
    } catch {
      // 落到下面的数组解析
    }
  }
  const arrStart = text.indexOf("[");
  const arrEnd = text.lastIndexOf("]");
  if (arrStart !== -1 && arrEnd > arrStart) {
    try {
      const parsed = JSON.parse(text.slice(arrStart, arrEnd + 1));
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // 交给调用方按解析失败降级
    }
  }
  return null;
}

function keywordFallbackCompetitorItems(items, companies) {
  return items.map((item) => ({
    ...item,
    company: item.company || attributeByAlias(item, companies),
    summaryZh: shorten(oneSentence(item.summary), 60),
    newCompanies: []
  }));
}

function selectCompetitorGroups(companies, items, limit) {
  // 直链优先排序：Google 跳转链接只作兜底，同一公司内排在直链后面。
  const linkQuality = (item) => (isGoogleNewsRedirect(item.url) ? 0 : 1);
  const groups = [];
  let total = 0;
  for (const company of companies) {
    const companyItems = dedupeCompetitorItems(
      items.filter((item) => item.company === company.name)
    ).sort((a, b) => linkQuality(b) - linkQuality(a) || b.dateMs - a.dateMs);
    if (!companyItems.length) continue;
    const room = Math.min(COMPETITOR_PER_COMPANY_CAP, limit - total);
    if (room <= 0) break;
    const picked = companyItems.slice(0, room);
    groups.push({ name: company.name, items: picked });
    total += picked.length;
  }
  return groups;
}

// Cross-engine and cross-run dedupe: exact key, plus a stricter-than-digest
// title similarity, so the same story from Google and Bing collapses into one.
// 同一则新闻两个引擎都收录时，保留 Bing 的直连原文链接——Google News 的
// 跳转链接在国内打不开（飞书内置浏览器访问不了 news.google.com）。
function dedupeCompetitorItems(items) {
  const out = [];
  for (const item of items) {
    const existingIndex = out.findIndex((old) => itemKey(old) === itemKey(item) || competitorSameStory(old, item));
    if (existingIndex === -1) {
      out.push(item);
      continue;
    }
    const existing = out[existingIndex];
    if (isGoogleNewsRedirect(existing.url) && !isGoogleNewsRedirect(item.url)) {
      out[existingIndex] = { ...existing, url: item.url, sourceName: existing.sourceName || item.sourceName };
    }
  }
  return out;
}

function isGoogleNewsRedirect(url) {
  return /news\.google\.com\/(rss\/)?(articles|link)\//.test(String(url || ""));
}

function competitorSameStory(a, b) {
  const ta = normalizeCompetitorTitle(a.title);
  const tb = normalizeCompetitorTitle(b.title);
  if (!ta || !tb) return false;
  if (Math.min(ta.length, tb.length) >= 10 && (ta.includes(tb) || tb.includes(ta))) return true;
  const aa = bigrams(ta);
  const bb = bigrams(tb);
  if (!aa.size || !bb.size) return false;
  const intersection = [...aa].filter((gram) => bb.has(gram)).length;
  return intersection / new Set([...aa, ...bb]).size >= 0.5;
}

function normalizeCompetitorTitle(title) {
  return String(title || "").toLowerCase().replace(/[^\da-z\u4e00-\u9fff]+/g, "");
}

// Seen marks live in one KV key as {hash: firstSeenMs}, pruned on write.
async function loadSeenMarks(env) {
  const ns = env.COMPETITOR_STATE;
  if (!ns || typeof ns.get !== "function") return null; // 本地/未绑定：跳过跨天去重
  try {
    const raw = await ns.get(COMPETITOR_SEEN_KEY);
    const payload = raw ? JSON.parse(raw) : {};
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  } catch (error) {
    console.error(`competitor seen load failed: ${errorMessage(error)}`);
    return {};
  }
}

function seenItemKey(item) {
  return md5(`${itemKey(item)}|${normalizeCompetitorTitle(item.title)}`);
}

function isSeenMarked(marks, item) {
  return Boolean(marks && marks[seenItemKey(item)]);
}

async function markSeen(env, items) {
  const ns = env.COMPETITOR_STATE;
  if (!ns || typeof ns.put !== "function" || !items.length) return;
  try {
    const marks = (await loadSeenMarks(env)) || {};
    const horizon = Date.now() - COMPETITOR_SEEN_TTL_DAYS * 86400000;
    for (const [key, ts] of Object.entries(marks)) {
      if (Number(ts) < horizon) delete marks[key];
    }
    const now = Date.now();
    for (const item of items) marks[seenItemKey(item)] = now;
    await ns.put(COMPETITOR_SEEN_KEY, JSON.stringify(marks));
  } catch (error) {
    console.error(`competitor seen save failed: ${errorMessage(error)}`);
  }
}

function buildCompetitorFeishuPayload(title, groups, note) {
  const elements = buildCompetitorElements(groups);
  if (note) {
    elements.push({ tag: "hr" });
    elements.push({
      tag: "div",
      text: { tag: "lark_md", content: `<font color='grey'>${escapeLark(note)}</font>` }
    });
  }
  return {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: {
        template: "indigo",
        title: { tag: "plain_text", content: title }
      },
      elements
    }
  };
}

function buildCompetitorElements(groups) {
  const elements = [];
  groups.forEach((group, index) => {
    const lines = [`**【${escapeLark(group.name)}】**`];
    group.items.forEach((item, itemIndex) => {
      const meta = [item.sourceName, item.dateLabel].filter(Boolean).join(" · ");
      const clue = item.newCompanies && item.newCompanies.length ? `新玩家线索：${item.newCompanies.join("、")}` : "";
      const greyParts = [meta, item.summaryZh, clue].filter(Boolean).map((part) => escapeLark(part)).join(" · ");
      lines.push(`${itemIndex + 1}. [${escapeLark(shorten(item.title, 72))}](${item.url})`);
      if (greyParts) lines.push(`<font color='grey'>${greyParts}</font>`);
    });
    elements.push({ tag: "div", text: { tag: "lark_md", content: lines.join("\n") } });
    if (index !== groups.length - 1) elements.push({ tag: "hr" });
  });
  return elements;
}

function buildCompetitorNoticePayload(title, notice, template) {
  return {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: {
        template: template || "grey",
        title: { tag: "plain_text", content: title }
      },
      elements: [{ tag: "div", text: { tag: "lark_md", content: escapeLark(notice) } }]
    }
  };
}

function dateLabelInBeijing(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(value);
}

function buildFeishuPayload(title, items, note) {
  const elements = buildFeishuElements(items);
  if (note) {
    elements.push({ tag: "hr" });
    elements.push({
      tag: "div",
      text: { tag: "lark_md", content: `<font color='grey'>${escapeLark(note)}</font>` }
    });
  }

  return {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: {
        template: "blue",
        title: { tag: "plain_text", content: title }
      },
      elements
    }
  };
}

function buildFeishuNoticePayload(title, notice) {
  return {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: {
        template: "orange",
        title: { tag: "plain_text", content: title }
      },
      elements: [
        { tag: "div", text: { tag: "lark_md", content: escapeLark(notice) } }
      ]
    }
  };
}

async function sendFeishu(env, payload) {
  await signFeishu(env, payload);
  return postJson(env.FEISHU_WEBHOOK_URL, payload, "feishu");
}

function buildFeishuElements(items) {
  const elements = [];
  items.forEach((item, index) => {
    const content = [
      `**${index + 1}. ${escapeLark(shorten(item.title, 80))}**`,
      escapeLark(shorten(item.summary, 110)),
      `<font color='grey'>${escapeLark(shorten(itemMeta(item), 70))}</font>`
    ].filter(Boolean).join("\n");

    elements.push({ tag: "div", text: { tag: "lark_md", content } });
    elements.push({
      tag: "action",
      actions: [
        {
          tag: "button",
          text: { tag: "plain_text", content: "阅读全文" },
          type: index < 3 ? "primary" : "default",
          url: item.url
        }
      ]
    });
    if (index !== items.length - 1) elements.push({ tag: "hr" });
  });
  return elements;
}

async function signFeishu(env, payload) {
  const secret = (env.FEISHU_SIGNING_SECRET || "").trim();
  if (!secret) return;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const stringToSign = `${timestamp}\n${secret}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(stringToSign),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new Uint8Array());
  payload.timestamp = timestamp;
  payload.sign = base64Encode(signature);
}

function buildWeixinPayloads(items, note) {
  const articles = items
    .filter((item) => item.url)
    .slice(0, 10)
    .map((item) => ({
      title: shorten(item.title, 64),
      description: [shorten(item.summary, 90), shorten(itemMeta(item), 36)].filter(Boolean).join("\n"),
      url: item.url,
      picurl: ""
    }));

  if (note && articles.length) {
    const last = articles[articles.length - 1];
    last.description = [last.description, shorten(note, 60)].filter(Boolean).join("\n");
  }

  return chunk(articles, 8).map((group) => ({ msgtype: "news", news: { articles: group } }));
}

async function sendWeixin(env, payloads) {
  const results = [];
  for (const payload of payloads) {
    results.push(await postJson(env.WEIXIN_WEBHOOK, payload, "weixin"));
  }
  return { ok: true, chunks: results.length };
}

async function postJson(url, payload, kind) {
  assertPublicHttpUrl(url);
  let lastError;
  for (let attempt = 1; attempt <= WEBHOOK_ATTEMPTS; attempt += 1) {
    try {
      return await postJsonOnce(url, payload, kind);
    } catch (error) {
      lastError = error;
      console.error(`${kind} webhook attempt ${attempt}/${WEBHOOK_ATTEMPTS} failed: ${errorMessage(error)}`);
      if (attempt < WEBHOOK_ATTEMPTS) await sleep(500 * attempt);
    }
  }
  throw lastError;
}

async function postJsonOnce(url, payload, kind) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(`${kind} webhook HTTP ${response.status}`);
  }
  const data = await response.json().catch(() => ({}));
  const code = data.errcode ?? data.code ?? data.StatusCode ?? 0;
  if (code !== 0) {
    throw new Error(`${kind} webhook error: ${JSON.stringify(data)}`);
  }
  return { ok: true };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function itemMeta(item) {
  return [item.sourceName, item.sectionLabel || item.category, item.score == null ? "" : `score ${item.score}`]
    .filter(Boolean)
    .join(" · ");
}

function todayInBeijing() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getXmlAttr(block, tagName, attrName) {
  const re = new RegExp(`<${tagName}\\b([^>]*)\\/?>`, "i");
  const tag = block.match(re);
  if (!tag) return "";
  const attr = tag[1].match(new RegExp(`${attrName}\\s*=\\s*["']([^"']+)["']`, "i"));
  return attr ? decodeXml(attr[1]) : "";
}

function xmlText(block, tagName) {
  const re = new RegExp(`<(?:[\\w.-]+:)?${tagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${tagName}>`, "i");
  const match = block.match(re);
  return match ? decodeXml(match[1]) : "";
}

function stripHtml(value) {
  return clean(decodeXml(value).replace(/<[^>]+>/g, " "));
}

function cleanArxivSummary(value) {
  return clean(value.replace(/^\s*abstract\s*:?\s*/i, ""));
}

function decodeXml(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)));
}

function dateMs(value) {
  return value instanceof Date ? value.getTime() : 0;
}

function itemKey(item) {
  return (item.url || item.title).trim().toLowerCase();
}

function normalizeTitle(title) {
  let value = String(title || "").toLowerCase();
  const replacements = [
    [/apple\s+intelligence/g, "苹果智能"],
    [/apple\s*ai/g, "苹果智能"],
    [/apple\s*智能/g, "苹果智能"],
    [/苹果\s*ai/g, "苹果智能"],
    [/qwen/g, "千问"],
    [/通义千问/g, "千问"],
    [/deepseek/g, "深度求索"],
    [/chatgpt/g, "gpt"]
  ];
  for (const [pattern, replacement] of replacements) value = value.replace(pattern, replacement);
  return value.replace(/[^\da-z\u4e00-\u9fff]+/g, "");
}

function topicTokens(title) {
  const normalized = normalizeTitle(title);
  const aliases = [
    ["苹果智能", ["苹果智能", "苹果"]],
    ["千问", ["千问"]],
    ["阿里", ["阿里"]],
    ["grok", ["grok"]],
    ["openai", ["openai"]],
    ["anthropic", ["anthropic"]],
    ["claude", ["claude"]],
    ["gemini", ["gemini"]],
    ["深度求索", ["深度求索"]],
    ["机器人", ["机器人", "机械臂", "具身"]],
    ["语音", ["语音", "audio", "speech"]],
    ["多模态", ["多模态", "multimodal"]]
  ];
  const tokens = new Set();
  for (const [token, variants] of aliases) {
    if (variants.some((variant) => normalized.includes(variant))) tokens.add(token);
  }
  return tokens;
}

function bigrams(value) {
  if (value.length < 2) return new Set(value ? [value] : []);
  const out = new Set();
  for (let i = 0; i < value.length - 1; i += 1) out.add(value.slice(i, i + 2));
  return out;
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function oneSentence(value) {
  const text = clean(value);
  if (!text) return "";
  const marks = ["。", "！", "？", ". ", "! ", "? ", ".", "!", "?"];
  for (const mark of marks) {
    const index = text.indexOf(mark);
    if (index !== -1) return text.slice(0, index + mark.length).trim();
  }
  return text;
}

function shorten(value, maxLength) {
  const cleanValue = clean(value);
  if (cleanValue.length <= maxLength) return cleanValue;
  return `${cleanValue.slice(0, maxLength - 3).trim()}...`;
}

function md5(input) {
  const bytes = new TextEncoder().encode(input);
  const bitLength = bytes.length * 8;
  const paddedLength = (((bytes.length + 8) >> 6) + 1) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const shifts = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ];
  const table = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i += 1) {
      let f;
      let g;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }

      const word = view.getUint32(offset + g * 4, true);
      const sum = (a + f + table[i] + word) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + leftRotate(sum, shifts[i])) >>> 0;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  return [a0, b0, c0, d0].map((word) => wordToHex(word)).join("");
}

function leftRotate(value, amount) {
  return ((value << amount) | (value >>> (32 - amount))) >>> 0;
}

function wordToHex(word) {
  let out = "";
  for (let i = 0; i < 4; i += 1) {
    out += ((word >>> (i * 8)) & 0xff).toString(16).padStart(2, "0");
  }
  return out;
}

function escapeLark(value) {
  return String(value || "").replace(/[\\*_~`]/g, (match) => `\\${match}`);
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function base64Encode(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
