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
const margin = 38;
const pageWidth = 595.28;
const pageHeight = 841.89;
const contentWidth = pageWidth - margin * 2;

const titles = {
  predare_reparat:
    'PROCES-VERBAL DE PREDARE CĂTRE CLIENT — ECHIPAMENT REPARAT',
  predare_nereparat:
    'PROCES-VERBAL DE RESTITUIRE CĂTRE CLIENT — ECHIPAMENT NEREPARAT'
};

const testLabels = {
  functional: 'Probat în prezența clientului — funcțional',
  nereparat: 'Probat în prezența clientului — nereparat',
  refuz_client: 'Clientul a refuzat proba',
  imposibil: 'Proba nu a fost posibilă'
};

function value(input, fallback = '—') {
  const result = String(input ?? '').trim();
  return result || fallback;
}

function dateRo(input) {
  if (!input) return '—';
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return value(input);

  return new Intl.DateTimeFormat('ro-RO', {
    timeZone: 'Europe/Bucharest',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

function money(input) {
  if (input === null || input === undefined || input === '') {
    return '—';
  }

  const amount = Number(input);
  return Number.isFinite(amount)
    ? `${amount.toFixed(2)} lei`
    : value(input);
}

function equipmentName(field) {
  return [
    field.tip_echipament === 'Altul'
      ? field.descriere_echipament
      : field.tip_echipament,
    field.marca,
    field.model
  ].filter(Boolean).join(' / ') || 'Echipament neidentificat';
}

function compactText(input, maxLength) {
  const result = value(input);
  return result.length <= maxLength
    ? result
    : `${result.slice(0, maxLength - 1).trim()}…`;
}

function row(doc, label, raw, y, options = {}) {
  const labelWidth = options.labelWidth || 125;
  const height = options.height || 18;

  doc
    .font('Bold')
    .fontSize(7.2)
    .fillColor('#526173')
    .text(label.toUpperCase(), margin, y + 2, {
      width: labelWidth
    });
  doc
    .font('Regular')
    .fontSize(options.fontSize || 8.3)
    .fillColor('#172033')
    .text(value(raw), margin + labelWidth + 8, y + 2, {
      width: contentWidth - labelWidth - 8,
      height: height - 2,
      ellipsis: true
    });

  return y + height;
}

function section(doc, title, y) {
  doc
    .font('Bold')
    .fontSize(9.2)
    .fillColor('#163a63')
    .text(title, margin, y, { width: contentWidth });
  doc
    .moveTo(margin, y + 14)
    .lineTo(pageWidth - margin, y + 14)
    .lineWidth(0.6)
    .strokeColor('#b8c7d9')
    .stroke();
  return y + 20;
}

function clientDeclaration(field) {
  const test =
    testLabels[field.rezultat_proba] ||
    'Rezultatul probei este consemnat în document.';

  if (field.tip_operatiune === 'predare_reparat') {
    return (
      'Clientul confirmă primirea echipamentului și a accesoriilor, precum ' +
      'și rezultatul probei: ' + test + '. Prin semnare confirmă predarea ' +
      'materială și exactitatea informațiilor înscrise.'
    );
  }

  return (
    'Clientul confirmă primirea echipamentului și a accesoriilor, nereparate, ' +
    'fără remedierea defectului reclamat, în starea consemnată la primire, ' +
    'ținând seama de operațiunile necesare diagnosticării. Rezultatul probei: ' +
    test + '.'
  );
}

export async function generateClientDeliveryPdf(field, outputPath) {
  if (!titles[field?.tip_operatiune]) {
    throw new Error('Tipul predării către client nu este valid.');
  }

  if (!field?.semnatura_path) {
    throw new Error('Lipsește semnătura clientului.');
  }

  await Promise.all([
    fsp.access(regularFont),
    fsp.access(boldFont),
    fsp.access(field.semnatura_path)
  ]);
  await fsp.mkdir(path.dirname(outputPath), {
    recursive: true,
    mode: 0o750
  });

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin,
      bufferPages: false,
      autoFirstPage: true,
      info: {
        Title: `${titles[field.tip_operatiune]} ${value(
          field.numar_interventie
        )}`,
        Author: 'Mozy Service Electronice SRL',
        Subject: 'Proces-verbal de predare către client'
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

    doc.rect(0, 0, pageWidth, 6).fill('#163a63');

    if (field.este_test) {
      doc
        .font('Bold')
        .fontSize(9)
        .fillColor('#b42318')
        .text('DOCUMENT DE TEST — FĂRĂ VALOARE', margin, 16, {
          width: contentWidth,
          align: 'center'
        });
    }

    doc
      .font('Bold')
      .fontSize(14)
      .fillColor('#172033')
      .text(titles[field.tip_operatiune], margin, 34, {
        width: contentWidth,
        align: 'center'
      })
      .font('Regular')
      .fontSize(8.5)
      .fillColor('#526173')
      .text(
        `${value(field.numar_interventie)} · ${dateRo(field.semnat_la)}`,
        { align: 'center' }
      );

    let y = 84;
    y = section(doc, 'Părțile și echipamentul predat', y);
    y = row(
      doc,
      'Prestator',
      'MOZY SERVICE ELECTRONICE SRL · CUI 42090319 · 0799 269 589',
      y
    );
    y = row(doc, 'Client', field.nume || 'Client fără nume', y);
    y = row(doc, 'Telefon', field.telefon, y);
    y = row(doc, 'Echipament', equipmentName(field), y);
    y = row(doc, 'Serie', field.serie, y);
    y = row(doc, 'Fișă atelier', field.numar_receptie, y);
    y = row(
      doc,
      'Accesorii',
      field.are_accesorii
        ? field.accesorii || 'Accesorii predate'
        : 'Nu au fost predate accesorii',
      y
    );

    y += 3;
    y = section(doc, 'Rezultatul lucrării și al predării', y);
    y = row(
      doc,
      'Defect reclamat',
      compactText(field.defect_reclamat, 180),
      y,
      { height: 28 }
    );
    y = row(
      doc,
      'Intervenție',
      compactText(field.interventie_efectuata, 180),
      y,
      { height: 28 }
    );
    y = row(
      doc,
      'Rezultatul probei',
      testLabels[field.rezultat_proba],
      y
    );
    y = row(
      doc,
      'Observații probă',
      compactText(field.motiv_proba, 160),
      y,
      { height: 26 }
    );
    y = row(
      doc,
      'Preț reparație',
      money(
        field.pret_lucrare ??
          field.pret_estimat_reparatie
      ),
      y
    );
    y = row(doc, 'Metodă plată', field.metoda_plata, y);

    y += 4;
    y = section(doc, 'Declarația clientului', y);
    doc
      .font('Regular')
      .fontSize(8.1)
      .fillColor('#172033')
      .text(clientDeclaration(field), margin, y, {
        width: contentWidth,
        align: 'justify',
        lineGap: 1.2
      });
    y = doc.y + 8;

    y = section(doc, 'Condiții aplicabile', y);
    doc
      .font('Regular')
      .fontSize(6.65)
      .fillColor('#344054')
      .text(value(field.termeni_text), margin, y, {
        width: contentWidth,
        align: 'justify',
        lineGap: 0.65
      });
    y = doc.y + 8;

    const signatureHeight = 76;
    const signatureTop = Math.min(y, pageHeight - 164);
    doc
      .roundedRect(
        margin,
        signatureTop,
        contentWidth,
        signatureHeight,
        6
      )
      .lineWidth(0.7)
      .strokeColor('#98a2b3')
      .stroke();
    doc.image(
      field.semnatura_path,
      margin + 12,
      signatureTop + 7,
      {
        fit: [contentWidth - 24, 48],
        align: 'center',
        valign: 'center'
      }
    );
    doc
      .font('Regular')
      .fontSize(6.8)
      .fillColor('#667085')
      .text(
        `Semnătura clientului · ${dateRo(field.semnat_la)}`,
        margin + 8,
        signatureTop + 59,
        {
          width: contentWidth - 16,
          align: 'center'
        }
      );

    const footerY = pageHeight - 48;
    doc
      .moveTo(margin, footerY - 7)
      .lineTo(pageWidth - margin, footerY - 7)
      .lineWidth(0.5)
      .strokeColor('#cbd5e1')
      .stroke()
      .font('Regular')
      .fontSize(5.9)
      .fillColor('#667085')
      .text(
        'Mozy Service Electronice SRL · CUI 42090319 · Tel. 0799 269 589',
        margin,
        footerY,
        { width: contentWidth, align: 'center' }
      );

    doc.end();
  });
}
