import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import { findQRRegions } from '../src/js/locator.js';
import { blankImage, paintQR } from './helpers/images.mjs';
import { createQRScanner, rotateClockwise } from '../src/js/scan.js';

const source = readFileSync(new URL('../src/js/image.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replaceAll('export ', '');
const jsQR = createRequire(import.meta.url)('../src/vendor/jsQR-1.4.0.min.js');

function setup({ width = 4000, height = 2000, decode = () => null, pixels, locate = findQRRegions } = {}){
  function element(){
    const classes = new Set();
    return {
      style: {}, events: {},
      classList: { add: name => classes.add(name), remove: name => classes.delete(name), toggle: (name, add) => add ? classes.add(name) : classes.delete(name), contains: name => classes.has(name) },
      addEventListener(name, callback){ this.events[name] = callback; },
      removeAttribute(name){ delete this[name]; }, focus(){}, setPointerCapture(){}, releasePointerCapture(){},
      getBoundingClientRect: () => ({ left: 10, top: 20, width: 400, height: 200 })
    };
  }
  const stage = element(), preview = element(), selection = element();
  const images = [], draws = [], results = [], statuses = [], ready = [], revoked = [], diagnostics = [];
  const canvas = { getContext: () => context };
  const context = {
    fillRect(){},
    drawImage: (...args) => draws.push(args),
    getImageData(){
      if (!pixels) return { data: new Uint8ClampedArray(4), width: 1, height: 1 };
      const [, sx, sy, sw, sh] = draws.at(-1);
      const data = new Uint8ClampedArray(canvas.width * canvas.height * 4);
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++){
        const sourceOffset = (Math.floor(sy + y * sh / canvas.height) * width + Math.floor(sx + x * sw / canvas.width)) * 4;
        data.set(pixels.subarray(sourceOffset, sourceOffset + 4), (y * canvas.width + x) * 4);
      }
      return { data, width: canvas.width, height: canvas.height };
    }
  };
  let urlCount = 0;
  const browser = {
    findQRRegions: locate, createQRScanner, setTimeout,
    document: { createElement: () => canvas }, window: { jsQR: decode },
    URL: { createObjectURL: () => `blob:${++urlCount}`, revokeObjectURL: url => revoked.push(url) },
    Image: class { constructor(){ this.naturalWidth = width; this.naturalHeight = height; images.push(this); } }
  };
  const createImageScanner = runInNewContext(source + '; createImageScanner;', browser);
  const scanner = createImageScanner({ stage, preview, selection, onResult: text => results.push(text), onStatus: key => statuses.push(key), onReady: value => ready.push(value), onDiagnostics(report){ diagnostics.push(report ? JSON.parse(JSON.stringify({ ...report, image: undefined })) : null); } });
  const pointer = (name, x, y) => stage.events[name]({ clientX: x, clientY: y, pointerId: 1, isPrimary: true, button: 0, preventDefault(){} });
  const key = (key, shiftKey = false) => stage.events.keydown({ key, shiftKey, preventDefault(){} });
  async function load(){ const pending = scanner.load({}); images.at(-1).onload(); await pending; }
  return { scanner, stage, preview, selection, images, draws, results, statuses, ready, revoked, diagnostics, pointer, key, load, canvas };
}

test('image selection maps reverse drags and preview coordinates to original pixels', async () => {
  const env = setup();
  await env.load();
  assert.deepEqual(env.results, []);
  env.pointer('pointerdown', 310, 170);
  env.pointer('pointermove', 110, 70);
  env.pointer('pointerup', 110, 70);
  env.scanner.decode();
  assert.deepEqual(env.draws[0].slice(1), [1000, 500, 2000, 1000, 0, 0, 1280, 640]);
  assert.deepEqual(env.draws[1].slice(1), [1000, 500, 2000, 1000, 0, 0, 2000, 1000]);
  assert.equal(env.statuses.at(-1), 'image.noCode');
  // A failed selection never searches outside its bounds.
  assert.equal(env.draws.every(args => args[1] === 1000 && args[2] === 500), true);
  env.scanner.reset();
  env.scanner.decode();
  assert.deepEqual(env.draws.at(-1).slice(1), [0, 0, 4000, 2000, 0, 0, 2560, 1280]);
});

test('touch selection clamps to the image and restores a previous box after a tap or cancellation', async () => {
  const env = setup();
  await env.load();
  env.pointer('pointerdown', 110, 70);
  env.pointer('pointerup', 900, 900);
  const previous = { ...env.selection.style };
  assert.deepEqual(previous, { left: '25%', top: '25%', width: '75%', height: '75%' });
  env.pointer('pointerdown', 50, 50);
  env.pointer('pointerup', 51, 51);
  assert.deepEqual(env.selection.style, previous);
  env.pointer('pointerdown', 50, 50);
  env.pointer('pointermove', 100, 100);
  env.stage.events.pointercancel();
  assert.deepEqual(env.selection.style, previous);
});

test('keyboard controls resize and move a selection without leaving image bounds', async () => {
  const env = setup();
  await env.load();
  env.key('ArrowLeft', true);
  env.key('ArrowUp', true);
  for (let i = 0; i < 80; i++) { env.key('ArrowRight'); env.key('ArrowDown'); }
  env.scanner.decode();
  const [, x, y, width, height] = env.draws[0];
  assert.ok(x > 0 && y > 0);
  assert.ok(x + width <= 4000 && y + height <= 2000);
  env.scanner.reset();
  assert.equal(env.selection.style.width, '100%');
});

test('canceling or replacing a pending file prevents stale image loads and releases object URLs', async () => {
  const env = setup();
  const first = env.scanner.load({});
  const firstImage = env.images[0];
  const second = env.scanner.load({});
  env.images[1].onload();
  await second;
  firstImage.onload();
  await first;
  assert.equal(env.preview.src, 'blob:2');
  assert.deepEqual(env.revoked, ['blob:1']);
  env.scanner.clear();
  assert.deepEqual(env.revoked, ['blob:1', 'blob:2']);
  assert.equal(env.stage.classList.contains('hidden'), true);
  assert.equal(env.ready.at(-1), false);
  assert.equal(env.canvas.width, 0);
  const canceled = env.scanner.load({});
  env.scanner.clear();
  env.images[2].onload();
  await canceled;
  assert.equal(env.preview.src, undefined);
});

test('invalid image files and decoding failures leave a recoverable selection screen', async () => {
  const env = setup({ decode: () => { throw new Error('decoder failure'); } });
  const pending = env.scanner.load({});
  env.images[0].onerror();
  await pending;
  assert.equal(env.statuses.at(-1), 'image.loadFailed');
  assert.equal(env.ready.at(-1), false);
  await env.load();
  env.scanner.decode();
  assert.equal(env.statuses.at(-1), 'image.decodeFailed');
  assert.equal(env.ready.at(-1), true);
});

test('the real decoder reads the selected QR from a larger image at original resolution', async () => {
  const width = 800, height = 400;
  const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const [name, left] of [['link', 40], ['text', 500]]){
    const [, w, h, ...bits] = readFileSync(new URL(`fixtures/${name}.pbm`, import.meta.url), 'utf8').trim().split(/\s+/);
    for (let y = 0; y < Number(h) * 4; y++) for (let x = 0; x < Number(w) * 4; x++){
      const color = bits[Math.floor(y / 4) * Number(w) + Math.floor(x / 4)] === '1' ? 0 : 255;
      pixels.set([color, color, color, 255], ((y + 40) * width + x + left) * 4);
    }
  }
  const env = setup({ width, height, pixels, decode: jsQR });
  await env.load();
  env.pointer('pointerdown', 10, 20);
  env.pointer('pointerup', 160, 170);
  env.scanner.decode();
  assert.deepEqual(env.results, ['https://example.com/qr?test=1']);
  env.pointer('pointerdown', 250, 20);
  env.pointer('pointerup', 410, 170);
  env.scanner.decode();
  assert.deepEqual(env.results, ['https://example.com/qr?test=1', 'Hello from QR scanner']);
});

