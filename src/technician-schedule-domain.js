export const travelTypes = Object.freeze({
  reparatie: 'Reparație la domiciliu',
  ridicare: 'Ridicare echipament',
  livrare: 'Livrare echipament'
});

export const statusLabels = Object.freeze({
  programata: 'Programată',
  reparat: 'Reparat',
  nu_a_raspuns: 'Nu a răspuns',
  amanat: 'Amânat',
  nu_s_a_putut_repara: 'Nu s-a putut repara'
});

export const finalStatuses = new Set([
  'reparat',
  'nu_a_raspuns',
  'nu_s_a_putut_repara'
]);

export function text(value) {
  return String(value ?? '').trim();
}

export function nullIfEmpty(value) {
  const normalized = text(value);
  return normalized || null;
}

export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

export function validTime(value) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function bucharestDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bucharest',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map(part => [part.type, part.value])
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export function dateShift(value, days) {
  const parsed = new Date(`${value}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function monthShift(value, months) {
  const parsed = new Date(`${value.slice(0, 7)}-01T00:00:00Z`);
  parsed.setUTCMonth(parsed.getUTCMonth() + months);
  return parsed.toISOString().slice(0, 10);
}

export function monthBounds(value) {
  const start = `${value.slice(0, 7)}-01`;
  return { start, end: monthShift(start, 1) };
}

export function monthLabel(value) {
  const label = new Intl.DateTimeFormat('ro-RO', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(`${value.slice(0, 7)}-01T00:00:00Z`));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function calendarDays(value, counts, today) {
  const first = new Date(`${value.slice(0, 7)}-01T00:00:00Z`);
  const year = first.getUTCFullYear();
  const month = first.getUTCMonth();
  const leading = (first.getUTCDay() + 6) % 7;
  const numberOfDays = new Date(
    Date.UTC(year, month + 1, 0)
  ).getUTCDate();
  const days = Array.from({ length: leading }, () => null);

  for (let day = 1; day <= numberOfDays; day += 1) {
    const date = new Date(Date.UTC(year, month, day))
      .toISOString()
      .slice(0, 10);
    days.push({
      date,
      day,
      count: Number(counts.get(date) || 0),
      selected: date === value,
      today: date === today
    });
  }

  while (days.length % 7) days.push(null);
  return days;
}

function arrayValue(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

export function priceRowsFromBody(body = {}, fallback = []) {
  const amounts = arrayValue(body.pret_valoare);
  const descriptions = arrayValue(body.pret_descriere);
  const length = Math.max(amounts.length, descriptions.length);

  if (!length) {
    const normalizedFallback = fallback.map(row => ({
      amount: text(row.amount ?? row.valoare),
      description: text(row.description ?? row.descriere)
    }));
    return normalizedFallback.length
      ? normalizedFallback
      : [{ amount: '', description: '' }];
  }

  return Array.from({ length }, (_, index) => ({
    amount: text(amounts[index]),
    description: text(descriptions[index])
  }));
}

export function formValues(body = {}, defaults = {}) {
  const hasBodyNoInterval = Object.prototype.hasOwnProperty.call(
    body,
    'fara_interval'
  );
  return {
    whatsapp_draft_id: text(
      body.whatsapp_draft_id ?? defaults.whatsapp_draft_id
    ),
    telefon: text(body.telefon ?? defaults.telefon),
    nume: text(body.nume ?? defaults.nume),
    tehnician_user_id: text(
      body.tehnician_user_id ?? defaults.tehnician_user_id
    ),
    tip_deplasare: text(
      body.tip_deplasare ?? defaults.tip_deplasare
    ),
    marca: text(body.marca ?? defaults.marca),
    model: text(body.model ?? defaults.model),
    defect_reclamat: text(
      body.defect_reclamat ?? defaults.defect_reclamat
    ),
    oras: text(body.oras ?? defaults.oras),
    adresa: text(body.adresa ?? defaults.adresa),
    cost_deplasare: text(
      body.cost_deplasare ?? defaults.cost_deplasare
    ),
    garantie_luni: text(
      body.garantie_luni ?? defaults.garantie_luni
    ),
    data_programare: text(
      body.data_programare ?? defaults.data_programare
    ),
    fara_interval: hasBodyNoInterval
      ? body.fara_interval === '1'
      : Boolean(defaults.fara_interval),
    ora_programare: text(
      body.ora_programare ?? defaults.ora_programare
    ),
    ora_sfarsit: text(
      body.ora_sfarsit ?? defaults.ora_sfarsit
    ),
    observatii: text(body.observatii ?? defaults.observatii),
    priceRows: priceRowsFromBody(
      body,
      defaults.priceRows || []
    )
  };
}

export function validateForm(values) {
  const errors = [];
  if (!values.telefon) errors.push('Telefonul este obligatoriu.');
  if (values.telefon.length > 20) {
    errors.push('Telefonul poate avea cel mult 20 de caractere.');
  }
  if (values.nume.length > 255) {
    errors.push('Numele poate avea cel mult 255 de caractere.');
  }
  if (!travelTypes[values.tip_deplasare]) {
    errors.push('Selectează tipul deplasării.');
  }
  const technicianId = Number(values.tehnician_user_id);
  if (!Number.isInteger(technicianId) || technicianId <= 0) {
    errors.push('Selectează tehnicianul.');
  }
  if (!values.marca) errors.push('Marca TV este obligatorie.');
  if (values.marca.length > 100) {
    errors.push('Marca TV poate avea cel mult 100 de caractere.');
  }
  if (values.model.length > 120) {
    errors.push('Modelul poate avea cel mult 120 de caractere.');
  }
  if (!values.defect_reclamat) {
    errors.push('Defectul reclamat este obligatoriu.');
  }
  if (values.defect_reclamat.length > 3000) {
    errors.push('Defectul reclamat poate avea cel mult 3.000 de caractere.');
  }
  if (!values.oras) errors.push('Orașul/localitatea este obligatorie.');
  if (values.oras.length > 100) {
    errors.push('Orașul/localitatea poate avea cel mult 100 de caractere.');
  }
  if (!values.adresa) errors.push('Adresa este obligatorie.');
  if (values.adresa.length > 2000) {
    errors.push('Adresa poate avea cel mult 2.000 de caractere.');
  }
  if (values.observatii.length > 3000) {
    errors.push('Observațiile pot avea cel mult 3.000 de caractere.');
  }

  const nonEmptyPrices = values.priceRows.filter(
    row => row.amount || row.description
  );
  if (!nonEmptyPrices.length) {
    errors.push('Adaugă cel puțin o variantă de preț.');
  }

  const normalizedPrices = [];
  const duplicateKeys = new Set();
  for (const row of nonEmptyPrices) {
    const amount = Number(row.amount.replace(',', '.'));
    const description = text(row.description);
    if (!row.amount || !Number.isFinite(amount) || amount < 0) {
      errors.push('Fiecare variantă de preț trebuie să aibă o valoare validă.');
      continue;
    }
    if (amount > 999999.99) {
      errors.push('O variantă de preț nu poate depăși 999.999,99 lei.');
      continue;
    }
    if (description.length > 160) {
      errors.push('Descrierea unei variante poate avea cel mult 160 de caractere.');
      continue;
    }

    const key =
      `${amount.toFixed(2)}:${description.toLocaleLowerCase('ro-RO')}`;
    if (duplicateKeys.has(key)) {
      errors.push('Există variante de preț duplicate.');
      continue;
    }
    duplicateKeys.add(key);
    normalizedPrices.push({ amount, description });
  }

  if (
    normalizedPrices.length > 1 &&
    normalizedPrices.some(row => !row.description)
  ) {
    errors.push(
      'Descrierea este obligatorie când există mai multe variante de preț.'
    );
  }
  if (normalizedPrices.length > 20) {
    errors.push('Poți salva cel mult 20 de variante de preț.');
  }

  const cost = values.cost_deplasare
    ? Number(values.cost_deplasare.replace(',', '.'))
    : null;
  if (
    values.cost_deplasare &&
    (!Number.isFinite(cost) || cost < 0 || cost > 999999.99)
  ) {
    errors.push('Costul deplasării trebuie să fie un număr valid.');
  }

  const warranty = Number(values.garantie_luni);
  if (
    !Number.isInteger(warranty) ||
    warranty < 1 ||
    warranty > 60
  ) {
    errors.push('Perioada garanției trebuie să fie între 1 și 60 luni.');
  }
  if (!validDate(values.data_programare)) {
    errors.push('Data programării nu este validă.');
  }

  if (!values.fara_interval) {
    if (!validTime(values.ora_programare)) {
      errors.push('Ora de început a intervalului nu este validă.');
    }
    if (!validTime(values.ora_sfarsit)) {
      errors.push('Ora de sfârșit a intervalului nu este validă.');
    }
    if (
      validTime(values.ora_programare) &&
      validTime(values.ora_sfarsit) &&
      values.ora_sfarsit <= values.ora_programare
    ) {
      errors.push('Ora de sfârșit trebuie să fie după ora de început.');
    }
  }

  return {
    errors: [...new Set(errors)],
    technicianId,
    prices: normalizedPrices,
    primaryPrice: normalizedPrices[0]?.amount ?? null,
    cost,
    warranty,
    startTime: values.fara_interval ? null : values.ora_programare,
    endTime: values.fara_interval ? null : values.ora_sfarsit
  };
}

function compactText(value, maxLength) {
  const normalized = text(value).replace(/\s+/g, ' ');
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function money(value) {
  return new Intl.NumberFormat('ro-RO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(Number(value));
}

function dayLabel(date) {
  const value = new Intl.DateTimeFormat('ro-RO', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(`${date}T00:00:00Z`));
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function sortAppointments(rows) {
  return [...rows].sort((left, right) => {
    if (Boolean(left.fara_interval) !== Boolean(right.fara_interval)) {
      return left.fara_interval ? 1 : -1;
    }
    const startComparison = text(left.ora_programare)
      .localeCompare(text(right.ora_programare));
    if (startComparison) return startComparison;
    return Number(left.id) - Number(right.id);
  });
}

export function formatDailySchedule({
  date,
  appointments,
  crmUrl
}) {
  if (!validDate(date)) {
    throw new Error('Data programului nu este validă.');
  }
  if (!appointments.length) {
    throw new Error('Nu există programări selectate.');
  }

  const groups = new Map();
  for (const appointment of appointments) {
    const technician =
      compactText(appointment.tehnician_display || 'Nealocat', 80);
    if (!groups.has(technician)) groups.set(technician, []);
    groups.get(technician).push(appointment);
  }

  const lines = ['PROGRAM TEHNICIENI', dayLabel(date)];
  for (const [technician, rows] of groups) {
    lines.push('', technician.toLocaleUpperCase('ro-RO'));
    sortAppointments(rows).forEach((row, index) => {
      const start = text(row.ora_programare).slice(0, 5);
      const end = text(row.ora_sfarsit).slice(0, 5);
      const interval = row.fara_interval
        ? 'Fără interval stabilit'
        : `${start}–${end}`;
      lines.push(
        '',
        `${index + 1}. ${interval} — ${travelTypes[row.tip_deplasare] || row.tip_deplasare}`
      );

      const client = compactText(row.nume, 100) || 'Client fără nume';
      lines.push(`Client: ${client}`);
      if (row.telefon) lines.push(`Telefon: ${compactText(row.telefon, 30)}`);
      const address = [row.adresa, row.oras].filter(Boolean).join(', ');
      if (address) lines.push(`Adresă: ${compactText(address, 220)}`);
      const device = [row.marca, row.model, 'TV'].filter(Boolean).join(' ');
      if (device) lines.push(`Aparat: ${compactText(device, 180)}`);
      if (row.defect_reclamat) {
        lines.push(`Defect: ${compactText(row.defect_reclamat, 220)}`);
      }

      const prices = Array.isArray(row.preturi) && row.preturi.length
        ? row.preturi
        : [{
            valoare: row.pret_reparatie,
            descriere: ''
          }];
      lines.push('Prețuri estimate:');
      for (const price of prices) {
        const description = compactText(price.descriere, 160);
        lines.push(
          `- ${money(price.valoare)} lei${description ? ` — ${description}` : ''}`
        );
      }
      if (row.cost_deplasare !== null &&
          row.cost_deplasare !== undefined &&
          Number(row.cost_deplasare) > 0) {
        lines.push(`Cost deplasare: ${money(row.cost_deplasare)} lei`);
      }
      if (row.garantie_luni) {
        lines.push(`Garanție: ${row.garantie_luni} luni`);
      }
      if (row.observatii) {
        lines.push(`Observații: ${compactText(row.observatii, 220)}`);
      }
    });
  }

  lines.push(
    '',
    `Total: ${appointments.length} programări`,
    '',
    'Situația din mesaj este cea din momentul trimiterii.',
    'Programul poate fi modificat pe parcursul zilei.',
    '',
    'Vezi varianta actualizată în CRM:',
    crmUrl
  );

  const message = lines.join('\n');
  if (message.length > 4000) {
    throw new Error(
      'Programul selectat depășește limita unui mesaj WhatsApp. Selectează mai puține programări.'
    );
  }
  return message;
}

export function appointmentPreview(row) {
  const interval = row.fara_interval
    ? 'Fără interval'
    : `${text(row.ora_programare).slice(0, 5)}–${text(row.ora_sfarsit).slice(0, 5)}`;
  return {
    id: Number(row.id),
    technician: row.tehnician_display || 'Nealocat',
    interval,
    type: travelTypes[row.tip_deplasare] || row.tip_deplasare,
    client: text(row.nume) || 'Client fără nume',
    address: [row.adresa, row.oras].filter(Boolean).join(', ')
  };
}
