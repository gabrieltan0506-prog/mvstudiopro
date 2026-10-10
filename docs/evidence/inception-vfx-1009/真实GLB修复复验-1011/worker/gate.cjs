const fs=require('node:fs');
const {neon}=require('/app/node_modules/@neondatabase/serverless');
if(process.env.FLY_MACHINE_ID!=='7812595b294778')throw Error('Wrong machine');
async function main(){
 const sql=neon(process.env.DATABASE_URL);
 const jobs=await sql.query(`select id,type,status,"updatedAt" from jobs where status in ('queued','running')`);
 const conversions=await sql.query(`select id,status,"updatedAt" from file_conversion_jobs where status in ('queued','running','receipt_pending','refund_pending')`);
 const processes=[];
 for(const pid of fs.readdirSync('/proc').filter(x=>/^\d+$/.test(x))){try{const comm=fs.readFileSync('/proc/'+pid+'/comm','utf8').trim();if(/blender|ffmpeg|ffprobe|chromium|chrome|curl|wget|rsync/.test(comm))processes.push({pid:Number(pid),comm});}catch{}}
 const ledger=[];
 for(const dir of ['/data/active-jobs','/tmp/mvstudiopro-active-jobs']){if(!fs.existsSync(dir))continue;for(const file of fs.readdirSync(dir).filter(x=>x.endsWith('.json'))){const r=JSON.parse(fs.readFileSync(dir+'/'+file,'utf8'));if(!['settled','refunded','completed','failed','cancelled'].includes(r.status))ledger.push({file,status:r.status,lastHeartbeatAt:r.lastHeartbeatAt});}}
 const receipt={at:new Date().toISOString(),machine:process.env.FLY_MACHINE_ID,jobs,conversions,mediaProcesses:processes,activeLedger:ledger,empty:!jobs.length&&!conversions.length&&!processes.length&&!ledger.length};
 console.log(JSON.stringify(receipt));if(!receipt.empty)process.exitCode=2;
}main().catch(e=>{console.error(e.name+': gate query failed');process.exitCode=1;});
