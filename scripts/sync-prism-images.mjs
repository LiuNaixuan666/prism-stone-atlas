import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.resolve(process.argv[2] || path.join(projectRoot, "..", "Prism Stones", "manifest_seasoned.csv"));
const catalogPath = path.join(projectRoot, "public", "data", "prism-stones.json");
const imageDirectory = path.join(projectRoot, "public", "prism-stones");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  const [rawHeaders, ...values] = rows;
  const headers = rawHeaders.map((header) => header.replace(/^\uFEFF/, ""));
  return values.filter((value) => value.some(Boolean)).map((value) =>
    Object.fromEntries(headers.map((header, index) => [header, value[index] || ""])),
  );
}

const manifest = parseCsv(await readFile(manifestPath, "utf8"));
const catalog = JSON.parse(await readFile(catalogPath, "utf8"));

if (manifest.length !== catalog.length) {
  throw new Error(`Manifest/catalog length mismatch: ${manifest.length} != ${catalog.length}`);
}

await mkdir(imageDirectory, { recursive: true });
let copied = 0;
let missing = 0;

for (let index = 0; index < catalog.length; index += 1) {
  const stone = catalog[index];
  const source = manifest[index];
  if (source.type !== stone.type || source.code !== stone.code || source.clothing !== stone.name) {
    throw new Error(`Manifest/catalog row mismatch at ${index}: ${source.code} / ${stone.code}`);
  }

  if (source.status !== "downloaded" || !source.organized_as) {
    stone.image = "";
    missing += 1;
    continue;
  }

  const extension = path.extname(source.organized_as).toLowerCase();
  const filename = `${stone.id}${extension}`;
  await copyFile(source.organized_as, path.join(imageDirectory, filename));
  stone.image = `prism-stones/${filename}`;
  copied += 1;
}

await writeFile(catalogPath, `${JSON.stringify(catalog)}\n`, "utf8");
console.log(`Copied ${copied} local images; ${missing} catalog entries have no source image.`);
