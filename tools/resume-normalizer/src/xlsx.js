// 최소한의 xlsx 만들기
//
// 엑셀 파일은 XML 몇 장을 담은 ZIP 이다. 표 하나 내보내자고 큰 라이브러리를 붙이기보다
// 필요한 부분만 직접 쓴다. 압축은 환경에 맡긴다 — Node 는 adm-zip, 브라우저는 fflate.
//
// 문자열은 sharedStrings 대신 inlineStr 로 넣는다. 파일이 조금 커지지만 구조가 단순해진다.
const { table } = require('./report');

const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  // 엑셀이 거부하는 제어문자는 털어낸다 (탭·줄바꿈은 남긴다)
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

// 0 → A, 25 → Z, 26 → AA
function colName(n) {
  let s = '';
  for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function sheetXml(head, rows, columns) {
  const cols = columns.map((c, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${c.width || 14}" customWidth="1"/>`).join('');

  const cell = (v, r, i, style) => {
    const ref = `${colName(i)}${r}`;
    if (v === '' || v == null) return '';
    if (columns[i] && columns[i].number && v !== '' && !isNaN(v)) {
      return `<c r="${ref}" s="${style}"><v>${Number(v)}</v></c>`;
    }
    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  };

  const headRow = `<row r="1" ht="22" customHeight="1">` +
    head.map((v, i) => cell(v, 1, i, 1)).join('') + '</row>';
  const bodyRows = rows.map((r, ri) =>
    `<row r="${ri + 2}">` +
    r.map((v, i) => cell(v, ri + 2, i, columns[i] && columns[i].wrap ? 2 : 0)).join('') +
    '</row>').join('');

  const last = `${colName(head.length - 1)}${rows.length + 1}`;
  return XML +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetPr><outlinePr summaryBelow="1"/></sheetPr>` +
    `<dimension ref="A1:${last}"/>` +
    // 제목 줄을 고정해 두면 스크롤해도 어떤 칸인지 보인다
    `<sheetViews><sheetView workbookViewId="0" tabSelected="1">` +
    `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>` +
    `</sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<cols>${cols}</cols>` +
    `<sheetData>${headRow}${bodyRows}</sheetData>` +
    `<autoFilter ref="A1:${last}"/>` +
    `</worksheet>`;
}

const STYLES = XML +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<fonts count="2">` +
  `<font><sz val="10"/><name val="맑은 고딕"/></font>` +
  `<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="맑은 고딕"/></font>` +
  `</fonts>` +
  `<fills count="3"><fill><patternFill patternType="none"/></fill>` +
  `<fill><patternFill patternType="gray125"/></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FF0D1B2A"/><bgColor indexed="64"/></patternFill></fill>` +
  `</fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="3">` +
  `<xf xfId="0" fontId="0" fillId="0" borderId="0" applyAlignment="1"><alignment vertical="top"/></xf>` +
  `<xf xfId="0" fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1" applyAlignment="1">` +
  `<alignment vertical="center"/></xf>` +
  `<xf xfId="0" fontId="0" fillId="0" borderId="0" applyAlignment="1">` +
  `<alignment vertical="top" wrapText="1"/></xf>` +
  `</cellXfs></styleSheet>`;

/** items = [{file, data}] → { '경로': '내용' } */
function xlsxParts(items, sheetName = '지원자') {
  const t = table(items);
  return {
    '[Content_Types].xml': XML +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      `</Types>`,
    '_rels/.rels': XML +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`,
    'xl/workbook.xml': XML +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': XML +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `</Relationships>`,
    'xl/styles.xml': STYLES,
    'xl/worksheets/sheet1.xml': sheetXml(t.head, t.rows, t.columns),
  };
}

/** Node 전용 — 바로 Buffer 로 */
function xlsxBuffer(items, sheetName) {
  const AdmZip = require('adm-zip');
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(xlsxParts(items, sheetName))) {
    zip.addFile(name, Buffer.from(content, 'utf8'));
  }
  return zip.toBuffer();
}

module.exports = { xlsxParts, xlsxBuffer, colName };
