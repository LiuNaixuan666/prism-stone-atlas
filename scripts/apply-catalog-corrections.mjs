import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalogPath = path.join(projectRoot, "public", "data", "prism-stones.json");
const verifiedCodes = new Map(Object.entries(JSON.parse(
  await readFile(path.join(projectRoot, "scripts", "catalog-code-corrections.json"), "utf8"),
)));

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
