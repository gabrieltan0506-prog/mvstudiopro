import type { Express } from 'express';
import { createContext } from '../_core/context';
import { templateCatalogRevision,subscribeTemplateCatalog } from '../services/manhuaTemplateCatalogEvents';
export function registerManhuaTemplateCatalogStream(app:Express){
 app.get('/api/manhua-templates/events',async(req,res)=>{
  const ctx=await createContext({req,res,info:undefined as never});
  if(!ctx.user){res.status(ctx.authUnavailable?503:401).json({message:'请先登录后读取模板更新'});return;}
  res.setHeader('Content-Type','text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control','no-cache, no-transform');res.setHeader('X-Accel-Buffering','no');res.flushHeaders();
  const send=(revision:string)=>{if(!res.destroyed&&!res.writableEnded)res.write(`event: catalog\ndata: ${JSON.stringify({revision})}\n\n`);};
  const unsubscribe=subscribeTemplateCatalog(send);
  // 每次连接给当前版本：断网或部署期间的事件通过重连重新读取目录补齐。
  send(templateCatalogRevision());
  const keepAlive=setInterval(()=>{if(!res.destroyed&&!res.writableEnded)res.write(': keepalive\n\n');},15000);
  res.once('close',()=>{clearInterval(keepAlive);unsubscribe();});
 });
}
