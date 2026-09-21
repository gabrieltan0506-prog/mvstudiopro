import { expect, it } from 'vitest';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';
import path from 'node:path';

it('特效翻页和筛选保留编辑稿，只有采用按钮才提交', async () => {
  const bundled = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';
      import {ManhuaVfxPicker} from './client/src/components/canvas/ManhuaVfxPicker';
      globalThis.applied=[];
      createRoot(document.getElementById('root')).render(<ManhuaVfxPicker shotIndex={1} disabled={false} initialDirection="保留原稿" onApply={value=>globalThis.applied.push(value)}/>);
    ` }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    alias: { '@shared': path.resolve('shared') }, define: { 'process.env.NODE_ENV': '"development"' },
  });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', request => void request.abort());
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: bundled.outputFiles[0]!.text });
    await page.waitForSelector('[data-manhua-vfx-picker]');
    await page.click('summary');
    expect(await page.$$eval('[aria-label="特效候选"] button', nodes => nodes.length)).toBe(8);
    await page.click('[aria-label="下一页特效"]');
    expect(await page.$eval('textarea', (el: HTMLTextAreaElement) => el.value)).toBe('保留原稿');
    await page.click('[aria-label="特效候选"] button');
    const selected = await page.$eval('textarea', (el: HTMLTextAreaElement) => el.value);
    expect(selected.length).toBeGreaterThan(30);
    expect(await page.$$eval('[aria-pressed="true"]', nodes => nodes.length)).toBe(1);
    await page.type('[aria-label="搜索特效"]', '不存在的效果XYZ');
    expect(await page.$$eval('[aria-label="特效候选"] button', nodes => nodes.length)).toBe(0);
    expect(await page.$eval('textarea', (el: HTMLTextAreaElement) => el.value)).toBe(selected);
    expect(await page.evaluate(() => (window as any).applied)).toEqual([]);
    await page.evaluate(() => Array.from(document.querySelectorAll('button')).find(b => b.textContent === '采用到当前镜头')!.click());
    expect(await page.evaluate(() => (window as any).applied)).toEqual([selected]);
  } finally { await browser.close(); }
}, 30_000);
