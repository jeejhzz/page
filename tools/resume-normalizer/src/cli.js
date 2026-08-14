#!/usr/bin/env node
// 자유 양식 이력서 → 디노티시아 표준 A4 이력서
//
//   node src/cli.js <파일 또는 폴더...> [옵션]
//
// 옵션
//   -o, --out <dir>     결과 폴더 (기본 out)
//       --engine <e>    auto | llm | rules   (기본 auto — 키가 있으면 llm)
//       --model <name>  LLM 모델 (기본 claude-sonnet-5)
//       --full          성과 목록까지 담은 상세본도 함께 생성 (기본은 요약본만)
//       --save          결과를 보관함(SQLite)에도 저장 (--db 로 파일 지정)
//       --blind         이름·생년월일·성별·주소·연락처를 지운 블라인드본도 함께 생성
//       --only-blind    블라인드본만 생성
//       --no-pdf        PDF 없이 HTML/JSON 만
//       --concurrency N 동시 처리 수 (기본 3)

const fs = require('fs');
const path = require('path');
const { extractText, SUPPORTED } = require('./extract');
const { parseWithRules } = require('./parse-rules');
const { normalize, audit, blind: makeBlind } = require('./schema');
const { toCsv } = require('./report');
const { xlsxBuffer } = require('./xlsx');
const { renderHtml } = require('./render');
const pdf = require('./pdf');

const EXT = new Set(SUPPORTED);

function parseArgs(argv) {
  const o = { inputs: [], out: 'out', engine: 'auto', model: '', blind: false, onlyBlind: false, pdf: true, concurrency: 3 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--out') o.out = argv[++i];
    else if (a === '--engine') o.engine = argv[++i];
    else if (a === '--model') o.model = argv[++i];
    else if (a === '--full') o.full = true;
    else if (a === '--save') o.save = true;
    else if (a === '--db') { o.db = argv[++i]; o.save = true; }
    else if (a === '--blind') o.blind = true;
    else if (a === '--only-blind') { o.blind = true; o.onlyBlind = true; }
    else if (a === '--no-pdf') o.pdf = false;
    else if (a === '--concurrency') o.concurrency = Math.max(1, Number(argv[++i]) || 1);
    else if (a === '-h' || a === '--help') o.help = true;
    else o.inputs.push(a);
  }
  return o;
}

function collect(inputs) {
  const files = [];
  for (const p of inputs) {
    if (!fs.existsSync(p)) { console.error(`  건너뜀 (없는 경로): ${p}`); continue; }
    if (fs.statSync(p).isDirectory()) {
      for (const f of fs.readdirSync(p)) {
        const full = path.join(p, f);
        if (fs.statSync(full).isFile() && EXT.has(path.extname(f).toLowerCase())) files.push(full);
      }
    } else files.push(p);
  }
  return files.sort();
}

