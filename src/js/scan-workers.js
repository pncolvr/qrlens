// Keep CPU-heavy decoders off the UI thread. At most two pixel buffers are active.
export function createScanWorkers({ createWorker = () => new Worker(new URL("./scan-worker.js", import.meta.url), { type: "module" }), concurrency = Math.min(2, globalThis.navigator?.hardwareConcurrency || 2) } = {}){
  const slots = Array.from({ length: Math.max(1, Math.min(2, concurrency)) }, () => ({ worker: null, task: null }));
  const queue = [];
  let nextId = 0;

  function finish(slot, value, error){
    const task = slot.task;
    if (!task) return;
    slot.task = null;
    task.signal?.removeEventListener("abort", task.abort);
    if (error) task.reject(error); else task.resolve(value);
    pump();
  }
  function reset(slot){ slot.worker?.terminate(); slot.worker = null; }
  function pump(){
    for (const slot of slots){
      if (slot.task || !queue.length) continue;
      const task = queue.shift();
      slot.task = task;
      try {
        if (!slot.worker){
          slot.worker = createWorker();
          slot.worker.onmessage = event => {
            if (event.data.id !== slot.task?.id) return;
            if (event.data.error) finish(slot, null, new Error(event.data.error));
            else finish(slot, event.data.result);
          };
          const worker = slot.worker;
          worker.onerror = event => {
            event?.preventDefault?.();
            if (slot.worker !== worker) return;
            reset(slot); finish(slot, null, new Error("QR worker failed"));
          };
        }
        // The caller supplies a fresh buffer; transfer ownership rather than clone it.
        slot.worker.postMessage({ id: task.id, ...task.input }, [task.input.pixels.data.buffer]);
      } catch(error){ reset(slot); finish(slot, null, error); }
    }
  }
  function run(input, { signal } = {}){
    if (signal?.aborted) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const task = { id: ++nextId, input, signal, resolve, reject };
      task.abort = () => {
        const index = queue.indexOf(task);
        if (index >= 0){ queue.splice(index, 1); signal.removeEventListener("abort", task.abort); resolve(null); }
        const slot = slots.find(slot => slot.task === task);
        // Termination also cancels synchronous WASM/JS work that cannot receive a message.
        if (slot){ reset(slot); finish(slot, null); }
      };
      signal?.addEventListener("abort", task.abort, { once: true });
      queue.push(task); pump();
    });
  }
  function dispose(){
    for (const task of queue.splice(0)){ task.signal?.removeEventListener("abort", task.abort); task.resolve(null); }
    for (const slot of slots){ reset(slot); finish(slot, null); }
  }
  return { run, dispose };
}

let shared;
export function getScanWorkers(){ return shared ||= createScanWorkers(); }
