import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('bundled PDF.js parses the real multipage QR fixture and honors page rotation', async () => {
  // Parsing/operator-list tests do not use canvas; rendering stays a browser API.
  globalThis.DOMMatrix ||= class {};
  globalThis.Path2D ||= class {};
  const pdfjs = await import('../src/vendor/pdfjs-6.4.299/pdf.mjs');
  assert.equal(pdfjs.version, '6.4.299');
  const loading = pdfjs.getDocument({ data: new Uint8Array(readFileSync(new URL('fixtures/pages.pdf', import.meta.url))), isEvalSupported: false, verbosity: 0 });
  try {
    const pdf = await loading.promise;
    assert.equal(pdf.numPages, 3);
    const first = await pdf.getPage(1), blank = await pdf.getPage(2), rotated = await pdf.getPage(3);
    assert.ok((await first.getOperatorList()).fnArray.length > 100);
    assert.ok((await blank.getOperatorList()).fnArray.length < 5);
    assert.equal(rotated.rotate, 90);
    assert.equal(rotated.getViewport({ scale: 1 }).width, 500);
    assert.equal(rotated.getViewport({ scale: 1 }).height, 400);
  } finally { await loading.destroy(); }
});
