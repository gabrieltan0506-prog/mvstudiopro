import { gsUriFromSignedGcsUrl } from "@shared/manhuaMultiview";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  currentDigitalHumanAudio,
  digitalHumanPending,
  prepareDigitalHumanOmniVideo,
  type DigitalHumanDraft,
  type DigitalHumanVideo,
} from "@shared/digitalHumanStudio";
import type { DigitalHumanOmniQuote } from "@shared/digitalHumanOmni";
import { DigitalHumanMedia as Media } from "./DigitalHumanStudio";

/** 与多参考导演入口分开展示实际输入，选择单图不会暗中带上或丢弃其他参考。 */
export function DigitalHumanOmniPanel({
  draft,
  disabled,
  save,
  beforeSubmit,
  acquireWork,
  updateVideo,
}: {
  draft: DigitalHumanDraft;
  disabled: boolean;
  save(update: (draft: DigitalHumanDraft) => DigitalHumanDraft): void;
  beforeSubmit(): Promise<void>;
  acquireWork(label: string): () => void;
  updateVideo(id: string, patch: Partial<DigitalHumanVideo>): void;
}) {
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<{
    row: DigitalHumanVideo;
    quote: DigitalHumanOmniQuote;
  }>();
  const quote = trpc.digitalHuman.quoteOmni.useMutation({ retry: false });
  const start = trpc.digitalHuman.startOmni.useMutation({ retry: false });
  const audio = currentDigitalHumanAudio(draft);
  const selectedImage = draft.portrait;
  const blocked =
    disabled || draft.videos.some(v => digitalHumanPending(v.status));
  async function act(label: string, run: () => Promise<void>) {
    let release: (() => void) | undefined;
    try {
      release = acquireWork(label);
      setNotice("");
      await run();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      release?.();
    }
  }
  return (
    <section className="dh-card dh-wide">
      <h3>数字人口播 · 管理者试用</h3>
      <p>
        上传人物或角色照片，填写口播文案并选择声音，试听配音后生成视频。适合固定场景讲述；需要换景、多镜头或预演动作时，请使用带货视频制作。
      </p>
      <p>
        本次只发送下方一张图片、配音和提示词。单独的场景图、其他人物图、3D视角与预演不会发送；视频以所选照片中的人物和背景为基础。
      </p>
      {selectedImage && (
        <Media source={selectedImage.source} kind="image" name="本次唯一画面" />
      )}
      <button
        disabled={blocked || !selectedImage || !audio?.source}
        onClick={() =>
          void act("核对口播输入与费用", async () => {
            const row = prepareDigitalHumanOmniVideo(
              draft,
              crypto.randomUUID()
            );
            const result = await quote.mutateAsync({
              image: row.performanceImage!.source,
              audio: row.audioSource,
              prompt: row.prompt,
            });
            if (Math.abs(row.durationSec - result.quote.durationSec) > 0.1)
              throw new Error("配音时长与原回执不一致，请先核对原音频");
            setPreview({ row, quote: result.quote });
          })
        }
      >
        查看本次输入与报价
      </button>
      {preview && (
        <div>
          <Media
            source={preview.row.audioSource}
            kind="audio"
            name="本次完整配音"
          />
          <pre style={{ whiteSpace: "pre-wrap" }}>{preview.row.prompt}</pre>
          <p>
            实际配音 {preview.quote.durationSec.toFixed(2)} 秒；供应商报价 US$
            {preview.quote.discountedPriceUsd.toFixed(2)}
            。报价五分钟内有效，提交前再次核价；费用上涨时停止。试用沿用管理者积分政策，供应商生成仍会产生费用。
          </p>
          <p>
            原片画幅沿用照片比例，画幅选项用于后期成片。输出尺寸以实际成片为准。
          </p>
          <button
            disabled={blocked}
            onClick={() =>
              void act("提交数字人口播", async () => {
                const current = prepareDigitalHumanOmniVideo(
                  draft,
                  preview.row.requestId
                );
                if (current.fingerprint !== preview.row.fingerprint)
                  throw new Error("输入已变化，请重新查看并核价");
                const row = { ...preview.row, omniQuote: preview.quote };
                save(d => ({ ...d, videos: [...d.videos, row] }));
                try {
                  await beforeSubmit();
                } catch (error) {
                  updateVideo(row.requestId, {
                    status: "failed",
                    message: "制作稿未能保存，未提交生成",
                  });
                  throw error;
                }
                try {
                  const result = await start.mutateAsync({
                    requestId: row.requestId,
                    image: row.performanceImage!.source,
                    audio: row.audioSource,
                    prompt: row.prompt,
                    quote: preview.quote,
                    confirmed: true,
                  });
                  updateVideo(row.requestId, {
                    taskId: result?.taskId,
                    status:
                      result?.status === "failed"
                        ? "failed"
                        : result?.status === "succeeded"
                          ? "succeeded"
                          : "running",
                    source: result?.videoUrl
                      ? gsUriFromSignedGcsUrl(result.videoUrl) ||
                        result.videoUrl
                      : undefined,
                    message: result?.error,
                  });
                  setPreview(undefined);
                } catch (error) {
                  updateVideo(row.requestId, {
                    status: "unknown",
                    message: "提交结果待核对，请查询原任务，不要重复生成",
                  });
                  throw error;
                }
              })
            }
          >
            确认以上画面、配音与费用并生成
          </button>
        </div>
      )}
      {notice && <p role="alert">{notice}</p>}
    </section>
  );
}
