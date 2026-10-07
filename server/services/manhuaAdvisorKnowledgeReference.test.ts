import { expect, it, vi } from "vitest";
vi.mock("./manhuaAdvisorKnowledge",()=>({inspectManhuaAdvisorKnowledge:()=>({status:"not_scanned",refreshing:false})}));
import { buildManhuaAdvisorKnowledgeReference } from "./manhuaAdvisorKnowledgeReference";
it("未扫描或刷新失败不声称最新；目录说明读取边界，保留全部能力而不加载正文",()=>{
 const cold=buildManhuaAdvisorKnowledgeReference();expect(cold).toContain("尚未扫描");expect(cold).toContain("lightning");expect(cold).toContain("骨骼");
 const stale=buildManhuaAdvisorKnowledgeReference({status:"stale",refreshing:false,error:"本次扫描失败"});
 expect(stale).toContain("本次扫描失败");expect(stale).toContain("项目冻结导演包不因扫描自动替换");expect(stale).toContain("不代表读过模板全文");
});
