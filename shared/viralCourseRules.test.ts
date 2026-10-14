import { describe, expect, it } from "vitest";
import { selectViralCourseRules } from "./viralCourseRules";
import { buildViralMethodPlan, compileViralCreatorInput } from "./viralCreationMethods";
import { auditXhsCreationPackage, connectXhsPackageToBlueprint, xhsCreationPackageSchema } from "./xhsCreationPackage";
import { fictionalViralBlueprint } from "./viralCreation.fixture";

describe("课程方法按场景进入既有创作合同", () => {
  it("初选保留复合人物，以时点和读者需要选卡，不提前注入拍摄规则", () => {
    const plan = buildViralMethodPlan("二胎妈妈兼瑜伽老师，准备开学后的系列内容", "follow");
    expect(plan.courseRules.map(r => r.id)).toEqual(expect.arrayContaining(["course-persona", "course-demand", "course-calendar", "course-series"]));
    expect(plan.courseRules.some(r => r.id === "course-shot-plan")).toBe(false);
    expect(plan.positioning.axes).toContain("复合身份与真实经历");
  });
  it("图文不带视频卡，真实产品缺体验时降为资料对比", () => {
    const graphic = selectViralCourseRules({stage:"expand",format:"图文",context:"两款咖啡器具测评"});
    const video = selectViralCourseRules({stage:"expand",format:"短视频",context:"两款咖啡器具测评"});
    expect(graphic.some(r => r.id === "course-shot-plan")).toBe(false);
    expect(video.some(r => r.id === "course-shot-plan")).toBe(true);
    expect(graphic.find(r => r.id === "course-product-proof")?.missingInput).toContain("不冒充实测");
    expect(selectViralCourseRules({stage:"expand",format:"图文",context:"秋日街边散步故事"}).some(r => r.id === "course-product-proof")).toBe(false);
  });
  it("独立编译入口把完整用户要求和实际方法卡一起送入模型输入", () => {
    const request = compileViralCreatorInput({profile:"二胎妈妈兼瑜伽老师，讲话轻松",requirements:"只讲真实带娃经历，不宣传疗效",stage:"expand",selectedTopic:{title:"放学后收拾书桌"},targetPlatform:"xiaohongshu",targetFormat:"图文"});
    const input=JSON.parse(request.user);
    expect(input.profile).toContain("二胎妈妈兼瑜伽老师");
    expect(input.requirements).toContain("不宣传疗效");
    expect(input.methodPlan.courseRules.find((r: {id:string}) => r.id === "course-scene-bridge").outputs).toContain("场景/动作");
    expect(request.system).toContain("缺资料按missingInput处理");
  });
  it("扩写缺独立目标字段时沿用户与已选题要求，不改成默认涨粉", () => {
    const plan = buildViralMethodPlan("给社区咖啡店写获客内容", undefined, {stage:"expand",format:"图文"});
    expect(plan.conversion.goal).toBeNull();
    expect(plan.conversion.action).toContain("沿完整用户要求");
  });
  it("新方法必须引用实际正文，审核通过后沿既有封面消费者保留", () => {
    const bp = fictionalViralBlueprint();
    bp.methodApplications[0].methodId = "course-scene-bridge";
    const audit = auditXhsCreationPackage(bp);
    expect(audit.passed).toBe(true);
    connectXhsPackageToBlueprint(bp, audit.package!);
    expect(JSON.stringify(bp.executionDetails)).toContain(bp.xhsPackage.cover.visual);
    bp.methodApplications[0].quote = "这是一段从未在正文出现过的虚构证据";
    expect(auditXhsCreationPackage(bp).findings.map(f=>f.code)).toContain("method_application");
  });
});


