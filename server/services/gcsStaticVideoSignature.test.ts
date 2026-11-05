import { afterEach, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import { signGcsObjectPathV4ReadUrl } from './gcs';
// 此密钥对仅在测试内生成，不能访问任何生产服务。
const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
afterEach(() => vi.unstubAllEnvs());
function verify(url: string, method: string) {
  const u = new URL(url); const signature = u.searchParams.get('X-Goog-Signature')!;
  const credential = u.searchParams.get('X-Goog-Credential')!;
  const scope = credential.slice(credential.indexOf('/')+1);
  const query = u.search.slice(1).split('&').filter(x => !x.startsWith('X-Goog-Signature=')).join('&');
  const canonical = [method,u.pathname,query,'host:storage.googleapis.com\n','host','UNSIGNED-PAYLOAD'].join('\n');
  const signed = `GOOG4-RSA-SHA256\n${u.searchParams.get('X-Goog-Date')}\n${scope}\n${crypto.createHash('sha256').update(canonical).digest('hex')}`;
  return crypto.verify('RSA-SHA256', Buffer.from(signed), keys.publicKey, Buffer.from(signature, 'hex'));
}
it('原GET签名兼容；HEAD和固定generation参与签名，不能篡改', () => {
  vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS_JSON', JSON.stringify({ client_email:'test-only@example.invalid', private_key:keys.privateKey.export({type:'pkcs8',format:'pem'}) }));
  const legacy = signGcsObjectPathV4ReadUrl('test-bucket','test video/a.mp4');
  expect(verify(legacy,'GET')).toBe(true); expect(new URL(legacy).searchParams.has('generation')).toBe(false);
  const pinned = signGcsObjectPathV4ReadUrl('test-bucket','test video/a.mp4',3600,{method:'HEAD',generation:'123'});
  expect(verify(pinned,'HEAD')).toBe(true); expect(verify(pinned,'GET')).toBe(false); expect(verify(pinned.replace('generation=123','generation=456'),'HEAD')).toBe(false);
  expect(() => signGcsObjectPathV4ReadUrl('test-bucket','test.mp4',3600,{generation:'../other'})).toThrow('invalid_gcs_generation');
});
