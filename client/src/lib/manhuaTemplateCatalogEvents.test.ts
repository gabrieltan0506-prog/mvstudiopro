import {expect,it,vi} from 'vitest';
import {watchManhuaTemplateCatalog,type TemplateCatalogEventSource} from './manhuaTemplateCatalogEvents';
it('只响应变更，断线重连补读，关闭后不再读取；无定时目录轮询',async()=>{
 let handler:(e:any)=>void=()=>{};const source={addEventListener:(_n:string,h:any)=>{handler=h;},close:vi.fn(),onerror:null,onopen:null} as unknown as TemplateCatalogEventSource;
 const read=vi.fn().mockResolvedValue({}),connected=vi.fn();const stop=watchManhuaTemplateCatalog('/events',read,connected,()=>source);
 expect(read).not.toHaveBeenCalled();source.onopen?.(new Event('open'));handler({data:'{"revision":"a"}'});await new Promise(r=>setImmediate(r));expect(read).toHaveBeenCalledTimes(1);
 handler({data:'{"revision":"a"}'});expect(read).toHaveBeenCalledTimes(1);handler({data:'{"revision":"b"}'});await new Promise(r=>setImmediate(r));expect(read).toHaveBeenCalledTimes(2);
 source.onerror?.(new Event('error'));expect(connected).toHaveBeenLastCalledWith(false);source.onopen?.(new Event('open'));handler({data:'{"revision":"b"}'});await new Promise(r=>setImmediate(r));expect(read).toHaveBeenCalledTimes(3);stop();handler({data:'{"revision":"c"}'});expect(read).toHaveBeenCalledTimes(3);expect(source.close).toHaveBeenCalledTimes(1);
});
