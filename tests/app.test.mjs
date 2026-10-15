import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parseQR } from '../src/js/qr.js';

const source = readFileSync(new URL('../src/js/app.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');

function setup({ hostname = "localhost", search = "", cameraStart = async () => true } = {}){
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
  for (const view of ['camera', 'image', 'result']) element('view-' + view).classes.add('hidden');
  element('imageDropOverlay').classes.add('hidden');
  let callbacks, imageCallbacks;
  const imageLoads = [];
  let imageClears = 0, cameraStops = 0;
  const blobs = [], revoked = [], timers = [];
  const document = { getElementById: element, createElement: () => new Element(), createElementNS: () => new Element(), events: {}, addEventListener(name, callback){ this.events[name] = callback; }, body: new Element(), hidden: false };
  const browser = {
    location: { hostname, search }, URLSearchParams,
    document, window: { addEventListener(){} }, navigator: { clipboard: { writeText: async () => {} } }, Blob,
    URL: { createObjectURL(blob){ blobs.push(blob); return 'blob:test'; }, revokeObjectURL(url){ revoked.push(url); } },
    setTimeout: callback => timers.push(callback), console,
    supported: () => ({ secure: true, hasMedia: true }), parseQR, t: key => key,
    initTranslations: async () => {},
    createDetectionDebug: () => ({ clear(){}, render(){}, refresh(){} }),
    createImageScanner(options){
      imageCallbacks = options;
      return { load: file => imageLoads.push(file), clear(){ imageClears++; }, reset(){}, decode(){}, decodeWhole(){} };
    },
    createCamera(options){ callbacks = options; return { start: cameraStart, switchDevice: async () => true, stop(){ cameraStops++; } }; }
  };
  runInNewContext(source, browser);
  return { element, document, callbacks, imageCallbacks, imageLoads, imageClears: () => imageClears, cameraStops: () => cameraStops, blobs, revoked, timers };
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


test('switch-camera preview is limited to an explicit flag on loopback hosts', () => {
  for (const [hostname, search, visible] of [
    ['localhost', '?showCameraSwitch=1', true],
    ['127.0.0.1', '?showCameraSwitch=1', true],
    ['[::1]', '?showCameraSwitch=1', true],
    ['localhost', '', false],
    ['localhost', '?showCameraSwitch=0', false],
    ['localhost', '?showCameraSwitch', false],
    ['example.com', '?showCameraSwitch=1', false],
    ['localhost.example.com', '?showCameraSwitch=1', false],
    ['192.168.1.2', '?showCameraSwitch=1', false]
  ]){
    const env = setup({ hostname, search });
    env.callbacks.onStatus({ deviceCount: 1 });
    assert.equal(env.element('btnSwitch').classList.contains('hidden'), !visible, hostname + search);
    env.callbacks.onStatus({ deviceCount: 2 });
    assert.equal(env.element('btnSwitch').classList.contains('hidden'), false);
  }
});

test('image import waits for an explicit decode, reuses results, and clears image resources', () => {
  const env = setup();
  const input = env.element('imageInput');
  const file = { name: 'qr.png' };
  input.files = [file];
  input.events.change({ target: input });
  assert.equal(input.value, '');
  assert.deepEqual(env.imageLoads, [file]);
  assert.equal(env.element('view-image').classList.contains('hidden'), false);
  assert.equal(env.element('view-result').classList.contains('hidden'), true);
  env.imageCallbacks.onReady(true);
  assert.equal(env.element('btnDecodeImage').disabled, false);
  env.imageCallbacks.onResult('https://example.com/image');
  assert.equal(env.element('view-image').classList.contains('hidden'), true);
  assert.equal(env.element('resultText').value, 'https://example.com/image');
  assert.equal(env.imageClears(), 1);
  env.imageCallbacks.onResult('stale result');
  assert.equal(env.element('resultText').value, 'https://example.com/image');
});

test('canceling image selection returns to start and invalidates pending image work', () => {
  const env = setup();
  const input = env.element('imageInput');
  input.files = [{}];
  input.events.change({ target: input });
  env.element('btnCancelImage').click();
  assert.equal(env.element('view-start').classList.contains('hidden'), false);
  assert.equal(env.element('view-image').classList.contains('hidden'), true);
  assert.equal(env.imageClears(), 1);
  env.imageCallbacks.onResult('stale result');
  assert.equal(env.element('view-result').classList.contains('hidden'), true);
});

function dragEvent(files = [], types = ['Files']){
  return { dataTransfer: { files, types }, defaultPrevented: false, preventDefault(){ this.defaultPrevented = true; } };
}

test('system picker buttons open the file input from each image entry point', () => {
  const env = setup();
  let opens = 0;
  env.element('imageInput').events.click = () => opens++;
  for (const id of ['btnUpload', 'btnUploadResult', 'btnChooseImage']) env.element(id).click();
  assert.equal(opens, 3);
});

test('dropping files during camera scanning imports the first image and hides the drop indicator', async () => {
  const env = setup();
  await env.element('btnStart').click();
  const file = { name: 'qr.png', type: 'image/png' };
  const otherImage = { name: 'qr2.jpg', type: 'image/jpeg' };
  const drag = dragEvent(); // File contents are unavailable until drop.
  env.document.events.dragenter(drag);
  env.document.events.dragover(drag);
  assert.equal(env.element('imageDropOverlay').classList.contains('hidden'), false);
  assert.equal(drag.defaultPrevented, true);
  assert.equal(drag.dataTransfer.dropEffect, 'copy');
  const drop = dragEvent([{ name: 'notes.txt', type: 'text/plain' }, file, otherImage]);
  env.document.events.drop(drop);
  assert.equal(drop.defaultPrevented, true);
  assert.deepEqual(env.imageLoads, [file]);
  assert.equal(env.cameraStops(), 1);
  assert.equal(env.element('view-camera').classList.contains('hidden'), true);
  assert.equal(env.element('view-image').classList.contains('hidden'), false);
  assert.equal(env.element('imageDropOverlay').classList.contains('hidden'), true);
  assert.equal(env.element('view-result').classList.contains('hidden'), true);
  env.imageCallbacks.onResult('QR from dropped image');
  assert.equal(env.element('resultText').value, 'QR from dropped image');
});

test('file drags stay highlighted across nested elements and clear on leaving or hiding the app', () => {
  const env = setup();
  const hidden = () => env.element('imageDropOverlay').classList.contains('hidden');
  env.document.events.dragenter(dragEvent());
  env.document.events.dragenter(dragEvent());
  env.document.events.dragleave();
  assert.equal(hidden(), false);
  env.document.events.dragleave();
  assert.equal(hidden(), true);
  env.document.events.dragenter(dragEvent());
  env.document.hidden = true;
  env.document.events.visibilitychange();
  assert.equal(hidden(), true);
  env.document.events.dragenter(dragEvent());
  env.document.events.dragend();
  assert.equal(hidden(), true);
});

test('invalid file drops stay in the current view and ordinary text drags keep their normal behavior', () => {
  const env = setup();
  const text = dragEvent([], ['text/plain']);
  env.document.events.dragenter(text);
  env.document.events.dragover(text);
  env.document.events.drop(text);
  assert.equal(text.defaultPrevented, false);
  assert.equal(env.element('imageDropOverlay').classList.contains('hidden'), true);
  const invalid = dragEvent([{ name: 'document.pdf', type: 'application/pdf' }]);
  env.document.events.drop(invalid);
  assert.equal(invalid.defaultPrevented, true);
  assert.deepEqual(env.imageLoads, []);
  assert.equal(env.cameraStops(), 0);
  assert.equal(env.element('view-image').classList.contains('hidden'), true);
  assert.equal(env.element('importError').textContent, 'image.invalidDrop');
  const image = { name: 'photo.JPEG', type: '' }; // Some systems omit MIME types.
  env.document.events.drop(dragEvent([image]));
  assert.deepEqual(env.imageLoads, [image]);
  assert.equal(env.element('importError').textContent, '');
});

test('dropping an image replaces the result view and a pending camera cannot overwrite it', async () => {
  for (const fails of [false, true]){
    let resolve, reject;
    const env = setup({ cameraStart: () => new Promise((yes, no) => { resolve = yes; reject = no; }) });
    const pending = env.element('btnStart').click();
    env.document.events.drop(dragEvent([{ name: 'qr.webp', type: 'image/webp' }]));
    if (fails) reject(new Error('Permission request canceled'));
    else resolve(true);
    await pending;
    assert.equal(env.element('view-image').classList.contains('hidden'), false);
    assert.equal(env.element('startError').textContent, '');
    env.imageCallbacks.onResult('https://example.com/dropped');
    env.document.events.drop(dragEvent([{ name: 'next.png', type: 'image/png' }]));
    assert.equal(env.element('view-result').classList.contains('hidden'), true);
    assert.equal(env.element('view-image').classList.contains('hidden'), false);
    assert.equal(env.imageLoads.length, 2);
  }
});
