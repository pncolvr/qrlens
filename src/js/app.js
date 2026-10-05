import { supported, createCamera } from "./camera.js";
import { parseQR } from "./qr.js";
import { initTranslations, t } from "../i18n/i18n.js";

const $ = id => document.getElementById(id);
let result = null, view = "start", installPrompt = null;

function showView(name){
  view = name;
  for (const section of ["start", "camera", "result"]) $("view-" + section).classList.toggle("hidden", section !== name);
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
  onStatus: ({ deviceCount }) => $("btnSwitch").classList.toggle("hidden", deviceCount < 2),
  onError: cameraError,
  onResult(text){
    if (view !== "camera" || document.hidden || typeof text !== "string") return;
    result = { text, ...parseQR(text) };
    renderResult();
    showView("result");
    $("resultTitle").focus();
  }
});

async function startCamera(switchDevice = false){
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
    if (await (switchDevice ? camera.switchDevice() : camera.start())) showView("camera");
  } catch(error){ cameraError(error); }
  finally { $("btnStart").disabled = $("btnSwitch").disabled = $("btnScanAgain").disabled = false; }
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
$("btnSwitch").addEventListener("click", () => startCamera(true));
$("btnScanAgain").addEventListener("click", () => startCamera());
$("btnCopy").addEventListener("click", () => copy(result.text));
$("btnStop").addEventListener("click", () => { camera.stop(); showView("start"); });
document.addEventListener("visibilitychange", () => {
  if (document.hidden){ camera.stop(); if (view === "camera") showView("start"); }
});
window.addEventListener("pagehide", () => camera.stop());

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
  $("languageSelect").addEventListener("languagechange", () => { renderResult(); $("resultStatus").textContent = ""; });
}).catch(error => { $("startError").textContent = error.message; });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(console.error);
