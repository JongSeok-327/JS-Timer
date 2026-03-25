/**
 * Generates minimal valid PNG icon files for the Chrome extension.
 * No external dependencies - uses pure Node.js Buffer with raw PNG format.
 *
 * PNG structure: Signature + IHDR + IDAT + IEND chunks
 * Colors: Dark blue background (#0f3460) with timer accent (#e94560)
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ICONS_DIR = path.join(__dirname, "..", "public", "icons");

// Ensure the icons directory exists
if (!fs.existsSync(ICONS_DIR)) {
  fs.mkdirSync(ICONS_DIR, { recursive: true });
}

// CRC32 table for PNG chunk integrity
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUInt32BE(value) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(value, 0);
  return buf;
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const dataBuf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const crcInput = Buffer.concat([typeBuf, dataBuf]);
  const crcValue = crc32(crcInput);

  return Buffer.concat([
    writeUInt32BE(dataBuf.length),
    typeBuf,
    dataBuf,
    writeUInt32BE(crcValue),
  ]);
}

/**
 * Generates a simple PNG icon with:
 * - Dark blue (#0f3460) background
 * - A centered red-ish (#e94560) circle for the clock face
 * - Simple clock hands suggestion
 *
 * Uses RGB pixel format (bit depth 8, color type 2)
 */
function generatePNG(size) {
  const width = size;
  const height = size;

  // PNG Signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk: width, height, bit depth=8, color type=2 (RGB), compression=0, filter=0, interlace=0
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 2;  // color type: RGB
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  const ihdr = makeChunk("IHDR", ihdrData);

  // Build raw pixel data (with filter byte prefix per scanline)
  // Background: #1a1a2e (26, 26, 46)
  // Circle bg:  #0f3460 (15, 52, 96)
  // Accent:     #e94560 (233, 69, 96)
  // Rim:        #53d769 (83, 215, 105) - green accent ring

  const cx = width / 2;
  const cy = height / 2;
  const outerR = (size / 2) * 0.85;
  const innerR = outerR * 0.75;
  const rimW = outerR - innerR;

  const rawData = [];

  for (let y = 0; y < height; y++) {
    rawData.push(0); // filter type: None
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      let r, g, b;

      if (dist > outerR) {
        // Background
        r = 26; g = 26; b = 46;
      } else if (dist > innerR) {
        // Rim - use gradient effect
        const t = (dist - innerR) / rimW;
        // Blend from green (#53d769) to accent (#e94560) based on angle
        const angle = Math.atan2(dy, dx);
        const angleFraction = (angle + Math.PI) / (2 * Math.PI);
        // Simple two-stop gradient: green at top, red at bottom-right
        if (angleFraction < 0.5) {
          r = Math.round(83 + (233 - 83) * angleFraction * 2);
          g = Math.round(215 + (69 - 215) * angleFraction * 2);
          b = Math.round(105 + (96 - 105) * angleFraction * 2);
        } else {
          r = Math.round(233 + (83 - 233) * (angleFraction - 0.5) * 2);
          g = Math.round(69 + (215 - 69) * (angleFraction - 0.5) * 2);
          b = Math.round(96 + (105 - 96) * (angleFraction - 0.5) * 2);
        }
      } else {
        // Inner circle - dark blue face
        r = 15; g = 52; b = 96;

        // Draw clock hands: minute hand pointing up, hour hand pointing to ~2 o'clock
        const handW = Math.max(1, size / 32);

        // Minute hand: vertical line from center up
        const minuteLen = innerR * 0.7;
        const minuteAngle = -Math.PI / 2; // up
        const mhx = Math.cos(minuteAngle);
        const mhy = Math.sin(minuteAngle);
        // Distance from center-to-tip line segment
        const mProj = dx * mhx + dy * mhy;
        const mPerp = Math.abs(dx * mhy - dy * mhx);
        if (mProj >= -handW && mProj <= minuteLen && mPerp <= handW) {
          r = 224; g = 224; b = 224;
        }

        // Hour hand: shorter, pointing to ~2 o'clock (60 degrees = PI/3)
        const hourLen = innerR * 0.5;
        const hourAngle = Math.PI / 3;
        const hhx = Math.cos(hourAngle);
        const hhy = Math.sin(hourAngle);
        const hProj = dx * hhx + dy * hhy;
        const hPerp = Math.abs(dx * hhy - dy * hhx);
        if (hProj >= -handW && hProj <= hourLen && hPerp <= handW) {
          r = 224; g = 224; b = 224;
        }

        // Center dot
        if (dist < Math.max(2, size / 16)) {
          r = 233; g = 69; b = 96;
        }
      }

      rawData.push(
        Math.min(255, Math.max(0, Math.round(r))),
        Math.min(255, Math.max(0, Math.round(g))),
        Math.min(255, Math.max(0, Math.round(b)))
      );
    }
  }

  const rawBuf = Buffer.from(rawData);
  const compressed = zlib.deflateSync(rawBuf, { level: 6 });
  const idat = makeChunk("IDAT", compressed);
  const iend = makeChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

// Generate all required sizes
const sizes = [16, 48, 128];

sizes.forEach((size) => {
  const pngData = generatePNG(size);
  const outputPath = path.join(ICONS_DIR, `icon${size}.png`);
  fs.writeFileSync(outputPath, pngData);
  console.log(`Generated: ${outputPath} (${pngData.length} bytes)`);
});

console.log("Icon generation complete.");
