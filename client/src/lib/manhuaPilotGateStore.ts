import {
  normalizeManhuaPilotGateStore,
  type ManhuaPilotGateStore,
} from "@shared/manhuaPilotGate";

export const MANHUA_PILOT_GATE_STORAGE_KEY = "mv-manhua-pilot-gate-v1";

export function loadManhuaPilotGateStore(
  storage: Pick<Storage, "getItem"> = localStorage,
): ManhuaPilotGateStore {
  try {
    const raw = storage.getItem(MANHUA_PILOT_GATE_STORAGE_KEY);
    return normalizeManhuaPilotGateStore(raw ? JSON.parse(raw) : null);
  } catch {
    return {};
  }
}
export function saveManhuaPilotGateStore(
  store: unknown,
  storage: Pick<Storage, "setItem"> = localStorage,
): boolean {
  try {
    storage.setItem(
      MANHUA_PILOT_GATE_STORAGE_KEY,
      JSON.stringify(normalizeManhuaPilotGateStore(store)),
    );
    return true;
  } catch {
    return false;
  }
}
