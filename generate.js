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
// Build Prompt
// ------------------------------------------------------------

function buildPrompt({ weather, history, headlines }) {
  const today = DateTime.now().setZone("America/Chicago").toFormat("MMMM d, yyyy");

  return `
You are a radio news writer creating a 10–15 minute morning briefing for the Davis family.
Tone: straight-forward, professional, calm, with brief sardonic one-liners.

INTRO:
- Greet the Davis family
- State the date: ${today}
- Weather: ${weather}
- Today in History: ${history.join(" ")}

MAIN NEWS:
Summarize each headline in 2–4 sentences.

Global:
${headlines.global.map(h => `- ${h.title}: ${h.description}`).join("\n")}

US:
${headlines.us.map(h => `- ${h.title}: ${h.description}`).join("\n")}

China:
${headlines.china.map(h => `- ${h.title}: ${h.description}`).join("\n")}

Kansas:
${headlines.kansas.map(h => `- ${h.title}: ${h.description}`).join("\n")}

Chiefs:
${headlines.chiefs.map(h => `- ${h.title}: ${h.description}`).join("\n")}

Lawrence:
${headlines.lawrence.map(h => `- ${h.title}: ${h.description}`).join("\n")}

SECONDARY:
- Paleo-ish dinner idea
- Cinema update + recommendation
- Men's wellness tip

OUTRO:
- Days until Christmas
- Warm sign-off
`;
}

// ------------------------------------------------------------
// Cohere
// ------------------------------------------------------------

async function getScript(prompt) {
  const res = await fetch("https://api.cohere.com/v2/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.COHERE_API_KEY}`
    },
    body: JSON.stringify({
      model: "command-r-plus-08-2024",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt }
          ]
        }
      ]
    })
  });

  const data = await res.json();

  console.log("COHERE RAW RESPONSE:", JSON.stringify(data, null, 2));

  return data?.message?.content?.[0]?.text || null;
}



// ------------------------------------------------------------
// Google TTS
// ------------------------------------------------------------

async function textToSpeech(text) {
  const res = await fetch(
    "https://texttospeech.googleapis.com/v1/text:synthesize?key=" +
      process.env.GOOGLE_TTS_API_KEY,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: "en-US", name: "en-US-Neural2-C" },
        audioConfig: { audioEncoding: "MP3" }
      })
    }
  );

  const data = await res.json();
  return Buffer.from(data.audioContent, "base64");
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
    china: await fetchRSS("https://news.google.com/rss/search?q=China&hl=en-US&gl=US&ceid=US:en"),
    kansas: await fetchRSS("https://news.google.com/rss/search?q=Kansas&hl=en-US&gl=US&ceid=US:en", 1),
    chiefs: await fetchRSS("https://news.google.com/rss/search?q=Kansas+City+Chiefs&hl=en-US&gl=US&ceid=US:en", 1),
    lawrence: await fetchRSS("https://news.google.com/rss/search?q=Lawrence+Kansas&hl=en-US&gl=US&ceid=US:en", 1)
  };

  const weather = await getWeather();
  const history = await getHistory();
  const prompt = buildPrompt({ weather, history, headlines });

  const script = await getScript(prompt);
  console.log("SCRIPT LENGTH:", script?.length);

  if (!script) {
    console.error("Cohere returned no script.");
    return;
  }

 const mp3 = await textToSpeech(script);

const date = DateTime.now().setZone("America/Chicago").toFormat("yyyy-MM-dd");
const filename = `episode-${date}.mp3`;

fs.writeFileSync(filename, mp3);

updateRSS(filename);
}

run();

