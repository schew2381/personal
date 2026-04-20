// Add transparency to plant stage PNGs based on LUMINANCE only, without
// touching RGB values. Pixels darker than a floor are fully opaque;
// pixels brighter than a ceiling are fully transparent; in between is a
// smooth ramp. The image's hues remain untouched, so painterly color is
// preserved (unlike an RGB-distance key which washes saturated pixels).
//
// Run: node scripts/key_plant_bg.mjs

import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "src", "assets", "plant_stages");

// Tunables — wider range = softer edge. Values are perceptual luminance
// 0..255. The Gemini backdrop sits around 235–245; tuned below.
const LUMA_OPAQUE = 205;   // ≤ this luminance → fully opaque
const LUMA_CLEAR = 238;    // ≥ this luminance → fully transparent

function luma(r, g, b) {
  // Rec. 709 perceptual weights
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

async function processOne(file) {
  const buf = await readFile(file);
  const { data, info } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels } = info;
  if (channels !== 4) throw new Error(`unexpected channels=${channels}`);

  for (let i = 0; i < data.length; i += 4) {
    const y = luma(data[i], data[i + 1], data[i + 2]);
    let a;
    if (y <= LUMA_OPAQUE) a = 255;
    else if (y >= LUMA_CLEAR) a = 0;
    else {
      // linear ramp, then ease with a gamma so midtones stay visible
      const t = (y - LUMA_OPAQUE) / (LUMA_CLEAR - LUMA_OPAQUE);
      a = Math.round((1 - Math.pow(t, 1.6)) * 255);
    }
    // Preserve existing alpha as a ceiling.
    if (a > data[i + 3]) a = data[i + 3];
    data[i + 3] = a;
    // RGB values are NOT modified — colors are preserved exactly.
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
