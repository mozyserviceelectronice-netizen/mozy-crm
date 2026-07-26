import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';

test('Sharp procesează PNG și JPEG după actualizare', async () => {
  const source = await sharp({
    create: {
      width: 32,
      height: 24,
      channels: 3,
      background: '#336699'
    }
  }).png().toBuffer();

  const output = await sharp(source)
    .rotate()
    .resize({ width: 16 })
    .jpeg({ quality: 80 })
    .toBuffer();

  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, 'jpeg');
  assert.equal(metadata.width, 16);
  assert.ok(metadata.height > 0);
});
