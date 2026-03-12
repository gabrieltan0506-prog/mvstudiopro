import sharp from "sharp";

function buildSvg(text: string, width: number, height: number) {
  const safe = text.replace(/[<>&"']/g, "");
  return Buffer.from(`
  <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <style>
      .wm { fill: rgba(255,255,255,0.42); font-size: 42px; font-family: Arial, sans-serif; font-weight: 700; }
      .sub { fill: rgba(0,0,0,0.18); font-size: 42px; font-family: Arial, sans-serif; font-weight: 700; }
    </style>
    <g transform="rotate(-18 ${width / 2} ${height / 2})">
      <text x="${width / 2 + 2}" y="${height / 2 + 2}" text-anchor="middle" dominant-baseline="middle" class="sub">${safe}</text>
      <text x="${width / 2}" y="${height / 2}" text-anchor="middle" dominant-baseline="middle" class="wm">${safe}</text>
    </g>
    <rect x="${width - 240}" y="${height - 70}" width="220" height="40" rx="10" fill="rgba(0,0,0,0.35)" />
    <text x="${width - 130}" y="${height - 42}" text-anchor="middle" class="wm" style="font-size:20px;">${safe}</text>
  </svg>
  `);
}

export async function applyImageWatermark(input: Buffer, watermarkText: string) {
  const img = sharp(input, { failOnError: false }).rotate();
  const meta = await img.metadata();
  const width = Number(meta.width || 1280);
  const height = Number(meta.height || 720);
  const svg = buildSvg(watermarkText, width, height);

  return await img
    .composite([{ input: svg, gravity: "center" }])
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
}
