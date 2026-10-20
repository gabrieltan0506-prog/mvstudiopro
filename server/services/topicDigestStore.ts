import { sql } from "drizzle-orm";
import { getDb } from "../db.js";
import { topicPreferenceSchema, topicPeriod, topicRecommendationCount, selectTopicCards, type TopicPreference, type TopicDigest, type TopicLane } from "../../shared/topicDigest.js";

import type { TopicWorkflow } from "../../shared/topicDigestWorkflow.js";

let ready: Promise<void> | undefined;
async function database() {
  const db = await getDb();
  if (!db) throw new Error("选题通知暂不可用");
  if (!ready) ready = (async () => {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS topic_digest_preferences (
      user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, enabled boolean NOT NULL, lane text NOT NULL,
      keywords text NOT NULL DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS topic_digest_pools (
      id text PRIMARY KEY, lane text NOT NULL, period bigint NOT NULL, status text NOT NULL,
      digest jsonb, receipt jsonb, error text, created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(lane, period)
    )`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS topic_digest_notifications (
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE, pool_id text NOT NULL REFERENCES topic_digest_pools(id),
      period bigint NOT NULL, topic_count integer NOT NULL CHECK(topic_count IN (1,2)), selected_topics jsonb NOT NULL,
      read_at timestamptz, dismissed jsonb NOT NULL DEFAULT '[]', adopted jsonb NOT NULL DEFAULT '[]',
      created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id, pool_id), UNIQUE(user_id,period)
    )`);
    await db.execute(sql`ALTER TABLE topic_digest_pools ADD COLUMN IF NOT EXISTS pipeline jsonb,
      ADD COLUMN IF NOT EXISTS paid_status text NOT NULL DEFAULT 'pending', ADD COLUMN IF NOT EXISTS paid_digest jsonb,
      ADD COLUMN IF NOT EXISTS paid_started_at timestamptz`);
    await db.execute(sql`ALTER TABLE topic_digest_notifications ADD COLUMN IF NOT EXISTS pipeline_kind text NOT NULL DEFAULT 'deepseek'`);
  })().catch(error => { ready = undefined; throw error; });
  await ready;
  return db;
}
const rows = <T>(result: unknown) => (result as { rows: T[] }).rows;

