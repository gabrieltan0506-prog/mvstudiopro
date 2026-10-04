export type TemplateCatalogEventSource=Pick<EventSource,'addEventListener'|'close'|'onerror'|'onopen'>;
/** 没有轮询；只在收到变更通知时取目录，断线由EventSource重连。 */
export function watchManhuaTemplateCatalog(url:string,onChange:()=>Promise<unknown>,onConnection:(connected:boolean)=>void,create=(url:string):TemplateCatalogEventSource=>new EventSource(url,{withCredentials:true})){
 const source=create(url);let stopped=false,fetching=false,dirty=false,lastRevision='';
 async function refresh(){
  dirty=true;if(fetching)return;fetching=true;
  try{while(dirty&&!stopped){dirty=false;await onChange();}}catch{onConnection(false);}finally{fetching=false;}
 }
 source.addEventListener('catalog',event=>{
  if(stopped)return;
  try{const value=JSON.parse((event as MessageEvent).data);if(typeof value.revision!=='string'||!value.revision||value.revision===lastRevision)return;lastRevision=value.revision;void refresh();}catch{onConnection(false);}
 });
 // 重连即使版本未变也补读，覆盖上一次请求失败；连接本身不作目录轮询。
 source.onopen=()=>{lastRevision='';onConnection(true);};source.onerror=()=>onConnection(false);
 return()=>{stopped=true;source.close();};
}
