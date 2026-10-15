import { supported, createCamera } from "./camera.js";
import { parseQR } from "./qr.js";
import { createImageScanner } from "./image.js";
import { createDetectionDebug } from "./detection-debug.js";
import { createPDFScanner } from "./pdf.js";
import { createPDFView } from "./pdf-view.js";
import { initTranslations, t } from "../i18n/i18n.js";

const $ = id => document.getElementById(id);
const showCameraSwitch = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)
  && new URLSearchParams(location.search).get("showCameraSwitch") === "1";
let result = null, view = "start", installPrompt = null, imageStatus = "", selectedRegion = null;
let cameraRequest = 0, fileDragDepth = 0, importError = "";
const detectionDebug = createDetectionDebug({ container: $("detectionDebug"), canvas: $("detectionPreview"), summary: $("detectionSummary"), list: $("detectionAttempts"), t });

function showView(name){
  if (view === "image" && name !== "image") imageScanner.clear();
  if (["start", "camera", "image"].includes(name)){ pdfScanner.cancel(); pdfView.clear(); }
  if (name === "start" || name === "camera") detectionDebug.clear();
  view = name;
  for (const section of ["start", "camera", "image", "pdf", "result"]) $("view-" + section).classList.toggle("hidden", section !== name);
}

function showResult(text, source = null){
  result = { text, ...parseQR(text), source: source?.page ? source : null, unverified: source?.verified === false };
  $("resultStatus").textContent = "";
  renderResult();
  showView("result");
  $("resultTitle").focus();
}

const pdfView = createPDFView({ heading: $("pdfFilename"), status: $("pdfStatus"), pages: $("pdfPages"), stopButton: $("btnStopPdf"), t, onSelect: showResult });
const pdfScanner = createPDFScanner({ onStart: pdfView.start, onProgress: pdfView.progress, onPage: pdfView.update, onComplete: pdfView.complete, onError: pdfView.error });

const imageScanner = createImageScanner({
  preview: $("imagePreview"), stage: $("imageStage"), selection: $("imageSelection"),
  onResult(text, metadata){ if (view === "image" && !document.hidden) showResult(text, metadata); },
  onStatus(key){ imageStatus = key; $("imageStatus").textContent = t(key); },
  onReady(ready){ $("btnDecodeImage").disabled = $("btnWholeImage").disabled = !ready; },
  onSelection(region){ selectedRegion = { ...region }; renderSelection(); },
  onDiagnostics: report => detectionDebug.render(report)
});

function renderSelection(){
  if (!selectedRegion) return;
  const percentages = Object.fromEntries(Object.entries(selectedRegion).map(([key, value]) => [key, Math.round(value * 100)]));
  $("imageRegionStatus").textContent = t("image.selection", percentages);
}

function describeError(error){
  const key = { NotAllowedError: "permissionDenied", NotFoundError: "notFound", NotReadableError: "notReadable" }[error.name];
  return t(key ? `camera.${key}` : "camera.startFailed", { message: error.message });
}

function cameraError(error){
  showView("start");
  $("startError").textContent = describeError(error);
}

const camera = createCamera({
  video: $("video"),
  scanRegion: $("cameraRegion"),
  onStatus: ({ deviceCount }) => $("btnSwitch").classList.toggle("hidden", deviceCount < 2 && !showCameraSwitch),
  onError: cameraError,
  onResult(text){
    if (view !== "camera" || document.hidden || typeof text !== "string") return;
    showResult(text);
  }
});

async function startCamera(switchDevice = false){
  const request = ++cameraRequest;
  const { secure, hasMedia } = supported();
  $("startError").textContent = "";
  $("resultStatus").textContent = "";
  if (!secure || !hasMedia){
    showView("start");
    $("startError").textContent = t(secure ? "camera.unavailable" : "camera.insecure");
    return;
  }
  $("btnStart").disabled = $("btnSwitch").disabled = $("btnScanAgain").disabled = true;
  try {
    const started = await (switchDevice ? camera.switchDevice() : camera.start());
    if (started && request === cameraRequest) showView("camera");
  } catch(error){ if (request === cameraRequest) cameraError(error); }
  finally { if (request === cameraRequest) $("btnStart").disabled = $("btnSwitch").disabled = $("btnScanAgain").disabled = false; }
}

function openFile(file){
  if (!file) return;
  importError = "";
  $("importError").textContent = "";
  cameraRequest++;
  camera.stop();
  $("btnStart").disabled = $("btnSwitch").disabled = $("btnScanAgain").disabled = false;
  detectionDebug.clear();
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name || "")){
    showView("pdf");
    $("pdfFilename").focus();
    pdfScanner.scan(file);
  } else {
    showView("image");
    $("imageTitle").focus();
    imageScanner.load(file);
  }
}

function hideFileDrop(){
  fileDragDepth = 0;
  $("imageDropOverlay").classList.add("hidden");
}

function isFileDrag(event){
  return Array.from(event.dataTransfer?.types || []).includes("Files");
}

async function copy(text){
  try {
    await navigator.clipboard.writeText(text);
    $("resultStatus").textContent = t("result.copied");
  } catch {
    // The raw value remains selectable when clipboard access is unavailable.
    $("resultStatus").textContent = t("result.copyFailed");
    $("resultText").focus();
    $("resultText").select();
  }
}

