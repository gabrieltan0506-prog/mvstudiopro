import {expect,it} from 'vitest';
import {retimeManhuaShot} from './manhuaShotTimingEdit';
const text=`正文保留\n## 分镜表\n| 镜号 | 秒位 | 景别/运镜 | 画面 | 对白 |\n|---|---|---|---|---|\n| 1 | 0–4秒 | 中景横移 | 背着娘 | 娘：「慢点。」 |\n| 2 | 4–7秒 | 近景 | 扶稳 | 阿菁：「快到了。」 |\n| 3 | 7–12秒 | 特写 | 看向摊柱 | 无 |\n\n## 结尾\n原文`;
it('延长首镜顺延后镜，台词画面和其他段落不变',()=>{
 const changed=retimeManhuaShot(text,1,4.944);
 expect(changed.rows.map(row=>[row.startSec,row.endSec])).toEqual([[0,4.944],[4.944,7.944],[7.944,12.944]]);
 expect(changed.text).toContain('## 结尾\n原文');expect(changed.text).toContain('阿菁：「快到了。」');
 expect(changed.totalSec).toBe(12.944);
 expect(retimeManhuaShot(changed.text,1,4).rows.map(row=>[row.startSec,row.endSec])).toEqual([[0,4],[4,7],[7,12]]);
});
it('约时码表保留光影及转义内容，跨分钟精确顺延',()=>{
 const old='| 镜号 | 约时码 | 景别 | 角度 | 运镜 | 灯光 | 主体动作 | 音频 | 时长建议 |\n|---|---|---|---|---|---|---|---|---|\n| 01 | 0:00 | 中景 | 平视 | 横移 | 柔光 | 扶\\|稳 | 娘：「慢点。」＋脚步 | 59s |\n| 02 | 0:59 | 近景 | 平视 | 固定 | 侧光 | 点头 | 无对白＋风声 | 3s |';
 const changed=retimeManhuaShot(old,1,60.944);expect(changed.rows[1].startSec).toBe(60.944);expect(changed.text).toContain('1:00.944');expect(changed.text).toContain('扶\\|稳');expect(changed.text).toContain('柔光');
});
it('不修坏原稿、不接受不存在的镜号和非法秒数',()=>{
 expect(()=>retimeManhuaShot(text.replace('4–7','3–7'),1,5)).toThrow();
 for(const value of [0,NaN,Infinity,3601]) expect(()=>retimeManhuaShot(text,1,value)).toThrow();
 expect(()=>retimeManhuaShot(text,4,5)).toThrow();
});
