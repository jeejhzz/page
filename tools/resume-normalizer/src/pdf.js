// HTML → A4 PDF. 이미 설치된 Playwright/Chromium 을 쓴다.
const fs = require('fs');
const path = require('path');

const CANDIDATE_PW = [
  'playwright',
  '/opt/node22/lib/node_modules/playwright/index.js',
  '/usr/lib/node_modules/playwright/index.js',
];
const CANDIDATE_BIN = [
  process.env.CHROMIUM_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
].filter(Boolean);

function loadPlaywright() {
  for (const p of CANDIDATE_PW) {
    try { return require(p); } catch (_) { /* 다음 후보 */ }
  }
  throw new Error('playwright 를 찾지 못했습니다. `npm i -D playwright` 후 다시 실행하세요.');
}

function chromiumPath() {
  for (const p of CANDIDATE_BIN) if (fs.existsSync(p)) return p;
  return undefined;      // Playwright 기본 경로에 맡긴다
}

let _browser = null;
async function browser() {
  if (_browser) return _browser;
  const { chromium } = loadPlaywright();
  _browser = await chromium.launch({ executablePath: chromiumPath() });
  return _browser;
}

async function htmlToPdf(html, outFile) {
  const b = await browser();
  const page = await b.newPage();
  // 파일 경로 없이 렌더하기 위해 라우트로 직접 먹인다(한글 인코딩 안전).
  await page.route('**/resume', r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
  await page.goto('https://resume.local/resume', { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  await page.pdf({
    path: outFile,
    format: 'A4',
    printBackground: true,
    margin: { top: '16mm', right: '15mm', bottom: '14mm', left: '15mm' },
  });
  await page.close();
  return outFile;
}

async function close() {
  if (_browser) { await _browser.close(); _browser = null; }
}

module.exports = { htmlToPdf, close };
