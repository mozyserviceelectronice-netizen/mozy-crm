const defaultCrmPublicUrl =
  'https://crm.reparatii-televizoare.com';

export function crmPublicUrl() {
  const configured = String(
    process.env.CRM_PUBLIC_URL || defaultCrmPublicUrl
  ).trim();

  let parsed;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error('CRM_PUBLIC_URL nu este un URL valid.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('CRM_PUBLIC_URL trebuie să folosească HTTP sau HTTPS.');
  }

  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString().replace(/\/+$/, '');
}

export function technicianScheduleUrl(date) {
  const url = new URL(
    '/tehnician/programari',
    `${crmPublicUrl()}/`
  );
  url.searchParams.set('data', String(date || ''));
  return url.toString();
}
