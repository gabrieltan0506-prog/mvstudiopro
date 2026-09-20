import { afterEach, expect, it, vi } from 'vitest';
vi.mock('./gcsTransfer',()=>({gcsTransferUrl:(url:string)=>`/api/transfer?url=${encodeURIComponent(url)}`,isGcsTransferUrl:()=>true}));
import { downloadManhuaFinalVideo } from './manhuaProjectExport';
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it('downloads actual response bytes through the existing authenticated transfer without generating',async()=>{
 vi.useFakeTimers();const bytes=new Uint8Array([0,0,0,24,102,116,121,112]);
 const fetcher=vi.fn(async()=>({ok:true,arrayBuffer:async()=>bytes.buffer}));vi.stubGlobal('fetch',fetcher);
 const anchor={href:'',download:'',rel:'',click:vi.fn(),remove:vi.fn()};
 const createObjectURL=vi.fn(()=> 'blob:test-mp4'),revokeObjectURL=vi.fn();
 vi.stubGlobal('URL',{createObjectURL,revokeObjectURL});vi.stubGlobal('window',{setTimeout});vi.stubGlobal('document',{createElement:()=>anchor,body:{appendChild:vi.fn()}});
 await downloadManhuaFinalVideo('https://example.com/final.mp4','episode/one');
 expect(fetcher).toHaveBeenCalledOnce();expect(fetcher.mock.calls[0]).toEqual(['/api/transfer?url=https%3A%2F%2Fexample.com%2Ffinal.mp4',{credentials:'include'}]);
 expect(anchor.download).toBe('episode_one.mp4');expect(anchor.click).toHaveBeenCalledOnce();
 const blob=(createObjectURL.mock.calls[0] as unknown as [Blob])[0];expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
 expect(revokeObjectURL).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(30000);expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-mp4');
});
it('rejects missing, expired and empty files without triggering a download',async()=>{
 await expect(downloadManhuaFinalVideo('', 'test')).rejects.toThrow();
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,status:403})));
 await expect(downloadManhuaFinalVideo('https://example.com/expired','test')).rejects.toThrow('HTTP 403');
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(0)})));
 await expect(downloadManhuaFinalVideo('https://example.com/empty','test')).rejects.toThrow();
});
it('the real download handler prevents double clicks and unlocks after failure',async()=>{
 const {readFileSync}=await import('node:fs');const ts=await import('typescript');const {runInNewContext}=await import('node:vm');
 const text=readFileSync(new URL('../components/canvas/ManhuaClipDock.tsx',import.meta.url),'utf8');const tree=ts.createSourceFile('dock.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let callback='';
 function visit(node:import('typescript').Node){if(ts.isVariableDeclaration(node)&&node.name.getText(tree)==='handleDownloadFinal')callback=node.initializer!.getText(tree);ts.forEachChild(node,visit);}visit(tree);expect(callback).not.toBe('');
 let reject!:(error:Error)=>void;const download=vi.fn(()=>new Promise<void>((_,r)=>reject=r));const lock={current:false},setBusy=vi.fn(),setError=vi.fn();
 const run=runInNewContext(ts.transpileModule(`(${callback})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{finalVideoUrl:'https://example.com/final.mp4',finalDownloadLock:lock,setFinalDownloadBusy:setBusy,setFinalDownloadError:setError,downloadManhuaFinalVideo:download,seriesTitle:'test',topic:'',Error});
 const first=run();await run();expect(download).toHaveBeenCalledOnce();reject(new Error('HTTP 403'));await first;expect(lock.current).toBe(false);expect(setBusy).toHaveBeenLastCalledWith(false);expect(setError).toHaveBeenLastCalledWith('HTTP 403');
 download.mockResolvedValueOnce();await run();expect(download).toHaveBeenCalledTimes(2);
});
