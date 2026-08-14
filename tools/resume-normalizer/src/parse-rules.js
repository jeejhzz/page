// 규칙 기반 파서 — API 키 없이도 도구가 돌아가게 하는 기본 엔진.
//
// 한계는 분명하다. 자유 양식 이력서는 문장으로 경력을 서술하기도 하고
// 표를 쓰기도 해서, 규칙만으로는 놓치는 항목이 생긴다.
// 정확도가 필요하면 --engine llm 을 쓰고, 이 엔진은 폴백/오프라인용으로 둔다.

const SECTION = [
  ['education', /^(학\s*력(\s*사항)?|education(al background)?|academic)/i],
  // "경력기술서"·"경력서"는 문서 제목이지 섹션 제목이 아니다. 걸리면 첫 줄을 통째로 삼킨다.
  ['experience', /^(경\s*력(?!\s*(기술)?서)(\s*사항)?|업무\s*경험|직무\s*경험|work\s*experience|experience|employment|career)/i],
  ['projects', /^(프로젝트(\s*경험)?|주요\s*프로젝트|projects?)/i],
  ['awards', /^(수\s*상(\s*내역|\s*경력)?|awards?|honors?)/i],
  ['patents', /^(특\s*허(\s*내역)?|지식재산|patents?)/i],
  ['publications', /^(논\s*문|학술\s*활동|publications?|papers?)/i],
  ['certificates', /^(자\s*격(\s*증)?(\s*사항)?|certificat|licen[cs]e)/i],
  ['languages', /^(어\s*학(\s*능력|\s*성적)?|외국어|languages?)/i],
  // 홑단어 "기술"/"Skills" 는 끝까지 일치할 때만 제목으로 본다.
  // 안 그러면 "기술 경력서 김보경" 같은 표지 줄을 제목으로 오인한다.
  ['skills', /^(기술\s*스\s*택|보유\s*기술|주요\s*기술|핵심\s*역량|보유\s*역량|사용\s*(?:기술|도구)|다루는\s*것|개발\s*환경|tech\s*stack|technical\s*skills?)|^(기술|역량|skills?)$/i],
  // 알아보지만 표준 이력서에는 옮기지 않는 구역. 앞 섹션이 여기까지 흘러드는 것을 막는다.
  ['_ignore', /^(포트폴리오|첨부|참고\s*자료|기타\s*사항|취미|특기|레퍼런스|reference|portfolio|appendix)/i],
  ['summary', /^(자기\s*소개|소\s*개|요\s*약|프로필(\s*요약)?|지원\s*동기|about\s*me|summary|profile|introduction)/i],
  ['military', /^(병\s*역(\s*사항)?|military)/i],
  ['personal', /^(인적\s*사항|기본\s*정보|개인\s*정보|personal)/i],
];

const RE = {
  email: /[\w.+-]+@[\w-]+\.[\w.-]{2,}/,
  phone: /(?:\+?82[-\s]?)?0?1[016789][-.\s)]?\d{3,4}[-.\s]?\d{4}/,
  url: /https?:\/\/[^\s)>,]+/g,
  // 기간: 2019.03 ~ 2022.12 / 2019.3-현재 / 2019년 3월 ~ 2022년 12월 / 2011. 3. ~ 2013. 2.
  // 월 뒤에 마침표를 찍는 표기("2011. 3. ~")가 흔해서 끝의 점까지 흡수한다.
  range: /((?:19|20)\d{2}\s*[.\-/년]\s*\d{1,2}\s*[.월]?)\s*(?:~|-|–|—|부터|to)\s*((?:19|20)\d{2}\s*[.\-/년]\s*\d{1,2}\s*[.월]?|현\s*재|재직(?:\s*중)?|재학(?:\s*중)?|present|current)/i,
  yearOnly: /((?:19|20)\d{2})\s*[.\-/년]?\s*(\d{1,2})?/,
  rrn: /\b\d{6}\s*[-—]\s*[1-4]\d{6}\b/,     // 주민등록번호 — 저장하지 않고 경고만 남긴다
  degree: /(학사|석사|박사|전문학사|고등학교|고졸|B\.?S|M\.?S|Ph\.?D|Bachelor|Master|Doctor)/i,
  eduStatus: /(졸업예정|졸업|재학|수료|중퇴|휴학|편입)/,
};

