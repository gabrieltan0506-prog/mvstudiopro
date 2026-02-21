/**
 * AI 客服助手聊天浮窗
 * 
 * 功能：
 * - 右下角浮動按鈕，點擊展開聊天面板
 * - AI 自動回答（Gemini Flash）
 * - 「轉人工客服」按鈕（Email 通知管理員）
 * - 歡迎語 + 快捷問題
 * - 深色主題，與 MV Studio Pro 風格一致
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  Easing,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { trpc } from "@/lib/trpc";
import { useRouter } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

// ─── 類型 ─────────────────────────────────────────────────
interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

// ─── 常量 ─────────────────────────────────────────────────
const QUICK_QUESTIONS = [
  "平台有哪些功能？",
  "Credits 怎么充值？",
  "如何生成虚拟偶像？",
  "视频生成要多少 Credits？",
  "有学生优惠吗？",
];

const WELCOME_MESSAGE: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content: "你好！我是小M，MV Studio Pro 的 AI 客服助手 👋\n\n有什么可以帮到你的吗？你可以直接输入问题，或点击下方快捷按钮。",
  timestamp: Date.now(),
};

// ─── 生成唯一 Session ID ──────────────────────────────────
function generateSessionId(): string {
  return `cs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── 主組件 ───────────────────────────────────────────────
export function CustomerServiceChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showEscalateForm, setShowEscalateForm] = useState(false);
  const [escalateEmail, setEscalateEmail] = useState("");
  const [escalateName, setEscalateName] = useState("");
  const [escalateReason, setEscalateReason] = useState("");
  const [sessionId] = useState(generateSessionId);
  const [hasUnread, setHasUnread] = useState(false);

  const flatListRef = useRef<FlatList>(null);
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // 動畫
  const fabScale = useSharedValue(1);
  const badgeScale = useSharedValue(0);

  // tRPC mutations
  const sendMessageMutation = trpc.customerService.sendMessage.useMutation();
  const escalateMutation = trpc.customerService.escalate.useMutation();

  // 未讀消息動畫
  useEffect(() => {
    badgeScale.value = hasUnread ? withSpring(1, { damping: 12 }) : withTiming(0, { duration: 150 });
  }, [hasUnread, badgeScale]);

  const badgeStyle = useAnimatedStyle(() => ({
    transform: [{ scale: badgeScale.value }],
  }));

  // 滾動到底部
  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, []);

  // 發送消息
  const handleSend = useCallback(async (text?: string) => {
    const messageText = (text || inputText).trim();
    if (!messageText || isLoading) return;

    setInputText("");

    const userMsg: ChatMessage = {
      id: `user_${Date.now()}`,
      role: "user",
      content: messageText,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);
    scrollToBottom();
    setIsLoading(true);

    try {
      const result = await sendMessageMutation.mutateAsync({
        sessionId,
        message: messageText,
      });

      const aiMsg: ChatMessage = {
        id: `ai_${Date.now()}`,
        role: "assistant",
        content: result.response,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, aiMsg]);

      // 如果建議轉人工，追加提示
      if (result.suggestEscalation) {
        const hintMsg: ChatMessage = {
          id: `hint_${Date.now()}`,
          role: "system",
          content: "如果以上回答未能解决您的问题，可以点击下方「转人工客服」按钮，我们会尽快通过邮件联系您。",
          timestamp: Date.now(),
        };
        setMessages(prev => [...prev, hintMsg]);
      }

      if (!isOpen) setHasUnread(true);
    } catch (error) {
      const errorMsg: ChatMessage = {
        id: `error_${Date.now()}`,
        role: "assistant",
        content: "抱歉，网络出现问题，请稍后再试。",
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
      scrollToBottom();
    }
  }, [inputText, isLoading, sessionId, sendMessageMutation, scrollToBottom, isOpen]);

  // 轉人工
  const handleEscalate = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await escalateMutation.mutateAsync({
        sessionId,
        userName: escalateName || undefined,
        userEmail: escalateEmail || undefined,
        reason: escalateReason || undefined,
      });

      const systemMsg: ChatMessage = {
        id: `escalate_${Date.now()}`,
        role: "system",
        content: result.success
          ? "✅ " + result.message
          : "⚠️ " + result.message,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, systemMsg]);
      setShowEscalateForm(false);
      setEscalateEmail("");
      setEscalateName("");
      setEscalateReason("");
    } catch {
      const errorMsg: ChatMessage = {
        id: `error_${Date.now()}`,
        role: "system",
        content: "⚠️ 通知发送失败，请直接发送邮件至 support@mvstudiopro.com",
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
      scrollToBottom();
    }
  }, [sessionId, escalateName, escalateEmail, escalateReason, escalateMutation, scrollToBottom]);

  // 打開聊天
  const handleOpen = useCallback(() => {
    setIsOpen(true);
    setHasUnread(false);
  }, []);

  // 關閉聊天
  const handleClose = useCallback(() => {
    setIsOpen(false);
    setShowEscalateForm(false);
  }, []);

  // FAB 按壓反饋
  const handleFabPressIn = useCallback(() => {
    fabScale.value = withTiming(0.9, { duration: 80 });
  }, [fabScale]);
  const handleFabPressOut = useCallback(() => {
    fabScale.value = withTiming(1, { duration: 120 });
  }, [fabScale]);

  const fabAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: fabScale.value }],
  }));

  // 渲染消息
  const renderMessage = useCallback(({ item }: { item: ChatMessage }) => {
    if (item.role === "system") {
      return (
        <View style={styles.systemMsgContainer}>
          <View style={styles.systemMsgBubble}>
            <Text style={styles.systemMsgText}>{item.content}</Text>
          </View>
        </View>
      );
    }

    const isUser = item.role === "user";
    return (
      <View style={[styles.msgRow, isUser ? styles.msgRowUser : styles.msgRowAi]}>
        {!isUser && (
          <View style={styles.avatarAi}>
            <MaterialIcons name="headset" size={16} color="#FF8C42" />
          </View>
        )}
        <View style={[styles.msgBubble, isUser ? styles.msgBubbleUser : styles.msgBubbleAi]}>
          <Text style={[styles.msgText, isUser ? styles.msgTextUser : styles.msgTextAi]}>
            {item.content}
          </Text>
        </View>
      </View>
    );
  }, []);

  const keyExtractor = useCallback((item: ChatMessage) => item.id, []);

  const quickQuestionButtons = useMemo(() => (
    <View style={styles.quickQuestionsContainer}>
      <Text style={styles.quickQuestionsLabel}>常见问题</Text>
      <View style={styles.quickQuestionsWrap}>
        {QUICK_QUESTIONS.map((q) => (
          <Pressable
            key={q}
            style={({ pressed }) => [
              styles.quickQuestionBtn,
              pressed && { opacity: 0.7 },
            ]}
            onPress={() => handleSend(q)}
          >
            <Text style={styles.quickQuestionText}>{q}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  ), [handleSend]);

  // ─── FAB 浮動按鈕 ──────────────────────────────────────
  const fab = (
    <Animated.View style={[styles.fabContainer, { bottom: insets.bottom + 80 }, fabAnimatedStyle]}>
      <Pressable
        onPress={handleOpen}
        onPressIn={handleFabPressIn}
        onPressOut={handleFabPressOut}
        style={styles.fab}
      >
        <MaterialIcons name="headset" size={26} color="#FFFFFF" />
        {/* 未讀紅點 */}
        <Animated.View style={[styles.unreadBadge, badgeStyle]}>
          <View style={styles.unreadDot} />
        </Animated.View>
      </Pressable>
    </Animated.View>
  );

  // ─── 聊天面板 ──────────────────────────────────────────
  const chatPanel = (
    <Modal
      visible={isOpen}
      animationType="slide"
      transparent={Platform.OS !== "web"}
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : undefined}
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.modalContainer}
      >
        <View style={[styles.chatPanel, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          {/* Header */}
          <View style={[styles.chatHeader, { paddingTop: Math.max(insets.top, 12) }]}>
            <View style={styles.chatHeaderLeft}>
              <View style={styles.headerAvatar}>
                <MaterialIcons name="headset" size={20} color="#FF8C42" />
              </View>
              <View>
                <Text style={styles.chatHeaderTitle}>小M · AI 客服</Text>
                <Text style={styles.chatHeaderSubtitle}>通常即时回复</Text>
              </View>
            </View>
            <Pressable
              onPress={handleClose}
              style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.6 }]}
            >
              <MaterialIcons name="close" size={24} color="#9B9691" />
            </Pressable>
          </View>

          {/* Messages */}
          <FlatList
            ref={flatListRef}
            data={messages}
            renderItem={renderMessage}
            keyExtractor={keyExtractor}
            contentContainerStyle={styles.messagesList}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={scrollToBottom}
            ListFooterComponent={
              <>
                {isLoading && (
                  <View style={styles.typingIndicator}>
                    <View style={styles.avatarAi}>
                      <MaterialIcons name="headset" size={16} color="#FF8C42" />
                    </View>
                    <View style={styles.typingBubble}>
                      <ActivityIndicator size="small" color="#FF8C42" />
                      <Text style={styles.typingText}>正在输入...</Text>
                    </View>
                  </View>
                )}
                {/* 只在初始歡迎消息後顯示快捷問題 */}
                {messages.length <= 1 && !isLoading && quickQuestionButtons}
              </>
            }
          />

          {/* 轉人工表單 */}
          {showEscalateForm && (
            <View style={styles.escalateForm}>
              <Text style={styles.escalateTitle}>转人工客服</Text>
              <Text style={styles.escalateDesc}>
                请留下联系方式，我们会尽快通过邮件联系您
              </Text>
              <TextInput
                style={styles.escalateInput}
                placeholder="您的称呼（选填）"
                placeholderTextColor="#666"
                value={escalateName}
                onChangeText={setEscalateName}
              />
              <TextInput
                style={styles.escalateInput}
                placeholder="邮箱地址（选填）"
                placeholderTextColor="#666"
                value={escalateEmail}
                onChangeText={setEscalateEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <TextInput
                style={[styles.escalateInput, styles.escalateReasonInput]}
                placeholder="问题描述（选填）"
                placeholderTextColor="#666"
                value={escalateReason}
                onChangeText={setEscalateReason}
                multiline
                numberOfLines={3}
              />
              <View style={styles.escalateBtnRow}>
                <Pressable
                  style={({ pressed }) => [styles.escalateCancelBtn, pressed && { opacity: 0.7 }]}
                  onPress={() => setShowEscalateForm(false)}
                >
                  <Text style={styles.escalateCancelText}>取消</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.escalateSubmitBtn, pressed && { opacity: 0.8 }]}
                  onPress={handleEscalate}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <ActivityIndicator size="small" color="#FFF" />
                  ) : (
                    <Text style={styles.escalateSubmitText}>提交</Text>
                  )}
                </Pressable>
              </View>
            </View>
          )}

          {/* Input Bar */}
          {!showEscalateForm && (
            <View style={styles.inputBar}>
              <Pressable
                style={({ pressed }) => [styles.escalateBtn, pressed && { opacity: 0.7 }]}
                onPress={() => setShowEscalateForm(true)}
              >
                <MaterialIcons name="headset-mic" size={18} color="#FF8C42" />
                <Text style={styles.escalateBtnText}>人工</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.contactBtn, pressed && { opacity: 0.7 }]}
                onPress={() => {
                  setIsOpen(false);
                  router.push("/contact" as any);
                }}
              >
                <MaterialIcons name="mail-outline" size={18} color="#6CB4EE" />
                <Text style={styles.contactBtnText}>联络</Text>
              </Pressable>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.textInput}
                  placeholder="输入您的问题..."
                  placeholderTextColor="#666"
                  value={inputText}
                  onChangeText={setInputText}
                  onSubmitEditing={() => handleSend()}
                  returnKeyType="send"
                  multiline={false}
                  editable={!isLoading}
                />
              </View>
              <Pressable
                style={({ pressed }) => [
                  styles.sendBtn,
                  (!inputText.trim() || isLoading) && styles.sendBtnDisabled,
                  pressed && inputText.trim() && { opacity: 0.8 },
                ]}
                onPress={() => handleSend()}
                disabled={!inputText.trim() || isLoading}
              >
                <MaterialIcons
                  name="send"
                  size={20}
                  color={inputText.trim() && !isLoading ? "#FFFFFF" : "#555"}
                />
              </Pressable>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );

  return (
    <>
      {!isOpen && fab}
      {chatPanel}
    </>
  );
}

