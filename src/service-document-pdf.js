import {
  createBrandedPdf, pdfSection, moneyValue
} from './document-pdf-engine.js';

function deviz(doc, d, totals) {
  pdfSection(doc, '1. Beneficiar', [
    ['Nume / denumire', d.beneficiar],
    ['Telefon', d.telefon],
    ['Adresă', d.adresa],
    ['CUI / CNP (opțional)', d.identificator_beneficiar]
  ]);
  pdfSection(doc, '2. Echipament', [
    ['Echipament', d.echipament],
    ['Marcă', d.marca],
    ['Model', d.model],
    ['Serie', d.serie],
    ['Defect reclamat', d.defect_reclamat]
  ]);
  pdfSection(doc, '3. Evaluarea lucrării', [
    ['Diagnostic', d.diagnostic],
    ['Operațiuni propuse', d.operatiuni],
    ['Piese / materiale', d.piese],
    ['Manoperă', d.manopera_descriere],
    ['Termen estimat', d.termen_executie],
    ['Valabilitate deviz', d.valabilitate]
  ]);
  pdfSection(doc, '4. Valori', [
    ['Cost piese', moneyValue(d.cost_piese)],
    ['Cost manoperă', moneyValue(d.cost_manopera)],
    ['Alte costuri', moneyValue(d.alte_costuri)],
    ['Total fără TVA', moneyValue(totals.total_fara_tva)],
    ['TVA', totals.cota_tva > 0
      ? `${totals.cota_tva}% · ${moneyValue(totals.valoare_tva)}`
      : 'Nu se aplică'],
    ['TOTAL', moneyValue(totals.total_cu_tva)]
  ]);
  pdfSection(doc, '5. Mențiuni', [
    ['Observații', d.observatii],
    ['Condiții / alte mențiuni', d.alte_mentiuni],
    ['Operator', d.operator]
  ]);
  operatorSignature(doc, d);
}

function constatare(doc, d) {
  pdfSection(doc, '1. Beneficiar', [
    ['Nume / denumire', d.beneficiar],
    ['Telefon', d.telefon],
    ['Adresă', d.adresa],
    ['Destinația documentului', d.destinatie]
  ]);
  pdfSection(doc, '2. Identificarea echipamentului', [
    ['Echipament', d.echipament],
    ['Marcă', d.marca],
    ['Model', d.model],
    ['Serie', d.serie]
  ]);
  pdfSection(doc, '3. Examinare tehnică', [
    ['Defect reclamat', d.defect],
    ['Stare la examinare', d.stare_examinare],
    ['Constatări tehnice', d.constatari],
    ['Cauză probabilă', d.cauza_probabila],
    ['Metodă / verificări', d.verificari]
  ]);
  pdfSection(doc, '4. Concluzie', [
    ['Recomandare', d.recomandare],
    ['Concluzie tehnică', d.concluzie],
    ['Limitări / observații', d.observatii],
    ['Operator', d.operator]
  ]);
  operatorSignature(doc, d);
}

function operatorSignature(doc, d) {
  pdfSection(doc, 'Semnătura operatorului', [
    ['Operator', d.operator],
    ['Data semnării', d.semnat_la
      ? new Intl.DateTimeFormat('ro-RO', {
          dateStyle: 'medium', timeStyle: 'short',
          timeZone: 'Europe/Bucharest'
        }).format(new Date(d.semnat_la))
      : 'Document nesemnat']
  ]);
  if (d.semnatura_path) {
    try {
      doc.image(d.semnatura_path, 335, doc.y + 5, {
        fit: [190, 70], align: 'center', valign: 'center'
      });
      doc.y += 80;
    } catch {
      doc.font('Regular').fontSize(8).text(
        'Imaginea semnăturii nu a putut fi încărcată.', 335, doc.y + 8
      );
      doc.y += 35;
    }
  }
}

export function generateServiceDocumentPdf(document, outputPath) {
  const isDeviz = document.tip_document === 'deviz';
  return createBrandedPdf({
    outputPath,
    title: isDeviz ? 'DEVIZ DE SERVICE' : 'CONSTATARE TEHNICĂ',
    number: document.numar_document,
    registrationNumber: document.numar_inregistrare,
    issuedAt: document.created_at,
    isTest: document.este_test === true,
    info: {
      Subject: isDeviz
        ? 'Deviz pentru reparație'
        : 'Constatare tehnică'
    },
    render(doc) {
      if (isDeviz) {
        deviz(doc, document.date_document, document);
      } else {
        constatare(doc, document.date_document);
      }
    }
  });
}
