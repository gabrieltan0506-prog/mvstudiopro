import { CinemaDirectorControls } from "./CinemaDirectorControls";
import { useState } from "react";
import {
  digitalHumanCinemaSchema,
  compileDigitalHumanCinema,
  applyDigitalHumanCinema,
  type DigitalHumanCinema,
} from "@shared/digitalHumanCinema";
import {
  currentDigitalHumanAudio,
  digitalHumanPending,
  type DigitalHumanDraft,
} from "@shared/digitalHumanStudio";
import { DigitalHumanMedia } from "./DigitalHumanStudio";
import "./DigitalHumanCinemaPanel.css";

export function DigitalHumanCinemaPanel({
  draft,
  disabled,
  canUseOmni,
  onChange,
}: {
  draft: DigitalHumanDraft;
  disabled: boolean;
  canUseOmni: boolean;
  onChange(patch: Partial<DigitalHumanDraft>): void;
}) {
  const [error, setError] = useState("");
  const value = draft.cinema ?? digitalHumanCinemaSchema.parse({});
  const prompt = compileDigitalHumanCinema(value),
    applied = !!draft.cinema && draft.direction.includes(prompt);
  const locked =
    disabled || draft.videos.some(v => digitalHumanPending(v.status));
  const audio = currentDigitalHumanAudio(draft);
  const latest = [...draft.videos]
    .reverse()
    .find(v => v.status === "succeeded" && v.source);
  function change(patch: Partial<DigitalHumanCinema>) {
    setError("");
    onChange({ cinema: { ...value, ...patch } });
  }
  return (
    <section className="dh-cinema dh-wide" aria-label="Cinema导演工作台">
      <header>
        <div>
          <span className="dh-cinema-eyebrow">CINEMA STUDIO</span>
          <h3>把这一段，拍成你的表达。</h3>
          <p>素材、摄影与表演在这里汇合。先采用导演设置，再核对生成输入。</p>
        </div>
        <span className="dh-cinema-status">
          {applied ? "已采用" : "待采用"}
        </span>
      </header>
      <div className="dh-cinema-stage">
        <div className="dh-cinema-screen">
          {latest?.source ? (
            <DigitalHumanMedia
              source={latest.source}
              kind="video"
              name="最近成功原片"
            />
          ) : draft.portrait ? (
            <DigitalHumanMedia
              source={draft.portrait.source}
              kind="image"
              name="当前人物参考"
            />
          ) : (
            <p>先在素材步骤选择人物照片</p>
          )}
          <span>
            {latest ? "最近成功原片 · 选择新设置不会改写原片" : "当前人物参考"}
          </span>
        </div>
        <aside aria-label="本段实际参考">
          <h4>本段素材</h4>
          <div className="dh-cinema-assets">
            {draft.portrait && (
              <figure>
                <DigitalHumanMedia
                  source={draft.portrait.source}
                  kind="image"
                  name={draft.portrait.name}
                />
                <figcaption>人物 · {draft.portrait.name}</figcaption>
              </figure>
            )}
            {value.mode === "reference" && draft.scene && (
              <figure>
                <DigitalHumanMedia
                  source={draft.scene.source}
                  kind="image"
                  name={draft.scene.name}
                />
                <figcaption>场景 · {draft.scene.name}</figcaption>
              </figure>
            )}
          </div>
          {audio?.source ? (
            <>
              <DigitalHumanMedia
                source={audio.source}
                kind="audio"
                name="本段配音"
              />
              <small>
                {audio.durationSec?.toFixed(1)} 秒 ·{" "}
                {draft.approvedAudioRequestId === audio.request.billingRequestId
                  ? "配音已确认"
                  : "配音待试听确认"}
              </small>
            </>
          ) : (
            <p>尚无当前文案配音</p>
          )}
          <small>
            {value.mode === "talking"
              ? "OmniHuman 2 只接收人物照片、音频和表演提示；背景沿用照片。"
              : "人物、场景、已审预演及分段参考以生成前的完整输入预览为准。"}
          </small>
        </aside>
      </div>
      <fieldset disabled={locked}>
        <legend>制作模式</legend>
        <div className="dh-cinema-modes">
          <button
            type="button"
            aria-pressed={value.mode === "reference"}
            onClick={() => change({ mode: "reference" })}
          >
            参考视频 <small>场景 · 动作 · 运镜</small>
          </button>
          <button
            type="button"
            disabled={!canUseOmni}
            aria-pressed={value.mode === "talking"}
            onClick={() => change({ mode: "talking" })}
          >
            照片口播{" "}
            <small>
              OmniHuman 2 · 照片＋配音{!canUseOmni ? " · 管理者试用" : ""}
            </small>
          </button>
        </div>
        <CinemaDirectorControls value={value} onChange={change} />
        <details className="dh-cinema-prompt" open>
          <summary>本次导演提示词</summary>
          <pre>{prompt}</pre>
          <p>
            采用后保留手写要求，更新其中的 Cinema
            区块。摄影与风格是提示词意图，最终效果需审看实片。
          </p>
        </details>
        <button
          type="button"
          className="dh-cinema-apply"
          onClick={() => {
            try {
              onChange({
                cinema: value,
                direction: applyDigitalHumanCinema(draft.direction, value),
              });
              setError("");
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          采用到完整导演要求
        </button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
