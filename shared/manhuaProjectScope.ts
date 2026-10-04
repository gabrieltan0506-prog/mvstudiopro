/** A project owns its storage namespace for the lifetime of this document. */
export type ManhuaProjectScope = { projectId: string; ownerId: string };
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function parseManhuaProjectScope(
  search: string
): ManhuaProjectScope | null {
  const params = new URLSearchParams(search);
  if (!params.has("project")) return null;
  const projectId = params.get("project") || "",
    ownerId = params.get("owner") || "";
  if (!uuid.test(projectId) || !/^\d+$/.test(ownerId))
    throw new Error("作品地址无效，未打开原作品");
  return { projectId, ownerId };
}
let captured = false;
let documentScope: ManhuaProjectScope | null = null;
export function currentManhuaProjectScope(): ManhuaProjectScope | null {
  if (!captured && typeof window !== "undefined") {
    documentScope =
      window.location.pathname === "/canvas"
        ? parseManhuaProjectScope(window.location.search)
        : null;
    captured = true;
  }
  return documentScope;
}
export function scopedManhuaStorage(
  storage: Storage,
  scope: ManhuaProjectScope | null
): Storage {
  if (!scope) return storage;
  const prefix = `mv-manhua-project:${scope.ownerId}:${scope.projectId}:`;
  const keys = () =>
    Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(
      (key): key is string => !!key?.startsWith(prefix)
    );
  return {
    get length() {
      return keys().length;
    },
    key: index => keys()[index]?.slice(prefix.length) ?? null,
    getItem: key => storage.getItem(prefix + key),
    setItem: (key, value) => storage.setItem(prefix + key, value),
    removeItem: key => storage.removeItem(prefix + key),
    clear: () => {
      for (const key of keys()) storage.removeItem(key);
    },
  };
}
// Never patch the browser's Storage prototype. Callers outside the factory keep normal storage.
export const manhuaProjectStorage: Storage = {
  get length() {
    return scopedManhuaStorage(
      globalThis.localStorage,
      currentManhuaProjectScope()
    ).length;
  },
  key: index =>
    scopedManhuaStorage(
      globalThis.localStorage,
      currentManhuaProjectScope()
    ).key(index),
  getItem: key =>
    scopedManhuaStorage(
      globalThis.localStorage,
      currentManhuaProjectScope()
    ).getItem(key),
  setItem: (key, value) =>
    scopedManhuaStorage(
      globalThis.localStorage,
      currentManhuaProjectScope()
    ).setItem(key, value),
  removeItem: key =>
    scopedManhuaStorage(
      globalThis.localStorage,
      currentManhuaProjectScope()
    ).removeItem(key),
  clear: () =>
    scopedManhuaStorage(
      globalThis.localStorage,
      currentManhuaProjectScope()
    ).clear(),
};

export const manhuaProjectSessionStorage: Storage = {
  get length() {
    return scopedManhuaStorage(
      globalThis.sessionStorage,
      currentManhuaProjectScope()
    ).length;
  },
  key: index =>
    scopedManhuaStorage(
      globalThis.sessionStorage,
      currentManhuaProjectScope()
    ).key(index),
  getItem: key =>
    scopedManhuaStorage(
      globalThis.sessionStorage,
      currentManhuaProjectScope()
    ).getItem(key),
  setItem: (key, value) =>
    scopedManhuaStorage(
      globalThis.sessionStorage,
      currentManhuaProjectScope()
    ).setItem(key, value),
  removeItem: key =>
    scopedManhuaStorage(
      globalThis.sessionStorage,
      currentManhuaProjectScope()
    ).removeItem(key),
  clear: () =>
    scopedManhuaStorage(
      globalThis.sessionStorage,
      currentManhuaProjectScope()
    ).clear(),
};
