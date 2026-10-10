import { readFile,writeFile } from 'node:fs/promises';
import path from 'node:path';
const root=process.argv[2];
async function json(p){try{return JSON.parse(await readFile(path.join(root,p),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
const done=new Set();
while(done.size<4){
 for(const tier of ['free','paid'])for(const sceneIndex of [2,3]){
  const key=`${tier}.scene-${sceneIndex}.video-input.json`;
  if(done.has(key))continue;
  if(await json(key)){done.add(key);continue;}
  const im=await json(`images/${tier}-${sceneIndex}.result.json`);
  const au=await json(`audio/${tier}.scene-${sceneIndex}.audio.json`);
  const p=await json(`${tier}.normalized.project.json`);
  if(!im||!au||!p)continue;
  if(im.tier!==tier||im.sceneIndex!==sceneIndex||au.duration!==5)throw Error('Input receipt identity mismatch');
  const out={tier,sceneIndex,prompt:p.plan.scenes[sceneIndex].production.videoPrompt,images:[{gcsUri:im.gcsUri,sha256:im.sha256}],audio:{gcsUri:au.gcsUri,sha256:au.sha256,duration:5}};
  await writeFile(path.join(root,key),JSON.stringify(out,null,2),{flag:'wx'});
  done.add(key);console.log(JSON.stringify({tier,sceneIndex,readyAt:new Date().toISOString()}));
 }
 await writeFile(path.join(root,'joiner-heartbeat.json'),JSON.stringify({at:new Date().toISOString(),ready:Array.from(done)}));
 if(done.size<4)await new Promise(r=>setTimeout(r,1000));
}
