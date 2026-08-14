#!/usr/bin/env node
// 이력서 표준화 — 로컬 웹 시스템
//
//   node src/server.js [--port 7000] [--host 127.0.0.1] [--engine auto|llm|rules] [--work <dir>]
//
// 파일을 끌어다 놓으면 표준 A4 이력서를 만들어 준다.
// 기본은 127.0.0.1 바인딩이다. 지원자 개인정보를 다루므로 외부에 열지 말 것.

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { extractText, SUPPORTED } = require('./extract');
const { parseWithRules } = require('./parse-rules');
const { normalize, audit, blind: makeBlind, careerMonths, humanMonths } = require('./schema');
const { renderHtml } = require('./render');
const pdf = require('./pdf');

const MAX_BYTES = 25 * 1024 * 1024;
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const PORT = Number(arg('--port', 7000));
const HOST = arg('--host', '127.0.0.1');
const ENGINE = arg('--engine', 'auto');
const WORK = arg('--work', path.join(os.tmpdir(), 'resume-normalizer'));

fs.mkdirSync(WORK, { recursive: true });

/** batchId → { id, file, data, base }[] */
const batches = new Map();

const uid = () => crypto.randomBytes(8).toString('hex');
const slug = s => String(s || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').slice(0, 60) || 'unnamed';
const json = (res, code, body) => {
  const b = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': b.length });
  res.end(b);
};

function readBody(req, limit = MAX_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', c => {
      n += c.length;
      if (n > limit) { reject(new Error(`파일이 너무 큽니다(최대 ${Math.round(limit / 1024 / 1024)}MB)`)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// 표준 데이터 → 결과 파일 일습(원본/블라인드 각각 HTML·PDF, 그리고 JSON)
async function writeOutputs(batchDir, base, data) {
  fs.mkdirSync(batchDir, { recursive: true });
  const files = {};
  for (const [suffix, d] of [['', data], ['_blind', makeBlind(data)]]) {
    const html = renderHtml(d, { blind: !!suffix });
    const hp = path.join(batchDir, `${base}${suffix}.html`);
    fs.writeFileSync(hp, html);
    files[suffix ? 'blindHtml' : 'html'] = path.basename(hp);
    const pp = path.join(batchDir, `${base}${suffix}.pdf`);
    await pdf.htmlToPdf(html, pp);
    files[suffix ? 'blindPdf' : 'pdf'] = path.basename(pp);
  }
  const jp = path.join(batchDir, `${base}.json`);
  fs.writeFileSync(jp, JSON.stringify(data, null, 2));
  files.json = path.basename(jp);
  return files;
}

async function convert(buf, filename, batchId) {
  const ext = path.extname(filename).toLowerCase();
  if (!SUPPORTED.includes(ext)) {
    throw new Error(`지원하지 않는 형식입니다(${ext || '확장자 없음'}). ${SUPPORTED.join(' ')} 만 됩니다.`);
  }
  const batchDir = path.join(WORK, batchId);
  fs.mkdirSync(batchDir, { recursive: true });
  const tmp = path.join(batchDir, `_src_${uid()}${ext}`);
  fs.writeFileSync(tmp, buf);

  try {
    const text = await extractText(tmp);
    let raw, engine;
    const useLLM = ENGINE === 'llm' || (ENGINE === 'auto' && process.env.ANTHROPIC_API_KEY);
    if (useLLM) {
      try {
        raw = await require('./parse-llm').parseWithLLM(text);
        engine = raw._meta.engine;
      } catch (err) {
        if (ENGINE === 'llm') throw err;
        raw = parseWithRules(text);
        engine = 'rules(llm-fallback)';
      }
    } else {
      raw = parseWithRules(text);
      engine = 'rules';
    }
    const data = normalize(raw, { sourceFile: filename, engine });
    data._meta.warnings = [...new Set([...(data._meta.warnings || []), ...audit(data)])];

    const base = slug(data.name || path.basename(filename, ext));
    const files = await writeOutputs(batchDir, base, data);
    return { id: uid(), file: filename, base, data, files };
  } finally {
    fs.unlink(tmp, () => {});
  }
}

const csvCell = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
function summaryCsv(items) {
  const head = ['원본파일', '이름', '생년월일', '성별', '연락처', '이메일', '지원직무',
    '최종학력', '총경력', '총경력(개월)', '경력수', '프로젝트수', '수상수', '특허수', '검토필요'];
  const rows = items.map(r => {
    const d = r.data, e = d.education[0] || {};
    return [r.file, d.name, d.birth, d.gender, d.phone, d.email, d.targetRole,
      [e.school, e.major, e.degree].filter(Boolean).join(' '),
      humanMonths(careerMonths(d.experience).months), careerMonths(d.experience).months,
      d.experience.length, d.projects.length, d.awards.length, d.patents.length,
      (d._meta.warnings || []).join(' / ')];
  });
  return '﻿' + [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.pdf': 'application/pdf',
  '.json': 'application/json; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
  '.zip': 'application/zip', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  try {
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    if (req.method === 'GET' && p === '/api/config') {
      const useLLM = ENGINE === 'llm' || (ENGINE === 'auto' && process.env.ANTHROPIC_API_KEY);
      return json(res, 200, { engine: useLLM ? 'llm' : 'rules', supported: SUPPORTED, batch: uid() });
    }

    // 파일 하나씩 올린다. 멀티파트 대신 본문에 그대로 실어 파싱 실수를 없앤다.
    if (req.method === 'POST' && p === '/api/convert') {
      const batchId = url.searchParams.get('batch');
      const filename = decodeURIComponent(req.headers['x-filename'] || 'upload');
      if (!batchId || !/^[a-f0-9]{16}$/.test(batchId)) return json(res, 400, { error: '잘못된 배치 ID' });
      let buf;
      try { buf = await readBody(req); }
      catch (e) { return json(res, 413, { error: e.message, file: filename }); }
      try {
        const item = await convert(buf, filename, batchId);
        const list = batches.get(batchId) || [];
        list.push(item); batches.set(batchId, list);
        return json(res, 200, { ok: true, item: { id: item.id, file: item.file, base: item.base, data: item.data, files: item.files } });
      } catch (e) {
        return json(res, 200, { ok: false, file: filename, error: e.message });
      }
    }

    // 사람이 고친 값을 반영해 다시 만든다
    if (req.method === 'POST' && p === '/api/update') {
      const body = JSON.parse((await readBody(req, 4 * 1024 * 1024)).toString('utf8'));
      const list = batches.get(body.batch) || [];
      const item = list.find(i => i.id === body.id);
      if (!item) return json(res, 404, { error: '항목을 찾을 수 없습니다' });
      const data = normalize(body.data, { ...item.data._meta, edited: true });
      data._meta.warnings = audit(data);
      item.data = data;
      item.base = slug(data.name || item.base);
      item.files = await writeOutputs(path.join(WORK, body.batch), item.base, data);
      return json(res, 200, { ok: true, item: { id: item.id, file: item.file, base: item.base, data, files: item.files } });
    }

    if (req.method === 'GET' && p === '/api/summary') {
      const list = batches.get(url.searchParams.get('batch')) || [];
      const buf = Buffer.from(summaryCsv(list), 'utf8');
      res.writeHead(200, {
        'content-type': MIME['.csv'],
        'content-disposition': 'attachment; filename="summary.csv"',
      });
      return res.end(buf);
    }

    if (req.method === 'GET' && p === '/api/zip') {
      const batchId = url.searchParams.get('batch');
      const list = batches.get(batchId) || [];
      if (!list.length) return json(res, 404, { error: '결과가 없습니다' });
      const AdmZip = require('adm-zip');
      const zip = new AdmZip();
      const dir = path.join(WORK, batchId);
      for (const it of list) {
        for (const f of Object.values(it.files)) {
          const full = path.join(dir, f);
          if (fs.existsSync(full)) zip.addLocalFile(full);
        }
      }
      zip.addFile('summary.csv', Buffer.from(summaryCsv(list), 'utf8'));
      const buf = zip.toBuffer();
      res.writeHead(200, {
        'content-type': MIME['.zip'],
        'content-disposition': 'attachment; filename="resumes.zip"',
        'content-length': buf.length,
      });
      return res.end(buf);
    }

    // /out/<batch>/<file>
    if (req.method === 'GET' && p.startsWith('/out/')) {
      const [, , batchId, file] = p.split('/');
      if (!/^[a-f0-9]{16}$/.test(batchId || '') || !file || file.includes('..')) {
        return json(res, 400, { error: '잘못된 경로' });
      }
      const full = path.join(WORK, batchId, path.basename(decodeURIComponent(file)));
      if (!fs.existsSync(full)) return json(res, 404, { error: '파일 없음' });
      const type = MIME[path.extname(full)] || 'application/octet-stream';
      const head = { 'content-type': type, 'content-length': fs.statSync(full).size };
      if (url.searchParams.get('dl')) {
        head['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(full))}`;
      }
      res.writeHead(200, head);
      return fs.createReadStream(full).pipe(res);
    }

    json(res, 404, { error: 'not found' });
  } catch (err) {
    json(res, 500, { error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  const useLLM = ENGINE === 'llm' || (ENGINE === 'auto' && process.env.ANTHROPIC_API_KEY);
  console.log(`이력서 표준화 시스템  http://${HOST}:${PORT}`);
  console.log(`  파싱 엔진  ${useLLM ? 'Claude' : '규칙 기반 (ANTHROPIC_API_KEY 없음)'}`);
  console.log(`  지원 형식  ${SUPPORTED.join(' ')}`);
  console.log(`  작업 폴더  ${WORK}   ← 지원자 개인정보가 저장됩니다. 다 쓰면 지우세요.`);
  if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
    console.log('  ! 외부에 열려 있습니다. 개인정보를 다루므로 사내망 밖으로 노출하지 마세요.');
  }
});

process.on('SIGINT', async () => { await pdf.close(); process.exit(0); });
