// 파일 형식과 무관한 순수 로직. Node(서버/CLI)와 브라우저(데모)가 함께 쓴다.
// 여기에는 fs·path 같은 Node 전용 의존성이 없어야 한다.

// 제목 줄 표시자. 추출 단계에서만 붙이고 파서가 소비한 뒤 사라진다.
// 본문에 나올 일이 없는 제어문자를 쓴다.
const HEAD = '\u0001';

const LINE_TOL = 3.0;      // 같은 줄로 볼 y 오차 (pt)
const GAP_RATIO = 0.8;     // 이 배수 이상 벌어지면 칸 구분(공백)으로 본다

// 2단 편집(사이드바형) 이력서는 좌우가 번갈아 나와 읽는 순서가 무너진다.
// 세로로 비어 있는 띠(gutter)를 찾아 열을 나눈다.
//
// 다만 "기간 | 내용" 표로 짠 이력서에도 똑같은 띠가 생기므로 그걸 쪼개면 안 된다.
// 두 경우를 가르는 신호는 행 정렬이다. 표는 좌우가 같은 줄에서 짝을 이루고(both 비율 높음),
// 2단 편집은 양쪽이 제각각 흐른다(both 비율 낮음).
const BOTH_MAX = 0.5;        // 좌우가 같은 줄에 함께 있는 비율이 이보다 낮아야 2단으로 본다
const MIN_ROWS_PER_SIDE = 5;

function findGutter(rows, pageW) {
  if (!pageW || rows.length < 2 * MIN_ROWS_PER_SIDE) return null;
  // 각 x 위치를 "몇 개의 행이 덮고 있는가"로 센다. 제목처럼 폭 전체를 가로지르는
  // 줄이 한둘 있다고 띠가 사라지면 안 되므로, 소수의 행만 덮은 곳은 비어 있다고 본다.
  const counts = new Uint16Array(Math.ceil(pageW));
  for (const r of rows) {
    const seen = new Set();
    for (const it of r.items) {
      const a = Math.max(0, Math.floor(it.x));
      const b = Math.min(counts.length - 1, Math.ceil(it.x + it.w));
      for (let i = a; i <= b; i++) seen.add(i);
    }
    for (const i of seen) counts[i]++;
  }
  const bar = Math.max(1, Math.ceil(rows.length * 0.06));
  const bins = counts.map(c => (c >= bar ? 1 : 0));
  const lo = Math.floor(pageW * 0.25), hi = Math.ceil(pageW * 0.75);
  const minGap = pageW * 0.05;

  let best = null, runStart = -1;
  for (let i = lo; i <= hi; i++) {
    if (!bins[i]) { if (runStart < 0) runStart = i; }
    else { best = keepWider(best, runStart, i, minGap); runStart = -1; }
  }
  best = keepWider(best, runStart, hi + 1, minGap);
  if (!best) return null;

  const cut = (best[0] + best[1]) / 2;
  const left = sliceRows(rows, -Infinity, cut);
  const right = sliceRows(rows, cut, Infinity);
  if (left.length < MIN_ROWS_PER_SIDE || right.length < MIN_ROWS_PER_SIDE) return null;

  const ys = new Map();                       // y → 좌/우 존재 여부
  const mark = (list, key) => list.forEach(r => {
    const k = Math.round(r.y / LINE_TOL);
    ys.set(k, { ...(ys.get(k) || {}), [key]: true });
  });
  mark(left, 'l'); mark(right, 'r');
  const both = [...ys.values()].filter(v => v.l && v.r).length / ys.size;
  return both < BOTH_MAX ? cut : null;
}

function keepWider(best, start, end, minGap) {
  if (start < 0) return best;
  const w = end - start;
  if (w < minGap) return best;
  return !best || w > best[1] - best[0] ? [start, end] : best;
}

// 제목/머리글은 띠를 "끊김 없이" 가로지른다.
// 좌우에 글자가 있더라도 띠 자리에서 크게 벌어지면 그건 그냥 두 열의 같은 줄이다.
function spansGutter(row, cut, pageW) {
  const left = row.items.filter(it => it.x + it.w / 2 < cut);
  const right = row.items.filter(it => it.x + it.w / 2 >= cut);
  if (!left.length || !right.length) return false;
  const leftEnd = Math.max(...left.map(it => it.x + it.w));
  const rightStart = Math.min(...right.map(it => it.x));
  return rightStart - leftEnd < pageW * 0.04;
}

// 잘린 조각만 남긴 행 목록. 한쪽에 아무것도 없으면 그 행은 버린다.
function sliceRows(rows, x0, x1) {
  return rows
    .map(r => ({ y: r.y, items: r.items.filter(it => it.x + it.w / 2 >= x0 && it.x + it.w / 2 < x1) }))
    .filter(r => r.items.length);
}

