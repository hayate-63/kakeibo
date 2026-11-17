// GAS 実行環境の簡易モック（SpreadsheetApp 等）。gas-v1.0.gs を vm で読み込む
const fs = require('fs'), vm = require('vm');
function makeSheet(name) {
  const data = []; // 2D
  const sh = {
    _data: data, _fmt: {},
    getName: () => name,
    getMaxRows: () => Math.max(1000, data.length),
    getLastRow: () => { for (let i = data.length - 1; i >= 0; i--) if (data[i] && data[i].some(v => v !== '' && v != null)) return i + 1; return 0; },
    getLastColumn: () => data.reduce((m, r) => Math.max(m, r ? r.length : 0), 0),
    setFrozenRows: () => sh,
    deleteRow: r => { data.splice(r - 1, 1); },
    getRange: (r, c, nr = 1, nc = 1) => {
      const rg = {
        getValues: () => { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) { const v = data[r - 1 + i] ? data[r - 1 + i][c - 1 + j] : undefined; row.push(v === undefined ? '' : v); } out.push(row); } return out; },
        setValues: vals => { if (vals.length !== nr || vals[0].length !== nc) throw new Error('size mismatch ' + vals.length + 'x' + vals[0].length + ' vs ' + nr + 'x' + nc);
          for (let i = 0; i < nr; i++) { if (!data[r - 1 + i]) data[r - 1 + i] = []; for (let j = 0; j < nc; j++) { let v = vals[i][j];
            // 書式なしテキスト指定が無い列は Sheets の自動変換を模す（日付・数値）
            const fmt = sh._fmt[(r + i) + ':' + (c + j)];
            if (fmt !== '@' && typeof v === 'string') { if (/^\d{4}-\d{2}-\d{2}$/.test(v)) v = new Date(v + 'T00:00:00+09:00'); else if (/^-?\d+(\.\d+)?$/.test(v)) v = Number(v); }
            data[r - 1 + i][c - 1 + j] = v; } } return rg; },
        setNumberFormat: f => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) sh._fmt[(r + i) + ':' + (c + j)] = f; return rg; },
        setFontWeight: () => rg
      };
      return rg;
    }
  };
  return sh;
}
// Google Drive の簡易モック（v2.0 写真用）
function makeDrive() {
  let seq = 0;
  const folders = {}, files = {};
  const iter = a => { let i = 0; return { hasNext: () => i < a.length, next: () => a[i++] }; };
  const mkFolder = name => {
    const id = 'FOLDER' + (++seq);
    const f = { _name: name, getId: () => id, getName: () => name, getUrl: () => 'https://drive.google.com/drive/folders/' + id,
      createFile: blob => {
        const fid = 'FILE' + (++seq);
        const file = { _blob: blob, _parents: [id], _trashed: false, _sharing: null,
          getId: () => fid, getName: () => blob.name, getParents: () => iter(file._parents.map(p => folders[p])),
          setSharing: (a, p) => { file._sharing = [a, p]; return file; }, setTrashed: t => { file._trashed = t; return file; } };
        files[fid] = file; return file;
      } };
    folders[id] = f; return f;
  };
  const DriveApp = {
    _folders: folders, _files: files, _mkFolder: mkFolder,
    Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' }, Permission: { VIEW: 'VIEW' },
    getFolderById: id => { if (!folders[id]) throw new Error('no folder'); return folders[id]; },
    getFoldersByName: n => iter(Object.values(folders).filter(f => f._name === n)),
    createFolder: n => mkFolder(n),
    getFileById: id => { if (!files[id]) throw new Error('no file'); return files[id]; }
  };
  return DriveApp;
}
function makeEnv(opts) {
  const sheets = opts.ss ? null : [makeSheet('シート1')];
  const ss = opts.ss || {
    getSheetByName: n => sheets.find(s => s.getName() === n) || null,
    insertSheet: n => { const s = makeSheet(n); sheets.push(s); return s; },
    getSheets: () => sheets.slice(),
    deleteSheet: s => sheets.splice(sheets.indexOf(s), 1),
    getUrl: () => 'https://docs.google.com/mock', getId: () => 'MOCKID'
  };
  const props = opts.props || {};
  const DriveApp = opts.drive || makeDrive();
  const fetchLog = [];
  const ctx = {
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => null, openById: () => ss, create: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    ContentService: { createTextOutput: s => ({ content: s, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      formatDate: (d, tz, f) => { const x = new Date(d.getTime() + 9 * 3600e3); return f === 'yyyy-MM-dd' ? x.toISOString().slice(0, 10) : x.toISOString().replace(/\D/g, '').slice(0, 14); },
      base64Decode: b => Array.from(Buffer.from(b, 'base64')),
      newBlob: (bytes, type, name) => ({ bytes: Buffer.from(bytes), type, name })
    },
    DriveApp,
    Logger: { log: () => {} },
    UrlFetchApp: { fetch: (url, o) => { fetchLog.push({ url, o }); return opts.fetch(url, o); } }
  };
  vm.createContext(ctx);
  let src = fs.readFileSync(opts.gasPath, 'utf8').replace("const SECRET_PIN = '0000'", "const SECRET_PIN = '" + opts.pin + "'");
  vm.runInContext(src + '\n;this.__doPost = doPost; this.__doGet = doGet; this.__setup = setup;', ctx);
  return { ss, ctx, fetchLog, props, DriveApp, doGet: () => JSON.parse(ctx.__doGet({}).content), doPost: body => JSON.parse(ctx.__doPost({ postData: { contents: body } }).content) };
}
module.exports = { makeEnv };
