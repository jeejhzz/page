#!/usr/bin/env node
// 보관함을 터미널에서 다루기
//
//   node src/db-cli.js stats                          현황
//   node src/db-cli.js list [검색어] [--min 3] [--limit 50]
//   node src/db-cli.js show <id>                      한 사람 자세히
//   node src/db-cli.js add <파일...>                  변환해서 보관함에만 넣기
//   node src/db-cli.js export [검색어] -o 보관함.xlsx  엑셀로 뽑기
//   node src/db-cli.js purge [--before 2026-01-01]    보관기한 지난 사람 파기
//   node src/db-cli.js rm <id>                        한 사람 삭제
//
// 공통 옵션  --db <파일>  --retain-days <일>
//
// purge 는 되돌릴 수 없다. 자동 실행(크론)에 걸어 두면 파기를 잊지 않는다.
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const has = k => argv.includes(k);
// 값을 하나 먹는 옵션들 — 나머지는 명령의 인자(검색어·파일·id)로 본다
const TAKES_VALUE = new Set(['--db', '--retain-days', '--min', '--limit', '--sort', '--before', '-o', '--out']);
const rest = [];
for (let i = 1; i < argv.length; i++) {
  if (TAKES_VALUE.has(argv[i])) { i++; continue; }
  if (argv[i].startsWith('-')) continue;
  rest.push(argv[i]);
}

const store = require('./db').open({
  file: flag('--db', process.env.RESUME_DB),
  retainDays: Number(flag('--retain-days', process.env.RESUME_RETAIN_DAYS || 180)),
});
if (!store) {
  console.error(require('./db').open.lastError.message);
  process.exit(1);
}

// 한글은 터미널에서 두 칸을 먹는다. 글자 수가 아니라 칸 수로 맞춰야 표가 안 어긋난다.
const wide = c => /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/.test(c);
function pad(s, n) {
  let out = '', w = 0;
  for (const c of String(s == null ? '' : s)) {
    const cw = wide(c) ? 2 : 1;
    if (w + cw > n - 1) break;
    out += c; w += cw;
  }
  return out + ' '.repeat(Math.max(n - w, 1));
}

function printRows(rows) {
  console.log(pad('ID', 5) + pad('이름', 12) + pad('경력', 11) + pad('최종학력', 30) + '보관기한');
  console.log('─'.repeat(78));
  for (const r of rows) {
    console.log(pad(r.id, 5) + pad(r.name || '(미확인)', 12) + pad(r.career, 11) +
      pad(r.edu_top || '', 30) + r.retain_until);
  }
}

async function main() {
  if (!cmd || cmd === '-h' || cmd === '--help') {
    const head = fs.readFileSync(__filename, 'utf8').split('\n').slice(1);
    console.log(head.slice(0, head.findIndex(l => !l.startsWith('//')))
      .map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
    return;
  }

  if (cmd === 'stats') {
    const s = store.stats();
    console.log(`보관 파일   ${s.file}  (${(s.bytes / 1024).toFixed(0)}KB)`);
    console.log(`보관 인원   ${s.count}명`);
    console.log(`기간        ${(s.first || '').slice(0, 10)} ~ ${(s.last || '').slice(0, 10)}`);
    console.log(`30일 내 만료 ${s.expiringIn30}명 · 이미 지남 ${s.expired}명`);
    return;
  }

  if (cmd === 'list') {
    const out = store.search({
      q: rest.join(' '),
      minMonths: Number(flag('--min', 0)) * 12,
      sort: flag('--sort', 'recent'),
      limit: Number(flag('--limit', 50)),
    });
    printRows(out.rows);
    console.log(`\n${out.rows.length}명 표시 / 전체 ${out.total}명`);
    return;
  }

  if (cmd === 'show') {
    const r = store.get(rest[0], { actor: 'cli' });
    if (!r) { console.error('없는 id 입니다'); process.exit(1); }
    console.log(JSON.stringify(r.data, null, 2));
    return;
  }

  if (cmd === 'add') {
    const { extractText, SUPPORTED } = require('./extract');
    const { parseWithRules } = require('./parse-rules');
    const { normalize, audit } = require('./schema');
    let n = 0;
    for (const f of rest) {
      if (!fs.existsSync(f)) { console.error(`  건너뜀 (없는 파일): ${f}`); continue; }
      if (!SUPPORTED.includes(path.extname(f).toLowerCase())) { console.error(`  건너뜀 (형식): ${f}`); continue; }
      try {
        const data = normalize(parseWithRules(await extractText(f)),
          { sourceFile: path.basename(f), engine: 'rules' });
        data._meta.warnings = audit(data);
        const { id, created } = store.save(data, {
          file: path.basename(f), buf: fs.readFileSync(f), actor: 'cli',
        });
        console.log(`  ${created ? '추가' : '갱신'}  #${id}  ${data.name || '(이름 미확인)'}  ← ${path.basename(f)}`);
        n++;
      } catch (e) {
        console.error(`  실패  ${path.basename(f)}: ${e.message}`);
      }
    }
    console.log(`\n${n}명 보관`);
    return;
  }

  if (cmd === 'export') {
    const out = flag('-o', flag('--out', '보관함.xlsx'));
    const items = store.items({ q: rest.join(' '), minMonths: Number(flag('--min', 0)) * 12, limit: 1000 });
    if (!items.length) { console.error('내보낼 사람이 없습니다'); process.exit(1); }
    fs.writeFileSync(out, require('./xlsx').xlsxBuffer(items));
    store.log(null, 'export', 'cli', `${items.length}명 → ${out}`);
    console.log(`${items.length}명 → ${out}`);
    return;
  }

  if (cmd === 'purge') {
    const before = flag('--before');
    const preview = store.search({ expiring: before || true, limit: 1000 });
    if (!preview.total) { console.log('파기할 사람이 없습니다.'); return; }
    printRows(preview.rows);
    if (!has('--yes')) {
      console.log(`\n위 ${preview.total}명을 원본 파일까지 지웁니다. 실행하려면 --yes 를 붙이세요.`);
      return;
    }
    const r = store.purge({ before, actor: 'cli' });
    console.log(`${r.removed}명 파기 (기준 ${r.before})`);
    return;
  }

  if (cmd === 'rm') {
    console.log(store.remove(rest[0], 'cli') ? '지웠습니다.' : '없는 id 입니다.');
    return;
  }

  console.error(`모르는 명령입니다: ${cmd}  (--help 로 사용법을 보세요)`);
  process.exit(1);
}

main().then(() => store.close()).catch(e => { console.error(e.message); process.exit(1); });
