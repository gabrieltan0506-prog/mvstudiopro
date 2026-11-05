import test from "node:test";
import assert from "node:assert/strict";
import { createGrowthPrivateAssetFetch } from "./growthPrivateAssetFetch.mjs";
const repository="test-owner/private-data", token="test-not-a-real-token";
const base=`https://github.com/${repository}/releases/download/batch-1`;
const api=`https://api.github.com/repos/${repository}/releases`;
const meta=(id=7)=>new Response(JSON.stringify({id:1,assets:[{id,name:"pointer.json",state:"uploaded"}]}));
const auth=init=>new Headers(init.headers).get("authorization");

test("private asset resolves tag metadata then authenticated binary API, never browser URL",async()=>{
  const calls=[];
  const fetchImpl=async(url,init)=>{calls.push({url,init});return String(url).includes("/tags/")?meta():new Response("backup-bytes");};
  const reader=createGrowthPrivateAssetFetch({repository,token,fetchImpl});
  assert.equal(await (await reader(`${base}/pointer.json?ts=1`)).text(),"backup-bytes");
  assert.deepEqual(calls.map(c=>c.url),[`${api}/tags/batch-1`,`${api}/assets/7`]);
  for(const call of calls){assert.equal(auth(call.init),`Bearer ${token}`);assert.equal(call.init.redirect,"manual");}
  assert.equal(new Headers(calls[1].init.headers).get("accept"),"application/octet-stream");
});
test("storage redirects strip credentials and remain manual",async()=>{
  const calls=[];
  const fetchImpl=async(url,init)=>{calls.push({url,init});if(url.includes("/tags/"))return meta();if(url.includes("/assets/7"))return new Response(null,{status:302,headers:{location:"https://release-assets.githubusercontent.com/signed-file"}});return new Response("bytes");};
  const reader=createGrowthPrivateAssetFetch({repository,token,fetchImpl});
  assert.equal(await(await reader(`${base}/pointer.json`)).text(),"bytes");
  assert.equal(auth(calls.at(-1).init),null);
  assert.equal(calls.at(-1).init.redirect,"manual");
  assert.equal(calls.at(-1).init.credentials,"omit");
});
test("outside URLs and different repositories never get token or inherited auth",async()=>{
  const calls=[];const fetchImpl=async(url,init)=>{calls.push({url,init});return new Response("other");};
  const reader=createGrowthPrivateAssetFetch({repository,token,fetchImpl});
  for(const url of ["https://evil.invalid/file", "https://github.com/test-owner/other/releases/download/tag/file", "https://github.com.evil.invalid/test-owner/private-data/releases/download/tag/file", "http://github.com/test-owner/private-data/releases/download/tag/file"])
    await reader(url,{headers:{Authorization:`Bearer ${token}`,Cookie:"secret"}});
  assert.equal(calls.length,4);
  for(const call of calls){assert.equal(auth(call.init),null);assert.equal(new Headers(call.init.headers).get("cookie"),null);}
});
test("missing token fails clearly before any private network request",async()=>{
  let calls=0;const reader=createGrowthPrivateAssetFetch({repository,fetchImpl:async()=>{calls++;return new Response();}});
  await assert.rejects(reader(`${base}/pointer.json`),/token_missing/);assert.equal(calls,0);
  await reader("https://public.invalid/file");assert.equal(calls,1);
});
test("metadata 404 and auth failure stay distinguishable without fallback",async()=>{
  for(const status of [404,401,403,429,503]){
    let calls=0;const reader=createGrowthPrivateAssetFetch({repository,token,fetchImpl:async()=>{calls++;return new Response(null,{status});}});
    assert.equal((await reader(`${base}/pointer.json`)).status,status);assert.equal(calls,1);
  }
});
test("absent asset checks paginated metadata then returns 404",async()=>{
  const calls=[];const reader=createGrowthPrivateAssetFetch({repository,token,fetchImpl:async(url)=>{
    calls.push(url);return new Response(JSON.stringify(url.includes("/tags/")?{id:1,assets:[]}:[]));
  }});
  assert.equal((await reader(`${base}/missing.json`)).status,404);
  assert.equal(calls[1],`${api}/1/assets?per_page=100&page=1`);
});
test("latest pointer metadata is refreshed when immutable asset ID changes",async()=>{
  let generation=7;const calls=[];
  const reader=createGrowthPrivateAssetFetch({repository,token,fetchImpl:async(url)=>{calls.push(url);return url.includes("/tags/")?meta(generation):new Response(String(generation));}});
  assert.equal(await(await reader(`${base}/pointer.json`)).text(),"7");generation=8;
  assert.equal(await(await reader(`${base}/pointer.json`)).text(),"8");
  assert.equal(calls.filter(url=>url.includes("/tags/")).length,2);
  assert.ok(calls.includes(`${api}/assets/8`));
});
test("redirect to another API repository does not carry credentials",async()=>{
  const calls=[];const reader=createGrowthPrivateAssetFetch({repository,token,fetchImpl:async(url,init)=>{
    calls.push({url,init});if(url.includes("/tags/"))return meta();if(url===`${api}/assets/7`)return new Response(null,{status:302,headers:{location:"https://api.github.com/repos/someone/else/releases/assets/1"}});return new Response("no credentials");
  }});
  await reader(`${base}/pointer.json`);assert.equal(auth(calls.at(-1).init),null);
});
test("redirects cannot downgrade TLS, embed credentials, or loop indefinitely",async()=>{
  for(const location of ["http://storage.invalid/file","https://user:password@storage.invalid/file",`${api}/assets/7`]){
    const reader=createGrowthPrivateAssetFetch({repository,token,fetchImpl:async(url)=>url.includes("/tags/")?meta():new Response(null,{status:302,headers:{location}})});
    await assert.rejects(reader(`${base}/pointer.json`),/redirect_unsafe|redirect_limit/);
  }
});
test("Request input and signal are forwarded without adding mutation support",async()=>{
  const abort=new AbortController();const calls=[];
  const reader=createGrowthPrivateAssetFetch({repository,token,fetchImpl:async(url,init)=>{calls.push(init);return url.includes("/tags/")?meta():new Response();}});
  await reader(new Request(`${base}/pointer.json`,{signal:abort.signal}));
  assert.ok(calls.every(call=>call.signal instanceof AbortSignal));
  await assert.rejects(reader(`${base}/pointer.json`,{method:"DELETE"}),/method_invalid/);
});
