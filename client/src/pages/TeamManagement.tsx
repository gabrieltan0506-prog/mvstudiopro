// @ts-nocheck

import { useState, useCallback } from "react";
import { useLocation, Link } from "wouter";
import { toast } from "sonner";
import { ArrowLeft, Mail, X, Wallet, GitCommitHorizontal, UserMinus, UserPlus, Loader2, ChevronsUpDown, Check } from "lucide-react";

import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
// TODO: Replace with shadcn Dialog
// import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

// ─── 角色标签 ──────────────────────────────────
function RoleBadge({ role }: { role: string }) {
  const config: Record<string, { className: string; label: string }> = {
    owner: { className: "bg-orange-500/20 text-orange-500", label: "拥有者" },
    admin: { className: "bg-purple-500/20 text-purple-500", label: "管理员" },
    member: { className: "bg-sky-500/20 text-sky-500", label: "成员" },
  };
  const c = config[role] ?? config.member;
  return <div className={`px-2 py-1 text-xs font-medium rounded-md ${c.className}`}>{c.label}</div>;
}

// ─── 状态标签 ──────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { className: string; label: string }> = {
    active: { className: "bg-green-500/20 text-green-500", label: "已加入" },
    invited: { className: "bg-yellow-500/20 text-yellow-500", label: "待接受" },
    suspended: { className: "bg-red-500/20 text-red-500", label: "已暂停" },
    removed: { className: "bg-gray-500/20 text-gray-500", label: "已移除" },
  };
  const c = config[status] ?? config.active;
  return <div className={`px-2 py-1 text-xs font-medium rounded-md ${c.className}`}>{c.label}</div>;
}

