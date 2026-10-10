import { expect, it } from "vitest";
import { createTRPCUntypedClient, httpBatchLink, httpLink, splitLink } from "@trpc/client";
import { useLongTrpcHttpLink } from "./trpcTransportRouting";
import { clearApiDebugErrors, getApiDebugErrors, withApiDebugFetch } from "./apiDebugErrors";

it("真实tRPC批准请求直连Fly，失败不重发，下一次显式点击才提交", async()=>{
  clearApiDebugErrors();
  const calls:Array<{url:string;credentials?:string}>=[];
  let succeed=false;
  const fetcher:typeof fetch=async(input,init)=>withApiDebugFetch(input,async()=>{
    calls.push({url:String(input),credentials:init?.credentials});
    return succeed?new Response(JSON.stringify({result:{data:{ok:true,card:{id:'test-card',status:'approved'}}}}),{headers:{'content-type':'application/json'}})
      :new Response('<html><title>Gateway Timeout</title></html>',{status:504,headers:{'content-type':'text/html'}});
  });
  const fetchWithAuth:typeof fetch=(input,init)=>fetcher(input,{...init,credentials:'include'});
  const client=createTRPCUntypedClient({links:[splitLink({condition:useLongTrpcHttpLink,
    true:httpLink({url:'https://api.mvstudiopro.com/api/trpc',fetch:fetchWithAuth}),
    false:httpBatchLink({url:'https://www.mvstudiopro.com/api/trpc',fetch:fetchWithAuth})})]});
  await expect(client.mutation('manhuaViralTemplate.approve',{id:'test-card',confirmApprove:true})).rejects.toThrow();
  expect(calls).toHaveLength(1);expect(calls[0]).toEqual({url:'https://api.mvstudiopro.com/api/trpc/manhuaViralTemplate.approve',credentials:'include'});
  expect(getApiDebugErrors().some(e=>e.status===504)).toBe(true);
  succeed=true;
  await expect(client.mutation('manhuaViralTemplate.approve',{id:'test-card',confirmApprove:true})).resolves.toMatchObject({ok:true,card:{status:'approved'}});
  expect(calls).toHaveLength(2);
  expect(useLongTrpcHttpLink({path:'manhuaViralTemplate.renderEpisodeReport'})).toBe(true);
  expect(useLongTrpcHttpLink({path:'manhuaViralTemplate.getProposalDetail'})).toBe(true);
  expect(useLongTrpcHttpLink({path:'auth.me'})).toBe(false);
});