function saveFile(file){
  const url = URL.createObjectURL(new Blob([file.content], { type: file.mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function icon(name){
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  svg.classList.add("ui-icon");
  svg.setAttribute("aria-hidden", "true");
  use.setAttribute("href", `#icon-${name}`);
  svg.append(use);
  return svg;
}

function renderResult(){
  if (!result) return;
  $("resultTitle").textContent = t(`type.${result.type}`);
  $("resultWarning").textContent = result.unverified ? t("result.unverified") : "";
  $("resultSource").textContent = result.source ? t("pdf.resultSource", result.source) : "";
  $("btnBackPdf").classList.toggle("hidden", !result.source);
  $("resultText").value = result.text;
  $("resultText").rows = Math.min(7, Math.max(2, result.text.split(/\r?\n/).length));
  $("resultHint").textContent = t(result.type === "wifi" ? "wifi.hint" : result.actions.length ? "result.actionHint" : "result.textHint");
  $("resultDetails").replaceChildren();
  for (const detail of result.details || []){
    const label = document.createElement("dt"), value = document.createElement("dd");
    label.textContent = t(detail.label);
    value.textContent = detail.value;
    $("resultDetails").append(label, value);
  }
  $("resultActions").replaceChildren();
  for (const action of result.actions){
    const element = document.createElement(action.href ? "a" : "button");
    element.className = "result-action";
    const leading = document.createElement("span"), label = document.createElement("span");
    leading.className = "action-icon";
    leading.append(icon(action.file ? "download" : action.href ? "external" : "copy"));
    label.className = "action-label";
    label.textContent = t(action.label);
    element.append(leading, label, icon("chevron"));
    if (action.href){
      element.href = action.href;
      if (/^https?:/i.test(action.href)){ element.target = "_blank"; element.rel = "noopener noreferrer"; }
    } else { element.addEventListener("click", () => action.file ? saveFile(action.file) : copy(action.text)); }
    $("resultActions").append(element);
  }
}

$("btnStart").addEventListener("click", () => startCamera());
for (const id of ["btnUpload", "btnUploadResult", "btnChooseImage", "btnChoosePdfFile"]){
  $(id).addEventListener("click", () => $("imageInput").click());
}
$("imageInput").addEventListener("change", event => {
  const file = event.target.files?.[0];
  event.target.value = ""; // Allow choosing the same file again.
  openFile(file);
});
document.addEventListener("dragenter", event => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  fileDragDepth++;
  $("imageDropOverlay").classList.remove("hidden");
});
document.addEventListener("dragover", event => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
});
document.addEventListener("dragleave", () => {
  if (fileDragDepth > 0 && --fileDragDepth === 0) hideFileDrop();
});
document.addEventListener("drop", event => {
  hideFileDrop();
  if (!isFileDrag(event) && !event.dataTransfer?.files?.length) return;
  event.preventDefault(); // Keep the browser from navigating to the dropped file.
  const file = Array.from(event.dataTransfer.files).find(file => file.type
    ? file.type.startsWith("image/") || file.type === "application/pdf"
    : /\.(?:pdf|png|jpe?g|jfif|gif|webp|bmp|avif|ico|svg|heic|heif|tiff?)$/i.test(file.name));
  if (file) openFile(file);
  else {
    importError = "image.invalidDrop";
    $("importError").textContent = t(importError);
  }
});
document.addEventListener("dragend", hideFileDrop);
window.addEventListener("blur", hideFileDrop);
$("btnDecodeImage").addEventListener("click", () => imageScanner.decode());
$("btnWholeImage").addEventListener("click", () => imageScanner.decodeWhole());
$("btnCancelImage").addEventListener("click", () => { showView("start"); $("btnUpload").focus(); });
$("btnStopPdf").addEventListener("click", () => { pdfScanner.cancel(); pdfView.stopped(); });
$("btnExitPdf").addEventListener("click", () => { showView("start"); $("btnUpload").focus(); });
$("btnBackPdf").addEventListener("click", () => { showView("pdf"); $("pdfFilename").focus(); });
$("btnSwitch").addEventListener("click", () => startCamera(true));
$("btnScanAgain").addEventListener("click", () => startCamera());
$("btnCopy").addEventListener("click", () => copy(result.text));
$("btnStop").addEventListener("click", () => { camera.stop(); showView("start"); });
document.addEventListener("visibilitychange", () => {
  if (document.hidden){ hideFileDrop(); camera.stop(); if (view === "camera") showView("start"); }
});
window.addEventListener("pagehide", () => { hideFileDrop(); camera.stop(); pdfScanner.cancel(); if (["image", "pdf"].includes(view)) showView("start"); });

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  installPrompt = event;
  $("btnInstall").classList.remove("hidden");
});
window.addEventListener("appinstalled", () => { installPrompt = null; $("btnInstall").classList.add("hidden"); });
$("btnInstall").addEventListener("click", async () => {
  if (!installPrompt) return;
  await installPrompt.prompt();
  installPrompt = null;
  $("btnInstall").classList.add("hidden");
});

initTranslations({ selector: $("languageSelect") }).then(() => {
  $("btnStart").disabled = false;
  $("btnUpload").disabled = false;
  $("languageSelect").addEventListener("languagechange", () => {
    renderResult();
    $("resultStatus").textContent = "";
    if (imageStatus) $("imageStatus").textContent = t(imageStatus);
    if (importError) $("importError").textContent = t(importError);
    renderSelection();
    detectionDebug.refresh();
    pdfView.refresh();
  });
}).catch(error => { $("startError").textContent = error.message; });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(console.error);
