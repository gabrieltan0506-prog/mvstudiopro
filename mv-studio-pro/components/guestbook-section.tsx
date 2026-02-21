import { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
  Dimensions,
} from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { trpc } from "@/lib/trpc";
import { trackFormSubmission } from "@/lib/analytics";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const isWeb = Platform.OS === "web";
const isWide = isWeb && SCREEN_WIDTH > 768;

const SUBJECT_OPTIONS = [
  "视频制作咨询",
  "虚拟偶像合作",
  "视觉特效定制",
  "发布策略规划",
  "商务合作",
  "其他",
];

interface FormData {
  name: string;
  email: string;
  phone: string;
  company: string;
  subject: string;
  message: string;
}

const INITIAL_FORM: FormData = {
  name: "",
  email: "",
  phone: "",
  company: "",
  subject: "",
  message: "",
};

export function GuestbookSection() {
  const [form, setForm] = useState<FormData>(INITIAL_FORM);
  const [submitted, setSubmitted] = useState(false);
  const [showSubjectPicker, setShowSubjectPicker] = useState(false);

  const submitMutation = trpc.guestbook.submit.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      setForm(INITIAL_FORM);
      trackFormSubmission("guestbook");
      setTimeout(() => setSubmitted(false), 5000);
    },
    onError: (error) => {
      if (Platform.OS === "web") {
        window.alert("提交失败：" + (error.message || "请稍后再试"));
      } else {
        Alert.alert("提交失败", error.message || "请稍后再试");
      }
    },
  });

  const updateField = useCallback((field: keyof FormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleSubmit = useCallback(() => {
    if (!form.name.trim()) {
      const msg = "请输入您的姓名";
      Platform.OS === "web" ? window.alert(msg) : Alert.alert("提示", msg);
      return;
    }
    if (!form.subject) {
      const msg = "请选择咨询主题";
      Platform.OS === "web" ? window.alert(msg) : Alert.alert("提示", msg);
      return;
    }
    if (!form.message.trim()) {
      const msg = "请输入咨询内容";
      Platform.OS === "web" ? window.alert(msg) : Alert.alert("提示", msg);
      return;
    }

    submitMutation.mutate({
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      company: form.company.trim(),
      subject: form.subject,
      message: form.message.trim(),
    });
  }, [form, submitMutation]);

  if (submitted) {
    return (
      <View style={styles.successContainer}>
        <MaterialIcons name="check-circle" size={48} color="#30D158" />
        <Text style={styles.successTitle}>感谢您的留言</Text>
        <Text style={styles.successDesc}>我们会尽快与您联系。</Text>
      </View>
    );
  }

  return (
    <View style={styles.formContainer}>
      {/* Two-column row for Name + Email on wide screens */}
      <View style={styles.row}>
        <View style={[styles.fieldGroup, isWide && styles.halfField]}>
          <Text style={styles.label}>姓名 <Text style={styles.required}>*</Text></Text>
          <TextInput
            style={styles.input}
            placeholder="您的姓名"
            placeholderTextColor="#6B6762"
            value={form.name}
            onChangeText={(v) => updateField("name", v)}
            maxLength={100}
            returnKeyType="next"
          />
        </View>
        <View style={[styles.fieldGroup, isWide && styles.halfField]}>
          <Text style={styles.label}>电子邮件</Text>
          <TextInput
            style={styles.input}
            placeholder="example@email.com"
            placeholderTextColor="#6B6762"
            value={form.email}
            onChangeText={(v) => updateField("email", v)}
            keyboardType="email-address"
            autoCapitalize="none"
            maxLength={320}
            returnKeyType="next"
          />
        </View>
      </View>

      {/* Two-column row for Phone + Company */}
      <View style={styles.row}>
        <View style={[styles.fieldGroup, isWide && styles.halfField]}>
          <Text style={styles.label}>联系电话</Text>
          <TextInput
            style={styles.input}
            placeholder="您的电话号码"
            placeholderTextColor="#6B6762"
            value={form.phone}
            onChangeText={(v) => updateField("phone", v)}
            keyboardType="phone-pad"
            maxLength={30}
            returnKeyType="next"
          />
        </View>
        <View style={[styles.fieldGroup, isWide && styles.halfField]}>
          <Text style={styles.label}>公司 / 机构</Text>
          <TextInput
            style={styles.input}
            placeholder="公司或机构名称"
            placeholderTextColor="#6B6762"
            value={form.company}
            onChangeText={(v) => updateField("company", v)}
            maxLength={200}
            returnKeyType="next"
          />
        </View>
      </View>

      {/* Subject Picker */}
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>咨询主题 <Text style={styles.required}>*</Text></Text>
        <TouchableOpacity
          style={styles.selectInput}
          onPress={() => setShowSubjectPicker(!showSubjectPicker)}
          activeOpacity={0.7}
        >
          <Text style={[styles.selectText, !form.subject && { color: "#6B6762" }]}>
            {form.subject || "请选择主题"}
          </Text>
          <MaterialIcons name="expand-more" size={20} color="#9B9691" />
        </TouchableOpacity>
        {showSubjectPicker && (
          <View style={styles.dropdown}>
            {SUBJECT_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option}
                style={[styles.dropdownItem, form.subject === option && styles.dropdownItemActive]}
                onPress={() => {
                  updateField("subject", option);
                  setShowSubjectPicker(false);
                }}
                activeOpacity={0.7}
              >
                <Text style={[styles.dropdownText, form.subject === option && styles.dropdownTextActive]}>
                  {option}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {/* Message */}
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>咨询内容 <Text style={styles.required}>*</Text></Text>
        <TextInput
          style={styles.textArea}
          placeholder="请详细描述您的需求..."
          placeholderTextColor="#6B6762"
          value={form.message}
          onChangeText={(v) => updateField("message", v)}
          multiline
          numberOfLines={4}
          maxLength={5000}
          textAlignVertical="top"
        />
      </View>

      {/* Submit */}
      <TouchableOpacity
        style={[styles.submitBtn, submitMutation.isPending && { opacity: 0.7 }]}
        onPress={handleSubmit}
        disabled={submitMutation.isPending}
        activeOpacity={0.8}
      >
        {submitMutation.isPending ? (
          <ActivityIndicator color="#FFFFFF" size="small" />
        ) : (
          <Text style={styles.submitText}>提交留言</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  formContainer: {
    width: "100%",
    gap: 20,
  },
  row: {
    flexDirection: isWide ? "row" : "column",
    gap: isWide ? 16 : 20,
  },
  fieldGroup: {
    gap: 8,
  },
  halfField: {
    flex: 1,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#B8B4AF",
    letterSpacing: -0.1,
  },
  required: {
    color: "#FF453A",
  },
  input: {
    fontSize: 16,
    color: "#F7F4EF",
    backgroundColor: "#1A1A1D",
    borderWidth: 1,
    borderColor: "#2A2A2E",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    lineHeight: 22,
  },
  selectInput: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#1A1A1D",
    borderWidth: 1,
    borderColor: "#2A2A2E",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  selectText: {
    fontSize: 16,
    color: "#F7F4EF",
  },
  dropdown: {
    backgroundColor: "#1A1A1D",
    borderWidth: 1,
    borderColor: "#2A2A2E",
    borderRadius: 10,
    marginTop: 4,
    overflow: "hidden",
  },
  dropdownItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  dropdownItemActive: {
    backgroundColor: "rgba(232, 130, 94, 0.1)",
  },
  dropdownText: {
    fontSize: 15,
    color: "#B8B4AF",
  },
  dropdownTextActive: {
    color: "#E8825E",
    fontWeight: "600",
  },
  textArea: {
    fontSize: 16,
    color: "#F7F4EF",
    backgroundColor: "#1A1A1D",
    borderWidth: 1,
    borderColor: "#2A2A2E",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 120,
    lineHeight: 22,
  },
  submitBtn: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
    ...(isWeb ? {
      backgroundImage: "linear-gradient(135deg, #E8825E 0%, #C77DBA 100%)",
    } as any : {
      backgroundColor: "#E8825E",
    }),
  },
  submitText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "600",
  },
  successContainer: {
    alignItems: "center",
    paddingVertical: 40,
    gap: 12,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#F7F4EF",
  },
  successDesc: {
    fontSize: 17,
    color: "#9B9691",
  },
});
