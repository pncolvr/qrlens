import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { prepareZXingModule } from '../src/vendor/zxing-wasm-3.1.5/reader/index.js';
import { decodePixels } from '../src/js/scan-worker.js';
import { scanInWorkers } from '../src/js/worker-scan.js';
import { findQRRegions } from '../src/js/locator.js';
import { blankImage, paintQR } from './helpers/images.mjs';
import { createCanvas } from './helpers/canvas.mjs';
import { createQRScanner } from '../src/js/scan.js';

prepareZXingModule({ overrides: { wasmBinary: readFileSync(new URL('../src/vendor/zxing-wasm-3.1.5/reader/zxing_reader.wasm', import.meta.url)) } });
const jsQR = createRequire(import.meta.url)('../src/vendor/jsQR-1.4.0.min.js');
function setup(source, decode = input => decodePixels(input, jsQR), locate = findQRRegions){
  const canvas = createCanvas(), context = canvas.getContext('2d'), reports = [], statuses = [], calls = [];
  const scan = options => scanInWorkers(source, { collectAll: true, analysisMaxSize: 1280, maxSizes: [1280, 2560], onDiagnostics: report => reports.push(structuredClone({ ...report, image: undefined })), onStatus: key => statuses.push(key), isCurrent: () => true, ...options }, {
    locate, createCanvas, workers: { async run(input, { signal }){ calls.push(input); if (signal?.aborted) return null; return decode(input, signal); } },
    pixelsFor(image, rect, maxSize){
      const scale = Math.min(1, maxSize / Math.max(rect.width, rect.height));
      canvas.width = Math.max(1, Math.round(rect.width * scale)); canvas.height = Math.max(1, Math.round(rect.height * scale));
      context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
      return context.getImageData(0, 0, canvas.width, canvas.height);
    }
  });
  return { scan, reports, statuses, calls };
}

test('QR-only WASM decoding recovers multiple rotated and inverted symbols without full-page JS retries', async () => {
  const image = paintQR(paintQR(blankImage(800, 500), { left: 30, top: 40, scale: 4 }), { left: 500, top: 220, scale: 4, name: 'text', angle: Math.PI / 2, inverted: true });
  const env = setup(image), report = await env.scan();
  assert.deepEqual(report.results.map(r => r.text).sort(), ['Hello from QR scanner', 'https://example.com/qr?test=1'].sort());
  assert.ok(report.results.every(r => r.location.length === 4));
  assert.equal(report.unreadable.length, 0);
  assert.equal(report.attempts[0].scope, 'region');
  assert.ok(report.attempts.some(attempt => attempt.scope === 'whole' && attempt.passes.some(pass => pass.engine === 'zxing')));
  assert.ok(!report.attempts.some(attempt => attempt.scope === 'whole' && attempt.passes.some(pass => pass.engine === 'jsqr')));
});

test('located but invalid symbols never become successful results, and later crop recovery clears unreadable status', async () => {
  const image = paintQR(blankImage(400, 300), { left: 100, top: 100, scale: 3 });
  const points = [{ x: 110, y: 110 }, { x: 185, y: 110 }, { x: 185, y: 185 }, { x: 110, y: 185 }];
  const miss = { passes: [], codes: [] };
  const env = setup(image, input => input.engine === 'zxing' && input.binarizer === undefined ? { passes: [], codes: [{ text: null, unverifiedText: 'partial text', error: 'ChecksumError', points }] } : miss);
  const failed = await env.scan();
  assert.equal(failed.results.length, 0);
  assert.equal(failed.unreadable.length, 1);
  assert.deepEqual(failed.unreadable[0].reasons, ['ChecksumError']);
  assert.ok(failed.attempts.some(attempt => attempt.errors?.includes('ChecksumError')));
  assert.deepEqual(env.reports.at(-1).unreadable[0].reasons, ['ChecksumError']);
  assert.equal(failed.unverified[0].text, 'partial text');
  assert.equal(failed.unverified[0].verified, false);
  assert.equal(failed.unverified[0].error, 'ChecksumError');
  assert.ok(env.calls.length > 1); // Partial text must not stop recovery attempts.
  assert.equal(env.statuses.at(-1), 'image.unreadable');
  const recovered = setup(image, input => input.engine === 'jsqr' ? decodePixels(input, jsQR) : input.binarizer ? miss : { passes: [], codes: [{ text: null, unverifiedText: 'partial text', error: 'ChecksumError', points }] });
  const report = await recovered.scan();
  assert.equal(report.results.length, 1);
  assert.equal(report.unreadable.length, 0);
  assert.equal(report.unverified.length, 0);
});

test('empty checksum failures and other decode errors do not produce unverified text', async () => {
  const points = [{ x: 10, y: 10 }, { x: 40, y: 10 }, { x: 40, y: 40 }, { x: 10, y: 40 }];
  for (const [error, unverifiedText] of [['ChecksumError', ''], ['FormatError', 'partial']]){
    const env = setup(blankImage(100, 100), () => ({ codes: [{ text: null, unverifiedText, error, points }], passes: [] }));
    const report = await env.scan();
    assert.equal(report.results.length, 0);
    assert.equal(report.unverified.length, 0);
  }
});

