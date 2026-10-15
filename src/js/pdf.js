import { createQRScanner } from "./scan.js";

const PDF_ASSETS = new URL("../vendor/pdfjs-6.4.299/", import.meta.url);

async function loadPDFEngine(){
  const pdfjs = await import("../vendor/pdfjs-6.4.299/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdf.worker.mjs", PDF_ASSETS).href;
  return pdfjs;
}

export function createPDFScanner({ onStart, onProgress, onPage, onComplete, onError, loadEngine = loadPDFEngine, createCanvas = () => document.createElement("canvas"), decoder = (...args) => window.jsQR(...args), createScanner = createQRScanner }){
  let currentJob = null;

  function cancel(){
    const job = currentJob;
    currentJob = null;
    if (!job) return;
    job.abort.abort();
    job.render?.cancel();
    // Destroying the loading task also terminates its worker and active document.
    job.destroying ||= Promise.resolve(job.loading?.destroy()).catch(() => {});
  }

  async function scan(file){
    cancel();
    const job = { loading: null, render: null, destroying: null, abort: new AbortController() };
    currentJob = job;
    const active = () => currentJob === job;
    const summary = { pages: 0, processed: 0, codes: 0, unreadable: 0, errors: 0, name: file.name };
    onStart({ name: file.name });
    let surface, scratch;
    try {
      const engine = await loadEngine();
      if (!active()) return;
      const data = new Uint8Array(await file.arrayBuffer());
      if (!active()) return;
      job.loading = engine.getDocument({
        data, isEvalSupported: false, enableXfa: false,
        cMapUrl: new URL("cmaps/", PDF_ASSETS).href, cMapPacked: true,
        standardFontDataUrl: new URL("standard_fonts/", PDF_ASSETS).href,
        wasmUrl: new URL("wasm/", PDF_ASSETS).href,
        iccUrl: new URL("iccs/", PDF_ASSETS).href
      });
      const pdf = await job.loading.promise;
      if (!active()) return;
      summary.pages = pdf.numPages;
      surface = createCanvas(); scratch = createCanvas();
      const scanner = createScanner({ canvas: scratch, decoder, createCanvas });
      for (let pageNumber = 1; pageNumber <= pdf.numPages && active(); pageNumber++){
        onProgress({ page: pageNumber, total: pdf.numPages });
        onPage({ page: pageNumber, state: "rendering", results: [] });
        let page;
        try {
          page = await pdf.getPage(pageNumber);
          if (!active()) break;
          let report;
          const pageResults = new Map();
          const decodedBoxes = [], unreadableBoxes = [], provisional = [];
          const overlaps = (a, b) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)) > .45 * Math.max(a.width * a.height, b.width * b.height);
          for (const size of [2048, 3072]){
            const original = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({ scale: size / Math.max(original.width, original.height) });
            surface.width = Math.max(1, Math.ceil(viewport.width));
            surface.height = Math.max(1, Math.ceil(viewport.height));
            const context = surface.getContext("2d", { willReadFrequently: true });
            job.render = page.render({ canvasContext: context, viewport, background: "rgb(255,255,255)" });
            await job.render.promise;
            job.render = null;
            if (!active()) break;
            onPage({ page: pageNumber, state: "scanning", size });
            report = await scanner.scan(surface, {
              collectAll: true, analysisMaxSize: size === 2048 ? 1280 : 2048,
              maxSizes: size === 2048 ? [1280, 2048] : [2048, 3072], isCurrent: active, signal: job.abort.signal,
              onDiagnostics(trace){ if (active()) onPage({ page: pageNumber, state: "scanning", size, trace }); }
            });
            if (!active()) break;
            onPage({ page: pageNumber, state: "passComplete", size });
            for (const result of report?.results || []) pageResults.set(result.text, result);
            const normalize = box => ({ x: box.x / surface.width, y: box.y / surface.height, width: box.width / surface.width, height: box.height / surface.height });
            const boxFor = result => {
              const xs = result.location.map(p => p.x), ys = result.location.map(p => p.y);
              return normalize({ x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) });
            };
            for (const result of report?.results || []) if (result.location?.length === 4){
              decodedBoxes.push(boxFor(result));
            }
            for (const result of report?.unverified || []) if (result.location?.length === 4){
              const box = boxFor(result), old = provisional.find(candidate => overlaps(candidate.box, box));
              if (!old) provisional.push({ box, result });
              else if (result.text.length > old.result.text.length) old.result = result;
            }
            for (const rect of report?.unreadable || []){
              const box = normalize(rect);
              if (!unreadableBoxes.some(old => overlaps(old, box))) unreadableBoxes.push(box);
            }
            // A decoded symbol must not prevent a sharper retry for another
            // symbol whose finder/format data was located but failed validation.
            if (report?.results.length && !report.unreadable?.length) break;
          }
          if (!active()) break;
          const results = [...pageResults.values()].map(result => ({ ...result, page: pageNumber }));
          summary.codes += results.length;
          summary.processed++;
          const failed = !results.length && report?.attempts.at(-1)?.outcome === "error";
          if (failed) summary.errors++;
          const unreadable = unreadableBoxes.filter(box => !decodedBoxes.some(decoded => overlaps(box, decoded))).length;
          const unverified = provisional.filter(candidate => !pageResults.has(candidate.result.text) && !decodedBoxes.some(box => overlaps(box, candidate.box))).map(candidate => ({ ...candidate.result, page: pageNumber }));
          summary.unreadable += unreadable;
          onPage({ page: pageNumber, state: failed ? "error" : "complete", results, unreadable, unverified });
        } catch(error){
          if (!active()) break;
          summary.processed++; summary.errors++;
          onPage({ page: pageNumber, state: "error", results: [] });
        } finally {
          page?.cleanup();
          surface.width = surface.height = 0;
          scratch.width = scratch.height = 0;
        }
      }
      if (active()) onComplete(summary);
    } catch(error){
      if (active()) onError(error.name === "PasswordException" ? "pdf.passwordProtected" : "pdf.loadFailed");
    } finally {
      if (surface) surface.width = surface.height = 0;
      if (scratch) scratch.width = scratch.height = 0;
      job.destroying ||= Promise.resolve(job.loading?.destroy()).catch(() => {});
      await job.destroying;
      if (active()) currentJob = null;
    }
  }

  return { scan, cancel };
}
