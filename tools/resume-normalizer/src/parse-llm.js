// Claude API 기반 파서 — 자유 양식 이력서를 정확히 읽어내는 쪽.
//
// 도구(tool) 정의를 스키마로 써서 모델이 JSON 구조를 벗어나지 못하게 한다.
// 원문에 없는 값을 지어내지 않는 것이 이 작업에서 가장 중요하므로
// 프롬프트와 스키마 설명 양쪽에서 반복해 못박는다.

const TOOL = {
  name: 'save_resume',
  description: '이력서 원문에서 읽어낸 항목을 표준 구조로 저장한다.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '지원자 이름(한글). 없으면 빈 문자열' },
      nameEn: { type: 'string', description: '영문 이름. 없으면 빈 문자열' },
      birth: { type: 'string', description: '생년월일. 원문 표기 그대로. 주민등록번호는 절대 넣지 말 것' },
      gender: { type: 'string', description: '남 또는 여. 원문에 없으면 빈 문자열(추측 금지)' },
      address: { type: 'string', description: '주소. 원문에 적힌 수준까지만' },
      phone: { type: 'string' },
      email: { type: 'string' },
      links: {
        type: 'array',
        items: {
          type: 'object',
          properties: { label: { type: 'string' }, url: { type: 'string' } },
          required: ['url'],
        },
        description: 'GitHub/LinkedIn/블로그/포트폴리오 URL',
      },
      targetRole: { type: 'string', description: '지원 직무. 명시돼 있을 때만' },
      summary: { type: 'string', description: '자기소개나 요약을 2~3문장으로 압축. 없으면 빈 문자열. 새로 지어내지 말 것' },
      education: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            school: { type: 'string' }, major: { type: 'string' },
            degree: { type: 'string', description: '학사/석사/박사/전문학사/고등학교' },
            status: { type: 'string', description: '졸업/재학/수료/중퇴/졸업예정' },
            start: { type: 'string', description: 'YYYY.MM' }, end: { type: 'string', description: 'YYYY.MM 또는 현재' },
            gpa: { type: 'string' }, note: { type: 'string', description: '연구실, 논문 주제 등' },
          },
          required: ['school'],
        },
      },
      experience: {
        type: 'array',
        description: '경력과 프로젝트. 최신순으로 정렬해서 넣을 것',
        items: {
          type: 'object',
          properties: {
            company: { type: 'string' }, team: { type: 'string' }, title: { type: 'string' },
            start: { type: 'string', description: 'YYYY.MM' },
            end: { type: 'string', description: 'YYYY.MM, 재직 중이면 현재' },
            location: { type: 'string' },
            bullets: { type: 'array', items: { type: 'string' }, description: '한 일과 성과. 원문 문장을 요약해 한 줄씩. 없는 성과를 만들지 말 것' },
            stack: { type: 'array', items: { type: 'string' } },
          },
          required: ['company'],
        },
      },
      awards: {
        type: 'array',
        items: {
          type: 'object',
          properties: { title: { type: 'string' }, issuer: { type: 'string' }, date: { type: 'string' }, note: { type: 'string' } },
          required: ['title'],
        },
      },
      patents: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' }, number: { type: 'string', description: '출원/등록번호' },
            status: { type: 'string', description: '출원/등록/공개' },
            date: { type: 'string' }, role: { type: 'string', description: '발명자/공동발명자' }, note: { type: 'string' },
          },
          required: ['title'],
        },
      },
      certificates: {
        type: 'array',
        items: { type: 'object', properties: { name: { type: 'string' }, issuer: { type: 'string' }, date: { type: 'string' } }, required: ['name'] },
      },
      languages: {
        type: 'array',
        items: { type: 'object', properties: { language: { type: 'string' }, test: { type: 'string' }, score: { type: 'string' }, date: { type: 'string' } } },
      },
      publications: {
        type: 'array',
        items: { type: 'object', properties: { title: { type: 'string' }, venue: { type: 'string' }, date: { type: 'string' }, authors: { type: 'string' } }, required: ['title'] },
      },
      skills: { type: 'array', items: { type: 'string' }, description: '기술 스택 키워드' },
      military: { type: 'string', description: '병역사항. 원문에 있을 때만' },
      notes: { type: 'array', items: { type: 'string' }, description: '읽어내지 못했거나 애매해서 사람이 확인해야 할 지점' },
    },
    required: ['name', 'education', 'experience'],
  },
};

const SYSTEM = `너는 채용 담당자를 돕는 이력서 정규화 도구다. 자유 양식 이력서 원문을 받아 정해진 구조로 옮긴다.

지켜야 할 것:
- 원문에 있는 내용만 옮긴다. 없는 경력, 없는 성과, 없는 수치를 만들어내지 않는다.
- 값이 없으면 빈 문자열이나 빈 배열로 둔다. 추정해서 채우지 않는다.
- 성별과 생년월일은 원문에 명시된 경우에만 넣는다. 이름이나 사진에서 추측하지 않는다.
- 주민등록번호, 계좌번호 같은 민감 식별번호는 어떤 필드에도 넣지 않는다.
- 날짜는 YYYY.MM 으로 통일한다. 재직 중이면 end 를 "현재" 로 둔다.
- 서술형 문장으로 된 경력은 한 줄짜리 항목으로 쪼개되, 원문의 사실관계는 바꾸지 않는다.
- 애매하거나 놓친 부분은 notes 에 적어 사람이 확인하게 한다.`;

async function parseWithLLM(text, opts = {}) {
  const apiKey = opts.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY 가 설정되어 있지 않습니다. ' +
      '키를 넣거나 --engine rules 로 실행하세요.');
  }
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });
  const model = opts.model || process.env.RESUME_MODEL || 'claude-sonnet-5';

  const res = await client.messages.create({
    model,
    max_tokens: 8000,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'save_resume' },
    messages: [{
      role: 'user',
      content: `다음은 지원자가 제출한 자유 양식 이력서에서 뽑아낸 원문이다. 표준 구조로 옮겨라.\n\n<resume>\n${text}\n</resume>`,
    }],
  });

  const use = res.content.find(c => c.type === 'tool_use');
  if (!use) throw new Error('모델이 구조화된 결과를 돌려주지 않았습니다.');

  const out = { ...use.input };
  out._meta = {
    engine: `llm:${model}`,
    warnings: Array.isArray(out.notes) ? out.notes : [],
    usage: res.usage ? { in: res.usage.input_tokens, out: res.usage.output_tokens } : undefined,
  };
  delete out.notes;
  return out;
}

module.exports = { parseWithLLM, TOOL, SYSTEM };
