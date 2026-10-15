import { createDetectionDebug } from "./detection-debug.js";
import { parseQR } from "./qr.js";

export function createPDFView({ heading, status, pages, stopButton, t, onSelect }){
  let filename = "", statusKey = "", statusValues = {};
  const entries = new Map();
  function element(tag, className){
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }
  function setStatus(key, values = {}){ statusKey = key; statusValues = values; status.textContent = t(key, values); }
  function start({ name }){
    filename = name;
    pages.replaceChildren(); entries.clear();
    heading.textContent = filename;
    stopButton.disabled = false;
    setStatus("pdf.loading");
  }
  function progress({ page, total }){ setStatus("pdf.progress", { page, total }); }
  function refreshPage(entry){
    entry.heading.textContent = t("pdf.page", { page: entry.page });
    entry.status.textContent = t(entry.state === "error" ? "pdf.pageError" : entry.state === "stopped" ? "pdf.pageStopped" : entry.state === "complete" ? entry.results.length ? "pdf.found" : "pdf.noCode" : entry.state === "rendering" ? "pdf.rendering" : "pdf.scanning", { count: entry.results.length });
    entry.resultList.replaceChildren();
    entry.results.forEach((result, index) => {
      const card = element("div", "pdf-code"), text = element("p", "mono"), button = element("button", "btn");
      text.textContent = result.text;
      button.textContent = t("pdf.openResult", { index: index + 1, type: t(`type.${parseQR(result.text).type}`) });
      button.addEventListener("click", () => onSelect(result.text, { page: entry.page, name: filename }));
      card.append(text, button); entry.resultList.append(card);
    });
    for (const [size, pass] of entry.passes){
      pass.label.textContent = t("pdf.debugPass", { page: entry.page, size });
      if (pass.image) pass.image.alt = t("debug.preview");
      pass.debug.refresh();
    }
  }
  function update(event){
    let entry = entries.get(event.page);
    if (!entry){
      const panel = element("article", "pdf-page"), title = element("h3"), message = element("p", "hint"), resultList = element("div", "pdf-results"), debugList = element("div");
      panel.append(title, message, resultList, debugList); pages.append(panel);
      entry = { page: event.page, state: event.state, heading: title, status: message, resultList, debugList, passes: new Map(), results: [] };
      entries.set(event.page, entry);
    }
    if (event.state !== "passComplete") entry.state = event.state;
    if (event.results) entry.results = event.results;
    if (event.trace){
      let pass = entry.passes.get(event.size);
      if (!pass){
        const container = element("details", "detection-debug"), label = element("summary"), summary = element("p", "hint"), canvas = element("canvas", "detection-preview"), list = element("ol", "detection-attempts mono");
        canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", t("debug.preview"));
        container.append(label, summary, canvas, list); entry.debugList.append(container);
        pass = { canvas, label, debug: createDetectionDebug({ container, canvas, summary, list, t, maxPreviewSize: 480 }) };
        entry.passes.set(event.size, pass);
      }
      pass.debug.render(event.trace);
    }
    if (event.state === "passComplete" || event.state === "error") freezePreviews(entry);
    refreshPage(entry);
  }
  function freezePreviews(entry){
    // Retain compressed, lazy previews rather than full page buffers between pages.
    for (const pass of entry.passes.values()) if (!pass.image && pass.canvas.width){
      const image = element("img", "detection-preview");
      image.loading = "lazy"; image.alt = t("debug.preview");
      image.src = pass.canvas.toDataURL("image/webp", .8);
      pass.canvas.replaceWith(image); pass.canvas.width = pass.canvas.height = 0;
      pass.image = image;
    }
  }
  function complete(summary){ stopButton.disabled = true; setStatus("pdf.complete", summary); }
  function error(key){ stopButton.disabled = true; setStatus(key); }
  function stopped(){
    stopButton.disabled = true; setStatus("pdf.stopped");
    for (const entry of entries.values()) if (!["complete", "error"].includes(entry.state)){
      entry.state = "stopped"; freezePreviews(entry); refreshPage(entry);
    }
  }
  function refresh(){
    if (statusKey) status.textContent = t(statusKey, statusValues);
    for (const entry of entries.values()) refreshPage(entry);
  }
  function clear(){ pages.replaceChildren(); entries.clear(); filename = ""; statusKey = ""; }
  return { start, progress, update, complete, error, stopped, refresh, clear };
}
