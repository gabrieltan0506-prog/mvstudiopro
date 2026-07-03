const SUPERVISOR_ACCESS_KEY = "mvs-supervisor-access";

/** 与 PlatformPage / MVAnalysis 一致的 supervisor URL token 检测 */
export function hasSupervisorAccess(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get("supervisor") === "1") {
    localStorage.setItem(SUPERVISOR_ACCESS_KEY, "1");
    return true;
  }
  return localStorage.getItem(SUPERVISOR_ACCESS_KEY) === "1";
}
