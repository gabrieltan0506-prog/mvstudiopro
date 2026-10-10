import { beforeEach, describe, expect, it } from "vitest";
import { clearApiDebugErrors, getApiDebugErrors, recordApiDebugError, recordTrpcDebugError, redactApiDebugText, withApiDebugFetch } from "./apiDebugErrors";
import { sanitizePlatformUserMessage } from "./platformUserFacingCopy";

beforeEach(clearApiDebugErrors);
describe("真实接口错误", () => {
  it("HTML保留HTTP状态和接口，原响应仍能被调用方读取，不重复提交", async () => {
    let calls = 0;
    const response = new Response('<html><title>Gateway Timeout</title><script>secret="hidden-body"</script></html>', { status: 504, headers: { "content-type": "text/html" } });
    const got = await withApiDebugFetch('https://www.mvstudiopro.com/api/trpc/manhuaViralTemplate.approve?input=secret-input', async () => { calls++; return response; });
    expect(got).toBe(response);
    expect(await got.text()).toContain("Gateway Timeout");
    await expect.poll(() => getApiDebugErrors().length).toBe(2);
    expect(calls).toBe(1);
    expect(getApiDebugErrors()[0]).toMatchObject({ endpoint: "manhuaViralTemplate.approve", status: 504, contentType: "text/html" });
    expect(getApiDebugErrors()[0].message).toContain("Gateway Timeout");
    expect(JSON.stringify(getApiDebugErrors())).not.toMatch(/secret-input|hidden-body|<script>/);
  });
  it("HTTP200错误页也可见，正常JSON成功不记录错误", async () => {
    await withApiDebugFetch('/api/trpc/manhuaViralTemplate.approve', async () => new Response('<!DOCTYPE html><title>Vercel Security Checkpoint</title>', {headers:{'content-type':'text/html'}}));
    await expect.poll(() => getApiDebugErrors().length).toBe(2);
    expect(getApiDebugErrors()[0].message).toContain('Vercel Security Checkpoint');
    clearApiDebugErrors();
    await withApiDebugFetch('/api/trpc/manhuaViralTemplate.approve', async () => new Response('{"ok":true}', {headers:{'content-type':'application/json'}}));
    expect(getApiDebugErrors()).toEqual([]);
  });
  it("业务校验、解析失败和网络失败均保留原始原因与接口", async () => {
    recordTrpcDebugError({message:'学习内容不完整：可复用手法必须有非空内容',data:{httpStatus:400}},[['manhuaViralTemplate','approve'],{input:{secret:'never-record'}}], '操作失败');
    expect(getApiDebugErrors()[0]).toMatchObject({ endpoint:'manhuaViralTemplate.approve',status:400 });
    recordTrpcDebugError({message:'Unexpected token < is not valid JSON',meta:{response:new Response('bad',{status:502})}},[['manhuaViralTemplate','approve']], '操作失败');
    expect(getApiDebugErrors()[0].message).toContain('Unexpected token');
    expect(getApiDebugErrors()[0].status).toBe(502);
    const error=new Error('Failed to fetch');
    await expect(withApiDebugFetch('/api/trpc/manhuaViralTemplate.approve',async()=>{throw error})).rejects.toBe(error);
    expect(getApiDebugErrors()[0]).toMatchObject({stage:'网络连接',message:'Failed to fetch',status:undefined});
    expect(JSON.stringify(getApiDebugErrors())).not.toContain('never-record');
  });
  it("不保存认证值、签名链接、请求正文，记录有界可清空", () => {
    const text=redactApiDebugText('Authorization: Bearer test-token\nCookie: sid=test-cookie\n{"api_key":"test-key-secret","token":"test-token-secret"}\nhttps://storage.test/a?sig=test-signature');
    expect(text).not.toMatch(/test-token|test-cookie|test-key-secret|test-signature/);
    for(let i=0;i<40;i++)recordApiDebugError({stage:'失败',endpoint:'manhuaViralTemplate.approve',message:String(i)});
    expect(getApiDebugErrors()).toHaveLength(30);
    expect(getApiDebugErrors()[0].message).toBe('39');
    clearApiDebugErrors();expect(getApiDebugErrors()).toEqual([]);
  });
  it("用户提示不再把解析/网关错误归因为算力紧张或虚报已重试", () => {
    for(const raw of ['Unexpected token < is not valid JSON','returned HTML instead of JSON','returned empty body']){
      const message=sanitizePlatformUserMessage(raw);
      expect(message).toContain('Debug');expect(message).not.toMatch(/算力紧张|已自动重试/);
    }
  });
});
