// Small raster canvas for scanner tests; rendering fixtures provide the source pixels.
export function createCanvas(){
  let buffer = new Uint8ClampedArray();
  const canvas = { width: 0, height: 0, get data(){ ensure(); return buffer; }, getContext: () => context };
  function ensure(){ if (buffer.length !== canvas.width * canvas.height * 4) buffer = new Uint8ClampedArray(canvas.width * canvas.height * 4); }
  const context = {
    canvas,
    fillRect(x, y, width, height){
      ensure();
      for (let py = Math.max(0, Math.floor(y)); py < Math.min(canvas.height, Math.ceil(y + height)); py++){
        buffer.fill(255, (py * canvas.width + Math.max(0, Math.floor(x))) * 4, (py * canvas.width + Math.min(canvas.width, Math.ceil(x + width))) * 4);
      }
    },
    drawImage(source, ...args){
      ensure();
      const sourceWidth = source.naturalWidth || source.width, sourceHeight = source.naturalHeight || source.height;
      const [sx, sy, sw, sh, dx, dy, dw, dh] = args.length === 8 ? args : [0, 0, sourceWidth, sourceHeight, ...args];
      const pixels = source.data;
      for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++){
        const from = (Math.min(sourceHeight - 1, Math.floor(sy + y * sh / dh)) * sourceWidth + Math.min(sourceWidth - 1, Math.floor(sx + x * sw / dw))) * 4;
        buffer.set(pixels.subarray(from, from + 4), ((dy + y) * canvas.width + dx + x) * 4);
      }
    },
    getImageData(x, y, width, height){
      ensure();
      const data = new Uint8ClampedArray(width * height * 4);
      for (let row = 0; row < height; row++) data.set(buffer.subarray(((row + y) * canvas.width + x) * 4, ((row + y) * canvas.width + x + width) * 4), row * width * 4);
      return { data, width, height };
    }
  };
  return canvas;
}
