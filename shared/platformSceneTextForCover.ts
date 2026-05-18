/**
 * 与 PlatformPage.buildPlatformSceneText 对齐的纯字串版，供服务端从 DB 快照还原封面 context。
 */
export function buildPlatformSceneTextForCover(item: {
  title: string;
  hook: string;
  copywriting: string;
  executionDetails?: { environmentAndWardrobe?: string; lightingAndCamera?: string };
}): string {
  const title = String(item.title || "").replace(/\s+/g, " ").trim();
  const hook = String(item.hook || "").replace(/\s+/g, " ").trim();
  const copy = String(item.copywriting || "").replace(/\s+/g, " ").trim();
  let promptText = `${title} ${hook}\n${copy}`;
  const ex = item.executionDetails;
  if (ex) {
    const env = String(ex.environmentAndWardrobe || "").replace(/\s+/g, " ").trim();
    const light = String(ex.lightingAndCamera || "").replace(/\s+/g, " ").trim();
    if (env || light) {
      promptText = `场景与服装：${env}，灯光与镜头：${light}。\n主题：${title}\n${hook}\n${copy}`;
    }
  }
  return promptText.slice(0, 12000);
}
