import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DateTime } from "luxon";

const TZ = process.env.TIMEZONE || "America/Chicago";

const BASE_URL = (
process.env.BASE_URL ||
"https://njdpro.github.io/dailybriefing"
).replace(//$/, "");

const FEED_FILE = "./rss.xml";
const MAX_RSS_ITEMS = Number(process.env.MAX_RSS_ITEMS || 30);
const TTS_CHUNK_BYTES = 4500;

// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------

function requireEnv(name) {
const value = process.env[name];

if (!value) {
throw new Error(
`Missing required environment variable: ${name}`
);
}

return value;
}

function escapeXml(value = "") {
return String(value)
.replaceAll("&", "&")
.replaceAll("<", "<")
.replaceAll(">", ">")
.replaceAll('"', """)
.replaceAll("'", "'");
}

function stripHtml(value = "") {
return String(value)
.replace(/<script[\s\S]*?</script>/gi, " ")
.replace(/<style[\s\S]*?</style>/gi, " ")
.replace(/<[^>]+>/g, " ")
.replace(/ /gi, " ")
.replace(/&/gi, "&")
.replace(/"/gi, '"')
.replace(/'/gi, "'")
.replace(/'/gi, "'")
.replace(/\s+/g, " ")
.trim();
}

// -----------------------------------------------------------------------------
// HTTP / RSS
// -----------------------------------------------------------------------------

async function fetchText(url, options = {}) {
const res = await fetch(url, {
...options,
headers: {
"User-Agent": "DailyBriefingBot/1.0 (+GitHub Actions)",
"Accept":
"application/rss+xml, application/xml, text/xml, application/json, text/plain, */*",
...(options.headers || {})
}
});

const body = await res.text();

if (!res.ok) {
throw new Error(
`${res.status} ${res.statusText} from ${url}: ${body.slice(0, 300)}`
);
}

return body;
}

function extractTag(block, tag) {
const match = block.match(
new RegExp(
`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`,
"i"
)
);

if (!match) {
return "";
}

return stripHtml(
match[1]
.replace(/^<![CDATA[/, "")
.replace(/]]>$/, "")
);
}

async function fetchRSS(url, limit = 2) {
const xml = await fetchText(url);

return [...xml.matchAll(/<item\b[\s\S]*?</item>/gi)]
.slice(0, limit)
.map(match => {
const block = match[0];

```
  return {
    title: stripHtml(extractTag(block, "title")),
    description: stripHtml(
      extractTag(block, "description")
    ),
    link: extractTag(block, "link")
  };
})
.filter(item => item.title);
```

}

async function safeRSS(url, limit = 2) {
try {
return await fetchRSS(url, limit);
} catch (error) {
console.warn(
`RSS fetch failed: ${url}\n${error.message}`
);

```
return [];
```

}
}

// -----------------------------------------------------------------------------
// Weather
// -----------------------------------------------------------------------------

async function getWeather() {
const url =
"https://api.open-meteo.com/v1/forecast" +
"?latitude=38.9717&longitude=-95.2353" +
"&daily=temperature_2m_max,temperature_2m_min,weathercode" +
"&temperature_unit=fahrenheit" +
"&timezone=America%2FChicago";

try {
const data = JSON.parse(await fetchText(url));

```
const high = data.daily.temperature_2m_max[0];
const low = data.daily.temperature_2m_min[0];
const code = data.daily.weathercode[0];

const conditions = {
  0: "clear sky",
  1: "mainly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "fog",
  48: "rime fog",
  51: "light drizzle",
  53: "drizzle",
  55: "heavy drizzle",
  61: "light rain",
  63: "moderate rain",
  65: "heavy rain",
  71: "light snow",
  73: "moderate snow",
  75: "heavy snow",
  80: "light rain showers",
  81: "moderate rain showers",
  82: "heavy rain showers",
  95: "thunderstorm",
  96: "thunderstorm with hail",
  99: "thunderstorm with heavy hail"
};

return `High ${high} degrees, low ${low} degrees, ${
  conditions[code] || "variable conditions"
}.`;
```

} catch (error) {
console.warn(
`Weather fetch failed: ${error.message}`
);

```
return "Weather data is unavailable this morning.";
```

}
}

// -----------------------------------------------------------------------------
// Today in History
// -----------------------------------------------------------------------------

async function getHistory() {
try {
const data = JSON.parse(
await fetchText("https://history.muffinlabs.com/date")
);

```
return (data?.data?.Events || [])
  .slice(0, 3)
  .map(event => event.text)
  .filter(Boolean);
```

} catch (error) {
console.warn(
`History fetch failed: ${error.message}`
);

```
return [
  "Today has its own history, and we're making some more of it."
];
```

}
}

// -----------------------------------------------------------------------------
// Script generation
// -----------------------------------------------------------------------------

function formatSection(items) {
if (!items.length) {
return "- No reliable stories were returned for this section.";
}

return items
.map(
headline =>
`- ${headline.title}${
          headline.description
            ? ` — ${headline.description}`
            : ""
        }`
)
.join("\n");
}

function buildPrompt({
weather,
history,
headlines
}) {
const today = DateTime.now()
.setZone(TZ)
.toFormat("MMMM d, yyyy");

return `You are the writer and host of a daily 10–15 minute morning news podcast for the Davis family.

Write ONLY the spoken script. Do not use markdown, bullet points, source notes, citations, stage directions, or production instructions.

Tone: straightforward, warm, professional, calm, occasionally dry or sardonic. Never sensationalize. Do not invent facts. The supplied headlines are source material; distinguish uncertainty when a headline does not provide enough detail.

Structure:

1. Brief welcome to the Davis family, date, and weather.
2. "Today in History" with the supplied historical events.
3. Main news, prioritizing the most consequential stories. Cover Global, U.S., China, Kansas, Kansas City Chiefs, and Lawrence. Give context rather than merely reading headlines.
4. A short paleo-ish dinner idea.
5. A short cinema/movie update and one recommendation.
6. One practical men's wellness tip. Keep it general lifestyle advice, not medical diagnosis or treatment.
7. Days until Christmas and a warm sign-off.

Aim for about 1,900–2,300 spoken words so the finished episode is comfortably in the 10–15 minute range.

DATE:
${today}

WEATHER:
${weather}

TODAY IN HISTORY:
${history.join(" ")}

GLOBAL:
${formatSection(headlines.global)}

U.S.:
${formatSection(headlines.us)}

CHINA:
${formatSection(headlines.china)}

KANSAS:
${formatSection(headlines.kansas)}

KANSAS CITY CHIEFS:
${formatSection(headlines.chiefs)}

LAWRENCE:
${formatSection(headlines.lawrence)}
`;
}

async function getScript(prompt) {
const apiKey = requireEnv("COHERE_API_KEY");

const res = await fetch(
"https://api.cohere.com/v2/chat",
{
method: "POST",
headers: {
"Content-Type": "application/json",
Authorization: `Bearer ${apiKey}`
},
body: JSON.stringify({
model:
process.env.COHERE_MODEL ||
"command-a-plus-05-2026",
max_tokens: 3500,
temperature: 0.5,
thinking: {
type: "disabled"
},
messages: [
{
role: "system",
content:
"You write factual, polished spoken-word news scripts."
},
{
role: "user",
content: prompt
}
]
})
}
);

const body = await res.text();

if (!res.ok) {
throw new Error(
`Cohere ${res.status}: ${body.slice(0, 1000)}`
);
}

const data = JSON.parse(body);
const content = data?.message?.content || [];

const script = content
.filter(
part =>
part.type === "text" &&
part.text
)
.map(part => part.text)
.join("\n")
.trim();

if (!script) {
throw new Error(
`Cohere returned no usable text. finish_reason=${
        data?.finish_reason || "unknown"
      }`
);
}

return script;
}

// -----------------------------------------------------------------------------
// TTS chunking
// -----------------------------------------------------------------------------

function splitForTTS(
text,
maxBytes = TTS_CHUNK_BYTES
) {
const sentences =
text.match(
/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g
) || [text];

const chunks = [];
let current = "";

for (const sentence of sentences) {
const trimmedSentence =
sentence.trim();

```
const candidate = current
  ? `${current} ${trimmedSentence}`
  : trimmedSentence;

if (
  Buffer.byteLength(candidate, "utf8") <=
  maxBytes
) {
  current = candidate;
  continue;
}

if (current) {
  chunks.push(current);
}

if (
  Buffer.byteLength(
    trimmedSentence,
    "utf8"
  ) <= maxBytes
) {
  current = trimmedSentence;
  continue;
}

// Extremely long sentence:
// split on whitespace without exceeding byte limit.
let piece = "";

for (const word of trimmedSentence.split(
  /\s+/
)) {
  const candidatePiece = piece
    ? `${piece} ${word}`
    : word;

  if (
    Buffer.byteLength(
      candidatePiece,
      "utf8"
    ) <= maxBytes
  ) {
    piece = candidatePiece;
  } else {
    if (piece) {
      chunks.push(piece);
    }

    piece = word;
  }
}

current = piece;
```

}

if (current) {
chunks.push(current);
}

return chunks;
}

// -----------------------------------------------------------------------------
// Google TTS + FFmpeg
// -----------------------------------------------------------------------------

async function textToSpeech(
text,
outputFile
) {
const apiKey =
requireEnv("GOOGLE_TTS_API_KEY");

const chunks = splitForTTS(text);

// IMPORTANT:
// Both paths are absolute. The final MP3 is outside .tts,
// so deleting .tts cannot delete the finished episode.
const tempDir = path.resolve("./.tts");
const finalOutput =
path.resolve(outputFile);

fs.rmSync(tempDir, {
recursive: true,
force: true
});

fs.mkdirSync(tempDir, {
recursive: true
});

console.log(
`TTS: ${chunks.length} chunks`
);

// Generate individual MP3 chunks.
for (let i = 0; i < chunks.length; i++) {
const res = await fetch(
"https://texttospeech.googleapis.com/v1/text:synthesize?key=" +
encodeURIComponent(apiKey),
{
method: "POST",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify({
input: {
text: chunks[i]
},
voice: {
languageCode:
process.env.TTS_LANGUAGE ||
"en-US",
name:
process.env.TTS_VOICE ||
"en-US-Neural2-C"
},
audioConfig: {
audioEncoding: "MP3",
speakingRate: Number(
process.env.TTS_SPEAKING_RATE ||
1.0
)
}
})
}
);

```
const body = await res.text();

if (!res.ok) {
  throw new Error(
    `Google TTS ${res.status}: ${body.slice(
      0,
      1000
    )}`
  );
}

const data = JSON.parse(body);

if (!data.audioContent) {
  throw new Error(
    `Google TTS returned no audio: ${body.slice(
      0,
      500
    )}`
  );
}

const partPath = path.join(
  tempDir,
  `part-${String(i).padStart(
    4,
    "0"
  )}.mp3`
);

fs.writeFileSync(
  partPath,
  Buffer.from(
    data.audioContent,
    "base64"
  )
);
```

}

// Build FFmpeg concat file.
const concatFile = path.join(
tempDir,
"concat.txt"
);

const partFiles = chunks.map(
(_, i) =>
`part-${String(i).padStart(
        4,
        "0"
      )}.mp3`
);

fs.writeFileSync(
concatFile,
partFiles
.map(
file =>
`file '${file.replaceAll(
            "'",
            "'\\''"
          )}'`
)
.join("\n")
);

try {
execFileSync(
"ffmpeg",
[
"-hide_banner",
"-loglevel",
"error",
"-f",
"concat",
"-safe",
"0",
"-i",
"concat.txt",
"-c",
"copy",
"-y",
finalOutput
],
{
cwd: tempDir,
stdio: "inherit"
}
);

```
// Verify FFmpeg actually created the final MP3.
if (!fs.existsSync(finalOutput)) {
  throw new Error(
    `FFmpeg completed but did not create ${finalOutput}`
  );
}

const stats =
  fs.statSync(finalOutput);

if (stats.size === 0) {
  throw new Error(
    `FFmpeg created an empty MP3: ${finalOutput}`
  );
}

console.log(
  `TTS complete: ${finalOutput} (${stats.size} bytes)`
);
```

} catch (error) {
throw new Error(
`ffmpeg could not combine the TTS chunks: ${error.message}`
);
} finally {
// The final MP3 is outside .tts, so this is safe.
fs.rmSync(tempDir, {
recursive: true,
force: true
});
}
}

// -----------------------------------------------------------------------------
// RSS
// -----------------------------------------------------------------------------

function updateRSS({
filename,
date,
durationSeconds,
fileSize
}) {
const rssPath = FEED_FILE;

const existing = fs.readFileSync(
rssPath,
"utf8"
);

const itemXml = `   <item>     <title>Davis Briefing — ${escapeXml(
      date.toFormat("MMMM d, yyyy")
    )}</title>     <description>
      Daily morning news briefing for the Davis family.     </description>     <enclosure
      url="${escapeXml(
        `${BASE_URL}/${filename}`
      )}"
      length="${fileSize}"
      type="audio/mpeg"/>     <pubDate>${date
      .toUTC()
      .toString()}</pubDate>     <guid isPermaLink="false">
      davis-briefing-${date.toFormat(
        "yyyy-MM-dd"
      )}     </guid>   </item>`;

const items = [
...existing.matchAll(
/<item>[\s\S]*?</item>/gi
)
].map(match => match[0]);

const todayGuid =
`davis-briefing-${date.toFormat(
      "yyyy-MM-dd"
    )}`;

const newItems = [
itemXml.trim(),
...items.filter(
item => !item.includes(todayGuid)
)
].slice(0, MAX_RSS_ITEMS);

const channelStart =
existing.indexOf("<channel>");

const channelEnd =
existing.lastIndexOf("</channel>");

if (
channelStart === -1 ||
channelEnd === -1
) {
throw new Error(
"rss.xml has no channel element"
);
}

const header = existing.slice(
0,
channelStart
);

const channel = existing.slice(
channelStart,
channelEnd
);

const staticChannel = channel
.replace(
/<item>[\s\S]*?</item>/gi,
""
)
.trimEnd();

const footer =
existing.slice(channelEnd);

fs.writeFileSync(
rssPath,
`${header}${staticChannel}
${newItems
  .map(item => `  ${item}`)
  .join("\n")}
${footer}`,
"utf8"
);

console.log(
`RSS updated: ${rssPath} (${durationSeconds}s estimated duration)`
);
}

// -----------------------------------------------------------------------------
// Episode duration
// -----------------------------------------------------------------------------

function estimateDurationSeconds(text) {
const words = text
.trim()
.split(/\s+/)
.length;

const wordsPerMinute = Number(
process.env.WORDS_PER_MINUTE || 150
);

return Math.round(
(words / wordsPerMinute) * 60
);
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function run() {
const date =
DateTime.now().setZone(TZ);

const dateKey =
date.toFormat("yyyy-MM-dd");

const filename =
`episode-${dateKey}.mp3`;

console.log(
`Generating ${filename} for ${date.toISO()}`
);

// Gather news.
const headlines = {
global: await safeRSS(
"https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en",
3
),

```
us: await safeRSS(
  "https://news.google.com/rss/headlines/section/topic/NATION?hl=en-US&gl=US&ceid=US:en",
  3
),

china: await safeRSS(
  "https://news.google.com/rss/search?q=China&hl=en-US&gl=US&ceid=US:en",
  2
),

kansas: await safeRSS(
  "https://news.google.com/rss/search?q=Kansas&hl=en-US&gl=US&ceid=US:en",
  2
),

chiefs: await safeRSS(
  "https://news.google.com/rss/search?q=Kansas+City+Chiefs&hl=en-US&gl=US&ceid=US:en",
  2
),

lawrence: await safeRSS(
  "https://news.google.com/rss/search?q=Lawrence+Kansas&hl=en-US&gl=US&ceid=US:en",
  2
)
```

};

// Weather and history.
const weather =
await getWeather();

const history =
await getHistory();

// Generate script.
const prompt = buildPrompt({
weather,
history,
headlines
});

const script =
await getScript(prompt);

const wordCount =
script.split(/\s+/).length;

console.log(
`Script: ${script.length} characters, ~${wordCount} words`
);

// Generate audio.
await textToSpeech(
script,
filename
);

// Verify final MP3.
if (!fs.existsSync(filename)) {
throw new Error(
`Expected MP3 was not created: ${filename}`
);
}

const stats =
fs.statSync(filename);

if (stats.size === 0) {
throw new Error(
`Expected MP3 is empty: ${filename}`
);
}

console.log(
`Final MP3 verified: ${filename} (${stats.size} bytes)`
);

// Update RSS.
updateRSS({
filename,
date,
durationSeconds:
estimateDurationSeconds(script),
fileSize: stats.size
});

console.log(
`Created ${filename} (${stats.size} bytes) and updated ${FEED_FILE}.`
);
}

// -----------------------------------------------------------------------------
// Run
// -----------------------------------------------------------------------------

run().catch(error => {
console.error(error);
process.exit(1);
});
