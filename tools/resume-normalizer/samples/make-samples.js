// 테스트용 가상 이력서 3종을 서로 다른 양식/형식으로 만든다.
// 실제 지원자 자료가 아니라 전부 지어낸 내용이다.
const fs = require('fs');
const path = require('path');
const HERE = __dirname;

// 1) 라벨형 텍스트 이력서
const txt = `이력서

성명: 한지우 (Han Jiwoo)
생년월일: 1994년 3월 12일
성별: 여
주소: 경기도 성남시 분당구 판교로 234, 302동 1101호
연락처: 010.2345.6789
이메일: Jiwoo.Han@Example.com
지원 직무: SoC Design Verification Engineer
GitHub: https://github.com/jiwoo-han

■ 학력사항
2019.03 ~ 2021.02   한국과학기술원 전기및전자공학부 석사 졸업  GPA 4.1/4.3
   - 저전력 SoC 검증 방법론 연구실
2015.03 ~ 2019.02   부산대학교 전자공학과 학사 졸업  학점: 3.87/4.5

■ 경력사항
2021.03 ~ 현재  (주)엘디반도체 | SoC검증팀 | 선임연구원
 - 5nm 모바일 AP 서브시스템 UVM 테스트벤치 설계 및 구축
 - 기능 커버리지 92% 달성, 회귀 시험 자동화로 검증 주기 3일 → 8시간 단축
 - 사내 검증 가이드라인 문서화 및 신입 3명 온보딩 담당
 기술 스택: SystemVerilog, UVM, Python, Verdi, VCS

2019.07 ~ 2021.02  케이엠테크 | 디지털설계팀 | 연구원
 - 영상처리 IP 블록 RTL 검증 및 어써션 작성
 기술 스택: SystemVerilog, Verilog, Perl

■ 수상내역
2020.11  대한전자공학회 학술대회 우수논문상 | 대한전자공학회
2018.10  전국 대학생 반도체 설계 경진대회 장려상 | 산업통상자원부

■ 특허
2022.05  저전력 벡터 연산 장치의 검증 방법 및 장치 | 10-2022-0061234 | 출원 | 공동발명자
2023.09  SoC 회귀 검증 자동화 시스템 | 10-2023-0118877 | 등록

■ 자격사항
2018.08  정보처리기사 | 한국산업인력공단

■ 어학
2023.05  TOEIC 915
2022.11  OPIc IH

■ 기술 스택
SystemVerilog, UVM, Verilog, Python, Perl, VCS, Verdi, Git, Jenkins
`;
fs.writeFileSync(path.join(HERE, 'sample-1-label.txt'), txt);

// 2) 표로 짠 워드 이력서
async function makeDocx() {
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, WidthType } = require('docx');
  const cell = (t, b) => new TableCell({
    width: { size: b ? 22 : 78, type: WidthType.PERCENTAGE },
    children: [new Paragraph({ children: [new TextRun({ text: t, bold: !!b })] })],
  });
  const row = (k, v) => new TableRow({ children: [cell(k, true), cell(v)] });
  const h = t => new Paragraph({ text: t, heading: HeadingLevel.HEADING_2 });
  const p = t => new Paragraph({ children: [new TextRun(t)] });

  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: '이 력 서', heading: HeadingLevel.HEADING_1 }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            row('이름', '문서현 (Moon Seohyun)'),
            row('생년월일', '1990-08-24'),
            row('성별', '남'),
            row('주소', '서울특별시 강남구 테헤란로 501'),
            row('휴대폰', '+82 10 8765 4321'),
            row('E-mail', 'seohyun.moon@example.org'),
            row('희망 직무', 'Vector Database Engineer'),
          ],
        }),
        h('요약'),
        p('분산 스토리지와 검색 엔진을 8년간 개발했습니다. 대용량 인덱스의 지연 시간을 줄이는 일을 주로 해왔고, 최근에는 벡터 검색 인덱스에 집중하고 있습니다.'),
        h('Education'),
        p('2013.03 - 2015.02\t포항공과대학교\t컴퓨터공학과\t석사\t졸업'),
        p('2009.03 - 2013.02\t충남대학교\t컴퓨터공학과\t학사\t졸업'),
        h('Work Experience'),
        p('2018.01 - 현재\t제이케이클라우드\t검색플랫폼팀\t테크리드'),
        p('- 자체 벡터 검색 엔진 설계 및 개발, HNSW 인덱스 빌드 시간 40% 단축'),
        p('- 일 12억 건 질의를 처리하는 검색 클러스터 운영, p99 지연 45ms 유지'),
        p('- 팀 6명 리드 및 채용 면접 진행'),
        p('사용 기술: C++, Rust, Go, Kubernetes, FAISS'),
        p('2015.03 - 2017.12\t한빛데이터\t스토리지개발팀\t연구원'),
        p('- 분산 파일 시스템의 메타데이터 서버 개발'),
        p('사용 기술: C, Python, Ceph'),
        h('Awards'),
        p('2021.06\t사내 기술상 대상\t제이케이클라우드'),
        h('Patents'),
        p('2020.02\t근사 최근접 탐색을 위한 인덱스 구축 방법\t10-2020-0019988\t등록\t발명자'),
        h('Languages'),
        p('2024.01\tTOEIC Speaking\t180'),
        h('Skills'),
        p('C++, Rust, Go, Python, Kubernetes, gRPC, FAISS, PostgreSQL'),
      ],
    }],
  });
  fs.writeFileSync(path.join(HERE, 'sample-2-table.docx'), await Packer.toBuffer(doc));
}