export async function readTopicPreference(userId: number): Promise<TopicPreference | null> {
  const db = await database();
  const [value] = rows<TopicPreference>(await db.execute(sql`SELECT enabled, lane, keywords FROM topic_digest_preferences WHERE user_id=${userId}`));
  return value ? topicPreferenceSchema.parse(value) : null;
}
export async function saveTopicPreference(userId: number, input: TopicPreference) {
  const value = topicPreferenceSchema.parse(input);
  const db = await database();
  await db.execute(sql`INSERT INTO topic_digest_preferences(user_id,enabled,lane,keywords)
    VALUES(${userId},${value.enabled},${value.lane},${value.keywords}) ON CONFLICT(user_id)
    DO UPDATE SET enabled=excluded.enabled,lane=excluded.lane,keywords=excluded.keywords,updated_at=now()`);
  return value;
}
export async function subscribedTopicLanes(period = topicPeriod()): Promise<TopicLane[]> {
  const db = await database();
  return rows<{ lane: TopicLane }>(await db.execute(sql`SELECT DISTINCT p.lane FROM topic_digest_preferences p WHERE p.enabled=true
    AND NOT EXISTS(SELECT 1 FROM topic_digest_notifications n WHERE n.user_id=p.user_id AND n.period=${period})`)).map(r => r.lane);
}
export async function readTopicRecommendationCount(userId: number): Promise<1 | 2> {
  const db = await database();
  const [membership] = rows<{role:string;plan:string}>(await db.execute(sql`SELECT u.role,coalesce(s.plan,'free') AS plan
    FROM users u LEFT JOIN stripe_customers s ON s."userId"=u.id WHERE u.id=${userId}`));
  if (!membership) throw new Error("账号不存在");
  return topicRecommendationCount(membership);
}
export async function recentTopicTitles(lane: TopicLane): Promise<string[]> {
  const db = await database();
  const recent = rows<{ digest: TopicDigest; paid_digest: TopicDigest | null }>(await db.execute(sql`SELECT digest,paid_digest FROM topic_digest_pools
    WHERE lane=${lane} AND status='succeeded' ORDER BY period DESC LIMIT 4`));
  return recent.flatMap(r => [...r.digest.topics,...(r.paid_digest?.topics || [])].map(t => t.title));
}
export async function topicPoolState(lane: TopicLane, period: number, count: 1 | 2 = 1): Promise<"waiting" | "running" | "ready" | "unavailable"> {
  const db = await database();
  const [pool] = rows<{ status: string; created_at: Date | string; paid_status:string; paid_started_at:Date|string|null; pipeline:TopicWorkflow|null }>(await db.execute(sql`SELECT status,created_at,paid_status,paid_started_at,pipeline FROM topic_digest_pools WHERE lane=${lane} AND period=${period}`));
  if (!pool) return "waiting";
  if (pool.status === "succeeded") {
    if(count===1) return "ready";
    if(!pool.pipeline) return "unavailable";
    if(pool.paid_status==="succeeded") return "ready";
    if(pool.paid_status==="pending") return "waiting";
    if(pool.paid_status==="running" && pool.paid_started_at && Date.now()-new Date(pool.paid_started_at).getTime()<10*60_000) return "running";
    return "unavailable";
  }
  if (pool.status === "running" && Date.now() - new Date(pool.created_at).getTime() < 10 * 60_000) return "running";
  return "unavailable";
}
/** 数据库唯一占位跨机器生效；插入成功才允许一次上游调用。未知结果不自动重发。 */
export async function claimTopicPool(id: string, lane: TopicLane, period: number): Promise<boolean> {
  const db = await database();
  return rows(await db.execute(sql`INSERT INTO topic_digest_pools(id,lane,period,status) VALUES(${id},${lane},${period},'running')
    ON CONFLICT DO NOTHING RETURNING id`)).length > 0;
}
export async function completeTopicPool(id: string, digest: TopicDigest, receipt: unknown, workflow?: TopicWorkflow) {
  const db = await database();
  await db.execute(sql`UPDATE topic_digest_pools SET status='succeeded',digest=${JSON.stringify(digest)}::jsonb,
    receipt=${JSON.stringify(receipt)}::jsonb,pipeline=${JSON.stringify(workflow ?? null)}::jsonb,error=NULL WHERE id=${id} AND status='running'`);
}
export async function failTopicPool(id: string) {
  const db = await database();
  await db.execute(sql`UPDATE topic_digest_pools SET status='unknown',error='本期生成未取得可用结果，保留已有通知，不自动重复调用。'
    WHERE id=${id} AND status='running'`);
}
/** 只有仍待投递的付费订阅者能触发扩展；CAS保证跨实例只追加一次。 */
export async function claimPaidTopicPool(id:string):Promise<{digest:TopicDigest;workflow:TopicWorkflow}|null>{
  const db=await database();
  const [pool]=rows<{digest:TopicDigest;workflow:TopicWorkflow}>(await db.execute(sql`UPDATE topic_digest_pools q
    SET paid_status='running',paid_started_at=now() WHERE q.id=${id} AND q.status='succeeded' AND q.paid_status='pending'
    AND q.pipeline->>'version'='2' AND q.pipeline->'deepseek'->>'status'='succeeded'
    AND q.pipeline->'deepseek'->'receipt'->>'provider'='DeepSeek' AND (q.digest->>'expiresAt')::timestamptz>now()
    AND EXISTS(SELECT 1 FROM topic_digest_preferences p JOIN users u ON u.id=p.user_id
      LEFT JOIN stripe_customers s ON s."userId"=u.id WHERE p.enabled=true AND p.lane=q.lane
      AND (u.role IN ('paid','admin','supervisor') OR coalesce(s.plan,'free') IN ('pro','enterprise'))
      AND NOT EXISTS(SELECT 1 FROM topic_digest_notifications n WHERE n.user_id=p.user_id AND n.period=q.period))
    RETURNING q.digest,q.pipeline AS workflow`));
  return pool || null;
}
export async function savePaidTopicWorkflow(id:string,workflow:TopicWorkflow){
  const db=await database();
  if(rows(await db.execute(sql`UPDATE topic_digest_pools SET pipeline=${JSON.stringify(workflow)}::jsonb
    WHERE id=${id} AND paid_status='running' RETURNING id`)).length!==1) throw new Error("付费选题步骤保存失败");
}
export async function completePaidTopicPool(id:string,digest:TopicDigest,workflow:TopicWorkflow){
  const db=await database();
  if(rows(await db.execute(sql`UPDATE topic_digest_pools SET paid_status='succeeded',paid_digest=${JSON.stringify(digest)}::jsonb,
    pipeline=${JSON.stringify(workflow)}::jsonb WHERE id=${id} AND paid_status='running' RETURNING id`)).length!==1) throw new Error("付费选题结果保存失败");
}
export async function failPaidTopicPool(id:string){
  const db=await database();
  await db.execute(sql`UPDATE topic_digest_pools SET paid_status='unknown' WHERE id=${id} AND paid_status='running'`);
}
/** 只投递成功且仍当期的池；关闭/换赛道即时按数据库现值生效，不依赖进程旧快照。 */
export async function deliverTopicPool(id: string) {
  const db = await database();
  const [pool] = rows<{digest:TopicDigest;period:number;paid_digest:TopicDigest|null;paid_status:string}>(await db.execute(sql`SELECT digest,period,paid_digest,paid_status FROM topic_digest_pools
    WHERE id=${id} AND status='succeeded' AND (digest->>'expiresAt')::timestamptz > now()`));
  if (!pool) return;
  const subscribers = rows<{user_id:number;keywords:string;role:string;plan:string}>(await db.execute(sql`
    SELECT p.user_id,p.keywords,u.role,coalesce(s.plan,'free') AS plan FROM topic_digest_preferences p
    JOIN users u ON u.id=p.user_id LEFT JOIN stripe_customers s ON s."userId"=p.user_id
    WHERE p.enabled=true AND p.lane=${pool.digest.lane}
    AND (${pool.paid_status==='succeeded' && !!pool.paid_digest} OR NOT (u.role IN ('paid','admin','supervisor') OR coalesce(s.plan,'free') IN ('pro','enterprise')))
    AND NOT EXISTS(SELECT 1 FROM topic_digest_notifications n WHERE n.user_id=p.user_id AND n.period=${pool.period})
    ORDER BY p.user_id LIMIT 200`));
  for (const user of subscribers) {
    const count=topicRecommendationCount(user);
    const digest=count===1?pool.digest:pool.paid_status==='succeeded'?pool.paid_digest:null;
    if(!digest) continue;
    const selected=selectTopicCards(digest.topics,user.keywords,[],count);
    // 数量/选题在投递时冻结。换赛道、隐藏、重复打开或并发调度都不能补出更多条。
    await db.execute(sql`INSERT INTO topic_digest_notifications(user_id,pool_id,period,topic_count,selected_topics,pipeline_kind)
      SELECT p.user_id,${id},${pool.period},${count},${JSON.stringify(selected)}::jsonb,${count===2?'dual':'deepseek'} FROM topic_digest_preferences p
      JOIN users u ON u.id=p.user_id LEFT JOIN stripe_customers s ON s."userId"=u.id
      WHERE p.user_id=${user.user_id} AND p.enabled=true AND p.lane=${pool.digest.lane}
      AND (CASE WHEN u.role IN ('paid','admin','supervisor') OR coalesce(s.plan,'free') IN ('pro','enterprise') THEN 2 ELSE 1 END)=${count} ON CONFLICT DO NOTHING`);
  }
}
export type TopicNotification = { id: string; method: "deepseek" | "dual"; digest: TopicDigest; read: boolean; dismissed: string[]; adopted: string[] };
export async function listTopicNotifications(userId: number): Promise<TopicNotification[]> {
  const db = await database();
  return rows<TopicNotification>(await db.execute(sql`SELECT n.pool_id AS id,n.pipeline_kind AS method,jsonb_set(p.digest,'{topics}',n.selected_topics) AS digest,n.read_at IS NOT NULL AS read,n.dismissed,n.adopted
    FROM topic_digest_notifications n JOIN topic_digest_pools p ON p.id=n.pool_id
    WHERE n.user_id=${userId} AND p.status='succeeded' ORDER BY n.created_at DESC,n.pool_id DESC LIMIT 12`));
}
export async function getTopicNotification(userId: number, id: string): Promise<TopicNotification> {
  const db = await database();
  const [result] = rows<TopicNotification>(await db.execute(sql`SELECT n.pool_id AS id,n.pipeline_kind AS method,jsonb_set(p.digest,'{topics}',n.selected_topics) AS digest,n.read_at IS NOT NULL AS read,n.dismissed,n.adopted
    FROM topic_digest_notifications n JOIN topic_digest_pools p ON p.id=n.pool_id
    WHERE n.user_id=${userId} AND n.pool_id=${id} AND p.status='succeeded'`));
  if (!result) throw new Error("通知不存在或无权访问");
  return result;
}
export async function updateTopicNotification(userId: number, id: string, action: "read" | "dismiss" | "adopt", topicId?: string) {
  const notification = await getTopicNotification(userId, id);
  if (action !== "read" && !notification.digest.topics.some(t => t.id === topicId)) throw new Error("选题不存在");
  const db = await database();
  if (action === "read") await db.execute(sql`UPDATE topic_digest_notifications SET read_at=coalesce(read_at,now()) WHERE user_id=${userId} AND pool_id=${id}`);
  else if (action === "dismiss") await db.execute(sql`UPDATE topic_digest_notifications SET dismissed=dismissed || ${JSON.stringify([topicId])}::jsonb
    WHERE user_id=${userId} AND pool_id=${id} AND NOT dismissed @> ${JSON.stringify([topicId])}::jsonb`);
  else await db.execute(sql`UPDATE topic_digest_notifications SET adopted=adopted || ${JSON.stringify([topicId])}::jsonb,read_at=coalesce(read_at,now())
    WHERE user_id=${userId} AND pool_id=${id} AND NOT adopted @> ${JSON.stringify([topicId])}::jsonb`);
  return notification;
}
