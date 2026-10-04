import { it, expect } from "vitest";
import { parseNovelModelJson } from "./novelJson";
it("accepts a trailing comma without changing dialogue, escapes, or nested text", () => {
  const source =
    '{"title":"第二集","text":"对白里写着 ,} 与 ,]，他说：\\"别动\\"", "notes":"衔接闭合",\n}';
  const parsed = parseNovelModelJson(source);
  expect(parsed.repaired).toBe(true);
  expect(parsed.value).toEqual({
    title: "第二集",
    text: '对白里写着 ,} 与 ,]，他说："别动"',
    notes: "衔接闭合",
  });
  expect(parseNovelModelJson('```json\n{"a":[1,2,],}\n```').value).toEqual({
    a: [1, 2],
  });
});
it("does not fabricate truncated text or repair genuinely invalid JSON", () => {
  for (const raw of ['{"text":"截断', '{"text":}', '{title:"文字"}'])
    expect(() => parseNovelModelJson(raw)).toThrow();
});
