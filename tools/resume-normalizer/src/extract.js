// 자유 양식 이력서 파일 → 평문
//
// PDF 는 텍스트 조각(item)들이 좌표와 함께 흩어져 나온다. 그냥 이어붙이면
// 2단 편집이나 표로 짠 이력서가 뒤죽박죽이 되므로, y 좌표로 줄을 묶고
// x 좌표로 정렬해서 사람이 읽는 순서를 복원한다.
const fs = require('fs');
const path = require('path');

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

async function fromPdf(file) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(file));
  const task = pdfjs.getDocument({ data, useSystemFonts: true });
  const doc = await task.promise;
  const pages = [];

  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const rows = [];

    for (const it of content.items) {
      if (!it.str || !it.str.trim()) continue;
      const x = it.transform[4], y = it.transform[5];
      const w = it.width || 0;
      const h = Math.abs(it.transform[3]) || 10;
      let row = rows.find(r => Math.abs(r.y - y) <= LINE_TOL);
      if (!row) { row = { y, items: [] }; rows.push(row); }
      row.items.push({ x, w, h, s: it.str });
    }

    rows.sort((a, b) => b.y - a.y);                    // PDF 는 아래가 0 이므로 내림차순

    const vp = page.getViewport({ scale: 1 });
    const split = findGutter(rows, vp.width);
    let ordered = rows;
    if (split !== null) {
      // 제목처럼 폭 전체를 가로지르는 줄은 어느 쪽 열도 아니다. 먼저 내보낸다.
      const full = rows.filter(r => spansGutter(r, split, vp.width));
      const rest = rows.filter(r => !full.includes(r));
      ordered = [...full, ...sliceRows(rest, -Infinity, split), ...sliceRows(rest, split, Infinity)];
    }

    const lines = ordered.map(r => {
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
      return out.replace(/[ \t]+$/, '');
    });

    pages.push(lines.join('\n'));
    page.cleanup();
  }
  await task.destroy();
  return pages.join('\n\n');
}

async function fromDocx(file) {
  const mammoth = require('mammoth');
  // 표를 쓴 이력서가 많아서 HTML 로 먼저 받고 셀 경계를 탭으로 바꾼다.
  const { value: html } = await mammoth.convertToHtml({ path: file });
  return html
    // 셀 안의 문단 끝이 먼저 줄바꿈으로 바뀌면 "라벨 / 값" 이 두 줄로 갈라진다.
    // 그래서 셀 경계를 탭으로 만드는 처리를 문단 처리보다 앞에 둔다.
    .replace(/<\/p>\s*(?=<\/t[dh]>)/gi, '')
    .replace(/<\/t[dh]>\s*<t[dh][^>]*>\s*<p[^>]*>/gi, '\t')
    .replace(/<\/t[dh]>\s*<t[dh][^>]*>/gi, '\t')
    .replace(/<\/(p|h[1-6]|tr|li|div)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function tidy(t) {
  return t
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .split('\n').map(l => l.replace(/[ \t]+$/, '')).join('\n')
    // PDF 에서 "10-2018-\n0079123" 처럼 잘린 번호를 다시 붙인다
    .replace(/(\d)-\n(\d)/g, '$1-$2')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 파일 하나에서 평문을 뽑는다. 지원: .pdf .docx .txt .md */
async function extractText(file) {
  const ext = path.extname(file).toLowerCase();
  let raw;
  if (ext === '.pdf') raw = await fromPdf(file);
  else if (ext === '.docx') raw = await fromDocx(file);
  else if (ext === '.txt' || ext === '.md') raw = fs.readFileSync(file, 'utf8');
  else if (ext === '.doc') {
    throw new Error('.doc(구버전 워드)는 지원하지 않습니다. .docx 나 PDF 로 변환해서 넣어주세요.');
  } else {
    throw new Error(`지원하지 않는 형식: ${ext || '(확장자 없음)'}`);
  }
  const text = tidy(raw);
  if (text.replace(/\s/g, '').length < 40) {
    throw new Error('텍스트가 거의 추출되지 않았습니다. 스캔 이미지 PDF 일 수 있습니다(OCR 필요).');
  }
  return text;
}

module.exports = { extractText, tidy };
