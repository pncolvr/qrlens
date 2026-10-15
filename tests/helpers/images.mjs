import { readFileSync } from 'node:fs';

export function blankImage(width = 800, height = 600){
  return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) };
}

export function paintQR(image, { left = 300, top = 200, scale = 4, angle = 0, name = 'link', inverted = false } = {}){
  const [, w, h, ...bits] = readFileSync(new URL(`../fixtures/${name}.pbm`, import.meta.url), 'utf8').trim().split(/\s+/);
  const qrWidth = Number(w) * scale, qrHeight = Number(h) * scale;
  const cosine = Math.cos(angle), sine = Math.sin(angle);
  const cx = left + qrWidth / 2, cy = top + qrHeight / 2;
  const extent = Math.ceil(Math.hypot(qrWidth, qrHeight) / 2);
  for (let y = Math.max(0, Math.floor(cy - extent)); y < Math.min(image.height, cy + extent); y++){
    for (let x = Math.max(0, Math.floor(cx - extent)); x < Math.min(image.width, cx + extent); x++){
      const qx = ((x + .5 - cx) * cosine + (y + .5 - cy) * sine + qrWidth / 2) / scale;
      const qy = (-(x + .5 - cx) * sine + (y + .5 - cy) * cosine + qrHeight / 2) / scale;
      if (qx < 0 || qy < 0 || qx >= Number(w) || qy >= Number(h)) continue;
      const black = bits[Math.floor(qy) * Number(w) + Math.floor(qx)] === '1';
      const value = black !== inverted ? 0 : 255;
      image.data.set([value, value, value, 255], (y * image.width + x) * 4);
    }
  }
  return image;
}

export function cropImage(image, rect){
  const data = new Uint8ClampedArray(rect.width * rect.height * 4);
  for (let y = 0; y < rect.height; y++){
    const start = ((rect.y + y) * image.width + rect.x) * 4;
    data.set(image.data.subarray(start, start + rect.width * 4), y * rect.width * 4);
  }
  return { data, width: rect.width, height: rect.height };
}
