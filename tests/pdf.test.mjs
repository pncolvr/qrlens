import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPDFScanner } from '../src/js/pdf.js';

function setup({ scenarios = [{ results: ['first'] }], loadingError, pendingRender = false } = {}){
  const events = [], scans = [], renders = [], canvases = [], options = [];
  let destroyed = 0, cleaned = 0, renderCanceled = 0, resolveRender;
  const pages = scenarios.map((scenario, index) => ({
    getViewport: ({ scale }) => ({ width: (index % 2 ? 800 : 600) * scale, height: (index % 2 ? 600 : 800) * scale }),
    render({ canvasContext, viewport }){
      renders.push({ page: index + 1, viewport });
      if (scenario.renderError) throw new Error('page failed');
      canvasContext.canvas.page = index + 1;
      return { promise: pendingRender ? new Promise(resolve => { resolveRender = resolve; }) : Promise.resolve(), cancel(){ renderCanceled++; resolveRender?.(); } };
    },
    cleanup(){ cleaned++; }
  }));
  const loading = { promise: loadingError ? Promise.reject(loadingError) : Promise.resolve({ numPages: pages.length, getPage: async page => pages[page - 1] }), async destroy(){ destroyed++; } };
  const createCanvas = () => {
    const canvas = { width: 0, height: 0, getContext: () => ({ canvas }) };
    canvases.push(canvas); return canvas;
  };
  const scanner = createPDFScanner({
    onStart: value => events.push({ type: 'start', ...value }), onProgress: value => events.push({ type: 'progress', ...value }),
    onPage: value => events.push({ type: 'page', ...value }), onComplete: value => events.push({ type: 'complete', ...value }), onError: key => events.push({ type: 'error', key }),
    loadEngine: async () => ({ getDocument(value){ options.push(value); return loading; } }), createCanvas,
    createScanner: () => ({ async scan(source, options){
      const page = source.page, scenario = scenarios[page - 1];
      scans.push({ page, width: source.width, height: source.height, collectAll: options.collectAll, analysisMaxSize: options.analysisMaxSize });
      const pass = scenario.passes?.[Math.max(source.width, source.height) >= 3072 ? 1 : 0];
      const values = pass ? pass.results : scenario.retry && Math.max(source.width, source.height) < 3072 ? [] : scenario.results || [];
      const report = { image: source, attempts: [{ scope: 'whole', passes: [], outcome: values.length ? 'success' : 'miss' }], results: values.map(value => typeof value === 'string' ? { text: value } : value), unreadable: pass?.unreadable || [], unverified: pass?.unverified || [], phase: 'complete', proposals: 0, finders: [] };
      options.onDiagnostics(report);
      return report;
    } })
  });
  const file = { name: 'codes.pdf', arrayBuffer: async () => new Uint8Array([37, 80, 68, 70]).buffer };
  return { scanner, file, events, scans, renders, options, canvases, destroyed: () => destroyed, cleaned: () => cleaned, canceled: () => renderCanceled };
}

test('PDF scanning keeps page attribution, retries empty results, and continues after a failed page', async () => {
  const env = setup({ scenarios: [{ results: ['same QR'], retry: true }, { results: [] }, { renderError: true }, { results: ['same QR', 'another QR'] }] });
  await env.scanner.scan(env.file);
  const completePages = env.events.filter(event => event.state === 'complete');
  assert.deepEqual(completePages.map(event => [event.page, event.results.map(result => [result.text, result.page])]), [
    [1, [['same QR', 1]]], [2, []], [4, [['same QR', 4], ['another QR', 4]]]
  ]);
  assert.deepEqual(env.scans.map(scan => [scan.page, Math.max(scan.width, scan.height)]), [[1, 2048], [1, 3072], [2, 2048], [2, 3072], [4, 2048]]);
  assert.ok(env.scans.every(scan => scan.collectAll));
  assert.equal(env.events.filter(event => event.state === 'error')[0].page, 3);
  assert.deepEqual(env.events.at(-1), { type: 'complete', pages: 4, processed: 4, codes: 3, unreadable: 0, errors: 1, name: 'codes.pdf' });
  assert.equal(env.destroyed(), 1);
  assert.equal(env.cleaned(), 4);
  assert.ok(env.canvases.every(canvas => canvas.width === 0 && canvas.height === 0));
  assert.equal(env.options[0].isEvalSupported, false);
  assert.ok(env.options[0].data instanceof Uint8Array);
});

test('PDF cancellation stops active rendering, frees the document, and suppresses later results', async () => {
  const env = setup({ pendingRender: true });
  const pending = env.scanner.scan(env.file);
  for (let i = 0; i < 10 && !env.renders.length; i++) await Promise.resolve();
  assert.equal(env.renders.length, 1);
  env.scanner.cancel();
  await pending;
  assert.equal(env.canceled(), 1);
  assert.equal(env.destroyed(), 1);
  assert.equal(env.scans.length, 0);
  assert.equal(env.events.some(event => event.type === 'complete'), false);
  assert.equal(env.events.some(event => event.type === 'error'), false);
});

test('invalid and password-protected PDFs report recoverable errors', async () => {
  for (const [name, key] of [['InvalidPDFException', 'pdf.loadFailed'], ['PasswordException', 'pdf.passwordProtected']]){
    const env = setup({ loadingError: Object.assign(new Error(name), { name }) });
    await env.scanner.scan(env.file);
    assert.deepEqual(env.events.at(-1), { type: 'error', key });
    assert.equal(env.destroyed(), 1);
  }
});

test('a decoded QR does not suppress the sharper retry for another unreadable QR and earlier results survive', async () => {
  const env = setup({ scenarios: [{ passes: [
    { results: ['first'], unreadable: [{ x: 100, y: 100, width: 100, height: 100 }] },
    { results: ['second'], unreadable: [] }
  ] }] });
  await env.scanner.scan(env.file);
  assert.equal(env.scans.length, 2);
  const page = env.events.find(event => event.state === 'complete');
  assert.deepEqual(page.results.map(result => result.text), ['first', 'second']);
  // The second pass did not recover a payload at the failed location.
  assert.equal(page.unreadable, 1);
});

test('unverified text survives sharper retries and is replaced when the same QR validates', async () => {
  const location = scale => [{ x: 100 * scale, y: 100 * scale }, { x: 200 * scale, y: 100 * scale }, { x: 200 * scale, y: 200 * scale }, { x: 100 * scale, y: 200 * scale }];
  const first = { results: [], unreadable: [{ x: 100, y: 100, width: 100, height: 100 }], unverified: [{ text: 'partial', location: location(1), verified: false, error: 'ChecksumError' }] };
  const env = setup({ scenarios: [
    { passes: [first, { results: [], unreadable: [{ x: 150, y: 150, width: 150, height: 150 }], unverified: [{ text: 'longer partial', location: location(1.5), verified: false, error: 'ChecksumError' }] }] },
    { passes: [first, { results: [{ text: 'validated', location: location(1.5) }] }] }
  ] });
  await env.scanner.scan(env.file);
  const pages = env.events.filter(event => event.state === 'complete');
  assert.equal(pages[0].results.length, 0);
  assert.equal(pages[0].unverified.length, 1);
  assert.equal(pages[0].unverified[0].text, 'longer partial');
  assert.equal(pages[0].unverified[0].page, 1);
  assert.equal(pages[1].results[0].text, 'validated');
  assert.equal(pages[1].unverified.length, 0);
  assert.equal(pages[1].unreadable, 0);
  assert.equal(env.events.at(-1).codes, 1);
});
