import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHmac, timingSafeEqual } from 'node:crypto';
import os from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8848;
const AI_TARGET = (process.env.AI_TARGET || 'https://api.moonshot.cn/v1').replace(/\/+$/, '');
const ACCESS_CODE = process.env.WORKMEMO_ACCESS_CODE || 'workmemo';
const SESSION_SECRET = process.env.WORKMEMO_SESSION_SECRET || 'workmemo-session:' + ACCESS_CODE;
const PANORAMA_PATH = process.env.PANORAMA_PATH || '/Users/julianhuang/Documents/Kimi/Workspaces/DIP/DIP客户全景地图V2.html';
const CAL_SYNC_CACHE = join(__dirname, 'calendar_sync.json');
const CAL_RESULT = join(__dirname, 'calendar_sync_result.json');
const JXA_SYNC = join(__dirname, 'calendar_sync.jxa.js');
const JXA_STATUS = join(__dirname, 'calendar_status.jxa.js');
const CAL_BIN = join(__dirname, 'CalendarSync.app/Contents/MacOS/CalendarSync');
const CAL_APP = join(__dirname, 'CalendarSync.app');

function lanIps() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const it of list || []) {
      if (it.family === 'IPv4' && !it.internal) out.push(it.address);
    }
  }
  return out;
}

