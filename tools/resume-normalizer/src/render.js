// 표준 스키마 → A4 인쇄용 HTML
//
// 인쇄가 목적이라 화면용 다크 테마가 아니라 흰 종이 기준이다.
// 기간을 왼쪽 고정폭 칼럼에 몰아 넣어, 여러 사람 이력서를 넘겨볼 때
// 눈이 같은 위치에서 연도를 읽게 만든다. 자유 양식에서 가장 아쉬운 부분이 그것이다.

const fs = require('fs');
const path = require('path');
const { age, careerMonths, humanMonths, monthIndex } = require('./schema');

const FONT_DIR = path.join(__dirname, '..', 'node_modules', 'pretendard', 'dist', 'web', 'static', 'woff2');
const WEIGHTS = [[400, 'Regular'], [500, 'Medium'], [600, 'SemiBold'], [700, 'Bold'], [800, 'ExtraBold']];

function fontFaces() {
  if (!fs.existsSync(FONT_DIR)) return '';
  return WEIGHTS.map(([w, n]) => {
    const f = path.join(FONT_DIR, `Pretendard-${n}.woff2`);
    if (!fs.existsSync(f)) return '';
    return `@font-face{font-family:'Pretendard';font-style:normal;font-weight:${w};font-display:block;` +
      `src:url(data:font/woff2;base64,${fs.readFileSync(f).toString('base64')}) format('woff2')}`;
  }).join('\n');
}

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const period = (a, b) => (a && b ? `${esc(a)} – ${esc(b)}` : esc(a || b || ''));
const joinDot = (...v) => v.filter(Boolean).map(esc).join(' <span class="sep">·</span> ');

const CSS = `
@page { size: A4; margin: 16mm 15mm 14mm; }
*{margin:0;padding:0;box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:'Pretendard',-apple-system,'Malgun Gothic',sans-serif;color:#15202b;
  font-size:10pt;line-height:1.55;word-break:keep-all;background:#fff}
.sheet{max-width:180mm;margin:0 auto}

.hd{display:flex;align-items:flex-end;justify-content:space-between;gap:12mm;
  padding-bottom:3.5mm;border-bottom:1.6pt solid #001529}
.hd h1{font-size:22pt;font-weight:800;letter-spacing:-.02em;line-height:1.1}
.hd h1 em{font-style:normal;font-size:11pt;font-weight:600;color:#5b6a7d;margin-left:3mm;letter-spacing:0}
.hd .role{margin-top:1.5mm;font-size:10.5pt;font-weight:700;color:#0a3d62}
.hd .contact{text-align:right;font-size:8.8pt;color:#3d4a5c;line-height:1.7;white-space:nowrap}
.hd .contact b{font-weight:700;color:#15202b}

.facts{display:grid;grid-template-columns:repeat(4,1fr);gap:0;margin-top:4mm;
  border:0.6pt solid #d5dce5;border-radius:1.5mm;overflow:hidden}
.facts div{padding:2.2mm 3mm;border-right:0.6pt solid #e6ebf1;font-size:9pt}
.facts div:last-child{border-right:0}
.facts div.w{grid-column:1/-1;border-right:0;border-top:0.6pt solid #e6ebf1}
.facts b{font-weight:800}
.facts span{display:block;font-size:7.4pt;font-weight:700;letter-spacing:.06em;color:#7b8798;margin-bottom:.6mm}
.facts.wide{grid-template-columns:1fr}

.sum{margin-top:4mm;padding:3mm 3.5mm;background:#f4f7fa;border-left:2pt solid #0a3d62;
  font-size:9.4pt;line-height:1.7;color:#25313f}

h2{margin:6.5mm 0 2.5mm;font-size:10.5pt;font-weight:800;letter-spacing:-.01em;color:#001529;
  padding-bottom:1.2mm;border-bottom:0.8pt solid #c8d2dd;display:flex;align-items:baseline;gap:2.5mm}
h2 small{font-size:7.2pt;font-weight:700;letter-spacing:.14em;color:#8e9aab}
h2{break-after:avoid;page-break-after:avoid}   /* 제목만 페이지 끝에 남지 않게 */
section{break-inside:auto}

.e{display:grid;grid-template-columns:30mm 1fr;gap:0 4mm;padding:1.8mm 0;
  break-inside:avoid;page-break-inside:avoid}
.e + .e{border-top:0.5pt dotted #dde3ea}
.e .when{font-size:8.6pt;font-weight:600;color:#5b6a7d;padding-top:.4mm;font-variant-numeric:tabular-nums}
.e .when .dur{font-size:7.8pt;font-weight:600;color:#94a1b2;margin-top:.4mm}
.e .what strong{font-size:10.2pt;font-weight:700}
.e .what .meta{font-size:9pt;color:#44536a;margin-top:.4mm}
.e .what .sub{font-size:8.8pt;color:#6b7787;margin-top:.4mm}
.e ul{margin:1.4mm 0 0;padding-left:3.6mm}
.e li{font-size:9.2pt;line-height:1.6;margin-bottom:.6mm}
.e li::marker{color:#9aa6b5}
.tags{margin-top:1.4mm;display:flex;flex-wrap:wrap;gap:1.2mm}
.tags i{font-style:normal;font-size:8pt;font-weight:600;color:#33455c;
  border:0.6pt solid #ccd6e0;border-radius:6pt;padding:.3mm 1.8mm;background:#f7f9fb}
.sep{color:#adb8c6}

.skills{display:flex;flex-wrap:wrap;gap:1.4mm}
.skills i{font-style:normal;font-size:8.6pt;font-weight:600;color:#1f3149;
  border:0.6pt solid #c7d2de;border-radius:8pt;padding:.7mm 2.4mm;background:#f5f8fb}

.foot{margin-top:8mm;padding-top:2.5mm;border-top:0.5pt solid #dde3ea;
  display:flex;justify-content:space-between;font-size:7.4pt;color:#93a0b0}

.warn{margin-top:4mm;padding:2.6mm 3.2mm;border:0.7pt solid #e0a24a;background:#fdf6ea;
  border-radius:1.5mm;font-size:8.2pt;color:#8a5a12;line-height:1.6}
.warn b{font-weight:800}
.warn ul{margin:1mm 0 0;padding-left:4mm}
@media print{.warn{display:none}}
`;

