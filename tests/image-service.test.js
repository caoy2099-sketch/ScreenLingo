'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ImageDimensionError,
  inspectImageBuffer,
  inspectImageDataUrl
} = require('../src/main/image-service');

function pngHeader(width, height) {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

test('inspectImageBuffer reads dimensions without decoding image pixels', () => {
  assert.deepEqual(inspectImageBuffer(pngHeader(1200, 700)), {
    width: 1200,
    height: 700,
    type: 'png'
  });
});

test('inspectImageBuffer rejects excessive pixel counts and dimensions', () => {
  assert.throws(
    () => inspectImageBuffer(pngHeader(8000, 5000)),
    (error) => error instanceof ImageDimensionError && /3200 万像素/.test(error.message)
  );
  assert.throws(
    () => inspectImageBuffer(pngHeader(40_000, 1)),
    { code: 'IMAGE_DIMENSIONS_INVALID' }
  );
});

test('inspectImageDataUrl rejects malformed image data', () => {
  assert.throws(() => inspectImageDataUrl('not-a-data-url'), ImageDimensionError);
  assert.throws(
    () => inspectImageDataUrl('data:image/png;base64,SGVsbG8='),
    { code: 'IMAGE_DIMENSIONS_INVALID' }
  );
});
