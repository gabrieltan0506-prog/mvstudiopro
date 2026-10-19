import { useState } from "react";
import { CinemaDirectorControls } from "../CinemaDirectorControls";
import {
  digitalHumanCinemaSchema,
  compileDigitalHumanCinema,
  applyDigitalHumanCinema,
} from "@shared/digitalHumanCinema";
import type { CanvasBlock } from "@/lib/canvasTypes";
import "../DigitalHumanCinemaPanel.css";

/** 与数字人工作流共用导演契约；采用后的文字沿原节点生成链提交。 */
export function CanvasCinemaPanel({
  block,
  preparing = false,
  onPatch,
}: {
  block: CanvasBlock;
  preparing?: boolean;
  onPatch(patch: Partial<CanvasBlock>): void;
}) {
  const [error, setError] = useState("");
  const parsed = digitalHumanCinemaSchema.safeParse(block.cinema ?? {});
  if (!parsed.success)
    return (
      <p role="alert">保存的导演设置无效，请恢复有效版本；尚未提交生成。</p>
    );
  const value = {
    ...parsed.data,
    mode: block.kind === "image" ? ("image" as const) : ("reference" as const),
  };
  const prompt = compileDigitalHumanCinema(value);
  const applied = !!block.cinema && block.prompt.includes(prompt);
  return (
    <details
      className="dh-cinema dh-cinema-canvas"
      aria-label="画布Cinema导演工作台"
    >
      <summary>导演工作台 · {applied ? "已采用" : "待采用"}</summary>
      <fieldset disabled={preparing || block.status === "running"}>
        <CinemaDirectorControls
          value={value}
          onChange={patch => onPatch({ cinema: { ...value, ...patch } })}
        />
        <details>
          <summary>实际导演提示词</summary>
          <pre className="whitespace-pre-wrap break-words">{prompt}</pre>
        </details>
        <p>
          参考素材、模型、画幅与候选数量沿用本节点设置。采用会保留手写场景；改稿后请重新核对生成输入。
        </p>
        <button
          type="button"
          onClick={() => {
            try {
              onPatch({
                cinema: value,
                prompt: applyDigitalHumanCinema(block.prompt, value),
              });
              setError("");
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          采用到节点提示词
        </button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
