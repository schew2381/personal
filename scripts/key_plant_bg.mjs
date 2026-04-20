// Enhanced keying for plant stage PNGs. Four passes, non-destructive to
// plant RGB:
//
//   1. Strict flood from corners (TOL=10) — zero the obvious backdrop.
//   2. Relaxed inward chew (TOL=22, up to 4 rings) — eats tan grid lines
//      and antialiased tan rim adjacent to already-flooded regions.
//   3. Connected-component cleanup — any remaining opaque component
//      whose average color is tan-ish gets zeroed, regardless of size.
//      This catches disconnected tan blobs (e.g. wild_grass_seed_head
//      stage_6) that are surrounded by plant or too dark for flood.
//   4. Alpha-only 3-tap Gaussian blur — antialiases the cut edge so
//      it doesn't look pixel-stepped.
//
// Writes test output to tests/plant_stages/ so it can be validated
// without touching the source images. Processes:
//   - every wood_anenome/*.png (has vertical line; needs smoothing)
//   - wild_grass_seed_head/stage_6.png (giant tan blob at bottom)
//
// Run:  node scripts/key_plant_bg_v2.mjs

import { readdir, readFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "..", "src", "assets", "plant_stages");

// CLI: `node scripts/key_plant_bg_v2.mjs`            — in place, all plants
//      `node scripts/key_plant_bg_v2.mjs --test`     — write to tests/
//      `node scripts/key_plant_bg_v2.mjs <name>…`    — limit to named plants
const args = process.argv.slice(2);
const testMode = args.includes("--test");
const named = args.filter((a) => !a.startsWith("--"));
const testRoot = join(here, "..", "tests", "plant_stages");

const TOL_STRICT = 10;          // corner flood tolerance
const TOL_LOOSE = 22;           // boundary-relaxed tolerance
const LOOSE_ITERS = 4;          // max chew depth in pixels
const COMPONENT_TAN_TOL = 36;   // kill stray components this close to key color

