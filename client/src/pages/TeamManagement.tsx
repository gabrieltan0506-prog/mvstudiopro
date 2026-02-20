import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useState } from "react";
import { Users, UserPlus, Copy, Crown, Shield, User, Loader2, Trash2 } from "lucide-react";

export default function TeamManagement() {
  const { user, isAuthenticated } = useAuth();
  const [teamName, setTeamName] = useState("");
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const { data: myTeam, refetch: refetchTeam } = trpc.team.myTeam.useQuery(undefined, { enabled: isAuthenticated });
  const { data: members, refetch: refetchMembers } = trpc.team.members.useQuery(
    { teamId: myTeam?.id ?? 0 },
    { enabled: !!myTeam?.id }
  );

  const createTeamMutation = trpc.team.create.useMutation({
    onSuccess: () => { toast.success("团队创建成功！"); refetchTeam(); setCreateDialogOpen(false); },
    onError: (e) => toast.error(e.message || "创建失败"),
  });

  const removeMemberMutation = trpc.team.removeMember.useMutation({
    onSuccess: () => { toast.success("成员已移除"); refetchMembers(); },
    onError: () => toast.error("操作失败"),
  });

  const roleIcons: Record<string, React.ReactNode> = {
    owner: <Crown className="h-4 w-4 text-yellow-400" />,
    admin: <Shield className="h-4 w-4 text-blue-400" />,
    member: <User className="h-4 w-4 text-muted-foreground" />,
  };

  const roleLabels: Record<string, string> = {
    owner: "创建者",
    admin: "管理员",
    member: "成员",
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Navbar />
        <div className="pt-32 text-center container">
          <Users className="h-16 w-16 text-primary mx-auto mb-6" />
          <h1 className="text-3xl font-bold mb-4">团队管理</h1>
          <p className="text-muted-foreground mb-8 max-w-lg mx-auto">创建团队、邀请成员、分配角色、统计使用量</p>
          <Button size="lg" className="bg-primary text-primary-foreground" onClick={() => { window.location.href = getLoginUrl(); }}>登录后使用</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <div className="pt-24 pb-16 container max-w-4xl">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold mb-2">团队管理</h1>
            <p className="text-muted-foreground">管理你的团队成员和权限</p>
          </div>
          {!myTeam && (
            <Button className="bg-primary text-primary-foreground gap-2" onClick={() => setCreateDialogOpen(true)}>
              <UserPlus className="h-4 w-4" /> 创建团队
            </Button>
          )}
        </div>

        {!myTeam ? (
          <Card className="bg-card/50 border-border/50">
            <CardContent className="p-12 text-center">
              <Users className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">还没有团队</h3>
              <p className="text-muted-foreground mb-6">创建一个团队，邀请成员一起协作</p>
              <Button className="bg-primary text-primary-foreground gap-2" onClick={() => setCreateDialogOpen(true)}>
                <UserPlus className="h-4 w-4" /> 创建团队
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Team Info */}
            <Card className="bg-card/50 border-border/50">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>{myTeam.name}</CardTitle>
                <Button variant="outline" size="sm" className="bg-transparent gap-1" onClick={() => setInviteDialogOpen(true)}>
                  <UserPlus className="h-4 w-4" /> 邀请成员
                </Button>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold">{members?.length ?? 0}</div>
                    <div className="text-xs text-muted-foreground">成员数</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-primary">{myTeam.inviteCode}</div>
                    <div className="text-xs text-muted-foreground">邀请码</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold">{new Date(myTeam.createdAt).toLocaleDateString("zh-CN")}</div>
                    <div className="text-xs text-muted-foreground">创建日期</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Members List */}
            <Card className="bg-card/50 border-border/50">
              <CardHeader><CardTitle className="text-base">团队成员</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {(members || []).map((m: any) => (
                    <div key={m.id} className="flex items-center justify-between p-3 rounded-lg bg-background/30">
                      <div className="flex items-center gap-3">
                        {roleIcons[m.role] || roleIcons.member}
                        <div>
                          <div className="text-sm font-medium">{m.userName || "未命名用户"}</div>
                          <div className="text-xs text-muted-foreground">{roleLabels[m.role] || "成员"}</div>
                        </div>
                      </div>
                      {m.role !== "owner" && m.userId !== user?.id && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-400 hover:text-red-300"
                          onClick={() => removeMemberMutation.mutate({ memberId: m.id })}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Create Team Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader><DialogTitle>创建团队</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <Input placeholder="团队名称" value={teamName} onChange={e => setTeamName(e.target.value)} className="bg-background/50" />
            <Button
              className="w-full bg-primary text-primary-foreground"
              disabled={!teamName.trim() || createTeamMutation.isPending}
              onClick={() => createTeamMutation.mutate({ name: teamName.trim() })}
            >
              {createTeamMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              创建团队
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Invite Dialog */}
      <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader><DialogTitle>邀请成员</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">分享以下邀请码给你的团队成员</p>
            <div className="flex gap-2">
              <Input value={myTeam?.inviteCode || ""} readOnly className="bg-background/50 font-mono" />
              <Button variant="outline" className="bg-transparent shrink-0" onClick={() => {
                navigator.clipboard.writeText(myTeam?.inviteCode || "");
                toast.success("邀请码已复制");
              }}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
