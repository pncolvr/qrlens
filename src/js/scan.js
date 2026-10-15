import { findQRRegions } from "./locator.js";

// Quarter-turns copy RGBA pixels without interpolation or clipping.
export function rotateClockwise({ data, width, height }){
  const rotated = new Uint8ClampedArray(data.length);
  const source = new Uint32Array(data.buffer, data.byteOffset, width * height);
  const target = new Uint32Array(rotated.buffer);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) target[x * height + height - 1 - y] = source[y * width + x];
  return { data: rotated, width: height, height: width };
}

export function createQRScanner({ canvas, decoder, locate = findQRRegions, createCanvas = () => document.createElement("canvas") }){
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const dimensions = source => ({ width: source.naturalWidth || source.width, height: source.naturalHeight || source.height });
  const pause = () => new Promise(resolve => setTimeout(resolve, 0));

  function pixelsFor(source, rect, maxSize){
    const scale = Math.min(1, maxSize / Math.max(rect.width, rect.height));
    canvas.width = Math.max(1, Math.round(rect.width * scale));
    canvas.height = Math.max(1, Math.round(rect.height * scale));
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
    return context.getImageData(0, 0, canvas.width, canvas.height);
  }

  function readRegion(source, rect, passes = [], firstPixels, maxSizes = [1280, 2560]){
    let lastError = null, completed = false;
    for (const maxSize of maxSizes){
      let pixels = maxSize === maxSizes[0] && firstPixels ? firstPixels : pixelsFor(source, rect, maxSize);
      const baseWidth = pixels.width, baseHeight = pixels.height;
      for (const rotation of [0, 90, 180, 270]){
        const pass = { width: pixels.width, height: pixels.height, rotation, outcome: "miss" };
        passes.push(pass);
        try {
          const code = decoder(pixels.data, pixels.width, pixels.height);
          completed = true;
          if (code && typeof code.data === "string"){
            pass.outcome = "success";
            const corners = ["topLeftCorner", "topRightCorner", "bottomRightCorner", "bottomLeftCorner"].map(key => code.location?.[key]);
            const location = corners.every(Boolean) ? corners.map(point => {
              const [x, y] = rotation === 90 ? [point.y, baseHeight - point.x] : rotation === 180 ? [baseWidth - point.x, baseHeight - point.y] : rotation === 270 ? [baseWidth - point.y, point.x] : [point.x, point.y];
              return { x: rect.x + x * rect.width / baseWidth, y: rect.y + y * rect.height / baseHeight };
            }) : null;
            return { ...code, sourceLocation: location };
          }
        } catch(error){ pass.outcome = "error"; lastError = error; }
        if (rotation !== 270) pixels = rotateClockwise(pixels);
      }
      if (Math.max(rect.width, rect.height) <= maxSize) break;
    }
    if (!completed && lastError) throw lastError;
    return null;
  }

  async function scan(source, { collectAll = false, analysisMaxSize = 1280, maxSizes = [1280, 2560], onDiagnostics = () => {}, onStatus = () => {}, isCurrent = () => true, signal } = {}){
    if (typeof Worker !== "undefined"){
      try {
        const { scanInWorkers } = await import("./worker-scan.js");
        return await scanInWorkers(source, { collectAll, analysisMaxSize, maxSizes, onDiagnostics, onStatus, isCurrent, signal }, { pixelsFor, locate, createCanvas });
      } catch {
        // Browsers that block module workers keep the established JS scanner.
        if (signal?.aborted || !isCurrent()) return null;
      }
    }
    const full = { x: 0, y: 0, ...dimensions(source) };
    const report = { image: source, finders: [], attempts: [], results: [], proposals: 0, phase: "regions", locatorFailed: false };
    let analysis, regions = [], masked = null, maskContext = null;
    const seen = new Set(), maskedLocations = new Set();
    function remember(code){
      if (!seen.has(code.data)){
        seen.add(code.data);
        report.results.push({ text: code.data, location: code.sourceLocation });
      }
      if (!collectAll || !code.sourceLocation) return false;
      const xs = code.sourceLocation.map(point => point.x), ys = code.sourceLocation.map(point => point.y);
      const x = Math.max(0, Math.floor(Math.min(...xs)) - 2), y = Math.max(0, Math.floor(Math.min(...ys)) - 2);
      const width = Math.min(full.width - x, Math.ceil(Math.max(...xs)) + 2 - x), height = Math.min(full.height - y, Math.ceil(Math.max(...ys)) + 2 - y);
      const key = [x, y, width, height].map(value => Math.round(value / 4)).join(",");
      if (width <= 0 || height <= 0 || maskedLocations.has(key)) return false;
      maskedLocations.add(key);
      if (!masked){
        masked = createCanvas();
        masked.width = full.width; masked.height = full.height;
        maskContext = masked.getContext("2d");
        maskContext.drawImage(source, 0, 0, full.width, full.height);
      }
      maskContext.fillStyle = "#fff";
      maskContext.fillRect(x, y, width, height);
      return true;
    }
    async function attempt(rect, scope, pixels){
      await pause();
      if (!isCurrent()) return null;
      const entry = { rect, scope, passes: [], outcome: "miss" };
      report.attempts.push(entry);
      let code;
      try {
        code = readRegion(scope !== "region" && masked ? masked : source, rect, entry.passes, pixels, maxSizes);
        if (code) entry.outcome = "success";
      } catch { entry.outcome = "error"; }
      return code;
    }
    try {
      onStatus("image.locating");
      await pause();
      if (!isCurrent()) return null;
      try {
        analysis = pixelsFor(source, full, analysisMaxSize);
        const located = locate(analysis), sx = full.width / analysis.width, sy = full.height / analysis.height;
        report.finders = located.finders.map(point => ({ x: point.x * sx, y: point.y * sy, width: point.module * 7 * sx, height: point.module * 7 * sy }));
        regions = located.regions.filter(rect => rect.finders?.length === 3).map(rect => {
          const x = Math.max(0, Math.floor(rect.x * sx)), y = Math.max(0, Math.floor(rect.y * sy));
          return { x, y, width: Math.min(full.width - x, Math.ceil(rect.width * sx)), height: Math.min(full.height - y, Math.ceil(rect.height * sy)) };
        });
      } catch { report.locatorFailed = true; }
      report.proposals = regions.length;
      onDiagnostics(report);
      for (const rect of regions){
        onStatus("image.tryingRegions");
        const code = await attempt(rect, "region");
        if (!isCurrent()) return null;
        if (code){
          remember(code);
          if (!collectAll){ report.phase = "complete"; onDiagnostics(report); return report; }
        }
        onDiagnostics(report);
      }
      report.phase = "fallback";
      onStatus(regions.length ? "image.fallbackRegions" : "image.fallbackNoRegions");
      onDiagnostics(report);
      // Mask decoded symbols in a working copy to let jsQR find other codes on the page.
      while (isCurrent()){
        const cached = !masked && analysisMaxSize === maxSizes[0] ? analysis : undefined;
        const code = await attempt(full, "whole", cached);
        if (!isCurrent()) return null;
        const continueScanning = code ? remember(code) : false;
        onDiagnostics(report);
        if (!code || !collectAll || !continueScanning) break;
      }
      report.phase = "complete";
      onDiagnostics(report);
      if (!report.results.length) onStatus(report.attempts.at(-1)?.outcome === "error" ? "image.decodeFailed" : "image.noCodeWhole");
      return report;
    } finally {
      if (masked) masked.width = masked.height = 0;
    }
  }

  return { readRegion, scan };
}
