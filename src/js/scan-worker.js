import "../vendor/jsQR-1.4.0.min.js";
import { readBarcodes, prepareZXingModule } from "../vendor/zxing-wasm-3.1.5/reader/index.js";
import { rotateClockwise } from "./scan.js";

prepareZXingModule({ overrides: { locateFile: path => new URL(`../vendor/zxing-wasm-3.1.5/reader/${path}`, import.meta.url).href } });

export async function decodePixels({ pixels, engine, binarizer = "LocalAverage", rotations = [0] }, decoder = globalThis.jsQR){
    let result;
    if (engine === "zxing"){
      const codes = await readBarcodes(pixels, { formats: ["QRCode"], returnErrors: true, textMode: "Plain", binarizer, maxNumberOfSymbols: 0 });
      result = { codes: codes.map(code => ({ text: code.isValid ? code.text : null, unverifiedText: !code.isValid && code.error.startsWith("ChecksumError") ? code.text : null, error: code.error, points: [code.position.topLeft, code.position.topRight, code.position.bottomRight, code.position.bottomLeft] })), passes: [{ width: pixels.width, height: pixels.height, rotation: 0, engine, variant: binarizer, outcome: codes.some(code => code.isValid) ? "success" : codes.length ? "unreadable" : "miss" }] };
    } else {
      const baseWidth = pixels.width, baseHeight = pixels.height, passes = [];
      let image = pixels;
      result = { codes: [], passes };
      for (const rotation of rotations){
        const code = decoder(image.data, image.width, image.height);
        passes.push({ width: image.width, height: image.height, rotation, engine: "jsqr", outcome: code ? "success" : "miss" });
        if (code){
          const points = ["topLeftCorner", "topRightCorner", "bottomRightCorner", "bottomLeftCorner"].map(key => code.location[key]).map(point => {
            const [x, y] = rotation === 90 ? [point.y, baseHeight - point.x] : rotation === 180 ? [baseWidth - point.x, baseHeight - point.y] : rotation === 270 ? [baseWidth - point.y, point.x] : [point.x, point.y];
            return { x, y };
          });
          result.codes.push({ text: code.data, points }); break;
        }
        image = rotateClockwise(image);
      }
    }
    return result;
}

if (typeof self !== "undefined" && typeof document === "undefined") self.onmessage = async ({ data }) => {
  try { self.postMessage({ id: data.id, result: await decodePixels(data) }); }
  catch(error){ self.postMessage({ id: data.id, error: String(error.message || error) }); }
};
