import React, { useEffect, useRef, useState } from "react";

const BASE = "/migrated/home/poster1.jpg";
const REVEAL = "/migrated/home/poster2.jpg";

type Trail = { x: number; y: number; id: number };

/**
 * V3 叠加动效：圆形光标遮罩揭示第二图层（双竖幅照片）。
 * 移动加快时留下短暂回声；尊重 prefers-reduced-motion。
 */
export default function HomeCursorReveal() {
  const rootRef = useRef<HTMLDivElement>(null);
  const target = useRef({ x: 0.62, y: 0.42 });
  const current = useRef({ x: 0.62, y: 0.42 });
  const last = useRef({ x: 0.62, y: 0.42, t: 0 });
  const rafRef = useRef(0);
  const [pos, setPos] = useState({ x: 62, y: 42 });
  const [trails, setTrails] = useState<Trail[]>([]);
  const [reduceMotion, setReduceMotion] = useState(false);
  const trailId = useRef(0);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(mq.matches);
    const onChange = () => setReduceMotion(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    const tick = () => {
      const c = current.current;
      const t = target.current;
      c.x += (t.x - c.x) * 0.14;
      c.y += (t.y - c.y) * 0.14;
      setPos({ x: c.x * 100, y: c.y * 100 });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [reduceMotion]);

  const onMove = (e: React.PointerEvent) => {
    if (reduceMotion) return;
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const nx = Math.min(1, Math.max(0, x));
    const ny = Math.min(1, Math.max(0, y));
    target.current = { x: nx, y: ny };

    const now = performance.now();
    const dt = Math.max(16, now - last.current.t);
    const speed = Math.hypot(nx - last.current.x, ny - last.current.y) / (dt / 1000);
    last.current = { x: nx, y: ny, t: now };
    if (speed > 1.8) {
      const id = ++trailId.current;
      setTrails((prev) => [...prev.slice(-4), { x: nx * 100, y: ny * 100, id }]);
      window.setTimeout(() => {
        setTrails((prev) => prev.filter((p) => p.id !== id));
      }, 280);
    }
  };

  const mask = `radial-gradient(circle 140px at ${pos.x}% ${pos.y}%, #000 0%, #000 55%, transparent 72%)`;

  return (
    <section className="mx-auto max-w-[1240px] px-5 pt-10">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">Motion · V3</div>
          <h2 className="mt-1 text-xl font-black tracking-tight text-white md:text-2xl">光标揭层</h2>
          <p className="mt-1 max-w-lg text-sm leading-relaxed text-white/55">
            移动指针查看第二图层气质。桌面端体验最佳；触控设备显示静态对比。
          </p>
        </div>
      </div>

      <div
        ref={rootRef}
        onPointerMove={onMove}
        className="relative aspect-[16/9] overflow-hidden rounded-3xl border border-white/10 bg-[#0c0b16] md:aspect-[21/9]"
      >
        <img src={BASE} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
        <img
          src={REVEAL}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
          style={
            reduceMotion
              ? { clipPath: "inset(0 0 0 50%)" }
              : {
                  WebkitMaskImage: mask,
                  maskImage: mask,
                }
          }
        />
        {!reduceMotion
          ? trails.map((t) => (
              <div
                key={t.id}
                className="pointer-events-none absolute h-[220px] w-[220px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/25 bg-white/5"
                style={{
                  left: `${t.x}%`,
                  top: `${t.y}%`,
                  animation: "home-cursor-echo 0.28s ease-out forwards",
                }}
              />
            ))
          : null}
        {!reduceMotion ? (
          <div
            className="pointer-events-none absolute h-[280px] w-[280px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/35 shadow-[0_0_40px_rgba(255,255,255,0.12)]"
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
          />
        ) : null}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-5 py-4">
          <div className="text-sm font-bold text-white">双图层成片气质</div>
          <div className="text-xs text-white/60">底层 / 揭示层均来自首页样片海报</div>
        </div>
      </div>

      <style>{`
        @keyframes home-cursor-echo {
          from { opacity: 0.55; transform: translate(-50%, -50%) scale(0.92); }
          to { opacity: 0; transform: translate(-50%, -50%) scale(1.15); }
        }
      `}</style>
    </section>
  );
}
