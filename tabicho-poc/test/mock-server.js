// PoC 用の模擬サーバ：GAS（/exec）と Drive の resumable upload（/upload/<id>）の振る舞いを真似る
//   node mock-server.js <ページ用ポート> <GAS・Drive 用ポート>
// ページは別オリジン（別ポート）から配信し、CORS を実際にブラウザに判定させる
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PAGE_PORT = Number(process.argv[2] || 8701);
const API_PORT = Number(process.argv[3] || 8702);
const PIN = '1234';
const API = `http://127.0.0.1:${API_PORT}`;

const state = { sessions: {}, files: {}, seq: 0, failOnPut: 0, hangOnPut: 0, putCount: 0, exposeRange: true, delayMs: 0 };

function send(res, code, body, headers) {
  res.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, headers || {}));
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
function readBody(req) { return new Promise(r => { const b = []; req.on('data', c => b.push(c)); req.on('end', () => r(Buffer.concat(b))); }); }
function sessionStatus(s) {
  if (s.fileId) return { code: 200, file: state.files[s.fileId].meta };
  return { code: 308, range: s.data.length ? `bytes=0-${s.data.length - 1}` : '' };
}
function corsFor(s, origin) {
  if (!s.cors || origin !== s.origin) return {};
  const h = { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' };
  if (state.exposeRange) h['Access-Control-Expose-Headers'] = 'Range';
  return h;
}
function applyChunk(s, start, buf, total) {
  if (start > s.data.length) return { code: 400, body: '欠けがあります' };
  s.data = Buffer.concat([s.data.subarray(0, start), buf]);
  if (s.data.length >= total) {
    const id = 'F' + (++state.seq);
    const meta = { id, name: s.name, mimeType: s.mime, size: String(total), md5Checksum: crypto.createHash('md5').update(s.data).digest('hex') };
    state.files[id] = { meta, data: s.data, sharing: 'PRIVATE' };
    s.fileId = id;
    return { code: 200, file: meta };
  }
  return { code: 308, range: `bytes=0-${s.data.length - 1}` };
}

// ---- ページ ----
http.createServer((req, res) => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'gas', 'index.html'));
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html);
}).listen(PAGE_PORT, '127.0.0.1');

