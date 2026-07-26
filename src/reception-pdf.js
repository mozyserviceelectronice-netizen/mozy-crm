import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const regularFont = String(
  process.env.PDF_REGULAR_FONT ||
    '/usr/share/fonts/dejavu/DejaVuSans.ttf'
);
const boldFont = String(
  process.env.PDF_BOLD_FONT ||
    '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf'
);
const pageWidth = 595.28;
const pageHeight = 841.89;
const margin = 46;
const contentWidth = pageWidth - margin * 2;

function value(input, fallback = '-') {
  const result = String(input ?? '').trim();
  return result || fallback;
}

function money(input) {
  if (input === null || input === undefined || input === '') {
    return '-';
  }

  const amount = Number(input);
  if (!Number.isFinite(amount)) return value(input);

  return `${new Intl.NumberFormat('ro-RO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount)} lei`;
}

function dateRo(input, withTime = false) {
  if (!input) return '-';
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return value(input);

  return new Intl.DateTimeFormat('ro-RO', {
    timeZone: 'Europe/Bucharest',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(withTime
      ? { hour: '2-digit', minute: '2-digit', hour12: false }
      : {})
  }).format(date);
}

function equipmentName(reception) {
  return [
    reception.tip_echipament === 'Altul'
      ? reception.descriere_echipament
      : reception.tip_echipament,
    reception.marca,
    reception.model
  ].filter(Boolean).join(' / ') || 'Echipament neidentificat';
}

function ensureSpace(doc, height) {
  if (doc.y + height > pageHeight - 72) doc.addPage();
}

function sectionTitle(doc, title) {
  ensureSpace(doc, 34);
  doc
    .font('Bold')
    .fontSize(12)
    .fillColor('#163a63')
    .text(title, margin, doc.y, { width: contentWidth });
  doc.moveDown(0.45);
  doc
    .moveTo(margin, doc.y)
    .lineTo(pageWidth - margin, doc.y)
    .lineWidth(0.7)
    .strokeColor('#b8c7d9')
    .stroke();
  doc.moveDown(0.55);
}

function detailRows(doc, rows) {
  const labelWidth = 132;
  const rowGap = 7;

  for (const [label, raw] of rows) {
    const text = value(raw);
    const valueHeight = doc
      .font('Regular')
      .fontSize(9.3)
      .heightOfString(text, { width: contentWidth - labelWidth - 12 });
    const rowHeight = Math.max(14, valueHeight) + rowGap;
    ensureSpace(doc, rowHeight);
    const y = doc.y;

    doc
      .font('Bold')
      .fontSize(8.5)
      .fillColor('#526173')
      .text(label.toUpperCase(), margin, y, { width: labelWidth });
    doc
      .font('Regular')
      .fontSize(9.3)
      .fillColor('#172033')
      .text(text, margin + labelWidth + 12, y, {
        width: contentWidth - labelWidth - 12
      });
    doc.y = y + rowHeight;
  }
}

function legalText(doc, title, version, hash, text) {
  doc.addPage();
  sectionTitle(doc, title);
  doc
    .font('Regular')
    .fontSize(8.5)
    .fillColor('#1f2937')
    .text(value(text), margin, doc.y, {
      width: contentWidth,
      align: 'justify',
      lineGap: 2
    });
}

function decoratePage(doc, reception, pageNumber) {
  const originalBottomMargin = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc
    .save()
    .rect(0, 0, pageWidth, 6)
    .fill('#163a63')
    .moveTo(margin, pageHeight - 66)
    .lineTo(pageWidth - margin, pageHeight - 66)
    .lineWidth(0.6)
    .strokeColor('#cbd5e1')
    .stroke()
    .font('Regular')
    .fontSize(7.5)
    .fillColor('#667085')
    .text(
      'Mozy Service Electronice SRL | CUI 42090319 | Tel. 0799 269 589',
      margin,
      pageHeight - 58,
      { width: 360, lineBreak: false }
    )
    .text(
      `Pagina ${pageNumber}`,
      pageWidth - margin - 120,
      pageHeight - 58,
      { width: 120, align: 'right', lineBreak: false }
    )
    .restore();

  if (reception.este_test) {
    doc
      .save()
      .font('Bold')
      .fontSize(10)
      .fillColor('#b42318')
      .text(
        'DOCUMENT DE TEST – FĂRĂ VALOARE',
        margin,
        18,
        { width: contentWidth, align: 'center' }
      )
      .restore();
  }

  doc.page.margins.bottom = originalBottomMargin;
  doc.x = margin;
  doc.y = 47;
}

