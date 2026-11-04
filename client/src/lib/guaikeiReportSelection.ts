import { guaikeiReportRefsSchema, type GuaikeiReportRefs } from "@shared/guaikei";
const key = (owner: string) => `guaikei-report-selection:v1:${owner}`;
export function readGuaikeiReportSelection(owner: string): GuaikeiReportRefs {
  if (!owner) return [];
  try { return guaikeiReportRefsSchema.parse(JSON.parse(localStorage.getItem(key(owner)) || "[]")); }
  catch { return []; }
}
export function writeGuaikeiReportSelection(owner: string, refs: GuaikeiReportRefs) {
  if (!owner) throw new Error("请先登录");
  localStorage.setItem(key(owner), JSON.stringify(guaikeiReportRefsSchema.parse(refs)));
}
