/**
 * 第三关：数据分流验证
 * 验证 Fly 本地文件 + Neon DB 快照写入正确
 * 运行: npx tsx scripts/test-3-assets.ts
 */
import fs from "fs/promises";
import path from "path";
import { getDb } from "../server/db";
import { userCreations } from "../drizzle/schema-creations";
import { desc, eq } from "drizzle-orm";

async function testAssets() {
  console.log("⏳ [Test 3] 验证资产分流与防截断...\n");
  let pass = 0;

  // 1. Fly 本地磁盘验证
  console.log("  📁 检查 Fly 本地研究档案...");
  try {
    const dir = "/data/growth/research";
    const files = await fs.readdir(dir);
    if (files.length === 0) throw new Error("目录为空，没有档案");
    const latest = files.sort().at(-1)!;
    const content = await fs.readFile(path.join(dir, latest), "utf-8");
    const parsed = JSON.parse(content);
    if (!parsed.stage1Raw || !parsed.strategy) throw new Error("档案内容不完整（stage1Raw 或 strategy 缺失）");
    const totalLength = JSON.stringify(parsed).length;
    console.log(`  ✅ Fly 档案验证通过：${latest}`);
    console.log(`     总字节数: ${totalLength}，stage1Raw 字符: ${parsed.stage1Raw.length}`);
    pass++;
  } catch (err: any) {
    console.error("  ❌ Fly 档案验证失败:", err?.message);
  }

  // 2. Neon DB 快照验证
  console.log("\n  🗄️  检查 Neon DB 快照...");
  try {
    const db = await getDb();
    if (!db) throw new Error("数据库不可用");
    const rows = await db
      .select()
      .from(userCreations)
      .where(eq(userCreations.type, "research_snapshot"))
      .orderBy(desc(userCreations.createdAt))
      .limit(1);

    if (rows.length === 0) throw new Error("找不到 research_snapshot 记录，请先运行一次调研");
    const row = rows[0];
    if (!row.metadata) throw new Error("metadata 为空");
    const meta = JSON.parse(row.metadata);
    const metaLen = JSON.stringify(meta).length;
    if (metaLen < 50) throw new Error(`Neon 数据疑似被截断，metadata 长度仅 ${metaLen}`);
    console.log(`  ✅ Neon 快照验证通过：id=${row.id} title="${row.title}"`);
    console.log(`     metadata 字节数: ${metaLen}`);
    pass++;
  } catch (err: any) {
    console.error("  ❌ Neon 快照验证失败:", err?.message);
  }

  console.log(`\n${"─".repeat(40)}`);
  console.log(`结果：${pass}/2 项通过`);
  if (pass < 2) process.exit(1);
  console.log("✅ [Test 3] 所有资产分流验证通过！");
}

testAssets();
