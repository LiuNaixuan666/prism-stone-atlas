import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const referencePath = process.argv[2] && path.resolve(process.argv[2]);
const baselinePath = process.argv[3] && path.resolve(process.argv[3]);
if (!referencePath) throw new Error("Usage: node scripts/update-catalog-codes-from-manifest.mjs REFERENCE_MANIFEST [BASELINE_MANIFEST]");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(field); field = ""; }
    else if (character === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += character;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  const headers = rows.shift().map((value) => value.replace(/^\uFEFF/, ""));
  return rows.filter((value) => value.some(Boolean)).map((value) =>
    Object.fromEntries(headers.map((header, index) => [header, value[index] || ""])),
  );
}

const catalogPath = path.join(projectRoot, "public", "data", "prism-stones.json");
const correctionsPath = path.join(projectRoot, "scripts", "catalog-code-corrections.json");
const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
const reference = parseCsv(await readFile(referencePath, "utf8"));
const baseline = baselinePath ? parseCsv(await readFile(baselinePath, "utf8")) : null;
if (catalog.length !== reference.length || (baseline && baseline.length !== reference.length)) {
  throw new Error("Catalog and manifest lengths do not match.");
}

const corrections = {};
let changed = 0;
for (let index = 0; index < catalog.length; index += 1) {
  const stone = catalog[index];
  const source = reference[index];
  if (stone.type !== source.type || stone.name !== source.clothing || stone.wikiFile !== source.wiki_file) {
    throw new Error(`Catalog structure mismatch at row ${index}: ${stone.id}`);
  }
  if (baseline && baseline[index].code !== source.code) corrections[stone.id] = source.code;
  if (stone.code !== source.code) {
    stone.code = source.code;
    changed += 1;
  }
}

await writeFile(catalogPath, `${JSON.stringify(catalog)}\n`, "utf8");
if (baseline) await writeFile(correctionsPath, `${JSON.stringify(corrections, null, 2)}\n`, "utf8");
console.log(`Updated ${changed} catalog codes; recorded ${Object.keys(corrections).length} parser corrections.`);
