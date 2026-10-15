import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../src/js/detection-debug.js', import.meta.url), 'utf8').replaceAll('export ', '');
const languages = Object.fromEntries(['en', 'pt'].map(lang => [lang, JSON.parse(readFileSync(new URL(`../src/i18n/${lang}.json`, import.meta.url), 'utf8'))]));

function setup(){
  const classes = new Set(['hidden']), rects = [], dashes = [];
  const container = { classList: { add: name => classes.add(name), remove: name => classes.delete(name) } };
  const summary = { textContent: '' };
  const list = { children: [], replaceChildren(){ this.children = []; }, append(item){ this.children.push(item); } };
  const context = {
    fillRect(){}, drawImage(){}, createRadialGradient: () => ({ addColorStop(){} }),
    beginPath(){}, arc(){}, stroke(){}, fillText(){},
    strokeRect(...args){ rects.push({ args, color: this.strokeStyle }); }, setLineDash: pattern => dashes.push(pattern)
  };
  const canvas = { getContext: () => context };
  let lang = 'en';
  const t = (key, values = {}) => languages[lang][key].replace(/\{(\w+)\}/g, (_, key) => values[key] ?? key);
  const createDetectionDebug = runInNewContext(source + '; createDetectionDebug;', { document: { createElement: () => ({ textContent: '' }) } });
  const debug = createDetectionDebug({ container, canvas, summary, list, t });
  return { debug, canvas, summary, list, rects, dashes, hidden: () => classes.has('hidden'), setLanguage(value){ lang = value; } };
}

const attempt = (scope, outcome, width, height) => ({ scope, outcome, rect: { x: 0, y: 0, width, height }, passes: [{ width, height, outcome }] });
const report = attempts => ({ image: { naturalWidth: 1600, naturalHeight: 800 }, phase: 'complete', proposals: 1, finders: [{ x: 100, y: 100, width: 28, height: 28 }], attempts });

test('debug retains failed region and successful whole-image attempts with distinguishable preview marks', () => {
  const env = setup();
  env.debug.render(report([attempt('region', 'miss', 200, 200), attempt('whole', 'success', 1600, 800)]));
  assert.equal(env.hidden(), false);
  assert.equal(env.canvas.width, 960);
  assert.equal(env.canvas.height, 480);
  assert.match(env.summary.textContent, /whole-image fallback succeeded/);
  assert.match(env.list.children[0].textContent, /Region 1: no QR decoded \(200 × 200 @ 0°: no QR decoded\)/);
  assert.match(env.list.children[1].textContent, /Whole image: decoded/);
  assert.deepEqual(env.rects.map(rect => rect.color), ['#f59e0b', '#4ade80']);
  assert.deepEqual(Array.from(env.dashes.at(-1)), [9, 6]);
  env.setLanguage('pt');
  env.debug.refresh();
  assert.match(env.summary.textContent, /imagem inteira teve sucesso/);
  assert.match(env.list.children[0].textContent, /Área 1/);
  env.debug.clear();
  assert.equal(env.hidden(), true);
  assert.equal(env.canvas.width, 0);
  assert.deepEqual(env.list.children, []);
});

test('debug reports all failed attempts and a failed locator without claiming a detected QR', () => {
  const env = setup();
  const trace = report([attempt('region', 'error', 200, 200), attempt('whole', 'miss', 1600, 800)]);
  trace.locatorFailed = true;
  env.debug.render(trace);
  assert.match(env.summary.textContent, /No QR code decoded/);
  assert.match(env.summary.textContent, /Region analysis failed/);
  assert.match(env.list.children[0].textContent, /decode error/);
  env.debug.render(null);
  assert.equal(env.hidden(), true);
});

test('debug shows each rotation and its actual dimensions and outcome', () => {
  const env = setup();
  const region = attempt('region', 'success', 200, 100);
  region.passes = [
    { width: 200, height: 100, rotation: 0, outcome: 'miss' },
    { width: 100, height: 200, rotation: 90, outcome: 'success' }
  ];
  env.debug.render(report([region]));
  assert.match(env.list.children[0].textContent, /200 × 100 @ 0°: no QR decoded; 100 × 200 @ 90°: decoded/);
});

test('debug distinguishes located but unreadable QR payloads from unconfirmed patterns and no pattern', () => {
  const env = setup();
  const trace = report([attempt('whole', 'unreadable', 1600, 800)]);
  const reason = 'ChecksumError @ QRDecoder.cpp:337';
  trace.unreadable = [{ x: 80, y: 100, width: 200, height: 200, reasons: [reason] }];
  trace.attempts[0].errors = [reason];
  env.debug.render(trace);
  assert.match(env.summary.textContent, /Located 1 QR code.*could not be verified/);
  assert.match(env.list.children[0].textContent, /QR located; payload unreadable/);
  assert.ok(env.summary.textContent.includes(`Reason: ${reason}`));
  assert.ok(env.list.children[0].textContent.includes(`Reason: ${reason}`));
  env.setLanguage('pt'); env.debug.refresh();
  assert.ok(env.summary.textContent.includes(`Motivo: ${reason}`));
  env.setLanguage('en');
  assert.equal(env.rects.at(-1).color, '#f87171');
  trace.unreadable = [];
  trace.attempts[0].outcome = 'miss';
  env.debug.render(trace);
  assert.match(env.summary.textContent, /QR-like finder patterns.*unconfirmed/);
  trace.proposals = 0;
  env.debug.render(trace);
  assert.match(env.summary.textContent, /No QR code decoded/);
});

test('debug keeps partial success and remaining unreadable QR codes visible together', () => {
  const env = setup();
  const trace = report([attempt('whole', 'success', 1600, 800)]);
  trace.results = [{ text: 'first' }, { text: 'second' }];
  trace.unreadable = [{ x: 80, y: 100, width: 200, height: 200 }];
  env.debug.render(trace);
  assert.match(env.summary.textContent, /Decoded 2 distinct.*Located 1 QR/);
  assert.match(env.summary.textContent, /The decoder did not provide a reason/);
  env.setLanguage('pt'); env.debug.refresh();
  assert.match(env.summary.textContent, /Localizados 1 códigos QR/);
});
