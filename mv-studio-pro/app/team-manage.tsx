import { useState, useCallback } from "react";
import {
  ScrollView,
  Text,
  View,
  Pressable,
  TextInput,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Platform,
  Share,
  StyleSheet,
} from "react-native";
import { useRouter } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";

import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";

// ─── 角色标签 ──────────────────────────────────
function RoleBadge({ role, colors }: { role: string; colors: ReturnType<typeof useColors> }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    owner: { bg: "#E8825E33", text: "#E8825E", label: "拥有者" },
    admin: { bg: "#C77DBA33", text: "#C77DBA", label: "管理员" },
    member: { bg: "#64D2FF33", text: "#64D2FF", label: "成员" },
  };
  const c = config[role] ?? config.member;
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text style={[styles.badgeText, { color: c.text }]}>{c.label}</Text>
    </View>
  );
}

// ─── 状态标签 ──────────────────────────────────
function StatusBadge({ status, colors }: { status: string; colors: ReturnType<typeof useColors> }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    active: { bg: "#34C75933", text: "#34C759", label: "已加入" },
    invited: { bg: "#FF9F0A33", text: "#FF9F0A", label: "待接受" },
    suspended: { bg: "#FF453A33", text: "#FF453A", label: "已暂停" },
    removed: { bg: "#9B969133", text: "#9B9691", label: "已移除" },
  };
  const c = config[status] ?? config.active;
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text style={[styles.badgeText, { color: c.text }]}>{c.label}</Text>
    </View>
  );
}

// ─── Credits 进度条 ─────────────────────────────
function CreditBar({ used, allocated }: { used: number; allocated: number }) {
  const pct = allocated > 0 ? Math.min((used / allocated) * 100, 100) : 0;
  const barColor = pct > 80 ? "#FF453A" : pct > 50 ? "#FF9F0A" : "#34C759";
  return (
    <View style={styles.creditBarContainer}>
      <View style={styles.creditBarBg}>
        <View style={[styles.creditBarFill, { width: `${pct}%`, backgroundColor: barColor }]} />
      </View>
      <Text style={styles.creditBarText}>
        {used}/{allocated}
      </Text>
    </View>
  );
}

