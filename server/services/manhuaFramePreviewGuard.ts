import sharp from "sharp";

/**
 * 抖音有时会把「请前往 App 观看」的限制页当作 mp4 返回。ffmpeg 能正常抽帧，
 * 但所有抽出的画面几乎完全相同；必须在写进学习检查点前拦下，不能把它伪装成有效静帧。
 */
export async function assertManhuaPreviewFramesHaveMotion(framePaths: string[]): Promise<void> {
  if (framePaths.length < 2) return;

  const fingerprints = await Promise.all(framePaths.map(async (framePath) => {
    const { data } = await sharp(framePath)
      .resize(32, 18, { fit: "fill" })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return data;
  }));

  const first = fingerprints[0]!;
  const differs = fingerprints.some((current) => {
    let delta = 0;
    for (let i = 0; i < first.length; i += 1) delta += Math.abs(first[i]! - current[i]!);
    return delta / Math.max(1, first.length) > 4;
  });
  if (!differs) {
    throw new Error(
      "媒体流画面持续不变，疑似抖音 App 限制页；未写入假静帧，请稍后重试或换可读取的成片链接",
    );
  }
}
