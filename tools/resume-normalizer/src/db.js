// 지원자 보관함 — SQLite 파일 하나
//
// 변환 결과를 파일 하나(resumes.db)에 쌓아 두고 이름·학교·회사·기술로 다시 찾는다.
// 서버 프로세스 안에서 돌아가므로 별도 DB 서버가 필요 없다.
//
// 담는 것과 담지 않는 것
//   담는다   — 표준화된 JSON 전체, 검색용 요약 칼럼, 원본 파일의 해시와 경로
//   안 담는다 — 원본 파일 자체(옆 폴더에 두고 경로만), 만들어 낸 PDF(언제든 다시 만든다),
//               주민등록번호(애초에 칸이 없다)
//
// 보관기한이 지난 사람은 purge() 한 번으로 파일까지 함께 지운다.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { careerMonths, humanMonths } = require('./schema');

// node:sqlite 는 아직 실험 단계라 부를 때마다 경고를 찍는다. 쓰는 데는 지장이 없고
// 서버 로그만 지저분해지므로 이 경고 한 줄만 걸러낸다.
function loadSqlite() {
  const emit = process.emitWarning;
  process.emitWarning = (w, ...rest) => {
    const s = typeof w === 'string' ? w : (w && w.message) || '';
    if (/SQLite is an experimental/.test(s)) return;
    return emit.call(process, w, ...rest);
  };
  try {
    return require('node:sqlite');
  } catch (err) {
    throw new Error(
      '보관함은 Node 22.5 이상의 내장 SQLite 를 씁니다. ' +
      `현재 ${process.version} 입니다. Node 를 올리거나 --no-db 로 끄고 쓰세요.`);
  } finally {
    process.emitWarning = emit;
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS applicant (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT,
  name_en       TEXT,
  birth         TEXT,
  gender        TEXT,
  phone         TEXT,
  email         TEXT,
  address       TEXT,
  target_role   TEXT,
  career_months INTEGER DEFAULT 0,
  edu_top       TEXT,
  companies     TEXT,
  schools       TEXT,
  warnings      INTEGER DEFAULT 0,
  engine        TEXT,
  data          TEXT NOT NULL,
  search        TEXT,
  source_name   TEXT,
  source_hash   TEXT UNIQUE,
  source_path   TEXT,
  source_bytes  INTEGER,
  created_at    TEXT,
  updated_at    TEXT,
  retain_until  TEXT
);
CREATE INDEX IF NOT EXISTS idx_applicant_name    ON applicant(name);
CREATE INDEX IF NOT EXISTS idx_applicant_career  ON applicant(career_months);
CREATE INDEX IF NOT EXISTS idx_applicant_retain  ON applicant(retain_until);

CREATE TABLE IF NOT EXISTS education (
  applicant_id INTEGER NOT NULL REFERENCES applicant(id) ON DELETE CASCADE,
  ord INTEGER, school TEXT, major TEXT, degree TEXT, status TEXT, start TEXT, "end" TEXT
);
CREATE INDEX IF NOT EXISTS idx_edu_app    ON education(applicant_id);
CREATE INDEX IF NOT EXISTS idx_edu_school ON education(school);

CREATE TABLE IF NOT EXISTS experience (
  applicant_id INTEGER NOT NULL REFERENCES applicant(id) ON DELETE CASCADE,
  ord INTEGER, company TEXT, team TEXT, title TEXT, start TEXT, "end" TEXT, months INTEGER
);
CREATE INDEX IF NOT EXISTS idx_exp_app     ON experience(applicant_id);
CREATE INDEX IF NOT EXISTS idx_exp_company ON experience(company);

-- 누가 언제 무엇을 했는지. 나중에 감사에 답할 수 있어야 한다.
CREATE TABLE IF NOT EXISTS access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  applicant_id INTEGER, action TEXT, actor TEXT, note TEXT, at TEXT
);
CREATE INDEX IF NOT EXISTS idx_log_app ON access_log(applicant_id);
CREATE INDEX IF NOT EXISTS idx_log_at  ON access_log(at);
`;

const nowIso = () => new Date().toISOString();
const today = () => nowIso().slice(0, 10);
const addDays = (days, from = new Date()) =>
  new Date(from.getTime() + days * 86400000).toISOString().slice(0, 10);

const list = v => (Array.isArray(v) ? v : []);
const join = (arr, f) => list(arr).map(f).filter(Boolean).join(' · ');

/** 검색은 이 한 칸만 훑는다 — 이름·학교·회사·기술·자격이 다 들어 있다 */
function searchText(d) {
  const parts = [
    d.name, d.nameEn, d.email, d.phone, d.address, d.targetRole,
    ...list(d.education).flatMap(e => [e.school, e.major, e.degree]),
    ...list(d.experience).flatMap(e => [e.company, e.team, e.title]),
    ...list(d.certificates).map(c => c.name),
    ...list(d.awards).map(a => a.title),
    ...list(d.patents).map(p => p.title),
    ...list(d.skills),
  ];
  return parts.filter(Boolean).join(' ').toLowerCase();
}

const eduTop = d => {
  const e = list(d.education)[0];
  if (!e) return '';
  return [e.school, e.major, e.degree].filter(Boolean).join(' ');
};

class Store {
  /**
   * @param {object} opt
   *   dir        보관 폴더 (기본 <프로젝트>/data)
   *   file       DB 파일 경로 (기본 <dir>/resumes.db)
   *   retainDays 보관기한 일수 (기본 180)
   */
  constructor(opt = {}) {
    const { DatabaseSync } = loadSqlite();
    this.dir = path.resolve(opt.dir || path.join(__dirname, '..', 'data'));
    this.file = opt.file ? path.resolve(opt.file) : path.join(this.dir, 'resumes.db');
    this.filesDir = path.join(path.dirname(this.file), 'files');
    this.retainDays = Number(opt.retainDays) > 0 ? Number(opt.retainDays) : 180;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.mkdirSync(this.filesDir, { recursive: true });
    this.db = new DatabaseSync(this.file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
  }

  close() { try { this.db.close(); } catch (_) {} }

  log(applicantId, action, actor = 'local', note = '') {
    this.db.prepare('INSERT INTO access_log(applicant_id,action,actor,note,at) VALUES(?,?,?,?,?)')
      .run(applicantId ?? null, action, actor, note, nowIso());
  }

  /** 원본 파일을 해시 이름으로 옆에 둔다. 같은 파일을 두 번 올려도 하나만 쌓인다. */
  keepSource(buf, filename) {
    if (!buf || !buf.length) return { hash: null, stored: null, bytes: 0 };
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    const ext = path.extname(filename || '').toLowerCase().slice(0, 8);
    const stored = path.join(this.filesDir, hash + ext);
    if (!fs.existsSync(stored)) fs.writeFileSync(stored, buf);
    return { hash, stored, bytes: buf.length };
  }

  /**
   * 저장 — 같은 원본 파일이 이미 있으면 그 줄을 갱신한다.
   * @param {object} d      표준 JSON
   * @param {object} meta   { file, buf, actor, retainDays }
   * @returns {{id:number, created:boolean}}
   */
  save(d, meta = {}) {
    const src = meta.buf ? this.keepSource(meta.buf, meta.file) : { hash: meta.hash || null, stored: null, bytes: 0 };
    const months = careerMonths(d.experience).months;
    const row = {
      name: d.name || '', name_en: d.nameEn || '', birth: d.birth || '', gender: d.gender || '',
      phone: d.phone || '', email: d.email || '', address: d.address || '',
      target_role: d.targetRole || '',
      career_months: months,
      edu_top: eduTop(d),
      companies: join(d.experience, e => e.company),
      schools: join(d.education, e => e.school),
      warnings: list(d._meta && d._meta.warnings).length,
      engine: (d._meta && d._meta.engine) || '',
      data: JSON.stringify(d),
      search: searchText(d),
      source_name: meta.file || (d._meta && d._meta.sourceFile) || '',
      source_hash: src.hash,
      source_path: src.stored ? path.basename(src.stored) : null,
      source_bytes: src.bytes,
    };

    // 어느 줄을 고칠지 — 명시된 id 가 우선, 없으면 같은 원본 파일을 찾는다
    const found = meta.id
      ? this.db.prepare('SELECT id FROM applicant WHERE id=?').get(Number(meta.id))
      : row.source_hash
        ? this.db.prepare('SELECT id FROM applicant WHERE source_hash = ?').get(row.source_hash)
        : null;

    let id, created;
    if (found) {
      id = found.id; created = false;
      // 원본 파일을 다시 주지 않았으면 원본 관련 칸은 손대지 않는다
      const keep = meta.buf ? [] : ['source_name', 'source_path', 'source_bytes'];
      const cols = Object.keys(row).filter(c => c !== 'source_hash' && !keep.includes(c));
      this.db.prepare(`UPDATE applicant SET ${cols.map(c => `${c}=?`).join(',')}, updated_at=? WHERE id=?`)
        .run(...cols.map(c => row[c]), nowIso(), id);
    } else {
      created = true;
      const cols = Object.keys(row);
      const days = Number(meta.retainDays) > 0 ? Number(meta.retainDays) : this.retainDays;
      const r = this.db.prepare(
        `INSERT INTO applicant(${cols.join(',')},created_at,updated_at,retain_until) ` +
        `VALUES(${cols.map(() => '?').join(',')},?,?,?)`)
        .run(...cols.map(c => row[c]), nowIso(), nowIso(), addDays(days));
      id = Number(r.lastInsertRowid);
    }

    this.db.prepare('DELETE FROM education WHERE applicant_id=?').run(id);
    this.db.prepare('DELETE FROM experience WHERE applicant_id=?').run(id);
    const ie = this.db.prepare(
      'INSERT INTO education(applicant_id,ord,school,major,degree,status,start,"end") VALUES(?,?,?,?,?,?,?,?)');
    list(d.education).forEach((e, i) =>
      ie.run(id, i, e.school || '', e.major || '', e.degree || '', e.status || '', e.start || '', e.end || ''));
    const ix = this.db.prepare(
      'INSERT INTO experience(applicant_id,ord,company,team,title,start,"end",months) VALUES(?,?,?,?,?,?,?,?)');
    list(d.experience).forEach((e, i) =>
      ix.run(id, i, e.company || '', e.team || '', e.title || '', e.start || '', e.end || '',
        careerMonths([e]).months));

    this.log(id, created ? 'create' : 'update', meta.actor, row.source_name);
    return { id, created };
  }

  /** 검색 — q 는 공백으로 나눠 모두 포함하는 사람만 (AND) */
  search(opt = {}) {
    const where = [], args = [];
    for (const term of String(opt.q || '').trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8)) {
      where.push('search LIKE ?');
      args.push('%' + term.replace(/[%_]/g, m => '\\' + m) + '%');
    }
    if (Number(opt.minMonths) > 0) { where.push('career_months >= ?'); args.push(Number(opt.minMonths)); }
    if (Number(opt.maxMonths) > 0) { where.push('career_months <= ?'); args.push(Number(opt.maxMonths)); }
    if (opt.expiring) { where.push('retain_until <= ?'); args.push(opt.expiring === true ? today() : opt.expiring); }

    const sql = where.length ? ' WHERE ' + where.join(' AND ') : '';
    const order = {
      recent: 'updated_at DESC',
      career: 'career_months DESC, updated_at DESC',
      name: 'name COLLATE NOCASE ASC',
      oldest: 'created_at ASC',
    }[opt.sort] || 'updated_at DESC';

    const total = this.db.prepare(`SELECT COUNT(*) n FROM applicant${sql}`).get(...args).n;
    const limit = Math.min(Math.max(Number(opt.limit) || 100, 1), 1000);
    const offset = Math.max(Number(opt.offset) || 0, 0);
    const rows = this.db.prepare(
      `SELECT id,name,name_en,birth,gender,phone,email,target_role,career_months,edu_top,companies,` +
      `warnings,source_name,created_at,updated_at,retain_until FROM applicant${sql} ` +
      `ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, limit, offset);

    return {
      total,
      limit,
      offset,
      rows: rows.map(r => ({ ...r, career: humanMonths(r.career_months) })),
    };
  }

  /** 엑셀·CSV 로 넘길 형태 — report.js 가 기대하는 [{file, data}] */
  items(opt = {}) {
    const ids = this.search({ ...opt, limit: opt.limit || 1000 }).rows.map(r => r.id);
    return ids.map(id => {
      const r = this.get(id, { log: false });
      return { file: r.source_name, data: r.data };
    });
  }

  get(id, opt = {}) {
    const r = this.db.prepare('SELECT * FROM applicant WHERE id=?').get(Number(id));
    if (!r) return null;
    if (opt.log !== false) this.log(r.id, 'view', opt.actor);
    return { ...r, data: JSON.parse(r.data) };
  }

  sourceFile(id) {
    const r = this.db.prepare('SELECT source_name,source_path FROM applicant WHERE id=?').get(Number(id));
    if (!r || !r.source_path) return null;
    const full = path.join(this.filesDir, path.basename(r.source_path));
    return fs.existsSync(full) ? { path: full, name: r.source_name } : null;
  }

  remove(id, actor = 'local') {
    const r = this.db.prepare('SELECT source_path,name FROM applicant WHERE id=?').get(Number(id));
    if (!r) return false;
    this.db.prepare('DELETE FROM applicant WHERE id=?').run(Number(id));
    if (r.source_path) fs.rm(path.join(this.filesDir, path.basename(r.source_path)), { force: true }, () => {});
    this.log(Number(id), 'delete', actor, r.name || '');
    return true;
  }

  /** 보관기한이 지난 사람을 원본 파일까지 함께 지운다 */
  purge(opt = {}) {
    const cut = opt.before || today();
    const rows = this.db.prepare('SELECT id,source_path FROM applicant WHERE retain_until <= ?').all(cut);
    for (const r of rows) {
      this.db.prepare('DELETE FROM applicant WHERE id=?').run(r.id);
      if (r.source_path) fs.rm(path.join(this.filesDir, path.basename(r.source_path)), { force: true }, () => {});
    }
    if (rows.length) this.log(null, 'purge', opt.actor, `${rows.length}명 (기준 ${cut})`);
    return { removed: rows.length, before: cut };
  }

  /** 보관기한을 오늘부터 다시 센다 */
  extend(id, days, actor = 'local') {
    const until = addDays(Number(days) > 0 ? Number(days) : this.retainDays);
    const r = this.db.prepare('UPDATE applicant SET retain_until=? WHERE id=?').run(until, Number(id));
    if (r.changes) this.log(Number(id), 'extend', actor, until);
    return r.changes ? until : null;
  }

  stats() {
    const one = sql => this.db.prepare(sql).get();
    const { n } = one('SELECT COUNT(*) n FROM applicant');
    const soon = this.db.prepare('SELECT COUNT(*) n FROM applicant WHERE retain_until <= ?')
      .get(addDays(30)).n;
    const over = this.db.prepare('SELECT COUNT(*) n FROM applicant WHERE retain_until <= ?').get(today()).n;
    const span = one('SELECT MIN(created_at) a, MAX(created_at) b FROM applicant');
    let bytes = 0;
    try { bytes = fs.statSync(this.file).size; } catch (_) {}
    return { count: n, expiringIn30: soon, expired: over, first: span.a, last: span.b, file: this.file, bytes };
  }

  history(id, limit = 50) {
    return this.db.prepare('SELECT action,actor,note,at FROM access_log WHERE applicant_id=? ORDER BY id DESC LIMIT ?')
      .all(Number(id), Number(limit));
  }
}

/** 열 수 없으면(구형 Node 등) null 을 돌려주고 시스템은 보관함 없이 돌아간다 */
function open(opt = {}) {
  try { return new Store(opt); }
  catch (err) { open.lastError = err; return null; }
}

module.exports = { Store, open, searchText, addDays, today };