export async function generateReceptionPdf(reception, outputPath) {
  if (!reception?.semnatura_path) {
    throw new Error('Lipsește fișierul semnăturii.');
  }

  await fsp.access(regularFont);
  await fsp.access(boldFont);
  await fsp.access(reception.semnatura_path);
  await fsp.mkdir(path.dirname(outputPath), {
    recursive: true,
    mode: 0o750
  });

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 47, right: margin, bottom: 62, left: margin },
      info: {
        Title: `Fișă de recepție ${value(reception.numar_receptie)}`,
        Author: 'Mozy Service Electronice SRL',
        Subject: 'Fișă de recepție semnată electronic'
      }
    });
    const stream = fs.createWriteStream(outputPath, {
      flags: 'wx',
      mode: 0o600
    });

    stream.once('finish', resolve);
    stream.once('error', reject);
    doc.once('error', reject);
    doc.pipe(stream);
    doc.registerFont('Regular', regularFont);
    doc.registerFont('Bold', boldFont);
    let pageNumber = 0;
    const addDecoration = () => {
      pageNumber += 1;
      decoratePage(doc, reception, pageNumber);
    };
    doc.on('pageAdded', addDecoration);
    addDecoration();

    doc
      .font('Bold')
      .fontSize(19)
      .fillColor('#172033')
      .text('FIȘĂ DE RECEPȚIE ÎN SERVICE', margin, 56, {
        width: contentWidth,
        align: 'center'
      });
    doc
      .font('Regular')
      .fontSize(10)
      .fillColor('#526173')
      .text(value(reception.numar_receptie), { align: 'center' });
    doc.moveDown(1.2);

    sectionTitle(doc, 'Date generale');
    detailRows(doc, [
      ['Data primirii', dateRo(reception.data_primire)],
      ['Client', reception.nume || 'Client'],
      ['Telefon', reception.telefon],
      ['E-mail', reception.email],
      ['Adresă', reception.adresa_client],
      ['Echipament', equipmentName(reception)],
      ['Serie', reception.serie],
      [
        'Preț estimat reparație',
        money(reception.pret_estimat_reparatie)
      ]
    ]);

    sectionTitle(doc, 'Starea și obiectul recepției');
    detailRows(doc, [
      ['Defect reclamat', reception.defect_reclamat],
      ['Stare la primire', reception.stare_la_primire],
      ['Accesorii', reception.are_accesorii
        ? reception.accesorii || 'Accesorii predate'
        : 'Nu au fost predate accesorii'],
      ['Observații', reception.observatii]
    ]);

    legalText(
      doc,
      'Termeni și condiții de service',
      reception.termeni_versiune,
      reception.termeni_sha256,
      reception.termeni_text
    );
    legalText(
      doc,
      'Informare privind prelucrarea datelor personale',
      reception.informare_gdpr_versiune,
      reception.informare_gdpr_sha256,
      reception.informare_gdpr_text
    );

    doc.addPage();
    sectionTitle(doc, 'Acceptări și semnătură');
    detailRows(doc, [
      ['Termeni acceptați', `DA - ${dateRo(reception.termeni_acceptati_la, true)}`],
      ['Informare GDPR confirmată', `DA - ${dateRo(reception.informare_gdpr_confirmata_la, true)}`],
      ['Fișă semnată la', dateRo(reception.semnat_la, true)]
    ]);

    ensureSpace(doc, 165);
    const signatureTop = doc.y + 4;
    doc
      .roundedRect(margin, signatureTop, contentWidth, 145, 7)
      .lineWidth(0.8)
      .strokeColor('#98a2b3')
      .stroke();
    doc.image(reception.semnatura_path, margin + 18, signatureTop + 14, {
      fit: [contentWidth - 36, 100],
      align: 'center',
      valign: 'center'
    });
    doc
      .font('Regular')
      .fontSize(7.5)
      .fillColor('#667085')
      .text('Semnătura clientului', margin + 12, signatureTop + 124, {
        width: contentWidth - 24,
        align: 'center'
      });
    doc.y = signatureTop + 164;

    sectionTitle(doc, 'Confirmarea semnării');
    detailRows(doc, [
      ['Semnat la', dateRo(reception.semnat_la, true)],
      ['Tip semnătură', 'Semnătură electronică simplă']
    ]);
    doc
      .font('Regular')
      .fontSize(7.8)
      .fillColor('#526173')
      .text(
        'Documentul consemnează datele, condițiile și informarea prezentate clientului la momentul semnării.',
        margin,
        doc.y + 4,
        { width: contentWidth, lineGap: 2 }
      );

    doc.end();
  });
}
