import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalogPath = path.join(projectRoot, "public", "data", "prism-stones.json");
const verifiedCodes = new Map([
  ["85c0b41c1c05", "P-ち01★"],
  ["603efc68486a", "P-り02★"],
  ["7db8cecabca4", "P-ぷ 01★"],
  ["18373fb7e38b", "P-ウ07★"],
  ["814872477c24", "P-ウ11★"],
  ["3eea36c61178", "P-ウ06★"],
  ["db989d09a2c5", "P-シ08★"],
  ["82ce75ee2978", "P-ウ17★"],
  ["bf080bc6c3d5", "P-シ19★"],
  ["bbf5782148d1", "P-ウ21★"],
  ["7cd79c2e471a", "P-シ20★"],
  ["3b7458f787f4", "P-ウ20★"],
]);

const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
let changed = 0;
let found = 0;
for (const stone of catalog) {
  const code = verifiedCodes.get(stone.id);
  if (code) {
    found += 1;
    if (stone.code !== code) {
      stone.code = code;
      changed += 1;
    }
  }
}

if (found !== verifiedCodes.size) {
  throw new Error(`Expected ${verifiedCodes.size} catalog entries, found ${found}.`);
}

await writeFile(catalogPath, `${JSON.stringify(catalog)}\n`, "utf8");
console.log(`Verified ${found} catalog corrections; changed ${changed}.`);
