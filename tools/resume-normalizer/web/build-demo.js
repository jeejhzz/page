// 브라우저에서만 도는 데모 한 장을 만든다.
//
// 서버 없이 확인할 수 있게, 파싱 코어(extract-core / parse-rules / schema / render)와
// PDF·워드·한글 판독기를 전부 한 HTML 안에 넣는다. 파일은 브라우저 밖으로 나가지 않는다.
//
//   node web/build-demo.js [출력경로]
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NM = p => path.join(ROOT, 'node_modules', p);
const read = p => fs.readFileSync(p, 'utf8');

// ── pdf.js: ESM 모듈을 인라인 <script type="module"> 로 넣는다.
// 끝의 export 구문을 globalThis 대입으로 바꿔야 페이지에서 쓸 수 있다.
function esmToGlobal(src, globalName, keep) {
  const m = src.match(/export\s*\{([^}]*)\}\s*;?\s*$/);
  if (!m) throw new Error('export 구문을 찾지 못했습니다: ' + globalName);
  const pairs = m[1].split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const [local, , exported] = s.split(/\s+/);
    return { local, exported: exported || local };
  }).filter(p => !keep || keep.includes(p.exported));
  const assign = `globalThis.${globalName}={${pairs.map(p => `${p.exported}:${p.local}`).join(',')}};`;
  return src.slice(0, m.index) + assign;
}

const pdfLib = esmToGlobal(read(NM('pdfjs-dist/legacy/build/pdf.min.mjs')), 'pdfjsLib',
  ['getDocument', 'GlobalWorkerOptions', 'PDFWorker', 'VerbosityLevel', 'setVerbosityLevel']);
// 워커를 페이지 안에 두면 pdf.js 가 Worker 생성에 실패해도 그대로 메인 스레드에서 돈다.
// (아티팩트는 CSP 때문에 blob 워커가 막힐 수 있다)
const pdfWorker = esmToGlobal(read(NM('pdfjs-dist/legacy/build/pdf.worker.min.mjs')), 'pdfjsWorker');

// ── 한글 CMap: 한국어 PDF 는 이게 없으면 본문이 통째로 사라진다.
const CMAP_DIR = NM('pdfjs-dist/cmaps');
const cmaps = fs.readdirSync(CMAP_DIR)
  .filter(f => /^(UniKS|KSC|Adobe-Korea|Identity)/.test(f) && f.endsWith('.bcmap'));
const cmapData = Object.fromEntries(
  cmaps.map(f => [f, fs.readFileSync(path.join(CMAP_DIR, f)).toString('base64')]));

// ── 우리 모듈: 아주 작은 CommonJS 흉내로 묶는다
const MODULES = ['extract-core', 'schema', 'parse-rules', 'render', 'report', 'xlsx'];
const bundle = MODULES.map(name =>
  `__def(${JSON.stringify(name)}, function(module, exports, require, __dirname, __filename){\n${read(path.join(ROOT, 'src', name + '.js'))}\n});`
).join('\n');

const shim = `
// --- 작은 CommonJS 흉내 ---------------------------------------------------
var __defs = {}, __cache = {};
function __def(name, fn) { __defs[name] = fn; }
function require(p) {
  var name = String(p).replace(/^\\.\\//, '').replace(/\\.js$/, '');
  // 브라우저에는 없는 Node 모듈은 껍데기로 대신한다.
  if (name === 'fs') return { existsSync: function () { return false; }, readFileSync: function () { return ''; } };
  if (name === 'path') return { join: function () { return ''; }, extname: function () { return ''; }, basename: function (s) { return s; } };
  if (name === 'url') return { pathToFileURL: function (s) { return { href: s }; } };
  if (__cache[name]) return __cache[name].exports;
  if (!__defs[name]) throw new Error('모듈 없음: ' + p);
  var m = { exports: {} };
  __cache[name] = m;
  __defs[name](m, m.exports, require, '', '');
  return m.exports;
}
`;

const UI = read(path.join(__dirname, 'demo-ui.html'));

const html = UI
  .replace('/*__SHIM__*/', () => shim + '\n' + bundle)
  .replace('/*__CMAPS__*/', () => 'var CMAPS = ' + JSON.stringify(cmapData) + ';')
  .replace('/*__FFLATE__*/', () => read(NM('fflate/umd/index.js')))
  .replace('/*__MAMMOTH__*/', () => read(NM('mammoth/mammoth.browser.min.js')))
  .replace('/*__PDFWORKER__*/', () => pdfWorker)
  .replace('/*__PDFLIB__*/', () => pdfLib);

// 아티팩트로 올릴 때는 문서 껍데기(doctype·html·head·body)를 벗긴다.
// 발행 쪽에서 다시 감싸 주기 때문이다.
function toFragment(doc) {
  const head = doc.slice(doc.indexOf('<title>'), doc.indexOf('</head>'));
  const body = doc.slice(doc.indexOf('<body>') + 6, doc.lastIndexOf('</body>'));
  return head + body;
}

const args2 = process.argv.slice(2).filter(a => a !== '--artifact');
const asFragment = process.argv.includes('--artifact');
const out = args2[0] || path.join(ROOT, 'out', 'demo.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, asFragment ? toFragment(html) : html);
console.log(`데모 생성 ${out}  ${(html.length / 1024 / 1024).toFixed(2)}MB`);
console.log(`  CMap ${cmaps.length}개 · 모듈 ${MODULES.length}개`);
