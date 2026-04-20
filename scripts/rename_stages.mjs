import { readdir, rename } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "src", "assets", "plant_stages");

const plants = await readdir(root, { withFileTypes: true });
for (const p of plants) {
  if (!p.isDirectory()) continue;
  const dir = join(root, p.name);
  const files = (await readdir(dir))
    .filter((f) => /\.png$/i.test(f))
    .sort((a, b) => a.localeCompare(b));
  if (files.length === 0) continue;

  const alreadyNamed = files.every((f, i) => f === `stage_${i + 1}.png`);
  if (alreadyNamed) {
    console.log(`skip ${p.name} (already renamed)`);
    continue;
  }

  for (let i = 0; i < files.length; i++) {
    await rename(join(dir, files[i]), join(dir, `__tmp_${i}.png`));
  }
  for (let i = 0; i < files.length; i++) {
    await rename(join(dir, `__tmp_${i}.png`), join(dir, `stage_${i + 1}.png`));
  }
  console.log(`renamed ${p.name} (${files.length} files)`);
}
