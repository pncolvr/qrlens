import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createQRScanner } from '../src/js/scan.js';
import { blankImage, paintQR } from './helpers/images.mjs';
import { createCanvas } from './helpers/canvas.mjs';

const jsQR = createRequire(import.meta.url)('../src/vendor/jsQR-1.4.0.min.js');

test('collect-all finds multiple QR payloads and deduplicates repeated content within a page', async () => {
  const image = blankImage(800, 500);
  paintQR(image, { left: 30, top: 40, scale: 3 });
  paintQR(image, { left: 400, top: 50, scale: 3, name: 'text', angle: Math.PI / 2 });
  paintQR(image, { left: 600, top: 340, scale: 3 });
  const scanner = createQRScanner({ canvas: createCanvas(), createCanvas, decoder: jsQR });
  const report = await scanner.scan(image, { collectAll: true });
  assert.deepEqual(report.results.map(result => result.text).sort(), ['Hello from QR scanner', 'https://example.com/qr?test=1'].sort());
  assert.ok(report.results.every(result => result.location.length === 4));
  assert.ok(report.attempts.some(attempt => attempt.scope === 'whole'));
  assert.equal(report.phase, 'complete');
});

test('full-page fallback finds multiple symbols even when the finder proposer misses all of them', async () => {
  const image = paintQR(paintQR(blankImage(700, 400), { left: 30, top: 40, scale: 3 }), { left: 450, top: 240, scale: 2, name: 'text' });
  const scanner = createQRScanner({ canvas: createCanvas(), createCanvas, decoder: jsQR, locate: () => ({ finders: [], regions: [] }) });
  const report = await scanner.scan(image, { collectAll: true });
  assert.equal(report.results.length, 2);
  assert.equal(report.attempts.filter(attempt => attempt.outcome === 'success').length, 2);
  assert.equal(report.attempts.at(-1).outcome, 'miss');
  assert.ok(report.attempts.every(attempt => attempt.scope === 'whole'));
});

test('the JS scanner also excludes regions without a three-finder proposal and never sends tiles', async () => {
  const image = blankImage(300, 200);
  const scanner = createQRScanner({ canvas: createCanvas(), createCanvas, decoder: jsQR, locate: () => ({ finders: [], regions: [{ x: 10, y: 10, width: 60, height: 60, finders: [{ x: 20, y: 20 }, { x: 40, y: 20 }] }] }) });
  const report = await scanner.scan(image, { collectAll: true });
  assert.equal(report.proposals, 0);
  assert.ok(report.attempts.every(attempt => attempt.scope === 'whole'));
});

test('rotation locations map back to original page coordinates before masking', () => {
  const image = blankImage(300, 200), rect = { x: 40, y: 20, width: 120, height: 80 };
  for (const [rotation, corners] of [
    [0, [[10, 5], [30, 5], [30, 25], [10, 25]]],
    [90, [[75, 10], [75, 30], [55, 30], [55, 10]]],
    [180, [[110, 75], [90, 75], [90, 55], [110, 55]]],
    [270, [[5, 110], [5, 90], [25, 90], [25, 110]]]
  ]){
    let calls = 0;
    const scanner = createQRScanner({ canvas: createCanvas(), decoder(){
      if (calls++ !== rotation / 90) return null;
      return { data: 'QR', location: Object.fromEntries(['topLeftCorner', 'topRightCorner', 'bottomRightCorner', 'bottomLeftCorner'].map((key, i) => [key, { x: corners[i][0], y: corners[i][1] }])) };
    } });
    assert.deepEqual(scanner.readRegion(image, rect).sourceLocation, [{ x: 50, y: 25 }, { x: 70, y: 25 }, { x: 70, y: 45 }, { x: 50, y: 45 }]);
  }
});
