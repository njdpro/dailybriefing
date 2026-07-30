import fs from "fs";
import fetch from "node-fetch";
import { DateTime } from "luxon";

// ------------------------------------------------------------
// Fetch RSS headlines (Google News)
// ------------------------------------------------------------

async function fetchRSS(url, limit = 2) {
  const res = await fetch(url);
  const xml = await res.text();

  const items = xml.split("<item>").slice(1).map(block => {
    const item = block.split("</item>")[0];
    const title = extract(item, "title");
    const description = extract(item, "description");
    return { title, description };
  });

  return items.slice(0, limit);
}

function extract(xml, tag) {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const start = xml.indexOf(open);
  const end = xml.indexOf(close);
  if (start === -1 || end === -1) return null;

  let content = xml.substring(start + open.length, end).trim();
  if (content.startsWith("<![CDATA[")) {
    content = content.replace("<![CDATA[", "").replace("]]>", "");
  }
  return content.trim();
}

// ------------------------------------------------------------
// Weather + History
// ------------------------------------------------------------

async function getWeather() {
  const url =
    "https://api.open-meteo.com/v1/forecast?latitude=38.9717&longitude=-95.2353&daily=temperature_2m_max,temperature_2m_min,weathercode&timezone=America/Chicago";

  const res = await fetch(url);
  const data = await res.json();

  const high = data.daily.temperature_2m_max[0];
  const low = data.daily.temperature_2m_min[0];
  const code = data.daily.weathercode[0];

  const conditions = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Rime fog",
    51: "Light drizzle",
    61: "Light rain",
    63: "Moderate rain",
    65: "Heavy rain",
    80: "Rain showers",
    95: "Thunderstorm"
  };

  return `High ${high}°F, low ${low}°F, ${conditions[code] || "Unknown conditions"}`;
}

async function getHistory() {
  const res = await fetch("https://history.muffinlabs.com/date");
  const data = await res.json();
  return data.data.Events.slice(0, 3).map(e => e.text);
}

// ------------------------------------------------------------
// Build a simple script (NO COHERE)
// ------------------------------------------------------------

function buildScript({ weather, history, headlines }) {
  const today = DateTime.now().setZone("America/Chicago").toFormat("MMMM d, yyyy");

  return `
Good morning, Davis family. Today is ${today}.

Weather: ${weather}

Today in history:
- ${history.join("\n- ")}

Top headlines:
Global:
${headlines.global.map(h => `- ${h.title}`).join("\n")}

US:
${headlines.us.map(h => `- ${h.title}`).join("\n")}

Kansas:
${headlines.kansas.map(h => `- ${h.title}`).join("\n")}

Chiefs:
${headlines.chiefs.map(h => `- ${h.title}`).join("\n")}

Lawrence:
${headlines.lawrence.map(h => `- ${h.title}`).join("\n")}

Have a great day.
`;
}

// ------------------------------------------------------------
// Fake MP3 generator (ALWAYS WORKS)
// ------------------------------------------------------------

function fakeMP3() {
  return Buffer.from("FAKE_MP3_DATA");
}

// ------------------------------------------------------------
// Save MP3 + Update RSS
// ------------------------------------------------------------

function saveMP3(buffer) {
  const date = DateTime.now().setZone("America/Chicago").toFormat("yyyy-MM-dd");
  const filename = `episode-${date}.mp3`;
  fs.writeFileSync(filename, buffer);
  return filename;
}

function updateRSS(filename) {
  const rssPath = "./rss.xml";
  let rss = fs.readFileSync(rssPath, "utf8");

  const url = `https://njdpro.github.io/dailybriefing/${filename}`;

  const item = `
  <item>
    <title>Davis Briefing — ${DateTime.now().setZone("America/Chicago").toFormat("MMMM d, yyyy")}</title>
    <enclosure url="${url}" type="audio/mpeg" />
    <pubDate>${new Date().toUTCString()}</pubDate>
    <guid>${url}</guid>
  </item>
  `;

  rss = rss.replace("</channel>", `${item}\n</channel>`);
  fs.writeFileSync(rssPath, rss);
}

// ------------------------------------------------------------
// Main
// ------------------------------------------------------------

async function run() {
  const headlines = {
    global: await fetchRSS("https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en"),
    us: await fetchRSS("https://news.google.com/rss/headlines/section/topic/NATION?hl=en-US&gl=US&ceid=US:en"),
    kansas: await fetchRSS("https://news.google.com/rss/search?q=Kansas&hl=en-US&gl=US&ceid=US:en", 1),
    chiefs: await fetchRSS("https://news.google.com/rss/search?q=Kansas+City+Chiefs&hl=en-US&gl=US&ceid=US:en", 1),
    lawrence: await fetchRSS("https://news.google.com/rss/search?q=Lawrence+Kansas&hl=en-US&gl=US&ceid=US:en", 1)
  };

  const weather = await getWeather();
  const history = await getHistory();
  const script = buildScript({ weather, history, headlines });

  console.log("SCRIPT GENERATED:");
  console.log(script);

  const mp3 = fakeMP3();
  const filename = saveMP3(mp3);
  updateRSS(filename);
}

run();