function factCells(o, opts) {
  const cells = [];
  if (!opts.blind) {
    if (o.birth) {
      const a = age(o.birth);
      cells.push(['생년월일', esc(o.birth) + (a ? ` <span class="sep">(만 ${a}세)</span>` : '')]);
    }
    if (o.gender) cells.push(['성별', esc(o.gender)]);
    if (o.phone) cells.push(['연락처', esc(o.phone)]);
    if (o.email) cells.push(['이메일', esc(o.email)]);
    if (o.address) cells.push(['주소', esc(o.address), 'w']);   // 주소는 한 줄을 다 쓴다
  }
  // 총 경력은 개인정보가 아니라서 블라인드본에도 남긴다. 오히려 여기서 가장 많이 본다.
  const c = careerMonths(o.experience);
  if (c.months) {
    cells.push(['총 경력', `<b>${esc(humanMonths(c.months))}</b>` +
      (c.spans > 1 ? ` <span class="sep">· ${c.spans}개 구간</span>` : '') +
      (c.skipped ? ` <span class="sep">· ${c.skipped}건 제외</span>` : '')]);
  }
  if (o.military) cells.push(['병역', esc(o.military)]);
  return cells;
}

function section(title, en, body) {
  if (!body) return '';
  return `<section><h2>${esc(title)}<small>${esc(en)}</small></h2>${body}</section>`;
}

const entry = (when, what) => `<div class="e"><div class="when">${when || ''}</div><div class="what">${what}</div></div>`;

// 기간 아래에 그 자리에서 일한 길이를 적는다. 여러 명을 넘겨볼 때 눈으로 재지 않아도 된다.
function spanNote(e) {
  const a = monthIndex(e.start), b = monthIndex(e.end);
  if (a == null || b == null) return '';
  const n = Math.abs(b - a) + 1;
  return n > 1 ? `<div class="dur">${esc(humanMonths(n))}</div>` : '';
}

