import fs from "fs";
import fetch from "node-fetch";
import { DateTime } from "luxon";

async function getScript() {
  return "This is a placeholder script. Replace with Cohere later.";
}

async function textToSpeech(text) {
  return Buffer.from("FAKE_MP3_DATA");
}

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

async function run() {
  const script = await getScript();
  const mp3 = await textToSpeech(script);
  const filename = saveMP3(mp3);
  updateRSS(filename);
}

run();
