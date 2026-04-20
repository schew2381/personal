// Remove the beige backdrop from every stage_*.png under
// src/assets/plant_stages/*. Samples the four corner pixels to determine
// the background color, then writes alpha based on distance in RGB.
//
// Re-run any time new plant PNGs are added.

import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "src", "assets", "plant_stages");

// Tunables
const NEAR = 22;   // ≤ this RGB distance from bg ⇒ fully transparent
const FAR = 70;    // ≥ this ⇒ fully opaque; linear ramp in between

function dist(a, b, c, r, g, bl) {
  return Math.sqrt((a - r) ** 2 + (b - g) ** 2 + (c - bl) ** 2);
}

async function processOne(file) {
  const buf = await readFile(file);
  const { data, info } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels } = info;
  if (channels !== 4) throw new Error(`unexpected channels=${channels}`);

  // Sample four corners + 8 edge midpoints, average RGB.
  const idx = (x, y) => (y * w + x) * 4;
  const pts = [
    [0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1],
    [Math.floor(w / 2), 0], [Math.floor(w / 2), h - 1],
    [0, Math.floor(h / 2)], [w - 1, Math.floor(h / 2)],
  ];
  let r = 0, g = 0, b = 0;
  for (const [x, y] of pts) {
    const i = idx(x, y);
    r += data[i]; g += data[i + 1]; b += data[i + 2];
  }
  r /= pts.length; g /= pts.length; b /= pts.length;

  for (let i = 0; i < data.length; i += 4) {
    const d = dist(data[i], data[i + 1], data[i + 2], r, g, b);
    let a;
    if (d <= NEAR) a = 0;
    else if (d >= FAR) a = 255;
    else a = Math.round(((d - NEAR) / (FAR - NEAR)) * 255);
    // Preserve existing alpha as a ceiling.
    if (a > data[i + 3]) a = data[i + 3];
    data[i + 3] = a;
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