test('whole-image scanning decodes a finder-based crop before trying the full image', async () => {
  const image = paintQR(blankImage(800, 600), { left: 570, top: 390 });
  const env = setup({ ...image, pixels: image.data, decode: jsQR });
  await env.load();
  env.pointer('pointerdown', 10, 20);
  env.pointer('pointerup', 30, 40); // Whole-image scanning must ignore this prior selection.
  await env.scanner.decodeWhole();
  assert.deepEqual(env.results, ['https://example.com/qr?test=1']);
  const trace = env.diagnostics.at(-1);
  assert.ok(trace.finders.length >= 3);
  assert.equal(trace.phase, 'complete');
  assert.equal(trace.attempts.length, 1);
  assert.equal(trace.attempts[0].scope, 'region');
  assert.equal(trace.attempts[0].outcome, 'success');
  assert.ok(trace.attempts[0].rect.width < image.width / 3);
  assert.equal(env.selection.style.width, '100%');
});

test('failed or throwing candidate decodes fall back to the full image and preserve the attempt trace', async () => {
  const image = paintQR(blankImage(800, 600));
  for (const throws of [false, true]){
    const env = setup({ ...image, pixels: image.data, decode(data, width, height){
      if (width === image.width && height === image.height) return { data: 'full-image result' };
      if (throws) throw new Error('crop decode error');
      return null;
    } });
    await env.load();
    await env.scanner.decodeWhole();
    assert.deepEqual(env.results, ['full-image result']);
    const trace = env.diagnostics.at(-1);
    assert.equal(trace.attempts[0].outcome, throws ? 'error' : 'miss');
    assert.equal(trace.attempts.at(-1).scope, 'whole');
    assert.equal(trace.attempts.at(-1).outcome, 'success');
    assert.ok(env.statuses.includes('image.fallbackRegions'));
    // The analysis pixels are reused for the first full-image decode.
    assert.equal(env.draws.filter(draw => draw[3] === image.width && draw[4] === image.height).length, 1);
  }
});

