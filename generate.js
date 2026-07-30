import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DateTime } from "luxon";

const TZ = process.env.TIMEZONE || "America/Chicago";

const BASE_URL = "https://njdpro.github.io/dailybriefing";

const FEED_FILE = "./rss.xml";
const MAX_RSS_ITEMS = Number(process.env.MAX_RSS_ITEMS || 30);
const TTS_CHUNK_BYTES = 4500;

console.log("generate.js loaded successfully");
