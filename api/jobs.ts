import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";

function normalizeProvider(x: any): string {
  const raw = (x ?? "").toString().trim();
  const m: Record<string,string> = {
    "nano_flash": "nano-banana-flash",
    "nanoBananaFlash": "nano-banana-flash",
    "nano-banana-flash": "nano-banana-flash",
    "nanobananaflash": "nano-banana-flash",
    "nano-banana-pro": "nano-banana-pro",
    "nanoBananaPro": "nano-banana-pro",
    "kling_beijing": "kling_beijing",
    "kling": "kling_beijing",
    "kling-beijing": "kling_beijing",
    "klingBeijing": "kling_beijing"
  };
  return m[raw] || raw;
}
<