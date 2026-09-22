const AIHOT_BASE_URL = "https://aihot.news";
const DEFAULT_LIMIT = 10;
const FALLBACK_WINDOW_HOURS = 24;
const SECTION_QUOTA = 2;
const SELECTED_POOL_LIMIT = 100;
const SELECTED_SOURCE_CAP = 3;
const AIHOT_TIMEOUT_MS = 20000;

// Shown in the card footer when the curated daily report was not available, so a
// degraded digest is never mistaken for the normal one.
const SOURCE_NOTES = {
  "aihot-daily": "",
  "aihot-selected": "今日日报尚未发布，本条为 AIHOT 精选池（最近 24 小时）",
  "rss-fallback": "AIHOT 接口暂不可用，本条来自备用 RSS 源"
};

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
    ctx.waitUntil(
      runDigest(env, { trigger: "scheduled", cron: event.cron }, { dryRun: isTruthy(env.DRY_RUN) })
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
      const dryRun = isTruthy(url.searchParams.get("dry")) || isTruthy(env.DRY_RUN);
      try {
        return jsonResponse(await runDigest(env, { trigger: "manual" }, { dryRun }));
      } catch (error) {
        return jsonResponse({ ok: false, error: errorMessage(error) }, 500);
      }
    }

    return jsonResponse({ ok: true, endpoints: ["/health", "/run", "/run?dry=1"] });
  }
};

async function runDigest(env, meta = {}, options = {}) {
  const dryRun = Boolean(options.dryRun);
  const limit = clampInt(env.DIGEST_LIMIT, 1, 10, DEFAULT_LIMIT);
  const { date, items, source, fallbackReason } = await fetchDigestWithFallback(env, limit);
  if (!items.length) {
    throw new Error("No digest items found");
  }

  const title = `智能前沿日报（${date || todayInBeijing()}）`;
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
    const items = selectSectionBalanced(sectionBuckets(report), [], limit);
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

async function tryFetchSelectedPool(env, limit, reasons) {
  try {
    const payload = await requestAihot(env, "/api/v1/items", {
      mode: "selected",
      window: "24h",
      limit: String(SELECTED_POOL_LIMIT)
    });
    const candidates = (payload.items || [])
      .map(selectedPoolItem)
      .filter((item) => item.title && item.url);
    const items = rankSelectedPool(candidates, limit);
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
  if (!appid || !key || !items.length) return items;

  const titleLines = items.map((item) => item.title);
  const summaryLines = items.map((item) => shorten(oneSentence(item.summary), 160));
  const [titlesZh, summariesZh] = await Promise.all([
    baiduTranslateLines(titleLines, appid, key),
    baiduTranslateLines(summaryLines, appid, key)
  ]);

  return items.map((item, index) => ({
    ...item,
    title: clean(titlesZh[index]) || item.title,
    summary: clean(summariesZh[index]) || item.summary
  }));
}

async function baiduTranslateLines(lines, appid, key) {
  const safeLines = lines.map((line) => clean(line).replace(/\n/g, " "));
  if (!safeLines.some(Boolean)) return lines;

  const q = safeLines.join("\n");
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

  const response = await fetchWithTimeout("https://fanyi-api.baidu.com/api/trans/vip/translate", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  }, 20000);
  if (!response.ok) return lines;

  const payload = await response.json().catch(() => null);
  if (!payload || payload.error_code || !Array.isArray(payload.trans_result)) return lines;

  const translated = payload.trans_result
    .map((item) => clean(item && item.dst))
    .filter((line) => line);
  return translated.length === lines.length ? translated : lines;
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
