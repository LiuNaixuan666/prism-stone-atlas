"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  createBackupPayload,
  createCorrectionsPayload,
  createCustomStonesPayload,
  mergeCollections,
  mergeCorrections,
  mergeCustomStones,
  readBackupPayload,
  readCorrectionsPayload,
  readCustomStonesPayload,
  snapshotsDiffer,
} from "./collection-safety.mjs";

type SignedInUser = { displayName: string; email: string };

type Stone = {
  id: string;
  type: string;
  name: string;
  code: string;
  seasons: string[];
  image: string;
  wikiFile: string;
  available: boolean;
  custom?: boolean;
};

type CollectionRecord = {
  owned: boolean;
  favorite?: boolean;
  quantity?: number;
  condition?: string;
  acquired?: string;
  note?: string;
  customCode?: string;
  customName?: string;
  updatedAt?: string;
};

type RecoverySnapshot = {
  version: 2;
  savedAt: string;
  reason: string;
  collection: Record<string, CollectionRecord>;
  customStones: Stone[];
};

type Nav = "catalog" | "stats" | "missing" | "settings";
type StatusFilter = "all" | "owned" | "missing" | "favorite";
type SearchScope = "code" | "name" | "all";

const STORE_KEY = "prism-atlas-collection-v1";
const CUSTOM_KEY = "prism-atlas-custom-v1";
const DB_NAME = "prism-atlas-local";
const DB_STORE = "records";
const RECOVERY_KEY = "prism-atlas-recovery-v1";
const MAX_RECOVERY_POINTS = 10;
const TYPE_LABELS: Record<string, string> = {
  star: "Star",
  lovely: "Lovely",
  pop: "Pop",
  feminine: "Feminine",
  ethnic: "Ethnic",
  cool: "Cool",
  sexy: "Sexy",
  surprise: "Surprise",
  custom: "自定义",
  unknown: "未知颜色",
};
const TYPE_GLYPHS: Record<string, string> = {
  star: "★", lovely: "♥", pop: "●", feminine: "✦", ethnic: "◆",
  cool: "✧", sexy: "♦", surprise: "?", custom: "+", unknown: "◇",
};

const STONE_TYPES = Object.keys(TYPE_LABELS).filter((value) => value !== "custom");

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* IndexedDB remains the primary local store */ }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readDatabase<T>(key: string, fallback: T): Promise<T> {
  try {
    const db = await openDatabase();
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(DB_STORE, "readonly");
      const request = transaction.objectStore(DB_STORE).get(key);
      request.onsuccess = () => resolve(request.result ?? fallback);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
    });
  } catch {
    return fallback;
  }
}

async function writeDatabase(key: string, value: unknown) {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(DB_STORE, "readwrite");
      transaction.objectStore(DB_STORE).put(value, key);
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    });
  } catch { /* localStorage remains as a compatibility fallback */ }
}

async function saveRecoveryPoint(reason: string, collection: Record<string, CollectionRecord>, customStones: Stone[]) {
  const snapshot: RecoverySnapshot = {
    version: 2,
    savedAt: new Date().toISOString(),
    reason,
    collection,
    customStones,
  };
  const history = await readDatabase<RecoverySnapshot[]>(RECOVERY_KEY, []);
  const latest = history.at(-1);
  if (latest && !snapshotsDiffer(latest, snapshot)) return history.length;
  const next = [...history, snapshot].slice(-MAX_RECOVERY_POINTS);
  await writeDatabase(RECOVERY_KEY, next);
  return next.length;
}

const shownCode = (stone: Stone, record?: CollectionRecord) => record?.customCode?.trim() || stone.code;
const shownName = (stone: Stone, record?: CollectionRecord) => record?.customName?.trim() || stone.name;

function safeImage(url: string) {
  if (!url) return "";
  if (/^(?:https?:|data:|blob:)/.test(url)) return url.replace(/^http:/, "https:");
  return appAssetUrl(url);
}

function appAssetUrl(path: string) {
  if (typeof document === "undefined") return `/${path.replace(/^\/+/, "")}`;
  return new URL(path.replace(/^\/+/, ""), document.baseURI).toString();
}

function downloadJson(filename: string, value: unknown) {
  const href = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
}

