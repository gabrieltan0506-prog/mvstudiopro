import { readTrendStoreForPlatforms } from "../growth/trendStore.js";
import { resolveJobWorkerRole } from "../jobs/workerRole.js";
import { TOPIC_LANES, TOPIC_DIGEST_INTERVAL_MS, topicLaneSchema, topicPeriod, verifyTopicCandidates,
  type TopicLane, type TopicSource } from "../../shared/topicDigest.js";
import { newTopicWorkflow, verifyTopicIntegration } from "../../shared/topicDigestWorkflow.js";
import { callTopicModel, runPaidTopicPipeline } from "./topicDigestPipeline.js";
import { claimPaidTopicPool, savePaidTopicWorkflow, completePaidTopicPool, failPaidTopicPool, claimTopicPool, completeTopicPool, deliverTopicPool, failTopicPool, subscribedTopicLanes, recentTopicTitles } from "./topicDigestStore.js";

const laneTerms: Record<TopicLane, RegExp> = {
  parenting: /亲子|育儿|孩子|父母|妈妈|绘本|儿童/, workplace: /职场|工作|沟通|成长|求职|面试/,
  ai: /AI|人工智能|模型|创作|工具/i, business: /营销|品牌|产品|创业|客户|商业/,
  lifestyle: /生活|家居|美食|旅行|收纳|穿搭/, storytelling: /故事|漫剧|短剧|小说|动画|分镜/,
};
export async function readTopicSources(lane: TopicLane, now: number): Promise<TopicSource[]> {
  const store = await readTrendStoreForPlatforms(["xiaohongshu", "douyin", "bilibili", "weixin_channels"]);
  const sources: TopicSource[] = [];
  for (const collection of Object.values(store.collections)) {
    if (!collection || collection.source !== "live") continue;
    for (const item of collection.items) {
      const observedAt = item.observedAt || item.publishedAt || "";
      const age = now - Date.parse(observedAt);
      if (!Number.isFinite(age) || age < 0 || age > TOPIC_DIGEST_INTERVAL_MS || !/^https?:\/\//.test(item.url || "")) continue;
      if (!laneTerms[lane].test(`${item.title} ${(item.tags || []).join(" ")}`)) continue;
      sources.push({ id: `${collection.platform}:${item.id}`, title: item.title.slice(0, 200), url: item.url!, observedAt, platform: collection.platform });
    }
  }
  return sources.sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt)).slice(0, 35);
}

export async function generateTopicPool(lane: TopicLane, sources: TopicSource[], previousTitles: string[], poolId: string) {
  return callTopicModel("deepseek",{lane,sources,previousTitles},poolId);
}

export const topicDigestDependencies = { claim: claimTopicPool, complete: completeTopicPool, deliver: deliverTopicPool,
  fail: failTopicPool, lanes: subscribedTopicLanes, sources: readTopicSources, generate: generateTopicPool, previous: recentTopicTitles,
  claimPaid:claimPaidTopicPool,savePaid:savePaidTopicWorkflow,completePaid:completePaidTopicPool,failPaid:failPaidTopicPool,
  paidCall:callTopicModel };

/** 免费复用一次DeepSeek基础池；仅有待投递付费账号时，再追加GLM及整合两次。 */
export async function runTopicDigestTick(deps = topicDigestDependencies, now = Date.now()) {
  const period = topicPeriod(now);
  const lanes = await deps.lanes(period);
  for (const rawLane of lanes) {
    const checked = topicLaneSchema.safeParse(rawLane);
    if (!checked.success) continue;
    const lane = checked.data;
    const id = `topic-v1-${lane}-${period}`;
    if (await deps.claim(id, lane, period)) {
      try {
        const sources = await deps.sources(lane, now).catch(() => []);
        const previous = await deps.previous(lane);
        const result = await deps.generate(lane, sources, previous,id);
        const topics = verifyTopicCandidates(result.raw, sources, now);
        if (result.receipt.provider!=="DeepSeek") throw new Error("DeepSeek供应商回执不匹配");
        if (topics.some(t => previous.includes(t.title))) throw new Error("选题与近期推荐重复");
        await deps.complete(id, { id, lane, topics, createdAt: new Date(now).toISOString(),
          expiresAt: new Date((period + 1) * TOPIC_DIGEST_INTERVAL_MS).toISOString() }, result.receipt,
          newTopicWorkflow(lane,sources,previous,result));
      } catch {
        await deps.fail(id);
      }
    }
    // 先投递免费基础池；付费步骤失败不得影响已保存基础稿或冒充双路成功。
    await deps.deliver(id);
    const paid=await deps.claimPaid(id);
    if(paid){
      try{
        const workflow=await runPaidTopicPipeline(id,paid.workflow,{call:deps.paidCall,save:w=>deps.savePaid(id,w)});
        if(workflow.integrated.status!=="succeeded") throw new Error("付费整合未完成");
        const topics=verifyTopicIntegration(workflow.integrated.raw,workflow);
        if(topics.some(t=>workflow.previousTitles.includes(t.title))) throw new Error("整合选题与近期重复");
        await deps.completePaid(id,{...paid.digest,topics},workflow);
      }catch{await deps.failPaid(id);}
      await deps.deliver(id);
    }
  }
}

let timer: ReturnType<typeof setInterval> | undefined;
let running = false;
export function startTopicDigestScheduler() {
  if (timer || resolveJobWorkerRole() !== "app" || process.env.DISABLE_TOPIC_DIGEST === "1") return;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runTopicDigestTick(); }
    catch { console.warn("[topic-digest] 本次调度未完成，将只补未投递消息，未知模型请求不重发"); }
    finally { running = false; }
  };
  timer = setInterval(() => void tick(), 60_000);
  timer.unref();
  void tick();
}
export function stopTopicDigestScheduler() { if (timer) clearInterval(timer); timer = undefined; }
