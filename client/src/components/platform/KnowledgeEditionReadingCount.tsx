import {useEffect,useMemo,useRef,useState} from 'react';
import {knowledgeEditionParts} from '@shared/knowledgeCardEdition';
import {buildKnowledgeBookletHtml} from '@shared/knowledgeBooklet';
/** 在沙箱中按正文真实块高预排版，不用字数除常量冒充页数。 */
export function KnowledgeEditionReadingCount({markdown}:{markdown:string|null}){
 const frame=useRef<HTMLIFrameElement>(null);
 const input=useMemo(()=>{
  const parts=markdown?knowledgeEditionParts(markdown):null;
  if(!parts)return null;
  const pages=parts.modules.filter(m=>m.medium==='text').map(m=>({id:m.id,headline:m.headline,body:m.body,imageUrl:''}));
  if(!pages.length)return {key:crypto.randomUUID(),html:'',empty:true};
  const key=crypto.randomUUID();
  const html=buildKnowledgeBookletHtml({title:parts.title,pages});
  const signal=`<script>(()=>{let attempts=0;const timer=setInterval(()=>{const value=window.__knowledgeBooklet;if(value?.ready||value?.error||++attempts>300){clearInterval(timer);parent.postMessage({type:'knowledge-reading-count',key:${JSON.stringify(key)},pages:value?.ready?value.readingPages:null},'*');}},100);})();</script>`;
  return {key,html:html.replace('</body>',signal+'</body>'),empty:false};
 },[markdown]);
 const [count,setCount]=useState<{key:string;pages:number|null}|null>(null);
 useEffect(()=>{
  const receive=(event:MessageEvent)=>{
   if(!input||event.source!==frame.current?.contentWindow||event.data?.type!=='knowledge-reading-count'||event.data.key!==input.key)return;
   const value=event.data.pages;
   setCount({key:input.key,pages:Number.isSafeInteger(value)&&value>=0?value:null});
  };
  window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);
 },[input]);
 const pages=input?.empty?0:count?.key===input?.key?count?.pages:undefined;
 return <><span aria-live="polite">文字说明 {pages===undefined?'正在核算…':pages===null?'暂未取得页数':`${pages} 页（预排版）`}</span>
 {input&&!input.empty&&<iframe ref={frame} title="文字说明页数核算" sandbox="allow-scripts" aria-hidden="true" tabIndex={-1} srcDoc={input.html} style={{position:'absolute',left:-20000,top:0,width:1200,height:900,opacity:0,pointerEvents:'none'}}/>}</>;
}