export function PrismAtlas({ user, cloudEnabled = true }: { user: SignedInUser | null; cloudEnabled?: boolean }) {
  const [stones, setStones] = useState<Stone[]>([]);
  const [customStones, setCustomStones] = useState<Stone[]>([]);
  const [collection, setCollection] = useState<Record<string, CollectionRecord>>({});
  const [ready, setReady] = useState(false);
  const [nav, setNav] = useState<Nav>("catalog");
  const [query, setQuery] = useState("");
  const [searchScope, setSearchScope] = useState<SearchScope>("code");
  const [types, setTypes] = useState<string[]>([]);
  const [selectedSeasons, setSelectedSeasons] = useState<string[]>([]);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState("code");
  const [visibleCount, setVisibleCount] = useState(80);
  const [selected, setSelected] = useState<Stone | null>(null);
  const [toast, setToast] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [newStoneOpen, setNewStoneOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<Event | null>(null);
  const [syncStatus, setSyncStatus] = useState<"local" | "syncing" | "synced" | "error">(cloudEnabled && user ? "syncing" : "local");
  const [cloudAvailable, setCloudAvailable] = useState(false);
  const [cloudUpdatedAt, setCloudUpdatedAt] = useState<string | null>(null);
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const customImportRef = useRef<HTMLInputElement>(null);
  const correctionsImportRef = useRef<HTMLInputElement>(null);
  const syncing = useRef(false);

  useEffect(() => {
    const localCollection = readLocal<Record<string, CollectionRecord>>(STORE_KEY, {});
    const localCustom = readLocal<Stone[]>(CUSTOM_KEY, []);
    Promise.all([
      fetch(appAssetUrl("data/prism-stones.json")).then((r) => r.json()),
      readDatabase<Record<string, CollectionRecord>>(STORE_KEY, localCollection),
      readDatabase<Stone[]>(CUSTOM_KEY, localCustom),
      readDatabase<RecoverySnapshot[]>(RECOVERY_KEY, []),
    ]).then(([catalog, saved, custom, recovery]) => {
      setStones(catalog);
      setCollection(mergeCollections(localCollection, saved));
      setCustomStones(mergeCustomStones(localCustom, custom));
      setRecoveryAvailable(recovery.length > 0);
      setReady(true);
    });
    navigator.storage?.persist?.().catch(() => false);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register(appAssetUrl("sw.js")).catch(() => undefined);
    const onInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    window.addEventListener("beforeinstallprompt", onInstall);
    return () => window.removeEventListener("beforeinstallprompt", onInstall);
  }, []);

  useEffect(() => {
    if (!ready || !cloudEnabled || !user) return;
    let cancelled = false;
    fetch("/api/sync")
      .then(async (response) => {
        if (!response.ok) throw new Error("sync failed");
        return response.json();
      })
      .then(({ snapshot, updatedAt }) => {
        if (cancelled) return;
        setCloudAvailable(!!snapshot);
        setCloudUpdatedAt(updatedAt || null);
        setSyncStatus("synced");
      })
      .catch(() => { if (!cancelled) setSyncStatus("error"); });
    return () => { cancelled = true; };
  }, [cloudEnabled, ready, user]);

  useEffect(() => {
    if (ready) {
      writeLocal(STORE_KEY, collection);
      void writeDatabase(STORE_KEY, collection);
    }
  }, [collection, ready]);

  useEffect(() => {
    if (ready) {
      writeLocal(CUSTOM_KEY, customStones);
      void writeDatabase(CUSTOM_KEY, customStones);
    }
  }, [customStones, ready]);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      void saveRecoveryPoint("自动恢复点", collection, customStones).then((count) => setRecoveryAvailable(count > 1));
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [collection, customStones, ready]);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisibleCount(80), 0);
    return () => window.clearTimeout(timer);
  }, [query, searchScope, selectedSeasons, status, sort, types]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const allStones = useMemo(() => [...stones, ...customStones], [stones, customStones]);
  const seasons = useMemo(
    () => Array.from(new Set(stones.flatMap((stone) => stone.seasons))).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })),
    [stones],
  );
  const ownedCount = useMemo(() => allStones.filter((s) => collection[s.id]?.owned).length, [allStones, collection]);
  const favoriteCount = useMemo(() => allStones.filter((s) => collection[s.id]?.favorite).length, [allStones, collection]);
  const progress = allStones.length ? (ownedCount / allStones.length) * 100 : 0;

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const list = allStones.filter((stone) => {
      const record = collection[stone.id];
      const queryValues = searchScope === "code"
        ? `${shownCode(stone, record)} ${stone.code}`
        : searchScope === "name"
          ? `${shownName(stone, record)} ${stone.name}`
          : `${shownCode(stone, record)} ${shownName(stone, record)} ${stone.code} ${stone.name}`;
      const matchesQuery = !needle || queryValues.toLocaleLowerCase().includes(needle);
      const matchesType = !types.length || types.some((value) => value === "custom" ? stone.custom : stone.type === value);
      const matchesSeason = !selectedSeasons.length || selectedSeasons.some((value) => stone.seasons.includes(value));
      const matchesStatus = status === "all" ||
        (status === "owned" && record?.owned) ||
        (status === "missing" && !record?.owned) ||
        (status === "favorite" && record?.favorite);
      return matchesQuery && matchesType && matchesSeason && matchesStatus;
    });
    return list.sort((a, b) => {
      if (sort === "name") return shownName(a, collection[a.id]).localeCompare(shownName(b, collection[b.id]));
      if (sort === "type") return a.type.localeCompare(b.type) || a.code.localeCompare(b.code, undefined, { numeric: true });
      return shownCode(a, collection[a.id]).localeCompare(shownCode(b, collection[b.id]), undefined, { numeric: true });
    });
  }, [allStones, collection, query, searchScope, selectedSeasons, sort, status, types]);

  const toggleFilter = (value: string, current: string[], setter: (value: string[]) => void) => {
    setter(current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  };

  const updateRecord = (id: string, patch: Partial<CollectionRecord>) => {
    setCollection((current) => ({
      ...current,
      [id]: { ...current[id], ...patch, updatedAt: new Date().toISOString() },
    }));
  };

  const toggleOwned = (stone: Stone) => {
    const next = !collection[stone.id]?.owned;
    updateRecord(stone.id, { owned: next, quantity: next ? Math.max(1, collection[stone.id]?.quantity || 1) : 0 });
    setToast(next ? `已收藏 ${stone.code}` : `已移出收藏 ${stone.code}`);
  };

  const batchSet = (owned: boolean) => {
    if (!filtered.length) return;
    setCollection((current) => {
      const next = { ...current };
      filtered.forEach((stone) => {
        next[stone.id] = { ...next[stone.id], owned, quantity: owned ? Math.max(1, next[stone.id]?.quantity || 1) : 0, updatedAt: new Date().toISOString() };
      });
      return next;
    });
    setToast(`已将当前 ${filtered.length} 项标记为${owned ? "拥有" : "缺少"}`);
  };

  const exportData = () => {
    downloadJson(`棱石完整设备备份-${new Date().toISOString().slice(0, 10)}.json`, createBackupPayload(collection, customStones));
    setToast("完整设备备份已导出");
  };

  const importData = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const payload = readBackupPayload(JSON.parse(await file.text())) as { collection: Record<string, CollectionRecord>; customStones: Stone[] };
      await saveRecoveryPoint("导入前", collection, customStones);
      setRecoveryAvailable(true);
      setCollection(mergeCollections(collection, payload.collection));
      setCustomStones(mergeCustomStones(customStones, payload.customStones));
      setToast("完整备份已安全合并");
    } catch {
      setToast("无法读取这个备份文件");
    }
    event.target.value = "";
  };

  const exportCustomStones = () => {
    downloadJson(`自定义棱石-${new Date().toISOString().slice(0, 10)}.json`, createCustomStonesPayload(customStones));
    setToast(`已导出 ${customStones.length} 条自定义棱石`);
  };

  const importCustomStones = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const imported = readCustomStonesPayload(JSON.parse(await file.text())) as Stone[];
      await saveRecoveryPoint("导入自定义棱石前", collection, customStones);
      setCustomStones(mergeCustomStones(customStones, imported));
      setRecoveryAvailable(true);
      setTypes(["custom"]);
      setSelectedSeasons([]);
      setNav("catalog");
      setToast(`已导入并合并 ${imported.length} 条自定义棱石`);
    } catch {
      setToast("无法读取这个自定义棱石文件");
    }
    event.target.value = "";
  };

  const exportCorrections = () => {
    const payload = createCorrectionsPayload(collection);
    downloadJson(`棱石名称订正-${new Date().toISOString().slice(0, 10)}.json`, payload);
    setToast(`已导出 ${Object.keys(payload.corrections).length} 条订正记录`);
  };

  const importCorrections = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const corrections = readCorrectionsPayload(JSON.parse(await file.text()));
      await saveRecoveryPoint("导入名称订正前", collection, customStones);
      setCollection(mergeCorrections(collection, corrections));
      setRecoveryAvailable(true);
      setToast(`已应用 ${Object.keys(corrections).length} 条名称订正`);
    } catch {
      setToast("无法读取这个名称订正文件");
    }
    event.target.value = "";
  };

  const shareCollection = async () => {
    const text = `我的棱石图鉴：已拥有 ${ownedCount}/${allStones.length}（${progress.toFixed(1)}%）`; 
    try {
      if (navigator.share) await navigator.share({ title: "我的棱石收藏", text, url: location.href });
      else {
        await navigator.clipboard.writeText(`${text} ${location.href}`);
        setToast("收藏进度和网址已复制");
      }
    } catch { /* user cancelled */ }
  };

  const copyMissing = async () => {
    const list = allStones.filter((stone) => !collection[stone.id]?.owned).map((stone) => `${shownCode(stone, collection[stone.id])} · ${shownName(stone, collection[stone.id])}`).join("\n");
    await navigator.clipboard.writeText(list);
    setToast("缺少清单已复制");
  };

  const install = async () => {
    const prompt = installPrompt as Event & { prompt?: () => Promise<void> };
    if (prompt?.prompt) await prompt.prompt();
    else setToast("请在浏览器菜单中选择“添加到主屏幕”");
  };

  const backupToCloud = async () => {
    if (!user || syncing.current) return;
    syncing.current = true; setSyncStatus("syncing");
    try {
      const response = await fetch("/api/sync", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ collection, customStones, expectedUpdatedAt: cloudUpdatedAt }) });
      if (response.status === 413) throw new Error("too-large");
      if (response.status === 409) {
        const latest = await response.json() as { updatedAt?: string | null };
        setCloudUpdatedAt(latest.updatedAt || null);
        setCloudAvailable(true);
        throw new Error("conflict");
      }
      if (!response.ok) throw new Error("sync failed");
      const result = await response.json() as { updatedAt?: string };
      setCloudUpdatedAt(result.updatedAt || null);
      setCloudAvailable(true);
      setSyncStatus("synced"); setToast("本机收藏已备份到云端");
    } catch (error) {
      setSyncStatus("error");
      setToast(error instanceof Error && error.message === "conflict" ? "云端已有更新，请先恢复云端备份" : error instanceof Error && error.message === "too-large" ? "自定义图片较多，云端容量不足；请使用完整设备备份文件" : "云端备份失败，本机数据不受影响");
    }
    finally { syncing.current = false; }
  };

  const restoreFromCloud = async () => {
    if (!user || syncing.current) return;
    syncing.current = true; setSyncStatus("syncing");
    try {
      const response = await fetch("/api/sync");
      if (!response.ok) throw new Error("sync failed");
      const { snapshot, updatedAt } = await response.json() as { snapshot?: { collection?: Record<string, CollectionRecord>; customStones?: Stone[] } | null; updatedAt?: string };
      if (!snapshot) { setCloudAvailable(false); setSyncStatus("synced"); setToast("云端还没有收藏备份"); return; }
      await saveRecoveryPoint("云端恢复前", collection, customStones);
      setRecoveryAvailable(true);
      setCollection(mergeCollections(collection, snapshot.collection || {}));
      setCustomStones(mergeCustomStones(customStones, snapshot.customStones || []));
      setCloudAvailable(true);
      setCloudUpdatedAt(updatedAt || null);
      setSyncStatus("synced"); setToast("云端备份已安全合并到本机");
    } catch { setSyncStatus("error"); setToast("无法读取云端备份，本机数据不受影响"); }
    finally { syncing.current = false; }
  };

  const restoreLocalRecovery = async () => {
    const history = await readDatabase<RecoverySnapshot[]>(RECOVERY_KEY, []);
    const current = { collection, customStones };
    const previous = [...history].reverse().find((snapshot) => snapshotsDiffer(snapshot, current));
    if (!previous) { setRecoveryAvailable(false); setToast("没有更早的本机恢复点"); return; }
    await saveRecoveryPoint("恢复操作前", collection, customStones);
    setCollection(previous.collection);
    setCustomStones(previous.customStones);
    setToast(`已恢复 ${new Date(previous.savedAt).toLocaleString()} 的本机记录`);
  };

  if (!ready) return <Loading />;

  return (
    <main className="app-shell">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true"><span>♥</span></div>
        <div><p className="eyebrow">MY PRISM COLLECTION</p><h1>棱石图鉴</h1></div>
        <button className="icon-button" onClick={shareCollection} aria-label="分享收藏进度">↗</button>
      </header>

      <section className="progress-card">
        <div className="progress-copy">
          <div><span className="sparkle">✦</span><p>我的收藏进度</p></div>
          <strong>{ownedCount}<small> / {allStones.length}</small></strong>
        </div>
        <div className="progress-track" aria-label={`收藏进度 ${progress.toFixed(1)}%`}>
          <div style={{ width: `${progress}%` }} />
        </div>
        <div className="progress-meta"><span>{progress.toFixed(1)}% 已点亮</span><span>还差 {allStones.length - ownedCount} 枚</span></div>
      </section>

      {nav === "catalog" && (
        <>
          <section className="search-row">
            <label className="search-scope"><span>搜索范围</span><select value={searchScope} onChange={(e) => setSearchScope(e.target.value as SearchScope)}><option value="code">编号</option><option value="name">名称</option><option value="all">编号＋名称</option></select></label>
            <label className="search-box"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={searchScope === "code" ? "只搜索编号" : searchScope === "name" ? "只搜索名称" : "搜索编号或名称"} /></label>
            <button className={`filter-button ${showFilters ? "active" : ""}`} onClick={() => setShowFilters((v) => !v)} aria-label="更多筛选">☷</button>
          </section>
          <div className="type-scroller" aria-label="分类筛选">
            <FilterChip active={!types.length} onClick={() => setTypes([])}>全部</FilterChip>
            {Object.entries(TYPE_LABELS).filter(([key]) => key !== "custom" || customStones.length).map(([key, label]) => (
              <FilterChip key={key} active={types.includes(key)} onClick={() => toggleFilter(key, types, setTypes)}><b>{TYPE_GLYPHS[key]}</b>{label}</FilterChip>
            ))}
          </div>
          <div className="status-tabs">
            {(["all", "owned", "missing", "favorite"] as StatusFilter[]).map((value) => (
              <button key={value} className={status === value ? "active" : ""} onClick={() => setStatus(value)}>
                {{ all: "全图鉴", owned: "已拥有", missing: "缺少", favorite: "心愿" }[value]}
              </button>
            ))}
          </div>
          {showFilters && <section className="advanced-filters">
            <label>排序<select value={sort} onChange={(e) => setSort(e.target.value)}><option value="code">按编号</option><option value="name">按名称</option><option value="type">按分类</option></select></label>
            <div className="season-filter"><div><b>季次（可多选）</b><button onClick={() => setSelectedSeasons([])}>清除</button></div><div>{seasons.map((value) => <FilterChip key={value} active={selectedSeasons.includes(value)} onClick={() => toggleFilter(value, selectedSeasons, setSelectedSeasons)}>{value}</FilterChip>)}</div></div>
            <div className="batch-actions"><button onClick={() => batchSet(true)}>当前全部拥有</button><button onClick={() => batchSet(false)}>当前全部缺少</button></div>
          </section>}
          <section className="section-heading"><div><p>{status === "all" ? "完整收藏册" : status === "owned" ? "我的收藏" : status === "missing" ? "待收集" : "心愿清单"}</p><span>找到 {filtered.length} 枚棱石</span></div><button onClick={() => { setQuery(""); setTypes([]); setSelectedSeasons([]); setStatus("all"); }}>重置</button></section>
          <section className="stone-grid">
            {filtered.slice(0, visibleCount).map((stone) => <StoneCard key={stone.id} stone={stone} record={collection[stone.id]} onToggle={() => toggleOwned(stone)} onOpen={() => setSelected(stone)} />)}
          </section>
          {!filtered.length && <EmptyState symbol="◇" title="没有找到棱石" text="换一个编号、名称或筛选条件试试。" />}
          {visibleCount < filtered.length && <button className="load-more" onClick={() => setVisibleCount((n) => n + 80)}>继续加载 · 还有 {filtered.length - visibleCount} 枚</button>}
        </>
      )}

      {nav === "stats" && <StatsView stones={allStones} collection={collection} onType={(value) => { setTypes([value]); setStatus("all"); setNav("catalog"); }} />}
      {nav === "missing" && <MissingView stones={allStones} collection={collection} onOpen={setSelected} onCopy={copyMissing} />}
      {nav === "settings" && <SettingsView user={user} cloudEnabled={cloudEnabled} syncStatus={syncStatus} cloudAvailable={cloudAvailable} cloudUpdatedAt={cloudUpdatedAt} recoveryAvailable={recoveryAvailable} owned={ownedCount} total={allStones.length} favorite={favoriteCount} customCount={customStones.length} onCloudBackup={backupToCloud} onCloudRestore={restoreFromCloud} onRecoveryRestore={restoreLocalRecovery} onExport={exportData} onImport={() => importRef.current?.click()} onExportCustom={exportCustomStones} onImportCustom={() => customImportRef.current?.click()} onExportCorrections={exportCorrections} onImportCorrections={() => correctionsImportRef.current?.click()} onInstall={install} onAdd={() => setNewStoneOpen(true)} onReset={async () => { if (confirm("确定清空收藏记录吗？操作前会保留一个本机恢复点，云端备份不会被删除。")) { await saveRecoveryPoint("清空前", collection, customStones); setRecoveryAvailable(true); setCollection({}); setToast("收藏记录已清空，可从本机恢复点找回"); } }} />}

      <nav className="bottom-nav" aria-label="主要导航">
        <NavButton active={nav === "catalog"} icon="◇" label="图鉴" onClick={() => setNav("catalog")} />
        <NavButton active={nav === "stats"} icon="◔" label="统计" onClick={() => setNav("stats")} />
        <NavButton active={nav === "missing"} icon="☑" label="清单" onClick={() => setNav("missing")} />
        <NavButton active={nav === "settings"} icon="⚙" label="设置" onClick={() => setNav("settings")} />
      </nav>

      <input ref={importRef} type="file" accept="application/json" hidden onChange={importData} />
      <input ref={customImportRef} type="file" accept="application/json" hidden onChange={importCustomStones} />
      <input ref={correctionsImportRef} type="file" accept="application/json" hidden onChange={importCorrections} />
      {selected && <DetailSheet stone={selected} record={collection[selected.id]} onClose={() => setSelected(null)} onUpdate={(patch) => updateRecord(selected.id, patch)} onDeleteCustom={() => { setCustomStones((items) => items.filter((s) => s.id !== selected.id)); setSelected(null); setToast("自定义条目已删除"); }} />}
      {newStoneOpen && <NewStoneSheet onClose={() => setNewStoneOpen(false)} onSave={(stone) => { setCustomStones((items) => mergeCustomStones([stone], items)); setNewStoneOpen(false); setQuery(""); setTypes(["custom"]); setSelectedSeasons([]); setStatus("all"); setNav("catalog"); setSelected(stone); setToast("已添加并打开自定义棱石"); }} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}

function Loading() { return <div className="loading-screen"><div className="loading-heart">♥</div><p>正在展开棱石收藏册…</p></div>; }

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button className={`filter-chip ${active ? "active" : ""}`} onClick={onClick}>{children}</button>;
}

