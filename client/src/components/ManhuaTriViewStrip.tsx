/** 设定卡下半 FRONT/SIDE/BACK：三栏各自裁切 */
export default function ManhuaTriViewStrip({ url, compact }: { url: string; compact?: boolean }) {
  const h = compact ? "h-24" : "h-28";
  const panels: Array<{ label: string; bgPos: string }> = [
    { label: "正面", bgPos: "0% 100%" },
    { label: "侧面", bgPos: "50% 100%" },
    { label: "背面", bgPos: "100% 100%" },
  ];
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {panels.map((p) => (
        <div key={p.label} className={`relative overflow-hidden rounded-md border border-white/10 bg-black/50 ${h}`}>
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `url(${url})`,
              backgroundRepeat: "no-repeat",
              backgroundSize: "300% 255%",
              backgroundPosition: p.bgPos,
            }}
            role="img"
            aria-label={p.label}
          />
          <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-center text-[9px] font-semibold tracking-wide text-white/85">
            {p.label}
          </span>
        </div>
      ))}
    </div>
  );
}