function icsEscape(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
function icsDate(iso) {
  const d = new Date(iso);
  const p = n => String(n).padStart(2, '0');
  return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + 'T' + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + 'Z';
}
function icsFold(line) {
  let out = '', cur = '';
  for (const ch of line) {
    if (Buffer.byteLength(cur, 'utf-8') + Buffer.byteLength(ch, 'utf-8') > 74) { out += cur + '\r\n '; cur = ch; }
    else cur += ch;
  }
  return out + cur;
}
function buildIcs(events) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//WorkMemo//WorkMemo Calendar//CN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:WorkMemo'];
  const stamp = icsDate(new Date().toISOString());
  for (const e of events) {
    lines.push('BEGIN:VEVENT');
    lines.push('UID:' + e.uid + '@workmemo.local');
    lines.push('DTSTAMP:' + stamp);
    lines.push('DTSTART:' + icsDate(e.start));
    lines.push('DTEND:' + icsDate(e.end || e.start));
    lines.push(icsFold('SUMMARY:' + icsEscape(e.title || '（无标题）')));
    if (e.note) lines.push(icsFold('DESCRIPTION:' + icsEscape(e.note)));
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sessionToken() {
  return createHmac('sha256', SESSION_SECRET).update(ACCESS_CODE).digest('hex');
}
function hasSession(req) {
  const header = String(req.headers.cookie || '');
  const match = header.match(/(?:^|;\s*)wm_session=([^;]+)/);
  if (!match) return false;
  const actual = Buffer.from(decodeURIComponent(match[1]));
  const expected = Buffer.from(sessionToken());
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function readJsonBody(req) {
  return (async () => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    return JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
  })();
}
function authCookie(req) {
  const secure = String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https' ? '; Secure' : '';
  return 'wm_session=' + encodeURIComponent(sessionToken()) + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000' + secure;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ---- 访问代码登录（Node 公网部署时保护 API；静态 GitHub Pages 会自动退回前端轻量确认） ----
  if (url.pathname === '/api/auth/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ authenticated: hasSession(req) }));
  }
  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      if (String(body.code || '') !== ACCESS_CODE) {
        res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify({ ok: false, error: 'INVALID_CODE' }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Set-Cookie': authCookie(req) });
      return res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  }
  if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': 'wm_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
    return res.end(JSON.stringify({ ok: true }));
  }
  if ((url.pathname.startsWith('/api/') || url.pathname.startsWith('/ai/')) && !hasSession(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ ok: false, error: 'AUTH_REQUIRED' }));
  }

  // ---- AI Proxy: /ai/* → https://aicoding.wenge.com/v1/* ----
  if (url.pathname.startsWith('/ai/')) {
    const aiPath = url.pathname.replace(/^\/ai/, '');
    const targetUrl = AI_TARGET + aiPath + (url.search || '');

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    // Forward request
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;

    try {
      const aiResp = await fetch(targetUrl, {
        method: req.method,
        headers: {
          'Content-Type': req.headers['content-type'] || 'application/json',
          ...(req.headers['authorization'] ? { 'Authorization': req.headers['authorization'] } : {}),
        },
        body: body && req.method !== 'GET' && req.method !== 'HEAD' ? body : undefined,
      });

      res.writeHead(aiResp.status, {
        'Content-Type': aiResp.headers.get('content-type') || 'application/json',
        'Cache-Control': 'no-store',
      });
      if (!aiResp.body) return res.end();
      const reader = aiResp.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!res.write(value)) await new Promise(resolve => res.once('drain', resolve));
        }
      } finally {
        res.end();
      }
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Proxy error: ' + e.message }));
    }
    return;
  }

  // ---- 全景图同步：重新生成客户数据包 ----
  if (url.pathname === '/api/refresh-customers' && req.method === 'POST') {
    try {
      const { spawnSync } = await import('node:child_process');
      const r = spawnSync('python3', [join(__dirname, 'sync_customers.py')], {
        env: { ...process.env, PANORAMA_PATH }, encoding: 'utf-8', timeout: 60000
      });
      const lines = (r.stdout || '').trim().split('\n');
      const payload = lines.length ? JSON.parse(lines[lines.length - 1]) : { ok: false, error: (r.stderr || '').slice(-300) };
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(payload));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // ---- 企业微信群机器人推送中转（浏览器直连 qyapi 有 CORS 限制） ----
  if (url.pathname === '/api/wecom-push' && req.method === 'POST') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let payload;
    try {
      const reqBody = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
      const key = String(reqBody.key || '');
      const msg = reqBody.payload || {};
      if (!key || !msg.msgtype) throw new Error('缺少 key 或 payload.msgtype');
      const wResp = await fetch('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=' + encodeURIComponent(key), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(msg),
      });
      payload = await wResp.json();
    } catch (e) {
      payload = { ok: false, errcode: -1, error: e.message };
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
    return;
  }

  // ---- 苹果日历同步：状态探测（经 LaunchServices 启动，才能拿到真实授权状态） ----
  if (url.pathname === '/api/calendar/status' && req.method === 'GET') {
    let payload;
    try {
      const { unlink } = await import('node:fs/promises');
      await unlink(CAL_RESULT).catch(() => {});
      const r = spawnSync('open', ['-W', CAL_APP, '--args', JSON.stringify({ check: true, calendarName: 'WorkMemo' })], { encoding: 'utf-8', timeout: 20000 });
      if (r.error || r.signal || r.status !== 0) {
        payload = { ok: false, error: 'TIMEOUT', hint: '状态探测超时' };
      } else {
        payload = JSON.parse(await readFile(CAL_RESULT, 'utf-8'));
        // EKAuthorizationStatus: 0 未决定 1 受限 2 拒绝 3 完全访问
        if (!payload.ok && payload.status === 0) payload.error = '尚未授权（点「立即同步」会弹出授权窗口）';
        else if (!payload.ok && payload.status === 2) payload.error = '日历访问曾被拒绝：请到 系统设置 → 隐私与安全性 → 日历 打开「WorkMemo日历同步」';
      }
    } catch (e) {
      payload = { ok: false, error: e.message };
    }
    payload.lanIps = lanIps();
    payload.port = PORT;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
    return;
  }

  // ---- 苹果日历同步：全量对账写入（EventKit 原生助手） ----
  if (url.pathname === '/api/calendar/sync' && req.method === 'POST') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let payload;
    try {
      const reqBody = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
      const events = Array.isArray(reqBody.events) ? reqBody.events : [];
      // 先落缓存（ICS 订阅源 + App 模式输入都据此）
      await writeFile(CAL_SYNC_CACHE, JSON.stringify({ updatedAt: new Date().toISOString(), calendarName: reqBody.calendarName || 'WorkMemo', events }, null, 2), 'utf-8');
      // 经 LaunchServices 启动 CalendarSync.app（TCC 授权弹窗才能正常弹出并归属本 App）
      const { unlink } = await import('node:fs/promises');
      await unlink(CAL_RESULT).catch(() => {});
      const r = spawnSync('open', ['-W', CAL_APP], { encoding: 'utf-8', timeout: 170000 });
      if (r.error || r.signal || r.status !== 0) {
        payload = { ok: false, error: 'TIMEOUT', hint: '授权弹窗等待超时或启动失败，请重新点「立即同步」并在弹窗中点「允许」', icsReady: true, eventCount: events.length };
      } else {
        try {
          payload = JSON.parse(await readFile(CAL_RESULT, 'utf-8'));
          payload.icsReady = true;
        } catch {
          payload = { ok: false, error: '同步助手未返回结果', icsReady: true };
        }
      }
    } catch (e) {
      payload = { ok: false, error: e.message };
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
    return;
  }

  // ---- iPhone 订阅日历源（webcal://<MacIP>:8848/workmemo.ics） ----
  if (url.pathname === '/workmemo.ics') {
    let events = [];
    try {
      const cache = JSON.parse(await readFile(CAL_SYNC_CACHE, 'utf-8'));
      events = cache.events || [];
    } catch { /* 无缓存则输出空日历 */ }
    res.writeHead(200, {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Content-Disposition': 'inline; filename="workmemo.ics"',
    });
    res.end(buildIcs(events));
    return;
  }

  // ---- 静态文件 ----
  const relativePath = decodeURIComponent(url.pathname).replace(/^[/\\]+/, '');
  let filePath = resolve(__dirname, relativePath);
  if (url.pathname === '/' || url.pathname === '/index.html') filePath = join(__dirname, 'WorkMemo_v3.html');
  if (url.pathname === '/panorama' || url.pathname === '/panorama.html') filePath = PANORAMA_PATH;

  // 仅允许读取服务目录内的静态文件；/panorama 是显式配置的例外路径。
  const insideRoot = filePath === __dirname || filePath.startsWith(__dirname + sep);
  if (!insideRoot && filePath !== resolve(PANORAMA_PATH)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Forbidden');
  }

  try {
    const content = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found: ' + url.pathname);
  }
});

server.listen(PORT, () => {
  console.log(`\n  WorkMemo 本地服务已启动: http://localhost:${PORT}\n`);
  console.log(`  AI 代理: /ai/chat/completions → ${AI_TARGET}/chat/completions\n`);
  console.log(`  按 Ctrl+C 停止\n`);
});
