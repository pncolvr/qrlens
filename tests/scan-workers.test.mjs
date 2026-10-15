import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScanWorkers } from '../src/js/scan-workers.js';

const input = () => ({ engine: 'jsqr', pixels: { data: new Uint8ClampedArray(4), width: 1, height: 1 } });
function setup(){
  const created = [];
  const pool = createScanWorkers({ concurrency: 2, createWorker(){
    const worker = { terminated: false, postMessage(message, transfer){ this.message = message; this.transfer = transfer; }, terminate(){ this.terminated = true; }, complete(value){ this.onmessage({ data: { id: this.message.id, result: value } }); } };
    created.push(worker); return worker;
  } });
  return { pool, created };
}

test('worker pool bounds concurrent decoding and transfers pixel buffers', async () => {
  const { pool, created } = setup();
  const tasks = [pool.run(input()), pool.run(input()), pool.run(input())];
  assert.equal(created.length, 2);
  assert.equal(created[0].transfer[0], created[0].message.pixels.data.buffer);
  created[0].complete('first');
  created[1].complete('second');
  created[0].complete('third');
  assert.deepEqual(await Promise.all(tasks), ['first', 'second', 'third']);
  pool.dispose();
});

test('region cancellation terminates active siblings and removes queued retries without cancelling another region', async () => {
  const { pool, created } = setup(), region = new AbortController();
  const tasks = [pool.run(input(), { signal: region.signal }), pool.run(input(), { signal: region.signal }), pool.run(input(), { signal: region.signal })];
  const other = pool.run(input());
  region.abort();
  assert.deepEqual(await Promise.all(tasks), [null, null, null]);
  assert.ok(created.slice(0, 2).every(worker => worker.terminated));
  const active = created.findLast(worker => !worker.terminated);
  active.complete('other QR');
  assert.equal(await other, 'other QR');
  pool.dispose();
});

test('worker startup failure rejects the task and leaves the pool usable', async () => {
  const pool = createScanWorkers({ createWorker(){ throw new Error('blocked'); } });
  await assert.rejects(pool.run(input()), /blocked/);
  await assert.rejects(pool.run(input()), /blocked/);
  pool.dispose();
});
