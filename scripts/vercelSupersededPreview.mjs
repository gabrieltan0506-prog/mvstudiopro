// “被新版取代”不代表构建内容相同；只对同分支 Preview 做清理。
export const deploymentBranch = d => d?.meta?.githubCommitRef || d?.gitSource?.ref;
const created = d => Number(d?.created ?? d?.createdAt);
const isPreview = d => d && Object.hasOwn(d, 'target') && (d.target === null || d.target === 'preview');
export function selectSupersededPreviews(deployments, protectedIds, now = Date.now(), failedKeepDays = 1) {
  const rows = deployments.filter(d => isPreview(d) && typeof d.uid === 'string'
    && Number.isSafeInteger(created(d)) && created(d) > 0 && created(d) <= now);
  const newest = new Map();
  for (const d of rows) {
    const branch = deploymentBranch(d);
    if (typeof branch !== 'string' || !branch.trim() || d.readyState !== 'READY') continue;
    if (!newest.has(branch) || created(d) > created(newest.get(branch))) newest.set(branch, d);
  }
  return rows.flatMap(d => {
    if (protectedIds.has(d.uid)) return [];
    const replacement = newest.get(deploymentBranch(d));
    const broken = ['ERROR', 'CANCELED'].includes(d.readyState);
    if (!replacement || created(replacement) <= created(d)
      || (!broken && d.readyState !== 'READY')
      || (broken && now - created(d) <= failedKeepDays * 86400000)) return [];
    return [{ uid: d.uid, created: created(d), branch: deploymentBranch(d),
      replacementId: replacement.uid, replacementCreated: created(replacement),
      reason: broken ? 'superseded-failed-preview' : 'superseded-ready-preview' }];
  }).sort((a, b) => a.created - b.created);
}
