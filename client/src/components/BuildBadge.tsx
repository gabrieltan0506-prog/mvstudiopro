import React from "react";
import { UI_VERSION } from "../version";

export default function BuildBadge() {
  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 10,
        display: "flex",
        justifyContent: "flex-end",
        padding: "8px 0",
        color: "rgba(255,255,255,0.8)",
        fontSize: 12
      }}
    >
      <span style={{
        padding: "6px 10px",
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(0,0,0,0.25)"
      }}>
        BUILD: {UI_VERSION}
      </span>
    </div>
  );
}
