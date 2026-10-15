import { findQRRegions } from "./locator.js";

// Copy whole RGBA pixels so quarter-turns introduce no interpolation or clipping.
export function rotateClockwise({ data, width, height }){
  const rotated = new Uint8ClampedArray(data.length);
  const source = new Uint32Array(data.buffer, data.byteOffset, width * height);
  const target = new Uint32Array(rotated.buffer);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++){
    target[x * height + height - 1 - y] = source[y * width + x];
  }
  return { data: rotated, width: height, height: width };
}

// Selection coordinates are fractions of the original image, independent of preview size.
export function createImageScanner({ preview, stage, selection, onResult, onStatus, onReady, onSelection, onDiagnostics }){
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  let image = null, imageURL = null, generation = 0, drag = null, busy = false;
  let region = { x: 0, y: 0, width: 1, height: 1 };
  const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));

  function render(){
    Object.assign(selection.style, {
      left: `${region.x * 100}%`, top: `${region.y * 100}%`,
      width: `${region.width * 100}%`, height: `${region.height * 100}%`
    });
    selection.classList.toggle("hidden", !image);
    if (image) onSelection?.(region);
  }

  function reset(){
    region = { x: 0, y: 0, width: 1, height: 1 };
    drag = null;
    render();
    if (image) onStatus("image.instructions");
  }

  function clear(){
    generation++;
    busy = false;
    image = null;
    drag = null;
    preview.removeAttribute("src");
    stage.classList.add("hidden");
    if (imageURL) URL.revokeObjectURL(imageURL);
    imageURL = null;
    canvas.width = canvas.height = 0;
    onReady(false);
    render();
  }

  async function load(file){
    clear();
    onDiagnostics?.(null);
    const request = generation;
    onStatus("image.loading");
    const candidate = new Image();
    try {
      imageURL = URL.createObjectURL(file);
      await new Promise((resolve, reject) => {
        candidate.onload = resolve;
        candidate.onerror = reject;
        candidate.src = imageURL;
      });
      if (request !== generation) return;
      if (!candidate.naturalWidth || !candidate.naturalHeight) throw new Error("Empty image");
      image = candidate;
      // Size the selection surface itself, so tall images cannot leave blank space beside the preview.
      stage.style.aspectRatio = `${image.naturalWidth} / ${image.naturalHeight}`;
      stage.style.width = `min(100%, ${image.naturalWidth}px, ${60 * image.naturalWidth / image.naturalHeight}dvh)`;
      preview.src = imageURL;
      stage.classList.remove("hidden");
      reset();
      onReady(true);
      stage.focus();
    } catch {
      if (request !== generation) return;
      clear();
      onStatus("image.loadFailed");
    }
  }

  function point(event){
    const bounds = stage.getBoundingClientRect();
    return { x: clamp((event.clientX - bounds.left) / bounds.width), y: clamp((event.clientY - bounds.top) / bounds.height) };
  }

  stage.addEventListener("pointerdown", event => {
    if (!image || busy || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    stage.focus();
    stage.setPointerCapture(event.pointerId);
    drag = { ...point(event), pointerId: event.pointerId, previous: { ...region } };
  });

  function move(event){
    if (!drag || drag.pointerId !== event.pointerId) return;
    const end = point(event);
    region = {
      x: Math.min(drag.x, end.x), y: Math.min(drag.y, end.y),
      width: Math.abs(end.x - drag.x), height: Math.abs(end.y - drag.y)
    };
    render();
  }

  stage.addEventListener("pointermove", move);
  stage.addEventListener("pointerup", event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    move(event);
    // Ignore taps and accidental tiny boxes.
    const bounds = stage.getBoundingClientRect();
    if (region.width * bounds.width < 8 || region.height * bounds.height < 8) region = drag.previous;
    drag = null;
    stage.releasePointerCapture(event.pointerId);
    render();
    onStatus("image.instructions");
  });
  stage.addEventListener("lostpointercapture", () => {
    if (drag){ region = drag.previous; drag = null; render(); }
  });
  stage.addEventListener("pointercancel", () => {
    if (drag){ region = drag.previous; drag = null; render(); }
  });
  stage.addEventListener("keydown", event => {
    if (!image || busy) return;
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!direction) return;
    event.preventDefault();
    const [dx, dy] = direction.map(value => value * .02);
    if (event.shiftKey){
      region.width = clamp(region.width + dx, Math.min(.02, 1 - region.x), 1 - region.x);
      region.height = clamp(region.height + dy, Math.min(.02, 1 - region.y), 1 - region.y);
    } else {
      region.x = clamp(region.x + dx, 0, 1 - region.width);
      region.y = clamp(region.y + dy, 0, 1 - region.height);
    }
    render();
    onStatus("image.instructions");
  });

  function pixelsFor(rect, maxSize){
    const scale = Math.min(1, maxSize / Math.max(rect.width, rect.height));
    canvas.width = Math.max(1, Math.round(rect.width * scale));
    canvas.height = Math.max(1, Math.round(rect.height * scale));
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
    return context.getImageData(0, 0, canvas.width, canvas.height);
  }

  function readRegion(rect, passes = [], firstPixels){
    let lastError = null, completed = false;
    for (const maxSize of [1280, 2560]){
      let pixels = maxSize === 1280 && firstPixels ? firstPixels : pixelsFor(rect, maxSize);
      for (const rotation of [0, 90, 180, 270]){
        const pass = { width: pixels.width, height: pixels.height, rotation, outcome: "miss" };
        passes.push(pass);
        try {
          const code = window.jsQR(pixels.data, pixels.width, pixels.height);
          completed = true;
          if (code && typeof code.data === "string"){ pass.outcome = "success"; return code; }
        } catch(error){ pass.outcome = "error"; lastError = error; }
        if (rotation !== 270) pixels = rotateClockwise(pixels);
      }
      if (Math.max(rect.width, rect.height) <= maxSize) break;
    }
    if (!completed && lastError) throw lastError;
    return null;
  }

  function decode(){
    if (!image || drag || busy) return;
    onDiagnostics?.(null);
    try {
      const x = Math.min(image.naturalWidth - 1, Math.floor(region.x * image.naturalWidth));
      const y = Math.min(image.naturalHeight - 1, Math.floor(region.y * image.naturalHeight));
      const width = Math.max(1, Math.min(image.naturalWidth - x, Math.ceil(region.width * image.naturalWidth)));
      const height = Math.max(1, Math.min(image.naturalHeight - y, Math.ceil(region.height * image.naturalHeight)));
      // Explicit selection never searches outside its bounds.
      const code = readRegion({ x, y, width, height });
      if (code){ onResult(code.data); return; }
      onStatus("image.noCode");
    } catch {
      onStatus("image.decodeFailed");
    }
  }

  async function decodeWhole(){
    if (!image || drag || busy) return;
    reset();
    busy = true;
    onReady(false);
    const request = generation;
    const current = () => request === generation;
    // Let statuses and debug attempts paint between bounded chunks of work.
    const pause = () => new Promise(resolve => setTimeout(resolve, 0));
    const full = { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight };
    const report = { image, finders: [], attempts: [], proposals: 0, phase: "regions", locatorFailed: false };
    try {
      onStatus("image.locating");
      await pause();
      if (!current()) return;
      let analysis, regions = [];
      try {
        analysis = pixelsFor(full, 1280);
        const located = findQRRegions(analysis);
        const sx = full.width / analysis.width, sy = full.height / analysis.height;
        report.finders = located.finders.map(point => ({ x: point.x * sx, y: point.y * sy, width: point.module * 7 * sx, height: point.module * 7 * sy }));
        regions = located.regions.map(rect => {
          const x = Math.max(0, Math.floor(rect.x * sx)), y = Math.max(0, Math.floor(rect.y * sy));
          return { x, y, width: Math.min(full.width - x, Math.ceil(rect.width * sx)), height: Math.min(full.height - y, Math.ceil(rect.height * sy)) };
        });
      } catch { report.locatorFailed = true; }
      report.proposals = regions.length;
      onDiagnostics?.(report);
      for (const rect of [...regions, full]){
        const whole = rect === full;
        report.phase = whole ? "fallback" : "regions";
        onStatus(whole ? (regions.length ? "image.fallbackRegions" : "image.fallbackNoRegions") : "image.tryingRegions");
        onDiagnostics?.(report);
        await pause();
        if (!current()) return;
        const attempt = { rect, scope: whole ? "whole" : "region", passes: [], outcome: "miss" };
        report.attempts.push(attempt);
        let code;
        try {
          code = readRegion(rect, attempt.passes, whole ? analysis : undefined);
          if (code) attempt.outcome = "success";
        } catch { attempt.outcome = "error"; }
        report.phase = code || whole ? "complete" : "regions";
        onDiagnostics?.(report);
        if (code){ onResult(code.data); return; }
      }
      onStatus(report.attempts.at(-1)?.outcome === "error" ? "image.decodeFailed" : "image.noCodeWhole");
    } catch {
      if (current()) onStatus("image.decodeFailed");
    } finally {
      if (current()){ busy = false; onReady(true); }
    }
  }

  return { load, clear, reset, decode, decodeWhole };
}
