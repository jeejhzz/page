// 자유 양식 이력서 파일 → 평문 (Node 쪽 입출력 담당)
//
// 줄·열 복원, 제목 표시, 정리 같은 순수 로직은 extract-core.js 에 있다.
// 브라우저 데모(web/demo)가 같은 코어를 쓰므로 결과가 어긋나지 않는다.
const fs = require('fs');
const path = require('path');

const core = require('./extract-core');
const { HEAD, SUPPORTED, LINE_TOL, tidy, assertReadable } = core;

// 한글 PDF 는 CID 폰트를 쓰는 경우가 많다. CMap 을 못 읽으면 본문이 통째로 사라진다
// (증상: 글머리표와 쪽번호만 남고 "이미지 PDF" 로 오인하게 된다).
//
// 함정: Node 에서 pdfjs 는 이 경로를 **그냥 파일 경로**로 받아야 한다.
// pathToFileURL 로 만든 file:// URL 을 주면 조용히 실패하고 본문이 사라진다.
function assetPaths() {
  let root;
  try { root = path.dirname(require.resolve('pdfjs-dist/package.json')); }
  catch (_) { return {}; }
  const dir = sub => {
    const p = path.join(root, sub);
    return fs.existsSync(p) ? p + path.sep : undefined;
  };
  return { cMapUrl: dir('cmaps'), cMapPacked: true, standardFontDataUrl: dir('standard_fonts') };
}

async function fromPdf(file) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(file));
  const task = pdfjs.getDocument({ data, verbosity: 0, ...assetPaths() });
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
    pages.push(core.pageToLines(rows, page.getViewport({ scale: 1 }).width));
    page.cleanup();
  }
  await task.destroy();
  return core.markHeadings(pages);
}

async function fromDocx(file) {
  const mammoth = require('mammoth');
  // 표를 쓴 이력서가 많아서 HTML 로 먼저 받고 셀 경계를 탭으로 바꾼다.
  const { value: html } = await mammoth.convertToHtml({ path: file });
  return core.docxHtmlToText(html);
}

/** 파일 하나에서 평문을 뽑는다. 지원: .pdf .docx .hwpx .hwp .txt .md */
async function extractText(file) {
  const ext = path.extname(file).toLowerCase();
  let raw;
  if (ext === '.pdf') raw = await fromPdf(file);
  else if (ext === '.docx') raw = await fromDocx(file);
  else if (ext === '.hwpx') raw = await require('./hwp').fromHwpx(file);
  else if (ext === '.hwp') raw = await require('./hwp').fromHwp(file);
  else if (ext === '.txt' || ext === '.md') raw = fs.readFileSync(file, 'utf8');
  else if (ext === '.doc') {
    throw new Error('.doc(구버전 워드)는 지원하지 않습니다. .docx 나 PDF 로 변환해서 넣어주세요.');
  } else {
    throw new Error(`지원하지 않는 형식: ${ext || '(확장자 없음)'}`);
  }
  return assertReadable(tidy(raw));
}

module.exports = { extractText, tidy, HEAD, SUPPORTED };
