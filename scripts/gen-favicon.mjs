/**
 * Regenerate app/favicon.ico from the brand mark (public/brand/icon-yellow.svg).
 * The stock Next.js default favicon.ico is what non-SVG browsers / link previews
 * fall back to, so it must be the brand mark, not the default diamond.
 *
 * Produces a multi-size (16/32/48) PNG-in-ICO — supported by every modern
 * browser. The yellow mark is centred on a transparent square (the SVG is
 * taller than wide). Run: node scripts/gen-favicon.mjs
 */
import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";

const SRC = "public/brand/icon-yellow.svg";
const OUT = "src/app/favicon.ico";
const SIZES = [16, 32, 48];

function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = icon
  header.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + 16 * images.length;
  const bodies = [];
  images.forEach((img, i) => {
    const e = dir.subarray(i * 16, i * 16 + 16);
    e.writeUInt8(img.size >= 256 ? 0 : img.size, 0); // width (0 = 256)
    e.writeUInt8(img.size >= 256 ? 0 : img.size, 1); // height
    e.writeUInt8(0, 2);  // palette
    e.writeUInt8(0, 3);  // reserved
    e.writeUInt16LE(1, 4);   // colour planes
    e.writeUInt16LE(32, 6);  // bits per pixel
    e.writeUInt32LE(img.buf.length, 8);  // image byte size
    e.writeUInt32LE(offset, 12);         // image offset
    offset += img.buf.length;
    bodies.push(img.buf);
  });
  return Buffer.concat([header, dir, ...bodies]);
}

const svg = readFileSync(SRC);
const images = await Promise.all(
  SIZES.map(async (size) => ({
    size,
    buf: await sharp(svg, { density: 512 })
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer(),
  })),
);
writeFileSync(OUT, buildIco(images));
console.log(`wrote ${OUT} (${SIZES.join("/")} px) from ${SRC}`);
