// generate.js
import fs from "fs";
import { execSync } from "child_process";
import fetch from "node-fetch";
import { DateTime } from "luxon";

/* CONFIG */
const COHERE_KEY = process.env.COHERE_API_KEY || null;
const GOOGLE_TTS_KEY = process.env.GOOGLE_TTS_API_KEY || null;
const TIMEZONE = "America/Chicago";
const SITE_BASE = "https://njdpro.github.io/dailybriefing";

/* LOGGING */
function log(...args) {
  console.log(new Date().toISOString(), ...args);
}
function safeJSON(obj) {
  try { return JSON.stringify(obj, null, 2); } catch { return String(obj); }
}

/* RSS fetcher */
async function fetchRSS(url, limit = 2) {
  try {
    const res = await fetch(url, { timeout: 15000 });
    const xml = await res.text();
    const items = xml.split("<item>").slice(1).map(block => {
      const item = block.split("</item>")[0];
      const title = extract(item, "title");
      const description = extract(item, "description");
      return { title, description };
    });
    return items.slice(0, limit);
  } catch (err) {
    log("fetchRSS error for", url, err?.message || err);
    return [];
  }
}
function extract(xml, tag) {
  const open = `<${tag}>`, close = `</${tag}>`;
  const start = xml.indexOf(open), end = xml.indexOf(close);
  if (start === -1 || end === -1) return null;
  let content = xml.substring(start + open.length, end).trim();
  if (content.startsWith("<![CDATA[")) content = content.replace("<![CDATA[", "").replace("]]>", "");
  return content.trim();
}

/* Weather + History */
async function getWeather() {
  try {
    const url = "https://api.open-meteo.com/v1/forecast?latitude=38.9717&longitude=-95.2353&daily=temperature_2m_max,temperature_2m_min,weathercode&timezone=America/Chicago";
    const res = await fetch(url, { timeout: 15000 });
    const data = await res.json();
    const high = data?.daily?.temperature_2m_max?.[0];
    const low = data?.daily?.temperature_2m_min?.[0];
    const code = data?.daily?.weathercode?.[0];
    const conditions = {0:"Clear sky",1:"Mainly clear",2:"Partly cloudy",3:"Overcast",45:"Fog",48:"Rime fog",51:"Light drizzle",61:"Light rain",63:"Moderate rain",65:"Heavy rain",80:"Rain showers",95:"Thunderstorm"};
    if (high == null || low == null) return "Weather data unavailable.";
    return `High ${high}°F, low ${low}°F, ${conditions[code] || "Unknown conditions"}`;
  } catch (err) {
    log("getWeather error:", err?.message || err);
    return "Weather data unavailable.";
  }
}
async function getHistory() {
  try {
    const res = await fetch("https://history.muffinlabs.com/date", { timeout: 15000 });
    const data = await res.json();
    return (data?.data?.Events || []).slice(0, 3).map(e => e.text);
  } catch (err) {
    log("getHistory error:", err?.message || err);
    return ["History data unavailable."];
  }
}

/* Cohere script generation (safe format) */
async function getScriptFromCohere(prompt) {
  if (!COHERE_KEY) { log("COHERE_API_KEY not set; skipping Cohere."); return null; }
  try {
    const res = await fetch("https://api.cohere.com/v2/chat", {
      method: "POST",
      headers: {"Content-Type":"application/json", Authorization:`Bearer ${COHERE_KEY}`},
      body: JSON.stringify({
        model: "command-r-plus-08-2024",
        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }]
      })
    });
    const data = await res.json();
    log("COHERE RAW RESPONSE:", safeJSON(data));
    const text = data?.message?.content?.[0]?.text || data?.text || null;
    return typeof text === "string" ? text.trim() : null;
  } catch (err) {
    log("getScriptFromCohere error:", err?.message || err);
    return null;
  }
}

/* Google TTS */
async function textToSpeechGoogle(text) {
  if (!GOOGLE_TTS_KEY) { log("GOOGLE_TTS_API_KEY not set; skipping Google TTS."); return null; }
  try {
    const res = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize?key=" + GOOGLE_TTS_KEY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: "en-US", name: "en-US-Neural2-C" },
        audioConfig: { audioEncoding: "MP3" }
      })
    });
    const data = await res.json();
    log("GOOGLE TTS RAW RESPONSE:", safeJSON(data));
    if (!data?.audioContent) return null;
    return Buffer.from(data.audioContent, "base64");
  } catch (err) {
    log("textToSpeechGoogle error:", err?.message || err);
    return null;
  }
}

/* Local fallback script + fake MP3 */
function buildLocalScript({ weather, history, headlines }) {
  const today = DateTime.now().setZone(TIMEZONE).toFormat("MMMM d, yyyy");
  const lines = [
    `Good morning, Davis family. Today is ${today}.`,
    "",
    `Weather: ${weather}`,
    "",
    "Today in history:",
    ...history.map(h => `- ${h}`),
    "",
    "Top headlines:",
    "Global:",
    ...headlines.global.map(h => `- ${h.title || h}`),
    "",
    "US:",
    ...headlines.us.map(h => `- ${h.title || h}`),
    "",
    "Kansas:",
    ...headlines.kansas.map(h => `- ${h.title || h}`),
    "",
    "Chiefs:",
    ...headlines.chiefs.map(h => `- ${h.title || h}`),
    "",
    "Lawrence:",
    ...headlines.lawrence.map(h => `- ${h.title || h}`),
    "",
    "Have a great day."
  ];
  return lines.join("\n");
}
function fakeMP3BufferFromText(text) {
  const header = "FAKE_MP3_HEADER\n";
  return Buffer.from(header + text);
}

