import {
  defaultCanvasBlock,
  type CanvasBlock,
  type CanvasUploadedAsset,
} from "./canvasTypes";
import { resolveCanvasMaterialUrl } from "./omniCanvasApi";
import type { DigitalHumanVideo } from "@shared/digitalHumanStudio";

export async function digitalHumanMediaUrl(source: string): Promise<string> {
  const url = source.startsWith("gs://")
    ? await resolveCanvasMaterialUrl(source)
    : source;
  if (!/^https:\/\//.test(url)) throw new Error("素材地址不可用，请核对原素材");
  return url;
}

/** 保持参考图次序和持久身份，出站预览与提交使用同一现有执行器。 */
export async function digitalHumanVideoBlock(
  row: DigitalHumanVideo
): Promise<CanvasBlock> {
  const images = [
    row.portrait,
    row.scene,
    ...row.extraPortraits,
    ...(row.stageFrame ? [row.stageFrame] : []),
  ];
  const uploadedAssets: CanvasUploadedAsset[] = [];
  for (let index = 0; index < images.length; index++) {
    const media = images[index];
    const url = await digitalHumanMediaUrl(media.source);
    uploadedAssets.push({
      id: `dh-image-${index}`,
      kind: "image",
      url,
      previewUrl: url,
      mimeType: "image/png",
      fileName: media.name,
      ...(media.source.startsWith("gs://") ? { gcsUri: media.source } : {}),
    });
  }
  const audioUrl = await digitalHumanMediaUrl(row.audioSource);
  uploadedAssets.push({
    id: "dh-audio",
    kind: "audio",
    url: audioUrl,
    previewUrl: audioUrl,
    mimeType: "audio/wav",
    fileName: "本次文案配音.wav",
    ...(row.audioSource.startsWith("gs://") ? { gcsUri: row.audioSource } : {}),
  });
  const previsUrl = row.previs
    ? await digitalHumanMediaUrl(row.previs.gcsUri || row.previs.url)
    : undefined;
  if (row.previs && previsUrl)
    uploadedAssets.push({
      id: "dh-previs",
      kind: "video",
      url: previsUrl,
      previewUrl: previsUrl,
      fileName: row.previs.fileName || "已审预演.mp4",
      mimeType: "video/mp4",
      ...(row.previs.gcsUri ? { gcsUri: row.previs.gcsUri } : {}),
    });
  const block = defaultCanvasBlock("video", 0, 0);
  return {
    ...block,
    id: `dh-${row.requestId}`,
    prompt:
      row.prompt +
      (row.stageFrame
        ? `\n@图片${images.length}是3D场景与人物的构图参考，只沿用站位、光线和机位，人物外观仍按各自身份图。`
        : "") +
      (row.previs
        ? `\n@视频1是已审预演，只沿用人物走位、动作节奏和机位切换；灰色白模外观不进入成片，身份按图片，声音只按@音频1。${row.previs.motionGuideZh || ""}`
        : ""),
    aspectRatio: row.aspectRatio,
    videoModel: "seedance-2.5",
    videoResolution: "720p",
    seedance25WorkMode: "reference_to_video",
    refImageUrl: uploadedAssets[0].url,
    editFusionUrls: uploadedAssets
      .filter(a => a.kind === "image")
      .slice(1)
      .map(a => a.url),
    seedance25RefAudioUrls: [audioUrl],
    uploadedAssets,
    ...(previsUrl ? { seedance25RefVideoUrls: [previsUrl] } : {}),
  };
}
