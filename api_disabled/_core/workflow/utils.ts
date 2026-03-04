import { randomUUID } from "crypto";

export function now() {
  return new Date().toISOString();
}

export function newRunId() {
  return "wf_" + randomUUID();
}
