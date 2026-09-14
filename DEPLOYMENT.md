# WorkMemo 公网部署规划

## 推荐形态

WorkMemo 当前是“浏览器本地优先”应用：数据和 API Key 在浏览器 IndexedDB，不在服务端数据库。最省改动的公网形态是 **一台长期运行的 Node.js 服务 + Caddy/Nginx HTTPS 反向代理 + 一层访问保护**。这样可以同时提供 v3 页面、`/ai/*` 同源 AI 中转和 `/workmemo.ics` 订阅。

如果只想单人使用，优先选择腾讯云轻量应用服务器、阿里云轻量服务器或一台已有 VPS；如果主要面向海外访问，可选 Render/Fly.io/Railway。若服务器在中国大陆，域名正式对公网提供网页通常还需要按服务商要求完成备案。

## 需要你准备/注册

1. Moonshot/Kimi 开放平台账号和 API Key，并确认实际可用的模型名（例如账户控制台显示的模型，不要只照抄示例）。
2. 一台可长期运行 Node.js 18+ 的服务器。
3. 一个域名（可选但建议），并把 DNS 的 A/AAAA 记录指向服务器。
4. HTTPS 证书：Caddy 可自动申请 Let's Encrypt 证书；若使用 Cloudflare，可用 Cloudflare Access 做登录保护。
5. 若服务器位于中国大陆，向云厂商确认域名备案要求。

## 服务端配置

```bash
PORT=8848 \
AI_TARGET=https://api.moonshot.cn/v1 \
node proxy-server.mjs
```

在 WorkMemo 设置页将 API Base URL 填为 `/ai`，模型名填写 Kimi 控制台实际提供的名称。公网访问必须通过 HTTPS 反向代理，并至少开启 Basic Auth、Cloudflare Access 或 IP 白名单中的一种。

## 数据迁移与备份

- 旧版 JSON 可直接在 v3 设置页导入；旧 `dailyPlans` / `schedules` 会转为新版事项，原始表仍保留。
- 也可以先运行 `node scripts/convert-workmemo-backup.mjs 旧备份.json 新备份.json`，再导入生成的 v4 文件。
- 因为数据默认在浏览器里，换电脑/浏览器前要先导出 JSON；公网部署不会自动把多个设备的数据合并。

## 后续可选升级

若以后需要多设备实时同步、多人协作或集中权限管理，再把 IndexedDB 替换为服务端数据库（例如 SQLite/PostgreSQL）和登录体系；这属于下一阶段架构改造，不建议与本次公网部署一起做。