const LABEL = {
  name: /^(성\s*명|이\s*름|name)\s*[:：|\t]?\s*(.+)$/i,
  birth: /^(생\s*년\s*월\s*일|생년월일|생\s*일|출생|birth\s*(date)?|date\s*of\s*birth|dob)\s*[:：|\t]?\s*(.+)$/i,
  gender: /^(성\s*별|gender|sex)\s*[:：|\t]?\s*(.+)$/i,
  address: /^(주\s*소|거\s*주\s*지|현\s*주\s*소|address)\s*[:：|\t]?\s*(.+)$/i,
  phone: /^(연\s*락\s*처|휴\s*대\s*폰|전\s*화(\s*번\s*호)?|핸드폰|mobile|phone|tel)\s*[:：|\t]?\s*(.+)$/i,
  email: /^(이\s*메\s*일|메\s*일|e-?mail)\s*[:：|\t]?\s*(.+)$/i,
  role: /^(지원\s*(직무|분야|부문|포지션)|희망\s*직무|position|applying\s*for)\s*[:：|\t]?\s*(.+)$/i,
};

const clean = s => String(s || '').replace(/^[\s:：|\t·\-–—]+/, '').replace(/[\s|\t]+$/, '').trim();
const isHeading = l => l.length <= 24 && !/[.。]$/.test(l);

function splitSections(text) {
  const lines = text.split('\n');
  const out = { _head: [] };
  let cur = '_head';
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) { (out[cur] = out[cur] || []).push(''); continue; }
    // "4)경력", "3. 보유기술", "■ 학력" 처럼 앞에 붙는 기호·번호를 걷어낸 뒤 제목인지 본다
    const bare = l
      .replace(/^[■□▶●○◆◇▪•\-–—#*\s]+/, '')
      .replace(/^\d{1,2}\s*[).\]]\s*/, '')
      .replace(/[:：]\s*$/, '').trim();
    const hit = isHeading(bare) && SECTION.find(([, re]) => re.test(bare));
    if (hit) { cur = hit[0]; out[cur] = out[cur] || []; continue; }
    (out[cur] = out[cur] || []).push(l);
  }
  for (const k of Object.keys(out)) out[k] = out[k].join('\n').trim();
  return out;
}

// "회사명 | 팀 | 직책" 처럼 구분자로 나뉜 헤더 줄을 쪼갠다.
const cells = l => l.split(/\s*[|\t·]\s*|\s{3,}/).map(s => s.trim()).filter(Boolean);

function parseRange(line) {
  const m = line.match(RE.range);
  if (m) return { start: m[1], end: m[2], rest: line.replace(m[0], ' ').trim() };
  const y = line.match(/\b((?:19|20)\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.월]?/);
  if (y) return { start: y[0], end: '', rest: line.replace(y[0], ' ').trim() };
  const y2 = line.match(/\b((?:19|20)\d{2})\b/);
  if (y2) return { start: y2[0], end: '', rest: line.replace(y2[0], ' ').trim() };
  return { start: '', end: '', rest: line };
}

const BULLET = /^[-–—•▪○*·‧]\s+/;

