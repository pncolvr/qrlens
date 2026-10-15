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
    job.render?.cancel();
    // Destroying the loading task also terminates its worker and active document.
    job.destroying ||= Promise.resolve(job.loading?.destroy()).catch(() => {});
  }

  async function scan(file){
    cancel();
    const job = { loading: null, render: null, destroying: null };
    currentJob = job;
    const active = () => currentJob === job;
    const summary = { pages: 0, processed: 0, codes: 0, errors: 0, name: file.name };
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
              maxSizes: size === 2048 ? [1280, 2048] : [2048, 3072], isCurrent: active,
              onDiagnostics(trace){ if (active()) onPage({ page: pageNumber, state: "scanning", size, trace }); }
            });
            if (!active()) break;
            onPage({ page: pageNumber, state: "passComplete", size });
            if (report?.results.length) break;
          }
          if (!active()) break;
          const results = (report?.results || []).map(result => ({ ...result, page: pageNumber }));
          summary.codes += results.length;
          summary.processed++;
          const failed = !results.length && report?.attempts.at(-1)?.outcome === "error";
          if (failed) summary.errors++;
          onPage({ page: pageNumber, state: failed ? "error" : "complete", results });
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
