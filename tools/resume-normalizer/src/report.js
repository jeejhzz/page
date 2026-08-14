// 여러 사람을 한 표로 — CSV 와 엑셀이 같은 정의를 쓰도록 여기 한 곳에 모은다.
//
// 채용 담당자가 실제로 보는 건 "누가, 어디 나와서, 어디서 몇 년" 이다.
// 그래서 학력·경력을 한 칸에 요약해 넣어, 한 줄만 읽어도 사람이 파악되게 한다.
const { careerMonths, humanMonths, age, monthIndex } = require('./schema');

const dash = '–';
const span = e => [e.start, e.end].filter(Boolean).join(` ${dash} `);

function eduLine(e) {
  const head = [e.school, e.major].filter(Boolean).join(' ');
  const tail = [e.degree, e.status].filter(Boolean).join(' ');
  const when = span(e);
  return [head, tail, when && `(${when})`].filter(Boolean).join(' ');
}

function expLine(e) {
  const who = [e.company, e.team, e.title].filter(Boolean).join(' · ');
  const when = span(e);
  const a = monthIndex(e.start), b = monthIndex(e.end);
  const dur = a != null && b != null ? humanMonths(Math.abs(b - a) + 1) : '';
  const paren = [when, dur].filter(Boolean).join(', ');
  return [who, paren && `(${paren})`].filter(Boolean).join(' ');
}

const COLUMNS = [
  { key: '원본파일', width: 26, get: (d, r) => r.file },
  { key: '이름', width: 10, get: d => d.name },
  { key: '영문이름', width: 16, get: d => d.nameEn },
  { key: '생년월일', width: 12, get: d => d.birth },
  { key: '나이', width: 6, get: d => age(d.birth) },
  { key: '성별', width: 6, get: d => d.gender },
  { key: '연락처', width: 15, get: d => d.phone },
  { key: '이메일', width: 26, get: d => d.email },
  { key: '주소', width: 26, get: d => d.address },
  { key: '지원직무', width: 24, get: d => d.targetRole },
  { key: '총경력', width: 12, get: d => humanMonths(careerMonths(d.experience).months) },
  { key: '총경력(개월)', width: 12, number: true, get: d => careerMonths(d.experience).months },
  { key: '경력수', width: 8, number: true, get: d => d.experience.length },
  { key: '최종학력', width: 30, get: d => (d.education[0] ? eduLine(d.education[0]) : '') },
  { key: '학력 전체', width: 46, wrap: true, get: d => d.education.map(eduLine).join('\n') },
  { key: '경력 전체', width: 52, wrap: true, get: d => d.experience.map(expLine).join('\n') },
  { key: '자격', width: 24, wrap: true, get: d => d.certificates.map(c => [c.name, c.date && `(${c.date})`].filter(Boolean).join(' ')).join('\n') },
  { key: '어학', width: 18, wrap: true, get: d => d.languages.map(l => [l.language, l.test, l.score].filter(Boolean).join(' ')).join('\n') },
  { key: '수상', width: 26, wrap: true, get: d => d.awards.map(a => [a.title, a.date && `(${a.date})`].filter(Boolean).join(' ')).join('\n') },
  { key: '특허', width: 26, wrap: true, get: d => d.patents.map(p => [p.title, p.number].filter(Boolean).join(' ')).join('\n') },
  { key: '기술스택', width: 30, wrap: true, get: d => d.skills.join(', ') },
  { key: '검토필요', width: 30, wrap: true, get: d => (d._meta.warnings || []).join(' / ') },
];

/** items = [{ file, data }] → { head, rows, columns } */
function table(items) {
  return {
    columns: COLUMNS,
    head: COLUMNS.map(c => c.key),
    rows: items.map(r => COLUMNS.map(c => {
      const v = c.get(r.data, r);
      return v == null ? '' : v;
    })),
  };
}

const csvCell = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;

function toCsv(items) {
  const t = table(items);
  const body = [t.head, ...t.rows]
    .map(r => r.map(v => csvCell(String(v).replace(/\n/g, ' / '))).join(','))
    .join('\r\n');
  return '﻿' + body;      // 엑셀에서 한글이 깨지지 않도록 BOM
}

module.exports = { COLUMNS, table, toCsv, eduLine, expLine };
