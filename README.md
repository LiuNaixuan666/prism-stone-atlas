# 棱石图鉴 · Prism Stone Collection

面向手机使用的《美妙旋律》Prism Stone 收藏图鉴。可以查询棱石编号、记录持有状态与数量、整理心愿项目，并导入或导出个人收藏备份。

线上版本：<https://prism-stone-atlas.liunaixuan12.chatgpt.site>

## 当前功能

- 浏览、搜索和筛选 Prism Stone 图鉴
- 标记拥有、心愿、数量、品相、获得时间和备注
- 添加自定义棱石
- 查看收藏统计和缺少清单
- 使用 IndexedDB 在当前设备保存收藏，localStorage 作为兼容后备
- 导出和导入 JSON 收藏备份
- 安装到 Android 或 iPhone 主屏幕
- 登录后可手动备份到云端或从云端安全恢复；不会自动覆盖本机收藏
- 自动保留滚动本机恢复点，可撤回导入、恢复或误清空

## 数据原则

项目采用本地优先方向：个人收藏应首先保存在用户自己的设备上，云端同步只作为可选备份和换机辅助，不应成为唯一的数据来源。

当前版本以本机数据为主，并提供可选云端快照、同步冲突保护、本机恢复点和数据安全测试。图片目前仍主要来自公开资料站点，尚未全部打包到离线应用中。

建议用户定期在“图鉴与数据”页面导出收藏备份。清除浏览器数据、卸载应用或手机损坏都可能删除尚未备份的本地收藏。

## 本地开发

需要 Node.js 22.13 或更高版本。

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
```

## 项目结构

- `app/`：页面、收藏逻辑、同步接口和样式
- `public/data/prism-stones.json`：图鉴目录
- `public/manifest.webmanifest`：PWA 安装信息
- `public/sw.js`：离线缓存程序
- `db/`、`drizzle/`：可选云端同步的数据结构与迁移

## 更新记录

每次功能更新都会使用独立 Git commit，并在 [CHANGELOG.md](./CHANGELOG.md) 中写明简短的版本变化。

## 资料与版权

本项目是非官方收藏工具。棱石资料与图片链接整理自 Pretty Rhythm Wiki，相关作品、名称和图片权利归原权利人所有。
