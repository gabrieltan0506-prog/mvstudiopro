import {readFile,readdir} from 'node:fs/promises';
/** Includes isolated probes that do not share the app's in-memory child counter. */
export async function workerMediaProcessesBusy(root='/proc'):Promise<boolean> {
 if(process.platform!=='linux' && root==='/proc')return false;
 for(const pid of await readdir(root)){
  if(!/^\d+$/.test(pid))continue;
  let comm:string;
  try{comm=(await readFile(`${root}/${pid}/comm`,'utf8')).trim();}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error;}
  if(/^(blender|ffmpeg|ffprobe|chromium|chrome|chrome-headless|chrome_headless|yt-dlp|curl|wget)$/.test(comm))return true;
 }
 return false;
}
