import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import {
  createBackupPayload,
  createCorrectionsPayload,
  createCustomStonesPayload,
  mergeCorrections,
  mergeCollections,
  mergeCustomStones,
  readBackupPayload,
  readCorrectionsPayload,
  readCustomStonesPayload,
  snapshotsDiffer,
} from "../app/collection-safety.mjs";

test("newer collection record wins without dropping records from either side", () => {
  const local = {
    localOnly: { owned: true, updatedAt: "2026-07-21T10:00:00.000Z" },
    shared: { owned: true, updatedAt: "2026-07-21T12:00:00.000Z" },
  };
  const remote = {
    remoteOnly: { owned: true, updatedAt: "2026-07-21T11:00:00.000Z" },
    shared: { owned: false, updatedAt: "2026-07-21T09:00:00.000Z" },
  };
  assert.deepEqual(mergeCollections(local, remote), {
    remoteOnly: remote.remoteOnly,
    shared: local.shared,
    localOnly: local.localOnly,
  });
});

test("legacy records without timestamps prefer the current device", () => {
  const local = { stone: { owned: true } };
  const remote = { stone: { owned: false } };
  assert.equal(mergeCollections(local, remote).stone.owned, true);
});

test("custom stones merge by id and keep the current device version", () => {
  const local = [{ id: "same", name: "本机名称" }, { id: "local", name: "本机新增" }];
  const remote = [{ id: "same", name: "云端名称" }, { id: "remote", name: "云端新增" }];
  const merged = mergeCustomStones(local, remote);
  assert.deepEqual(new Set(merged.map((stone) => stone.id)), new Set(["same", "local", "remote"]));
  assert.equal(merged.find((stone) => stone.id === "same").name, "本机名称");
});

test("legacy backups remain importable and current backups round-trip", () => {
  const versionOne = { version: 1, collection: { a: { owned: true } } };
  assert.deepEqual(readBackupPayload(versionOne), { collection: versionOne.collection, customStones: [] });
  const versionTwo = createBackupPayload(versionOne.collection, [{ id: "custom" }], "2026-07-21T00:00:00.000Z");
  assert.equal(versionTwo.version, 3);
  assert.deepEqual(readBackupPayload(versionTwo), { collection: versionTwo.collection, customStones: versionTwo.customStones });
});

test("custom stones and manual catalog corrections can be shared separately", () => {
  const collection = {
    stone: { owned: true, customName: "订正名称", customCode: "NEW-01", updatedAt: "2026-07-21T00:00:00.000Z" },
    untouched: { owned: true },
  };
  const corrections = createCorrectionsPayload(collection, "2026-07-21T00:00:00.000Z");
  assert.deepEqual(readCorrectionsPayload(corrections), corrections.corrections);
  const merged = mergeCorrections({ stone: { owned: true, note: "保留备注" } }, corrections.corrections);
  assert.equal(merged.stone.customName, "订正名称");
  assert.equal(merged.stone.note, "保留备注");

  const custom = [{ id: "custom-one", custom: true, code: "C-01", image: "data:image/webp;base64,AA" }];
  assert.deepEqual(readCustomStonesPayload(createCustomStonesPayload(custom)), custom);
});

test("recovery comparison ignores snapshot metadata", () => {
  const data = { collection: { a: { owned: true } }, customStones: [] };
  assert.equal(snapshotsDiffer({ ...data, savedAt: "old" }, { ...data, savedAt: "new" }), false);
  assert.equal(snapshotsDiffer(data, { collection: {}, customStones: [] }), true);
});

test("PWA metadata and service worker keep the application shell offline", async () => {
  const [manifestText, worker, app] = await Promise.all([
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
    readFile(new URL("../app/PrismAtlas.tsx", import.meta.url), "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.match(worker, /skipWaiting/);
  assert.match(worker, /clients\.claim/);
  assert.match(worker, /data\/prism-stones\.json/);
  assert.match(worker, /document\.matchAll/);
  assert.match(worker, /self\.registration\.scope/);
  assert.match(worker, /ASSET_PATH/);
  assert.match(worker, /API_PATH/);
  assert.match(worker, /cacheCatalogImages/);
  assert.match(app, /prism-atlas-collection-v1/);
  assert.match(app, /prism-atlas-custom-v1/);
  assert.match(app, /prism-atlas-local/);
});

test("catalog images and verified source codes are bundled locally", async () => {
  const [catalogText, imageFiles, correctionsText] = await Promise.all([
    readFile(new URL("../public/data/prism-stones.json", import.meta.url), "utf8"),
    readdir(new URL("../public/prism-stones/", import.meta.url)),
    readFile(new URL("../scripts/catalog-code-corrections.json", import.meta.url), "utf8"),
  ]);
  const catalog = JSON.parse(catalogText);
  const available = catalog.filter((stone) => stone.image);
  const bundled = new Set(imageFiles);
  assert.equal(available.length, 2073);
  assert.equal(imageFiles.length, 2073);
  assert.equal(available.some((stone) => /^https?:/.test(stone.image)), false);
  for (const stone of available) {
    assert.equal(bundled.has(stone.image.replace(/^prism-stones\//, "")), true, stone.image);
  }
  const corrected = Object.fromEntries(catalog.map((stone) => [stone.id, stone.code]));
  const parserCorrections = JSON.parse(correctionsText);
  assert.equal(Object.keys(parserCorrections).length, 57);
  assert.equal(corrected["85c0b41c1c05"], "P-ち01★");
  assert.equal(corrected["3b7458f787f4"], "P-ウ20★");
  assert.equal(corrected["a1d28db185c9"], "P-シ04★");
  assert.equal(corrected["0db1d713e987"], "P-シ05★");
  assert.equal(corrected["5ca59be12dca"], "P-シ06★");
  assert.equal(corrected["664ff8a175d0"], "P-シ07★");
  assert.equal(corrected["ce600e30f1d5"], "B07-S03★");
});

test("GitHub Pages build uses the repository base path and disables cloud UI", async () => {
  const [html, entry, worker] = await Promise.all([
    readFile(new URL("../pages-dist/index.html", import.meta.url), "utf8"),
    readFile(new URL("../github-pages/main.tsx", import.meta.url), "utf8"),
    readFile(new URL("../pages-dist/sw.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /\/prism-stone-atlas\/assets\//);
  assert.match(html, /manifest\.webmanifest/);
  assert.match(entry, /cloudEnabled=\{false\}/);
  assert.match(worker, /self\.registration\.scope/);
});
