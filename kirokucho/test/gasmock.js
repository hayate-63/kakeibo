// GAS 実行環境の簡易モック（SpreadsheetApp / PropertiesService / CacheService /
// LockService / UrlFetchApp など）。gas-v1.0.txt を vm で読み込んで動かす。
const fs = require('fs'), vm = require('vm');

function makeSheet(name, ss) {
  let data = []; // 2D
  const sh = {
    _fmt: {}, _hidden: false,
    get _data() { return data; },
    getName: () => name,
    setName: n => { name = n; return sh; },
    hideSheet: () => { sh._hidden = true; return sh; },
    getLastRow: () => { for (let i = data.length - 1; i >= 0; i--) if (data[i] && data[i].some(v => v !== '' && v != null)) return i + 1; return 0; },
    getLastColumn: () => data.reduce((m, r) => Math.max(m, r ? r.length : 0), 0),
    setFrozenRows: () => sh,
    clearContents: () => { data = []; return sh; },
    copyTo: target => { const c = target.insertSheet('copy'); data.forEach((r, i) => { c._data[i] = r.slice(); }); return c; },
    getDataRange: () => sh.getRange(1, 1, Math.max(1, sh.getLastRow()), Math.max(1, sh.getLastColumn())),
    getRange: (r, c, nr = 1, nc = 1) => {
      const rg = {
        getValues: () => { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) { const v = data[r - 1 + i] ? data[r - 1 + i][c - 1 + j] : undefined; row.push(v === undefined ? '' : v); } out.push(row); } return out; },
        setValues: vals => {
          if (vals.length !== nr || vals[0].length !== nc) throw new Error('size mismatch');
          for (let i = 0; i < nr; i++) {
            if (!data[r - 1 + i]) data[r - 1 + i] = [];
            for (let j = 0; j < nc; j++) {
              let v = vals[i][j];
              // 書式なしテキスト（@）以外は Sheets の自動変換（日付・数値）を模す
              const fmt = sh._fmt[(r + i) + ':' + (c + j)];
              if (fmt !== '@' && typeof v === 'string') {
                if (/^\d{4}-\d{2}-\d{2}$/.test(v)) v = new Date(v + 'T00:00:00+09:00');
                else if (/^-?\d+(\.\d+)?$/.test(v)) v = Number(v);
              }
              data[r - 1 + i][c - 1 + j] = v;
            }
          }
          return rg;
        },
        setNumberFormat: f => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) sh._fmt[(r + i) + ':' + (c + j)] = f; return rg; }
      };
      return rg;
    }
  };
  return sh;
}

function makeSpreadsheet() {
  const sheets = [];
  const ss = {
    _sheets: sheets,
    getSheetByName: n => sheets.find(s => s.getName() === n) || null,
    insertSheet: n => { const s = makeSheet(n, ss); sheets.push(s); return s; },
    getSheets: () => sheets.slice(),
    deleteSheet: s => { const i = sheets.indexOf(s); if (i >= 0) sheets.splice(i, 1); }
  };
  ss.insertSheet('シート1');
  return ss;
}

function pad(n, w) { return String(n).padStart(w || 2, '0'); }
function formatDate(d, tz, f) {
  const x = new Date(d.getTime() + 9 * 3600e3); // JST
  const Y = x.getUTCFullYear(), M = pad(x.getUTCMonth() + 1), D = pad(x.getUTCDate());
  const h = pad(x.getUTCHours()), m = pad(x.getUTCMinutes()), s = pad(x.getUTCSeconds()), S = pad(x.getUTCMilliseconds(), 3);
  return f.replace('yyyy', Y).replace('MM', M).replace('dd', D).replace('HH', h).replace('mm', m).replace('ss', s).replace('SSS', S);
}

/**
 * opts.gasPath, opts.props（スクリプトプロパティの初期値）,
 * opts.fetch(url, options) → { code, body }（家計簿 GAS のモック）
 */
function makeEnv(opts) {
  const ss = makeSpreadsheet();
  const props = Object.assign({}, opts.props || {});
  const cache = {};
  const fetchLog = [];
  const env = { lockBusy: false };
  const ctx = {
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush: () => {} },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = String(v); },
      deleteProperty: k => { delete props[k]; }
    }) },
    CacheService: { getScriptCache: () => ({
      get: k => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = String(v); }, remove: k => { delete cache[k]; }
    }) },
    ContentService: { createTextOutput: s => ({ content: s, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    LockService: { getScriptLock: () => ({ tryLock: () => !env.lockBusy, waitLock() {}, releaseLock() {} }) },
    Utilities: { formatDate },
    Logger: { log: m => { env.lastLog = m; } },
    UrlFetchApp: { fetch: (url, o) => {
      fetchLog.push({ url, o });
      const r = opts.fetch ? opts.fetch(url, o) : { code: 404, body: 'not found' };
      if (r.throw) throw new Error(r.throw);
      return { getResponseCode: () => r.code, getContentText: () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) };
    } }
  };
  vm.createContext(ctx);
  const src = fs.readFileSync(opts.gasPath, 'utf8');
  vm.runInContext(src + '\n;this.__doPost = doPost; this.__doGet = doGet; this.__setup = setup;', ctx);
  return Object.assign(env, {
    ss, props, cache, fetchLog, ctx,
    setup: () => ctx.__setup(),
    doGet: () => JSON.parse(ctx.__doGet({}).content),
    doPostRaw: body => ctx.__doPost({ postData: { contents: body } }).content,
    doPost: obj => JSON.parse(ctx.__doPost({ postData: { contents: JSON.stringify(obj) } }).content),
    sheetRows: name => { const sh = ss.getSheetByName(name); return sh ? sh._data.filter(r => r && r.some(v => v !== '')).map(r => r.slice()) : null; }
  });
}
module.exports = { makeEnv };
