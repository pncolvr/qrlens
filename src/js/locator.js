// Cheap region proposals, not a decoder. The decoder must verify every proposal.
// QR finder scan lines alternate in a 1:1:3:1:1 ratio; validate both axes and triples.
export function findQRRegions({ data, width, height }){
  const gray = new Uint8Array(width * height), histogram = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++){
    const alpha = data[i * 4 + 3] / 255;
    const value = Math.round((data[i * 4] * .299 + data[i * 4 + 1] * .587 + data[i * 4 + 2] * .114) * alpha + 255 * (1 - alpha));
    gray[i] = value;
    histogram[value]++;
  }
  // Otsu's threshold keeps the proposal pass inexpensive. Uneven lighting or tiny
  // finders may evade it; the full-image decoder remains the fallback.
  let sum = 0, weight = 0, partial = 0, best = -1, threshold = 127;
  for (let i = 0; i < 256; i++) sum += i * histogram[i];
  for (let i = 0; i < 255; i++){
    weight += histogram[i];
    partial += i * histogram[i];
    if (!weight || weight === gray.length) continue;
    const delta = partial / weight - (sum - partial) / (gray.length - weight);
    const variance = weight * (gray.length - weight) * delta * delta;
    if (variance > best){ best = variance; threshold = i; }
  }
  const dark = (x, y) => gray[y * width + x] <= threshold;
  function ratio(runs){
    const unit = runs.reduce((sum, value) => sum + value, 0) / 7;
    return unit >= .8 && runs.every((value, i) => Math.abs(value - unit * (i === 2 ? 3 : 1)) <= unit * (i === 2 ? 1.2 : .65)) ? unit : 0;
  }
  function cross(x, y, dx, dy, color, expected){
    const runs = [0, 0, 0, 0, 0], limit = Math.ceil(expected * 10);
    let positiveCenter = 0, negativeCenter = 0;
    for (const sign of [-1, 1]){
      let distance = sign === -1 ? 1 : 0, part = 2;
      for (; distance < limit; distance++){
        const px = x + dx * distance * sign, py = y + dy * distance * sign;
        if (px < 0 || py < 0 || px >= width || py >= height) break;
        const same = dark(px, py) === color;
        // The center and outer rings (indices 0, 2, 4) share a color.
        if (same !== (part % 2 === 0)) part += sign;
        if (part < 0 || part > 4) break;
        runs[part]++;
        if (part === 2){ if (sign === 1) positiveCenter++; else negativeCenter++; }
      }
    }
    const unit = ratio(runs);
    if (!unit || unit / expected < .5 || unit / expected > 2) return null;
    return { x: x + dx * (positiveCenter - negativeCenter - 1) / 2, y: y + dy * (positiveCenter - negativeCenter - 1) / 2, unit };
  }

  const clusters = [];
  for (let y = 0; y < height; y++){
    const lengths = [], colors = [];
    let start = 0;
    for (let x = 1; x <= width; x++){
      if (x < width && dark(x, y) === dark(x - 1, y)) continue;
      lengths.push(x - start);
      colors.push(dark(x - 1, y));
      start = x;
      if (lengths.length < 5) continue;
      const runs = lengths.slice(-5), unit = ratio(runs);
      if (!unit) continue;
      const color = colors.at(-3);
      const centerX = Math.floor(x - runs[4] - runs[3] - runs[2] / 2);
      const vertical = cross(centerX, y, 0, 1, color, unit);
      if (!vertical) continue;
      const horizontal = cross(centerX, Math.round(vertical.y), 1, 0, color, vertical.unit);
      if (!horizontal) continue;
      const module = (unit + vertical.unit + horizontal.unit) / 3;
      const candidate = { x: horizontal.x, y: vertical.y, module, dark: color, hits: 1 };
      const cluster = clusters.find(point => point.dark === color && Math.hypot(point.x - candidate.x, point.y - candidate.y) < Math.max(2, module * 2) && Math.max(point.module, module) / Math.min(point.module, module) < 1.8);
      if (cluster){
        for (const key of ["x", "y", "module"]) cluster[key] = (cluster[key] * cluster.hits + candidate[key]) / (cluster.hits + 1);
        cluster.hits++;
      } else if (clusters.length < 128) clusters.push(candidate);
    }
  }
  const finders = clusters.filter(point => point.hits >= 2).sort((a, b) => b.hits - a.hits).slice(0, 24);
  const proposals = [];
  for (let i = 0; i < finders.length; i++) for (let j = i + 1; j < finders.length; j++) for (let k = j + 1; k < finders.length; k++){
    const points = [finders[i], finders[j], finders[k]];
    if (points.some(point => point.dark !== points[0].dark)) continue;
    const modules = points.map(point => point.module);
    if (Math.max(...modules) / Math.min(...modules) > 1.8) continue;
    // The point opposite the longest side is the likely right-angle corner.
    const distances = points.map((point, p) => Math.hypot(point.x - points[(p + 1) % 3].x, point.y - points[(p + 1) % 3].y));
    const opposite = (distances.indexOf(Math.max(...distances)) + 2) % 3;
    const origin = points[opposite], a = points[(opposite + 1) % 3], b = points[(opposite + 2) % 3];
    const ax = a.x - origin.x, ay = a.y - origin.y, bx = b.x - origin.x, by = b.y - origin.y;
    const legA = Math.hypot(ax, ay), legB = Math.hypot(bx, by), module = modules.reduce((a, b) => a + b) / 3;
    const cosine = Math.abs(ax * bx + ay * by) / (legA * legB);
    const side = (legA + legB) / (2 * module) + 7;
    if (cosine > .35 || Math.min(legA, legB) / Math.max(legA, legB) < .5 || side < 18 || side > 185) continue;
    const corners = [...points, { x: a.x + b.x - origin.x, y: a.y + b.y - origin.y }];
    // Include the finder half-width and quiet-zone margin, including rotated codes.
    const padding = Math.max(module * 8, Math.max(legA, legB) * .08);
    const x = Math.max(0, Math.floor(Math.min(...corners.map(p => p.x)) - padding));
    const y = Math.max(0, Math.floor(Math.min(...corners.map(p => p.y)) - padding));
    const right = Math.min(width, Math.ceil(Math.max(...corners.map(p => p.x)) + padding));
    const bottom = Math.min(height, Math.ceil(Math.max(...corners.map(p => p.y)) + padding));
    proposals.push({ x, y, width: right - x, height: bottom - y, score: points.reduce((sum, point) => sum + point.hits, 0) / (1 + cosine * 4), finders: points });
  }
  const regions = [];
  for (const proposal of proposals.sort((a, b) => b.score - a.score)){
    const duplicate = regions.some(region => {
      const overlap = Math.max(0, Math.min(region.x + region.width, proposal.x + proposal.width) - Math.max(region.x, proposal.x))
        * Math.max(0, Math.min(region.y + region.height, proposal.y + proposal.height) - Math.max(region.y, proposal.y));
      return overlap / (region.width * region.height + proposal.width * proposal.height - overlap) > .65;
    });
    if (!duplicate) regions.push(proposal);
    if (regions.length === 6) break;
  }
  return { finders, regions };
}