// 항목(엔트리) 단위로 자른다. 기간이 있는 줄을 새 항목의 시작으로 본다.
// body 는 글머리표 여부를 함께 들고 간다 — 기간 다음 줄에 회사명을 적는 양식에서
// "글머리표가 붙지 않은 앞쪽 줄"이 회사·직책이기 때문이다.
function chunk(block) {
  const items = [];
  let cur = null;
  for (const raw of String(block || '').split('\n')) {
    const l = raw.trim();
    if (!l) continue;
    const bullet = BULLET.test(l);
    const hasDate = RE.range.test(l) || /\b(19|20)\d{2}\s*[.\-/년]/.test(l);

    // 회사명 다음 줄에 "(2025.06 ~ 재직)" 처럼 기간만 따로 적는 양식이 흔하다.
    // 새 항목을 열지 말고 앞 항목의 머리에 붙인다.
    const dateOnly = /^\(?\s*(?:19|20)\d{2}\s*[.\-/년][^()]{0,24}\)?$/.test(l);
    if (cur && dateOnly && !RE.range.test(cur.head) && !/\b(19|20)\d{2}/.test(cur.head)) {
      cur.head += ' ' + l.replace(/^\(|\)$/g, '');
      continue;
    }

    // 섹션이 글머리표로 바로 시작하는 이력서도 있다. 그때는 머리 없는 항목을 연다.
    if (!cur || (!bullet && hasDate)) {
      cur = { head: bullet ? '' : l, body: [] };
      items.push(cur);
      if (!bullet) continue;
    }
    cur.body.push({ t: l.replace(BULLET, '').trim(), bullet });
  }
  return items.map(i => ({ ...i, lines: i.body.map(b => b.t) }));
}

function parseEducation(block) {
  return chunk(block).map(({ head, lines }) => {
    const { start, end, rest: raw } = parseRange(head);
    // 학점·학위·상태는 따로 뽑아 쓰므로 본문에서 걷어내야 전공에 섞이지 않는다
    const gm = raw.match(/(?:GPA|학점|평점)\s*[:：]?\s*([\d.]+\s*\/\s*[\d.]+|[\d.]+)/i);
    const dm = raw.match(RE.degree), sm = raw.match(RE.eduStatus);
    let rest = raw;
    for (const m of [gm, dm, sm]) if (m) rest = rest.replace(m[0], ' ');
    rest = rest.replace(/\s{2,}/g, '  ').trim();

    const c = cells(rest);
    const school = c.find(x => /(대학교|대학원|대학|고등학교|university|college|institute|school|과학기술원)/i.test(x)) || c[0] || '';
    const major = c.find(x => x !== school && /(학과|전공|공학|학부|major|department)/i.test(x))
      || c.find(x => x !== school) || '';
    return {
      school, major, degree: dm ? dm[1] : '', status: sm ? sm[1] : '',
      start, end, gpa: gm ? gm[1].replace(/\s/g, '') : '', note: lines.join(' '),
    };
  });
}

const TITLE_RE = /(엔지니어|연구원|개발자|매니저|리드|팀장|본부장|실장|이사|상무|전무|부장|차장|과장|대리|주임|선임|책임|수석|사원|인턴|고문|위원|총괄|engineer|developer|researcher|manager|lead|intern|architect|director|consultant)/i;
const TEAM_RE = /(팀|그룹|본부|실|센터|부서|사업부|team|group|division|department)/i;

function parseExperience(block) {
  return chunk(block).map(({ head, body }) => {
    const { start, end, rest } = parseRange(head);
    let c = cells(rest);

    // "2025.04 ~ 현재 (계약직)" 처럼 기간만 한 줄에 적고
    // 회사·직책을 다음 줄들에 쓰는 양식이 흔하다. 글머리표 없는 앞쪽 줄을 끌어온다.
    const firstBullet = body.findIndex(b => b.bullet);
    const preLines = (firstBullet < 0 ? body : body.slice(0, firstBullet)).map(b => b.t);
    // 머리줄에 "(계약직)" 같은 괄호 주석 말고 실질적인 낱말이 하나도 없으면 기간만 적힌 줄이다
    const meaningful = c.filter(x => /[가-힣A-Za-z]{2,}/.test(x) && !/^[(（].*[)）]$/.test(x));
    const headOnlyDate = meaningful.length === 0;
    if (headOnlyDate && preLines.length) c = [...preLines.flatMap(cells), ...c];

    const title = c.find(x => TITLE_RE.test(x)) || '';
    const team = c.find(x => x !== title && TEAM_RE.test(x)) || '';
    const company = c.find(x => x !== title && x !== team && /[가-힣A-Za-z]/.test(x)) || c[0] || '';

    const rest2 = body.filter(b => !(headOnlyDate && preLines.includes(b.t) && !b.bullet));
    const stackLine = rest2.find(b => /^(기술\s*스택|사용\s*기술|스택|stack|tech)\s*[:：]/i.test(b.t));
    return {
      company, team, title, start, end, location: '',
      bullets: rest2.filter(b => b !== stackLine).map(b => b.t),
      stack: stackLine
        ? stackLine.t.split(/[:：]/).slice(1).join(':').split(/[,·、/]/).map(s => s.trim()).filter(Boolean)
        : [],
    };
  });
}