// ---- GAS ＋ Drive ----
http.createServer(async (req, res) => {
  const url = new URL(req.url, API);
  const origin = req.headers.origin || '';
  if (url.pathname === '/control') { // テストからの切替
    Object.assign(state, JSON.parse(url.searchParams.get('set') || '{}')); state.putCount = 0;
    return send(res, 200, { ok: true });
  }
  if (url.pathname === '/debug') return send(res, 200, Object.values(state.files).map(f => ({ meta: f.meta, md5: crypto.createHash('md5').update(f.data).digest('hex') })));

  if (url.pathname === '/exec') { // GAS ウェブアプリ（simple POST。GAS は Access-Control-Allow-Origin: * を返す）
    const cors = { 'Access-Control-Allow-Origin': '*' };
    if (req.method !== 'POST') return send(res, 405, {}, cors);
    const q = JSON.parse((await readBody(req)).toString('utf8'));
    if (q.pin !== PIN) return send(res, 200, { status: 'error', code: 'AUTH', message: 'PIN が一致しません' }, cors);
    const ok = (o) => send(res, 200, Object.assign({ status: 'ok', gasMs: 5 }, o), cors);
    switch (q.action) {
      case 'ping': return ok({ version: '0.1-mock', folder: '旅帳PoC' });
      case 'createSession': {
        const id = 'S' + (++state.seq);
        const sendOrigin = q.originMode !== 'omit' && q.origin;
        state.sessions[id] = { name: q.name, mime: q.mimeType, size: q.size, data: Buffer.alloc(0), cors: !!sendOrigin, origin: q.origin };
        return ok({ ok: true, sessionUri: `${API}/upload/${id}`, evidence: {
          originMode: q.originMode, originRequested: sendOrigin ? q.origin : '', plannedRequestHeaders: sendOrigin ? { Origin: q.origin, Authorization: 'Bearer ***' } : { Authorization: 'Bearer ***' },
          originInPlannedRequest: !!sendOrigin, responseCode: 200, responseCorsHeaders: sendOrigin ? { 'Access-Control-Allow-Origin': q.origin } : {}, responseHeaderNames: ['Location'] } });
      }
      case 'status': { const s = state.sessions[q.sessionUri.split('/').pop()]; if (!s) return ok({ code: 404 }); return ok(sessionStatus(s)); }
      case 'relayChunk': {
        const s = state.sessions[q.sessionUri.split('/').pop()];
        return ok(applyChunk(s, Number(q.start), Buffer.from(q.b64, 'base64'), Number(q.total)));
      }
      case 'smallUpload': { const id = 'F' + (++state.seq); const data = Buffer.from(q.b64, 'base64'); state.files[id] = { meta: { id, name: q.name, mimeType: q.mimeType, size: String(data.length) }, data, sharing: 'PRIVATE' }; return ok({ id, createMs: 30 }); }
      case 'listFiles': return ok({ files: Object.values(state.files).map(f => ({ id: f.meta.id, name: f.meta.name, size: Number(f.meta.size), mimeType: f.meta.mimeType, created: '' })) });
      case 'fileInfo': {
        const f = state.files[q.id];
        const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
        return ok({ info: Object.assign({}, f.meta, /^video/.test(f.meta.mimeType) ? { videoMediaMetadata: { width: 1920, height: 1080, durationMillis: 30000 } } : { imageMediaMetadata: { width: 4032, height: 3024 } }), thumb: 'data:image/png;base64,' + png, sharing: f.sharing });
      }
      case 'original': { const f = state.files[q.id]; return ok({ mimeType: f.meta.mimeType, dataUrl: `data:${f.meta.mimeType};base64,` + f.data.toString('base64') }); }
      case 'setShare': { const f = state.files[q.id]; f.sharing = q.on ? 'ANYONE_WITH_LINK' : 'PRIVATE'; return ok({ sharing: f.sharing }); }
      case 'trash': delete state.files[q.id]; return ok({});
      case 'saveLog': return ok({ id: 'L1', name: 'PoC結果_test.txt' });
      default: return ok({ status: 'error', message: '不明な action' });
    }
  }

  const m = url.pathname.match(/^\/upload\/(S\d+)$/);
  if (m) { // Drive の resumable セッション URI
    const s = state.sessions[m[1]];
    if (!s) return send(res, 404, { error: 'not found' });
    const cors = corsFor(s, origin);
    if (req.method === 'OPTIONS') {
      if (!cors['Access-Control-Allow-Origin']) { res.writeHead(200); return res.end(); } // CORS ヘッダなし → ブラウザが弾く
      res.writeHead(204, Object.assign({ 'Access-Control-Allow-Methods': 'PUT', 'Access-Control-Allow-Headers': 'content-range, content-type', 'Access-Control-Max-Age': '3600' }, cors));
      return res.end();
    }
    if (req.method !== 'PUT') return send(res, 405, {}, cors);
    const body = await readBody(req);
    const cr = String(req.headers['content-range'] || '');
    if (state.delayMs) await new Promise(r => setTimeout(r, state.delayMs));
    let r;
    let mm;
    if ((mm = cr.match(/^bytes \*\/(\d+)$/))) r = sessionStatus(s);
    else if ((mm = cr.match(/^bytes (\d+)-(\d+)\/(\d+)$/))) {
      state.putCount++;
      if (state.hangOnPut && state.putCount === state.hangOnPut) { state.hangOnPut = 0; return; } // 応答を返さず止める（iOS で裏に回した時の通信の止まり方を真似る）
      if (state.failOnPut && state.putCount === state.failOnPut) { state.failOnPut = 0; return send(res, 503, { error: 'backendError' }, cors); } // 一時的なサーバエラーを1回だけ起こす
      r = applyChunk(s, Number(mm[1]), body, Number(mm[3]));
    } else r = { code: 400, body: 'Content-Range が不正' };
    if (r.code === 308) { res.writeHead(308, Object.assign(r.range ? { Range: r.range } : {}, cors)); return res.end(); }
    if (r.code === 200) return send(res, 200, r.file, cors);
    return send(res, r.code, { error: r.body }, cors);
  }
  send(res, 404, {});
}).listen(API_PORT, '127.0.0.1');

console.log(`mock: page http://127.0.0.1:${PAGE_PORT}/ ／ GAS ${API}/exec`);
