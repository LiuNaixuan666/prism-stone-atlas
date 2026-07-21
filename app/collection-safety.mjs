export function mergeCollections(local = {}, remote = {}) {
  const merged = { ...remote };
  for (const [id, localRecord] of Object.entries(local)) {
    const remoteRecord = remote[id];
    if (!remoteRecord || (localRecord.updatedAt || "") >= (remoteRecord.updatedAt || "")) {
      merged[id] = localRecord;
    }
  }
  return merged;
}

export function mergeCustomStones(local = [], remote = []) {
  const merged = new Map(remote.map((stone) => [stone.id, stone]));
  local.forEach((stone) => merged.set(stone.id, stone));
  return Array.from(merged.values());
}

export function createBackupPayload(collection, customStones, exportedAt = new Date().toISOString()) {
  return { version: 3, exportedAt, collection, customStones, corrections: extractCorrections(collection) };
}

export function readBackupPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid backup");
  const collection = value.collection;
  if (!collection || typeof collection !== "object" || Array.isArray(collection)) throw new Error("invalid collection");
  const customStones = value.customStones ?? [];
  if (!Array.isArray(customStones)) throw new Error("invalid custom stones");
  return { collection, customStones };
}

export function extractCorrections(collection = {}) {
  return Object.fromEntries(Object.entries(collection).flatMap(([id, record]) => {
    const customCode = typeof record?.customCode === "string" ? record.customCode.trim() : "";
    const customName = typeof record?.customName === "string" ? record.customName.trim() : "";
    return customCode || customName ? [[id, { customCode, customName, updatedAt: record.updatedAt || "" }]] : [];
  }));
}

export function createCorrectionsPayload(collection, exportedAt = new Date().toISOString()) {
  return { kind: "prism-atlas-corrections", version: 1, exportedAt, corrections: extractCorrections(collection) };
}

export function readCorrectionsPayload(value) {
  if (!value || value.kind !== "prism-atlas-corrections" || !value.corrections || typeof value.corrections !== "object" || Array.isArray(value.corrections)) {
    throw new Error("invalid corrections");
  }
  return value.corrections;
}

export function mergeCorrections(collection = {}, corrections = {}) {
  const merged = { ...collection };
  for (const [id, correction] of Object.entries(corrections)) {
    if (!correction || typeof correction !== "object") continue;
    const customCode = typeof correction.customCode === "string" ? correction.customCode.trim() : "";
    const customName = typeof correction.customName === "string" ? correction.customName.trim() : "";
    if (!customCode && !customName) continue;
    merged[id] = {
      ...merged[id],
      ...(customCode ? { customCode } : {}),
      ...(customName ? { customName } : {}),
      updatedAt: [merged[id]?.updatedAt || "", correction.updatedAt || "", new Date().toISOString()].sort().at(-1),
    };
  }
  return merged;
}

export function createCustomStonesPayload(customStones, exportedAt = new Date().toISOString()) {
  return { kind: "prism-atlas-custom-stones", version: 1, exportedAt, customStones };
}

export function readCustomStonesPayload(value) {
  const customStones = value?.kind === "prism-atlas-custom-stones" ? value.customStones : value?.customStones;
  if (!Array.isArray(customStones)) throw new Error("invalid custom stones");
  return customStones.filter((stone) => stone && typeof stone.id === "string" && stone.custom === true);
}

export function snapshotsDiffer(left, right) {
  return JSON.stringify({ collection: left.collection, customStones: left.customStones }) !==
    JSON.stringify({ collection: right.collection, customStones: right.customStones });
}