function parseAwards(block) {
  return chunk(block).map(({ head, lines }) => {
    const { start, rest } = parseRange(head);
    const c = cells(rest);
    return { title: c[0] || rest, issuer: c[1] || '', date: start, note: [...c.slice(2), ...lines].join(' ') };
  });
}

function parsePatents(block) {
  return chunk(block).map(({ head, lines }) => {
    const { start, rest } = parseRange(head);
    const num = rest.match(/(?:제?\s*)?(10-\d{4}-\d{7}|10-\d{7}|US\s?\d[\d,]{5,}|\d{2}-\d{4}-\d{7})/i);
    const st = rest.match(/(등록|출원|공개|granted|filed|pending)/i);
    const c = cells(num ? rest.replace(num[0], ' ') : rest);
    return {
      title: c[0] || rest, number: num ? num[1] : '', status: st ? st[1] : '',
      date: start, role: /발명자|주\s*발명|inventor/i.test(rest + lines.join(' ')) ? '발명자' : '',
      note: lines.join(' '),
    };
  });
}

function parseCertificates(block) {
  return chunk(block).map(({ head }) => {
    const { start, rest } = parseRange(head);
    const c = cells(rest);
    return { name: c[0] || rest, issuer: c[1] || '', date: start };
  });
}

function parseLanguages(block) {
  return String(block || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const { start, rest } = parseRange(l);
    const c = cells(rest);
    const rawTest = c.find(x => /(TOEIC|TOEFL|OPIc|IELTS|TEPS|JLPT|HSK|스피킹|Speaking)/i.test(x)) || '';
    const score = (rest.match(/\b(\d{2,4}점?|[A-C]\s?급|IH|AL|IM\d?|N[1-5]|[0-9]\.[05])\b/) || [])[0] || '';
    // "TOEIC 915" 처럼 한 칸에 붙어 오면 점수를 떼어내 시험명만 남긴다
    const test = score ? rawTest.replace(score, '').trim() || rawTest : rawTest;
    const lang = c.find(x => /(영어|일본어|중국어|독일어|프랑스어|한국어|English|Japanese|Chinese)/i.test(x))
      || (/(TOEIC|TOEFL|OPIc|IELTS|TEPS)/i.test(test) ? '영어' : '');
    return { language: lang, test, score, date: start };
  }).filter(x => x.language || x.test);
}

function parseSkills(block) {
  return String(block || '')
    .split(/\n|[,·、]|\s{3,}/)
    .map(s => s.replace(/^[-–—•▪○*\s]+/, '').replace(/^(기술\s*스택|보유\s*기술)\s*[:：]/, '').trim())
    .filter(s => s && s.length <= 40);
}

function parsePublications(block) {
  return chunk(block).map(({ head, lines }) => {
    const { start, rest } = parseRange(head);
    const c = cells(rest);
    return { title: c[0] || rest, venue: c[1] || '', date: start, authors: lines.join(' ') };
  });
}