function StoneCard({ stone, record, onToggle, onOpen }: { stone: Stone; record?: CollectionRecord; onToggle: () => void; onOpen: () => void }) {
  const [imageFailed, setImageFailed] = useState(false);
  return <article className={`stone-card type-${stone.type} ${record?.owned ? "owned" : ""}`}>
    <button className="card-main" onClick={onOpen} aria-label={`查看 ${shownCode(stone, record)} ${shownName(stone, record)}`}>
      <div className="image-wrap">
        {stone.image && !imageFailed ? <img src={safeImage(stone.image)} alt={`${shownCode(stone, record)} ${shownName(stone, record)}`} loading="lazy" onError={() => setImageFailed(true)} /> : <div className="image-placeholder"><span>{TYPE_GLYPHS[stone.type] || "◇"}</span><small>图片暂缺</small></div>}
        <span className="type-badge">{TYPE_GLYPHS[stone.type]} {TYPE_LABELS[stone.type] || stone.type}</span>
        {record?.favorite && <span className="favorite-badge">♥</span>}
      </div>
      <div className="card-copy"><strong>{shownCode(stone, record)}</strong><p>{shownName(stone, record)}</p><small>{stone.seasons.join(" · ") || "季次未知"}</small></div>
    </button>
    <button className={`owned-toggle ${record?.owned ? "checked" : ""}`} onClick={onToggle} aria-label={record?.owned ? "标记为缺少" : "标记为拥有"}><span>{record?.owned ? "✓" : "+"}</span>{record?.owned ? "已拥有" : "加入收藏"}</button>
  </article>;
}

