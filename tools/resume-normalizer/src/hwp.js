// 한글(HWP) 파일에서 평문 뽑기
//
// 두 형식이 전혀 다르다.
//  · .hwpx — ZIP + XML(OWPML). 압축을 풀고 문단 태그를 읽으면 된다. 안정적이다.
//  · .hwp  — 바이너리 복합문서(CFB). hwp.js 로 시도하고, 실패하면 이유를 알려준다.
const fs = require('fs');
const { HEAD } = require('./extract');

const decode = s => String(s)
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&amp;/g, '&');

// OWPML 문단 하나를 한 줄로. 표는 셀 경계를 탭으로 바꿔 라벨/값이 붙어 있게 한다.
function paragraphsFromXml(xml) {
  const lines = [];
  // <hp:p ...> ... </hp:p> 단위로 자른다
  const paras = xml.match(/<hp:p\b[\s\S]*?<\/hp:p>/g) || [];
  for (const p of paras) {
    // 셀 경계에 탭을 심는다
    const withTabs = p.replace(/<\/hp:tc>\s*<hp:tc\b/g, '</hp:tc>\t<hp:tc');
    const parts = [];
    const re = /<hp:t\b[^>]*>([\s\S]*?)<\/hp:t>|(\t)/g;
    let m;
    while ((m = re.exec(withTabs))) parts.push(m[1] != null ? decode(m[1].replace(/<[^>]+>/g, '')) : '\t');
    const line = parts.join('').replace(/[ \t]+$/, '');
    if (line.trim()) lines.push(line);
    else if (lines.length && lines[lines.length - 1] !== '') lines.push('');
  }
  return lines;
}

async function fromHwpx(file) {
  const AdmZip = require('adm-zip');
  let zip;
  try { zip = new AdmZip(file); }
  catch (e) { throw new Error('HWPX 파일을 열지 못했습니다(손상되었거나 형식이 다릅니다).'); }

  const sections = zip.getEntries()
    .filter(e => /^Contents\/section\d+\.xml$/i.test(e.entryName))
    .sort((a, b) => a.entryName.localeCompare(b.entryName, 'en', { numeric: true }));
  if (!sections.length) {
    throw new Error('HWPX 안에서 본문(Contents/section*.xml)을 찾지 못했습니다.');
  }
  return sections
    .map(e => paragraphsFromXml(e.getData().toString('utf8')).join('\n'))
    .join('\n\n');
}

async function fromHwp(file) {
  let parse;
  try { ({ parse } = require('hwp.js')); }
  catch (_) {
    throw new Error('.hwp 를 읽을 라이브러리를 찾지 못했습니다. `npm i hwp.js` 후 다시 시도하세요.');
  }
  let doc;
  try {
    doc = parse(new Uint8Array(fs.readFileSync(file)), { type: 'binary' });
  } catch (e) {
    throw new Error(
      '.hwp(한글 바이너리) 를 읽지 못했습니다: ' + (e && e.message ? e.message : e) +
      ' — 한글에서 "다른 이름으로 저장 → HWPX" 또는 PDF 로 내보낸 뒤 넣어주세요.');
  }
  const lines = [];
  for (const section of doc.sections || []) {
    for (const p of section.content || []) {
      const t = (p.content || []).map(c => c.value || '').join('');
      lines.push(t.replace(/[ \t]+$/, ''));
    }
    lines.push('');
  }
  const text = lines.join('\n');
  if (!text.replace(/\s/g, '')) {
    throw new Error('.hwp 에서 글자를 얻지 못했습니다. HWPX 나 PDF 로 변환해서 넣어주세요.');
  }
  return text;
}

module.exports = { fromHwp, fromHwpx, paragraphsFromXml, HEAD };
