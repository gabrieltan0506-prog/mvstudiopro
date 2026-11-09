/**
 * MV「本段歌词」栏（1109）：高光区间旁。
 * 自动识别（听高光区间，待确认版）→ 逐句改字、改起止秒、增删句 → 确认后保存为该作品的歌词时间表。
 * 演唱段的 {} 对白秒锁只读确认版；未确认前不得生成演唱段（非演唱段不受影响）。
 */
import { useState } from "react";
import {
  musicMvLyricLineIssues,
  type MusicMvLyricLine,
  type MusicMvLyricTable,
} from "@shared/canvasMusicMv";

const field = "w-full rounded border border-white/20 bg-black/30 p-1.5 text-xs";
const button = "rounded border border-white/20 px-2 py-1.5 text-xs disabled:opacity-40";

type Props = {
  table?: MusicMvLyricTable;
  range?: { startSec: number; endSec: number };
  disabled?: boolean;
  /** 发起自动识别（服务端两跳听音），返回待确认版。 */
  onRecognize: () => Promise<void>;
  /** 保存（改字/改秒/增删即回到待确认）。 */
  onChange: (next: MusicMvLyricTable) => void;
  /** 确认：调用方同时把唱句同步到演唱镜头。 */
  onConfirm: (next: MusicMvLyricTable) => void;
  onPlayLine?: (line: MusicMvLyricLine) => void;
};

export function CanvasMvLyricTableEditor({ table, range, disabled, onRecognize, onChange, onConfirm, onPlayLine }: Props) {
  const [error, setError] = useState("");
  const stale = Boolean(table && range && (Math.abs(table.range.startSec - range.startSec) > 0.01 || Math.abs(table.range.endSec - range.endSec) > 0.01));
  const edit = (lines: MusicMvLyricLine[]) => {
    if (!table) return;
    setError("");
    onChange({ ...table, lines, status: "pending", editedByUser: true, confirmedAt: undefined });
  };
  /** 对外显示与输入按 0.1 秒（内部剪点/对齐仍按帧）。 */
  const tenth = (n: number) => Math.round(n * 10) / 10;
  const setLine = (i: number, patch: Partial<MusicMvLyricLine>) =>
    edit(table!.lines.map((l, j) => (j === i ? { ...l, ...patch, ...(patch.startSec !== undefined ? { startSec: tenth(patch.startSec) } : {}), ...(patch.endSec !== undefined ? { endSec: tenth(patch.endSec) } : {}) } : l)));
  const issues = table ? musicMvLyricLineIssues(table.lines, table.range) : [];
  return (
    <section aria-label="本段歌词" data-mv-lyric-table className="space-y-2 rounded border border-white/15 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold">歌词时间表（整首；演唱段对口型以确认版为准）</h4>
        <span className="text-xs text-white/60">
          {!table ? "未识别" : table.status === "confirmed" ? "已确认" : "待确认：自动听写常有错字，请逐句核对改字、核对起止秒"}
          {stale ? " · 歌曲已更换，请重新识别" : ""}
        </span>
        <button className={button} disabled={disabled || !range} onClick={() => { setError(""); void onRecognize().catch(e => setError(e instanceof Error ? e.message : "识别失败")); }}>
          {table ? "重新识别歌词" : "自动识别歌词（整首）"}
        </button>
      </div>
      {table && (
        <div className="space-y-1">
          {table.lines.length === 0 && <p className="text-xs text-white/60">本段没有识别到唱词；如确有演唱，请手动添加句子。</p>}
          {table.lines.map((line, i) => (
            <div key={i} className="grid grid-cols-[1fr_5.5rem_5.5rem_auto] items-center gap-1">
              <input aria-label={`第${i + 1}句歌词（可改字）`} className={field} value={line.text} disabled={disabled} onChange={e => setLine(i, { text: e.target.value })} />
              <input aria-label={`第${i + 1}句开始秒`} className={field} type="number" step="0.1" value={tenth(line.startSec).toFixed(1)} disabled={disabled} onChange={e => setLine(i, { startSec: Number(e.target.value) })} />
              <input aria-label={`第${i + 1}句结束秒`} className={field} type="number" step="0.1" value={tenth(line.endSec).toFixed(1)} disabled={disabled} onChange={e => setLine(i, { endSec: Number(e.target.value) })} />
              <span className="flex gap-1">
                {onPlayLine && <button className={button} disabled={disabled} onClick={() => onPlayLine(line)}>试听</button>}
                <button className={button} disabled={disabled} onClick={() => edit(table.lines.filter((_, j) => j !== i))}>删</button>
              </span>
            </div>
          ))}
          <button
            className={button}
            disabled={disabled}
            onClick={() => {
              const last = table.lines[table.lines.length - 1];
              const start = Math.min(table.range.endSec - 0.5, last ? last.endSec : table.range.startSec);
              edit([...table.lines, { text: "新句", startSec: tenth(start), endSec: tenth(Math.min(table.range.endSec, start + 2)) }]);
            }}
          >
            加一句
          </button>
          {issues.length > 0 && <p role="alert" className="text-xs text-amber-200">{issues.join("；")}</p>}
          <button
            className={button}
            disabled={disabled || stale || issues.length > 0 || table.status === "confirmed" || table.lines.some(l => !l.text.trim() || l.text.includes("□"))}
            onClick={() => onConfirm({ ...table, status: "confirmed", confirmedAt: new Date().toISOString() })}
          >
            确认歌词
          </button>
          {table.lines.some(l => l.text.includes("□")) && <p className="text-xs text-amber-200">有听不清的字（□），请改好后再确认。</p>}
        </div>
      )}
      {error && <p role="alert" className="text-xs text-amber-200">{error}</p>}
    </section>
  );
}