function median(xs) {
  if (!xs.length) return 10;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function isBigHeading(line, bodyH) {
  const t = line.text.trim();
  if (!t || t.length > 40) return false;
  if (/^[-–—•▪○*·‧]/.test(t)) return false;         // 글머리표는 제목이 아니다
  return line.h >= bodyH * 1.18;
}

// PDF 한 쪽의 행 목록을 사람이 읽는 순서의 문자열 배열로 바꾼다.
// rows = [{ y, items: [{x, w, h, s}] }]  (y 는 PDF 좌표계, 위가 큼)
function pageToLines(rows, pageW) {
  rows.sort((a, b) => b.y - a.y);
  const split = findGutter(rows, pageW);
  let ordered = rows;
  if (split !== null) {
    // 제목처럼 폭 전체를 가로지르는 줄은 어느 쪽 열도 아니다. 먼저 내보낸다.
    const full = rows.filter(r => spansGutter(r, split, pageW));
    const rest = rows.filter(r => !full.includes(r));
    ordered = [...full, ...sliceRows(rest, -Infinity, split), ...sliceRows(rest, split, Infinity)];
  }
  return ordered.map(r => {
    r.items.sort((a, b) => a.x - b.x);
    let out = '';
    let prevEnd = null, prevH = 10;
    for (const it of r.items) {
      if (prevEnd !== null) {
        const gap = it.x - prevEnd;
        if (gap > prevH * GAP_RATIO * 2) out += '\t';      // 칸이 크게 벌어짐 → 열 구분
        else if (gap > prevH * GAP_RATIO * 0.25) out += ' ';
      }
      out += it.s;
      prevEnd = it.x + it.w;
      prevH = it.h;
    }
    return { text: out.replace(/[ \t]+$/, ''), h: Math.max(...r.items.map(it => it.h)) };
  });
}

// 본문 글자 크기를 기준으로 큰 줄을 제목으로 표시한다.
// 이래야 "AI 시장 공략 전략" 처럼 우리가 모르는 제목에서도 구역이 끊긴다.
function markHeadings(pages) {
  const body = median(pages.flat().map(l => l.h));
  return pages
    .map(lines => lines.map(l => (isBigHeading(l, body) ? HEAD + l.text : l.text)).join('\n'))
    .join('\n\n');
}

// mammoth 가 준 HTML → 평문
function docxHtmlToText(html) {
  return html
    // 셀 안의 문단 끝이 먼저 줄바꿈으로 바뀌면 "라벨 / 값" 이 두 줄로 갈라진다.
    // 그래서 셀 경계를 탭으로 만드는 처리를 문단 처리보다 앞에 둔다.
    .replace(/<\/p>\s*(?=<\/t[dh]>)/gi, '')
    .replace(/<\/t[dh]>\s*<t[dh][^>]*>\s*<p[^>]*>/gi, '\t')
    .replace(/<\/t[dh]>\s*<t[dh][^>]*>/gi, '\t')
    .replace(/<h[1-6][^>]*>/gi, '\n' + HEAD)
    .replace(/<\/(p|h[1-6]|tr|li|div)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// HWPX(OWPML) 한 구역의 XML → 평문. 표는 셀 경계를 탭으로.
function hwpxXmlToText(xml) {
  const decode = t => String(t)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
  const lines = [];
  for (const p of xml.match(/<hp:p\b[\s\S]*?<\/hp:p>/g) || []) {
    const withTabs = p.replace(/<\/hp:tc>\s*<hp:tc\b/g, '</hp:tc>\t<hp:tc');
    const parts = [];
    const re = /<hp:t\b[^>]*>([\s\S]*?)<\/hp:t>|(\t)/g;
    let m;
    while ((m = re.exec(withTabs))) parts.push(m[1] != null ? decode(m[1].replace(/<[^>]+>/g, '')) : '\t');
    const line = parts.join('').replace(/[ \t]+$/, '');
    if (line.trim()) lines.push(line);
    else if (lines.length && lines[lines.length - 1] !== '') lines.push('');
  }
  return lines.join('\n');
}

function tidy(t) {
  return t
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    // 아이콘 폰트를 쓴 PDF 는 전화·메일 기호가 사용자 정의 영역(PUA) 글자로 나온다.
    // 뜻이 없는 글자라 그대로 두면 학교명이나 이름에 섞여 들어간다.
    .replace(/[\uE000-\uF8FF\u303F\uFFFD]/g, ' ')
    .split('\n').map(l => l.replace(/[ \t]+$/, '')).join('\n')
    // PDF 에서 "10-2018-\n0079123" 처럼 잘린 번호를 다시 붙인다
    .replace(/(\d)-\n(\d)/g, '$1-$2')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const SUPPORTED = ['.pdf', '.docx', '.hwpx', '.hwp', '.txt', '.md'];

// 글머리표(•, o)나 쪽번호만 남고 본문이 빠지는 경우가 있다.
// 슬라이드를 이미지로 내보낸 PDF 가 대표적이다. 그래서 공백이 아닌 글자가 아니라
// "실제 글자"(한글·영문·숫자)만 세서 판단한다.
function assertReadable(text) {
  const letters = (text.match(/[가-힣a-zA-Z0-9]/g) || []).length;
  if (letters < 120) {
    throw new Error(
      `본문 텍스트가 거의 없습니다(글자 ${letters}자). ` +
      '내용이 이미지로 들어간 PDF 로 보입니다. OCR 을 거치거나 원본 Word/텍스트를 받아야 합니다.');
  }
  return text;
}

module.exports = {
  HEAD, SUPPORTED, LINE_TOL, GAP_RATIO,
  findGutter, spansGutter, sliceRows, keepWider, median, isBigHeading,
  pageToLines, markHeadings, docxHtmlToText, hwpxXmlToText, tidy, assertReadable,
};