// ─── 樣式 ─────────────────────────────────────────────────
const { width: SCREEN_WIDTH } = Dimensions.get("window");
const CHAT_MAX_WIDTH = Math.min(SCREEN_WIDTH, 420);

const styles = StyleSheet.create({
  // FAB
  fabContainer: {
    position: "absolute",
    right: 16,
    zIndex: 9999,
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#FF8C42",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#FF8C42",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  unreadBadge: {
    position: "absolute",
    top: 2,
    right: 2,
  },
  unreadDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#FF453A",
    borderWidth: 2,
    borderColor: "#101012",
  },

  // Modal
  modalContainer: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.5)",
  },

  // Chat Panel
  chatPanel: {
    backgroundColor: "#101012",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "92%",
    minHeight: "70%",
    flex: 1,
    overflow: "hidden",
  },

  // Header
  chatHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: "#2A2A2E",
    backgroundColor: "#151517",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  chatHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(232,130,94,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  chatHeaderTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#F7F4EF",
  },
  chatHeaderSubtitle: {
    fontSize: 12,
    color: "#9B9691",
    marginTop: 1,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },

  // Messages
  messagesList: {
    paddingHorizontal: 12,
    paddingVertical: 16,
    gap: 12,
  },
  msgRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    maxWidth: "88%",
  },
  msgRowUser: {
    alignSelf: "flex-end",
  },
  msgRowAi: {
    alignSelf: "flex-start",
  },
  avatarAi: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(232,130,94,0.12)",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  msgBubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    maxWidth: "100%",
  },
  msgBubbleUser: {
    backgroundColor: "#FF8C42",
    borderBottomRightRadius: 4,
  },
  msgBubbleAi: {
    backgroundColor: "#1E1E22",
    borderBottomLeftRadius: 4,
  },
  msgText: {
    fontSize: 14,
    lineHeight: 20,
  },
  msgTextUser: {
    color: "#FFFFFF",
  },
  msgTextAi: {
    color: "#F7F4EF",
  },

  // System message
  systemMsgContainer: {
    alignItems: "center",
    paddingVertical: 4,
  },
  systemMsgBubble: {
    backgroundColor: "rgba(232,130,94,0.1)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxWidth: "90%",
    borderWidth: 0.5,
    borderColor: "rgba(232,130,94,0.2)",
  },
  systemMsgText: {
    fontSize: 13,
    color: "#FF8C42",
    textAlign: "center",
    lineHeight: 18,
  },

  // Typing indicator
  typingIndicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 4,
  },
  typingBubble: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#1E1E22",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  typingText: {
    fontSize: 13,
    color: "#9B9691",
  },

  // Quick questions
  quickQuestionsContainer: {
    paddingTop: 12,
    gap: 8,
  },
  quickQuestionsLabel: {
    fontSize: 13,
    color: "#9B9691",
    paddingLeft: 4,
  },
  quickQuestionsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  quickQuestionBtn: {
    backgroundColor: "rgba(232,130,94,0.1)",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 0.5,
    borderColor: "rgba(232,130,94,0.25)",
  },
  quickQuestionText: {
    fontSize: 13,
    color: "#FF8C42",
  },

  // Input bar
  inputBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 0.5,
    borderTopColor: "#2A2A2E",
    backgroundColor: "#151517",
  },
  escalateBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "rgba(232,130,94,0.1)",
    borderWidth: 0.5,
    borderColor: "rgba(232,130,94,0.25)",
  },
  escalateBtnText: {
    fontSize: 12,
    color: "#FF8C42",
    fontWeight: "600",
  },
  contactBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "rgba(108,180,238,0.1)",
    borderWidth: 0.5,
    borderColor: "rgba(108,180,238,0.25)",
  },
  contactBtnText: {
    fontSize: 12,
    color: "#6CB4EE",
    fontWeight: "600",
  },
  inputWrapper: {
    flex: 1,
    backgroundColor: "#1E1E22",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 0,
    justifyContent: "center",
  },
  textInput: {
    fontSize: 14,
    color: "#F7F4EF",
    height: 38,
    paddingVertical: 0,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#FF8C42",
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: {
    backgroundColor: "#2A2A2E",
  },

  // Escalate form
  escalateForm: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderTopWidth: 0.5,
    borderTopColor: "#2A2A2E",
    backgroundColor: "#151517",
    gap: 10,
  },
  escalateTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#F7F4EF",
  },
  escalateDesc: {
    fontSize: 13,
    color: "#9B9691",
    lineHeight: 18,
  },
  escalateInput: {
    backgroundColor: "#1E1E22",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: "#F7F4EF",
    borderWidth: 0.5,
    borderColor: "#2A2A2E",
  },
  escalateReasonInput: {
    height: 70,
    textAlignVertical: "top",
  },
  escalateBtnRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  escalateCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "#2A2A2E",
    alignItems: "center",
  },
  escalateCancelText: {
    fontSize: 14,
    color: "#9B9691",
    fontWeight: "600",
  },
  escalateSubmitBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "#FF8C42",
    alignItems: "center",
  },
  escalateSubmitText: {
    fontSize: 14,
    color: "#FFFFFF",
    fontWeight: "600",
  },
});
