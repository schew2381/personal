// Flood-fill the Gemini tan backdrop out of each plant PNG, preserving
// every plant pixel's RGB. Only pixels reachable from the image corners
// AND within TOL of the per-image key color get their alpha zeroed.
// Every other pixel — including pale plant-body pixels that happen to
// be close to the key color — is left untouched, because it isn't
// connected to the outside.
//
// Run:  node scripts/key_plant_bg.mjs

import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "src", "assets", "plant_stages");

// Tight tolerance — the Gemini backdrop is very uniform. 8 was measured
// to contain >95% of true backdrop pixels without reaching into plants.
const TOL = 10;

function median(arr) {
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function sampleKey(data, w, h) {
  // 12 edge sample points, median per channel. Robust against any plant
  // that happens to touch an edge.
  const pts = [
    [0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1],
    [2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3],
    [Math.floor(w / 2), 0], [Math.floor(w / 2), h - 1],
    [0, Math.floor(h / 2)], [w - 1, Math.floor(h / 2)],
  ];
  const rs = [], gs = [], bs = [];
  for (const [x, y] of pts) {
    const i = (y * w + x) * 4;
    rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]);
  }
  return [median(rs), median(gs), median(bs)];
}

function dist(r, g, b, R, G, B) {
  return Math.sqrt((r - R) ** 2 + (g - G) ** 2 + (b - B) ** 2);
}

async function processOne(file) {
  const buf = await readFile(file);
  const { data, info } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels } = info;
  if (channels !== 4) throw new Error(`channels=${channels}`);

  const [R, G, B] = sampleKey(data, w, h);

  // BFS/DFS from all four corners. A pixel is "reached" only if every
  // pixel along a path from a corner is within TOL of the key.
  const mark = new Uint8Array(w * h);
  const stack = [0, w - 1, (h - 1) * w, h * w - 1];
  while (stack.length) {
    const p = stack.pop();
    if (mark[p]) continue;
    const i = p * 4;
    if (dist(data[i], data[i + 1], data[i + 2], R, G, B) > TOL) continue;
    mark[p] = 1;
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }

  // Only modify alpha on reached pixels. Everything else is untouched.
  for (let p = 0; p < w * h; p++) {
    if (mark[p]) data[p * 4 + 3] = 0;
  }

  await sharp(data, { raw: { width: w, height: h, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(file);
}

const dirs = (await readdir(root, { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .map((d) => join(root, d.name));

for (const d of dirs) {
  const files = (await readdir(d))
    .filter((f) => /^stage_\d+\.png$/.test(f))
    .map((f) => join(d, f));
  for (const f of files) {
    await processOne(f);
    process.stdout.write(".");
  }
  console.log(` ${d.split("/").pop()}`);
}
