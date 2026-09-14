# WorkMemo 公网部署说明

## 包含内容

| 文件 | 作用 | 公网必需 |
|---|---|---|
| `WorkMemo_v3.html` | 应用本体（单文件应用，UI + 全部前端逻辑） | ✅ |
| `WorkMemo_v2.html` | 旧版入口（用于查看旧数据/回滚） | 可选 |
| `proxy-server.mjs` | 本地服务（静态托管 + AI 代理 + 企微中转 + 日历同步） | ✅ |
| `package.json` | 项目描述 | 建议 |
| `启动WorkMemo.command` / `.bat` | 本机一键启动脚本 | 仅本机用 |
| `calendar_sync.swift` | macOS 日历同步助手脚手架源码 | 仅 macOS 本机有效 |
| `calendar_sync.jxa.js` / `calendar_status.jxa.js` | 旧版日历脚本（已被 Swift 方案取代，留档） | ❌ |

## 部署步骤（Node.js ≥ 18，无需任何 npm 依赖）

```bash
PORT=8848 node proxy-server.mjs
# 或
npm start
```

访问 `http://服务器IP:8848/` 即可。反向代理（nginx / Caddy）把域名指到 8848 就行，无路径前缀要求。

## 哪些功能依赖这个服务端

- `/` 静态托管 WorkMemo_v3.html（也可以用任意静态服务器直接托管 HTML）
- `/ai/*` AI 接口代理（浏览器直连大模型 API 有跨域限制，走这个中转）
- `/api/wecom-push` 企业微信群机器人推送中转（同理跨域）
- `/api/calendar/*` + `/workmemo.ics` 苹果日历同步——**仅在 macOS 本机部署时有效**；部署到 Linux 服务器后该功能自动失效（设置页会显示无法连接），不影响其他功能

## 注意事项（重要）

1. **没有登录/鉴权**：任何拿到地址的人都能打开并使用。公网暴露前建议至少加一层保护：nginx basic auth、IP 白名单、或只在内网/VPN 内开放。
2. **数据存在访问者的浏览器里**（IndexedDB），不在服务器上：每个浏览器/设备的数据互相独立。换设备用「设置 → 数据管理 → 导出/导入 JSON」迁移。旧版备份导入时只把最新日期的未完成计划保留为当前待办；已完成内容和旧日程转为仅用于日历历史的记录，原始表仍保留。
3. **AI Key 同理**：在设置页里填，存浏览器本地，代码里不含任何密钥。
4. 页面依赖两个 CDN（Tailwind、SheetJS、FontAwesome），纯内网/离线环境需要把 CDN 资源本地化。
5. 日历同步助手 `CalendarSync.app`（编译产物）没有打进包里——它是 macOS 本机用的，源码在 `calendar_sync.swift`，在本机用 `swiftc -O -o calendar_sync_bin calendar_sync.swift` 重新编译即可。

## AI 配置建议

公网部署时，设置页的 API Base URL 建议填写 `/ai`。服务端会把它同源转发到 `AI_TARGET`（默认 `https://api.moonshot.cn/v1`），避免浏览器跨域；若要接其他 OpenAI 兼容服务，可在启动前设置 `AI_TARGET=https://你的服务/v1`。

## 直接打开 HTML

双击 `WorkMemo_v3.html` 现在会进入本地兼容模式，不再因为浏览器禁止 `file://` 的 IndexedDB 而白屏。该模式适合查看、整理和导入数据；AI、企业微信中转、苹果日历同步等服务端功能仍需用 `启动WorkMemo.bat` 或 `npm start` 启动服务后访问 `http://localhost:8848/`。

## 公网部署最低保护

该包没有内置账号体系。单人使用至少在 nginx/Caddy/Cloudflare Access 增加一层 Basic Auth 或访问策略，并限制 `/ai/` 的调用频率；否则任何拿到地址的人都可以使用页面并消耗你填写的 API Key 配额。
