import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { guaikeiLabels, guaikeiPlatforms, guaikeiSettingsSchema, type GuaikeiSettings } from "@shared/guaikei";

const money = (cents: number | null) => cents === null ? "未确认" : `¥${(cents / 100).toFixed(2)}`;
export function GuaikeiAutomationSettings() {
  const settings = trpc.guaikei.settings.useQuery(undefined, { retry: false });
  const balance = trpc.guaikei.balance.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState<GuaikeiSettings | null>(null);
  const [message, setMessage] = useState("");
  const [hoursText, setHoursText] = useState<Record<string, string>>({});
  const save = trpc.guaikei.saveSettings.useMutation({ onSuccess: async () => {
    setDraft(null); setMessage("自动采集配置已保存"); await utils.guaikei.settings.invalidate();
  }, onError: error => setMessage(error.message) });
  const value = draft || settings.data?.settings;
  const update = (fn: (next: GuaikeiSettings) => void) => {
    if (!value) return;
    const next = structuredClone(value); fn(next); setDraft(next);
  };
  return <details className="mt-3 rounded-lg border border-white/15 p-3 text-xs">
    <summary className="cursor-pointer">自动采集设置与余额</summary>
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <span>供应商余额：{money(balance.data?.balanceCents ?? null)}</span>
      <button type="button" onClick={() => void balance.refetch()} disabled={balance.isFetching}>刷新余额</button>
      {balance.data?.lowBalance && <strong role="alert" className="text-amber-300">余额低于 ¥5，请及时充值</strong>}
      {balance.data && <span>今日实际支出 {money(balance.data.todaySpentCents)}{balance.data.todayComplete ? "" : "（账单未完整）"}</span>}
      {balance.data?.checkedAt && <span>核对时间：{new Date(balance.data.checkedAt).toLocaleString()}</span>}
    </div>
    {(balance.error || balance.data?.error) && <p role="alert">余额未确认，请稍后刷新。</p>}
    {balance.data && !balance.data.balanceConsistent && !balance.data.error && <p>余额与资金流水推算尚未一致，保留供应商返回值供核对。</p>}
    {settings.error && <p role="alert">配置读取失败，未开启自动采集。</p>}
    {value && <fieldset disabled={save.isPending} className="mt-3 space-y-3">
      <label className="flex gap-2"><input type="checkbox" checked={value.enabled} onChange={e => update(next => { next.enabled = e.target.checked; })} />开启自动付费采集（从供应商余额扣费）</label>
      <p>按保存的各平台关键词独立轮转；关闭后不再新建轮次，已提交任务继续查询收尾。未设置每日金额上限。</p>
      {guaikeiPlatforms.map(platform => { const cfg=value.platforms[platform]; return <div key={platform} className="rounded border border-white/10 p-2">
        <label className="flex gap-2 font-semibold"><input type="checkbox" checked={cfg.enabled} onChange={e => update(next=>{next.platforms[platform].enabled=e.target.checked;})} />{guaikeiLabels[platform]}</label>
        <label className="mt-2 block">关键词（每行一个，可跨平台重复）<textarea aria-label={`${guaikeiLabels[platform]}自动关键词`} className="mt-1 w-full rounded bg-slate-900 p-2" rows={3} value={cfg.keywords.join("\n")} onChange={e=>update(next=>{next.platforms[platform].keywords=e.target.value.split("\n");})} /></label>
        <div className="mt-2 flex flex-wrap gap-3">
          <label>频次 <select className="bg-slate-900" value={cfg.mode} onChange={e=>update(next=>{next.platforms[platform].mode=e.target.value as typeof cfg.mode;})}><option value="manual">仅手动</option><option value="hourly">每小时</option><option value="windows">每天指定时段</option></select></label>
          {cfg.mode==="windows" && <label>北京时间中心小时（逗号分隔，前后各一小时）<input className="w-24 bg-slate-900" value={hoursText[platform] ?? cfg.hours.join(",")} onChange={e=>setHoursText(previous=>({...previous,[platform]:e.target.value}))}/></label>}
          <label>每次条数 <input className="w-16 bg-slate-900" type="number" min={1} max={100} value={cfg.limit} onChange={e=>update(next=>{next.platforms[platform].limit=Number(e.target.value);})}/></label>
          <label>每轮关键词数 <input className="w-16 bg-slate-900" type="number" min={1} max={6} value={cfg.rounds} onChange={e=>update(next=>{next.platforms[platform].rounds=Number(e.target.value);})}/></label>
        </div>
        {(platform==="douyin"||platform==="xiaohongshu") && <div className="mt-2 flex flex-wrap gap-3">
          <label><input type="checkbox" checked={cfg.surgeEnabled} onChange={e=>update(next=>{next.platforms[platform].surgeEnabled=e.target.checked;})}/>原库新增突增时补采</label>
          <label>较上轮增加% <input className="w-16 bg-slate-900" type="number" min={1} max={1000} value={cfg.surgePercent} onChange={e=>update(next=>{next.platforms[platform].surgePercent=Number(e.target.value);})}/></label>
          <label>至少新增 <input className="w-20 bg-slate-900" type="number" min={1} value={cfg.surgeMinAdded} onChange={e=>update(next=>{next.platforms[platform].surgeMinAdded=Number(e.target.value);})}/></label>
          <label>冷却分钟 <input className="w-20 bg-slate-900" type="number" min={30} max={1440} value={cfg.surgeCooldownMinutes} onChange={e=>update(next=>{next.platforms[platform].surgeCooldownMinutes=Number(e.target.value);})}/></label>
        </div>}
      </div>; })}
      <button type="button" className="rounded border border-cyan-300 px-3 py-2" onClick={()=>{
        const candidate=structuredClone(value);
        for(const platform of guaikeiPlatforms) if(hoursText[platform] !== undefined) candidate.platforms[platform].hours=hoursText[platform].split(",").map(text=>text.trim() ? Number(text) : NaN);
        const parsed=guaikeiSettingsSchema.safeParse(candidate);
        if(!parsed.success){setMessage("请核对关键词、时间、条数和阈值范围，空关键词不能保存。");return;}
        save.mutate(parsed.data);
      }}>保存自动采集配置</button>
    </fieldset>}
    {message && <p role="status" className="mt-2">{message}</p>}
  </details>;
}
