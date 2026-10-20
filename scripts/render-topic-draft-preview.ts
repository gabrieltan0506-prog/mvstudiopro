/** 用已保存正文生成可交互审阅页；与正式页使用相同组件，不调用模型。 */
import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) throw new Error("请提供保存的工作流JSON与输出HTML路径");
const raw = JSON.parse(await readFile(inputPath, "utf8"));
const source = raw.workflow || raw;
const content = Object.fromEntries(["deepseek", "glm", "integrated"].map(k => [k, { raw: source[k]?.raw }]));
const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
import React from 'react';import {createRoot} from 'react-dom/client';
import {TopicDraftComparison} from './client/src/components/TopicDraftComparison';
import {buildTopicReadingComparison} from './shared/topicDigestPresentation';
createRoot(document.getElementById('drafts')!).render(<TopicDraftComparison comparison={buildTopicReadingComparison(${JSON.stringify(content)})}/>);` },
  bundle: true, write: false, outdir: "preview", platform: "browser", format: "iife", jsx: "automatic", minify: true,
  alias: { "@shared": path.resolve("shared") }, define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent" });
const js = bundle.outputFiles.find(f => f.path.endsWith(".js"))!.text.replace(/<\/script/gi, "<\\/script");
const css = bundle.outputFiles.find(f => f.path.endsWith(".css"))!.text;
await writeFile(outputPath, `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>原稿与整合稿 · 分类阅读对照</title><style>body{margin:0;background:#f5f3ed;color:#243a30;font-family:system-ui,sans-serif}main{max-width:960px;margin:auto;padding:38px 24px}h1{font-size:32px;line-height:1.4}.lead{line-height:1.8;color:#596c60}small{color:#607267} ${css}</style></head><body><main><small>保存的真实模型正文 · 无新增模型调用 · 尚未线上验收</small><h1>原稿与整合稿，分组读清楚</h1><p class="lead">先看整合稿，或切换两份原稿。同类选题集中排列；每题保留原编号。展开提纲即可查看完整内容及对应原稿，合并说明位于整合稿末尾。</p><div id="drafts"></div></main><script>${js}</script></body></html>`);
console.log(outputPath);
