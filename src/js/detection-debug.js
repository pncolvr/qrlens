export function createDetectionDebug({ container, canvas, summary, list, t }){
  let trace = null;

  function refresh(){
    if (!trace) return;
    const success = trace.attempts.findIndex(attempt => attempt.outcome === "success");
    let key = trace.phase === "fallback" ? "debug.fallback" : "debug.regions";
    if (trace.phase === "complete") key = success < 0 ? "debug.failed" : trace.attempts[success].scope === "whole" ? "debug.successWhole" : "debug.successRegion";
    summary.textContent = t(key, { count: trace.proposals, index: success + 1 });
    if (trace.locatorFailed) summary.textContent += ` ${t("debug.locatorFailed")}`;
    list.replaceChildren();
    trace.attempts.forEach((attempt, index) => {
      const item = document.createElement("li");
      const sizes = attempt.passes.map(pass => `${pass.width} × ${pass.height}: ${t(`debug.${pass.outcome}`)}`).join("; ");
      item.textContent = t(attempt.scope === "whole" ? "debug.attemptWhole" : "debug.attemptRegion", { index: index + 1, outcome: t(`debug.${attempt.outcome}`), sizes });
      list.append(item);
    });
  }

  function clear(){
    trace = null;
    container.classList.add("hidden");
    canvas.width = canvas.height = 0;
    summary.textContent = "";
    list.replaceChildren();
  }

  function render(report){
    if (!report){ clear(); return; }
    // Keep only the small trace, never the original image, after the result opens.
    trace = { phase: report.phase, proposals: report.proposals, locatorFailed: report.locatorFailed, attempts: report.attempts.map(attempt => ({ ...attempt, passes: [...attempt.passes] })) };
    container.classList.remove("hidden");
    const scale = Math.min(1, 960 / Math.max(report.image.naturalWidth, report.image.naturalHeight));
    canvas.width = Math.max(1, Math.round(report.image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(report.image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context){ refresh(); return; }
    const sx = canvas.width / report.image.naturalWidth, sy = canvas.height / report.image.naturalHeight;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(report.image, 0, 0, canvas.width, canvas.height);
    for (const point of report.finders){
      const x = point.x * sx, y = point.y * sy;
      const radius = Math.max(5, Math.max(point.width * sx, point.height * sy));
      // A response map of finder evidence, not a calibrated probability heatmap.
      const glow = context.createRadialGradient(x, y, 0, x, y, radius);
      glow.addColorStop(0, "rgba(34,211,238,.65)");
      glow.addColorStop(1, "rgba(34,211,238,0)");
      context.fillStyle = glow;
      context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      context.strokeStyle = "#22d3ee";
      context.lineWidth = 2;
      context.beginPath();
      context.arc(x, y, 4, 0, Math.PI * 2);
      context.stroke();
    }
    report.attempts.forEach((attempt, index) => {
      const { rect } = attempt;
      context.strokeStyle = attempt.outcome === "success" ? "#4ade80" : "#f59e0b";
      context.lineWidth = 3;
      context.setLineDash(attempt.scope === "whole" ? [9, 6] : []);
      const x = rect.x * sx, y = rect.y * sy;
      context.strokeRect(x + 1.5, y + 1.5, Math.max(0, rect.width * sx - 3), Math.max(0, rect.height * sy - 3));
      context.fillStyle = "#14171c";
      context.fillRect(x + 2, y + 2, 24, 22);
      context.fillStyle = context.strokeStyle;
      context.font = "bold 14px monospace";
      context.fillText(String(index + 1), x + 7, y + 18);
    });
    refresh();
  }

  return { render, refresh, clear };
}
