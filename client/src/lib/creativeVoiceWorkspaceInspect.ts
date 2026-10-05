/** Read-only inspection joins the actual production IDs with the current page snapshot. */
export async function inspectCreativeVoiceWorkspace(
  page: string,
  readProduction?: () => Promise<string>,
): Promise<string> {
  let state: Record<string, unknown>;
  try { state = JSON.parse(page); } catch { return JSON.stringify({pageReadError:page}); }
  if (!readProduction) return page;
  try { state.productionState = JSON.parse(await readProduction()); }
  catch (error) { state.productionReadError = error instanceof Error ? error.message : "制作资料读取失败"; }
  return JSON.stringify(state);
}
