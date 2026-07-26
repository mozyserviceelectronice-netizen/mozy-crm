import bcrypt from 'bcryptjs';

if (!process.stdin.isTTY) {
  console.error('Rulează scriptul într-un terminal interactiv.');
  process.exit(1);
}

process.stdout.write('Parola CRM: ');
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding('utf8');

let password = '';

process.stdin.on('data', async (char) => {
  if (char === '\u0003') process.exit(130);

  if (char === '\r' || char === '\n') {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write('\n');

    if (password.length < 12) {
      console.error('Parola trebuie să aibă minimum 12 caractere.');
      process.exit(1);
    }

    console.log(await bcrypt.hash(password, 12));
    return;
  }

  if (char === '\u007f') {
    password = password.slice(0, -1);
    return;
  }

  password += char;
});
