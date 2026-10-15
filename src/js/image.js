import { findQRRegions } from "./locator.js";
import { createQRScanner } from "./scan.js";

// Selection coordinates are fractions of the original image, independent of preview size.
export function createImageScanner({ preview, stage, selection, onResult, onStatus, onReady, onSelection, onDiagnostics }){
  const canvas = document.createElement("canvas");
  const scanner = createQRScanner({ canvas, decoder: (...args) => window.jsQR(...args), locate: findQRRegions });
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

  function decode(){
    if (!image || drag || busy) return;
    onDiagnostics?.(null);
    try {
      const x = Math.min(image.naturalWidth - 1, Math.floor(region.x * image.naturalWidth));
      const y = Math.min(image.naturalHeight - 1, Math.floor(region.y * image.naturalHeight));
      const width = Math.max(1, Math.min(image.naturalWidth - x, Math.ceil(region.width * image.naturalWidth)));
      const height = Math.max(1, Math.min(image.naturalHeight - y, Math.ceil(region.height * image.naturalHeight)));
      // Explicit selection never searches outside its bounds.
      const code = scanner.readRegion(image, { x, y, width, height });
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
    try {
      const report = await scanner.scan(image, { isCurrent: current, onStatus, onDiagnostics });
      if (current() && report?.results.length) onResult(report.results[0].text);
    } catch {
      if (current()) onStatus("image.decodeFailed");
    } finally {
      if (current()){ busy = false; onReady(true); }
    }
  }

  return { load, clear, reset, decode, decodeWhole };
}
