import React from "react";
import { UI_VERSION } from "../version";

export default function UiVersionBadge() {
  return (
    <div
      style={{
        position: "fixed",
        top: 10,
        right: 16,
        zIndex: 999999,
        fontSize: 12,
        opacity: 0.85,
        padding: "6px 10px",
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(0,0,0,0.35)",
        color: "white",
        backdropFilter: "blur(8px)",
        pointerEvents: "none"
      }}
    >
      UI_VERSION: {UI_VERSION}
    </div>
  );
}
