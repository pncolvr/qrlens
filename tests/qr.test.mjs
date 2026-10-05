import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parseQR } from '../src/js/qr.js';

const jsQR = createRequire(import.meta.url)('../src/vendor/jsQR-1.4.0.min.js');

export function fixture(name, inverted = false){
  const [, w, h, ...pixels] = readFileSync(new URL(`fixtures/${name}.pbm`, import.meta.url), 'utf8').trim().split(/\s+/);
  const width = Number(w) * 4, height = Number(h) * 4;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++){
    const black = pixels[Math.floor(y / 4) * Number(w) + Math.floor(x / 4)] === '1';
    const color = black !== inverted ? 0 : 255;
    data.set([color, color, color, 255], (y * width + x) * 4);
  }
  return { data, width, height };
}

test('real QR images decode and select link or text actions, including inverted codes', () => {
  for (const inverted of [false, true]){
    const link = fixture('link', inverted);
    const decoded = jsQR(link.data, link.width, link.height);
    assert.equal(decoded.data, 'https://example.com/qr?test=1');
    assert.equal(parseQR(decoded.data).actions[0].href, decoded.data);
    const text = fixture('text', inverted);
    const plain = jsQR(text.data, text.width, text.height);
    assert.equal(plain.data, 'Hello from QR scanner');
    assert.deepEqual(parseQR(plain.data), { type: 'text', actions: [] });
  }
});

test('recognized protocols present explicit actions', () => {
  for (const [input, type, href] of [
    [' https://example.com/a?q=1 ', 'url', 'https://example.com/a?q=1'],
    ['www.example.com', 'url', 'https://www.example.com/'],
    ['mailto:hello@example.com?subject=Hi', 'email', 'mailto:hello@example.com?subject=Hi'],
    ['tel:+351123456789', 'phone', 'tel:+351123456789'],
    ['sms:+351123456789?body=Hello', 'sms', 'sms:+351123456789?body=Hello'],
    ['SMSTO:+351123456789:Hello: world', 'sms', 'sms:+351123456789?body=Hello%3A%20world'],
    ['geo:38.72,-9.14', 'location', 'geo:38.72,-9.14']
  ]){
    const result = parseQR(input);
    assert.equal(result.type, type, input);
    assert.equal(result.actions[0].href, href, input);
  }
});

test('app links are preserved for the browser or operating system', () => {
  for (const href of ['whatsapp://send?phone=351123456789', 'spotify:track:123', 'myapp://screen/42', 'myapp:open', 'intent://scan/#Intent;scheme=zxing;package=com.google.zxing.client.android;end']){
    assert.deepEqual(parseQR(href), { type: 'app', actions: [{ label: 'actions.openApp', href }] });
  }
  for (const text of ['about:blank', 'chrome://settings', 'view-source:https://example.com', 'blob:https://example.com/123', 'vbscript:alert(1)', 'Note: some text'])
    assert.deepEqual(parseQR(text), { type: 'text', actions: [] });
});

test('Wi-Fi escaping is decoded and open networks need only a network copy action', () => {
  const result = parseQR(String.raw`WIFI:T:WPA;S:Office\; guest;P:a\:b\\c\;d;;`);
  assert.equal(result.type, 'wifi');
  assert.deepEqual(result.actions.map(action => action.text), ['Office; guest', 'a:b\\c;d']);
  assert.deepEqual(parseQR('WIFI:T:nopass;S:Guest;;').actions, [{ label: 'actions.copyNetwork', text: 'Guest' }]);
});

test('unsafe schemes, HTML and malformed payloads remain text with no actions', () => {
  for (const text of ['', '<img src=x onerror=alert(1)>', 'javascript:alert(1)', 'data:text/html,hello', 'file:///etc/passwd', 'https://user:secret@example.com', 'WIFI:T:WPA;;', 'mailto:bad', 'tel:', 'tel:hello', 'sms:hello', 'geo:100,200', 'geo:,', 'SMSTO:hello:message', 'https://'])
    assert.deepEqual(parseQR(text), { type: 'text', actions: [] }, text);
});

test('all languages cover parsed result and action keys', () => {
  const languages = ['en', 'pt', 'es'].map(language => JSON.parse(readFileSync(new URL(`../src/i18n/${language}.json`, import.meta.url))));
  for (const language of languages){
    assert.deepEqual(Object.keys(language), Object.keys(languages[0]));
    for (const text of ['hello', 'https://example.com', 'mailto:hi@example.com', 'tel:123', 'sms:123', 'geo:1,2', 'whatsapp://send', 'WIFI:S:Guest;P:secret;;', 'MECARD:N:Doe,Jane;;', 'https://example.com/info.pdf', 'https://example.com/contact.vcf', 'https://apps.apple.com/app/id123', 'market://details?id=com.example.app', 'BEGIN:VEVENT\nSUMMARY:Meeting\nDTSTART:20261005T140000Z\nEND:VEVENT']){
      const result = parseQR(text);
      assert.ok(language[`type.${result.type}`]);
      for (const action of result.actions) assert.ok(language[action.label]);
      for (const detail of result.details || []) assert.ok(language[detail.label]);
    }
  }
});

test('websites include bare domains and URLTO bookmarks', () => {
  for (const input of ['example.com/page', 'URLTO:example.com/page', 'URLTO::https://example.com/page', 'URLTO:Example:https://example.com/page']){
    assert.equal(parseQR(input).type, 'url', input);
    assert.equal(parseQR(input).actions[0].href, 'https://example.com/page', input);
  }
  assert.equal(parseQR('https://example.com/%broken').type, 'url');
});

