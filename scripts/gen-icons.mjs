// One-off generator for the app and tray icons (checked-in PNGs).
// Draws the Jarvis mark — a glowing ring with a core dot — with zero deps.
// Rerun with `node scripts/gen-icons.mjs` if the mark ever changes.
import { deflateSync, crc32 } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

/** Encode an RGBA pixel buffer as a PNG. */
function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Anti-aliased ring + core dot. color = [r, g, b]. */
function drawMark(size, color) {
  const rgba = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  const ringR = size * 0.36;
  const ringW = Math.max(size * 0.07, 1);
  const dotR = size * 0.12;
  const aa = 1.0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      const ring = Math.max(0, 1 - Math.abs(d - ringR) / (ringW + aa));
      const dot = Math.max(0, Math.min(1, (dotR - d) / aa + 1));
      const alpha = Math.min(1, ring + dot);
      if (alpha <= 0) continue;
      const i = (y * size + x) * 4;
      rgba[i] = color[0];
      rgba[i + 1] = color[1];
      rgba[i + 2] = color[2];
      rgba[i + 3] = Math.round(alpha * 255);
    }
  }
  return encodePng(size, size, rgba);
}

const cyan = [82, 214, 244];
const black = [0, 0, 0]; // macOS template images are black + alpha

mkdirSync(join(root, "assets"), { recursive: true });
mkdirSync(join(root, "build"), { recursive: true });
writeFileSync(join(root, "assets", "tray.png"), drawMark(32, cyan));
writeFileSync(join(root, "assets", "trayTemplate.png"), drawMark(16, black));
writeFileSync(join(root, "assets", "trayTemplate@2x.png"), drawMark(32, black));
writeFileSync(join(root, "build", "icon.png"), drawMark(512, cyan));
console.log("icons written to assets/ and build/");
