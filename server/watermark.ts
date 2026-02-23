/**
 * Watermark Service
 * Adds "MVStudioPro.com" watermark to free-tier generated images
 */
import sharp from "sharp";

const WATERMARK_TEXT = "MVStudioPro.com";

/**
 * Add a semi-transparent text watermark to an image
 * @param imageBuffer - The original image buffer
 * @param position - Position of watermark: "bottom-right" | "bottom-center" | "diagonal"
 * @returns Buffer with watermark applied
 */
export async function addWatermark(
  imageBuffer: Buffer,
  position: "bottom-right" | "bottom-center" | "diagonal" = "bottom-right"
): Promise<Buffer> {
  const image = sharp(imageBuffer);
  const metadata = await image.metadata();
  const width = metadata.width || 1024;
  const height = metadata.height || 1024;

  // Calculate font size based on image dimensions
  const fontSize = Math.max(16, Math.floor(Math.min(width, height) * 0.04));
  const padding = Math.floor(fontSize * 0.8);

  let svgOverlay: string;

  if (position === "diagonal") {
    // Diagonal watermark across the image (more intrusive for free tier)
    const diagonalFontSize = Math.max(20, Math.floor(Math.min(width, height) * 0.06));
    svgOverlay = `
      <svg width="${width}" height="${height}">
        <text 
          x="50%" y="50%" 
          text-anchor="middle" 
          dominant-baseline="middle"
          font-family="Arial, sans-serif" 
          font-size="${diagonalFontSize}" 
          font-weight="700"
          fill="rgba(255,255,255,0.25)"
          transform="rotate(-30, ${width / 2}, ${height / 2})"
          letter-spacing="4"
        >${WATERMARK_TEXT}</text>
        <text 
          x="50%" y="30%" 
          text-anchor="middle" 
          dominant-baseline="middle"
          font-family="Arial, sans-serif" 
          font-size="${diagonalFontSize * 0.7}" 
          font-weight="700"
          fill="rgba(255,255,255,0.15)"
          transform="rotate(-30, ${width / 2}, ${height * 0.3})"
          letter-spacing="3"
        >${WATERMARK_TEXT}</text>
        <text 
          x="50%" y="70%" 
          text-anchor="middle" 
          dominant-baseline="middle"
          font-family="Arial, sans-serif" 
          font-size="${diagonalFontSize * 0.7}" 
          font-weight="700"
          fill="rgba(255,255,255,0.15)"
          transform="rotate(-30, ${width / 2}, ${height * 0.7})"
          letter-spacing="3"
        >${WATERMARK_TEXT}</text>
      </svg>`;
  } else if (position === "bottom-center") {
    svgOverlay = `
      <svg width="${width}" height="${height}">
        <rect x="0" y="${height - fontSize - padding * 2}" width="${width}" height="${fontSize + padding * 2}" fill="rgba(0,0,0,0.4)" rx="0"/>
        <text 
          x="50%" y="${height - padding}" 
          text-anchor="middle" 
          font-family="Arial, sans-serif" 
          font-size="${fontSize}" 
          font-weight="700"
          fill="rgba(255,255,255,0.8)"
          letter-spacing="2"
        >${WATERMARK_TEXT}</text>
      </svg>`;
  } else {
    // bottom-right (default)
    const textWidth = WATERMARK_TEXT.length * fontSize * 0.6;
    svgOverlay = `
      <svg width="${width}" height="${height}">
        <rect x="${width - textWidth - padding * 2}" y="${height - fontSize - padding * 2}" width="${textWidth + padding * 2}" height="${fontSize + padding * 2}" fill="rgba(0,0,0,0.5)" rx="${Math.floor(fontSize * 0.3)}"/>
        <text 
          x="${width - padding}" y="${height - padding}" 
          text-anchor="end" 
          font-family="Arial, sans-serif" 
          font-size="${fontSize}" 
          font-weight="700"
          fill="rgba(255,255,255,0.85)"
          letter-spacing="1"
        >${WATERMARK_TEXT}</text>
      </svg>`;
  }

  const watermarkedBuffer = await image
    .composite([
      {
        input: Buffer.from(svgOverlay),
        top: 0,
        left: 0,
      },
    ])
    .toBuffer();

  return watermarkedBuffer;
}

/**
 * Download image from URL, add watermark, and return buffer
 */
export async function addWatermarkToUrl(
  imageUrl: string,
  position: "bottom-right" | "bottom-center" | "diagonal" = "bottom-right"
): Promise<Buffer> {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return addWatermark(buffer, position);
}
