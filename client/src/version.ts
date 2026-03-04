export const UI_VERSION =
  new Date().toISOString().slice(0,10).replace(/-/g,'') +
  "-" +
  Math.floor(Date.now()/1000).toString().slice(-4)

export const UI_COMMIT =
  (import.meta as any).env?.VITE_COMMIT || "dev"
