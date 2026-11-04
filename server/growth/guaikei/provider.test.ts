import { describe, expect, it } from "vitest";
import { requestContract, normalizeProviderData } from "./provider";
import { guaikeiRequestSchema } from "@shared/guaikei";

describe("GUAIKEI五平台公开合同", () => {
  it.each([
    ["douyin", "search", "/api/douyin/general-search/keyword"],
    ["xiaohongshu", "search", "/api/xiaohongshu/note-search/keyword"],
    ["kuaishou", "search", "/api/kuaishou/search/keyword"],
    ["tiktok", "search", "/api/tiktok/search/keyword"],
    ["wechat", "search", "/api/wechat/video-search/keyword"],
    ["wechat", "articles", "/api/wechat/article-search/keyword"],
    ["douyin", "posts", "/api/douyin/post/url"],
    ["xiaohongshu", "posts", "/api/xiaohongshu/post/url"],
    ["kuaishou", "posts", "/api/kuaishou/post/url"],
    ["tiktok", "posts", "/api/tiktok/post/url"],
  ])("%s/%s绑定真实文档路径", (platform, operation, path) => {
    const input = guaikeiRequestSchema.parse({ platform, operation, query: "AI", limit: 10 });
    const c = requestContract(input);
    expect(c.create).toBe(path); expect(c.poll).toBe(path.replace(/\/(keyword|url)$/, "/info"));
    expect(c.params.limit).toBe(10);
  });
  it("拒绝不支持的操作与过量输入", () => {
    expect(guaikeiRequestSchema.safeParse({ platform: "wechat", operation: "posts", query: "x", limit: 10 }).success).toBe(false);
    expect(guaikeiRequestSchema.safeParse({ platform: "douyin", operation: "articles", query: "x", limit: 10 }).success).toBe(false);
    expect(guaikeiRequestSchema.safeParse({ platform: "tiktok", operation: "search", query: "x", limit: 10000 }).success).toBe(false);
  });
  it.each([
    ["douyin", [{ aweme_id: "123", desc: "实拍", author_uid: "a", digg_count: 0 }], "123"],
    ["xiaohongshu", { note: [{ id: "abcd", title: "笔记", liked_count: "8" }], user: { user_id: "a" } }, "abcd"],
    ["kuaishou", [{ post: { id: "ks1", caption: "快手作品", like_count: 4 }, user: { user_id: "a" } }], "ks1"],
    ["tiktok", [{ aweme_id: "tt1", desc: "clip", author_id: "a", digg_count: 2 }], "tt1"],
    ["wechat", [{ docid: "wx1", title: "视频号", like_num: 2 }], "wx1"],
  ])("%s真实字段映射保留ID", (platform, data, id) => {
    const input = guaikeiRequestSchema.parse({ platform, operation: "search", query: "AI", limit: 10 });
    const result = normalizeProviderData(input, data);
    expect(result.items).toHaveLength(1); expect(result.items[0].id).toBe(id);
    expect(result.items[0].comments).toBeNull();
  });
  it("零值、缺失、去重、坏链接分别处理", () => {
    const result = normalizeProviderData({ platform: "wechat", operation: "articles", query: "AI", limit: 10 }, [
      { docid: "1", title: "文章", like_num: 0, url: "javascript:alert(1)" },
      { docid: "1", title: "重复" }, { title: "缺ID" },
    ]);
    expect(result).toMatchObject({ rawCount: 3, duplicateCount: 1, rejectedCount: 1 });
    expect(result.items[0]).toMatchObject({ likes: 0, comments: null, url: null, publishedAt: null });
  });
  it("未知结构不以空列表假成功", () => {
    expect(() => normalizeProviderData({ platform: "douyin", operation: "search", query: "AI", limit: 10 }, { unexpected: "value" })).toThrow();
  });
  it("真实微信搜索高亮清为纯文本，缺失互动量保持未知", () => {
    const { items } = normalizeProviderData({ platform: "wechat", operation: "search", query: "AI", limit: 1 }, [
      { docid: "wx-real-shape", title: '<em class="highlight">AI</em>时代，为何跨界协同成为必答题？', pubtime: 1793784139 },
    ]);
    expect(items[0].title).toBe("AI时代，为何跨界协同成为必答题？");
    expect(items[0].likes).toBeNull();
  });
  it("抖音优先使用完整描述，避免caption仅有标签", () => {
    const { items } = normalizeProviderData({ platform: "douyin", operation: "search", query: "AI", limit: 1 }, [
      { aweme_id: "123", desc: "完整介绍 #AI", caption: "#AI" },
    ]);
    expect(items[0].title).toBe("完整介绍 #AI");
  });
});

it("小红书不能把更新timestamp当发布时间，旧作不伪装为近7天",()=>{
 const input={platform:"xiaohongshu" as const,operation:"search" as const,query:"职场",limit:2};
 const {items}=normalizeProviderData(input,[{id:"old",title:"旧作",timestamp:"1793517962000",publish_time:"2025-03-16 01:14:19"},{id:"unknown",title:"未知",timestamp:"1793517962000"}]);
 expect(items[0].publishedAt).toBe("2025-03-15T17:14:19.000Z");expect(items[1].publishedAt).toBeNull();
});
