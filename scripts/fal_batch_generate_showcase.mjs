import fs from "fs";

const API="https://fal.run/fal-ai/nano-banana";
const KEY=process.env.FAL_API_KEY;

if(!KEY){
console.error("Missing FAL_API_KEY");
process.exit(1);
}

const path="client/src/data/home_seed_assets_zh.json";
const data=JSON.parse(fs.readFileSync(path,"utf8"));

async function generate(prompt){

const r=await fetch(API,{
method:"POST",
headers:{
"Content-Type":"application/json",
"Authorization":"Key "+KEY
},
body:JSON.stringify({
prompt,
image_size:"landscape_16_9",
num_images:1
})
});

const j=await r.json();

return j?.images?.[0]?.url || null;

}

async function run(){

for(const item of data.showcaseImages){

if(item.imageUrl){
console.log("skip:",item.prompt);
continue;
}

console.log("generate:",item.prompt);

const url=await generate(item.prompt);

if(url){
item.imageUrl=url;
item.model="Nano Banana Pro (fal.ai)";
item.generatedAt=new Date().toISOString();
}

fs.writeFileSync(path,JSON.stringify(data,null,2));

}

console.log("Showcase generation done.");

}

run();
