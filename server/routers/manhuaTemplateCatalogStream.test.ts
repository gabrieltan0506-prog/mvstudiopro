import {expect,it,vi} from 'vitest';
import express from 'express';import {createServer} from 'node:http';
const context=vi.hoisted(()=>vi.fn());vi.mock('../_core/context',()=>({createContext:context}));
import {registerManhuaTemplateCatalogStream} from './manhuaTemplateCatalogStream';
import {publishTemplateCatalogChanged} from '../services/manhuaTemplateCatalogEvents';
it('鉴权后首连返回版本，批准事件立即推送新版本；不公开模板私有内容',async()=>{
 const app=express();registerManhuaTemplateCatalogStream(app);const server=createServer(app);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${(server.address() as any).port}/api/manhua-templates/events`;
 try{context.mockResolvedValue({user:null});expect((await fetch(url)).status).toBe(401);context.mockResolvedValue({user:{id:7}});const controller=new AbortController();const res=await fetch(url,{signal:controller.signal});expect(res.headers.get('content-type')).toContain('text/event-stream');const reader=res.body!.getReader();const first=new TextDecoder().decode((await reader.read()).value);publishTemplateCatalogChanged();const next=new TextDecoder().decode((await reader.read()).value);expect(first).toContain('event: catalog');expect(next).toContain('event: catalog');expect(first).not.toBe(next);const data=JSON.parse(next.split('data: ')[1]);expect(Object.keys(data)).toEqual(['revision']);controller.abort();}
 finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
