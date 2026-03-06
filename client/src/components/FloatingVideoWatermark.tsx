import React, { useEffect, useMemo, useState } from "react";

type Pos = {
  top?: string;
  bottom?: string;
  left: string;
};

const positions: Pos[] = [
  { top: "8%", left: "6%" },
  { top: "10%", left: "58%" },
  { top: "16%", left: "28%" },
  { bottom: "10%", left: "8%" },
  { bottom: "12%", left: "52%" },
  { bottom: "18%", left: "30%" },
];

export default function FloatingVideoWatermark({
  enabled = true,
  text = "Powered by mvstudiopro.com",
}: {
  enabled?: boolean;
  text?: string;
}) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => {
      setIdx((v) => (v + 1) % positions.length);
    }, 2600);
    return () => clearInterval(t);
  }, [enabled]);

  const pos = useMemo(() => positions[idx], [idx]);

  if (!enabled) return null;

  return (
    <div
      style={{
        position: "absolute",
        pointerEvents: "none",
        ...pos,
        padding: "7px 12px",
        borderRadius: 999,
        background: "rgba(8,8,12,0.28)",
        border: "1px solid rgba(255,255,255,0.12)",
        color: "rgba(255,255,255,0.78)",
        fontSize: 12,
        fontWeight: 800,
        letterSpacing: 0.2,
        backdropFilter: "blur(8px)",
        transition: "all 0.8s ease",
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </div>
  );
}
