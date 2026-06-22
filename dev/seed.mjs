// Dev-only seeder: fills MongoDB with fake transcription documents and writes a
// matching sample audio file per document into RECORDINGS_DIR. Generates fresh
// data on every run (drops the collection + clears the recordings dir first).
import { MongoClient } from "mongodb";
import { writeFile, mkdir, rm, readdir } from "node:fs/promises";
import path from "node:path";

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://mongo:27017";
const MONGODB_DB = process.env.MONGODB_DB || "transcriber";
const RECORDINGS_DIR = process.env.RECORDINGS_DIR || "/recordings";
const KEY = process.env.TRANSCRIPTION_KEY || "whisper";
const DAYS = Number(process.env.SEED_DAYS || 3);
const PER_DAY = Number(process.env.SEED_PER_DAY || 14);

const FREQS = [146950000, 146350000, 147210000, 145500000];
const PHRASES = [
  "Dispatch to unit twelve, respond to a structure fire on the north side, multiple callers reporting.",
  "Copy that, en route, ETA four minutes.",
  "Be advised, heavy smoke showing from the second floor, requesting a second alarm.",
  "Engine three on scene, establishing command, pulling a line to the alpha side.",
  "All units, water supply established off the hydrant at Fifth and Main.",
  "Control, show us out at the scene, nothing further at this time.",
  "Requesting a welfare check at the corner of Oak and Lincoln.",
  "Negative on that last, repeat your traffic.",
  "We have one patient, conscious and breathing, requesting medical.",
  "Roger, staging until the scene is secure.",
  "Tower, cleared for the approach, winds calm.",
  "Mayday, mayday, mayday — vessel taking on water two miles offshore.",
];

// Minimal 16-bit PCM mono WAV with a speech-like amplitude envelope.
function makeWav(durationSec) {
  const sr = 8000;
  const n = Math.floor(sr * durationSec);
  const data = Buffer.alloc(n * 2);
  let i = 0;
  while (i < n) {
    if (Math.random() < 0.55) {
      const burst = Math.floor((0.15 + Math.random() * 0.35) * sr);
      const amp = 0.3 + Math.random() * 0.7;
      for (let j = 0; j < burst && i + j < n; j++) {
        const env = amp * Math.sin((Math.PI * j) / burst);
        const v = env * Math.sin((2 * Math.PI * 320 * (i + j)) / sr) * 0.8;
        data.writeInt16LE(Math.max(-1, Math.min(1, v)) * 32767, (i + j) * 2);
      }
      i += burst;
    } else {
      i += Math.floor((0.1 + Math.random() * 0.2) * sr);
    }
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sr, 24);
  header.writeUInt32LE(sr * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const pad = (x) => String(x).padStart(2, "0");

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const col = client.db(MONGODB_DB).collection("transcriptions");

  await col.deleteMany({});
  // Clear the contents of RECORDINGS_DIR without removing the dir itself (it's a
  // volume mount point, so rmdir on it would fail with EBUSY).
  await mkdir(RECORDINGS_DIR, { recursive: true });
  for (const entry of await readdir(RECORDINGS_DIR)) {
    await rm(path.join(RECORDINGS_DIR, entry), { recursive: true, force: true });
  }

  const docs = [];
  const now = new Date();

  // Start one day ahead of UTC so the client's local "today" always has data,
  // regardless of how its timezone offsets from the UTC-based day buckets.
  for (let d = -1; d < DAYS; d++) {
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - d));
    const dayDir = `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}`;

    for (let k = 0; k < PER_DAY; k++) {
      const date = new Date(day);
      date.setUTCHours(Math.floor(Math.random() * 24), Math.floor(Math.random() * 60), Math.floor(Math.random() * 60));
      const freq = pick(FREQS);
      const stamp = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}_${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
      const filename = `r__${stamp}_${freq}.wav`;
      const relPath = `${dayDir}/${filename}`;

      await mkdir(path.join(RECORDINGS_DIR, dayDir), { recursive: true });
      await writeFile(path.join(RECORDINGS_DIR, relPath), makeWav(2 + Math.random() * 6));

      docs.push({
        filename,
        rel_path: relPath,
        date,
        frequency_hz: String(freq),
        transcriptions: {
          [KEY]: { transcription: pick(PHRASES), model: "dev-seed", language: "en", date: new Date() },
        },
      });
    }
  }

  await col.insertMany(docs);
  console.log(`Seeded ${docs.length} recordings into ${MONGODB_DB}.transcriptions and ${RECORDINGS_DIR}`);
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
