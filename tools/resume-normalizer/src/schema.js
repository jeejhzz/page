// 표준 이력서 필드 정의와 값 정규화
//
// 파싱 엔진(규칙/LLM)이 무엇을 내놓든 결국 이 모양으로 맞춘다.
// 렌더러는 이 구조만 알면 되고, 엔진을 바꿔도 템플릿은 그대로다.

const EMPTY = () => ({
  name: '', nameEn: '', birth: '', gender: '', address: '', phone: '', email: '',
  links: [], targetRole: '', summary: '',
  education: [], experience: [], awards: [], patents: [],
  certificates: [], languages: [], skills: [], publications: [],
  military: '',
  _meta: { sourceFile: '', extractedAt: '', engine: '', warnings: [] },
});

// 010-1234-5678 로 통일. 국가번호(+82)와 각종 구분자를 흡수한다.
function normPhone(v) {
  if (!v) return '';
  let d = String(v).replace(/[^\d+]/g, '');
  d = d.replace(/^\+?82/, '0').replace(/\+/g, '');
  if (!/^0/.test(d) && d.length >= 9) d = '0' + d;
  if (/^01\d{8,9}$/.test(d)) return d.replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3');
  if (/^02\d{7,8}$/.test(d)) return d.replace(/^(\d{2})(\d{3,4})(\d{4})$/, '$1-$2-$3');
  if (/^0\d{9,10}$/.test(d)) return d.replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3');
  return String(v).trim();
}

function normEmail(v) {
  if (!v) return '';
  const m = String(v).match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return m ? m[0].toLowerCase().replace(/[.,;)]+$/, '') : '';
}

// 2019.3 / 2019-03 / 2019년 3월 / 19.03 → 2019.03
function normMonth(v) {
  if (!v) return '';
  const s = String(v).trim();
  if (/^(현재|재직\s*중|재학\s*중|present|current|now)$/i.test(s)) return '현재';
  let m = s.match(/(\d{4})\s*[.\-/년]\s*(\d{1,2})/);
  if (m) return `${m[1]}.${String(m[2]).padStart(2, '0')}`;
  m = s.match(/^(\d{4})\s*년?$/);
  if (m) return m[1];
  m = s.match(/^(\d{2})\s*[.\-/]\s*(\d{1,2})$/);            // 19.03
  if (m) return `20${m[1]}.${String(m[2]).padStart(2, '0')}`;
  return s;
}