export default function TeamManageScreen() {
  const colors = useColors();
  const router = useRouter();
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
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (e) => Alert.alert("错误", e.message),
  });

  const inviteMemberMut = trpc.team.inviteMember.useMutation({
    onSuccess: (data) => {
      setShowInvite(false);
      setInviteEmail("");
      setInviteCredits("");
      utils.team.getMyTeam.invalidate();
      utils.team.getTeamStats.invalidate();
      Alert.alert("成功", data.message);
    },
    onError: (e) => Alert.alert("错误", e.message),
  });

  const joinByCodeMut = trpc.team.joinByCode.useMutation({
    onSuccess: (data) => {
      setShowJoinCode(false);
      setJoinCode("");
      utils.team.getMyTeam.invalidate();
      utils.team.getMyInvitations.invalidate();
      Alert.alert("成功", `已加入团队「${data.teamName}」`);
    },
    onError: (e) => Alert.alert("错误", e.message),
  });

  const acceptInviteMut = trpc.team.acceptInvite.useMutation({
    onSuccess: () => {
      utils.team.getMyTeam.invalidate();
      utils.team.getMyInvitations.invalidate();
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (e) => Alert.alert("错误", e.message),
  });

  const declineInviteMut = trpc.team.declineInvite.useMutation({
    onSuccess: () => {
      utils.team.getMyInvitations.invalidate();
    },
  });

  const allocateCreditsMut = trpc.team.allocateCredits.useMutation({
    onSuccess: () => {
      setShowAllocate(null);
      setAllocateAmount("");
      utils.team.getMyTeam.invalidate();
      utils.team.getTeamStats.invalidate();
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (e) => Alert.alert("错误", e.message),
  });

  const fundPoolMut = trpc.team.fundPool.useMutation({
    onSuccess: (data) => {
      setShowFundPool(false);
      setFundAmount("");
      utils.team.getMyTeam.invalidate();
      utils.team.getTeamStats.invalidate();
      Alert.alert("成功", `团队池已更新为 ${data.newPool} Credits`);
    },
    onError: (e) => Alert.alert("错误", e.message),
  });

  const removeMemberMut = trpc.team.removeMember.useMutation({
    onSuccess: (data) => {
      utils.team.getMyTeam.invalidate();
      utils.team.getTeamStats.invalidate();
      Alert.alert("成功", `成员已移除${data.reclaimedCredits > 0 ? `，已回收 ${data.reclaimedCredits} Credits` : ""}`);
    },
    onError: (e) => Alert.alert("错误", e.message),
  });

  const changeRoleMut = trpc.team.changeMemberRole.useMutation({
    onSuccess: () => {
      utils.team.getMyTeam.invalidate();
    },
    onError: (e) => Alert.alert("错误", e.message),
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
    if (Platform.OS === "web") {
      try { await navigator.clipboard.writeText(code); } catch {}
    } else {
      await Clipboard.setStringAsync(code);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    Alert.alert("已拷贝", `邀请码 ${code} 已拷贝到剪贴板`);
  };

  const shareInviteCode = async (code: string, teamName: string) => {
    if (Platform.OS === "web") return;
    try {
      await Share.share({
        message: `邀请您加入 MV Studio Pro 团队「${teamName}」！\n邀请码：${code}\n\n打开 MV Studio Pro App → 团队管理 → 输入邀请码即可加入。`,
      });
    } catch {}
  };

  const team = teamQuery.data;
  const invitations = invitationsQuery.data ?? [];
  const stats = statsQuery.data;
  const logs = logsQuery.data ?? [];
  const isAdmin = team?.myRole === "owner" || team?.myRole === "admin";

  // ─── Loading ───────────────────────────────────
  if (teamQuery.isLoading) {
    return (
      <ScreenContainer className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" color={colors.primary} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}>
            <MaterialIcons name="arrow-back" size={24} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>团队管理</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* 待处理邀请 */}
        {invitations.length > 0 && (
          <View style={[styles.section, { marginHorizontal: 16 }]}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>待处理邀请</Text>
            {invitations.map((inv) => (
              <View key={inv.memberId} style={[styles.card, { backgroundColor: colors.surface, borderColor: "#FF9F0A44" }]}>
                <View style={styles.cardRow}>
                  <MaterialIcons name="mail" size={20} color="#FF9F0A" />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={[styles.cardTitle, { color: colors.foreground }]}>{inv.teamName}</Text>
                    <Text style={[styles.cardSub, { color: colors.muted }]}>
                      由 {inv.ownerName ?? "未知"} 邀请 · {inv.allocatedCredits > 0 ? `初始额度 ${inv.allocatedCredits} Credits` : ""}
                    </Text>
                  </View>
                </View>
                <View style={styles.inviteActions}>
                  <Pressable
                    onPress={() => acceptInviteMut.mutate({ teamId: inv.teamId })}
                    style={({ pressed }) => [styles.acceptBtn, pressed && { opacity: 0.8 }]}
                  >
                    <Text style={styles.acceptBtnText}>接受</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => declineInviteMut.mutate({ teamId: inv.teamId })}
                    style={({ pressed }) => [styles.declineBtn, pressed && { opacity: 0.8 }]}
                  >
                    <Text style={[styles.declineBtnText, { color: colors.muted }]}>拒绝</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* 无团队 → 创建或加入 */}
        {!team?.team && (
          <View style={{ padding: 16 }}>
            <View style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <MaterialIcons name="groups" size={48} color={colors.muted} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>尚未加入任何团队</Text>
              <Text style={[styles.emptySub, { color: colors.muted }]}>
                企业版用户可创建团队并邀请成员，或使用邀请码加入现有团队
              </Text>

              <View style={styles.emptyActions}>
                <Pressable
                  onPress={() => setShowCreateTeam(true)}
                  style={({ pressed }) => [styles.primaryBtn, { backgroundColor: colors.primary }, pressed && { opacity: 0.8, transform: [{ scale: 0.97 }] }]}
                >
                  <MaterialIcons name="add" size={20} color="#fff" />
                  <Text style={styles.primaryBtnText}>创建团队</Text>
                </Pressable>

                <Pressable
                  onPress={() => setShowJoinCode(true)}
                  style={({ pressed }) => [styles.outlineBtn, { borderColor: colors.border }, pressed && { opacity: 0.7 }]}
                >
                  <MaterialIcons name="vpn-key" size={20} color={colors.foreground} />
                  <Text style={[styles.outlineBtnText, { color: colors.foreground }]}>输入邀请码</Text>
                </Pressable>
              </View>
            </View>

            {/* 创建团队表单 */}
            {showCreateTeam && (
              <View style={[styles.formCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.formTitle, { color: colors.foreground }]}>创建团队</Text>
                <TextInput
                  value={teamName}
                  onChangeText={setTeamName}
                  placeholder="输入团队名称"
                  placeholderTextColor={colors.muted}
                  style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                  returnKeyType="done"
                />
                <View style={styles.formActions}>
                  <Pressable
                    onPress={() => setShowCreateTeam(false)}
                    style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.7 }]}
                  >
                    <Text style={[styles.cancelBtnText, { color: colors.muted }]}>取消</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => createTeamMut.mutate({ name: teamName })}
                    disabled={!teamName.trim() || createTeamMut.isPending}
                    style={({ pressed }) => [
                      styles.submitBtn,
                      { backgroundColor: colors.primary },
                      pressed && { opacity: 0.8 },
                      (!teamName.trim() || createTeamMut.isPending) && { opacity: 0.5 },
                    ]}
                  >
                    {createTeamMut.isPending ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.submitBtnText}>创建</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            )}

            {/* 加入团队表单 */}
            {showJoinCode && (
              <View style={[styles.formCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.formTitle, { color: colors.foreground }]}>输入邀请码</Text>
                <TextInput
                  value={joinCode}
                  onChangeText={(t) => setJoinCode(t.toUpperCase())}
                  placeholder="6 位邀请码"
                  placeholderTextColor={colors.muted}
                  maxLength={6}
                  autoCapitalize="characters"
                  style={[styles.input, styles.codeInput, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                  returnKeyType="done"
                />
                <View style={styles.formActions}>
                  <Pressable
                    onPress={() => setShowJoinCode(false)}
                    style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.7 }]}
                  >
                    <Text style={[styles.cancelBtnText, { color: colors.muted }]}>取消</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => joinByCodeMut.mutate({ inviteCode: joinCode })}
                    disabled={joinCode.length !== 6 || joinByCodeMut.isPending}
                    style={({ pressed }) => [
                      styles.submitBtn,
                      { backgroundColor: colors.primary },
                      pressed && { opacity: 0.8 },
                      (joinCode.length !== 6 || joinByCodeMut.isPending) && { opacity: 0.5 },
                    ]}
                  >
                    {joinByCodeMut.isPending ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.submitBtnText}>加入</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        )}

        {/* 有团队 → 团队信息 */}
        {team?.team && (
          <View style={{ padding: 16 }}>
            {/* 团队概览卡片 */}
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.cardRow}>
                <View style={[styles.teamIcon, { backgroundColor: "#E8825E22" }]}>
                  <MaterialIcons name="groups" size={28} color="#E8825E" />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={[styles.teamName, { color: colors.foreground }]}>{team.team.name}</Text>
                  <Text style={[styles.cardSub, { color: colors.muted }]}>
                    {team.members.filter((m) => m.status === "active").length} 位成员 · 上限 {team.team.maxMembers} 人
                  </Text>
                </View>
                <RoleBadge role={team.myRole ?? "member"} colors={colors} />
              </View>

              {/* 邀请码 */}
              {isAdmin && (
                <View style={[styles.inviteCodeBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.inviteCodeLabel, { color: colors.muted }]}>邀请码</Text>
                    <Text style={[styles.inviteCodeText, { color: colors.foreground }]}>{team.team.inviteCode}</Text>
                  </View>
                  <Pressable
                    onPress={() => copyInviteCode(team.team.inviteCode)}
                    style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
                  >
                    <MaterialIcons name="content-copy" size={20} color={colors.primary} />
                  </Pressable>
                  {Platform.OS !== "web" && (
                    <Pressable
                      onPress={() => shareInviteCode(team.team.inviteCode, team.team.name)}
                      style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
                    >
                      <MaterialIcons name="share" size={20} color={colors.primary} />
                    </Pressable>
                  )}
                </View>
              )}
            </View>

            {/* Credits 池概览（管理员） */}
            {isAdmin && stats && (
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, marginTop: 12 }]}>
                <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 12 }]}>Credits 池</Text>
                <View style={styles.statsRow}>
                  <View style={styles.statItem}>
                    <Text style={[styles.statValue, { color: "#E8825E" }]}>{stats.pool.total}</Text>
                    <Text style={[styles.statLabel, { color: colors.muted }]}>总量</Text>
                  </View>
                  <View style={styles.statItem}>
                    <Text style={[styles.statValue, { color: "#C77DBA" }]}>{stats.pool.allocated}</Text>
                    <Text style={[styles.statLabel, { color: colors.muted }]}>已分配</Text>
                  </View>
                  <View style={styles.statItem}>
                    <Text style={[styles.statValue, { color: "#34C759" }]}>{stats.pool.available}</Text>
                    <Text style={[styles.statLabel, { color: colors.muted }]}>可用</Text>
                  </View>
                  <View style={styles.statItem}>
                    <Text style={[styles.statValue, { color: "#64D2FF" }]}>{stats.totalUsed}</Text>
                    <Text style={[styles.statLabel, { color: colors.muted }]}>已消耗</Text>
                  </View>
                </View>

                <Pressable
                  onPress={() => setShowFundPool(true)}
                  style={({ pressed }) => [
                    styles.fundBtn,
                    { borderColor: colors.primary },
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <MaterialIcons name="add-circle-outline" size={18} color={colors.primary} />
                  <Text style={[styles.fundBtnText, { color: colors.primary }]}>从个人帐户充值</Text>
                </Pressable>

                {showFundPool && (
                  <View style={[styles.inlineForm, { borderTopColor: colors.border }]}>
                    <TextInput
                      value={fundAmount}
                      onChangeText={setFundAmount}
                      placeholder="充值数量"
                      placeholderTextColor={colors.muted}
                      keyboardType="number-pad"
                      style={[styles.inlineInput, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                      returnKeyType="done"
                    />
                    <Pressable
                      onPress={() => {
                        const amt = parseInt(fundAmount);
                        if (amt > 0) fundPoolMut.mutate({ teamId: team.team.id, amount: amt });
                      }}
                      disabled={!fundAmount || fundPoolMut.isPending}
                      style={({ pressed }) => [
                        styles.inlineSubmit,
                        { backgroundColor: colors.primary },
                        pressed && { opacity: 0.8 },
                        (!fundAmount || fundPoolMut.isPending) && { opacity: 0.5 },
                      ]}
                    >
                      {fundPoolMut.isPending ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.inlineSubmitText}>确认</Text>
                      )}
                    </Pressable>
                    <Pressable onPress={() => setShowFundPool(false)} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
                      <MaterialIcons name="close" size={20} color={colors.muted} />
                    </Pressable>
                  </View>
                )}
              </View>
            )}

            {/* 成员列表 */}
            <View style={{ marginTop: 16 }}>
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>成员列表</Text>
                {isAdmin && (
                  <Pressable
                    onPress={() => setShowInvite(true)}
                    style={({ pressed }) => [styles.addMemberBtn, { backgroundColor: colors.primary }, pressed && { opacity: 0.8, transform: [{ scale: 0.97 }] }]}
                  >
                    <MaterialIcons name="person-add" size={16} color="#fff" />
                    <Text style={styles.addMemberBtnText}>邀请成员</Text>
                  </Pressable>
                )}
              </View>

              {/* 邀请表单 */}
              {showInvite && (
                <View style={[styles.formCard, { backgroundColor: colors.surface, borderColor: colors.border, marginBottom: 12 }]}>
                  <Text style={[styles.formTitle, { color: colors.foreground }]}>邀请新成员</Text>
                  <TextInput
                    value={inviteEmail}
                    onChangeText={setInviteEmail}
                    placeholder="成员 Email"
                    placeholderTextColor={colors.muted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                  />

                  <Text style={[styles.inputLabel, { color: colors.muted }]}>角色</Text>
                  <View style={styles.roleSelector}>
                    {(["member", "admin"] as const).map((r) => (
                      <Pressable
                        key={r}
                        onPress={() => setInviteRole(r)}
                        style={({ pressed }) => [
                          styles.roleOption,
                          { borderColor: inviteRole === r ? colors.primary : colors.border },
                          inviteRole === r && { backgroundColor: "#E8825E22" },
                          pressed && { opacity: 0.8 },
                        ]}
                      >
                        <Text style={{ color: inviteRole === r ? colors.primary : colors.foreground, fontSize: 14 }}>
                          {r === "admin" ? "管理员" : "成员"}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  <Text style={[styles.inputLabel, { color: colors.muted }]}>初始 Credits 分配（可选）</Text>
                  <TextInput
                    value={inviteCredits}
                    onChangeText={setInviteCredits}
                    placeholder="0"
                    placeholderTextColor={colors.muted}
                    keyboardType="number-pad"
                    style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                    returnKeyType="done"
                  />

                  <View style={styles.formActions}>
                    <Pressable
                      onPress={() => setShowInvite(false)}
                      style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.7 }]}
                    >
                      <Text style={[styles.cancelBtnText, { color: colors.muted }]}>取消</Text>
                    </Pressable>
                    <Pressable
                      onPress={() =>
                        inviteMemberMut.mutate({
                          teamId: team.team.id,
                          email: inviteEmail,
                          role: inviteRole,
                          initialCredits: parseInt(inviteCredits) || 0,
                        })
                      }
                      disabled={!inviteEmail.includes("@") || inviteMemberMut.isPending}
                      style={({ pressed }) => [
                        styles.submitBtn,
                        { backgroundColor: colors.primary },
                        pressed && { opacity: 0.8 },
                        (!inviteEmail.includes("@") || inviteMemberMut.isPending) && { opacity: 0.5 },
                      ]}
                    >
                      {inviteMemberMut.isPending ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.submitBtnText}>发送邀请</Text>
                      )}
                    </Pressable>
                  </View>
                </View>
              )}

              {/* 成员卡片 */}
              {team.members
                .filter((m) => m.status !== "removed")
                .map((member) => (
                  <View key={member.id} style={[styles.memberCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <View style={styles.memberHeader}>
                      <View style={[styles.avatar, { backgroundColor: "#E8825E22" }]}>
                        <Text style={{ color: "#E8825E", fontWeight: "700", fontSize: 16 }}>
                          {(member.userName ?? member.userEmail ?? "?").charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={[styles.memberName, { color: colors.foreground }]}>
                          {member.userName ?? member.userEmail ?? "未知用户"}
                        </Text>
                        {member.userEmail && (
                          <Text style={[styles.memberEmail, { color: colors.muted }]}>{member.userEmail}</Text>
                        )}
                      </View>
                      <View style={{ flexDirection: "row", gap: 6 }}>
                        <RoleBadge role={member.role} colors={colors} />
                        <StatusBadge status={member.status} colors={colors} />
                      </View>
                    </View>

                    {/* Credits 使用情况 */}
                    {member.status === "active" && member.allocatedCredits > 0 && (
                      <View style={[styles.memberCredits, { borderTopColor: colors.border }]}>
                        <Text style={[styles.creditsLabel, { color: colors.muted }]}>Credits 使用</Text>
                        <CreditBar used={member.usedCredits} allocated={member.allocatedCredits} />
                      </View>
                    )}

                    {/* 管理操作 */}
                    {isAdmin && member.role !== "owner" && member.status === "active" && (
                      <View style={[styles.memberActions, { borderTopColor: colors.border }]}>
                        <Pressable
                          onPress={() => setShowAllocate(showAllocate === member.id ? null : member.id)}
                          style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.7 }]}
                        >
                          <MaterialIcons name="account-balance-wallet" size={16} color="#64D2FF" />
                          <Text style={{ color: "#64D2FF", fontSize: 12, marginLeft: 4 }}>分配</Text>
                        </Pressable>

                        <Pressable
                          onPress={() =>
                            changeRoleMut.mutate({
                              teamId: team.team.id,
                              memberId: member.id,
                              newRole: member.role === "admin" ? "member" : "admin",
                            })
                          }
                          style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.7 }]}
                        >
                          <MaterialIcons name="swap-horiz" size={16} color="#C77DBA" />
                          <Text style={{ color: "#C77DBA", fontSize: 12, marginLeft: 4 }}>
                            {member.role === "admin" ? "降为成员" : "升为管理员"}
                          </Text>
                        </Pressable>

                        <Pressable
                          onPress={() =>
                            Alert.alert("确认移除", `确定要移除 ${member.userName ?? member.userEmail} 吗？`, [
                              { text: "取消", style: "cancel" },
                              {
                                text: "移除",
                                style: "destructive",
                                onPress: () => removeMemberMut.mutate({ teamId: team.team.id, memberId: member.id }),
                              },
                            ])
                          }
                          style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.7 }]}
                        >
                          <MaterialIcons name="person-remove" size={16} color="#FF453A" />
                          <Text style={{ color: "#FF453A", fontSize: 12, marginLeft: 4 }}>移除</Text>
                        </Pressable>
                      </View>
                    )}

                    {/* 分配 Credits 内联表单 */}
                    {showAllocate === member.id && (
                      <View style={[styles.inlineForm, { borderTopColor: colors.border }]}>
                        <TextInput
                          value={allocateAmount}
                          onChangeText={setAllocateAmount}
                          placeholder="分配数量"
                          placeholderTextColor={colors.muted}
                          keyboardType="number-pad"
                          style={[styles.inlineInput, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                          returnKeyType="done"
                        />
                        <Pressable
                          onPress={() => {
                            const amt = parseInt(allocateAmount);
                            if (amt > 0) allocateCreditsMut.mutate({ teamId: team.team.id, memberId: member.id, amount: amt });
                          }}
                          disabled={!allocateAmount || allocateCreditsMut.isPending}
                          style={({ pressed }) => [
                            styles.inlineSubmit,
                            { backgroundColor: colors.primary },
                            pressed && { opacity: 0.8 },
                            (!allocateAmount || allocateCreditsMut.isPending) && { opacity: 0.5 },
                          ]}
                        >
                          {allocateCreditsMut.isPending ? (
                            <ActivityIndicator size="small" color="#fff" />
                          ) : (
                            <Text style={styles.inlineSubmitText}>分配</Text>
                          )}
                        </Pressable>
                        <Pressable onPress={() => setShowAllocate(null)} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
                          <MaterialIcons name="close" size={20} color={colors.muted} />
                        </Pressable>
                      </View>
                    )}
                  </View>
                ))}
            </View>

            {/* 活动日志 */}
            {logs.length > 0 && (
              <View style={{ marginTop: 16 }}>
                <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 8 }]}>活动日志</Text>
                {logs.map((log) => (
                  <View key={log.id} style={[styles.logItem, { borderBottomColor: colors.border }]}>
                    <MaterialIcons
                      name={
                        log.action.includes("credit") ? "account-balance-wallet" :
                        log.action.includes("member") || log.action.includes("joined") ? "person" :
                        log.action.includes("role") ? "swap-horiz" :
                        "event"
                      }
                      size={16}
                      color={colors.muted}
                    />
                    <View style={{ flex: 1, marginLeft: 8 }}>
                      <Text style={[styles.logText, { color: colors.foreground }]}>{log.description}</Text>
                      <Text style={[styles.logMeta, { color: colors.muted }]}>
                        {log.userName ?? "系统"} · {log.createdAt ? new Date(log.createdAt).toLocaleDateString("zh-TW") : ""}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 0.5 },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: "700", textAlign: "center" },

  section: { marginTop: 16 },
  sectionTitle: { fontSize: 16, fontWeight: "700", marginBottom: 8 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },

  card: { borderRadius: 14, padding: 16, borderWidth: 1, marginBottom: 8 },
  cardRow: { flexDirection: "row", alignItems: "center" },
  cardTitle: { fontSize: 15, fontWeight: "600" },
  cardSub: { fontSize: 13, marginTop: 2 },

  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: "600" },

  teamIcon: { width: 48, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  teamName: { fontSize: 18, fontWeight: "700" },

  inviteCodeBox: { flexDirection: "row", alignItems: "center", marginTop: 12, padding: 12, borderRadius: 10, borderWidth: 1 },
  inviteCodeLabel: { fontSize: 11 },
  inviteCodeText: { fontSize: 20, fontWeight: "700", letterSpacing: 4, marginTop: 2 },
  iconBtn: { padding: 8 },

  statsRow: { flexDirection: "row", justifyContent: "space-between" },
  statItem: { alignItems: "center", flex: 1 },
  statValue: { fontSize: 22, fontWeight: "800" },
  statLabel: { fontSize: 11, marginTop: 2 },

  fundBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  fundBtnText: { fontSize: 14, fontWeight: "600", marginLeft: 6 },

  emptyCard: { alignItems: "center", padding: 32, borderRadius: 16, borderWidth: 1 },
  emptyTitle: { fontSize: 18, fontWeight: "700", marginTop: 16 },
  emptySub: { fontSize: 14, textAlign: "center", marginTop: 8, lineHeight: 20 },
  emptyActions: { flexDirection: "row", gap: 12, marginTop: 24 },

  primaryBtn: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10, gap: 6 },
  primaryBtnText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  outlineBtn: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10, borderWidth: 1, gap: 6 },
  outlineBtnText: { fontSize: 15, fontWeight: "600" },

  formCard: { padding: 16, borderRadius: 14, borderWidth: 1, marginTop: 12 },
  formTitle: { fontSize: 16, fontWeight: "700", marginBottom: 12 },
  input: { paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10, borderWidth: 1, fontSize: 15, marginBottom: 10 },
  codeInput: { textAlign: "center", fontSize: 24, letterSpacing: 8, fontWeight: "700" },
  inputLabel: { fontSize: 13, marginBottom: 6, marginTop: 4 },
  formActions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 8 },
  cancelBtn: { paddingHorizontal: 16, paddingVertical: 10 },
  cancelBtnText: { fontSize: 15 },
  submitBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, minWidth: 80, alignItems: "center" },
  submitBtnText: { color: "#fff", fontSize: 15, fontWeight: "600" },

  roleSelector: { flexDirection: "row", gap: 10, marginBottom: 10 },
  roleOption: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 10, borderWidth: 1 },

  addMemberBtn: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, gap: 4 },
  addMemberBtnText: { color: "#fff", fontSize: 13, fontWeight: "600" },

  memberCard: { borderRadius: 14, borderWidth: 1, marginBottom: 8, overflow: "hidden" },
  memberHeader: { flexDirection: "row", alignItems: "center", padding: 14 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  memberName: { fontSize: 15, fontWeight: "600" },
  memberEmail: { fontSize: 12, marginTop: 1 },

  memberCredits: { paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 0.5 },
  creditsLabel: { fontSize: 12, marginBottom: 6 },
  creditBarContainer: { flexDirection: "row", alignItems: "center", gap: 8 },
  creditBarBg: { flex: 1, height: 6, backgroundColor: "#2A2A2E", borderRadius: 3, overflow: "hidden" },
  creditBarFill: { height: 6, borderRadius: 3 },
  creditBarText: { fontSize: 12, color: "#9B9691", minWidth: 60, textAlign: "right" },

  memberActions: { flexDirection: "row", paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: 0.5, gap: 16 },
  actionBtn: { flexDirection: "row", alignItems: "center", paddingVertical: 4 },

  inlineForm: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 0.5 },
  inlineInput: { flex: 1, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, fontSize: 14 },
  inlineSubmit: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  inlineSubmitText: { color: "#fff", fontSize: 14, fontWeight: "600" },

  inviteActions: { flexDirection: "row", gap: 10, marginTop: 12, justifyContent: "flex-end" },
  acceptBtn: { backgroundColor: "#34C759", paddingHorizontal: 20, paddingVertical: 8, borderRadius: 8 },
  acceptBtnText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  declineBtn: { paddingHorizontal: 16, paddingVertical: 8 },
  declineBtnText: { fontSize: 14 },

  logItem: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 10, borderBottomWidth: 0.5 },
  logText: { fontSize: 13 },
  logMeta: { fontSize: 11, marginTop: 2 },
});
