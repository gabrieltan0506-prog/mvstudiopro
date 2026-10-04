import {useEffect,useRef,useState} from 'react';
import {withLongJobsFlyDirect} from '@/lib/longJobsFlyOrigin';
import {watchManhuaTemplateCatalog} from '@/lib/manhuaTemplateCatalogEvents';
export function useManhuaTemplateCatalogEvents(enabled:boolean,onChange:()=>Promise<unknown>){
 const latest=useRef(onChange);latest.current=onChange;const[connected,setConnected]=useState<boolean|null>(null);
 useEffect(()=>{if(!enabled)return;return watchManhuaTemplateCatalog(withLongJobsFlyDirect('/api/manhua-templates/events'),()=>latest.current(),setConnected);},[enabled]);
 return connected;
}
