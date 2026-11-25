// 旅帳 起動ガード（本体のスクリプトより先に動く小さなスクリプト）
// 本体が起動しなかった時に、原因（エラーの文面と行番号・スクリプトが欠けていないか）を画面に出す。
// 開発者ツールが無い iPhone でも原因が分かるようにするため
(function () {
  var TB = window.__TB = { started: false, errors: [], expectLen: __JSLEN__, expectHash: '__JSHASH__', version: '__VERSION__', built: '__BUILT__' };
  function fnv(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function scriptCheck() {
    var el = document.getElementById('appScript');
    if (!el) return '本体のスクリプトが見つかりません（HTML の後半が欠けている可能性）';
    var t = el.text || el.textContent || '';
    if (t.length !== TB.expectLen) return '本体のスクリプトの長さが違います（実際 ' + t.length + ' 文字 ／ 正しくは ' + TB.expectLen + ' 文字）。貼り付けや配信の途中で欠けた・変わった可能性があります';
    if (fnv(t) !== TB.expectHash) return '本体のスクリプトの中身が違います（長さは同じ。文字が置き換わった可能性）';
    return '本体のスクリプトは完全です（長さ・中身とも一致）';
  }
  function report() {
    var lines = [
      '旅帳 起動エラー報告',
      '版：' + TB.version + '（ビルド ' + TB.built + '）',
      '状態：' + (TB.started ? '起動済み' : '起動していない'),
      'スクリプト：' + scriptCheck(),
      'GAS の接続部品（google.script.run）：' + (typeof google !== 'undefined' && google.script && google.script.run ? 'あり' : 'なし'),
      '配信元：' + location.protocol + '//' + location.host,
      '端末：' + navigator.userAgent
    ];
    TB.errors.forEach(function (e, i) { lines.push('エラー' + (i + 1) + '：' + e); });
    if (!TB.errors.length) lines.push('エラー：記録なし');
    return lines.join('\n');
  }
  function show(title) {
    var p = document.getElementById('bootPanel');
    if (!p) {
      p = document.createElement('div'); p.id = 'bootPanel';
      p.setAttribute('style', 'position:fixed;left:8px;right:8px;top:70px;z-index:99999;background:#fff;border:3px solid #dc2626;border-radius:14px;padding:12px;font:13px/1.5 -apple-system,sans-serif;color:#111;box-shadow:0 8px 30px rgba(0,0,0,.3);max-height:75vh;overflow:auto');
      (document.body || document.documentElement).appendChild(p);
    }
    p.innerHTML = '<b style="color:#dc2626;font-size:15px">⚠️ ' + esc(title) + '</b>' +
      '<pre id="bootText" style="white-space:pre-wrap;word-break:break-all;background:#f1f5f9;padding:8px;border-radius:8px;font-size:11px;margin:8px 0">' + esc(report()) + '</pre>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
      '<button id="bootCopy" style="padding:8px 10px;border-radius:8px;border:1px solid #ccc;background:#1e293b;color:#fff;font-weight:700">内容をコピー</button>' +
      '<button id="bootReload" style="padding:8px 10px;border-radius:8px;border:1px solid #ccc;background:#fff;font-weight:700">再読み込み</button>' +
      '<button id="bootReset" style="padding:8px 10px;border-radius:8px;border:1px solid #fca5a5;background:#fee2e2;color:#991b1b;font-weight:700">保存データを退避して再読み込み</button>' +
      '<button id="bootClose" style="padding:8px 10px;border-radius:8px;border:1px solid #ccc;background:#fff">閉じる</button></div>' +
      '<div style="color:#64748b;font-size:11px;margin-top:6px">「内容をコピー」した文章を送ってもらえれば原因が分かります。「退避」は端末の保存データを消さずに別名へ移します（サーバのデータは消えません）</div>';
    document.getElementById('bootCopy').onclick = function () {
      var t = report();
      if (navigator.clipboard) navigator.clipboard.writeText(t).then(function () { alert('コピーしました'); }, function () { alert('長押しで文章を選んでコピーしてください'); });
      else alert('長押しで文章を選んでコピーしてください');
    };
    document.getElementById('bootReload').onclick = function () { location.reload(); };
    document.getElementById('bootReset').onclick = function () {
      if (!confirm('この端末に保存された旅帳のデータ（未送信の変更を含む）を別名に退避して、まっさらな状態で開き直します。サーバのデータは消えません。よろしいですか？')) return;
      try {
        var stamp = Date.now(), keep = {};
        for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (/^tabicho_/.test(k) && !/^tabicho_backup_/.test(k)) keep[k] = localStorage.getItem(k); }
        localStorage.setItem('tabicho_backup_' + stamp, JSON.stringify(keep));
        Object.keys(keep).forEach(function (k) { localStorage.removeItem(k); });
      } catch (e) { alert('退避に失敗：' + e.message); return; }
      location.reload();
    };
    document.getElementById('bootClose').onclick = function () { p.remove(); };
  }
  TB.show = show;
  TB.fail = function (where, e) {
    TB.errors.push(where + '：' + (e && e.message || e) + (e && e.stack ? '\n' + String(e.stack).split('\n').slice(0, 3).join('\n') : ''));
    show('旅帳の起動中にエラーが起きました');
  };
  window.addEventListener('error', function (e) {
    var msg = (e.message || 'エラー') + (e.filename || e.lineno ? '（' + (e.lineno || '?') + '行 ' + (e.colno || '?') + '列）' : '') + (e.error && e.error.stack ? '\n' + String(e.error.stack).split('\n').slice(0, 3).join('\n') : '');
    TB.errors.push(msg);
    if (!TB.started) show('旅帳のスクリプトでエラーが起きました');
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason; TB.errors.push('（非同期）' + (r && r.message || r));
    if (!TB.started) show('旅帳の起動中にエラーが起きました');
  });
  setTimeout(function () { if (!TB.started) show('旅帳が起動しませんでした'); }, 6000);
})();
