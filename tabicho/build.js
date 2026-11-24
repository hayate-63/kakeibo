// 旅帳のビルド：src/ の HTML・CSS・JS を1枚の gas/index.html にまとめる
//   node tabicho/build.js
const fs = require('fs'), path = require('path');
const src = path.join(__dirname, 'src');
const html = fs.readFileSync(path.join(src, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(src, 'styles.css'), 'utf8');
const jsDir = path.join(src, 'js');
const js = fs.readdirSync(jsDir).filter(f => f.endsWith('.js')).sort()
  .map(f => `// ---- ${f} ----\n` + fs.readFileSync(path.join(jsDir, f), 'utf8')).join('\n');
if (/<\/script/i.test(js)) throw new Error('JSに </script が含まれています');
const out = html.replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => js);
fs.writeFileSync(path.join(__dirname, 'gas', 'index.html'), out);
console.log('built gas/index.html', (out.length / 1024).toFixed(1) + 'KB');
