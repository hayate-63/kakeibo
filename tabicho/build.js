// 旅帳のビルド：src/ の HTML・CSS・JS を1枚の gas/index.html にまとめる
//   node tabicho/build.js
// v2.0.1：
//  ・本体の JS を関数の中に包む（GAS が画面に入れる部品のグローバル名とぶつからないように）
//  ・起動ガード（src/boot.js）を本体より先に入れ、本体の長さとチェックサムを埋め込む
//    （配信・貼り付けで欠けた／変わったことを、実機の画面で見分けられるように）
const fs = require('fs'), path = require('path');
const src = path.join(__dirname, 'src');
const html = fs.readFileSync(path.join(src, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(src, 'styles.css'), 'utf8');
const jsDir = path.join(src, 'js');
const body = fs.readdirSync(jsDir).filter(f => f.endsWith('.js')).sort()
  .map(f => `// ---- ${f} ----\n` + fs.readFileSync(path.join(jsDir, f), 'utf8')).join('\n');
const version = (body.match(/const APP_VERSION = '([^']+)'/) || [])[1] || '?';
const js = ';(function () {\n' + body + '\n})();\n';
if (/<\/script/i.test(js)) throw new Error('JSに </script が含まれています');
// 起動ガードと同じ計算（FNV-1a 32bit を UTF-16 の文字単位で）
function fnv(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }
const built = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') + ' JST';
const boot = fs.readFileSync(path.join(src, 'boot.js'), 'utf8')
  .replace('__JSLEN__', String(js.length)).replace('__JSHASH__', fnv(js)).replace('__VERSION__', version).replace('__BUILT__', built);
if (/<\/script/i.test(boot)) throw new Error('起動ガードに </script が含まれています');
const out = html.replace('/*__CSS__*/', () => css).replace('/*__BOOT__*/', () => boot).replace('/*__JS__*/', () => js);
if (!out.includes('id="appScript">' + js + '</script>')) throw new Error('本体スクリプトの埋め込み位置が想定と違います');
fs.writeFileSync(path.join(__dirname, 'gas', 'index.html'), out);
console.log('built gas/index.html', (out.length / 1024).toFixed(1) + 'KB', 'v' + version, 'js', js.length, 'chars hash', fnv(js));