test('missing finder proposals or an analysis error still allow a real full-image decode', async () => {
  const image = paintQR(blankImage(500, 400), { left: 250, top: 150 });
  for (const locate of [() => ({ finders: [], regions: [] }), () => { throw new Error('analysis error'); }]){
    const env = setup({ ...image, pixels: image.data, decode: jsQR, locate });
    await env.load();
    await env.scanner.decodeWhole();
    assert.deepEqual(env.results, ['https://example.com/qr?test=1']);
    assert.equal(env.diagnostics.at(-1).attempts[0].scope, 'whole');
    assert.ok(env.statuses.includes('image.fallbackNoRegions'));
  }
});

test('a blank whole-image scan reports the failed full-image attempts and permits retry', async () => {
  const image = blankImage(1600, 900);
  const env = setup({ ...image, pixels: image.data, decode: jsQR });
  await env.load();
  await env.scanner.decodeWhole();
  assert.deepEqual(env.results, []);
  assert.equal(env.statuses.at(-1), 'image.noCodeWhole');
  assert.equal(env.ready.at(-1), true);
  const attempt = env.diagnostics.at(-1).attempts.at(-1);
  assert.equal(attempt.scope, 'whole');
  assert.deepEqual(attempt.passes.map(pass => [pass.width, pass.height, pass.rotation]), [
    [1280, 720, 0], [720, 1280, 90], [1280, 720, 180], [720, 1280, 270],
    [1600, 900, 0], [900, 1600, 90], [1600, 900, 180], [900, 1600, 270]
  ]);
  assert.equal(attempt.outcome, 'miss');
});

test('canceling or replacing an image while whole-image scanning yields prevents stale work', async () => {
  const image = paintQR(blankImage(800, 600));
  for (const replace of [false, true]){
    const env = setup({ ...image, pixels: image.data, decode: jsQR });
    await env.load();
    const pending = env.scanner.decodeWhole();
    assert.equal(env.ready.at(-1), false);
    if (replace) await env.load();
    else env.scanner.clear();
    await pending;
    assert.deepEqual(env.results, []);
    assert.equal(env.draws.length, 0);
    assert.equal(env.ready.at(-1), replace);
  }
});

