import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';

const REGULAR = [
  '/usr/share/fonts/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
].find(candidate => fs.existsSync(candidate));
const BOLD = [
  '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
].find(candidate => fs.existsSync(candidate));
const C = {
  navy: '#15213d', blue: '#2f6fed', text: '#26324a',
  muted: '#68758d', line: '#ccd6e5', pale: '#f6f8fc',
  white: '#ffffff', green: '#147a4b'
};

export function textValue(input, fallback = '—') {
  const result = String(input ?? '').trim();
  return result || fallback;
}

export function moneyValue(input) {
  const number = Number(input);
  if (!Number.isFinite(number)) return '—';
  return `${new Intl.NumberFormat('ro-RO', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  }).format(number)} lei`;
}

export function dateValue(input = new Date()) {
  const date = input instanceof Date ? input : new Date(input);
  return new Intl.DateTimeFormat('ro-RO', {
    timeZone: 'Europe/Bucharest'
  }).format(date);
}

function header(doc, title, number, registrationNumber, issuedAt, isTest) {
  const leftX = 52;
  const leftWidth = 238;
  const rightX = 310;
  const rightWidth = 235;

  doc.rect(0, 0, doc.page.width, 104).fill(C.navy);

  doc.font('Bold').fontSize(16.5).fillColor(C.white)
    .text('MOZY SERVICE', leftX, 24, {
      width: leftWidth,
      lineBreak: false
    })
    .text('ELECTRONICE', leftX, 45, {
      width: leftWidth,
      lineBreak: false
    });

  doc.font('Bold').fontSize(8.1).fillColor(C.white)
    .text('MOZY SERVICE ELECTRONICE SRL', rightX, 16, {
      width: rightWidth, align: 'right', lineBreak: false
    });
  doc.font('Regular').fontSize(7.7).fillColor(C.white)
    .text('CUI 42090319 · J23/69/2020', rightX, 29, {
      width: rightWidth, align: 'right', lineBreak: false
    })
    .text('Sediu social: Str. Diamantului nr. 134-140 N,', rightX, 42, {
      width: rightWidth, align: 'right', lineBreak: false
    })
    .text('Bragadiru, Ilfov', rightX, 54, {
      width: rightWidth, align: 'right', lineBreak: false
    })
    .text('0799 269 589 · reparatii-televizoare.com', rightX, 69, {
      width: rightWidth, align: 'right', lineBreak: false
    });

  if (isTest) {
    doc.font('Bold').fontSize(8.5).fillColor('#ffd2d2')
      .text('DOCUMENT DE TEST – FĂRĂ VALOARE', 52, 88, {
        width: 493, align: 'center', lineBreak: false
      });
  }
  doc.font('Bold').fontSize(22).fillColor(C.navy)
    .text(title, 52, 126, { width: 493, align: 'center' });
  doc.font('Regular').fontSize(9.5).fillColor(C.muted)
    .text(
      `Nr. înregistrare ${textValue(registrationNumber)} / ${dateValue(issuedAt)} · Cod ${textValue(number)}`,
      52, 160, {
        width: 493, align: 'center'
      }
    );
  doc.y = 194;
}

function footer(doc) {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const previousBottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 15;
    doc.moveTo(52, 796).lineTo(543, 796).strokeColor(C.line).stroke();
    doc.font('Regular').fontSize(7.5).fillColor(C.muted)
      .text('Document generat electronic de Mozy CRM. Conținutul tehnic reflectă constatările înscrise de operator.', 52, 803, {
        width: 410
      })
      .text(`Pagina ${index + 1} / ${range.count}`, 462, 803, {
        width: 81, align: 'right'
      });
    doc.page.margins.bottom = previousBottomMargin;
  }
}

export function ensurePdfSpace(doc, height) {
  if (doc.y + height < 780) return;
  doc.addPage();
  doc.y = 55;
}

export function pdfSection(doc, title, rows) {
  ensurePdfSpace(doc, 42);
  doc.moveDown(0.7);
  doc.font('Bold').fontSize(12.5).fillColor(C.navy)
    .text(title, 52, doc.y, { width: 493 });
  doc.moveDown(0.35);

  for (const [label, rawValue] of rows) {
    const value = textValue(rawValue);
    doc.font('Regular').fontSize(9.2);
    const valueHeight = doc.heightOfString(value, { width: 341, lineGap: 1 });
    const height = Math.max(29, valueHeight + 14);
    ensurePdfSpace(doc, height + 3);
    const y = doc.y;
    doc.rect(52, y, 493, height).fillAndStroke(C.pale, C.line);
    doc.rect(190, y, 355, height).fillAndStroke(C.white, C.line);
    doc.font('Regular').fontSize(8.7).fillColor(C.muted)
      .text(label, 60, y + 8, { width: 122 });
    doc.font('Regular').fontSize(9.2).fillColor(C.text)
      .text(value, 198, y + 8, { width: 339, lineGap: 1 });
    doc.y = y + height;
  }
}

export function createBrandedPdf({
  outputPath, title, number, registrationNumber, issuedAt,
  isTest = false, info = {}, render
}) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 50, right: 52, bottom: 55, left: 52 },
      bufferPages: true,
      info: {
        Title: `${title} ${number || ''}`.trim(),
        Author: 'Mozy Service Electronice',
        ...info
      }
    });
    const stream = fs.createWriteStream(outputPath);
    stream.on('finish', () => resolve(outputPath));
    stream.on('error', reject);
    doc.on('error', reject);
    doc.pipe(stream);
    doc.registerFont('Regular', REGULAR);
    doc.registerFont('Bold', BOLD);
    header(doc, title, number, registrationNumber, issuedAt, isTest);
    render(doc);
    footer(doc);
    doc.end();
  });
}

export const documentPdfColors = C;
