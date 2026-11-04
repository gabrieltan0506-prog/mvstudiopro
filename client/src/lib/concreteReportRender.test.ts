import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { mapGenerateVisualReportResult } from "./visualReportMapper";
import { VisualReportTemplate } from "../components/VisualReportTemplate";
import { assembleConcreteTrendReport, type ConcreteSource } from "../../../shared/concreteTrendReport";
it("服务端具体报告经mapper和正式模板显示真实作者并移除旧占比，不回落旧空栏", () => {
 const sources=["a","b"].map(id=>({id,platform:"wechat",title:"双十一具体文案",description:"原文",author:`真实作者${id}`,authorId:id,publishedAt:"2026-11-03T08:00:00Z",url:null,likes:null,comments:null,shares:null,views:null,query:"消费避坑"} as ConcreteSource));
 const concrete=assembleConcreteTrendReport({insights:[{title:"价格条件",detail:"同规格比较"},{title:"付款条款",detail:"留意退款条件"}],themes:[{primary:"双十一",secondary:["真实到手价"]},{primary:"交易规则",secondary:["付款条件"]}],examples:sources.map(s=>({id:s.id,title:"具体例子",description:"文案依据",angle:"具体问题",structure:"编辑建议",adaptation:"执行建议"})),audiences:[{name:"购物者",need:"查价格",direction:"比较"},{name:"家庭",need:"查条款",direction:"核对"}],suggestions:[{title:"具体选题",detail:"实际执行"},{title:"另一选题",detail:"具体执行"}],assignments:sources.map((s,i)=>({id:s.id,topic:i?"反诈":"价格"}))},sources,{reportTitle:"视频号重点话题",dateRange:"2026.10.21—11.04",platformLabel:"视频号",metricKind:"topicShare"});
 const restored=JSON.parse(JSON.stringify({report:{concreteReport:concrete,dateRange:concrete.dateRange,reportTitle:concrete.reportTitle}}));
 const mapped=mapGenerateVisualReportResult(restored,{windowDays:"15",theme:"light"});
 const html=renderToStaticMarkup(React.createElement(VisualReportTemplate,{data:mapped!}));
 expect(html).toContain("真实作者a");expect(html).not.toContain("50.00%");expect(html).toContain("双十一");expect(html).not.toContain("样本数");expect(html).not.toContain("作品互动率");expect(html).not.toContain("<footer");
});