// 1993.07.15 형태로. 연도만 있으면 연도만 남긴다.
function normBirth(v) {
  if (!v) return '';
  const s = String(v).trim();
  const m = s.match(/(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/);
  if (m) return `${m[1]}.${String(m[2]).padStart(2, '0')}.${String(m[3]).padStart(2, '0')}`;
  const m2 = s.match(/(\d{4})\s*[.\-/년]\s*(\d{1,2})/);
  if (m2) return `${m2[1]}.${String(m2[2]).padStart(2, '0')}`;
  const m3 = s.match(/(19|20)\d{2}/);
  return m3 ? m3[0] : s;
}

function normGender(v) {
  if (!v) return '';
  const s = String(v).trim();
  if (/^(남|남성|남자|m|male)$/i.test(s)) return '남';
  if (/^(여|여성|여자|f|female)$/i.test(s)) return '여';
  return s;
}

function age(birth) {
  const m = String(birth || '').match(/^(\d{4})/);
  if (!m) return '';
  const now = new Date();
  let a = now.getFullYear() - Number(m[1]);
  const mm = String(birth).match(/^\d{4}\.(\d{2})\.?(\d{2})?/);
  if (mm) {
    const bm = Number(mm[1]), bd = Number(mm[2] || 1);
    if (now.getMonth() + 1 < bm || (now.getMonth() + 1 === bm && now.getDate() < bd)) a--;
  }
  return a > 0 && a < 120 ? String(a) : '';
}

const arr = v => (Array.isArray(v) ? v : v ? [v] : []);
const str = v => (v == null ? '' : String(v).trim());

/** 어떤 모양으로 들어오든 표준 스키마로 강제한다. */
function normalize(raw, meta = {}) {
  const o = EMPTY();
  const r = raw || {};

  // "홍길동 (Hong Gildong)" 처럼 한 칸에 같이 적어 내는 경우가 많다
  o.name = str(r.name);
  o.nameEn = str(r.nameEn || r.name_en);
  const paren = o.name.match(/^(.+?)\s*[(（]\s*([A-Za-z][A-Za-z .'-]{1,40})\s*[)）]\s*$/);
  if (paren) {
    o.name = paren[1].trim();
    if (!o.nameEn) o.nameEn = paren[2].trim();
  }
  o.birth = normBirth(r.birth || r.birthdate || r.birthDate);
  o.gender = normGender(r.gender);
  o.address = str(r.address).replace(/\s+/g, ' ');
  o.phone = normPhone(r.phone || r.mobile || r.contact);
  o.email = normEmail(r.email);
  o.targetRole = str(r.targetRole || r.target_role || r.position);
  o.summary = str(r.summary).replace(/\s*\n\s*/g, ' ');
  o.military = str(r.military);

  o.links = arr(r.links).map(l => (typeof l === 'string'
    ? { label: labelOf(l), url: l }
    : { label: str(l.label) || labelOf(str(l.url)), url: str(l.url) }))
    .filter(l => l.url);

  o.education = arr(r.education).map(e => ({
    school: str(e.school), major: str(e.major), degree: str(e.degree),
    status: str(e.status), start: normMonth(e.start), end: normMonth(e.end),
    gpa: str(e.gpa), note: str(e.note),
  })).filter(e => e.school || e.major);

  o.experience = arr(r.experience).map(e => ({
    company: str(e.company), team: str(e.team), title: str(e.title),
    start: normMonth(e.start), end: normMonth(e.end),
    location: str(e.location),
    bullets: arr(e.bullets).map(str).filter(Boolean),
    stack: arr(e.stack).map(str).filter(Boolean),
  })).filter(e => e.company || e.title);

  o.awards = arr(r.awards).map(a => ({
    title: str(a.title), issuer: str(a.issuer), date: normMonth(a.date), note: str(a.note),
  })).filter(a => a.title);

  o.patents = arr(r.patents).map(p => ({
    title: str(p.title), number: str(p.number), status: str(p.status),
    date: normMonth(p.date), role: str(p.role), note: str(p.note),
  })).filter(p => p.title || p.number);

  o.certificates = arr(r.certificates).map(c => ({
    name: str(c.name), issuer: str(c.issuer), date: normMonth(c.date),
  })).filter(c => c.name);

  o.languages = arr(r.languages).map(l => ({
    language: str(l.language), test: str(l.test), score: str(l.score), date: normMonth(l.date),
  })).filter(l => l.language || l.test);

  o.publications = arr(r.publications).map(p => ({
    title: str(p.title), venue: str(p.venue), date: normMonth(p.date), authors: str(p.authors),
  })).filter(p => p.title);

  o.skills = arr(r.skills).map(str).filter(Boolean);

  o._meta = {
    sourceFile: '', extractedAt: new Date().toISOString(), engine: '', warnings: [],
    ...(r._meta || {}), ...meta,
  };
  return o;
}

function labelOf(url) {
  const u = String(url).toLowerCase();
  if (u.includes('github')) return 'GitHub';
  if (u.includes('linkedin')) return 'LinkedIn';
  if (u.includes('notion')) return 'Notion';
  if (u.includes('velog') || u.includes('tistory') || u.includes('medium')) return 'Blog';
  if (u.includes('scholar.google')) return 'Scholar';
  return 'Link';
}

/** 사람이 검토해야 할 지점을 골라낸다. */
function audit(o) {
  const w = [];
  if (!o.name) w.push('이름을 찾지 못했습니다');
  if (!o.email) w.push('이메일을 찾지 못했습니다');
  if (!o.phone) w.push('연락처를 찾지 못했습니다');
  if (!o.education.length) w.push('학력이 비어 있습니다');
  if (!o.experience.length) w.push('경력이 비어 있습니다');
  for (const e of o.experience) {
    if (!e.start) w.push(`경력 기간 누락: ${e.company || e.title}`);
  }
  return w;
}

// 개인정보 보호가 필요한 필드 — 블라인드 모드에서 지운다.
const PII_FIELDS = ['name', 'nameEn', 'birth', 'gender', 'address', 'phone', 'email'];

function blind(o) {
  const b = JSON.parse(JSON.stringify(o));
  for (const f of PII_FIELDS) b[f] = '';
  b.links = [];
  b._meta.blind = true;
  return b;
}

module.exports = { EMPTY, normalize, audit, blind, age, normPhone, normEmail, normMonth, normBirth, normGender, PII_FIELDS };
