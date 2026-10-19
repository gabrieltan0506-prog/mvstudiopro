import type { SubtitleHighlight } from "../../shared/subtitleHighlights.js";

function time(seconds: number) {
  const n = Math.round(seconds * 100);
  return `${Math.floor(n / 360000)}:${String(Math.floor(n / 6000) % 60).padStart(2, "0")}:${String(Math.floor(n / 100) % 60).padStart(2, "0")}.${String(n % 100).padStart(2, "0")}`;
}
const plain = (value: string) =>
  value
    .replace(/\\/g, "＼")
    .replace(/\{/g, "｛")
    .replace(/\}/g, "｝")
    .replace(/[\r\n]/g, " ");
const event = (
  start: number,
  end: number,
  tags: string,
  text: string,
  layer = 1
) =>
  `Dialogue: ${layer},${time(start)},${time(end)},Default,,0,0,0,,{${tags}}${text}`;

/** 全部指令由服务端生成，文字不接受ASS转义；逐条保留创作者给出的时间。 */
export function buildSubtitleHighlightEvents(
  cues: SubtitleHighlight[],
  width: number
): string[] {
  const result: string[] = [];
  for (const cue of cues) {
    const y = (288 * cue.positionPercent) / 100,
      x = width / 2;
    const ms = (cue.endSec - cue.startSec) * 1000;
    const fade = Math.min(180, Math.floor(ms / 4));
    const base = `\\an5\\fs${cue.fontSize}\\b1\\bord0.45\\shad0.2\\1c&H77D7FF&\\3c&H201810&`;
    if (cue.effect === "arrange") {
      const words = cue.text.split(/[|｜]/).map(word => word.trim());
      const cell = (width - 20) / words.length;
      if (words.some(word => Array.from(word).length * cue.fontSize > cell - 4))
        throw new Error("归序关键词在当前画幅放不下，请缩小重点字号或减少文字");
      words.forEach((word, i) => {
        const start =
          cue.startSec +
          Math.min(0.35, (cue.endSec - cue.startSec) / (words.length + 2)) * i;
        const target = 10 + cell * (i + 0.5);
        const moveMs = Math.min(220, Math.floor((cue.endSec - start) * 250));
        result.push(
          event(
            start,
            cue.endSec,
            `${base}\\1c&HFFF19C&\\move(${target - 12},${y},${target},${y},0,${moveMs})\\fad(${Math.min(fade, moveMs)},${fade})`,
            plain(word)
          )
        );
      });
      continue;
    }
    if (
      Array.from(cue.text).reduce(
        (n, ch) => n + (/^[\x20-\x7e]$/.test(ch) ? 0.65 : 1),
        0
      ) *
        cue.fontSize >
      width - 18
    )
      throw new Error("重点文字在当前画幅放不下，请缩小字号或分条");
    const animation =
      cue.effect === "impact"
        ? `\\fscx65\\fscy65\\t(0,${Math.min(130, ms / 5)},\\fscx112\\fscy112)\\t(${Math.min(130, ms / 5)},${Math.min(260, ms / 2)},\\fscx100\\fscy100)`
        : `\\fscx96\\fscy96\\t(0,${Math.min(420, ms / 3)},\\fscx100\\fscy100)`;
    result.push(
      event(
        cue.startSec,
        cue.endSec,
        `${base}\\pos(${x},${y})\\fad(${fade},${fade})${animation}`,
        plain(cue.text),
        2
      )
    );
    if (cue.effect !== "spiral") continue;
    // 透视压扁的双圈光带，12fps转动；位于文字下方，不使用全句字号覆盖。
    const radius = Math.min(22, (width - 24) / 2),
      cy = y + cue.fontSize * 0.7 + 4;
    for (let frame = 0; frame < Math.ceil((ms / 1000) * 12); frame++) {
      const start = cue.startSec + frame / 12,
        end = Math.min(cue.endSec, start + 1 / 12);
      if (Math.round(start * 100) >= Math.round(end * 100)) continue;
      const phase = (frame / 12) * Math.PI * 1.5;
      const points = Array.from({ length: 48 }, (_, i) => {
        const t = i / 47,
          r = 0.14 + 0.86 * t,
          angle = t * Math.PI * 4 + phase;
        return [radius * r * Math.cos(angle), 3.2 * r * Math.sin(angle)];
      });
      const polygon: number[][] = [],
        back: number[][] = [];
      points.forEach(([px, py], i) => {
        const prev = points[Math.max(0, i - 1)],
          next = points[Math.min(47, i + 1)];
        const dx = next[0] - prev[0],
          dy = next[1] - prev[1],
          length = Math.max(0.001, Math.hypot(dx, dy));
        const thickness = 0.15 + (0.23 * i) / 47;
        polygon.push([
          px - (dy / length) * thickness,
          py + (dx / length) * thickness,
        ]);
        back.push([
          px + (dy / length) * thickness,
          py - (dx / length) * thickness,
        ]);
      });
      const path =
        polygon
          .concat(back.reverse())
          .map(
            ([px, py], i) =>
              `${i ? "l" : "m"} ${(px + radius).toFixed(2)} ${(py + 4).toFixed(2)}`
          )
          .join(" ") + " c";
      const alpha = Math.round(
        (1 -
          Math.max(
            0,
            Math.min(
              1,
              (start - cue.startSec) / 0.18,
              (cue.endSec - start) / 0.18
            )
          )) *
          255
      );
      const position = `\\an7\\pos(${x - radius},${cy - 4})\\p1\\bord0\\shad0`;
      result.push(
        event(
          start,
          end,
          `${position}\\blur1.1\\1c&H33B9FF&\\alpha&H${Math.min(255, alpha + 65)
            .toString(16)
            .padStart(2, "0")}&`,
          path
        )
      );
      result.push(
        event(
          start,
          end,
          `${position}\\blur0.15\\1c&H9AE9FF&\\alpha&H${alpha.toString(16).padStart(2, "0")}&`,
          path,
          2
        )
      );
    }
  }
  return result;
}
