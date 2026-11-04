import { expect, it } from "vitest";
import { buildBilibiliConcreteSources } from "./nativeConcreteTrendSources";
const start=Date.parse("2026-10-21T00:00:00+08:00"),end=Date.parse("2026-11-05T00:00:00+08:00");
const row={id:"BV-real",title:"真实标题",author:"真实UP主",publishedAt:"2026-11-01T00:00:00+08:00",views:10000,likes:300};
it("真实B站原库保留作者ID时间与缺失指标，不捏造互动率",()=>{
 expect(buildBilibiliConcreteSources([row],start,end)[0]).toMatchObject({id:row.id,author:row.author,platform:"bilibili",views:10000,comments:null,shares:null});
});
it("过滤缺作者缺发布时间和窗外作品，不能用观测时间伪装新作品",()=>{
 expect(buildBilibiliConcreteSources([{...row,author:""},{...row,publishedAt:undefined,observedAt:row.publishedAt},{...row,publishedAt:"2026-01-01"}],start,end)).toHaveLength(0);
});
it("来源按ID去重，限量按真实指标排序",()=>{
 const result=buildBilibiliConcreteSources([row,{...row,views:20000},{...row,id:"BV-two",views:30000}],start,end,2);
 expect(result.map(x=>x.id)).toEqual(["BV-two","BV-real"]);expect(result[1].views).toBe(20000);
});

import { buildNativeConcreteSources, mergeConcreteSources } from "./nativeConcreteTrendSources";
it("抖音原库进入具体报告；外部同ID正文保留但不混不同记录的互动指标",()=>{
 const native=buildNativeConcreteSources("douyin",[row],start,end);
 const external={...native[0],description:"真实外部完整文案",views:null,comments:5};
 const merged=mergeConcreteSources(native,[external]);expect(merged).toHaveLength(1);expect(merged[0]).toMatchObject({description:external.description,views:null,comments:5,platform:"douyin"});
});
