import { describe, expect, it } from 'vitest';
import { isTargetDouyinDetailResponse, isUsableDouyinBrowserDetail, readDouyinDetailFromOfficialPage } from './manhuaDouyinBrowserRead';

describe('官方网页响应边界', () => {
  const id = '7693257165578013992';
  it('拒绝其他域名、路径与推荐视频，接受官方目标请求', () => {
    const url = `https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${id}&a_bogus=test-signature`;
    expect(isTargetDouyinDetailResponse(url, id)).toBe(true);
    expect(isTargetDouyinDetailResponse(url.replace('www.douyin.com', 'www.douyin.com.example.org'), id)).toBe(false);
    expect(isTargetDouyinDetailResponse(url.replace('/detail/', '/mix/'), id)).toBe(false);
    expect(isTargetDouyinDetailResponse(url, '123456')).toBe(false);
  });
  it('拒绝响应ID不匹配和空播放源，保留原响应不改写费用字段', () => {
    const payload = { status_code: 0, aweme_detail: { aweme_id: id, entertainment_video_paid_way: { paid_type: 1 },
      video: { play_addr: { url_list: ['https://v3-dy-o.zjcdn.com/test.mp4'] } } } };
    const before = JSON.stringify(payload);
    expect(isUsableDouyinBrowserDetail(payload, id)).toBe(true);
    expect(JSON.stringify(payload)).toBe(before);
    expect(isUsableDouyinBrowserDetail(payload, '123456')).toBe(false);
    expect(isUsableDouyinBrowserDetail({ aweme_detail: { aweme_id: id } }, id)).toBe(false);
  });
  it('非Fly运行环境不启动浏览器', async () => {
    if (!process.env.FLY_MACHINE_ID) await expect(readDouyinDetailFromOfficialPage(id, 'test-key=1')).resolves.toBeNull();
  });
});
