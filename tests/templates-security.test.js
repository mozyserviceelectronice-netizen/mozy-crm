import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ejs from 'ejs';

const views = path.resolve('src/views');

function filesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap(entry => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory()
        ? filesIn(target)
        : [target];
    })
    .filter(file => file.endsWith('.ejs'));
}

test('toate șabloanele EJS se compilează', () => {
  for (const file of filesIn(views)) {
    assert.doesNotThrow(() => {
      ejs.compile(fs.readFileSync(file, 'utf8'), {
        filename: file
      });
    }, file);
  }
});

test('șabloanele nu conțin evenimente sau stiluri inline', () => {
  for (const file of filesIn(views)) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(
      source,
      /\son(?:click|change|input|submit|load|error|focus|blur)\s*=/i,
      file
    );
    assert.doesNotMatch(source, /\sstyle\s*=/i, file);
  }
});

test('scripturile și stilurile inline au nonce CSP', () => {
  for (const file of filesIn(views)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const line of source.split('\n')) {
      if (line.includes('<style')) {
        assert.match(
          line,
          /<style nonce="<%=\s*cspNonce\s*%>">/,
          file
        );
      }
      if (line.includes('<script') && !line.includes(' src=')) {
        assert.match(
          line,
          /<script nonce="<%=\s*cspNonce\s*%>">/,
          file
        );
      }
    }
  }
});

test('fiecare document HTML încarcă protecția CSRF centrală', () => {
  for (const file of filesIn(views)) {
    const source = fs.readFileSync(file, 'utf8');
    if (!source.includes('</head>')) continue;
    assert.match(source, /meta name="csrf-token"/, file);
  }

  for (const file of filesIn(views)) {
    const source = fs.readFileSync(file, 'utf8');
    if (!source.includes('</body>')) continue;
    assert.match(
      source,
      /src="\/app\.js(?:\?[^"]+)?"/,
      file
    );
  }
});

test('uploadurile și mentenanța transmit tokenul CSRF', () => {
  for (const file of filesIn(views)) {
    const source = fs.readFileSync(file, 'utf8');
    if (/fetch\([^)]*[\s\S]{0,500}method:\s*'POST'/.test(source)) {
      assert.match(source, /X-CSRF-Token/, file);
    }
  }
});
