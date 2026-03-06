import fs from "fs";

const BASE="https://mvstudiopro.com/api/kling-image";

const path="client/src/data/home_seed_assets_zh.json";
const data=JSON.parse(fs.readFileSync(path));

async function create(prompt){

const r=await fetch(BASE,{
method:"POST",
headers:{
"Content-Type":"application/json"
},
body:JSON.stringify({
prompt,
aspect_ratio:"16:9"
})
});

const j=await r.json();

return j.taskId;

}

async function poll(id){

for(let i=0;i<30;i++){

const r=await fetch(BASE+"?taskId="+id);
const j=await r.json();

if(j?.imageUrl) return j.imageUrl;

await new Promise(r=>setTimeout(r,4000));

}

return null;

}

for(const item of data.creatorActors){

if(item.imageUrl) continue;

console.log("generate:",item.prompt);

const id=await create(item.prompt);

if(!id) continue;

const url=await poll(id);

if(url){
item.imageUrl=url;
item.model="Kling Image 3.0";
}

}

fs.writeFileSync(path,JSON.stringify(data,null,2));

console.log("kling images generated");
