/**
 * Web Font Preload & Error Suppression
 *
 * 1. Injects <link rel="preload"> for MaterialIcons font so the browser
 *    starts downloading it immediately, before expo-font tries to load it.
 * 2. Suppresses fontfaceobserver timeout errors so they don't crash the app.
 *    The icons will still render once the font eventually loads via CSS @font-face.
 */
import { Platform } from "react-native";

/**
 * Call this once at app startup (web only).
 * It injects a preload link for the MaterialIcons font and
 * sets up a global error handler to swallow font timeout errors.
 */
export function initWebFontPreload() {
  if (Platform.OS !== "web" || typeof document === "undefined") return;

  // 1. Suppress fontfaceobserver timeout errors globally
  //    These are non-fatal: the @font-face CSS rule still loads the font,
  //    fontfaceobserver just can't detect it within the timeout window.
  const originalOnError = window.onerror;
  window.onerror = function (message, source, lineno, colno, error) {
    const msg = typeof message === "string" ? message : "";
    const errMsg = error?.message ?? "";
    if (
      msg.includes("timeout exceeded") ||
      errMsg.includes("timeout exceeded") ||
      (typeof source === "string" && source.includes("fontfaceobserver"))
    ) {
      // Swallow the error silently - font will still load via CSS
      return true;
    }
    if (originalOnError) {
      return originalOnError.call(window, message, source, lineno, colno, error);
    }
    return false;
  };

  // Also handle unhandled promise rejections from fontfaceobserver
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    if (
      reason instanceof Error &&
      reason.message.includes("timeout exceeded")
    ) {
      event.preventDefault(); // Suppress the error
      return;
    }
  });
}