test('PDF and contact links keep the full URL including query parameters', () => {
  for (const [href, type, label] of [
    ['https://example.com/brochure.PDF?token=123#page=2', 'pdf', 'actions.openPdf'],
    ['https://example.com/file%2Epdf', 'pdf', 'actions.openPdf'],
    ['https://example.com/card.vcf?download=1', 'contact', 'actions.openContact'],
    ['https://example.com/download?format=pdf', 'url', 'actions.openLink']
  ]) assert.deepEqual(parseQR(href), { type, actions: [{ label, href }] });
});

test('store links distinguish Apple and Google with exact hostnames', () => {
  for (const href of ['https://apps.apple.com/us/app/example/id123', 'https://itunes.apple.com/app/id123', 'https://appstore.com/example', 'itms-apps://itunes.apple.com/app/id123'])
    assert.deepEqual(parseQR(href), { type: 'appStore', actions: [{ label: 'actions.appStore', href }] });
  for (const href of ['https://play.google.com/store/apps/details?id=com.example.app', 'market://details?id=com.example.app'])
    assert.deepEqual(parseQR(href), { type: 'playStore', actions: [{ label: 'actions.playStore', href }] });
  for (const href of ['https://play.google.com.evil.test/store/apps/details?id=x', 'https://example.com/apps.apple.com/app/id123', 'https://itunes.apple.com/us/album/example/id123'])
    assert.equal(parseQR(href).type, 'url');
});

test('vCard versions preserve contact data and unfold preview fields', () => {
  for (const version of ['2.1', '3.0', '4.0']){
    const card = `BEGIN:VCARD\nVERSION:${version}\nFN:Jane\\, Doe\nitem1.EMAIL;TYPE=WORK:jane@\n example.com\nTEL;TYPE=CELL:+351123456789\nURL:https://example.com\nEND:VCARD`;
    const result = parseQR(card);
    assert.equal(result.type, 'contact');
    assert.equal(result.details[0].value, 'Jane, Doe');
    assert.equal(result.details[2].value, 'jane@example.com');
    assert.deepEqual(result.actions[0].file, { name: 'contact.vcf', mime: 'text/vcard;charset=utf-8', content: card.replaceAll('\n', '\r\n') + '\r\n' });
  }
});

test('MECARD conversion preserves escaped names, repeated numbers, and extra fields', () => {
  const result = parseQR(String.raw`MECARD:N:Doe,Jane\; Mary;TEL:123;TEL:456;EMAIL:jane@example.com;ADR:Street 1;NOTE:Say \\hello\;;URL:https://example.com;;`);
  assert.equal(result.type, 'contact');
  assert.equal(result.details[0].value, 'Jane; Mary Doe');
  const content = result.actions[0].file.content;
  assert.ok(content.includes('N:Doe;Jane\\; Mary;;;\r\n'));
  assert.ok(content.includes('TEL:123\r\nTEL:456'));
  assert.ok(content.includes('ADR:;;Street 1'));
  assert.ok(content.includes('NOTE:Say \\\\hello\\;'));
  assert.equal(parseQR('MECARD:N:Jane;;').type, 'contact');
});

test('calendar events become importable ICS files with a UID and timestamp', () => {
  const event = 'BEGIN:VEVENT\nSUMMARY:Meeting\\, team\nDTSTART;TZID=Europe/Lisbon:20261005T140000\nDTEND;TZID=Europe/Lisbon:20261005T150000\nEND:VEVENT';
  const result = parseQR(event);
  assert.equal(result.type, 'calendar');
  assert.equal(result.details[0].value, 'Meeting, team');
  assert.equal(result.actions[0].file.name, 'event.ics');
  const content = result.actions[0].file.content;
  assert.ok(content.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0'));
  assert.match(content, /UID:[^\r\n]+@qr-lens\r\n/);
  assert.match(content, /DTSTAMP:\d{8}T\d{6}Z\r\n/);
  assert.ok(content.endsWith('END:VCALENDAR\r\n'));
  const full = 'BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Test//EN\nBEGIN:VEVENT\nUID:existing\nDTSTAMP:20261001T000000Z\nDTSTART;VALUE=DATE:20261005\nEND:VEVENT\nEND:VCALENDAR';
  assert.equal(parseQR(full).actions[0].file.content, full.replaceAll('\n', '\r\n') + '\r\n');
});

test('bare emails, MATMSG and MMS compose through device handlers', () => {
  assert.equal(parseQR('jane@example.com').actions[0].href, 'mailto:jane@example.com');
  const email = parseQR(String.raw`MATMSG:TO:jane@example.com;SUB:Hello & welcome;BODY:One\; two;;`);
  assert.equal(email.type, 'email');
  assert.equal(email.actions[0].href, 'mailto:jane@example.com?subject=Hello%20%26%20welcome&body=One%3B%20two');
  assert.equal(parseQR('MMSTO:123:Hello').actions[0].href, 'mms:123?body=Hello');
  assert.equal(parseQR('mms:123').type, 'sms');
});

test('incomplete contacts, calendars and legacy wrappers stay copyable text', () => {
  for (const text of ['BEGIN:VCARD\nFN:Jane\nEND:VCARD', 'BEGIN:VCARD\nVERSION:3.0\nEND:VCARD', 'MECARD:TEL:123;;', 'MATMSG:TO:bad;;', 'BEGIN:VEVENT\nSUMMARY:Meeting\nEND:VEVENT', 'URLTO::javascript:alert(1)', 'URLTO::data:text/html,hello', 'email?cc=other@example.com'])
    assert.deepEqual(parseQR(text), { type: 'text', actions: [] }, text);
});