function median(arr) {
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function sampleKey(data, w, h) {
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

async function processOne(inFile, outFile) {
  const buf = await readFile(inFile);
  const { data, info } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels } = info;
  if (channels !== 4) throw new Error(`channels=${channels}`);

  const [R, G, B] = sampleKey(data, w, h);
  const mark = new Uint8Array(w * h);

  // --- Pass 1: strict corner flood.
  {
    const stack = [0, w - 1, (h - 1) * w, h * w - 1];
    while (stack.length) {
      const p = stack.pop();
      if (mark[p]) continue;
      const i = p * 4;
      if (dist(data[i], data[i + 1], data[i + 2], R, G, B) > TOL_STRICT) continue;
      mark[p] = 1;
      const x = p % w;
      const y = (p - x) / w;
      if (x > 0) stack.push(p - 1);
      if (x < w - 1) stack.push(p + 1);
      if (y > 0) stack.push(p - w);
      if (y < h - 1) stack.push(p + w);
    }
  }

  // --- Pass 2: relaxed inward chew at edges.
  for (let iter = 0; iter < LOOSE_ITERS; iter++) {
    const added = [];
    for (let p = 0; p < w * h; p++) {
      if (mark[p]) continue;
      const x = p % w;
      const y = (p - x) / w;
      const hasMarkedNeighbor =
        (x > 0 && mark[p - 1]) ||
        (x < w - 1 && mark[p + 1]) ||
        (y > 0 && mark[p - w]) ||
        (y < h - 1 && mark[p + w]);
      if (!hasMarkedNeighbor) continue;
      const i = p * 4;
      if (dist(data[i], data[i + 1], data[i + 2], R, G, B) > TOL_LOOSE) continue;
      added.push(p);
    }
    if (added.length === 0) break;
    for (const p of added) mark[p] = 1;
  }

  // --- Pass 3: component cleanup. Flood-fill remaining opaque pixels
  // into components; compute each component's mean color; zero any
  // component whose mean color is within COMPONENT_TAN_TOL of key.
  const compId = new Int32Array(w * h).fill(-1);
  const comps = [];
  for (let p0 = 0; p0 < w * h; p0++) {
    if (mark[p0] || compId[p0] !== -1) continue;
    const id = comps.length;
    const c = { size: 0, sumR: 0, sumG: 0, sumB: 0 };
    const s = [p0];
    while (s.length) {
      const q = s.pop();
      if (compId[q] !== -1 || mark[q]) continue;
      compId[q] = id;
      const i = q * 4;
      c.size++;
      c.sumR += data[i];
      c.sumG += data[i + 1];
      c.sumB += data[i + 2];
      const x = q % w;
      const y = (q - x) / w;
      if (x > 0 && compId[q - 1] === -1 && !mark[q - 1]) s.push(q - 1);
      if (x < w - 1 && compId[q + 1] === -1 && !mark[q + 1]) s.push(q + 1);
      if (y > 0 && compId[q - w] === -1 && !mark[q - w]) s.push(q - w);
      if (y < h - 1 && compId[q + w] === -1 && !mark[q + w]) s.push(q + w);
    }
    comps.push(c);
  }
  // Find largest component — always treat it as plant.
  let largestId = -1, largestSize = 0;
  for (let id = 0; id < comps.length; id++) {
    if (comps[id].size > largestSize) {
      largestSize = comps[id].size;
      largestId = id;
    }
  }
  const kill = new Uint8Array(comps.length);
  for (let id = 0; id < comps.length; id++) {
    if (id === largestId) continue;
    const c = comps[id];
    const aR = c.sumR / c.size;
    const aG = c.sumG / c.size;
    const aB = c.sumB / c.size;
    if (dist(aR, aG, aB, R, G, B) <= COMPONENT_TAN_TOL) kill[id] = 1;
  }

  // Write binary alpha from mark + kill.
  for (let p = 0; p < w * h; p++) {
    const id = compId[p];
    const killMe = mark[p] || (id !== -1 && kill[id]);
    data[p * 4 + 3] = killMe ? 0 : 255;
  }

  // --- Pass 4: antialias alpha edges with a 3-tap Gaussian.
  const alpha = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) alpha[p] = data[p * 4 + 3];
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const l = x > 0 ? alpha[p - 1] : alpha[p];
      const r = x < w - 1 ? alpha[p + 1] : alpha[p];
      tmp[p] = (l + 2 * alpha[p] + r) >> 2;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const u = y > 0 ? tmp[p - w] : tmp[p];
      const d = y < h - 1 ? tmp[p + w] : tmp[p];
      alpha[p] = (u + 2 * tmp[p] + d) >> 2;
    }
  }
  for (let p = 0; p < w * h; p++) data[p * 4 + 3] = alpha[p];

  await mkdir(dirname(outFile), { recursive: true });
  await sharp(data, { raw: { width: w, height: h, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(outFile);

  // Quick stats for the run log.
  let clear = 0, opaque = 0, partial = 0;
  for (let p = 0; p < w * h; p++) {
    const a = data[p * 4 + 3];
    if (a === 0) clear++;
    else if (a === 255) opaque++;
    else partial++;
  }
  const tot = w * h;
  return {
    pct: {
      clear: (clear / tot * 100).toFixed(1),
      opaque: (opaque / tot * 100).toFixed(1),
      partial: (partial / tot * 100).toFixed(1),
    },
    components: comps.length,
    killed: comps.reduce((n, _, id) => n + (kill[id] ? 1 : 0), 0),
    key: `${R},${G},${B}`,
  };
}

const plants = (await readdir(srcRoot, { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .filter((n) => named.length === 0 || named.includes(n));

for (const plant of plants) {
  const dir = join(srcRoot, plant);
  const files = (await readdir(dir))
    .filter((f) => /^stage_\d+\.png$/.test(f))
    .sort();
  for (const f of files) {
    const inFile = join(dir, f);
    const outFile = testMode
      ? join(testRoot, plant, f)
      : inFile;
    const stats = await processOne(inFile, outFile);
    console.log(
      `${plant}/${f} — clear=${stats.pct.clear}% opaque=${stats.pct.opaque}% partial=${stats.pct.partial}% · comps=${stats.components} killed=${stats.killed} key=(${stats.key})`,
    );
  }
}
