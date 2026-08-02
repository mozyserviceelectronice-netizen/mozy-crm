import fs from 'node:fs/promises';

const evolutionBaseUrl = String(
  process.env.EVOLUTION_API_URL || 'http://evolution_api:8080'
).replace(/\/+$/, '');

const evolutionInstance = String(
  process.env.EVOLUTION_INSTANCE || 'mozy'
).trim();

function apiKey() {
  const value = String(process.env.EVOLUTION_API_KEY || '').trim();

  if (!value) {
    throw new Error('EVOLUTION_API_KEY nu este configurată.');
  }

  return value;
}

export function normalizeWhatsAppNumber(input) {
  const original = String(input || '')
    .trim()
    .toLowerCase();

  if (/^120363\d{10,}@g\.us$/.test(original)) {
    return original;
  }

  let digits = original.replace(/\D/g, '');

  if (
    digits.startsWith('120363') &&
    digits.length > 15
  ) {
    return `${digits}@g.us`;
  }

  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  if (digits.startsWith('0')) {
    digits = `40${digits.slice(1)}`;
  }

  if (!/^\d{8,15}$/.test(digits)) {
    throw new Error('Numărul de telefon nu este valid pentru WhatsApp.');
  }

  return digits;
}

function messageId(payload) {
  return String(
    payload?.key?.id ||
      payload?.message?.key?.id ||
      payload?.data?.key?.id ||
      ''
  ).slice(0, 200) || null;
}

async function evolutionRequest(endpoint, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);

  try {
    const response = await fetch(
      `${evolutionBaseUrl}${endpoint}`,
      {
        method: 'POST',
        headers: {
          apikey: apiKey(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      }
    );

    if (!response.ok) {
      throw new Error(`Evolution API a răspuns HTTP ${response.status}.`);
    }

    const raw = await response.text();
    let payload = {};

    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new Error('Evolution API a returnat un răspuns nevalid.');
      }
    }

    return {
      messageId: messageId(payload)
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Evolution API nu a răspuns în 25 de secunde.');
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendWhatsAppText({ number, text }) {
  const message = String(text || '').trim();

  if (!message || message.length > 4096) {
    throw new Error('Mesajul WhatsApp nu este valid.');
  }

  return evolutionRequest(
    `/message/sendText/${encodeURIComponent(evolutionInstance)}`,
    {
      number: normalizeWhatsAppNumber(number),
      text: message
    }
  );
}

export async function sendWhatsAppPdf({
  number,
  filePath,
  fileName,
  caption
}) {
  const pdf = await fs.readFile(filePath);

  if (!pdf.length || pdf.length > 16 * 1024 * 1024) {
    throw new Error('PDF-ul depășește dimensiunea permisă pentru expediere.');
  }

  return evolutionRequest(
    `/message/sendMedia/${encodeURIComponent(evolutionInstance)}`,
    {
      number: normalizeWhatsAppNumber(number),
      mediatype: 'document',
      mimetype: 'application/pdf',
      media: pdf.toString('base64'),
      fileName: String(fileName || 'fisa-receptie.pdf'),
      caption: String(caption || '').slice(0, 1024)
    }
  );
}

export async function sendWhatsAppMedia({
  number,
  bytes,
  mimetype,
  mediaType,
  fileName,
  caption
}) {
  const buffer = Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes || '');

  const allowedMediaTypes = new Set([
    'image',
    'video',
    'audio',
    'document'
  ]);

  const type = String(mediaType || '').trim();
  const mime = String(mimetype || '')
    .split(';')[0]
    .trim()
    .toLowerCase();

  if (!allowedMediaTypes.has(type)) {
    throw new Error('Tipul media WhatsApp nu este valid.');
  }

  if (!mime || mime.length > 150) {
    throw new Error('Tipul MIME al fișierului nu este valid.');
  }

  if (!buffer.length || buffer.length > 50 * 1024 * 1024) {
    throw new Error(
      'Fișierul trebuie să aibă cel mult 50 MB.'
    );
  }

  return evolutionRequest(
    `/message/sendMedia/${encodeURIComponent(evolutionInstance)}`,
    {
      number: normalizeWhatsAppNumber(number),
      mediatype: type,
      mimetype: mime,
      media: buffer.toString('base64'),
      fileName: String(fileName || 'atasament')
        .slice(0, 180),
      caption: String(caption || '').slice(0, 1024)
    }
  );
}


export async function getWhatsAppGroupInfo(groupJid) {
  const jid = String(groupJid || '')
    .trim()
    .toLowerCase();

  if (!/^120363\d{10,}@g\.us$/.test(jid)) {
    throw new Error('JID-ul grupului WhatsApp nu este valid.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    15_000
  );

  try {
    const endpoint = [
      evolutionBaseUrl,
      '/group/findGroupInfos/',
      encodeURIComponent(evolutionInstance),
      '?groupJid=',
      encodeURIComponent(jid)
    ].join('');

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        apikey: apiKey(),
        Accept: 'application/json'
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(
        `Evolution API a răspuns HTTP ${response.status} pentru grup.`
      );
    }

    const payload = await response.json();

    const group =
      payload?.group ??
      payload?.data ??
      payload;

    const subject = String(
      group?.subject ??
      group?.name ??
      ''
    ).trim();

    if (!subject) {
      throw new Error(
        'Evolution API nu a returnat numele grupului.'
      );
    }

    return {
      jid,
      subject: subject.slice(0, 255)
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(
        'Evolution API nu a răspuns la interogarea grupului.'
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
