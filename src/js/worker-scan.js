import { getScanWorkers } from "./scan-workers.js";

function bounds(points){
  if (points?.length !== 4 || points.some(point => !Number.isFinite(point?.x) || !Number.isFinite(point?.y))) return null;
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const rect = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  const area = Math.abs(points.reduce((sum, p, i) => sum + p.x * points[(i + 1) % 4].y - p.y * points[(i + 1) % 4].x, 0)) / 2;
  // Decoder errors can include degenerate guesses on text. Do not call those QR detections.
  return rect.width >= 8 && rect.height >= 8 && area > rect.width * rect.height * .4 ? rect : null;
}

function overlaps(a, b){
  const intersection = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return intersection / Math.max(a.width * a.height, b.width * b.height) > .45;
}

export async function scanInWorkers(source, { collectAll, analysisMaxSize, maxSizes, onDiagnostics, onStatus, isCurrent, signal }, { pixelsFor, locate, createCanvas = () => document.createElement("canvas"), workers = getScanWorkers() }){
  const full = { x: 0, y: 0, width: source.naturalWidth || source.width, height: source.naturalHeight || source.height };
  const report = { image: source, finders: [], proposals: 0, attempts: [], results: [], unverified: [], unreadable: [], phase: "regions", locatorFailed: false };
  const decoded = [], rejected = [], candidates = [], provisional = [], seen = new Set();
  const active = () => !signal?.aborted && isCurrent();
  function emit(){
    report.unreadable = rejected.filter(rect => !decoded.some(found => overlaps(rect, found)));
    report.unverified = provisional.filter(candidate => !seen.has(candidate.result.text) && !decoded.some(found => overlaps(candidate.box, found))).map(candidate => candidate.result);
    if (active()) onDiagnostics(report);
  }
  function remember(code, rect, width, height){
    const points = code.points?.map(p => ({ x: rect.x + p.x * rect.width / width, y: rect.y + p.y * rect.height / height }));
    const box = bounds(points);
    if (typeof code.text === "string"){
      if (!seen.has(code.text)){ seen.add(code.text); report.results.push({ text: code.text, location: points }); }
      if (box) decoded.push(box);
      return true;
    }
    if (box){
      let rejectedRegion = rejected.find(old => overlaps(old, box));
      if (!rejectedRegion){ rejectedRegion = { ...box, reasons: [] }; rejected.push(rejectedRegion); }
      if (typeof code.error === "string" && code.error && !rejectedRegion.reasons.includes(code.error)) rejectedRegion.reasons.push(code.error);
      if (code.error?.startsWith("ChecksumError") && typeof code.unverifiedText === "string" && code.unverifiedText.length){
        const candidate = provisional.find(old => overlaps(old.box, box));
        const result = { text: code.unverifiedText, location: points, verified: false, error: code.error };
        if (!candidate) provisional.push({ box, result });
        else if (result.text.length > candidate.result.text.length) candidate.result = result;
      }
    }
    return false;
  }
  async function attempt(rect, scope, engine, { maxSize = maxSizes.at(-1), binarizer, rotations = [0], taskSignal = signal, image = source } = {}){
    if (!active() || taskSignal?.aborted) return false;
    const entry = { rect, scope, passes: [], outcome: "pending" };
    report.attempts.push(entry);
    try {
      const pixels = pixelsFor(image, rect, maxSize), { width, height } = pixels;
      const response = await workers.run({ pixels, engine, binarizer, rotations }, { signal: taskSignal });
      if (!active()) return false;
      if (!response || taskSignal?.aborted){ entry.outcome = "cancelled"; emit(); return false; }
      entry.passes = response.passes;
      entry.errors = [...new Set(response.codes.filter(code => typeof code.text !== "string" && bounds(code.points)).map(code => code.error).filter(error => typeof error === "string" && error))];
      const successes = response.codes.map(code => remember(code, rect, width, height));
      entry.outcome = successes.some(Boolean) ? "success" : response.codes.some(code => bounds(code.points)) ? "unreadable" : "miss";
      if (entry.outcome === "miss") entry.passes = entry.passes.map(pass => pass.outcome === "unreadable" ? { ...pass, outcome: "miss" } : pass);
      emit();
      return successes.some(Boolean);
    } catch(error){
      if (active()){
        entry.outcome = taskSignal?.aborted ? "cancelled" : "error";
        if (entry.outcome === "error") entry.errors = [String(error.message || error)];
        emit();
      }
      return false;
    }
  }
  function addCandidate(rect){
    const x = Math.max(0, Math.floor(rect.x)), y = Math.max(0, Math.floor(rect.y));
    rect = { x, y, width: Math.min(full.width, Math.ceil(rect.x + rect.width)) - x, height: Math.min(full.height, Math.ceil(rect.y + rect.height)) - y };
    if (rect.width <= 0 || rect.height <= 0) return;
    if (!candidates.some(old => overlaps(old, rect))) candidates.push(rect);
  }
  onStatus("image.locating");
  try {
    const analysis = pixelsFor(source, full, analysisMaxSize), located = locate(analysis), sx = full.width / analysis.width, sy = full.height / analysis.height;
    report.finders = located.finders.map(p => ({ x: p.x * sx, y: p.y * sy, width: p.module * 7 * sx, height: p.module * 7 * sy }));
    located.regions.filter(rect => rect.finders?.length === 3).forEach(rect => addCandidate({ x: rect.x * sx, y: rect.y * sy, width: rect.width * sx, height: rect.height * sy }));
  } catch { report.locatorFailed = true; }
  report.proposals = candidates.length;
  emit();
  for (const rect of candidates){
    if (!active()) return null;
    if (decoded.some(found => overlaps(rect, found))) continue;
    report.phase = "regions";
    onStatus("image.tryingRegions");
    const region = new AbortController();
    const abort = () => region.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      // Competing strategies share a region cancellation signal. The first
      // successful decode terminates its sibling; other regions stay eligible.
      await Promise.all([
        attempt(rect, "region", "jsqr", { maxSize: 1280, rotations: [0, 90, 180, 270], taskSignal: region.signal }).then(found => { if (found && decoded.some(box => overlaps(rect, box))) region.abort(); }),
        attempt(rect, "region", "zxing", { binarizer: "GlobalHistogram", taskSignal: region.signal }).then(found => { if (found && decoded.some(box => overlaps(rect, box))) region.abort(); })
      ]);
      if (!region.signal.aborted) await attempt(rect, "region", "zxing", { binarizer: "FixedThreshold" });
      if (!decoded.some(box => overlaps(rect, box)) && Math.max(rect.width, rect.height) > 1280) await attempt(rect, "region", "jsqr");
    } finally { signal?.removeEventListener("abort", abort); }
    if (!collectAll && report.results.length) break;
  }
  if (!active()) return null;
  if (!collectAll && report.results.length){ report.phase = "complete"; emit(); return report; }
  // PDF scans still check the whole page for symbols outside the proposed crops.
  report.phase = report.results.length ? "whole" : "fallback";
  onStatus(report.results.length ? "image.searchingWhole" : candidates.length ? "image.fallbackRegions" : "image.fallbackNoRegions");
  emit();
  const primaryFound = await attempt(full, "whole", "zxing");
  if (!active()) return null;
  if (!collectAll && report.results.length){ report.phase = "complete"; emit(); return report; }
  if (!report.results.length){
    report.phase = "fallback";
    onStatus(candidates.length ? "image.fallbackRegions" : "image.fallbackNoRegions"); emit();
    // Quarter-turn retries stay inside finder-triple crops. The fallback only
    // decodes the whole image; it never creates additional speculative crops.
    await attempt(full, "whole", "jsqr", { maxSize: maxSizes[0] });
    if (!report.results.length && maxSizes.at(-1) > maxSizes[0] && Math.max(full.width, full.height) > maxSizes[0]) await attempt(full, "whole", "jsqr");
  }
  if (!active()) return null;
  if (collectAll && !primaryFound && decoded.length){
    const masked = createCanvas();
    masked.width = full.width; masked.height = full.height;
    const context = masked.getContext("2d"), maskedKeys = new Set();
    context.drawImage(source, 0, 0, full.width, full.height);
    context.fillStyle = "#fff";
    try {
      while (active()){
        let added = false;
        for (const box of decoded){
          const key = [box.x, box.y, box.width, box.height].map(n => Math.round(n / 4)).join(",");
          if (maskedKeys.has(key)) continue;
          maskedKeys.add(key); added = true;
          context.fillRect(Math.max(0, box.x - 3), Math.max(0, box.y - 3), box.width + 6, box.height + 6);
        }
        if (!added) break;
        const found = await attempt(full, "whole", "zxing", { image: masked });
        if (!found && !await attempt(full, "whole", "jsqr", { image: masked, maxSize: maxSizes[0] })) break;
      }
    } finally { masked.width = masked.height = 0; }
  }
  if (!active()) return null;
  if (report.attempts.length && report.attempts.every(entry => entry.outcome === "error")) throw new Error("QR workers unavailable");
  report.phase = "complete"; emit();
  if (!report.results.length) onStatus(report.unreadable.length ? "image.unreadable" : "image.noCodeWhole");
  return report;
}