/** 평문 → 표준 스키마 직전의 느슨한 객체 */
function parseWithRules(text) {
  const S = splitSections(text);
  const head = [S._head, S.personal || ''].join('\n');
  const all = text;
  const warnings = [];
  const out = {};

  // 라벨이 붙은 줄을 먼저 훑는다
  for (const line of head.split('\n')) {
    const l = line.trim();
    if (!l) continue;
    for (const [key, re] of Object.entries(LABEL)) {
      const m = l.match(re);
      if (m && !out[key === 'role' ? 'targetRole' : key]) {
        out[key === 'role' ? 'targetRole' : key] = clean(m[m.length - 1]);
      }
    }
    // 라벨 없이 "… Firmware SW Engineer 지원" 처럼 적는 이력서도 흔하다
    if (!out.targetRole) {
      const m = l.match(/(?:^|[—–\-·|]\s*)([A-Za-z][A-Za-z /&+.-]{4,50}|[가-힣A-Za-z][^\s].{2,30}(?:엔지니어|개발자|연구원))\s*(?:직무|포지션)?\s*지원(?![가-힣])/);
      if (m) out.targetRole = clean(m[1]);
    }
  }

  // 라벨이 없으면 본문 전체에서 형태로 찾는다
  if (!out.email) out.email = (all.match(RE.email) || [])[0] || '';
  if (!out.phone) out.phone = (all.match(RE.phone) || [])[0] || '';
  if (!out.birth) {
    const m = all.match(/(생년월일|생일|출생|birth)[^\n]{0,4}[:：|\t]?\s*([^\n]+)/i);
    if (m) out.birth = clean(m[2]);
  }
  if (!out.gender) {
    const m = all.match(/성\s*별[^\n]{0,4}[:：|\t]?\s*(남성?|여성?)/);
    if (m) out.gender = m[1];
  }
  if (!out.name) {
    // "기술 경력서 김보경" / "김보경 이력서" 처럼 문서 제목에 이름을 붙이는 양식
    const m = head.split('\n').slice(0, 6).map(l => l.trim())
      .map(l => l.match(/^(?:[가-힣]*\s*(?:이력서|경력(?:기술)?서|résumé|resume|cv)\s*[|·\-–—]?\s*)([가-힣]{2,4})$/i)
        || l.match(/^([가-힣]{2,4})\s*[|·\-–—]?\s*(?:이력서|경력(?:기술)?서|résumé|resume|cv)$/i))
      .find(Boolean);
    if (m) out.name = m[1];
  }
  if (!out.name) {
    // 머리 부분에서 사람 이름처럼 생긴 짧은 줄
    for (const line of head.split('\n').slice(0, 12)) {
      const l = line.trim().replace(/^[■□▶●#*\s]+/, '');
      if (/^[가-힣]{2,4}(\s*\(?[A-Za-z .]{2,30}\)?)?$/.test(l) && !/이력서|resume|경력기술서/i.test(l)) {
        out.name = l.replace(/\s*\(.*\)\s*/, '').trim();
        const en = l.match(/\(([A-Za-z .]{2,30})\)/);
        if (en) out.nameEn = en[1].trim();
        break;
      }
    }
  }
  if (!out.address) {
    const m = all.match(/((?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)[^\n]{4,60})/);
    if (m) out.address = clean(m[1]);
  }

  if (RE.rrn.test(all)) {
    warnings.push('원본에 주민등록번호로 보이는 값이 있습니다. 표준 이력서에는 저장하지 않았습니다.');
  }

  const links = [...new Set(all.match(RE.url) || [])].filter(u => !/^https?:\/\/(www\.)?(google|naver|daum)\./.test(u));
  out.links = links.slice(0, 6);

  out.summary = (S.summary || '').split('\n').filter(Boolean).join(' ').slice(0, 600);
  out.military = (S.military || '').split('\n').filter(Boolean).join(' ').slice(0, 120);
  out.education = parseEducation(S.education);
  out.experience = [...parseExperience(S.experience), ...parseExperience(S.projects)];
  out.awards = parseAwards(S.awards);
  out.patents = parsePatents(S.patents);
  out.certificates = parseCertificates(S.certificates);
  out.languages = parseLanguages(S.languages);
  out.skills = parseSkills(S.skills);
  out.publications = parsePublications(S.publications);

  out._meta = { engine: 'rules', warnings };
  return out;
}

module.exports = { parseWithRules, splitSections };
