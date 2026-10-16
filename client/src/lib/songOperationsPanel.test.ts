import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
import { SongOperationsPanel } from '../components/canvas/SongOperationsPanel';
import type { SongOperationReceipt } from '@shared/songOperations';
const source={id:'original',url:'https://example.com/music.mp3',durationSec:180,title:'测试曲'};
const receipt:SongOperationReceipt={requestId:'bbd234fd-6e9e-418a-8723-e640126f2320',operation:'align',sourceId:source.id,status:'prepared',inputDigest:'a'.repeat(64),createdAt:'2026-10-16T06:00:00Z',creditsCost:null,draft:{operation:'align',source},variants:[]};
function render(r=receipt){const services={prepare:vi.fn(),submit:vi.fn(),get:vi.fn(),resume:vi.fn()};return {services,html:renderToStaticMarkup(React.createElement(SongOperationsPanel, {source, lyrics:"歌词", sessions:[{requestId:r.requestId,sourceId:source.id,operation:r.operation,receipt:r}], services, onSession:()=>{}, onCandidates:()=>{}, onAlignment:()=>{}, onStems:()=>{}}))};}
describe('歌曲操作价格确认与结果展示',()=>{
 it('价格未确认不可提交，服务不会因渲染自动触发',()=>{const {html,services}=render();expect(html).toContain('价格待确认，暂不可提交');expect(html).toMatch(/<button[^>]*disabled=""[^>]*>确认以上内容并提交/);expect(services.submit).not.toHaveBeenCalled();expect(services.prepare).not.toHaveBeenCalled();});
 it('成功对齐展示真实时间并提供字幕消费入口',()=>{const {html}=render({...receipt,status:'succeeded',alignment:{srt:'1\n00:00:01,250 --> 00:00:02,500\n歌词',words:[{text:'歌词',startSec:1.25,endSec:2.5}]}});expect(html).toContain('1.25–2.50 秒');expect(html).toContain('导出 SRT');expect(html).toContain('应用到 MV 字幕');});
});

describe('歌曲操作新增恢复与版本确认',()=>{
 it('仅核对或扣费挂起状态显示原任务恢复，渲染不提交',()=>{
  const {html,services}=render({...receipt,status:'reconcile_required'});
  expect(html).toContain('恢复原任务处理（不重新生成）');
  expect(services.resume).not.toHaveBeenCalled();expect(services.submit).not.toHaveBeenCalled();
 });
 it('当前编辑内容不同于旧报价时禁止提交',()=>{
  const {html}=render({...receipt,operation:'cover',creditsCost:10,draft:{operation:'cover',source,title:'旧标题',prompt:'旧歌词',style:'流行',instrumental:false}});
  expect(html).toContain('此旧版本不可提交');
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>确认以上内容并提交/);
 });
 it('续写确认说明完整歌曲衔接与免费处理边界',()=>{
  const {html}=render({...receipt,operation:'extend',draft:{operation:'extend',source,title:'续写',prompt:'新歌词',style:'流行',continueAt:72}});
  expect(html).toContain('保留原曲 0–72 秒');expect(html).toContain('衔接处理免费');expect(html).toContain('未定价时不可提交');
 });
});
