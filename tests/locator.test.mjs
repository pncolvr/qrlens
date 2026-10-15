import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { findQRRegions } from '../src/js/locator.js';
import { blankImage, paintQR, cropImage } from './helpers/images.mjs';

const jsQR = createRequire(import.meta.url)('../src/vendor/jsQR-1.4.0.min.js');

test('finder proposals isolate a small off-center QR and preserve a decodable margin', () => {
  const image = paintQR(blankImage(1200, 800), { left: 890, top: 540, scale: 3 });
  const { finders, regions } = findQRRegions(image);
  assert.ok(finders.length >= 3);
  assert.ok(regions.length > 0 && regions.length <= 6);
  assert.ok(regions[0].width * regions[0].height < image.width * image.height / 10);
  const crop = cropImage(image, regions[0]);
  assert.equal(jsQR(crop.data, crop.width, crop.height)?.data, 'https://example.com/qr?test=1');
});

test('rotated and inverted QR codes produce verified crop proposals', () => {
  for (const angle of [Math.PI / 2, Math.PI / 5, Math.PI / 4]) for (const inverted of [false, true]){
    const image = paintQR(blankImage(), { angle, inverted, scale: 5 });
    const { regions } = findQRRegions(image);
    const decoded = regions.map(rect => {
      const crop = cropImage(image, rect);
      return jsQR(crop.data, crop.width, crop.height)?.data;
    });
    assert.ok(decoded.includes('https://example.com/qr?test=1'), `angle=${angle}, inverted=${inverted}`);
  }
});

test('two QR codes yield separate proposals rather than one combined region', () => {
  const image = paintQR(paintQR(blankImage(900, 450), { left: 30, top: 40 }), { name: 'text', left: 600, top: 230 });
  const { regions } = findQRRegions(image);
  const decoded = regions.map(rect => {
    const crop = cropImage(image, rect);
    return jsQR(crop.data, crop.width, crop.height)?.data;
  });
  assert.ok(decoded.includes('https://example.com/qr?test=1'));
  assert.ok(decoded.includes('Hello from QR scanner'));
});

test('blank images and dense checkerboards do not become QR regions', () => {
  const image = blankImage(350, 250);
  assert.deepEqual(findQRRegions(image), { finders: [], regions: [] });
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++){
    const value = (Math.floor(x / 3) + Math.floor(y / 3)) % 2 ? 0 : 255;
    image.data.set([value, value, value, 255], (y * image.width + x) * 4);
  }
  assert.equal(findQRRegions(image).regions.length, 0);
});

test('three collinear finder patterns are rejected by the geometry check', () => {
  const image = blankImage(400, 150), module = 4;
  for (const left of [40, 160, 280]) for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++){
    const black = x === 0 || y === 0 || x === 6 || y === 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4);
    if (!black) continue;
    for (let dy = 0; dy < module; dy++) for (let dx = 0; dx < module; dx++) image.data.set([0, 0, 0, 255], ((40 + y * module + dy) * image.width + left + x * module + dx) * 4);
  }
  const located = findQRRegions(image);
  assert.ok(located.finders.length >= 3);
  assert.equal(located.regions.length, 0);
});
