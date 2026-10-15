import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parseQR } from '../src/js/qr.js';

const source = readFileSync(new URL('../src/js/pdf-view.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replaceAll('export ', '');
const translations = Object.fromEntries(['en', 'pt'].map(lang => [lang, JSON.parse(readFileSync(new URL(`../src/i18n/${lang}.json`, import.meta.url)))]));

function setup(){
  class Element {
    constructor(tag){ this.tag = tag; this.children = []; this.events = {}; this.width = 0; this.height = 0; }
    append(...nodes){ this.children.push(...nodes); }
    replaceChildren(...nodes){ this.children = nodes; }
    replaceWith(node){ this.replacement = node; }
    addEventListener(name, callback){ this.events[name] = callback; }
    setAttribute(name, value){ this[name] = value; }
    toDataURL(){ return 'data:image/webp;base64,preview'; }
  }
  let language = 'en';
  const t = (key, values = {}) => translations[language][key].replace(/\{(\w+)\}/g, (_, key) => values[key]);
  const previews = [], selected = [];
  const createPDFView = runInNewContext(source + '; createPDFView;', {
    document: { createElement: tag => new Element(tag) }, parseQR,
    createDetectionDebug(options){
      previews.push(options);
      return { render(report){ options.canvas.width = 480; options.canvas.height = 320; }, refresh(){} };
    }
  });
  const heading = new Element('h2'), status = new Element('p'), pages = new Element('div'), stopButton = new Element('button');
  const view = createPDFView({ heading, status, pages, stopButton, t, onSelect: (...args) => selected.push(args) });
  return { view, heading, status, pages, stopButton, previews, selected, setLanguage(value){ language = value; } };
}

test('PDF results and debug previews identify their page and keep duplicate content on different pages', () => {
  const env = setup();
  env.view.start({ name: 'codes.pdf' });
  env.view.progress({ page: 1, total: 3 });
  for (const page of [1, 3]){
    env.view.update({ page, state: 'scanning', size: 2048, trace: {} });
    env.view.update({ page, state: 'passComplete', size: 2048 });
    env.view.update({ page, state: 'complete', results: [{ text: 'https://example.com', page }] });
  }
  assert.equal(env.heading.textContent, 'codes.pdf');
  assert.equal(env.pages.children[0].children[0].textContent, 'Page 1');
  assert.equal(env.pages.children[1].children[0].textContent, 'Page 3');
  assert.match(env.pages.children[1].children[3].children[0].children[0].textContent, /Page 3 · 2048px/);
  assert.equal(env.previews[0].canvas.width, 0); // Full debug canvases are released between pages.
  assert.equal(env.previews[0].canvas.replacement.loading, 'lazy');
  const card = env.pages.children[1].children[2].children[0];
  assert.equal(card.children[0].textContent, 'https://example.com');
  card.children[1].events.click();
  assert.equal(env.selected[0][0], 'https://example.com');
  assert.equal(env.selected[0][1].page, 3);
  assert.equal(env.selected[0][1].name, 'codes.pdf');
  env.view.complete({ processed: 3, pages: 3, codes: 2, errors: 0 });
  assert.match(env.status.textContent, /3 of 3 pages: 2 QR/);
  env.setLanguage('pt'); env.view.refresh();
  assert.equal(env.pages.children[1].children[0].textContent, 'Página 3');
  assert.match(env.status.textContent, /Concluídas 3 de 3/);
});

test('PDF page failures, blank pages, and stopped pages have distinct visible statuses', () => {
  const env = setup();
  env.view.start({ name: 'codes.pdf' });
  env.view.update({ page: 1, state: 'complete', results: [] });
  env.view.update({ page: 2, state: 'error', results: [] });
  env.view.update({ page: 3, state: 'scanning', size: 3072, trace: {} });
  env.view.stopped();
  assert.match(env.pages.children[0].children[1].textContent, /No QR code/);
  assert.match(env.pages.children[1].children[1].textContent, /Couldn’t scan/);
  assert.match(env.pages.children[2].children[1].textContent, /stopped before/);
  assert.equal(env.stopButton.disabled, true);
  env.view.clear();
  assert.equal(env.pages.children.length, 0);
});

test('PDF page status distinguishes unreadable QR payloads and partial success from no QR found', () => {
  const env = setup();
  env.view.start({ name: 'codes.pdf' });
  env.view.update({ page: 1, state: 'complete', results: [], unreadable: 1 });
  env.view.update({ page: 2, state: 'complete', results: [{ text: 'decoded' }], unreadable: 2 });
  assert.match(env.pages.children[0].children[1].textContent, /Located 1 QR.*could not be verified/);
  assert.doesNotMatch(env.pages.children[0].children[1].textContent, /No QR code/);
  assert.match(env.pages.children[1].children[1].textContent, /Found 1 QR.*Located 2 QR/);
});

test('checksum-failed text is visibly warned and preserves that warning when opened', () => {
  const env = setup();
  env.view.start({ name: 'codes.pdf' });
  env.view.update({ page: 1, state: 'complete', results: [], unreadable: 1, unverified: [{ text: 'partial text', verified: false, error: 'ChecksumError' }] });
  const card = env.pages.children[0].children[2].children[0];
  assert.match(card.children[0].textContent, /Unverified QR text.*incomplete or incorrect/);
  assert.equal(card.children[1].textContent, 'partial text');
  card.children[2].events.click();
  assert.equal(env.selected[0][1].verified, false);
  assert.equal(env.selected[0][1].error, 'ChecksumError');
  assert.equal(env.selected[0][1].page, 1);
});