describe("已确认8项按形式进入编译输入", () => {
  it("图文保留承接、需求阶段、故事、证据排版和数据尺度，缺输入不补造", () => {
    const req=compileViralCreatorInput({profile:"咖啡店店主，真实提供备课经历与交付清单",requirements:"获客测评，使用已有数据",stage:"expand",selectedTopic:{title:"如何选择咖啡器具"},targetPlatform:"xiaohongshu",targetFormat:"图文"});
    const rules=JSON.parse(req.user).methodPlan.courseRules;
    const rule=(id:string)=>rules.find((r:{id:string})=>r.id===id);
    expect(rule("course-delivery").outputs).toContain("承诺—入口—交付对应说明");
    expect(rule("course-persona").checks).toContain("不把想到过的方法写成已经试过");
    expect(rule("course-scene-bridge").checks).toContain("无经历不补造第一人称故事");
    expect(rule("course-cover-layout").outputs).toContain("主证据呈现方式");
    expect(rule("course-product-proof").checks).toContain("参照同维度且可回算");
    expect(rule("course-measure").checks).toContain("不一律推荐改封面");
    expect(rule("course-shot-plan")).toBeUndefined();
  });
  it("视频入参保留场景、重点词停顿、视线试拍和比例检查", () => {
    const req=compileViralCreatorInput({profile:"社区咖啡店主",requirements:"在吧台拍摄演示视频，保留操作细节",stage:"expand",selectedTopic:{title:"手冲演示"},targetPlatform:"douyin",targetFormat:"短视频",platforms:["douyin"],formats:["短视频"]});
    const rule=JSON.parse(req.user).methodPlan.courseRules.find((r:{id:string})=>r.id==="course-shot-plan");
    expect(rule.inputs).toContain("视线对象与可用拍摄场景");
    expect(rule.outputs).toEqual(expect.arrayContaining(["重点词与自然停顿建议","比例与叠加布局检查"]));
    expect(rule.checks).toContain("未试拍不声称布光或目光已验收");
    expect(rule.apply).toContain("不固定开场3–5秒留白");
  });
});


describe("分层复盘沿既有存储与展示合同保留", () => {
  it("承接或交付实验能通过审查与消费者，不退回封面", () => {
    const bp=fictionalViralBlueprint();
    const pack={...bp.xhsPackage,experiment:{...bp.xhsPackage.experiment,variable:"承接入口"}};
    const next={...bp,xhsPackage:pack};
    const audit=auditXhsCreationPackage(next);
    expect(audit.passed).toBe(true);
    connectXhsPackageToBlueprint(next,audit.package!);
    expect(next.xhsPackage.experiment.variable).toBe("承接入口");
    expect(xhsCreationPackageSchema.safeParse({...pack,experiment:{...pack.experiment,variable:"同时修改所有环节"}}).success).toBe(false);
    expect(xhsCreationPackageSchema.safeParse(bp.xhsPackage).success).toBe(true);
  });
});

describe("真实探针发现项的定向防回归", () => {
  it("图文制作说明不能成为印刷正文，迁到设计字段后恢复可用", () => {
    const bp=fictionalViralBlueprint();
    bp.graphicNotePages[2].body += "。画面：俯拍便签与咖啡杯，字体：粗体黑字，色调：米白背景。";
    expect(auditXhsCreationPackage(bp).findings.some(f=>f.code==="graphic_reader_copy" && f.message.includes("第3页"))).toBe(true);
    bp.graphicNotePages[2].body = "先说结论再举一个具体例子，最后说明需要的支持。";
    bp.detailedScript += "\n第3页设计：俯拍便签，粗体字与背景形成对比。";
    expect(auditXhsCreationPackage(bp).passed).toBe(true);
  });
  it("摄影教程的读者知识不被制作说明门禁误伤", () => {
    const bp=fictionalViralBlueprint();bp.title="摄影教程：一盏窗光如何拍清咖啡杯";bp.xhsPackage.titleOptions[0].title=bp.title;
    bp.graphicNotePages[2].body="画面：用窗光观察主体和背景的对比，这个步骤帮助读者理解构图。";
    expect(auditXhsCreationPackage(bp).findings.some(f=>f.code==="graphic_reader_copy")).toBe(false);
  });
  it("方法引用反馈定位具体条目，保留原文，不能用同义解释放行", () => {
    const bp=fictionalViralBlueprint("短视频");bp.methodApplications[0].quote="字幕统一放画面中下部，避开手部操作区";
    const issue=auditXhsCreationPackage(bp).findings.find(f=>f.code==="method_application");
    expect(issue?.message).toContain("第1条");expect(issue?.message).toContain("逐字复制");
    expect(bp.methodApplications[0].quote).toBe("字幕统一放画面中下部，避开手部操作区");
  });
});


describe("本次独立图文实际画布合同", () => {
 it("通用3:4方案不能在实际9:16图片入口假称匹配", () => {
  const bp=fictionalViralBlueprint();bp.xhsPackage.cover.layout="竖版3:4，主体在中下部，主副标题位于上方留白。";
  expect(auditXhsCreationPackage(bp,undefined,"图文","9:16").findings.some(f=>f.code==="graphic_ratio")).toBe(true);
  bp.xhsPackage.cover.layout="竖版9:16，主体在中下部，主副标题位于上方留白。";
  expect(auditXhsCreationPackage(bp,undefined,"图文","9:16").passed).toBe(true);
  expect(auditXhsCreationPackage(bp).passed).toBe(true);
 });
});