/* Save MP3 + RSS */
function saveMP3(buffer) {
  const date = DateTime.now().setZone(TIMEZONE).toFormat("yyyy-MM-dd");
  const filename = `episode-${date}.mp3`;
  fs.writeFileSync(filename, buffer);
  log("Saved MP3:", filename, "size:", buffer.length);
  return filename;
}
function ensureRSSExists() {
  const path = "./rss.xml";
  if (!fs.existsSync(path)) {
    log("rss.xml not found; creating base rss.xml");
    const base = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Davis Daily Briefing</title>
    <link>${SITE_BASE}/</link>
    <description>Your automated daily morning radio show.</description>
    <language>en-us</language>
    <itunes:author>Davis Daily Briefing</itunes:author>
    <itunes:explicit>false</itunes:explicit>
    <itunes:type>episodic</itunes:type>
    <itunes:category text="News"/>
  </channel>
</rss>
`;
    fs.writeFileSync(path, base, "utf8");
  }
}
function updateRSS(filename) {
  try {
    ensureRSSExists();
    const rssPath = "./rss.xml";
    let rss = fs.readFileSync(rssPath, "utf8");
    const url = `${SITE_BASE}/${filename}`;
    const title = `Davis Briefing — ${DateTime.now().setZone(TIMEZONE).toFormat("MMMM d, yyyy")}`;
    const item = `
  <item>
    <title>${title}</title>
    <enclosure url="${url}" type="audio/mpeg" />
    <pubDate>${new Date().toUTCString()}</pubDate>
    <guid>${url}</guid>
  </item>
`;
    if (rss.includes("</channel>")) rss = rss.replace("</channel>", `${item}\n</channel>`);
    else rss += item;
    fs.writeFileSync(rssPath, rss, "utf8");
    log("Updated rss.xml with", filename);
  } catch (err) {
    log("updateRSS error:", err?.message || err);
  }
}

/* Commit & push (best-effort) */
function commitAndPush() {
  try {
    execSync('git config user.name "github-actions"', { stdio: "inherit" });
    execSync('git config user.email "github-actions@github.com"', { stdio: "inherit" });
    execSync("git add .", { stdio: "inherit" });
    try { execSync('git commit -m "Daily update" --allow-empty', { stdio: "inherit" }); }
    catch (err) { log("git commit returned non-zero (likely no changes). Continuing."); }
    execSync("git push", { stdio: "inherit" });
    log("Commit and push attempted.");
  } catch (err) {
    log("commitAndPush error:", err?.message || err);
  }
}

/* MAIN */
async function run() {
  log("Starting generate.js");
  const headlines = {
    global: await fetchRSS("https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en"),
    us: await fetchRSS("https://news.google.com/rss/headlines/section/topic/NATION?hl=en-US&gl=US&ceid=US:en"),
    kansas: await fetchRSS("https://news.google.com/rss/search?q=Kansas&hl=en-US&gl=US&ceid=US:en", 1),
    chiefs: await fetchRSS("https://news.google.com/rss/search?q=Kansas+City+Chiefs&hl=en-US&gl=US&ceid=US:en", 1),
    lawrence: await fetchRSS("https://news.google.com/rss/search?q=Lawrence+Kansas&hl=en-US&gl=US&ceid=US:en", 1)
  };

  const weather = await getWeather();
  const history = await getHistory();

  const prompt = `
You are a radio news writer creating a 10–15 minute morning briefing for the Davis family.
Weather: ${weather}
Today in History: ${history.join(" ")}
Headlines:
${headlines.global.map(h => `- ${h.title}: ${h.description}`).join("\n")}
${headlines.us.map(h => `- ${h.title}: ${h.description}`).join("\n")}
`;

  let script = await getScriptFromCohere(prompt);
  log("Script from Cohere length:", script?.length ?? "null");
  if (!script) {
    log("Falling back to local script generator.");
    script = buildLocalScript({ weather, history, headlines });
  }

  log("Final script preview (first 400 chars):");
  log(script.slice(0, 400));

  let mp3 = await textToSpeechGoogle(script);
  log("Google TTS buffer length:", mp3?.length ?? "null");
  if (!mp3) {
    log("Falling back to fake MP3 buffer.");
    mp3 = fakeMP3BufferFromText(script);
  }

  const filename = saveMP3(mp3);
  updateRSS(filename);

  /* FORCE fallback file + commit safety (guarantee an artifact) */
  try {
    const forcedName = `episode-${DateTime.now().setZone(TIMEZONE).toFormat("yyyy-MM-dd")}-forced.mp3`;
    if (!fs.existsSync(forcedName)) {
      const forcedBuffer = Buffer.from("FORCED_EPISODE " + new Date().toISOString());
      fs.writeFileSync(forcedName, forcedBuffer);
      log("FORCED Saved MP3:", forcedName, "size:", forcedBuffer.length);
      updateRSS(forcedName);
    } else {
      log("Forced file already exists:", forcedName);
    }
  } catch (e) {
    log("Forced save error:", e?.message || e);
  }

  commitAndPush();
  log("generate.js finished.");
}

run().catch(err => { log("Unhandled error in run():", err?.message || err); process.exit(1); });