function DetailSheet({ stone, record = { owned: false }, onClose, onUpdate, onDeleteCustom }: { stone: Stone; record?: CollectionRecord; onClose: () => void; onUpdate: (patch: Partial<CollectionRecord>) => void; onDeleteCustom: () => void }) {
  const [imageFailed, setImageFailed] = useState(false);
  return <div className="sheet-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section className="detail-sheet" role="dialog" aria-modal="true" aria-label={`${stone.code} 详情`}>
    <div className="sheet-handle" /><button className="sheet-close" onClick={onClose} aria-label="关闭">×</button>
    <div className="detail-image">{stone.image && !imageFailed ? <img src={safeImage(stone.image)} alt={`${shownCode(stone, record)} ${shownName(stone, record)}`} onError={() => setImageFailed(true)} /> : <span>◇</span>}</div>
    <div className="detail-title"><div><span>{TYPE_GLYPHS[stone.type]} {TYPE_LABELS[stone.type] || stone.type}</span><h2>{shownName(stone, record)}</h2><strong>{shownCode(stone, record)}</strong></div><button className={record.favorite ? "favorite active" : "favorite"} onClick={() => onUpdate({ favorite: !record.favorite })}>♥</button></div>
    <div className="season-pills">{stone.seasons.map((s) => <span key={s}>{s}</span>)}</div>
    <label className="owned-switch"><input type="checkbox" checked={!!record.owned} onChange={(e) => onUpdate({ owned: e.target.checked, quantity: e.target.checked ? Math.max(1, record.quantity || 1) : 0 })} /><span /><b>{record.owned ? "我拥有这枚棱石" : "标记为已拥有"}</b></label>
    <div className="form-grid">
      <label>显示编号<input value={record.customCode || ""} onChange={(e) => onUpdate({ customCode: e.target.value })} placeholder={stone.code} /></label>
      <label>显示名称<input value={record.customName || ""} onChange={(e) => onUpdate({ customName: e.target.value })} placeholder={stone.name} /></label>
      <label>数量<input type="number" min="0" value={record.quantity || 0} onChange={(e) => onUpdate({ quantity: Number(e.target.value), owned: Number(e.target.value) > 0 })} /></label>
      <label>品相<select value={record.condition || ""} onChange={(e) => onUpdate({ condition: e.target.value })}><option value="">未记录</option><option>全新</option><option>良好</option><option>有使用痕迹</option><option>待更换</option></select></label>
      <label className="wide">获得日期<input type="date" value={record.acquired || ""} onChange={(e) => onUpdate({ acquired: e.target.value })} /></label>
      <label className="wide">收藏备注<textarea value={record.note || ""} onChange={(e) => onUpdate({ note: e.target.value })} placeholder="来源、价格、交换对象……" /></label>
    </div>
    {!stone.custom && <a className="source-link" href={`https://puritirizumu.fandom.com/wiki/${encodeURIComponent(stone.name.replaceAll(" ", "_"))}`} target="_blank" rel="noreferrer">在 Pretty Rhythm Wiki 查看资料来源 ↗</a>}
    {stone.custom && <button className="danger-link" onClick={onDeleteCustom}>删除这个自定义条目</button>}
  </section></div>;
}

