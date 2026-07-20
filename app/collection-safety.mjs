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
  return { version: 2, exportedAt, collection, customStones };
}

export function readBackupPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid backup");
  const collection = value.collection;
  if (!collection || typeof collection !== "object" || Array.isArray(collection)) throw new Error("invalid collection");
  const customStones = value.customStones ?? [];
  if (!Array.isArray(customStones)) throw new Error("invalid custom stones");
  return { collection, customStones };
}

export function snapshotsDiffer(left, right) {
  return JSON.stringify({ collection: left.collection, customStones: left.customStones }) !==
    JSON.stringify({ collection: right.collection, customStones: right.customStones });
}