// 3) 2단 편집 + 서술형 PDF 이력서 (가장 까다로운 형태)
const html3 = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
@page{size:A4;margin:18mm}
body{font-family:'Malgun Gothic','Noto Sans CJK KR',sans-serif;font-size:10.5pt;line-height:1.6;color:#222}
h1{font-size:20pt;margin:0 0 2mm}
.two{display:flex;gap:10mm;margin-top:6mm}
.side{width:52mm;font-size:9pt;color:#444}
.main{flex:1}
h2{font-size:11pt;border-bottom:1px solid #999;margin:6mm 0 2mm;padding-bottom:1mm}
p{margin:0 0 2mm}
.side p{margin:0 0 1.5mm}
</style></head><body>
<h1>서다인</h1>
<div>Seo Dain — Firmware Software Engineer 지원</div>
<div class="two">
  <div class="side">
    <p><b>생일</b><br>1988. 12. 3.</p>
    <p><b>성별</b><br>여</p>
    <p><b>사는 곳</b><br>대전광역시 유성구 대학로 99</p>
    <p><b>전화</b><br>010-3456-7890</p>
    <p><b>메일</b><br>dain.seo@example.net</p>
    <p><b>링크</b><br>https://github.com/dain-seo</p>
    <p><b>다루는 것</b><br>C, C++, Zephyr, FreeRTOS, ARM Cortex-M, CAN, I2C</p>
  </div>
  <div class="main">
    <h2>소개</h2>
    <p>임베디드 펌웨어를 11년간 개발했습니다. 메모리가 빠듯한 환경에서 성능을 끌어내는 일을 좋아하고,
    부트로더부터 드라이버까지 아래쪽 계층을 두루 다뤄왔습니다.</p>

    <h2>경력</h2>
    <p>2016. 4. ~ 현재 &nbsp; 아이엠모빌리티 · 제어SW팀 · 책임연구원</p>
    <p>- 차량용 ECU 부트로더 재작성, 부팅 시간 1.8초에서 0.6초로 단축</p>
    <p>- Zephyr 기반 센서 노드 펌웨어 개발 및 양산 적용 (누적 40만 대)</p>
    <p>- ISO 26262 ASIL-B 대응 코드 리뷰 프로세스 도입</p>
    <p>2013. 2. ~ 2016. 3. &nbsp; 나노일렉트로닉스 · 펌웨어팀 · 선임연구원</p>
    <p>- 산업용 계측기 펌웨어 유지보수 및 CAN 통신 스택 포팅</p>

    <h2>학력</h2>
    <p>2011. 3. ~ 2013. 2. &nbsp; 충북대학교 전자공학과 석사 졸업</p>
    <p>2007. 3. ~ 2011. 2. &nbsp; 충북대학교 전자공학과 학사 졸업</p>

    <h2>수상</h2>
    <p>2019. 11. &nbsp; 대한민국 엔지니어상 (신진) · 과학기술정보통신부</p>

    <h2>특허</h2>
    <p>2018. 7. &nbsp; 차량용 제어기의 부팅 시간 단축 방법 · 10-2018-0079123 · 등록 · 발명자</p>

    <h2>어학</h2>
    <p>2022. 9. &nbsp; TOEIC 845</p>
  </div>
</div>
</body></html>`;

async function makePdf() {
  const { htmlToPdf, close } = require('../src/pdf');
  await htmlToPdf(html3, path.join(HERE, 'sample-3-twocol.pdf'));
  await close();
}

(async () => {
  await makeDocx();
  await makePdf();
  console.log('샘플 3종 생성 완료:', fs.readdirSync(HERE).filter(f => f.startsWith('sample')).join(', '));
})();