function renderHtml(o, opts = {}) {
  const blind = !!opts.blind || !!(o._meta && o._meta.blind);
  // 기본은 요약본이다. 채용 담당자가 먼저 보는 건 "어디 나와서 어디서 몇 년" 이고,
  // 성과 목록까지 다 펼치면 한 장에 안 들어가 사람끼리 비교가 안 된다.
  const brief = opts.full ? false : opts.brief !== false;
  const cells = factCells(o, { blind });

  const contact = blind ? '' : [
    o.phone && `<b>${esc(o.phone)}</b>`,
    o.email && esc(o.email),
    ...o.links.map(l => `${esc(l.label)} ${esc(l.url.replace(/^https?:\/\//, ''))}`),
  ].filter(Boolean).join('<br>');

  const education = o.education.map(e => entry(
    period(e.start, e.end),
    `<strong>${esc(e.school)}</strong>` +
    (e.major || e.degree || e.status
      ? `<div class="meta">${joinDot(e.major, e.degree, e.status)}</div>` : '') +
    (e.gpa ? `<div class="sub">학점 ${esc(e.gpa)}</div>` : '') +
    (!brief && e.note ? `<div class="sub">${esc(e.note)}</div>` : '')
  )).join('');

  const experience = o.experience.map(e => entry(
    period(e.start, e.end) + spanNote(e),
    `<strong>${esc(e.company)}</strong>` +
    (e.title || e.team || e.location
      ? `<div class="meta">${joinDot(e.title, e.team, e.location)}</div>` : '') +
    (brief || !e.bullets.length ? '' : `<ul>${e.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>`) +
    (brief || !e.stack.length ? '' : `<div class="tags">${e.stack.map(s => `<i>${esc(s)}</i>`).join('')}</div>`)
  )).join('');

  const projects = brief ? '' : o.projects.map(e => entry(
    period(e.start, e.end),
    `<strong>${esc(e.company)}</strong>` +
    (e.title || e.team ? `<div class="meta">${joinDot(e.title, e.team)}</div>` : '') +
    (e.bullets.length ? `<ul>${e.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>` : '') +
    (e.stack.length ? `<div class="tags">${e.stack.map(s => `<i>${esc(s)}</i>`).join('')}</div>` : '')
  )).join('');

  const awards = o.awards.map(a => entry(
    esc(a.date),
    `<strong>${esc(a.title)}</strong>` +
    (a.issuer || a.note ? `<div class="meta">${joinDot(a.issuer, a.note)}</div>` : '')
  )).join('');

  const patents = o.patents.map(p => entry(
    esc(p.date),
    `<strong>${esc(p.title)}</strong>` +
    (p.number || p.status || p.role
      ? `<div class="meta">${joinDot(p.number, p.status, p.role)}</div>` : '') +
    (p.note ? `<div class="sub">${esc(p.note)}</div>` : '')
  )).join('');

  const publications = o.publications.map(p => entry(
    esc(p.date),
    `<strong>${esc(p.title)}</strong>` +
    (p.venue || p.authors ? `<div class="meta">${joinDot(p.venue, p.authors)}</div>` : '')
  )).join('');

  const certificates = o.certificates.map(c => entry(
    esc(c.date), `<strong>${esc(c.name)}</strong>` + (c.issuer ? `<div class="meta">${esc(c.issuer)}</div>` : '')
  )).join('');

  const languages = o.languages.map(l => entry(
    esc(l.date), `<strong>${joinDot(l.language, l.test)}</strong>` + (l.score ? `<div class="meta">${esc(l.score)}</div>` : '')
  )).join('');

  const skills = o.skills.length
    ? `<div class="skills">${o.skills.map(s => `<i>${esc(s)}</i>`).join('')}</div>` : '';

  const warnings = (o._meta.warnings || []);
  const warnBox = opts.showWarnings !== false && warnings.length
    ? `<div class="warn"><b>검토 필요</b> — 자동 변환에서 확인이 필요한 항목입니다. 인쇄 시에는 표시되지 않습니다.
       <ul>${warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : '';

  const title = blind ? '표준 이력서 (블라인드)' : `${o.name || '표준'} 이력서`;

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<style>${fontFaces()}\n${CSS}</style></head><body><div class="sheet">

  <header class="hd">
    <div>
      <h1>${blind ? '지원자' : esc(o.name || '이름 없음')}${!blind && o.nameEn ? `<em>${esc(o.nameEn)}</em>` : ''}</h1>
      ${o.targetRole ? `<div class="role">${esc(o.targetRole)}</div>` : ''}
    </div>
    ${contact ? `<div class="contact">${contact}</div>` : ''}
  </header>

  ${cells.length ? `<div class="facts${cells.length <= 2 ? ' wide' : ''}">${
    cells.map(([k, v, cls]) => `<div${cls ? ` class="${cls}"` : ''}><span>${esc(k)}</span>${v}</div>`).join('')}</div>` : ''}

  ${!brief && o.summary ? `<div class="sum">${esc(o.summary)}</div>` : ''}

  ${section('학력', 'EDUCATION', education)}
  ${section('경력', 'EXPERIENCE', experience)}
  ${section('프로젝트', 'PROJECTS', projects)}
  ${section('수상', 'AWARDS', awards)}
  ${section('특허', 'PATENTS', patents)}
  ${section('논문·학술', 'PUBLICATIONS', publications)}
  ${section('자격', 'CERTIFICATES', certificates)}
  ${section('어학', 'LANGUAGES', languages)}
  ${section('기술 스택', 'SKILLS', skills)}

  ${warnBox}

  <div class="foot">
    <span>디노티시아 표준 이력서${brief ? ' · 요약' : ''}${blind ? ' · 블라인드' : ''}</span>
    <span>원본 ${esc(o._meta.sourceFile || '-')} · 변환 ${esc((o._meta.extractedAt || '').slice(0, 10))}</span>
  </div>
</div></body></html>`;
}

module.exports = { renderHtml, CSS };