test('stopping a scan suppresses later diagnostics and results', async () => {
  const abort = new AbortController();
  let reportsAtStop;
  const env = setup(blankImage(100, 100), async () => { reportsAtStop = env.reports.length; abort.abort(); return { passes: [], codes: [] }; });
  assert.equal(await env.scan({ signal: abort.signal }), null);
  assert.equal(env.reports.length, reportsAtStop);
});

test('single-result scans finish from a proposed region without decoding the whole image', async () => {
  const image = paintQR(blankImage(700, 400), { left: 400, top: 200, scale: 3 });
  const env = setup(image), report = await env.scan({ collectAll: false });
  assert.equal(report.results[0].text, 'https://example.com/qr?test=1');
  assert.ok(report.attempts.length);
  assert.ok(report.attempts.every(attempt => attempt.scope === 'region'));
  assert.equal(report.phase, 'complete');
});

test('collect-all scans try proposed regions before searching the whole page for missed QR codes', async () => {
  const image = paintQR(paintQR(blankImage(800, 500), { left: 30, top: 40, scale: 3 }), { left: 500, top: 220, scale: 3, name: 'text' });
  const env = setup(image, undefined, pixels => {
    const located = findQRRegions(pixels);
    return { finders: located.finders, regions: located.regions.slice(0, 1) };
  });
  const report = await env.scan();
  assert.equal(report.results.length, 2);
  const wholeIndex = report.attempts.findIndex(attempt => attempt.scope === 'whole');
  assert.ok(wholeIndex > 0);
  assert.ok(report.attempts.slice(0, wholeIndex).every(attempt => attempt.scope === 'region' && attempt.outcome !== 'pending'));
  assert.ok(env.statuses.includes('image.searchingWhole'));
});

test('failed region attempts retain the full-image fallback', async () => {
  const image = paintQR(blankImage(700, 400), { left: 400, top: 200, scale: 3 });
  const finders = [{ x: 10, y: 10, module: 1 }, { x: 40, y: 10, module: 1 }, { x: 10, y: 40, module: 1 }];
  const env = setup(image, undefined, () => ({ finders, regions: [{ x: 0, y: 0, width: 60, height: 60, finders }] }));
  const report = await env.scan({ collectAll: false });
  assert.equal(report.results.length, 1);
  assert.equal(report.attempts[0].scope, 'region');
  assert.equal(report.attempts.at(-1).scope, 'whole');
  assert.ok(env.statuses.includes('image.fallbackRegions'));
});

test('JS fallback keeps searching after the first code when the primary decoder and locator miss multiple symbols', async () => {
  const image = paintQR(paintQR(blankImage(700, 400), { left: 30, top: 40, scale: 3 }), { left: 450, top: 240, scale: 2, name: 'text' });
  const env = setup(image, input => input.engine === 'jsqr' ? decodePixels(input, jsQR) : { passes: [], codes: [] }, () => ({ finders: [], regions: [] }));
  const report = await env.scan();
  assert.equal(report.results.length, 2);
  assert.ok(report.attempts.some(entry => entry.scope === 'whole'));
  assert.ok(report.attempts.every(entry => entry.scope === 'whole'));
});

test('only three-finder proposals and the whole image reach the decoder', async () => {
  const finders = [{ x: 10, y: 10, module: 1 }, { x: 40, y: 10, module: 1 }, { x: 10, y: 40, module: 1 }];
  const points = [{ x: 100, y: 100 }, { x: 150, y: 100 }, { x: 150, y: 150 }, { x: 100, y: 150 }];
  const env = setup(blankImage(300, 200), input => ({ passes: [], codes: input.engine === 'zxing' ? [{ text: null, unverifiedText: 'partial', error: 'ChecksumError', points }] : [] }), () => ({
    finders,
    regions: [undefined, [], finders.slice(0, 1), finders.slice(0, 2)].map(evidence => ({ x: 0, y: 0, width: 60, height: 60, finders: evidence }))
  }));
  const report = await env.scan();
  assert.equal(report.proposals, 0);
  assert.equal(report.unverified.length, 1);
  assert.ok(report.attempts.every(attempt => attempt.scope === 'whole'));
  for (const attempt of report.attempts) assert.deepEqual(attempt.rect, { x: 0, y: 0, width: 300, height: 200 });
});

test('blocked workers preserve the established image scanner', async () => {
  const previous = globalThis.Worker;
  globalThis.Worker = class { constructor(){ throw new Error('Workers blocked'); } };
  try {
    const image = paintQR(blankImage(400, 300), { left: 100, top: 100, scale: 3 });
    const scanner = createQRScanner({ canvas: createCanvas(), createCanvas, decoder: jsQR });
    const report = await scanner.scan(image);
    assert.equal(report.results[0].text, 'https://example.com/qr?test=1');
  } finally {
    if (previous === undefined) delete globalThis.Worker;
    else globalThis.Worker = previous;
  }
});
