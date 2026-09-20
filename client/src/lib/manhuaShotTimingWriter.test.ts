import { expect, it } from 'vitest';
import { retimeManhuaWriterPack } from './manhuaShotTimingDraft';
import { retimeManhuaShot } from '@shared/manhuaShotTimingEdit';
import { parseManhuaEpisodeSegmentPlanFromMarkdown } from '@shared/manhuaEpisodeSegmentPlan';
import { readManhuaTimedStoryboard } from '@shared/manhuaTimedStoryboard';
import type { ManhuaWriterPack } from '@shared/manhuaWriterRoom';
const table='| 镜号 | 秒位 | 景别/运镜 | 画面 | 对白 |\n|---|---|---|---|---|\n|1|0–4秒|中景|扶稳病母|娘：「慢点，我喘不上来。」|\n|2|4–7秒|近景|回头|阿菁：「快到了。」|';
const original='原剧情\n#### 段01\n- 意图：送母亲就医\n- 对白：娘：「慢点，我喘不上来。」\n- 表演：扶稳病母\n- 光影运镜：暖灯下横移';
const pack={seriesTitle:'故事',logline:'就医',charactersMd:'阿菁、娘',propsMd:'药碗',locationsMd:'街道',episodes:[{index:1,title:'就医',body:original,endHook:'到了吗？'},{index:2,title:'医馆',body:'下一集原文',endHook:'等天亮'}],rawMarkdown:'旧导出稿'.repeat(30),episodeCount:2} as ManhuaWriterPack;
it('旧分段保留全部内容但退出生产解析，秒位表与导出同步，其他集不变',()=>{
 const canonical=retimeManhuaShot(table,1,5);
 const next=retimeManhuaWriterPack(pack,1,1,5,canonical);
 const body=next.episodes[0].body;
 expect(parseManhuaEpisodeSegmentPlanFromMarkdown(body).segments).toHaveLength(0);
 expect(readManhuaTimedStoryboard(body).rows.map(r=>[r.startSec,r.endSec])).toEqual([[0,5],[5,8]]);
 for(const line of original.split('\n').filter(l=>!l.startsWith('####'))) expect(body).toContain(line);
 expect(next.episodes[1]).toBe(pack.episodes[1]);
 expect(next.rawMarkdown).toContain(body);expect(next.rawMarkdown).not.toContain('旧导出稿');
 expect(pack.episodes[0].body).toBe(original);
 const again=retimeManhuaWriterPack(next,1,1,5,canonical);
 expect(again).toEqual(next);
});
it('修复旧版已经写入的混合稿，不重复追加秒位表或丢弃对白',()=>{
 const mixed={...pack,episodes:[{...pack.episodes[0],body:`${original}\n\n## 分镜表\n${table}`},pack.episodes[1]]};
 const next=retimeManhuaWriterPack(mixed,1,1,5,retimeManhuaShot(table,1,5));
 expect(parseManhuaEpisodeSegmentPlanFromMarkdown(next.episodes[0].body).segments).toHaveLength(0);
 expect(readManhuaTimedStoryboard(next.episodes[0].body).rows).toHaveLength(2);
 expect(next.rawMarkdown).toContain('娘：「慢点，我喘不上来。」');
});
