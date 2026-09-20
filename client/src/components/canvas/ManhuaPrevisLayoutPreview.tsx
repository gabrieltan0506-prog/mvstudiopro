import { previsPlaybackDuration } from "@shared/manhuaPrevisPlayback";
import { manhuaPresentationToSourceSec, manhuaSourceToPresentationSec } from "@shared/manhuaActionPlanTiming";
import { useEffect, useRef, useState } from "react";
import type { ManhuaPrevisSpec } from "@shared/manhuaPrevis";
import { previsActorColor } from "@shared/manhuaPrevisColors";
import { movePrevisLayoutEndpoint, previsLayoutActorPosition, previsLayoutCamera, projectPrevisPoint, type Vec3 } from "@/lib/manhuaPrevisLayout";

export function ManhuaPrevisLayoutPreview({ spec, disabled, onChange }: {
  spec: ManhuaPrevisSpec; disabled?: boolean; onChange: (spec: ManhuaPrevisSpec) => boolean;
}) {
  const duration = previsPlaybackDuration(spec);
  const toDisplayTime = (t: number) => spec.timeMap ? manhuaSourceToPresentationSec(spec.timeMap, t) : t;
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [endpoint, setEndpoint] = useState<"start" | "end">("start");
  const [selected, setSelected] = useState("");
  const [drag, setDrag] = useState<{ id: string; point: [number, number] } | null>(null);
  const plane = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!playing) return;
    let handle = 0, previous = performance.now();
    const tick = (now: number) => {
      setTime(t => (t + Math.min(.1, (now - previous) / 1000)) % duration);
      previous = now; handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [playing, duration]);
  useEffect(() => { setTime(t => Math.min(t, duration - 1 / 24)); }, [duration]);
  useEffect(() => { if (disabled) setDrag(null); }, [disabled]);
  const current = drag ? movePrevisLayoutEndpoint(spec, drag.id, endpoint, drag.point) : spec;
  const sourceTime = current.timeMap ? manhuaPresentationToSourceSec(current.timeMap, time) : time;
  const camera = previsLayoutCamera(current, sourceTime);
  const w = 480, h = spec.aspect === "9:16" ? 480 * 16 / 9 : 270;
  const project = (p: Vec3) => camera ? projectPrevisPoint(p, camera, w, h) : null;
  const actorId = current.actors.some(a => a.id === selected) ? selected : current.actors[0]?.id;
  const pointAt = (clientX: number, clientY: number): [number, number] => {
    const rect = plane.current!.getBoundingClientRect();
    return [(clientX - rect.left) / rect.width * 24 - 12, 12 - (clientY - rect.top) / rect.height * 24];
  };
  const proxies = current.actors.map(actor => {
    const root = previsLayoutActorPosition(actor, sourceTime), height = actor.shape === "horse" ? 1.4 : 1.7;
    const bottom = project(root), top = project([root[0], root[1], height]);
    return { actor, bottom, top };
  }).filter(p => p.bottom && p.top).sort((a, b) => b.bottom!.depth - a.bottom!.depth);
  const btn = "rounded border border-white/20 px-2 py-1 disabled:opacity-40";
  return <section data-previs-layout-preview className="space-y-2 rounded border border-cyan-300/20 p-2 text-xs text-white/80">
    <div className="flex flex-wrap items-center gap-2">
      <strong>站位与镜头预演</strong>
      <button type="button" className={btn} onClick={() => setPlaying(p => !p)}>{playing ? "暂停预演" : "播放走位"}</button>
      <input aria-label="走位预演时间" type="range" min={0} max={Math.max(0, duration - 1/24)} step={1/24} value={time} onChange={e => { setPlaying(false); setTime(Number(e.target.value)); }} />
      <span>{time.toFixed(2)} / {duration.toFixed(2)} 秒</span>
    </div>
    <p>拖动彩色人物调整站位，也可选中人物后用方向键微调；右侧即时查看构图示意（正式渲染可能调整竖屏取景）。此处用简化站位体显示平面运动，姿态、持物、水花及真实场景遮挡请看下方渲染视频。</p>
    <div className="flex flex-wrap gap-2">
      <select aria-label="布局角色" value={actorId} disabled={disabled} className="bg-slate-900" onChange={e => setSelected(e.target.value)}>{current.actors.map(a => <option key={a.id} value={a.id}>{a.nameZh}</option>)}</select>
      {(["start", "end"] as const).map(value => <button key={value} type="button" aria-pressed={endpoint === value} className={btn} disabled={disabled} onClick={() => {
        setEndpoint(value); setPlaying(false);
        const actor = spec.actors.find(a => a.id === actorId);
        setTime(value === "start" ? 0 : toDisplayTime(Math.min(spec.durationSec - 1/24, actor?.motionRoute?.at(-1)?.timeSec ?? actor?.moveEndSec ?? spec.durationSec)));
      }}>{value === "start" ? "调整起点" : "调整终点"}</button>)}
      <span>拖动后保存配置，不自动提交渲染。</span>
    </div>
    <div className="grid gap-2 sm:grid-cols-2">
      <svg ref={plane} viewBox="0 0 240 240" preserveAspectRatio="none" role="img" aria-label="可拖动人物站位俯视图" className="w-full touch-none rounded bg-slate-950"
        onPointerMove={e => { if (drag && !disabled) setDrag({ ...drag, point: pointAt(e.clientX, e.clientY) }); }}
        onPointerUp={e => { if (!drag) return; if (!disabled) onChange(movePrevisLayoutEndpoint(spec, drag.id, endpoint, pointAt(e.clientX, e.clientY))); setDrag(null); }}
        onPointerCancel={() => setDrag(null)}>
        {Array.from({ length: 13 }, (_, i) => <g key={i} stroke="#334155" strokeWidth=".5"><path d={`M${i*20} 0V240 M0 ${i*20}H240`} /></g>)}
        {current.actors.map(a => {
          const p = a[endpoint], color = previsActorColor(a.id, current.actors).hex;
          return <g key={a.id} data-layout-actor={a.id} role="button" tabIndex={disabled ? -1 : 0} aria-label={`${a.nameZh}的${endpoint === "start" ? "起点" : "终点"}，方向键移动`} onKeyDown={e => {
            const delta: Record<string, [number, number]> = { ArrowLeft: [-.2, 0], ArrowRight: [.2, 0], ArrowUp: [0, .2], ArrowDown: [0, -.2] };
            if (disabled || !delta[e.key]) return;
            e.preventDefault(); setSelected(a.id); setPlaying(false);
            onChange(movePrevisLayoutEndpoint(spec, a.id, endpoint, [p[0] + delta[e.key][0], p[1] + delta[e.key][1]]));
          }} transform={`translate(${120+p[0]*10},${120-p[1]*10})`} style={{ cursor: disabled ? "default" : "grab" }} onPointerDown={e => {
            if (disabled) return; e.preventDefault(); setSelected(a.id); setPlaying(false);
            setTime(endpoint === "start" ? 0 : toDisplayTime(Math.min(spec.durationSec - 1/24, a.motionRoute?.at(-1)?.timeSec ?? a.moveEndSec)));
            plane.current?.setPointerCapture(e.pointerId); setDrag({ id: a.id, point: [...p] });
          }}><circle r="6" fill={color} stroke={a.id === actorId ? "white" : color} strokeWidth="1.5"/><text y="-10" textAnchor="middle" fill={color} fontSize="8">{a.nameZh}</text></g>;
        })}
        {camera && <><path pointerEvents="none" d={`M${120+camera.position[0]*10} ${120-camera.position[1]*10} L${120+camera.target[0]*10} ${120-camera.target[1]*10}`} stroke="#67e8f9" strokeDasharray="3 3" />
        <circle pointerEvents="none" cx={120+camera.position[0]*10} cy={120-camera.position[1]*10} r="3" fill="white" /></>}
      </svg>
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="当前机位站位构图" className="max-h-80 w-full rounded bg-slate-950">
        {Array.from({ length: 13 }, (_, i) => i*2-12).flatMap(n => [[[-12,n,0],[12,n,0]],[[n,-12,0],[n,12,0]]]).map((line, i) => {
          const a = project(line[0] as Vec3), b = project(line[1] as Vec3);
          return a && b ? <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#334155" /> : null;
        })}
        {proxies.map(({actor, bottom, top}) => {
          const size = Math.max(2, Math.abs(bottom!.y - top!.y)), color = previsActorColor(actor.id, current.actors).hex;
          return <g key={actor.id}><line x1={bottom!.x} y1={bottom!.y-size*.12} x2={top!.x} y2={top!.y+size*.24} stroke={color} strokeWidth={size*.25} strokeLinecap="round"/><circle cx={top!.x} cy={top!.y+size*.1} r={size*.1} fill={color}/><text x={top!.x} y={top!.y-8} textAnchor="middle" fill={color} fontSize="14">{actor.nameZh}</text></g>;
        })}
        <text x="12" y="22" fill="white" fontSize="12">{camera ? "机位构图 · 简化站位体" : "尚未配置机位，请先添加镜头"}</text>
      </svg>
    </div>
  </section>;
}
