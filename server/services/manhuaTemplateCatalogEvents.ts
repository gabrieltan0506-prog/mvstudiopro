import { randomUUID } from 'node:crypto';
/** 当前 app 进程也运行模板学习/批准；只广播目录版本，不泄露模板内容或来源。 */
let revision=randomUUID();
const listeners=new Set<(revision:string)=>void>();
export function templateCatalogRevision(){return revision;}
export function subscribeTemplateCatalog(listener:(revision:string)=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
export function publishTemplateCatalogChanged(){
 revision=randomUUID();
 for(const listener of Array.from(listeners)){try{listener(revision);}catch{listeners.delete(listener);}}
}