// ─── Credits 进度条 ─────────────────────────────
function CreditBar({ used, allocated }: { used: number; allocated: number }) {
  const pct = allocated > 0 ? Math.min((used / allocated) * 100, 100) : 0;
  const barColor = pct > 80 ? "bg-red-500" : pct > 50 ? "bg-yellow-500" : "bg-green-500";
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-grow bg-gray-800 rounded-full h-1.5">
        <div className={`h-1.5 rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-400">
        {used}/{allocated}
      </span>
    </div>
  );
}

export default function TeamManagementPage() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  // ─── 状态 ──────────────────────────────────────
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [inviteCredits, setInviteCredits] = useState("");
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [showJoinCode, setShowJoinCode] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [showAllocate, setShowAllocate] = useState<number | null>(null);
  const [allocateAmount, setAllocateAmount] = useState("");
  const [showFundPool, setShowFundPool] = useState(false);
  const [fundAmount, setFundAmount] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  // ─── 数据查找 ──────────────────────────────────
  const teamQuery = trpc.team.getMyTeam.useQuery();
  const invitationsQuery = trpc.team.getMyInvitations.useQuery();
  const statsQuery = trpc.team.getTeamStats.useQuery(
    { teamId: teamQuery.data?.team?.id ?? 0 },
    { enabled: !!teamQuery.data?.team && teamQuery.data?.isOwner }
  );
  const logsQuery = trpc.team.getActivityLogs.useQuery(
    { teamId: teamQuery.data?.team?.id ?? 0, limit: 20 },
    { enabled: !!teamQuery.data?.team }
  );

  // ─── Mutations ─────────────────────────────────
  const createTeamMut = trpc.team.createTeam.useMutation({
    onSuccess: () => {
      setShowCreateTeam(false);
      setTeamName("");
      utils.team.getMyTeam.invalidate();
      toast.success("团队创建成功");
    },
    onError: (e) => toast.error(e.message),
  });

  const inviteMemberMut = trpc.team.inviteMember.useMutation({
    onSuccess: (data) => {
      setShowInvite(false);
      setInviteEmail("");
      setInviteCredits("");
      utils.team.getMyTeam.invalidate();
      utils.team.getTeamStats.invalidate();
      toast.success(data.description);
    },
    onError: (e) => toast.error(e.message),
  });

  const joinByCodeMut = trpc.team.joinByCode.useMutation({
    onSuccess: (data) => {
      setShowJoinCode(false);
      setJoinCode("");
      utils.team.getMyTeam.invalidate();
      utils.team.getMyInvitations.invalidate();
      toast.success(`已加入团队「${data.teamName}」`);
    },
    onError: (e) => toast.error(e.message),
  });

  const acceptInviteMut = trpc.team.acceptInvite.useMutation({
    onSuccess: () => {
      utils.team.getMyTeam.invalidate();
      utils.team.getMyInvitations.invalidate();
      toast.success("已接受邀请");
    },
    onError: (e) => toast.error(e.message),
  });

  const declineInviteMut = trpc.team.declineInvite.useMutation({
    onSuccess: () => {
      utils.team.getMyInvitations.invalidate();
      toast.info("已拒绝邀请");
    },
    onError: (e) => toast.error(e.message),
  });

  const allocateCreditsMut = trpc.team.allocateCredits.useMutation({
    onSuccess: () => {
      setShowAllocate(null);
      setAllocateAmount("");
      utils.team.getMyTeam.invalidate();
      utils.team.getTeamStats.invalidate();
      toast.success("Credits 分配成功");
    },
    onError: (e) => toast.error(e.message),
  });

  const fundPoolMut = trpc.team.fundPool.useMutation({
    onSuccess: (data) => {
      setShowFundPool(false);
      setFundAmount("");
      utils.team.getMyTeam.invalidate();
      utils.team.getTeamStats.invalidate();
      toast.success(`团队池已更新为 ${data.newPool} Credits`);
    },
    onError: (e) => toast.error(e.message),
  });

  const removeMemberMut = trpc.team.removeMember.useMutation({
    onSuccess: (data) => {
      utils.team.getMyTeam.invalidate();
      utils.team.getTeamStats.invalidate();
      toast.success(`成员已移除${data.reclaimedCredits > 0 ? `，已回收 ${data.reclaimedCredits} Credits` : ""}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const changeRoleMut = trpc.team.changeMemberRole.useMutation({
    onSuccess: () => {
      utils.team.getMyTeam.invalidate();
      toast.success("成员角色已更新");
    },
    onError: (e) => toast.error(e.message),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      utils.team.getMyTeam.invalidate(),
      utils.team.getMyInvitations.invalidate(),
      utils.team.getTeamStats.invalidate(),
      utils.team.getActivityLogs.invalidate(),
    ]);
    setRefreshing(false);
  }, [utils]);

  const copyInviteCode = async (code: string) => {
    await navigator.clipboard.writeText(code);
    toast.success(`邀请码 ${code} 已拷贝到剪贴板`);
  };

  const team = teamQuery.data;
  const invitations = invitationsQuery.data ?? [];
  const stats = statsQuery.data;
  const logs = logsQuery.data ?? [];
  const isAdmin = team?.myRole === "owner" || team?.myRole === "admin";

  if (teamQuery.isPending) {
    return (
      <div className="min-h-screen bg-[#0A0A0C] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0C] text-[#F7F4EF]">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-gray-800">
          <Button variant="ghost" size="icon" onClick={() => window.history.back()}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-bold">团队管理</h1>
          <div className="w-10" />
        </div>

        {/* Main Content */}
        <div className="py-6 space-y-8">
          {/* 待处理邀请 */}
          {invitations.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold mb-4">待处理邀请</h2>
              <div className="space-y-4">
                {invitations.map((inv) => (
                  <Card key={inv.memberId} className="bg-[#1A1A1C] border-yellow-500/30">
                    <CardContent className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Mail className="h-6 w-6 text-yellow-500" />
                        <div>
                          <p className="font-semibold">{inv.teamName}</p>
                          <p className="text-sm text-gray-400">
                            由 {inv.ownerName ?? "未知"} 邀请 · {inv.allocatedCredits > 0 ? `初始额度 ${inv.allocatedCredits} Credits` : ""}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => acceptInviteMut.mutate({ teamId: inv.teamId })}>
                          接受
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => declineInviteMut.mutate({ teamId: inv.teamId, memberId: inv.memberId })}>
                          拒绝
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {/* 无团队视图 */}
          {!team?.team && (
            <Card className="bg-[#1A1A1C] border-gray-800 text-center">
              <CardContent className="p-8 space-y-4">
                <h3 className="text-xl font-semibold">您尚未加入任何团队</h3>
                <p className="text-gray-400">创建新团队或使用邀请码加入现有团队。</p>
                <div className="flex justify-center gap-4 pt-4">
                  <Button onClick={() => setShowCreateTeam(true)}>创建团队</Button>
                  <Button variant="outline" onClick={() => setShowJoinCode(true)}>使用邀请码加入</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* TODO: Implement Dialog for Create Team and Join Code */}

          {/* 团队视图 */}
          {team?.team && (
            <div className="space-y-8">
              {/* 团队信息 & 统计 */}
              <section>
                <Card className="bg-[#1A1A1C] border-gray-800">
                  <CardHeader>
                    <div className="flex justify-between items-start">
                      <div>
                        <CardTitle className="text-2xl font-bold">{team.team.name}</CardTitle>
                        {team.team.inviteCode && (
                          <div className="flex items-center gap-2 mt-2">
                            <span className="text-sm text-gray-400">邀请码: {team.team.inviteCode}</span>
                            <Button variant="ghost" size="sm" onClick={() => copyInviteCode(team.team.inviteCode!)}>
                              拷贝
                            </Button>
                          </div>
                        )}
                      </div>
                      <RoleBadge role={team.myRole} />
                    </div>
                  </CardHeader>
                  {isAdmin && stats && (
                    <CardContent className="pt-4 space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
                        <div>
                          <p className="text-2xl font-bold">{stats.totalMembers}</p>
                          <p className="text-sm text-gray-400">总成员</p>
                        </div>
                        <div>
                          <p className="text-2xl font-bold">{stats.totalUsed}</p>
                          <p className="text-sm text-gray-400">总消耗 Credits</p>
                        </div>
                        <div>
                          <p className="text-2xl font-bold">{stats.pool}</p>
                          <p className="text-sm text-gray-400">团队池 Credits</p>
                        </div>
                      </div>
                      {/* TODO: Implement Dialog for Fund Pool */}
                      <Button variant="outline" size="sm" onClick={() => setShowFundPool(true)}>管理资金池</Button>
                    </CardContent>
                  )}
                </Card>
              </section>

              {/* 成员列表 */}
              <section>
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-lg font-semibold">成员列表</h2>
                  {isAdmin && (
                    <Button onClick={() => setShowInvite(true)}>
                      <UserPlus className="mr-2 h-4 w-4" />
                      邀请成员
                    </Button>
                  )}
                </div>

                {/* TODO: Implement Dialog for Invite Member */}

                <div className="space-y-4">
                  {team.members.filter(m => m.status !== 'removed').map(member => (
                    <Card key={member.id} className="bg-[#1A1A1C] border-gray-800">
                      <CardContent className="p-4 space-y-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center font-bold text-orange-500">
                              {(member.userName ?? (member.userEmail || "") ?? "?").charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="font-semibold">{member.userName ?? (member.userEmail || "") ?? "未知用户"}</p>
                              {(member.userEmail || "") && <p className="text-sm text-gray-400">{(member.userEmail || "")}</p>}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <RoleBadge role={member.role} />
                            <StatusBadge status={member.status} />
                          </div>
                        </div>

                        {member.status === 'active' && member.allocatedCredits > 0 && (
                          <div className="border-t border-gray-800 pt-4">
                            <p className="text-sm text-gray-400 mb-2">Credits 使用</p>
                            <CreditBar used={member.usedCredits} allocated={member.allocatedCredits} />
                          </div>
                        )}

                        {isAdmin && member.role !== 'owner' && member.status === 'active' && (
                          <div className="border-t border-gray-800 pt-4 flex items-center gap-2">
                            <Button variant="outline" size="sm" onClick={() => setShowAllocate(showAllocate === member.id ? null : member.id)}>
                              <Wallet className="mr-2 h-4 w-4 text-sky-500" />
                              分配
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="sm">操作 <ChevronsUpDown className="ml-2 h-4 w-4" /></Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="bg-[#1A1A1C] border-gray-700 text-white">
                                <DropdownMenuItem onClick={() => changeRoleMut.mutate({ teamId: team.team.id, teamId: team.id, newRole: member.role === 'admin' ? 'member' : 'admin' })}>
                                  <GitCommitHorizontal className="mr-2 h-4 w-4 text-purple-500" />
                                  <span>{member.role === 'admin' ? '降为成员' : '升为管理员'}</span>
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => removeMemberMut.mutate({ teamId: team.team.id, teamId: team.id })} className="text-red-500 focus:bg-red-500/10 focus:text-red-500">
                                  <UserMinus className="mr-2 h-4 w-4" />
                                  <span>移除</span>
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        )}

                        {/* TODO: Implement inline form or dialog for allocation */}
                        {showAllocate === member.id && (
                          <div className="border-t border-gray-800 pt-4 flex gap-2 items-center">
                            <Input 
                              type="number"
                              placeholder="分配数量"
                              value={allocateAmount}
                              onChange={(e) => setAllocateAmount(e.target.value)}
                              className="bg-gray-900 border-gray-700"
                            />
                            <Button 
                              onClick={() => {
                                const amt = parseInt(allocateAmount);
                                if (amt > 0) allocateCreditsMut.mutate({ teamId: team.team.id, teamId: team.id, amount: amt });
                              }}
                              disabled={!allocateAmount || allocateCreditsMut.isPending}
                            >
                              {allocateCreditsMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : '分配'}
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => setShowAllocate(null)}>
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>

              {/* 活动日志 */}
              {logs.length > 0 && (
                <section>
                  <h2 className="text-lg font-semibold mb-4">活动日志</h2>
                  <Card className="bg-[#1A1A1C] border-gray-800">
                    <CardContent className="p-0">
                      <div className="divide-y divide-gray-800">
                        {logs.map(log => (
                          <div key={log.id} className="px-4 py-3 flex justify-between items-center">
                            <p className="text-sm">{log.description}</p>
                            <p className="text-xs text-gray-500">{new Date(log.createdAt).toLocaleString()}</p>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