test('quarter-turns preserve RGBA pixels, rectangular dimensions, and the original buffer', () => {
  const original = { width: 3, height: 2, data: new Uint8ClampedArray([1, 2, 3, 10, 2, 4, 6, 20, 3, 6, 9, 30, 4, 8, 12, 40, 5, 10, 15, 50, 6, 12, 18, 60]) };
  let pixels = original;
  for (const [width, height, order] of [
    [2, 3, [4, 1, 5, 2, 6, 3]],
    [3, 2, [6, 5, 4, 3, 2, 1]],
    [2, 3, [3, 6, 2, 5, 1, 4]],
    [3, 2, [1, 2, 3, 4, 5, 6]]
  ]){
    pixels = rotateClockwise(pixels);
    assert.equal(pixels.width, width);
    assert.equal(pixels.height, height);
    const expected = order.flatMap(value => [value, value * 2, value * 3, value * 10]);
    assert.deepEqual(Array.from(pixels.data), expected);
  }
  assert.deepEqual(Array.from(original.data), Array.from(pixels.data));
  assert.notEqual(original.data.buffer, pixels.data.buffer);
});

function markCorners(image, rect){
  for (const [x, y, value] of [
    [rect.x, rect.y, 20], [rect.x + rect.width - 1, rect.y, 60],
    [rect.x, rect.y + rect.height - 1, 100], [rect.x + rect.width - 1, rect.y + rect.height - 1, 140]
  ]) image.data.set([value, value, value, 255], (y * image.width + x) * 4);
}

test('candidate crops try all four orientations and stop at the first real QR decode', async () => {
  const rect = { x: 30, y: 10, width: 110, height: 90 };
  for (const [rotation, corner] of [[0, 20], [90, 100], [180, 140], [270, 60]]){
    const image = paintQR(blankImage(180, 120), { scale: 2, left: 50, top: 20 });
    markCorners(image, rect);
    const env = setup({ ...image, pixels: image.data, locate: () => ({ finders: [], regions: [rect] }), decode(data, width, height){
      // Gate on orientation so this exercises retries even though jsQR usually handles rotation itself.
      return data[0] === corner ? jsQR(data, width, height) : null;
    } });
    await env.load();
    await env.scanner.decodeWhole();
    assert.deepEqual(env.results, ['https://example.com/qr?test=1']);
    const trace = env.diagnostics.at(-1);
    assert.equal(trace.attempts.length, 1);
    assert.equal(trace.attempts[0].scope, 'region');
    assert.deepEqual(trace.attempts[0].passes.map(pass => pass.rotation), [0, 90, 180, 270].filter(value => value <= rotation));
    assert.equal(trace.attempts[0].passes.at(-1).outcome, 'success');
  }
});

test('manual selection also reaches 270 degrees after earlier rotations fail', async () => {
  const image = paintQR(blankImage(180, 120), { scale: 2, left: 50, top: 20 });
  markCorners(image, { x: 0, y: 0, width: image.width, height: image.height });
  const sizes = [];
  const env = setup({ ...image, pixels: image.data, decode(data, width, height){
    sizes.push([width, height]);
    return data[0] === 60 ? jsQR(data, width, height) : null;
  } });
  await env.load();
  env.scanner.decode();
  assert.deepEqual(env.results, ['https://example.com/qr?test=1']);
  assert.deepEqual(sizes, [[180, 120], [120, 180], [180, 120], [120, 180]]);
  assert.equal(env.draws.length, 1);
});

test('a decoder error at one orientation does not prevent recovery at the next orientation', async () => {
  const image = paintQR(blankImage(180, 120), { scale: 2, left: 50, top: 20 });
  markCorners(image, { x: 0, y: 0, width: image.width, height: image.height });
  const env = setup({ ...image, pixels: image.data, locate: () => ({ finders: [], regions: [] }), decode(data, width, height){
    if (data[0] === 20) throw new Error('first rotation failed');
    return jsQR(data, width, height);
  } });
  await env.load();
  await env.scanner.decodeWhole();
  assert.deepEqual(env.results, ['https://example.com/qr?test=1']);
  const passes = env.diagnostics.at(-1).attempts[0].passes;
  assert.deepEqual(passes.map(pass => [pass.rotation, pass.outcome]), [[0, 'error'], [90, 'success']]);
});
