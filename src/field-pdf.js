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
const margin = 46;
const pageWidth = 595.28;
const pageHeight = 841.89;
const contentWidth = pageWidth - margin * 2;

const operationLabels = {
  ridicare: 'PROCES-VERBAL DE PRELUARE',
  predare_reparat: 'PROCES-VERBAL DE PREDARE - ECHIPAMENT REPARAT',
  predare_nereparat:
    'PROCES-VERBAL DE PREDARE - ECHIPAMENT NEREPARAT'
};

const testLabels = {
  functional: 'Probat în prezența clientului - funcțional',
  nereparat: 'Probat în prezența clientului - nereparat',
  refuz_client: 'Clientul a refuzat proba',
  imposibil: 'Proba nu a fost posibilă'
};

function value(input, fallback = '-') {
  const result = String(input ?? '').trim();
  return result || fallback;
}

function dateRo(input, withTime = true) {
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

function money(input) {
  if (input === null || input === undefined || input === '') {
    return '-';
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

function ensureSpace(doc, height) {
  if (doc.y + height > pageHeight - 72) {
    doc.addPage();
  }
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
  const labelWidth = 142;

  for (const [label, raw] of rows) {
    const text = value(raw);
    const textWidth = contentWidth - labelWidth - 12;
    const height = Math.max(
      14,
      doc
        .font('Regular')
        .fontSize(9.3)
        .heightOfString(text, { width: textWidth })
    ) + 8;
    ensureSpace(doc, height);
    const y = doc.y;

    doc
      .font('Bold')
      .fontSize(8.3)
      .fillColor('#526173')
      .text(label.toUpperCase(), margin, y, {
        width: labelWidth
      });
    doc
      .font('Regular')
      .fontSize(9.3)
      .fillColor('#172033')
      .text(text, margin + labelWidth + 12, y, {
        width: textWidth
      });
    doc.y = y + height;
  }
}

function legalSection(doc, title, version, hash, body) {
  sectionTitle(doc, title);
  doc
    .font('Regular')
    .fontSize(7.7)
    .fillColor('#172033')
    .text(value(body), margin, doc.y, {
      width: contentWidth,
      align: 'justify',
      lineGap: 1.5
    });
  doc.moveDown(0.8);
}

function declaration(field) {
  if (field.tip_operatiune === 'ridicare') {
    return (
      'Clientul confirmă predarea către Mozy Service Electronice a ' +
      'echipamentului și accesoriilor menționate în prezentul proces-verbal, ' +
      'în vederea transportului, diagnosticării și/sau reparării în atelier. ' +
      'Echipamentul a fost ridicat de echipa de teren, nu a fost adus de ' +
      'client la sediu.'
    );
  }

  const testText =
    testLabels[field.rezultat_proba] ||
    'Situația probei este consemnată în document.';

  if (field.tip_operatiune === 'predare_reparat') {
    return (
      'Clientul confirmă că a primit echipamentul și accesoriile menționate, ' +
      'că echipamentul i-a fost prezentat pentru probă și că rezultatul ' +
      `consemnat al probei a fost: ${testText}. ` +
      'Prin semnare, clientul confirmă predarea materială și exactitatea ' +
      'informațiilor din prezentul proces-verbal.'
    );
  }

  if (field.tip_operatiune === 'predare_nereparat') {
    return (
      'Clientul confirmă că a primit echipamentul și accesoriile menționate, ' +
      'nereparate, în aceeași stare consemnată la predare, fără remedierea defectului ' +
      `reclamat. Situația probei a fost: ${testText}. ` +
      'Prin semnare, clientul confirmă predarea materială și exactitatea ' +
      'informațiilor din prezentul proces-verbal.'
    );
  }

  return (
    'Clientul confirmă că a primit echipamentul și accesoriile menționate, ' +
    `iar situația probei a fost: ${testText}. ` +
    'Prin semnare, clientul confirmă predarea materială și exactitatea ' +
    'informațiilor consemnate în prezentul proces-verbal.'
  );
}

function decoratePage(doc, field, pageNumber) {
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
      { width: 370, lineBreak: false }
    )
    .text(
      `Pagina ${pageNumber}`,
      pageWidth - margin - 100,
      pageHeight - 58,
      { width: 100, align: 'right', lineBreak: false }
    )
    .restore();

  if (field.este_test) {
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

export async function generateFieldPdf(field, outputPath) {
  if (!operationLabels[field?.tip_operatiune]) {
    throw new Error('Tipul procesului-verbal nu este valid.');
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
      margins: {
        top: 47,
        right: margin,
        bottom: 62,
        left: margin
      },
      info: {
        Title: `${operationLabels[field.tip_operatiune]} ${value(
          field.numar_interventie
        )}`,
        Author: 'Mozy Service Electronice SRL',
        Subject: 'Proces-verbal semnat electronic'
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
      decoratePage(doc, field, pageNumber);
    };
    doc.on('pageAdded', addDecoration);
    addDecoration();

    doc
      .font('Bold')
      .fontSize(17)
      .fillColor('#172033')
      .text(operationLabels[field.tip_operatiune], margin, 56, {
        width: contentWidth,
        align: 'center'
      });
    doc
      .font('Regular')
      .fontSize(10)
      .fillColor('#526173')
      .text(value(field.numar_interventie), {
        align: 'center'
      });
    doc.moveDown(1.1);

    sectionTitle(doc, 'Date generale');
    detailRows(doc, [
      ['Data și ora', dateRo(field.created_at)],
      ['Tehnician', field.tehnician_cod],
      ['Client', field.nume || 'Client fără nume'],
      ['Telefon', field.telefon],
      ['Adresă', field.adresa_interventie],
      ['Echipament', equipmentName(field)],
      ['Serie', field.serie],
      [
        'Preț estimat reparație',
        money(field.pret_estimat_reparatie)
      ],
      ['Fișă atelier', field.numar_receptie]
    ]);

    sectionTitle(doc, 'Situația echipamentului');
    detailRows(doc, [
      ['Defect reclamat', field.defect_reclamat],
      ['Constatare tehnician', field.constatare_tehnician],
      ['Intervenție efectuată', field.interventie_efectuata],
      [
        'Accesorii',
        field.are_accesorii
          ? field.accesorii || 'Accesorii predate'
          : 'Nu au fost predate accesorii'
      ],
      ...(field.tip_operatiune === 'ridicare'
        ? [
            [
              'Ambalat de client',
              field.ambalat_de_client === true
                ? 'Da'
                : field.ambalat_de_client === false
                  ? 'Nu'
                  : 'Nespecificat'
            ],
            [
              'Starea ambalării',
              field.ambalat_de_client === true
                ? field.stare_ambalaj === 'corespunzator'
                  ? 'Corespunzătoare'
                  : 'Insuficientă'
                : field.ambalat_de_client === false
                  ? 'Nu se aplică'
                  : 'Nespecificat'
            ]
          ]
        : []),
      ['Rezultatul probei', testLabels[field.rezultat_proba]],
      ['Motiv / observații probă', field.motiv_proba],
      ['Preț reparație', money(field.pret_lucrare)],
      ['Metodă plată', field.metoda_plata]
    ]);

    sectionTitle(doc, 'Declarația clientului');
    doc
      .font('Regular')
      .fontSize(9.2)
      .fillColor('#172033')
      .text(declaration(field), margin, doc.y, {
        width: contentWidth,
        align: 'justify',
        lineGap: 2
      });
    doc.moveDown(0.8);

    legalSection(
      doc,
      'Termeni și condiții pentru operațiuni de teren',
      field.termeni_versiune,
      field.termeni_sha256,
      field.termeni_text
    );
    legalSection(
      doc,
      'Informare privind prelucrarea datelor personale',
      field.informare_gdpr_versiune,
      field.informare_gdpr_sha256,
      field.informare_gdpr_text
    );

    sectionTitle(doc, 'Confirmările clientului');
    detailRows(doc, [
      [
        'Proces-verbal confirmat',
        field.pv_confirmat ? 'DA' : 'NU'
      ],
      [
        'Termeni acceptați',
        field.termeni_acceptati ? 'DA' : 'NU'
      ],
      [
        'Informare GDPR confirmată',
        field.informare_gdpr_confirmata ? 'DA' : 'NU'
      ]
    ]);

    ensureSpace(doc, 210);
    sectionTitle(doc, 'Acceptare și semnătură');
    ensureSpace(doc, 177);
    const signatureTop = doc.y + 2;
    doc
      .roundedRect(margin, signatureTop, contentWidth, 145, 7)
      .lineWidth(0.8)
      .strokeColor('#98a2b3')
      .stroke();
    doc.image(
      field.semnatura_path,
      margin + 18,
      signatureTop + 14,
      {
        fit: [contentWidth - 36, 100],
        align: 'center',
        valign: 'center'
      }
    );
    doc
      .font('Regular')
      .fontSize(7.5)
      .fillColor('#667085')
      .text(
        'Semnătura clientului',
        margin + 12,
        signatureTop + 124,
        {
          width: contentWidth - 24,
          align: 'center'
        }
      );
    doc.y = signatureTop + 162;

    sectionTitle(doc, 'Confirmarea semnării');
    detailRows(doc, [
      ['Semnat la', dateRo(field.semnat_la)],
      ['Tip semnătură', 'Semnătură electronică simplă']
    ]);

    doc.end();
  });
}
