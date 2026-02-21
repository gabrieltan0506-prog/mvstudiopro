/**
 * 聯絡我們頁面
 * 
 * 用戶可填寫姓名、郵箱、主題、內容，提交後通過 notifyOwner 通知管理員。
 * 從客服浮窗「聯絡我們」按鈕跳轉而來。
 */

import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScreenContainer } from "@/components/screen-container";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { trpc } from "@/lib/trpc";

type SubjectOption = {
  label: string;
  value: string;
};

const SUBJECT_OPTIONS: SubjectOption[] = [
  { label: "功能咨询", value: "功能咨询" },
  { label: "充值 / 支付问题", value: "充值/支付问题" },
  { label: "Bug 反馈", value: "Bug反馈" },
  { label: "合作洽谈", value: "合作洽谈" },
  { label: "其他", value: "其他" },
];

export default function ContactScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const submitMutation = trpc.customerService.submitContactForm.useMutation();

  const isValid = email.trim().length > 0 && content.trim().length > 0;

  const handleSubmit = useCallback(async () => {
    if (!isValid || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const result = await submitMutation.mutateAsync({
        name: name.trim() || undefined,
        email: email.trim(),
        subject: subject || "其他",
        content: content.trim(),
      });

      if (result.success) {
        setIsSubmitted(true);
      } else {
        if (Platform.OS === "web") {
          window.alert(result.message || "提交失败，请稍后再试");
        } else {
          Alert.alert("提交失败", result.message || "请稍后再试");
        }
      }
    } catch {
      if (Platform.OS === "web") {
        window.alert("网络错误，请检查网络后重试");
      } else {
        Alert.alert("网络错误", "请检查网络后重试");
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [isValid, isSubmitting, name, email, subject, content, submitMutation]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/");
    }
  }, [router]);

  // 提交成功頁面
  if (isSubmitted) {
    return (
      <ScreenContainer edges={["top", "bottom", "left", "right"]}>
        <View style={styles.successContainer}>
          <View style={styles.successIconWrap}>
            <MaterialIcons name="check-circle" size={64} color="#34C759" />
          </View>
          <Text style={styles.successTitle}>提交成功！</Text>
          <Text style={styles.successDesc}>
            感谢您的留言，我们会在 24 小时内通过邮件回复您。
          </Text>
          <Text style={styles.successEmail}>
            回复邮箱：{email}
          </Text>
          <Pressable
            style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.8 }]}
            onPress={handleBack}
          >
            <Text style={styles.backBtnText}>返回首页</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Pressable
            style={({ pressed }) => [styles.headerBackBtn, pressed && { opacity: 0.6 }]}
            onPress={handleBack}
          >
            <MaterialIcons name="arrow-back" size={24} color="#F7F4EF" />
          </Pressable>
          <Text style={styles.headerTitle}>联络我们</Text>
          <View style={styles.headerPlaceholder} />
        </View>

        {/* Intro */}
        <View style={styles.introSection}>
          <View style={styles.introIconWrap}>
            <MaterialIcons name="mail-outline" size={32} color="#E8825E" />
          </View>
          <Text style={styles.introTitle}>有什么可以帮到您？</Text>
          <Text style={styles.introDesc}>
            填写以下表单，我们的团队会在 24 小时内通过邮件回复您。
          </Text>
        </View>

        {/* Form */}
        <View style={styles.formSection}>
          {/* 姓名 */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>您的称呼</Text>
            <TextInput
              style={styles.input}
              placeholder="请输入您的姓名（选填）"
              placeholderTextColor="#555"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
            />
          </View>

          {/* 郵箱 */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>
              邮箱地址 <Text style={styles.required}>*</Text>
            </Text>
            <TextInput
              style={styles.input}
              placeholder="请输入您的邮箱"
              placeholderTextColor="#555"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />
          </View>

          {/* 主題選擇 */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>咨询主题</Text>
            <View style={styles.subjectWrap}>
              {SUBJECT_OPTIONS.map((opt) => (
                <Pressable
                  key={opt.value}
                  style={({ pressed }) => [
                    styles.subjectChip,
                    subject === opt.value && styles.subjectChipActive,
                    pressed && { opacity: 0.7 },
                  ]}
                  onPress={() => setSubject(opt.value)}
                >
                  <Text
                    style={[
                      styles.subjectChipText,
                      subject === opt.value && styles.subjectChipTextActive,
                    ]}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* 內容 */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>
              详细内容 <Text style={styles.required}>*</Text>
            </Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="请详细描述您的问题或需求..."
              placeholderTextColor="#555"
              value={content}
              onChangeText={setContent}
              multiline
              numberOfLines={5}
              textAlignVertical="top"
            />
          </View>

          {/* 提交按鈕 */}
          <Pressable
            style={({ pressed }) => [
              styles.submitBtn,
              !isValid && styles.submitBtnDisabled,
              pressed && isValid && { opacity: 0.85 },
            ]}
            onPress={handleSubmit}
            disabled={!isValid || isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <>
                <MaterialIcons name="send" size={18} color={isValid ? "#FFF" : "#666"} />
                <Text style={[styles.submitBtnText, !isValid && styles.submitBtnTextDisabled]}>
                  提交
                </Text>
              </>
            )}
          </Pressable>

          {/* 直接聯繫 */}
          <View style={styles.directContact}>
            <Text style={styles.directContactText}>
              或直接发送邮件至
            </Text>
            <Text style={styles.directContactEmail}>
              benjamintan0318@gmail.com
            </Text>
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerBackBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#F7F4EF",
  },
  headerPlaceholder: {
    width: 40,
  },

  // Intro
  introSection: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 24,
    gap: 8,
  },
  introIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "rgba(232,130,94,0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  introTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#F7F4EF",
  },
  introDesc: {
    fontSize: 14,
    color: "#9B9691",
    textAlign: "center",
    lineHeight: 20,
  },

  // Form
  formSection: {
    paddingHorizontal: 20,
    gap: 18,
  },
  fieldGroup: {
    gap: 6,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#F7F4EF",
    paddingLeft: 2,
  },
  required: {
    color: "#E8825E",
  },
  input: {
    backgroundColor: "#1A1A1D",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: "#F7F4EF",
    borderWidth: 0.5,
    borderColor: "#2A2A2E",
  },
  textArea: {
    height: 120,
    textAlignVertical: "top",
    paddingTop: 12,
  },

  // Subject chips
  subjectWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  subjectChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#1A1A1D",
    borderWidth: 0.5,
    borderColor: "#2A2A2E",
  },
  subjectChipActive: {
    backgroundColor: "rgba(232,130,94,0.15)",
    borderColor: "#E8825E",
  },
  subjectChipText: {
    fontSize: 13,
    color: "#9B9691",
  },
  subjectChipTextActive: {
    color: "#E8825E",
    fontWeight: "600",
  },

  // Submit
  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#E8825E",
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 6,
  },
  submitBtnDisabled: {
    backgroundColor: "#2A2A2E",
  },
  submitBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  submitBtnTextDisabled: {
    color: "#666",
  },

  // Direct contact
  directContact: {
    alignItems: "center",
    paddingTop: 12,
    gap: 4,
  },
  directContactText: {
    fontSize: 13,
    color: "#9B9691",
  },
  directContactEmail: {
    fontSize: 14,
    color: "#E8825E",
    fontWeight: "600",
  },

  // Success
  successContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 12,
  },
  successIconWrap: {
    marginBottom: 8,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#F7F4EF",
  },
  successDesc: {
    fontSize: 15,
    color: "#9B9691",
    textAlign: "center",
    lineHeight: 22,
  },
  successEmail: {
    fontSize: 14,
    color: "#E8825E",
    fontWeight: "600",
    marginTop: 4,
  },
  backBtn: {
    backgroundColor: "#E8825E",
    borderRadius: 14,
    paddingHorizontal: 32,
    paddingVertical: 14,
    marginTop: 20,
  },
  backBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
  },
});
