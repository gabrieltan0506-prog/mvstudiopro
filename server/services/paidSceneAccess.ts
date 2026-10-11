import { TRPCError } from "@trpc/server";
import { getUserPlan } from "../credits";
import { resolvePaidSceneAccess } from "../../shared/paidSceneAccess";

type SceneUser = { id: number; role: string };

export async function getPaidSceneAccess(user: SceneUser, readPlan = getUserPlan) {
  // 内部权限不依赖订阅查询；保持原有管理员、监管验收链可用。
  if (user.role === "admin" || user.role === "supervisor") return resolvePaidSceneAccess(user.role, undefined);
  return resolvePaidSceneAccess(user.role, await readPlan(user.id));
}

export async function assertPaidSceneGenerationAccess(user: SceneUser, readPlan = getUserPlan) {
  const access = await getPaidSceneAccess(user, readPlan);
  if (!access.canGenerate) {
    throw new TRPCError({ code: "FORBIDDEN", message: access.message });
  }
  return access;
}
