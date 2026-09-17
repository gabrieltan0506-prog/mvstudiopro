import { expect, it } from "vitest";
import { exportedProxyVertices } from "./manhuaPrevisProxy";
function model(count: number, instances = 1, skinned = true) {
  const json = Buffer.from(JSON.stringify({asset:{version:"2.0"}, nodes:Array.from({length:instances},()=>({mesh:0,...(skinned?{skin:0}:{})})), meshes:[{primitives:[{attributes:{POSITION:0}}]}], accessors:[{count}]}));
  const b = Buffer.alloc(20 + Math.ceil(json.length/4)*4, 32);
  b.write("glTF"); b.writeUInt32LE(2,4); b.writeUInt32LE(b.length,8);
  b.writeUInt32LE(b.length-20,12); b.writeUInt32LE(0x4e4f534a,16); json.copy(b,20);
  return b;
}
it("按导出POSITION与实例计算，不能按去重网格少算",()=>{
  expect(exportedProxyVertices(model(22000,2))).toBe(44000);
  expect(()=>exportedProxyVertices(model(26000,2))).toThrow("导出网格顶点数超出预算");
});
it("拒绝无骨和非法顶点回执",()=>{
  expect(()=>exportedProxyVertices(model(44000,1,false))).toThrow("代理缺少带骨网格");
  expect(()=>exportedProxyVertices(model(0))).toThrow("代理顶点回执无效");
});
it("旧中模可计数但不放宽新代理上限",()=>{
  expect(exportedProxyVertices(model(230370),2000000)).toBe(230370);
  expect(()=>exportedProxyVertices(model(230370))).toThrow("导出网格顶点数超出预算");
});
