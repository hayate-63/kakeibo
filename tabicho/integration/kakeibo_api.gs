/**
 * 【家計簿GASに追加するファイル】旅帳からの明細受け取りAPI
 *
 * 旅帳は「自分の負担分」を支出明細ごとに送ってくる（カード払いは 引落額の支出 ＋ 割り勘分の収入 の2行）。
 * 各行の sourceKey で二重登録を防ぐ。
 *
 * 手順：
 *  1. 家計簿のGASプロジェクトにこのファイルを追加
 *  2. 既存の doPost の先頭に次の2行を足す（既存の処理はそのまま）
 *
 *     var body = JSON.parse(e.postData.contents || '{}');
 *     if (String(body.action || '').indexOf('tabicho.') === 0) return tabichoKakeiboHandle_(body);
 *
 *  3. 下の設定を家計簿の明細シートの見出しに合わせる
 *     （家計簿アプリの明細は id / amount / date / memo / category の5項目）
 *  4. 既存デプロイを「新バージョン」で更新（URLは変わらない）
 *
 * ※ ほしいもの帳→家計簿の連携ですでに受け口がある場合は、その関数に logs を渡す形にしても良い。
 * ※ 家計簿アプリは起動時にクラウドから読み込んでから保存するため、旅帳から送った後は
 *    家計簿アプリを開き直して（同期して）から編集すること。
 */
var TABICHO_KAKEIBO_CONFIG = {
  logsSheet: 'logs',             // 明細シート名
  pinProperty: '',               // PINを確認する場合のスクリプトプロパティ名（旅帳側 KAKEIBO_PIN と一致させる）
  cols: { id: 'id', amount: 'amount', date: 'date', memo: 'memo', category: 'category' },
  sentSheet: 'tabicho_sent'      // 送信済み sourceKey の控え（二重登録防止）
};

function tabichoKakeiboHandle_(body) {
  var out;
  try {
    var C = TABICHO_KAKEIBO_CONFIG;
    if (C.pinProperty) {
      var pin = PropertiesService.getScriptProperties().getProperty(C.pinProperty);
      if (pin && String(body.pin) !== String(pin)) throw new Error('PINが違います');
    }
    var a = String(body.action).replace('tabicho.', '');
    if (a === 'ping') out = { ok: true, note: '家計簿 OK' };
    else if (a === 'appendLogs') out = tabichoAppendLogs_(body.logs || []);
    else throw new Error('未知の操作: ' + a);
  } catch (e) { out = { ok: false, error: String(e.message || e) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function tabichoAppendLogs_(logs) {
  var C = TABICHO_KAKEIBO_CONFIG;
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.getActive();
    var sh = ss.getSheetByName(C.logsSheet);
    if (!sh) throw new Error('シート「' + C.logsSheet + '」がありません');
    var sent = ss.getSheetByName(C.sentSheet);
    if (!sent) { sent = ss.insertSheet(C.sentSheet); sent.appendRow(['sourceKey', 'id', 'sentAt']); sent.hideSheet(); }
    var done = {};
    sent.getDataRange().getValues().slice(1).forEach(function (r) { done[r[0]] = true; });
    var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    var idx = {}; Object.keys(C.cols).forEach(function (k) { idx[k] = head.indexOf(C.cols[k]); });
    ['amount', 'date', 'memo', 'category'].forEach(function (k) { if (idx[k] < 0) throw new Error('明細シートに「' + C.cols[k] + '」列がありません'); });
    var rows = [], keys = [], sentRows = [], skipped = 0;
    var base = Date.now();
    logs.forEach(function (l, i) {
      if (!l.sourceKey) return;
      if (done[l.sourceKey]) { skipped++; keys.push(l.sourceKey); return; }
      var row = head.map(function () { return ''; });
      var id = base + i;
      if (idx.id >= 0) row[idx.id] = id;
      row[idx.amount] = Number(l.amount);
      row[idx.date] = l.date;
      row[idx.memo] = l.memo;
      row[idx.category] = l.category;
      rows.push(row); keys.push(l.sourceKey); sentRows.push([l.sourceKey, id, new Date().toISOString()]);
    });
    if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, head.length).setValues(rows);
    if (sentRows.length) sent.getRange(sent.getLastRow() + 1, 1, sentRows.length, 3).setValues(sentRows);
    return { ok: true, sent: rows.length, skipped: skipped, keys: keys };
  } finally { lock.releaseLock(); }
}
