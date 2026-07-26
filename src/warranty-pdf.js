import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';

const FONT_REGULAR = '/usr/share/fonts/dejavu/DejaVuSans.ttf';
const FONT_BOLD = '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf';

const COLORS = {
  navy: '#15213d',
  blue: '#2f6fed',
  text: '#26324a',
  muted: '#68758d',
  line: '#ccd6e5',
  paleBlue: '#edf3ff',
  paleGreen: '#effcf5',
  greenLine: '#9be7ba',
  paleOrange: '#fff8ed',
  orangeLine: '#f5a04a',
  white: '#ffffff'
};

function value(input, fallback = '\u2014') {
  if (input === undefined || input === null) return fallback;
  const result = String(input).trim();
  return result || fallback;
}

function money(input) {
  if (input === undefined || input === null || input === '') return '\u2014';
  const numeric = Number(input);
  if (!Number.isFinite(numeric)) return value(input);
  return new Intl.NumberFormat('ro-RO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(numeric) + ' lei';
}

function dateRo(input) {
  if (!input) return '\u2014';
  const raw = input instanceof Date ? input.toISOString().slice(0, 10) : String(input).slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return value(input);
  return `${match[3]}.${match[2]}.${match[1]}`;
}

function ensureSpace(doc, height, nextPageHeader = false) {
  if (doc.y + height <= doc.page.height - 54) return;
  doc.addPage();
  if (nextPageHeader) drawHeader(doc);
  doc.y = 105;
}

function drawHeader(doc) {
  doc.save();
  doc.rect(0, 0, doc.page.width, 82).fill(COLORS.navy);
  doc.font('Bold').fontSize(17).fillColor(COLORS.white)
    .text('MOZY SERVICE ELECTRONICE', 52, 28, { width: 310 });
  doc.font('Regular').fontSize(9.5).fillColor(COLORS.white)
    .text('Str. George Co\u0219buc nr. 71, Bucure\u0219ti', 350, 20, { width: 195, align: 'right' })
    .text('CUI 42090319 | Tel. 0799 269 589', 350, 35, { width: 195, align: 'right' })
    .text('www.reparatii-televizoare.com', 350, 50, { width: 195, align: 'right' });
  doc.restore();

  if (doc._mozyEsteTest) {
    doc
      .save()
      .font('Bold')
      .fontSize(10)
      .fillColor('#ffcfcc')
      .text(
        'DOCUMENT DE TEST – FĂRĂ VALOARE',
        58,
        66,
        { width: 479, align: 'center' }
      )
      .restore();
  }
}

function sectionTitle(doc, number, title) {
  ensureSpace(doc, 32);
  doc.moveDown(0.65);
  doc.font('Bold').fontSize(13).fillColor(COLORS.navy)
    .text(`${number}. ${title}`, 58, doc.y);
  doc.moveDown(0.45);
}

function fieldTable(doc, rows) {
  const left = 58;
  const width = 479;
  const labelWidth = 125;
  const padding = 8;

  for (const [label, fieldValue] of rows) {
    const textValue = value(fieldValue);
    const contentHeight = doc.font('Regular').fontSize(9.5)
      .heightOfString(textValue, { width: width - labelWidth - padding * 2 });
    const rowHeight = Math.max(27, contentHeight + padding * 2);
    ensureSpace(doc, rowHeight + 4);
    const y = doc.y;

    doc.save();
    doc.rect(left, y, width, rowHeight).fillAndStroke('#f8fafc', COLORS.line);
    doc.rect(left + labelWidth, y, width - labelWidth, rowHeight).fillAndStroke(COLORS.white, COLORS.line);
    doc.font('Regular').fontSize(9).fillColor(COLORS.muted)
      .text(label, left + padding, y + padding, { width: labelWidth - padding * 2 });
    doc.font('Regular').fontSize(9.5).fillColor(COLORS.text)
      .text(textValue, left + labelWidth + padding, y + padding, {
        width: width - labelWidth - padding * 2
      });
    doc.restore();
    doc.y = y + rowHeight;
  }
}

function metaTable(doc, certificate) {
  const x = 58;
  const y = doc.y;
  const widths = [91, 147, 78, 163];
  const rows = [
    ['Num\u0103r certificat', value(certificate.numar_certificat), 'Fi\u0219\u0103 service', `#${value(certificate.fisa_id)}`],
    ['Data emiterii', dateRo(certificate.data_emiterii), 'Operator', value(certificate.operator_username)]
  ];
  const rowHeight = 30;

  rows.forEach((row, rowIndex) => {
    let cellX = x;
    row.forEach((cell, index) => {
      doc.save();
      doc.rect(cellX, y + rowIndex * rowHeight, widths[index], rowHeight)
        .fillAndStroke(COLORS.paleBlue, '#abc4ff');
      doc.font(index % 2 === 0 ? 'Regular' : 'Bold')
        .fontSize(index % 2 === 0 ? 8.5 : 9.2)
        .fillColor(index % 2 === 0 ? COLORS.muted : COLORS.text)
        .text(cell, cellX + 7, y + rowIndex * rowHeight + 9, {
          width: widths[index] - 14
        });
      doc.restore();
      cellX += widths[index];
    });
  });
  doc.y = y + rowHeight * rows.length;
}

function warrantyTable(doc, certificate) {
  const x = 58;
  const y = doc.y;
  const widths = [72, 100, 100, 207];
  const rows = [
    ['Durata', `${certificate.durata_luni} luni`, 'Data \u00eenceperii', dateRo(certificate.data_inceperii)],
    ['Expir\u0103 la', dateRo(certificate.data_expirarii), 'Acoper\u0103', 'lucrarea \u0219i piesele indicate mai sus']
  ];
  const rowHeight = 31;

  rows.forEach((row, rowIndex) => {
    let cellX = x;
    row.forEach((cell, index) => {
      doc.save();
      doc.rect(cellX, y + rowIndex * rowHeight, widths[index], rowHeight)
        .fillAndStroke(COLORS.paleGreen, COLORS.greenLine);
      doc.font(index % 2 === 0 ? 'Bold' : 'Regular').fontSize(9)
        .fillColor(COLORS.text)
        .text(value(cell), cellX + 7, y + rowIndex * rowHeight + 9, {
          width: widths[index] - 14
        });
      doc.restore();
      cellX += widths[index];
    });
  });
  doc.y = y + rowHeight * rows.length;
}

function condition(doc, number, title, body) {
  ensureSpace(doc, 60, true);
  doc.font('Bold').fontSize(10.5).fillColor(COLORS.navy)
    .text(`${number}. ${title}`, 58, doc.y, { width: 479 });
  doc.moveDown(0.25);
  doc.font('Regular').fontSize(9.2).fillColor(COLORS.text)
    .text(body, 58, doc.y, { width: 479, lineGap: 2, align: 'justify' });
  doc.moveDown(0.65);
}

export function generateWarrantyPdf(certificate, outputPath) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 96, right: 58, bottom: 55, left: 58 },
      info: {
        Title: `Certificat de garan\u021bie ${value(certificate.numar_certificat, '')}`,
        Author: 'Mozy Service Electronice',
        Subject: 'Certificat de garan\u021bie pentru repara\u021bie'
      }
    });

    const stream = fs.createWriteStream(outputPath);
    stream.on('finish', () => resolve(outputPath));
    stream.on('error', reject);
    doc.on('error', reject);
    doc.pipe(stream);

    doc.registerFont('Regular', FONT_REGULAR);
    doc.registerFont('Bold', FONT_BOLD);
    doc._mozyEsteTest = certificate.este_test === true;

    drawHeader(doc);
    doc.font('Bold').fontSize(23).fillColor(COLORS.navy)
      .text('CERTIFICAT DE GARAN\u021aIE', 58, 112, { width: 479, align: 'center' });
    doc.font('Regular').fontSize(10).fillColor(COLORS.muted)
      .text('pentru lucrarea de repara\u021bie \u0219i piesele men\u021bionate \u00een prezentul document', 58, 149, {
        width: 479,
        align: 'center'
      });
    doc.y = 178;
    metaTable(doc, certificate);

    sectionTitle(doc, 1, 'Date client');
    fieldTable(doc, [
      ['Nume client', certificate.nume_client],
      ['Telefon', certificate.telefon],
      ['Adres\u0103 / localitate', certificate.adresa_client]
    ]);

    sectionTitle(doc, 2, 'Identificarea echipamentului');
    fieldTable(doc, [
      ['Tip echipament', certificate.tip_echipament],
      ['Marc\u0103', certificate.marca],
      ['Model', certificate.model],
      ['Serie / cod produs', [certificate.serie, certificate.cod_produs].filter(Boolean).join(' / ')]
    ]);

    sectionTitle(doc, 3, 'Lucrarea efectuat\u0103');
    fieldTable(doc, [
      ['Defect reclamat', certificate.defect_reclamat],
      ['Interven\u021bie efectuat\u0103', certificate.interventie_efectuata],
      ['Piese / componente', certificate.piese_componente],
      ['Pre\u021b lucrare', money(certificate.pret_lucrare)]
    ]);

    sectionTitle(doc, 4, 'Garan\u021bia acordat\u0103');
    warrantyTable(doc, certificate);
    doc.moveDown(0.7);

    const noticeY = doc.y;
    const notice = 'Important: Garan\u021bia prive\u0219te exclusiv conformitatea interven\u021biei \u0219i a pieselor men\u021bionate. Ea nu transform\u0103 service-ul \u00een garant al \u00eentregului echipament \u0219i nu restr\u00e2nge drepturile consumatorului prev\u0103zute de lege.';
    const noticeHeight = doc.font('Regular').fontSize(8.7).heightOfString(notice, { width: 451, lineGap: 2 }) + 18;
    doc.rect(58, noticeY, 479, noticeHeight).fillAndStroke(COLORS.paleOrange, COLORS.orangeLine);
    doc.fillColor(COLORS.text).text(notice, 72, noticeY + 9, { width: 451, lineGap: 2 });
    doc.y = noticeY + noticeHeight;

    doc.addPage();
    drawHeader(doc);
    doc.font('Bold').fontSize(20).fillColor(COLORS.navy)
      .text('CONDI\u021aII DE GARAN\u021aIE', 58, 111, { width: 479, align: 'center' });
    doc.y = 158;

    condition(doc, '1.1', 'Obiectul garan\u021biei', 'Garan\u021bia se acord\u0103 pentru interven\u021bia tehnic\u0103 \u0219i piesele sau componentele men\u021bionate \u00een certificat, pe durata \u00eenscris\u0103 \u00een document. Remedierea se efectueaz\u0103 f\u0103r\u0103 costuri atunci c\u00e2nd deficien\u021ba reclamat\u0103 este imputabil\u0103 lucr\u0103rii sau piesei montate de service.');
    condition(doc, '1.2', 'Durata', 'Garan\u021bia \u00eencepe la data emiterii certificatului \u0219i expir\u0103 la data indicat\u0103 pe prima pagin\u0103. Perioada este aleas\u0103 dintre 1, 3, 6, 9 sau 12 luni, \u00een func\u021bie de interven\u021bia realizat\u0103 \u0219i piesele utilizate.');
    condition(doc, '2.1', 'Condi\u021bii de acordare', 'Pentru analizarea unei solicit\u0103ri este necesar ca echipamentul s\u0103 fie prezentat \u00een configura\u021bia \u00een care a fost predat dup\u0103 repara\u021bie, s\u0103 nu fi fost desf\u0103cut sau modificat de alte persoane \u0219i s\u0103 nu prezinte urme de lovire, lichide, supratensiune, incendiu ori utilizare necorespunz\u0103toare.');
    condition(doc, '2.2', 'Verificarea tehnic\u0103', 'Service-ul verific\u0103 dac\u0103 deficien\u021ba reclamat\u0103 are leg\u0103tur\u0103 direct\u0103 cu interven\u021bia sau piesele acoperite. Dac\u0103 se confirm\u0103, remedierea se realizeaz\u0103 \u00een condi\u021biile legii \u0219i ale prezentului certificat.');
    condition(doc, '3.1', 'Excluderi', 'Nu sunt acoperite defectele diferite de cele aferente lucr\u0103rii, consumabilele, uzura normal\u0103, deterior\u0103rile mecanice, infiltra\u021biile, supratensiunile, desc\u0103rc\u0103rile electrice, incendiile, transportul necorespunz\u0103tor, interven\u021biile neautorizate sau utilizarea contrar\u0103 recomand\u0103rilor produc\u0103torului.');
    condition(doc, '3.2', 'Date \u0219i set\u0103ri', 'Service-ul nu r\u0103spunde pentru pierderea set\u0103rilor, conturilor, aplica\u021biilor ori datelor stocate pe echipament, cu excep\u021bia situa\u021biilor \u00een care legea prevede altfel. Clientul este responsabil pentru salvarea acestora atunci c\u00e2nd este posibil.');
    condition(doc, '4.1', 'Solicitarea garan\u021biei', 'Clientul va contacta Mozy Service Electronice la num\u0103rul 0799 269 589 \u0219i va comunica num\u0103rul certificatului, num\u0103rul fi\u0219ei service, simptomele observate \u0219i, dac\u0103 este necesar, fotografii sau \u00eenregistr\u0103ri relevante.');
    condition(doc, '4.2', 'Drepturile consumatorului', 'Prezentul certificat completeaz\u0103 \u0219i nu limiteaz\u0103 drepturile consumatorului prev\u0103zute de legisla\u021bia aplicabil\u0103. Orice clauz\u0103 se interpreteaz\u0103 \u00een conformitate cu dispozi\u021biile legale obligatorii.');

    const legalY = doc.y + 4;
    doc.rect(58, legalY, 479, 52).fillAndStroke(COLORS.paleBlue, '#abc4ff');
    doc.font('Bold').fontSize(9).fillColor(COLORS.navy)
      .text('Not\u0103 legal\u0103', 70, legalY + 9);
    doc.font('Regular').fontSize(8.4).fillColor(COLORS.text)
      .text('Condi\u021biile se aplic\u0103 \u00eempreun\u0103 cu OG nr. 21/1992 privind protec\u021bia consumatorilor \u0219i cu celelalte dispozi\u021bii legale aplicabile.', 70, legalY + 24, { width: 455 });
    doc.end();
  });
}