function StatsView({ stones, collection, onType }: { stones: Stone[]; collection: Record<string, CollectionRecord>; onType: (type: string) => void }) {
  const groups = Object.keys(TYPE_LABELS).map((type) => {
    const items = stones.filter((s) => s.type === type);
    const owned = items.filter((s) => collection[s.id]?.owned).length;
    return { type, total: items.length, owned, percent: items.length ? owned / items.length * 100 : 0 };
  }).filter((g) => g.total);
  const totalOwned = stones.filter((s) => collection[s.id]?.owned).length;
  return <section className="view-page"><div className="view-title"><p>COLLECTION REPORT</p><h2>收藏统计</h2><span>每一次勾选，都是图鉴被点亮的一小步。</span></div>
    <div className="stat-hero"><div className="ring" style={{ "--p": `${stones.length ? totalOwned / stones.length * 100 : 0}%` } as React.CSSProperties}><div><strong>{stones.length ? (totalOwned / stones.length * 100).toFixed(1) : 0}%</strong><span>总体完成</span></div></div><div><p>已经收集</p><strong>{totalOwned}</strong><small>缺少 {stones.length - totalOwned} · 共 {stones.length}</small></div></div>
    <h3 className="mini-heading">分类完成度</h3><div className="category-stats">{groups.map((group) => <button key={group.type} onClick={() => onType(group.type)}><span className={`category-glyph type-${group.type}`}>{TYPE_GLYPHS[group.type]}</span><div><b>{TYPE_LABELS[group.type]}</b><small>{group.owned} / {group.total}</small><div><i style={{ width: `${group.percent}%` }} /></div></div><strong>{group.percent.toFixed(0)}%</strong></button>)}</div>
  </section>;
}

