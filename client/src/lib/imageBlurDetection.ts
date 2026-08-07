export type ImageBlurAssessment = {
  checked: boolean;
  isLikelyBlurry: boolean;
  score?: number;
};

const BLUR_WARNING_THRESHOLD = 18;

export function laplacianVariance(
  grayscale: ArrayLike<number>,
  width: number,
  height: number,
): number {
  if (width < 3 || height < 3 || grayscale.length < width * height) return 0;
  let sum = 0;
  let sumSquares = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const value =
        grayscale[index - width]! +
        grayscale[index + width]! +
        grayscale[index - 1]! +
        grayscale[index + 1]! -
        4 * grayscale[index]!;
      sum += value;
      sumSquares += value * value;
      count += 1;
    }
  }
  if (!count) return 0;
  const mean = sum / count;
  return Math.max(0, sumSquares / count - mean * mean);
}

export function blurAssessmentFromScore(score: number): ImageBlurAssessment {
  const normalized = Number.isFinite(score) ? Math.max(0, score) : 0;
  return {
    checked: true,
    isLikelyBlurry: normalized < BLUR_WARNING_THRESHOLD,
    score: Math.round(normalized * 100) / 100,
  };
}

export async function detectImageBlurRisk(imageUrl: string): Promise<ImageBlurAssessment> {
  try {
    const response = await fetch(imageUrl, {
      credentials: imageUrl.startsWith(window.location.origin) ? "include" : "omit",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`image_fetch_${response.status}`);
    const bitmap = await createImageBitmap(await response.blob());
    const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(3, Math.round(bitmap.width * scale));
    const height = Math.max(3, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("canvas_context_unavailable");
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const rgba = context.getImageData(0, 0, width, height).data;
    const grayscale = new Uint8Array(width * height);
    for (let source = 0, target = 0; source < rgba.length; source += 4, target += 1) {
      grayscale[target] = Math.round(
        rgba[source]! * 0.299 + rgba[source + 1]! * 0.587 + rgba[source + 2]! * 0.114,
      );
    }
    return blurAssessmentFromScore(laplacianVariance(grayscale, width, height));
  } catch {
    return { checked: false, isLikelyBlurry: false };
  }
}

export function buildUpscaleConfirmation(input: {
  factorLabel: string;
  credits: number;
  assessment: ImageBlurAssessment;
  replacesOriginal?: boolean;
}): string {
  const action = input.replacesOriginal
    ? `放大（${input.factorLabel}）后将直接替换原图，无法还原。\n请先保存原图。\n`
    : `确认使用 ${input.factorLabel} 高清放大。\n`;
  const warning = input.assessment.isLikelyBlurry
    ? "\n检测到原图清晰度较低。高清放大能提升尺寸和清晰度，但无法保证还原原图中不存在的细节，结果可能仍有模糊或出现推测细节。\n点击“确定”表示已知悉上述风险并自愿继续；生成开始后，不因上述原图质量原因退还本次积分。\n"
    : "";
  return `${action}${warning}\n本次将扣除 ${input.credits} 积分。\n\n确定继续吗？`;
}
