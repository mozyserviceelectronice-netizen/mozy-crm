import {
  normalizeWhatsAppNumber
} from './evolution-whatsapp.js';

const teamDefinitions = Object.freeze([
  {
    code: 'andrei',
    name: 'Andrei Mozara',
    usernames: ['andrei', 'andrei mozara'],
    envName: 'TECHNICIAN_TEAM_ANDREI_NUMBERS',
    defaultNumbers: ['0771559501']
  },
  {
    code: 'giani',
    name: 'Giani Oprea',
    usernames: ['giani', 'giani oprea'],
    envName: 'TECHNICIAN_TEAM_GIANI_NUMBERS',
    defaultNumbers: ['0721341491']
  },
  {
    code: 'lucian',
    name: 'Lucian',
    usernames: ['lucian'],
    envName: 'TECHNICIAN_TEAM_LUCIAN_NUMBERS',
    defaultNumbers: ['0765955446', '0775142016']
  }
]);

function normalizedUsername(value) {
  return String(value || '').trim().toLocaleLowerCase('ro-RO');
}

function configuredNumbers(definition) {
  const configured = String(
    process.env[definition.envName] || ''
  )
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  const source = configured.length
    ? configured
    : definition.defaultNumbers;

  return [...new Set(source.map(normalizeWhatsAppNumber))];
}

export function technicianTeam() {
  return teamDefinitions.map(definition => ({
    code: definition.code,
    name: definition.name,
    usernames: [...definition.usernames],
    numbers: configuredNumbers(definition)
  }));
}

export function teamMemberForUsername(username) {
  const normalized = normalizedUsername(username);
  return technicianTeam().find(member =>
    member.usernames.some(
      candidate => normalizedUsername(candidate) === normalized
    )
  ) || null;
}

export function teamMemberForCode(code) {
  const normalized = String(code || '').trim().toLowerCase();
  return technicianTeam().find(
    member => member.code === normalized
  ) || null;
}

export function scheduleRecipients({
  senderUsername,
  selectedMemberCodes = []
}) {
  const team = technicianTeam();
  const sender = teamMemberForUsername(senderUsername);
  const allowedCodes = new Set(team.map(member => member.code));

  let members;
  if (sender) {
    members = team.filter(member => member.code !== sender.code);
  } else {
    const requested = new Set(
      selectedMemberCodes
        .map(value => String(value || '').trim().toLowerCase())
        .filter(value => allowedCodes.has(value))
    );
    members = team.filter(member => requested.has(member.code));
  }

  const seen = new Set();
  const recipients = [];
  for (const member of members) {
    for (const number of member.numbers) {
      if (seen.has(number)) continue;
      seen.add(number);
      recipients.push({
        memberCode: member.code,
        memberName: member.name,
        number
      });
    }
  }

  return { sender, members, recipients };
}

export function maskPhoneNumber(number) {
  const value = String(number || '');
  if (value.length < 7) return '***';

  const local = value.startsWith('40')
    ? `0${value.slice(2)}`
    : value;
  return `${local.slice(0, 4)}***${local.slice(-3)}`;
}

export function teamUserChoices(users) {
  return users.map(user => {
    const member = teamMemberForUsername(user.username);
    return {
      id: Number(user.id),
      username: user.username,
      displayName: member?.name || user.username,
      memberCode: member?.code || null
    };
  });
}