function MissingView({ stones, collection, onOpen, onCopy }: { stones: Stone[]; collection: Record<string, CollectionRecord>; onOpen: (stone: Stone) => void; onCopy: () => void }) {
  const missing = stones.filter((s) => !collection[s.id]?.owned);
  return <section className="view-page"><div className="view-title"><p>WISHLIST</p><h2>缺少清单</h2><span>按编号整理，交换和补齐收藏会更轻松。</span></div><button className="primary-action" onClick={onCopy}>复制全部缺少编号</button><div className="compact-list">{missing.slice(0, 300).map((stone) => <button key={stone.id} onClick={() => onOpen(stone)}><span className={`category-glyph type-${stone.type}`}>{TYPE_GLYPHS[stone.type]}</span><div><strong>{shownCode(stone, collection[stone.id])}</strong><p>{shownName(stone, collection[stone.id])}</p></div><span>›</span></button>)}</div>{missing.length > 300 && <p className="list-note">为保持手机流畅，这里先显示前 300 项；图鉴页可以查看全部。</p>}</section>;
}

function SettingsView({ user, cloudEnabled, syncStatus, cloudAvailable, cloudUpdatedAt, recoveryAvailable, owned, total, favorite, customCount, onCloudBackup, onCloudRestore, onRecoveryRestore, onExport, onImport, onExportCustom, onImportCustom, onExportCorrections, onImportCorrections, onInstall, onAdd, onReset }: {
  user: SignedInUser | null;
  cloudEnabled: boolean;
  syncStatus: "local" | "syncing" | "synced" | "error";
  cloudAvailable: boolean;
  cloudUpdatedAt: string | null;
  recoveryAvailable: boolean;
  owned: number;
  total: number;
  favorite: number;
  customCount: number;
  onCloudBackup: () => void;
  onCloudRestore: () => void;
  onRecoveryRestore: () => void;
  onExport: () => void;
  onImport: () => void;
  onExportCustom: () => void;
  onImportCustom: () => void;
  onExportCorrections: () => void;
  onImportCorrections: () => void;
  onInstall: () => void;
  onAdd: () => void;
  onReset: () => void;
}) {
  const syncText = !cloudEnabled || !user ? "仅保存在这台设备" : syncStatus === "syncing" ? "正在连接云端…" : syncStatus === "error" ? "云端暂不可用，本机数据安全" : cloudAvailable ? "云端备份可用" : "云端还没有备份";
  const cloudTime = cloudUpdatedAt ? new Date(cloudUpdatedAt).toLocaleString() : "手动操作，不会自动覆盖";
  return <section className="view-page">
    <div className="view-title"><p>MY ATLAS</p><h2>图鉴与数据</h2><span>{cloudEnabled ? "收藏以这台设备为主；云端只用于你主动选择的备份和换机恢复。" : "这是完全本机版本，不连接账号或云端；换机请使用导出和导入备份。"}</span></div>
    <div className="profile-card"><div className="profile-gem">♥</div><div><strong>{user?.displayName || "我的棱石收藏"}</strong><p>{owned}/{total} 已拥有 · {favorite} 枚心愿</p><small className={`sync-state ${syncStatus}`}>{syncText}</small></div></div>
    <div className="settings-list">
      {cloudEnabled && (user ? <>
        <button onClick={onCloudBackup}><span>☁</span><div><b>备份本机数据到云端</b><small>{cloudTime}</small></div><i>›</i></button>
        <button onClick={onCloudRestore}><span>↙</span><div><b>从云端恢复到本机</b><small>{cloudAvailable ? "安全合并，不清空当前收藏" : "云端还没有可用备份"}</small></div><i>›</i></button>
        <a href="/signout-with-chatgpt?return_to=%2F"><span>↪</span><div><b>退出云端备份账号</b><small>{user.email}</small></div><i>›</i></a>
      </> : <a href="/signin-with-chatgpt?return_to=%2F"><span>☁</span><div><b>启用可选云端备份</b><small>仅在你点击时备份或恢复</small></div><i>›</i></a>)}
      <button onClick={onInstall}><span>⌂</span><div><b>安装到手机桌面</b><small>核心程序与图鉴目录支持离线打开</small></div><i>›</i></button>
      <button onClick={onExport}><span>⇩</span><div><b>导出完整设备备份</b><small>收藏、日期、备注、订正、自定义条目和图片全部保存</small></div><i>›</i></button>
      <button onClick={onImport}><span>⇧</span><div><b>导入完整设备备份</b><small>与当前数据安全合并，兼容旧版备份</small></div><i>›</i></button>
      <button onClick={onRecoveryRestore}><span>↶</span><div><b>恢复上一份本机记录</b><small>{recoveryAvailable ? "可撤回导入、恢复或误清空" : "使用一段时间后自动生成恢复点"}</small></div><i>›</i></button>
      <button onClick={onAdd}><span>＋</span><div><b>添加自定义棱石</b><small>可选择颜色、季次并上传图片</small></div><i>›</i></button>
      <button onClick={onExportCustom}><span>◇</span><div><b>导出自定义棱石</b><small>当前 {customCount} 条，可单独分享给别人</small></div><i>›</i></button>
      <button onClick={onImportCustom}><span>◆</span><div><b>导入自定义棱石</b><small>从别人或另一台设备的文件中合并</small></div><i>›</i></button>
      <button onClick={onExportCorrections}><span>✎</span><div><b>导出名称订正记录</b><small>只分享手动改过的编号和名称</small></div><i>›</i></button>
      <button onClick={onImportCorrections}><span>✓</span><div><b>导入并应用名称订正</b><small>一键使用别人整理过的订正记录</small></div><i>›</i></button>
    </div>
    <button className="danger-action" onClick={onReset}>清空收藏记录</button>
    <p className="privacy-note">{cloudEnabled ? "本机数据不会因为云端失败而被清空。" : "此版本不会把收藏上传到服务器。"} 换机或卸载前仍建议导出备份文件。</p>
    <p className="source-note">非官方收藏工具。棱石资料与图片链接整理自 <a href="https://puritirizumu.fandom.com/wiki/Prism_Stone_Master_List" target="_blank" rel="noreferrer">Pretty Rhythm Wiki</a>，相关作品及图片权利归原权利人所有。</p>
  </section>;
}

