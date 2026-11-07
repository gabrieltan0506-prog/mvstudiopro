/** 只挂载正式出版组件；内文、并发、排版与PDF调用全部沿原组件。 */
import React,{useState,useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {httpLink} from '@trpc/client';
import superjson from 'superjson';
import {trpc} from '../client/src/lib/trpc';
import KnowledgePublicationPanel from '../client/src/components/platform/KnowledgePublicationPanel';
import {pollJobUntilTerminal} from '../client/src/lib/jobs';
const queryClient=new QueryClient();
const client=trpc.createClient({links:[httpLink({url:'/api/trpc',transformer:superjson})]});
function App(){
 const [doc,setDoc]=useState<any>(null);const [error,setError]=useState('');
 useEffect(()=>{(async()=>{const {documentId}=await(await fetch('/bootstrap')).json();const saved=await client.editableLayout.get.query();const found=saved.library?.documents.find(d=>d.id===documentId);if(!found)throw Error('正式云稿未保存');setDoc(found);})().catch(e=>{setError(e.message);(window as any).__handbookError=e.message;});},[]);
 useEffect(()=>{const t=setInterval(()=>{const alerts=[...document.querySelectorAll('[role="alert"]')].map(x=>x.textContent).filter(Boolean);if(alerts.length)(window as any).__handbookError=alerts.join('\n');},5000);return()=>clearInterval(t);},[]);
 if(!doc)return <p>{error||'读取本次正式云稿…'}</p>;
 return <KnowledgePublicationPanel doc={doc} autoStart={true} autoStartToken={1} preauthorizedCredits={0} autoPreparePresentation={false}
 commit={async(next)=>{const current=await client.editableLayout.get.query();if(!current.library?.documents.some(d=>d.id===next.id))throw Error('原云稿不存在');const result=await client.editableLayout.save.mutate({library:{...current.library,documents:current.library.documents.map(d=>d.id===next.id?next:d)},expectedGeneration:current.generation});setDoc(next);return result;}}
 onChange={setDoc} onBusy={()=>{}}
 waitForImages={async ids=>{await Promise.all(ids.map(async id=>{for(;;){const response=await fetch('/api/jobs/'+encodeURIComponent(id));if(response.ok)break;if(response.status!==404)throw Error('原图片任务查询失败');await new Promise(r=>setTimeout(r,3000));}const job=await pollJobUntilTerminal(id,{intervalMs:3000,maxWaitMs:Number.MAX_SAFE_INTEGER});if(job.status!=='succeeded')throw Error(job.error||'原图片任务未成功');}));}}
 onPagination={(_d,p)=>{if(p)(window as any).__handbookFinished=p;}}/>;
}
createRoot(document.getElementById('root')!).render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><App/></QueryClientProvider></trpc.Provider>);
