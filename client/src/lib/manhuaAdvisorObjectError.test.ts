import { expect, it, vi } from "vitest";
vi.mock('./flyHealthGate',()=>({withFlyHealthGate:(_origin:unknown,run:()=>unknown)=>run()}));
vi.mock('./longJobsFlyOrigin',()=>({withLongJobsFlyDirect:(url:string)=>url,flyHealthProbeOriginForUrl:()=>''}));
import { advisorStreamErrorMessage, streamManhuaAdvisor } from './manhuaAdvisorStream';
it('嵌套错误提取实际消息，未知object不显示隐式字符串',()=>{
 expect(advisorStreamErrorMessage({message:'模板暂不可用'},'稍后恢复')).toBe('模板暂不可用');
 expect(advisorStreamErrorMessage({code:500},'稍后恢复')).toBe('稍后恢复');
 expect(advisorStreamErrorMessage('[object Object]','稍后恢复')).toBe('稍后恢复');
});
it('真实SSE错误帧为对象时仍显示可读错误，不误判为成功',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=vi.fn().mockResolvedValue(new Response('event: error\ndata: {"message":{"message":"模板暂不可用"}}\n\n',{headers:{'content-type':'text/event-stream'}}));
 try{await expect(streamManhuaAdvisor({} as never,()=>{})).rejects.toThrow('模板暂不可用');}finally{globalThis.fetch=original;}
});
