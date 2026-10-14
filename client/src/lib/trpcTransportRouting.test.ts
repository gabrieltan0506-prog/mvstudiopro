import { expect, it } from "vitest";
import { createTRPCUntypedClient, httpBatchLink, httpLink, splitLink } from "@trpc/client";
import { useLongTrpcHttpLink } from "./trpcTransportRouting";
import { clearApiDebugErrors, getApiDebugErrors, recordTrpcDebugError, withApiDebugFetch } from "./apiDebugErrors";

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

it("来源检查保留完整链接和鉴权直连，网关非JSON一次失败并保留HTTP证据", async () => {
  clearApiDebugErrors();
  const source = 'https://www.douyin.com/user/MS4wLjABAAAA9ARsInHogB08ESkWQLKDJ1LQdR2WIZeVXglbaDLntqU?from_tab_name=main&modal_id=7693257165578013992&vid=7693519123195743538';
  const calls: Array<{ url: string; credentials?: string }> = [];
  let response = new Response('An error occurred secret-body', { status: 502, headers: { 'content-type': 'text/plain;charset=utf-8' } });
  const fetcher: typeof fetch = (input, init) => withApiDebugFetch(input, async () => {
    calls.push({ url: String(input), credentials: init?.credentials });
    return response;
  });
  const authenticated: typeof fetch = (input, init) => fetcher(input, { ...init, credentials: 'include' });
  const client = createTRPCUntypedClient({ links: [splitLink({ condition: useLongTrpcHttpLink,
    true: httpLink({ url: 'https://api.mvstudiopro.com/api/trpc', fetch: authenticated }),
    false: httpBatchLink({ url: 'https://www.mvstudiopro.com/api/trpc', fetch: authenticated }),
  })] });
  const error = await client.query('manhuaViralTemplate.inspectLearnSource', { params: { url: source } }).catch(e => e);
  expect(calls).toHaveLength(1);
  const requestUrl = new URL(calls[0].url);
  expect(requestUrl.origin).toBe('https://api.mvstudiopro.com');
  expect(calls[0].credentials).toBe('include');
  expect(JSON.parse(requestUrl.searchParams.get('input')!)).toEqual({ params: { url: source } });
  if (!(error instanceof Error)) throw new Error('预期来源检查抛出错误');
  expect(error.message).toContain('HTTP 502');
  expect(error.message).not.toContain('Unexpected token');
  recordTrpcDebugError(error, [['manhuaViralTemplate', 'inspectLearnSource']], '查询失败');
  expect(getApiDebugErrors()[0]).toMatchObject({ status: 502, contentType: 'text/plain;charset=utf-8' });
  await expect.poll(() => getApiDebugErrors().some(e => e.stage === '响应错误摘要')).toBe(true);
  expect(getApiDebugErrors().some(e => e.stage === '网络连接')).toBe(false);
  expect(JSON.stringify(getApiDebugErrors())).not.toMatch(/secret-body|7693257165578013992/);
  response = new Response(JSON.stringify({ error: { message: '来源详情暂不可读', code: -32600, data: { code: 'BAD_REQUEST', httpStatus: 400 } } }), { status: 400, headers: { 'content-type': 'application/json' } });
  await expect(client.query('manhuaViralTemplate.inspectLearnSource', { params: { url: source } })).rejects.toThrow('来源详情暂不可读');
  expect(calls).toHaveLength(2);
  response = new Response(JSON.stringify({ result: { data: { seriesKey: 'douyin:7693257165578013992', episodeIndex: 1, alreadyLearned: true } } }), { headers: { 'content-type': 'application/json' } });
  await expect(client.query('manhuaViralTemplate.inspectLearnSource', { params: { url: source } })).resolves.toEqual({ seriesKey: 'douyin:7693257165578013992', episodeIndex: 1, alreadyLearned: true });
  response = new Response('<html>not-json</html>', { headers: { 'content-type': 'text/html' } });
  await expect(client.query('manhuaViralTemplate.inspectLearnSource', { params: { url: source } })).rejects.toThrow('HTTP 200');
  expect(calls).toHaveLength(4);
});