// 파일명 충돌과 OS 금지문자를 피한다
const slug = s => String(s || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').slice(0, 60) || 'unnamed';

async function processOne(file, opt) {
  const rel = path.basename(file);
  const text = await extractText(file);

  let raw, engine;
  const useLLM = opt.engine === 'llm' || (opt.engine === 'auto' && process.env.ANTHROPIC_API_KEY);
  if (useLLM) {
    try {
      const { parseWithLLM } = require('./parse-llm');
      raw = await parseWithLLM(text, { model: opt.model });
      engine = raw._meta.engine;
    } catch (err) {
      if (opt.engine === 'llm') throw err;
      console.error(`  ! LLM 파싱 실패, 규칙 기반으로 대체: ${err.message}`);
      raw = parseWithRules(text); engine = 'rules(llm-fallback)';
    }
  } else {
    raw = parseWithRules(text); engine = 'rules';
  }

  const data = normalize(raw, { sourceFile: rel, engine });
  data._meta.warnings = [...new Set([...(data._meta.warnings || []), ...audit(data)])];

  const base = slug(data.name || path.basename(file, path.extname(file)));
  const outs = [];
  const variants = [];
  if (!opt.onlyBlind) variants.push(['', data, { brief: true }]);
  if (opt.full && !opt.onlyBlind) variants.push(['_상세', data, { full: true }]);
  if (opt.blind) variants.push(['_blind', makeBlind(data), { brief: true, blind: true }]);

  for (const [suffix, d, ropt] of variants) {
    const html = renderHtml(d, ropt);
    const htmlPath = path.join(opt.out, `${base}${suffix}.html`);
    fs.mkdirSync(opt.out, { recursive: true });
    fs.writeFileSync(htmlPath, html);
    outs.push(htmlPath);
    if (opt.pdf) outs.push(await pdf.htmlToPdf(html, path.join(opt.out, `${base}${suffix}.pdf`)));
  }
  fs.writeFileSync(path.join(opt.out, `${base}.json`), JSON.stringify(data, null, 2));
  outs.push(path.join(opt.out, `${base}.json`));

  if (opt.store) {
    try { opt.store.save(data, { file: rel, buf: fs.readFileSync(file), actor: 'cli' }); }
    catch (e) { console.error(`  ! 보관함 저장 실패 (${rel}): ${e.message}`); }
  }
  return { file: rel, data, outs };
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  if (opt.help || !opt.inputs.length) {
    const head = fs.readFileSync(__filename, 'utf8').split('\n').slice(1);
    console.log(head.slice(0, head.findIndex(l => !l.startsWith('//')))
      .map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
    process.exit(opt.help ? 0 : 1);
  }

  const files = collect(opt.inputs);
  if (!files.length) { console.error('처리할 파일이 없습니다. (' + SUPPORTED.join(' ') + ')'); process.exit(1); }

  if (opt.save) {
    opt.store = require('./db').open({ file: opt.db || process.env.RESUME_DB });
    if (!opt.store) { console.error(require('./db').open.lastError.message); process.exit(1); }
  }

  const useLLM = opt.engine === 'llm' || (opt.engine === 'auto' && process.env.ANTHROPIC_API_KEY);
  console.log(`이력서 ${files.length}건 · 엔진 ${useLLM ? (opt.model || 'claude-sonnet-5') : '규칙 기반'} · 출력 ${opt.out}`);
  if (!useLLM) {
    console.log('  ANTHROPIC_API_KEY 가 없어 규칙 기반으로 돕니다. 정확도를 원하면 키를 설정하세요.');
  }
  console.log('');

  const results = [], failed = [];
  let idx = 0;
  async function worker() {
    while (idx < files.length) {
      const f = files[idx++];
      try {
        const r = await processOne(f, opt);
        const w = r.data._meta.warnings.length;
        console.log(`  ✓ ${path.basename(f)} → ${r.data.name || '(이름 미확인)'}${w ? `  검토 ${w}건` : ''}`);
        results.push(r);
      } catch (err) {
        console.error(`  ✗ ${path.basename(f)} — ${err.message}`);
        failed.push({ file: f, error: err.message });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(opt.concurrency, files.length) }, worker));
  await pdf.close();

  if (results.length) {
    const csvPath = path.join(opt.out, 'summary.csv');
    const xlsxPath = path.join(opt.out, '지원자요약.xlsx');
    fs.writeFileSync(csvPath, toCsv(results));
    fs.writeFileSync(xlsxPath, xlsxBuffer(results));
    console.log(`\n완료 ${results.length}건${failed.length ? ` · 실패 ${failed.length}건` : ''}`);
    console.log(`  엑셀   ${xlsxPath}`);
    console.log(`  요약표 ${csvPath}`);
    if (opt.store) {
      console.log(`  보관함 ${opt.store.file} (${opt.store.stats().count}명)`);
      opt.store.close();
    }
    const needs = results.filter(r => r.data._meta.warnings.length);
    if (needs.length) {
      console.log(`  검토 필요 ${needs.length}건 — ${needs.map(r => r.data.name || r.file).join(', ')}`);
    }
  }
  process.exit(failed.length && !results.length ? 1 : 0);
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { processOne, parseArgs, collect };
