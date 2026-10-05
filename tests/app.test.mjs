import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parseQR } from '../src/js/qr.js';

const source = readFileSync(new URL('../src/js/app.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');

function setup(){
  class Element {
    constructor(){
      this.children = []; this.events = {}; this.attributes = {}; this.classes = new Set(); this.text = ''; this.value = '';
      this.classList = { add: name => this.classes.add(name), remove: name => this.classes.delete(name), contains: name => this.classes.has(name), toggle: (name, add) => add ? this.classes.add(name) : this.classes.delete(name) };
    }
    set textContent(value){ this.text = value; this.children = []; }
    get textContent(){ return this.text + this.children.map(child => child.textContent).join(''); }
    append(...children){ this.children.push(...children); }
    replaceChildren(...children){ this.children = children; }
    addEventListener(name, callback){ this.events[name] = callback; }
    setAttribute(name, value){ this.attributes[name] = value; }
    click(){ return this.events.click?.(); }
    focus(){} select(){} remove(){}
  }
  const elements = new Map();
  const element = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  element('view-camera').classes.add('hidden'); element('view-result').classes.add('hidden');
  let callbacks;
  const blobs = [], revoked = [], timers = [];
  const document = { getElementById: element, createElement: () => new Element(), createElementNS: () => new Element(), addEventListener(){}, body: new Element(), hidden: false };
  const browser = {
    document, window: { addEventListener(){} }, navigator: { clipboard: { writeText: async () => {} } }, Blob,
    URL: { createObjectURL(blob){ blobs.push(blob); return 'blob:test'; }, revokeObjectURL(url){ revoked.push(url); } },
    setTimeout: callback => timers.push(callback), console,
    supported: () => ({ secure: true, hasMedia: true }), parseQR, t: key => key,
    initTranslations: async () => {},
    createCamera(options){ callbacks = options; return { start: async () => true, switchDevice: async () => true, stop(){} }; }
  };
  runInNewContext(source, browser);
  return { element, document, callbacks, blobs, revoked, timers };
}

test('results open only after a decode in the visible camera view', async () => {
  const env = setup();
  assert.equal(env.element('view-result').classList.contains('hidden'), true);
  env.callbacks.onResult('https://example.com');
  assert.equal(env.element('view-result').classList.contains('hidden'), true);
  await env.element('btnStart').click();
  assert.equal(env.element('view-camera').classList.contains('hidden'), false);
  assert.equal(env.element('view-result').classList.contains('hidden'), true);
  env.document.hidden = true;
  env.callbacks.onResult('https://example.com');
  assert.equal(env.element('view-result').classList.contains('hidden'), true);
  env.document.hidden = false;
  env.callbacks.onResult(undefined);
  assert.equal(env.element('view-result').classList.contains('hidden'), true);
  env.callbacks.onResult('https://example.com');
  assert.equal(env.element('view-result').classList.contains('hidden'), false);
  const link = env.element('resultActions').children[0];
  assert.equal(link.href, 'https://example.com/');
  assert.equal(link.textContent, 'actions.openLink');
  assert.equal(link.rel, 'noopener noreferrer');
});

test('contact and calendar downloads start on a tap and release temporary URLs', async () => {
  for (const [text, name, mime] of [
    ['MECARD:N:Doe,Jane;EMAIL:jane@example.com;;', 'contact.vcf', 'text/vcard;charset=utf-8'],
    ['BEGIN:VEVENT\nSUMMARY:Meeting\nDTSTART:20261005T140000Z\nEND:VEVENT', 'event.ics', 'text/calendar;charset=utf-8']
  ]){
    const env = setup();
    await env.element('btnStart').click();
    env.callbacks.onResult(text);
    assert.equal(env.blobs.length, 0);
    assert.equal(env.element('resultText').value, text);
    env.element('resultActions').children[0].click();
    assert.equal(env.blobs.length, 1);
    assert.equal(env.blobs[0].type, mime);
    assert.ok((await env.blobs[0].text()).includes(name === 'contact.vcf' ? 'BEGIN:VCARD' : 'BEGIN:VCALENDAR'));
    const link = env.document.body.children[0];
    assert.equal(link.download, name);
    assert.equal(link.href, 'blob:test');
    env.timers[0]();
    assert.deepEqual(env.revoked, ['blob:test']);
  }
});
