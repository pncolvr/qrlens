import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../src/js/camera.js', import.meta.url), 'utf8').replaceAll('export ', '');

function setup(t, code = null){
  let scan, stopped = 0, cleared = 0;
  const results = [], errors = [], constraints = [], statuses = [], draws = [];
  const track = { stop(){ stopped++; }, applyConstraints: async () => {}, getSettings: () => ({ deviceId: 'rear' }) };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  const video = { readyState: 2, videoWidth: 1920, videoHeight: 1080, srcObject: null, play: async () => {} };
  const context = { drawImage: (...args) => draws.push(args), getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }) };
  const scanRegion = { style: {}, classList: { add(){}, remove(){} } };
  const browser = {
    setInterval: callback => { scan = callback; return 7; },
    clearInterval: timer => { if (timer === 7) cleared++; },
    document: { createElement: () => ({ getContext: () => context }) },
    window: { jsQR: () => code },
    navigator: { mediaDevices: {
      getUserMedia: async options => { constraints.push(options); return stream; },
      enumerateDevices: async () => [{ kind: 'videoinput', deviceId: 'rear' }, { kind: 'videoinput', deviceId: 'front' }]
    } }
  };
  const createCamera = runInNewContext(source + '; createCamera;', browser);
  const camera = createCamera({ video, scanRegion, onResult: text => results.push(text), onStatus: status => statuses.push(status), onError: error => errors.push(error) });
  return { ...browser, camera, video, scanRegion, draws, results, errors, constraints, statuses, scan: () => scan(), stopped: () => stopped, cleared: () => cleared };
}

test('camera scans automatically, stops tracks on detection, and restarts for another code', async t => {
  const env = setup(t, { data: 'https://example.com' });
  assert.equal(await env.camera.start(), true);
  assert.equal(env.constraints[0].video.facingMode.ideal, 'environment');
  env.scan();
  assert.deepEqual(env.results, ['https://example.com']);
  assert.equal(env.stopped(), 1);
  assert.equal(env.cleared(), 1);
  assert.equal(env.video.srcObject, null);
  await env.camera.start();
  assert.notEqual(env.video.srcObject, null);
  env.camera.stop();
  assert.equal(env.stopped(), 2);
});

test('camera keeps searching through empty frames and can switch devices', async t => {
  const env = setup(t);
  await env.camera.start();
  env.scan();
  assert.deepEqual(env.results, []);
  assert.equal(env.stopped(), 0);
  await env.camera.switchDevice();
  assert.equal(env.constraints[1].video.deviceId.exact, 'front');
  assert.equal(env.stopped(), 1);
  assert.equal(env.statuses[0].deviceCount, 2);
  env.camera.stop();
});

test('stopping during a pending permission request releases a late stream', async t => {
  const env = setup(t);
  let resolve;
  env.navigator.mediaDevices.getUserMedia = () => new Promise(done => { resolve = done; });
  const pending = env.camera.start();
  env.camera.stop();
  let stopped = false;
  resolve({ getTracks: () => [{ stop(){ stopped = true; } }] });
  assert.equal(await pending, false);
  assert.equal(stopped, true);
  assert.equal(env.video.srcObject, null);
});

test('decoder failure stops the camera and reports the error', async t => {
  const env = setup(t);
  const error = new Error('decode failed');
  env.window.jsQR = () => { throw error; };
  await env.camera.start();
  env.scan();
  assert.equal(env.stopped(), 1);
  assert.deepEqual(env.errors, [error]);
});

test('stopped or replaced streams cannot report a result from an old frame', async t => {
  const env = setup(t, { data: 'old frame' });
  await env.camera.start();
  env.camera.stop();
  env.scan();
  assert.deepEqual(env.results, []);
  await env.camera.start();
  env.video.srcObject = null;
  env.scan();
  assert.deepEqual(env.results, []);
  env.camera.stop();
});

test('camera crops its guide, matches letterboxed previews, and periodically finds off-center codes', async t => {
  const env = setup(t);
  env.video.clientWidth = 600;
  env.video.clientHeight = 600;
  await env.camera.start();
  for (let i = 0; i < 4; i++) env.scan();
  assert.equal(env.draws.length, 4);
  assert.deepEqual(env.draws[0].slice(1), [600, 180, 720, 720, 0, 0, 640, 640]);
  assert.deepEqual(env.scanRegion.style, { left: '187.5px', top: '187.5px', width: '225px', height: '225px' });
  env.window.jsQR = () => env.draws.at(-1)[3] === 1920 ? { data: 'off-center QR' } : null;
  env.scan();
  assert.deepEqual(env.draws.at(-1).slice(1), [0, 0, 1920, 1080, 0, 0, 1280, 720]);
  assert.deepEqual(env.results, ['off-center QR']);
  assert.equal(env.stopped(), 1);
});

test('portrait guide adapts to preview resizing and fallback cadence restarts with the camera', async t => {
  const env = setup(t);
  Object.assign(env.video, { videoWidth: 1080, videoHeight: 1920, clientWidth: 300, clientHeight: 400 });
  await env.camera.start();
  env.scan();
  assert.deepEqual(env.draws[0].slice(1, 5), [180, 600, 720, 720]);
  assert.equal(env.scanRegion.style.width, '150px');
  env.video.clientWidth = 600;
  env.video.clientHeight = 800;
  env.scan();
  assert.equal(env.scanRegion.style.width, '300px');
  await env.camera.start();
  const previousDraws = env.draws.length;
  for (let i = 0; i < 4; i++) env.scan();
  assert.equal(env.draws.length - previousDraws, 4);
  env.camera.stop();
});
