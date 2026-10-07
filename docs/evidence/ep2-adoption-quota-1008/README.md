# 第二集采用存储配额修复

开发 Agent 模型：GPT6 Astra（用户指定标注）。基线77ec4f279c939f93145abfa1a39fe98b6bf47b09。

真实用户工程接近localStorage配额，编辑采用将已缓存图片的长链接重新序列化，导致画布保存失败。事务现在与日常保存共用短引用规则；原完整快照仍先保存到IndexedDB，失败仍回滚，未删除用户历史。

## 影响与验证

- 手编、顾问单集与批量共用persistAdvisorRewriteAdoptionWithSnapshot；仍在持久化成功后更新UI，免费/付费资产刷新选择不变。
- 正向：编辑草稿→来源/在途校验→完整IDB快照→短引用多键存储→UI状态；反向：刷新画布→媒体库恢复→原图片字节，正文与其他集成片引用核对。云草稿仍复用既有引用解码，不更改上传或计费。
- `pnpm exec vitest run client/src/lib/manhuaAdvisorSnapshotAdoption.test.ts client/src/lib/manhuaAdvisorAdoption.test.ts client/src/lib/manhuaAdvisorBatchAdoption.test.ts`：19项通过、初版新夹具1项失败（错误指针前缀）；修正为真实makeLocalMediaPointer后定向新例1项通过，共20项。未重复其余已通过项。
- `pnpm exec vitest run client/src/lib/manhuaAdvisorQuota.browser.test.ts`：1项通过；隔离浏览器真实localStorage总量4,968,548字符，旧写法QuotaExceededError，新写法采用并刷新恢复通过。fixture使用虚构源和图片字节，无生产凭证与付费请求。
- `pnpm exec tsc --noEmit --incremental`：最终exit0；`pnpm exec vite build`：成功42.99秒（既有大chunk警告）；`git diff --check`通过。

## 未验与限制

正式第2集采用、重新进入、云备份恢复以及后续人马/GS/BGM预演尚未线上验收；测试夹具不代表用户素材质量。隔离Fly浏览器探针等待前次部署释放窗口，未运行。未知或未缓存引用不强制转指针；真实无剩余空间仍明确报错并保留备份。按用户本批最新直接授权，在发布门禁通过后合并并继续正式线上验证。
