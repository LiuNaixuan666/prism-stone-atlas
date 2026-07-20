"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

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
  updatedAt?: string;
};

type Nav = "catalog" | "stats" | "missing" | "settings";
type StatusFilter = "all" | "owned" | "missing" | "favorite";

const STORE_KEY = "prism-atlas-collection-v1";
const CUSTOM_KEY = "prism-atlas-custom-v1";
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
};
const TYPE_GLYPHS: Record<string, string> = {
  star: "★", lovely: "♥", pop: "●", feminine: "✦", ethnic: "◆",
  cool: "✧", sexy: "♦", surprise: "?", custom: "+",
};

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function safeImage(url: string) {
  if (!url) return "";
  return url.replace(/^http:/, "https:");
}

export function PrismAtlas() {
  const [stones, setStones] = useState<Stone[]>([]);
  const [customStones, setCustomStones] = useState<Stone[]>([]);
  const [collection, setCollection] = useState<Record<string, CollectionRecord>>({});
  const [ready, setReady] = useState(false);
  const [nav, setNav] = useState<Nav>("catalog");
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [season, setSeason] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState("code");
  const [visibleCount, setVisibleCount] = useState(80);
  const [selected, setSelected] = useState<Stone | null>(null);
  const [toast, setToast] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [newStoneOpen, setNewStoneOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<Event | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Promise.all([
      fetch("/data/prism-stones.json").then((r) => r.json()),
      Promise.resolve(readLocal<Record<string, CollectionRecord>>(STORE_KEY, {})),
      Promise.resolve(readLocal<Stone[]>(CUSTOM_KEY, [])),
    ]).then(([catalog, saved, custom]) => {
      setStones(catalog);
      setCollection(saved);
      setCustomStones(custom);
      setReady(true);
    });
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    const onInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    window.addEventListener("beforeinstallprompt", onInstall);
    return () => window.removeEventListener("beforeinstallprompt", onInstall);
  }, []);

  useEffect(() => {
    if (ready) localStorage.setItem(STORE_KEY, JSON.stringify(collection));
  }, [collection, ready]);

  useEffect(() => {
    if (ready) localStorage.setItem(CUSTOM_KEY, JSON.stringify(customStones));
  }, [customStones, ready]);

  useEffect(() => setVisibleCount(80), [query, type, season, status, sort]);
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
      const matchesQuery = !needle || `${stone.code} ${stone.name} ${stone.seasons.join(" ")}`.toLocaleLowerCase().includes(needle);
      const matchesType = type === "all" || stone.type === type;
      const matchesSeason = season === "all" || stone.seasons.includes(season);
      const matchesStatus = status === "all" ||
        (status === "owned" && record?.owned) ||
        (status === "missing" && !record?.owned) ||
        (status === "favorite" && record?.favorite);
      return matchesQuery && matchesType && matchesSeason && matchesStatus;
    });
    return list.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "type") return a.type.localeCompare(b.type) || a.code.localeCompare(b.code, undefined, { numeric: true });
      return a.code.localeCompare(b.code, undefined, { numeric: true });
    });
  }, [allStones, collection, query, season, sort, status, type]);

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
    const payload = { version: 1, exportedAt: new Date().toISOString(), collection, customStones };
    const href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `棱石收藏备份-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(href);
    setToast("备份已导出");
  };

  const importData = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      if (!payload.collection || typeof payload.collection !== "object") throw new Error("invalid");
      setCollection(payload.collection);
      if (Array.isArray(payload.customStones)) setCustomStones(payload.customStones);
      setToast("收藏备份已导入");
    } catch {
      setToast("无法读取这个备份文件");
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
    const list = allStones.filter((stone) => !collection[stone.id]?.owned).map((stone) => `${stone.code} · ${stone.name}`).join("\n");
    await navigator.clipboard.writeText(list);
    setToast("缺少清单已复制");
  };

  const install = async () => {
    const prompt = installPrompt as Event & { prompt?: () => Promise<void> };
    if (prompt?.prompt) await prompt.prompt();
    else setToast("请在浏览器菜单中选择“添加到主屏幕”");
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
            <label className="search-box"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索编号、名称或季次" /></label>
            <button className={`filter-button ${showFilters ? "active" : ""}`} onClick={() => setShowFilters((v) => !v)} aria-label="更多筛选">☷</button>
          </section>
          <div className="type-scroller" aria-label="分类筛选">
            <FilterChip active={type === "all"} onClick={() => setType("all")}>全部</FilterChip>
            {Object.entries(TYPE_LABELS).filter(([key]) => key !== "custom" || customStones.length).map(([key, label]) => (
              <FilterChip key={key} active={type === key} onClick={() => setType(key)}><b>{TYPE_GLYPHS[key]}</b>{label}</FilterChip>
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
            <label>季次<select value={season} onChange={(e) => setSeason(e.target.value)}><option value="all">全部季次</option>{seasons.map((s) => <option key={s}>{s}</option>)}</select></label>
            <label>排序<select value={sort} onChange={(e) => setSort(e.target.value)}><option value="code">按编号</option><option value="name">按名称</option><option value="type">按分类</option></select></label>
            <div className="batch-actions"><button onClick={() => batchSet(true)}>当前全部拥有</button><button onClick={() => batchSet(false)}>当前全部缺少</button></div>
          </section>}
          <section className="section-heading"><div><p>{status === "all" ? "完整收藏册" : status === "owned" ? "我的收藏" : status === "missing" ? "待收集" : "心愿清单"}</p><span>找到 {filtered.length} 枚棱石</span></div><button onClick={() => { setQuery(""); setType("all"); setSeason("all"); setStatus("all"); }}>重置</button></section>
          <section className="stone-grid">
            {filtered.slice(0, visibleCount).map((stone) => <StoneCard key={stone.id} stone={stone} record={collection[stone.id]} onToggle={() => toggleOwned(stone)} onOpen={() => setSelected(stone)} />)}
          </section>
          {!filtered.length && <EmptyState symbol="◇" title="没有找到棱石" text="换一个编号、名称或筛选条件试试。" />}
          {visibleCount < filtered.length && <button className="load-more" onClick={() => setVisibleCount((n) => n + 80)}>继续加载 · 还有 {filtered.length - visibleCount} 枚</button>}
        </>
      )}

      {nav === "stats" && <StatsView stones={allStones} collection={collection} onType={(value) => { setType(value); setStatus("all"); setNav("catalog"); }} />}
      {nav === "missing" && <MissingView stones={allStones} collection={collection} onOpen={setSelected} onCopy={copyMissing} />}
      {nav === "settings" && <SettingsView owned={ownedCount} total={allStones.length} favorite={favoriteCount} onExport={exportData} onImport={() => importRef.current?.click()} onInstall={install} onAdd={() => setNewStoneOpen(true)} onReset={() => { if (confirm("确定清空这台设备上的收藏记录吗？")) { setCollection({}); setToast("收藏记录已清空"); } }} />}

      <nav className="bottom-nav" aria-label="主要导航">
        <NavButton active={nav === "catalog"} icon="◇" label="图鉴" onClick={() => setNav("catalog")} />
        <NavButton active={nav === "stats"} icon="◔" label="统计" onClick={() => setNav("stats")} />
        <NavButton active={nav === "missing"} icon="☑" label="清单" onClick={() => setNav("missing")} />
        <NavButton active={nav === "settings"} icon="⚙" label="设置" onClick={() => setNav("settings")} />
      </nav>

      <input ref={importRef} type="file" accept="application/json" hidden onChange={importData} />
      {selected && <DetailSheet stone={selected} record={collection[selected.id]} onClose={() => setSelected(null)} onUpdate={(patch) => updateRecord(selected.id, patch)} onDeleteCustom={() => { setCustomStones((items) => items.filter((s) => s.id !== selected.id)); setSelected(null); setToast("自定义条目已删除"); }} />}
      {newStoneOpen && <NewStoneSheet onClose={() => setNewStoneOpen(false)} onSave={(stone) => { setCustomStones((items) => [...items, stone]); setNewStoneOpen(false); setToast("已添加自定义棱石"); }} />}
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
    <button className="card-main" onClick={onOpen} aria-label={`查看 ${stone.code} ${stone.name}`}>
      <div className="image-wrap">
        {stone.image && !imageFailed ? <img src={safeImage(stone.image)} alt={`${stone.code} ${stone.name}`} loading="lazy" onError={() => setImageFailed(true)} /> : <div className="image-placeholder"><span>{TYPE_GLYPHS[stone.type] || "◇"}</span><small>图片暂缺</small></div>}
        <span className="type-badge">{TYPE_GLYPHS[stone.type]} {TYPE_LABELS[stone.type] || stone.type}</span>
        {record?.favorite && <span className="favorite-badge">♥</span>}
      </div>
      <div className="card-copy"><strong>{stone.code}</strong><p>{stone.name}</p><small>{stone.seasons.join(" · ") || "季次未知"}</small></div>
    </button>
    <button className={`owned-toggle ${record?.owned ? "checked" : ""}`} onClick={onToggle} aria-label={record?.owned ? "标记为缺少" : "标记为拥有"}><span>{record?.owned ? "✓" : "+"}</span>{record?.owned ? "已拥有" : "加入收藏"}</button>
  </article>;
}

function DetailSheet({ stone, record = { owned: false }, onClose, onUpdate, onDeleteCustom }: { stone: Stone; record?: CollectionRecord; onClose: () => void; onUpdate: (patch: Partial<CollectionRecord>) => void; onDeleteCustom: () => void }) {
  const [imageFailed, setImageFailed] = useState(false);
  return <div className="sheet-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section className="detail-sheet" role="dialog" aria-modal="true" aria-label={`${stone.code} 详情`}>
    <div className="sheet-handle" /><button className="sheet-close" onClick={onClose} aria-label="关闭">×</button>
    <div className="detail-image">{stone.image && !imageFailed ? <img src={safeImage(stone.image)} alt={`${stone.code} ${stone.name}`} onError={() => setImageFailed(true)} /> : <span>◇</span>}</div>
    <div className="detail-title"><div><span>{TYPE_GLYPHS[stone.type]} {TYPE_LABELS[stone.type] || stone.type}</span><h2>{stone.name}</h2><strong>{stone.code}</strong></div><button className={record.favorite ? "favorite active" : "favorite"} onClick={() => onUpdate({ favorite: !record.favorite })}>♥</button></div>
    <div className="season-pills">{stone.seasons.map((s) => <span key={s}>{s}</span>)}</div>
    <label className="owned-switch"><input type="checkbox" checked={!!record.owned} onChange={(e) => onUpdate({ owned: e.target.checked, quantity: e.target.checked ? Math.max(1, record.quantity || 1) : 0 })} /><span /><b>{record.owned ? "我拥有这枚棱石" : "标记为已拥有"}</b></label>
    <div className="form-grid">
      <label>数量<input type="number" min="0" value={record.quantity || 0} onChange={(e) => onUpdate({ quantity: Number(e.target.value), owned: Number(e.target.value) > 0 })} /></label>
      <label>品相<select value={record.condition || ""} onChange={(e) => onUpdate({ condition: e.target.value })}><option value="">未记录</option><option>全新</option><option>良好</option><option>有使用痕迹</option><option>待更换</option></select></label>
      <label className="wide">获得日期<input type="date" value={record.acquired || ""} onChange={(e) => onUpdate({ acquired: e.target.value })} /></label>
      <label className="wide">收藏备注<textarea value={record.note || ""} onChange={(e) => onUpdate({ note: e.target.value })} placeholder="来源、价格、交换对象……" /></label>
    </div>
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
  return <section className="view-page"><div className="view-title"><p>WISHLIST</p><h2>缺少清单</h2><span>按编号整理，交换和补齐收藏会更轻松。</span></div><button className="primary-action" onClick={onCopy}>复制全部缺少编号</button><div className="compact-list">{missing.slice(0, 300).map((stone) => <button key={stone.id} onClick={() => onOpen(stone)}><span className={`category-glyph type-${stone.type}`}>{TYPE_GLYPHS[stone.type]}</span><div><strong>{stone.code}</strong><p>{stone.name}</p></div><span>›</span></button>)}</div>{missing.length > 300 && <p className="list-note">为保持手机流畅，这里先显示前 300 项；图鉴页可以查看全部。</p>}</section>;
}

function SettingsView({ owned, total, favorite, onExport, onImport, onInstall, onAdd, onReset }: { owned: number; total: number; favorite: number; onExport: () => void; onImport: () => void; onInstall: () => void; onAdd: () => void; onReset: () => void }) {
  return <section className="view-page"><div className="view-title"><p>MY ATLAS</p><h2>图鉴与数据</h2><span>你的勾选只保存在当前设备，请定期备份。</span></div><div className="profile-card"><div className="profile-gem">♥</div><div><strong>我的棱石收藏</strong><p>{owned}/{total} 已拥有 · {favorite} 枚心愿</p></div></div><div className="settings-list">
    <button onClick={onInstall}><span>⌂</span><div><b>安装到手机桌面</b><small>像 App 一样快速打开</small></div><i>›</i></button>
    <button onClick={onExport}><span>⇩</span><div><b>导出收藏备份</b><small>保存勾选、数量与备注</small></div><i>›</i></button>
    <button onClick={onImport}><span>⇧</span><div><b>导入收藏备份</b><small>换手机后恢复收藏</small></div><i>›</i></button>
    <button onClick={onAdd}><span>＋</span><div><b>添加自定义棱石</b><small>补录图鉴之外的版本</small></div><i>›</i></button>
  </div><button className="danger-action" onClick={onReset}>清空本机收藏记录</button><p className="privacy-note">无账号、无追踪。每位收藏者打开分享网址后，都拥有一份独立的本地图鉴。</p></section>;
}

function NewStoneSheet({ onClose, onSave }: { onClose: () => void; onSave: (stone: Stone) => void }) {
  const [code, setCode] = useState(""); const [name, setName] = useState(""); const [season, setSeason] = useState("");
  return <div className="sheet-backdrop"><section className="detail-sheet small" role="dialog" aria-modal="true"><div className="sheet-handle" /><button className="sheet-close" onClick={onClose}>×</button><div className="detail-title"><div><span>CUSTOM ENTRY</span><h2>添加自定义棱石</h2></div></div><div className="form-grid"><label className="wide">棱石编号<input value={code} onChange={(e) => setCode(e.target.value)} placeholder="例如 PR-001" /></label><label className="wide">衣服或棱石名称<input value={name} onChange={(e) => setName(e.target.value)} placeholder="输入名称" /></label><label className="wide">季次<input value={season} onChange={(e) => setSeason(e.target.value)} placeholder="例如 Season 1" /></label></div><button className="primary-action" disabled={!code.trim() || !name.trim()} onClick={() => onSave({ id: `custom-${Date.now()}`, type: "custom", code: code.trim(), name: name.trim(), seasons: season.trim() ? [season.trim()] : [], image: "", wikiFile: "", available: false, custom: true })}>保存条目</button></section></div>;
}

function EmptyState({ symbol, title, text }: { symbol: string; title: string; text: string }) { return <div className="empty-state"><span>{symbol}</span><strong>{title}</strong><p>{text}</p></div>; }
function NavButton({ active, icon, label, onClick }: { active: boolean; icon: string; label: string; onClick: () => void }) { return <button className={active ? "active" : ""} onClick={onClick}><span>{icon}</span><b>{label}</b></button>; }