async function prepareCustomImage(file: File) {
  const objectUrl = URL.createObjectURL(file);
  const source = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("invalid image"));
    element.src = objectUrl;
  });
  let maximum = 900;
  const canvas = document.createElement("canvas");
  let dataUrl = "";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const scale = Math.min(1, maximum / Math.max(source.naturalWidth, source.naturalHeight));
    canvas.width = Math.max(1, Math.round(source.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
    canvas.getContext("2d")?.drawImage(source, 0, 0, canvas.width, canvas.height);
    dataUrl = canvas.toDataURL("image/webp", Math.max(0.48, 0.78 - attempt * 0.07));
    if (dataUrl.length <= 280_000) break;
    maximum *= 0.78;
  }
  URL.revokeObjectURL(objectUrl);
  return dataUrl;
}

function NewStoneSheet({ onClose, onSave }: { onClose: () => void; onSave: (stone: Stone) => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [season, setSeason] = useState("未知");
  const [stoneType, setStoneType] = useState("unknown");
  const [image, setImage] = useState("");
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState("");
  const chooseImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImageBusy(true);
    setImageError("");
    try { setImage(await prepareCustomImage(file)); }
    catch { setImageError("无法读取这张图片，请换一张 PNG、JPG 或 WebP"); }
    finally { setImageBusy(false); }
  };
  const save = () => onSave({
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: stoneType,
    code: code.trim(),
    name: name.trim() || "未命名棱石",
    seasons: [season.trim() || "未知"],
    image,
    wikiFile: "",
    available: false,
    custom: true,
  });
  return <div className="sheet-backdrop"><section className="detail-sheet small" role="dialog" aria-modal="true"><div className="sheet-handle" /><button className="sheet-close" onClick={onClose}>×</button><div className="detail-title"><div><span>CUSTOM ENTRY</span><h2>添加自定义棱石</h2></div></div>{image && <div className="custom-image-preview"><img src={image} alt="自定义棱石预览" /><button onClick={() => setImage("")}>移除图片</button></div>}<div className="form-grid"><label className="wide">棱石图片<input type="file" accept="image/*" onChange={chooseImage} /></label><label className="wide">棱石编号<input value={code} onChange={(e) => setCode(e.target.value)} placeholder="例如 PR-001" /></label><label className="wide">衣服或棱石名称<input value={name} onChange={(e) => setName(e.target.value)} placeholder="不知道可留空，保存为未命名棱石" /></label><label>颜色分类<select value={stoneType} onChange={(e) => setStoneType(e.target.value)}>{STONE_TYPES.map((value) => <option key={value} value={value}>{TYPE_LABELS[value]}</option>)}</select></label><label>季次<input value={season} onChange={(e) => setSeason(e.target.value)} placeholder="未知" /></label></div>{imageError && <p className="form-error">{imageError}</p>}<p className="form-hint">保存后会自动归入“自定义”，同时按你选择的颜色和季次参与筛选。</p><button className="primary-action" disabled={!code.trim() || imageBusy} onClick={save}>{imageBusy ? "正在处理图片…" : "保存并查看条目"}</button></section></div>;
}

function EmptyState({ symbol, title, text }: { symbol: string; title: string; text: string }) { return <div className="empty-state"><span>{symbol}</span><strong>{title}</strong><p>{text}</p></div>; }
function NavButton({ active, icon, label, onClick }: { active: boolean; icon: string; label: string; onClick: () => void }) { return <button className={active ? "active" : ""} onClick={onClick}><span>{icon}</span><b>{label}</b></button>; }
