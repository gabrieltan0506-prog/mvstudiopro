import { describe, it, expect, vi } from "vitest";
import React, { createElement } from "react";
import { renderToString } from "react-dom/server";
import { webcrypto, createHash } from "node:crypto";
import * as pagination from "../../../shared/knowledgeCardPagination";
import { compileKnowledgeEditions } from "../../../shared/knowledgeCardEdition";
import { knowledgeCardInputKey } from "../../../shared/knowledgeCardSourceIdentity";
import Choice from "../components/platform/KnowledgeCardEditionChoice";
import {
  cachedKnowledgeCardPagePlan, isKnowledgeEditionManuscript, knowledgeCardInputIdentityFingerprint, knowledgeCardInputIdentityKey,
  knowledgeEditionChoiceCount, rememberKnowledgeEditionServerPages,
} from "./knowledgeCardPreflightCounts";

vi.stubGlobal("crypto", webcrypto);
vi.stubGlobal("React", React); // 测试环境的 JSX 为经典运行时
const strip = (html: string) => html.replace(/<!-- -->/g, "");
const model = "deepseek-v4.1-flash-1017";
// 与 /tmp/bench-plan.mts 同构：约 4208 个章节模块的两档稿
const para = "司马光记述此事时，先叙其始末，再论其得失；诸侯之间的盟约、兵力与粮道皆有详载，读者可据此判断形势的转折与因果。";
const modules = Array.from({ length: 4208 }, (_, i) => ({ headline: `卷${Math.floor(i / 14) + 1}·事件${i + 1}`,
  body: Array.from({ length: 3 + (i % 9) }, (_, k) => (k % 3 === 0 ? "- " : "") + para.repeat(1 + (k + i) % 3)).join("\n\n"),
  priority: (i % 6 === 0 ? "primary" : "secondary") as "primary" | "secondary" }));
const { full, concise } = compileKnowledgeEditions("资治通鉴", modules);

describe("1120 L8 大稿选档：每份正文只算一次", () => {
  it("约 3.4MB 两档稿：渲染 + 切档 5 次，规划函数每版 ≤1 次", () => {
    expect(full.length + concise.length).toBeGreaterThan(3_000_000);
    const plan = vi.spyOn(pagination, "planKnowledgeCardPages");
    const image = vi.spyOn(pagination, "knowledgeEditionImagePlan");
    const render = (selected: "full" | "concise") => strip(renderToString(createElement(Choice, { full, concise, model, selected, disabled: false, onSelect: () => {} })));
    let html = render("concise");
    for (let i = 0; i < 5; i++) {
      const next = i % 2 === 0 ? "full" : "concise";
      // 切档动作：取所选档的规划（toast 张数）后重渲染面板
      cachedKnowledgeCardPagePlan(next === "full" ? full : concise, model);
      html = render(next);
    }
    const texts = (spy: typeof plan | typeof image) => spy.mock.calls.map(c => c[0]);
    for (const text of [full, concise]) {
      expect(texts(plan).filter(t => t === text).length).toBe(1); // 证明计数器确实截获调用，且恰好 1 次
      // knowledgeEditionImagePlan：阅读页数摘要 1 次 + planKnowledgeCardPages 内部调用不经命名空间，不计
      expect(texts(image).filter(t => t === text).length).toBeLessThanOrEqual(1);
    }
    const expected = pagination.planKnowledgeCardPages(full, model).pageCount;
    expect(html).toContain(`完整版 · ${expected} 张图片`);
    plan.mockRestore(); image.mockRestore();
  }, 120_000);

  it("优先使用服务端 editionPageCounts，不再本地规划", () => {
    const f = full.replace("资治通鉴", "通鉴乙"), c = concise.replace("资治通鉴", "通鉴乙");
    rememberKnowledgeEditionServerPages(f, 48); rememberKnowledgeEditionServerPages(c, 30);
    const plan = vi.spyOn(pagination, "planKnowledgeCardPages");
    expect(knowledgeEditionChoiceCount(f, model)).toMatchObject({ pending: null, pageCount: 48 });
    expect(knowledgeEditionChoiceCount(c, model)).toMatchObject({ pending: null, pageCount: 30, credits: pagination.knowledgeCardCreditsForPages(30, model) });
    expect(plan).not.toHaveBeenCalled();
    plan.mockRestore();
  });
});

describe("1120 L8 E：没有两档标记的原稿不显示完整版张数", () => {
  it("提炼原稿（旧分页 1677 张）显示中性提示", () => {
    const raw = "# 资治通鉴\n\n" + Array.from({ length: 400 }, (_, i) => `## 第${i}节\n\n${para.repeat(30)}`).join("\n\n");
    expect(isKnowledgeEditionManuscript(raw)).toBe(false);
    expect(pagination.planKnowledgeCardPages(raw, model).pageCount).toBeGreaterThan(48);
    const html = strip(renderToString(createElement(Choice, { full: raw, concise: null, model, selected: "full", disabled: false, onSelect: () => {} })));
    expect(html).toContain("完整版 · 两档整理完成后给出张数");
    expect(html).toContain("精华版 · 正在选择重点…");
    expect(html).not.toMatch(/完整版 · \d+ 张图片/);
    expect(html).not.toMatch(/deepseek|glm|gpt|openai|evolink/i);
  });
  it("两档稿正常显示张数", () => {
    const small = compileKnowledgeEditions("小书", modules.slice(0, 20));
    const html = strip(renderToString(createElement(Choice, { full: small.full, concise: small.concise, model, selected: "full", disabled: false, onSelect: () => {} })));
    expect(html).toContain(`完整版 · ${pagination.planKnowledgeCardPages(small.full, model).pageCount} 张图片`);
    expect(html).toContain(`精华版 · ${pagination.planKnowledgeCardPages(small.concise, model).pageCount} 张图片`);
  });
});

describe("1120 L8 B：比较键不含全文，指纹与原编码逐字一致", () => {
  const input = { owner: "7", text: concise, full, level: "concise", template: null, model };
  it("键很短；同内容不同引用键相同；内容变化键不同", () => {
    const key = knowledgeCardInputIdentityKey(input);
    expect(key.length).toBeLessThan(200);
    const copy = { ...input, full: (" " + full).slice(1), text: (concise + " ").trimEnd() };
    expect(knowledgeCardInputIdentityKey(copy)).toBe(key);
    expect(knowledgeCardInputIdentityKey({ ...input, full: full + "x" })).not.toBe(key);
    expect(knowledgeCardInputIdentityKey({ ...input, level: "full" })).not.toBe(key);
    expect(knowledgeCardInputIdentityKey({ ...input, template: "t1" })).not.toBe(key);
    expect(knowledgeCardInputIdentityKey({ ...input, owner: "8" })).not.toBe(key);
  });
  it("指纹 = SHA-256(原 knowledgeCardInputKey)，云稿已存指纹仍匹配；重复取用不重算", async () => {
    const key = knowledgeCardInputIdentityKey(input);
    const expected = createHash("sha256").update(knowledgeCardInputKey(input)).digest("hex");
    const stringify = vi.spyOn(JSON, "stringify");
    expect(await knowledgeCardInputIdentityFingerprint(key)).toBe(expected);
    const bigCalls = () => stringify.mock.calls.filter(c => Array.isArray(c[0]) && (c[0] as unknown[]).includes(full)).length;
    const first = bigCalls();
    expect(await knowledgeCardInputIdentityFingerprint(key)).toBe(expected);
    expect(bigCalls()).toBe(first);
    stringify.mockRestore();
  });
});
