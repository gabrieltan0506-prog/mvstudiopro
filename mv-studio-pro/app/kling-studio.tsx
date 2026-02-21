import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Platform,
  Dimensions,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useRouter, type Href } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const isWeb = Platform.OS === "web";
const isWide = isWeb && SCREEN_WIDTH > 768;

// ─── Types ──────────────────────────────────────────

type KlingTab = "omniVideo" | "motionControl" | "lipSync" | "elements";
type KlingMode = "std" | "pro";
type AspectRatio = "16:9" | "9:16" | "1:1";
type Duration = "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "15";

interface TaskInfo {
  taskId: string;
  type: KlingTab;
  status: "submitted" | "processing" | "succeed" | "failed";
  createdAt: number;
  videoUrl?: string;
  error?: string;
}

// ─── Tab Config ─────────────────────────────────────

const TABS: Array<{ id: KlingTab; label: string; icon: string; color: string; desc: string }> = [
  { id: "omniVideo", label: "Omni Video", icon: "auto-awesome", color: "#A855F7", desc: "3.0 文生视频 / 图生视频 / 分镜叙事" },
  { id: "motionControl", label: "Motion Control", icon: "directions-walk", color: "#3B82F6", desc: "2.6 动作迁移：图片 + 动作视频 → 动画" },
  { id: "lipSync", label: "Lip-Sync", icon: "record-voice-over", color: "#EC4899", desc: "对口型：视频 + 音频 → 口型同步" },
  { id: "elements", label: "Elements", icon: "layers", color: "#10B981", desc: "角色元素库：保持角色一致性" },
];

// ─── Cost Display ───────────────────────────────────

function CostBadge({ mode, duration, type, hasVideo = false, hasAudio = false }: {
  mode: KlingMode; duration: number; type: string; hasVideo?: boolean; hasAudio?: boolean;
}) {
  let units = 0;
  let usd = 0;

  if (type === "omniVideo") {
    const base = mode === "std"
      ? (!hasVideo && !hasAudio ? 0.6 : !hasVideo && hasAudio ? 0.8 : hasVideo && !hasAudio ? 0.9 : 1.1)
      : (!hasVideo && !hasAudio ? 0.8 : !hasVideo && hasAudio ? 1.0 : hasVideo && !hasAudio ? 1.2 : 1.4);
    units = base * duration;
  } else if (type === "motionControl") {
    units = (mode === "std" ? 0.5 : 0.8) * duration;
  } else if (type === "lipSync") {
    units = 0.05 + 0.5 * Math.ceil(duration / 5);
  }
  usd = units * 0.098; // Trial pack rate

  return (
    <View style={cs.costBadge}>
      <MaterialIcons name="toll" size={14} color="#FFD60A" />
      <Text style={cs.costText}>{units.toFixed(1)} units</Text>
      <Text style={cs.costUsd}>(~${usd.toFixed(2)})</Text>
    </View>
  );
}

// ─── Mode Selector ──────────────────────────────────

function ModeSelector({ mode, onModeChange }: { mode: KlingMode; onModeChange: (m: KlingMode) => void }) {
  return (
    <View style={cs.modeRow}>
      <Text style={cs.label}>品质模式</Text>
      <View style={cs.modeGroup}>
        <TouchableOpacity
          onPress={() => onModeChange("std")}
          style={[cs.modeBtn, mode === "std" && cs.modeBtnActive]}
          activeOpacity={0.7}
        >
          <Text style={[cs.modeBtnText, mode === "std" && cs.modeBtnTextActive]}>Standard 720p</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => onModeChange("pro")}
          style={[cs.modeBtn, mode === "pro" && cs.modeBtnActivePro]}
          activeOpacity={0.7}
        >
          <Text style={[cs.modeBtnText, mode === "pro" && cs.modeBtnTextActive]}>Pro 1080p</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Duration Selector ──────────────────────────────

function DurationSelector({ duration, onDurationChange, maxDuration = "15" }: {
  duration: Duration; onDurationChange: (d: Duration) => void; maxDuration?: string;
}) {
  const options: Duration[] = ["3", "5", "10", "15"];
  const filtered = options.filter((d) => parseInt(d) <= parseInt(maxDuration));
  return (
    <View style={cs.modeRow}>
      <Text style={cs.label}>时长（秒）</Text>
      <View style={cs.modeGroup}>
        {filtered.map((d) => (
          <TouchableOpacity
            key={d}
            onPress={() => onDurationChange(d)}
            style={[cs.modeBtn, duration === d && cs.modeBtnActive]}
            activeOpacity={0.7}
          >
            <Text style={[cs.modeBtnText, duration === d && cs.modeBtnTextActive]}>{d}s</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

// ─── Aspect Ratio Selector ──────────────────────────

function AspectRatioSelector({ ratio, onRatioChange }: {
  ratio: AspectRatio; onRatioChange: (r: AspectRatio) => void;
}) {
  const options: Array<{ value: AspectRatio; label: string }> = [
    { value: "16:9", label: "16:9 横屏" },
    { value: "9:16", label: "9:16 竖屏" },
    { value: "1:1", label: "1:1 方形" },
  ];
  return (
    <View style={cs.modeRow}>
      <Text style={cs.label}>画面比例</Text>
      <View style={cs.modeGroup}>
        {options.map((o) => (
          <TouchableOpacity
            key={o.value}
            onPress={() => onRatioChange(o.value)}
            style={[cs.modeBtn, ratio === o.value && cs.modeBtnActive]}
            activeOpacity={0.7}
          >
            <Text style={[cs.modeBtnText, ratio === o.value && cs.modeBtnTextActive]}>{o.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

// ─── Task Status Card ───────────────────────────────

function TaskStatusCard({ task, onPoll }: { task: TaskInfo; onPoll: () => void }) {
  const statusColors: Record<string, string> = {
    submitted: "#FFD60A",
    processing: "#3B82F6",
    succeed: "#10B981",
    failed: "#EF4444",
  };
  const statusLabels: Record<string, string> = {
    submitted: "已提交",
    processing: "生成中...",
    succeed: "完成",
    failed: "失败",
  };

  return (
    <View style={cs.taskCard}>
      <View style={cs.taskHeader}>
        <View style={[cs.statusDot, { backgroundColor: statusColors[task.status] }]} />
        <Text style={cs.taskType}>{task.type === "omniVideo" ? "Omni Video" : task.type === "motionControl" ? "Motion Control" : "Lip-Sync"}</Text>
        <Text style={[cs.taskStatus, { color: statusColors[task.status] }]}>{statusLabels[task.status]}</Text>
      </View>
      <Text style={cs.taskId}>Task: {task.taskId.slice(0, 16)}...</Text>
      {task.status === "processing" || task.status === "submitted" ? (
        <TouchableOpacity onPress={onPoll} style={cs.pollBtn} activeOpacity={0.7}>
          <MaterialIcons name="refresh" size={16} color="#A855F7" />
          <Text style={cs.pollBtnText}>刷新状态</Text>
        </TouchableOpacity>
      ) : null}
      {task.status === "succeed" && task.videoUrl ? (
        <View style={cs.resultSection}>
          <MaterialIcons name="check-circle" size={20} color="#10B981" />
          <Text style={cs.resultText}>视频已生成</Text>
          {isWeb && (
            <TouchableOpacity
              onPress={() => { if (task.videoUrl) window.open(task.videoUrl, "_blank"); }}
              style={cs.downloadBtn}
              activeOpacity={0.7}
            >
              <MaterialIcons name="file-download" size={16} color="#fff" />
              <Text style={cs.downloadBtnText}>下载</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : null}
      {task.status === "failed" && task.error ? (
        <Text style={cs.errorText}>{task.error}</Text>
      ) : null}
    </View>
  );
}

// ═══════════════════════════════════════════════════════
// Omni Video Panel
// ═══════════════════════════════════════════════════════

function OmniVideoPanel({ onTaskCreated }: { onTaskCreated: (task: TaskInfo) => void }) {
  const [subTab, setSubTab] = useState<"t2v" | "i2v" | "storyboard">("t2v");
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [mode, setMode] = useState<KlingMode>("std");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [duration, setDuration] = useState<Duration>("5");
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Storyboard shots
  const [shots, setShots] = useState<Array<{ prompt: string; duration: string }>>([
    { prompt: "", duration: "5" },
    { prompt: "", duration: "5" },
  ]);

  const createT2V = trpc.kling.omniVideo.createT2V.useMutation();
  const createI2V = trpc.kling.omniVideo.createI2V.useMutation();
  const createStoryboard = trpc.kling.omniVideo.createStoryboard.useMutation();

  const handlePickImage = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      base64: true,
    });
    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!prompt.trim() && subTab !== "storyboard") {
      Alert.alert("提示", "请输入描述文本");
      return;
    }
    setLoading(true);
    try {
      let result: { success: boolean; taskId: string };

      if (subTab === "t2v") {
        result = await createT2V.mutateAsync({
          prompt: prompt.trim(),
          negativePrompt: negativePrompt.trim() || undefined,
          mode,
          aspectRatio,
          duration,
        });
      } else if (subTab === "i2v") {
        if (!imageUri) {
          Alert.alert("提示", "请选择一张参考图片");
          setLoading(false);
          return;
        }
        result = await createI2V.mutateAsync({
          prompt: prompt.trim(),
          imageUrl: imageUri,
          mode,
          aspectRatio,
          duration,
        });
      } else {
        const validShots = shots.filter((s) => s.prompt.trim());
        if (validShots.length < 1) {
          Alert.alert("提示", "请至少填写一个分镜描述");
          setLoading(false);
          return;
        }
        result = await createStoryboard.mutateAsync({
          shots: validShots,
          mode,
          aspectRatio,
        });
      }

      onTaskCreated({
        taskId: result.taskId,
        type: "omniVideo",
        status: "submitted",
        createdAt: Date.now(),
      });
      Alert.alert("成功", "任务已提交！请在任务列表中查看进度。");
    } catch (err: any) {
      Alert.alert("错误", err.message || "提交失败");
    } finally {
      setLoading(false);
    }
  }, [prompt, negativePrompt, mode, aspectRatio, duration, subTab, imageUri, shots]);

  return (
    <View style={cs.panel}>
      {/* Sub-tabs */}
      <View style={cs.subTabRow}>
        {([
          { id: "t2v" as const, label: "文生视频" },
          { id: "i2v" as const, label: "图生视频" },
          { id: "storyboard" as const, label: "分镜叙事" },
        ]).map((t) => (
          <TouchableOpacity
            key={t.id}
            onPress={() => setSubTab(t.id)}
            style={[cs.subTab, subTab === t.id && cs.subTabActive]}
            activeOpacity={0.7}
          >
            <Text style={[cs.subTabText, subTab === t.id && cs.subTabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Prompt input */}
      {subTab !== "storyboard" && (
        <>
          <Text style={cs.label}>描述 (Prompt)</Text>
          <TextInput
            style={cs.textArea}
            value={prompt}
            onChangeText={setPrompt}
            placeholder="描述你想要生成的视频场景..."
            placeholderTextColor="#666"
            multiline
            numberOfLines={4}
            maxLength={2500}
          />
          <Text style={cs.charCount}>{prompt.length}/2500</Text>

          <Text style={cs.label}>反向描述 (可选)</Text>
          <TextInput
            style={cs.input}
            value={negativePrompt}
            onChangeText={setNegativePrompt}
            placeholder="不想出现的元素..."
            placeholderTextColor="#666"
            maxLength={500}
          />
        </>
      )}

      {/* I2V: Image picker */}
      {subTab === "i2v" && (
        <View style={cs.imageSection}>
          <Text style={cs.label}>参考图片</Text>
          <TouchableOpacity onPress={handlePickImage} style={cs.imagePicker} activeOpacity={0.7}>
            {imageUri ? (
              <Image source={{ uri: imageUri }} style={cs.previewImage} contentFit="cover" />
            ) : (
              <View style={cs.imagePickerPlaceholder}>
                <MaterialIcons name="add-photo-alternate" size={32} color="#666" />
                <Text style={cs.imagePickerText}>选择图片</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* Storyboard: Multi-shot editor */}
      {subTab === "storyboard" && (
        <View style={cs.storyboardSection}>
          <Text style={cs.label}>分镜脚本（最多 6 个，总时长 ≤ 15 秒）</Text>
          {shots.map((shot, index) => (
            <View key={index} style={cs.shotCard}>
              <View style={cs.shotHeader}>
                <Text style={cs.shotLabel}>分镜 {index + 1}</Text>
                <View style={cs.shotDuration}>
                  {["3", "5"].map((d) => (
                    <TouchableOpacity
                      key={d}
                      onPress={() => {
                        const newShots = [...shots];
                        newShots[index].duration = d;
                        setShots(newShots);
                      }}
                      style={[cs.miniBtn, shot.duration === d && cs.miniBtnActive]}
                      activeOpacity={0.7}
                    >
                      <Text style={[cs.miniBtnText, shot.duration === d && cs.miniBtnTextActive]}>{d}s</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {shots.length > 1 && (
                  <TouchableOpacity
                    onPress={() => setShots(shots.filter((_, i) => i !== index))}
                    activeOpacity={0.7}
                  >
                    <MaterialIcons name="close" size={18} color="#666" />
                  </TouchableOpacity>
                )}
              </View>
              <TextInput
                style={cs.shotInput}
                value={shot.prompt}
                onChangeText={(text) => {
                  const newShots = [...shots];
                  newShots[index].prompt = text;
                  setShots(newShots);
                }}
                placeholder={`描述第 ${index + 1} 个分镜的场景...`}
                placeholderTextColor="#666"
                multiline
                numberOfLines={2}
              />
            </View>
          ))}
          {shots.length < 6 && (
            <TouchableOpacity
              onPress={() => setShots([...shots, { prompt: "", duration: "5" }])}
              style={cs.addShotBtn}
              activeOpacity={0.7}
            >
              <MaterialIcons name="add" size={18} color="#A855F7" />
              <Text style={cs.addShotText}>添加分镜</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Settings */}
      <ModeSelector mode={mode} onModeChange={setMode} />
      <AspectRatioSelector ratio={aspectRatio} onRatioChange={setAspectRatio} />
      {subTab !== "storyboard" && (
        <DurationSelector duration={duration} onDurationChange={setDuration} />
      )}

      {/* Cost estimate */}
      <CostBadge
        mode={mode}
        duration={subTab === "storyboard" ? shots.reduce((sum, s) => sum + parseInt(s.duration), 0) : parseInt(duration)}
        type="omniVideo"
        hasVideo={false}
        hasAudio={false}
      />

      {/* Submit */}
      <TouchableOpacity
        onPress={handleSubmit}
        style={[cs.submitBtn, loading && cs.submitBtnDisabled]}
        activeOpacity={0.7}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <>
            <MaterialIcons name="auto-awesome" size={18} color="#fff" />
            <Text style={cs.submitBtnText}>生成视频</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

// ═══════════════════════════════════════════════════════
// Motion Control Panel
// ═══════════════════════════════════════════════════════

function MotionControlPanel({ onTaskCreated }: { onTaskCreated: (task: TaskInfo) => void }) {
  const [mode, setMode] = useState<KlingMode>("pro");
  const [orientation, setOrientation] = useState<"image" | "video">("video");
  const [prompt, setPrompt] = useState("");
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [keepSound, setKeepSound] = useState(true);
  const [loading, setLoading] = useState(false);

  const createMC = trpc.kling.motionControl.create.useMutation();

  const handlePickImage = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
    }
  }, []);

  const handlePickVideo = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["videos"],
    });
    if (!result.canceled && result.assets[0]) {
      setVideoUri(result.assets[0].uri);
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!imageUri) {
      Alert.alert("提示", "请选择角色参考图片");
      return;
    }
    if (!videoUri) {
      Alert.alert("提示", "请选择动作参考视频");
      return;
    }
    setLoading(true);
    try {
      const result = await createMC.mutateAsync({
        imageUrl: imageUri,
        videoUrl: videoUri,
        orientation,
        mode,
        prompt: prompt.trim() || undefined,
        keepOriginalSound: keepSound,
      });
      onTaskCreated({
        taskId: result.taskId,
        type: "motionControl",
        status: "submitted",
        createdAt: Date.now(),
      });
      Alert.alert("成功", "Motion Control 任务已提交！");
    } catch (err: any) {
      Alert.alert("错误", err.message || "提交失败");
    } finally {
      setLoading(false);
    }
  }, [imageUri, videoUri, orientation, mode, prompt, keepSound]);

  return (
    <View style={cs.panel}>
      <View style={cs.infoBox}>
        <MaterialIcons name="info" size={16} color="#3B82F6" />
        <Text style={cs.infoText}>上传一张角色图片和一段动作视频，AI 会将动作迁移到角色上。</Text>
      </View>

      {/* Image picker */}
      <Text style={cs.label}>角色参考图片</Text>
      <TouchableOpacity onPress={handlePickImage} style={cs.imagePicker} activeOpacity={0.7}>
        {imageUri ? (
          <Image source={{ uri: imageUri }} style={cs.previewImage} contentFit="cover" />
        ) : (
          <View style={cs.imagePickerPlaceholder}>
            <MaterialIcons name="person" size={32} color="#666" />
            <Text style={cs.imagePickerText}>选择角色图片</Text>
          </View>
        )}
      </TouchableOpacity>

      {/* Video picker */}
      <Text style={cs.label}>动作参考视频</Text>
      <TouchableOpacity onPress={handlePickVideo} style={cs.imagePicker} activeOpacity={0.7}>
        {videoUri ? (
          <View style={cs.videoSelected}>
            <MaterialIcons name="videocam" size={24} color="#10B981" />
            <Text style={cs.videoSelectedText}>视频已选择</Text>
          </View>
        ) : (
          <View style={cs.imagePickerPlaceholder}>
            <MaterialIcons name="videocam" size={32} color="#666" />
            <Text style={cs.imagePickerText}>选择动作视频 (3-30s)</Text>
          </View>
        )}
      </TouchableOpacity>

      {/* Orientation */}
      <View style={cs.modeRow}>
        <Text style={cs.label}>输出朝向</Text>
        <View style={cs.modeGroup}>
          <TouchableOpacity
            onPress={() => setOrientation("video")}
            style={[cs.modeBtn, orientation === "video" && cs.modeBtnActive]}
            activeOpacity={0.7}
          >
            <Text style={[cs.modeBtnText, orientation === "video" && cs.modeBtnTextActive]}>跟随视频 (≤30s)</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setOrientation("image")}
            style={[cs.modeBtn, orientation === "image" && cs.modeBtnActive]}
            activeOpacity={0.7}
          >
            <Text style={[cs.modeBtnText, orientation === "image" && cs.modeBtnTextActive]}>跟随图片 (≤10s)</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Optional prompt */}
      <Text style={cs.label}>场景描述 (可选)</Text>
      <TextInput
        style={cs.input}
        value={prompt}
        onChangeText={setPrompt}
        placeholder="添加场景元素或镜头效果..."
        placeholderTextColor="#666"
        maxLength={2500}
      />

      {/* Keep sound toggle */}
      <TouchableOpacity
        onPress={() => setKeepSound(!keepSound)}
        style={cs.toggleRow}
        activeOpacity={0.7}
      >
        <MaterialIcons name={keepSound ? "volume-up" : "volume-off"} size={20} color={keepSound ? "#10B981" : "#666"} />
        <Text style={cs.toggleText}>保留原始音频</Text>
        <View style={[cs.toggle, keepSound && cs.toggleActive]}>
          <View style={[cs.toggleDot, keepSound && cs.toggleDotActive]} />
        </View>
      </TouchableOpacity>

      <ModeSelector mode={mode} onModeChange={setMode} />

      <CostBadge mode={mode} duration={10} type="motionControl" />

      <TouchableOpacity
        onPress={handleSubmit}
        style={[cs.submitBtn, { backgroundColor: "#3B82F6" }, loading && cs.submitBtnDisabled]}
        activeOpacity={0.7}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <>
            <MaterialIcons name="directions-walk" size={18} color="#fff" />
            <Text style={cs.submitBtnText}>开始动作迁移</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

// ═══════════════════════════════════════════════════════
// Lip-Sync Panel
// ═══════════════════════════════════════════════════════

function LipSyncPanel({ onTaskCreated }: { onTaskCreated: (task: TaskInfo) => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [faces, setFaces] = useState<Array<{ face_id: string; face_image: string }>>([]);
  const [selectedFaceId, setSelectedFaceId] = useState<string | null>(null);
  const [soundVolume, setSoundVolume] = useState(1);
  const [originalVolume, setOriginalVolume] = useState(0);
  const [loading, setLoading] = useState(false);
  const [faceLoading, setFaceLoading] = useState(false);

  const identifyFacesMut = trpc.kling.lipSync.identifyFaces.useMutation();
  const createLipSync = trpc.kling.lipSync.create.useMutation();

  const handlePickVideo = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["videos"],
    });
    if (!result.canceled && result.assets[0]) {
      setVideoUri(result.assets[0].uri);
      setSessionId(null);
      setFaces([]);
      setSelectedFaceId(null);
      setStep(1);
    }
  }, []);

  const handlePickAudio = useCallback(async () => {
    // On web, we can use file input for audio
    if (isWeb) {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "audio/mp3,audio/wav,audio/m4a";
      input.onchange = (e: any) => {
        const file = e.target.files?.[0];
        if (file) {
          setAudioUri(URL.createObjectURL(file));
        }
      };
      input.click();
    } else {
      // On native, use document picker
      Alert.alert("提示", "请选择 MP3/WAV/M4A 音频文档");
    }
  }, []);

  const handleIdentifyFaces = useCallback(async () => {
    if (!videoUri) {
      Alert.alert("提示", "请先选择视频");
      return;
    }
    setFaceLoading(true);
    try {
      const result = await identifyFacesMut.mutateAsync({ videoUrl: videoUri });
      setSessionId(result.session_id);
      setFaces(result.face_data || []);
      if (result.face_data?.length > 0) {
        setSelectedFaceId(result.face_data[0].face_id);
      }
      setStep(2);
    } catch (err: any) {
      Alert.alert("错误", err.message || "人脸识别失败");
    } finally {
      setFaceLoading(false);
    }
  }, [videoUri]);

  const handleSubmit = useCallback(async () => {
    if (!sessionId || !selectedFaceId || !audioUri) {
      Alert.alert("提示", "请完成所有步骤");
      return;
    }
    setLoading(true);
    try {
      const result = await createLipSync.mutateAsync({
        sessionId,
        faceId: selectedFaceId,
        audioUrl: audioUri,
        soundVolume,
        originalAudioVolume: originalVolume,
      });
      onTaskCreated({
        taskId: result.taskId,
        type: "lipSync",
        status: "submitted",
        createdAt: Date.now(),
      });
      Alert.alert("成功", "Lip-Sync 任务已提交！");
    } catch (err: any) {
      Alert.alert("错误", err.message || "提交失败");
    } finally {
      setLoading(false);
    }
  }, [sessionId, selectedFaceId, audioUri, soundVolume, originalVolume]);

  return (
    <View style={cs.panel}>
      <View style={cs.infoBox}>
        <MaterialIcons name="info" size={16} color="#EC4899" />
        <Text style={cs.infoText}>两步骤流程：① 上传视频识别人脸 → ② 选择人脸 + 上传音频生成对口型</Text>
      </View>

      {/* Step indicator */}
      <View style={cs.stepRow}>
        <View style={[cs.stepDot, step >= 1 && cs.stepDotActive]}>
          <Text style={cs.stepNum}>1</Text>
        </View>
        <View style={[cs.stepLine, step >= 2 && cs.stepLineActive]} />
        <View style={[cs.stepDot, step >= 2 && cs.stepDotActive]}>
          <Text style={cs.stepNum}>2</Text>
        </View>
      </View>

      {/* Step 1: Video + Face Identify */}
      <Text style={cs.label}>步骤 1：选择视频并识别人脸</Text>
      <TouchableOpacity onPress={handlePickVideo} style={cs.imagePicker} activeOpacity={0.7}>
        {videoUri ? (
          <View style={cs.videoSelected}>
            <MaterialIcons name="videocam" size={24} color="#EC4899" />
            <Text style={cs.videoSelectedText}>视频已选择</Text>
          </View>
        ) : (
          <View style={cs.imagePickerPlaceholder}>
            <MaterialIcons name="videocam" size={32} color="#666" />
            <Text style={cs.imagePickerText}>选择视频 (2-60s, ≤100MB)</Text>
          </View>
        )}
      </TouchableOpacity>

      {videoUri && !sessionId && (
        <TouchableOpacity
          onPress={handleIdentifyFaces}
          style={[cs.submitBtn, { backgroundColor: "#EC4899" }]}
          activeOpacity={0.7}
          disabled={faceLoading}
        >
          {faceLoading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <MaterialIcons name="face" size={18} color="#fff" />
              <Text style={cs.submitBtnText}>识别人脸</Text>
            </>
          )}
        </TouchableOpacity>
      )}

      {/* Face selection */}
      {faces.length > 0 && (
        <View style={cs.faceSection}>
          <Text style={cs.label}>选择人脸</Text>
          <View style={cs.faceGrid}>
            {faces.map((face) => (
              <TouchableOpacity
                key={face.face_id}
                onPress={() => setSelectedFaceId(face.face_id)}
                style={[cs.faceCard, selectedFaceId === face.face_id && cs.faceCardSelected]}
                activeOpacity={0.7}
              >
                <Image source={{ uri: face.face_image }} style={cs.faceImage} contentFit="cover" />
                {selectedFaceId === face.face_id && (
                  <View style={cs.faceCheck}>
                    <MaterialIcons name="check-circle" size={20} color="#10B981" />
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* Step 2: Audio + Submit */}
      {step === 2 && (
        <>
          <Text style={cs.label}>步骤 2：选择音频文档</Text>
          <TouchableOpacity onPress={handlePickAudio} style={cs.imagePicker} activeOpacity={0.7}>
            {audioUri ? (
              <View style={cs.videoSelected}>
                <MaterialIcons name="audiotrack" size={24} color="#EC4899" />
                <Text style={cs.videoSelectedText}>音频已选择</Text>
              </View>
            ) : (
              <View style={cs.imagePickerPlaceholder}>
                <MaterialIcons name="audiotrack" size={32} color="#666" />
                <Text style={cs.imagePickerText}>选择音频 (MP3/WAV, 2-60s)</Text>
              </View>
            )}
          </TouchableOpacity>

          {/* Volume controls */}
          <View style={cs.volumeRow}>
            <Text style={cs.label}>新音频音量: {soundVolume.toFixed(1)}</Text>
            <View style={cs.volumeBar}>
              {[0, 0.5, 1, 1.5, 2].map((v) => (
                <TouchableOpacity
                  key={v}
                  onPress={() => setSoundVolume(v)}
                  style={[cs.volumeDot, soundVolume === v && cs.volumeDotActive]}
                  activeOpacity={0.7}
                >
                  <Text style={cs.volumeDotText}>{v}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={cs.volumeRow}>
            <Text style={cs.label}>原始音频音量: {originalVolume.toFixed(1)}</Text>
            <View style={cs.volumeBar}>
              {[0, 0.5, 1, 1.5, 2].map((v) => (
                <TouchableOpacity
                  key={v}
                  onPress={() => setOriginalVolume(v)}
                  style={[cs.volumeDot, originalVolume === v && cs.volumeDotActive]}
                  activeOpacity={0.7}
                >
                  <Text style={cs.volumeDotText}>{v}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <CostBadge mode="std" duration={15} type="lipSync" />

          <TouchableOpacity
            onPress={handleSubmit}
            style={[cs.submitBtn, { backgroundColor: "#EC4899" }, loading && cs.submitBtnDisabled]}
            activeOpacity={0.7}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <MaterialIcons name="record-voice-over" size={18} color="#fff" />
                <Text style={cs.submitBtnText}>生成对口型</Text>
              </>
            )}
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

// ═══════════════════════════════════════════════════════
// Elements Panel
// ═══════════════════════════════════════════════════════

function ElementsPanel() {
  const [loading, setLoading] = useState(false);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [name, setName] = useState("");

  const createImageEl = trpc.kling.elements.createImage.useMutation();

  const handlePickImage = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
    }
  }, []);

  const handleCreate = useCallback(async () => {
    if (!imageUri) {
      Alert.alert("提示", "请选择角色图片");
      return;
    }
    setLoading(true);
    try {
      const result = await createImageEl.mutateAsync({
        imageUrls: [imageUri],
        name: name.trim() || undefined,
      });
      Alert.alert("成功", `角色元素已创建！ID: ${result.elementId}`);
      setImageUri(null);
      setName("");
    } catch (err: any) {
      Alert.alert("错误", err.message || "创建失败");
    } finally {
      setLoading(false);
    }
  }, [imageUri, name]);

  return (
    <View style={cs.panel}>
      <View style={cs.infoBox}>
        <MaterialIcons name="info" size={16} color="#10B981" />
        <Text style={cs.infoText}>{"创建角色元素后，可在 Omni Video 中使用 <<<element_1>>> 语法引用，保持角色一致性。"}</Text>
      </View>

      <Text style={cs.label}>角色名称 (可选)</Text>
      <TextInput
        style={cs.input}
        value={name}
        onChangeText={setName}
        placeholder="例如：小明、女主角..."
        placeholderTextColor="#666"
        maxLength={100}
      />

      <Text style={cs.label}>角色图片</Text>
      <TouchableOpacity onPress={handlePickImage} style={cs.imagePicker} activeOpacity={0.7}>
        {imageUri ? (
          <Image source={{ uri: imageUri }} style={cs.previewImage} contentFit="cover" />
        ) : (
          <View style={cs.imagePickerPlaceholder}>
            <MaterialIcons name="person-add" size={32} color="#666" />
            <Text style={cs.imagePickerText}>选择角色图片</Text>
          </View>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        onPress={handleCreate}
        style={[cs.submitBtn, { backgroundColor: "#10B981" }, loading && cs.submitBtnDisabled]}
        activeOpacity={0.7}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <>
            <MaterialIcons name="add-circle" size={18} color="#fff" />
            <Text style={cs.submitBtnText}>创建角色元素</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

// ═══════════════════════════════════════════════════════
// Main Kling Studio Screen
// ═══════════════════════════════════════════════════════

export default function KlingStudioScreen() {
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const [activeTab, setActiveTab] = useState<KlingTab>("omniVideo");
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [pollingId, setPollingId] = useState<string | null>(null);
  const trpcUtils = trpc.useUtils();

  const handleTaskCreated = useCallback((task: TaskInfo) => {
    setTasks((prev) => [task, ...prev]);
  }, []);

  const handlePollTask = useCallback(async (taskId: string, type: KlingTab) => {
    setPollingId(taskId);
    try {
      let result: any;
      if (type === "omniVideo") {
        result = await trpcUtils.kling.omniVideo.getTask.fetch({ taskId });
      } else if (type === "motionControl") {
        result = await trpcUtils.kling.motionControl.getTask.fetch({ taskId });
      } else if (type === "lipSync") {
        result = await trpcUtils.kling.lipSync.getTask.fetch({ taskId });
      }

      if (result) {
        const status = result.task_status || result.status || "processing";
        const videoUrl = result.task_result?.videos?.[0]?.url || result.works?.[0]?.resource?.resource || undefined;
        const errorMsg = result.task_status_msg || undefined;

        setTasks((prev) =>
          prev.map((t) =>
            t.taskId === taskId
              ? { ...t, status: status as TaskInfo["status"], videoUrl, error: errorMsg }
              : t
          )
        );

        if (status === "succeed") {
          Alert.alert("完成", "视频已生成！");
        } else if (status === "failed") {
          Alert.alert("失败", errorMsg || "任务失败");
        } else {
          Alert.alert("进行中", `任务状态：${status}，请稍后再查找`);
        }
      }
    } catch (err: any) {
      Alert.alert("错误", err.message || "查找失败");
    } finally {
      setPollingId(null);
    }
  }, [trpcUtils]);

  // Auto-poll active tasks every 15 seconds
  useEffect(() => {
    const activeTasks = tasks.filter((t) => t.status === "submitted" || t.status === "processing");
    if (activeTasks.length === 0) return;

    const interval = setInterval(() => {
      activeTasks.forEach((task) => {
        handlePollTask(task.taskId, task.type);
      });
    }, 15000);

    return () => clearInterval(interval);
  }, [tasks, handlePollTask]);

  return (
    <ScreenContainer edges={isWeb ? [] : ["top", "left", "right"]} containerClassName="bg-background">
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={cs.header}>
          <View style={cs.headerInner}>
            <TouchableOpacity onPress={() => router.back()} style={cs.backBtn} activeOpacity={0.7}>
              <MaterialIcons name="arrow-back" size={24} color="#fff" />
            </TouchableOpacity>
            <View style={cs.headerTitleRow}>
              <MaterialIcons name="auto-fix-high" size={24} color="#A855F7" />
              <Text style={cs.headerTitle}>Kling AI 工作室</Text>
            </View>
            <Text style={cs.headerSubtitle}>3.0 Omni Video · 2.6 Motion Control · Lip-Sync</Text>
          </View>
        </View>

        <View style={cs.content}>
          {/* Tab Bar */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={cs.tabScroll}>
            <View style={cs.tabRow}>
              {TABS.map((tab) => (
                <TouchableOpacity
                  key={tab.id}
                  onPress={() => setActiveTab(tab.id)}
                  style={[cs.tab, activeTab === tab.id && { borderColor: tab.color, backgroundColor: `${tab.color}15` }]}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name={tab.icon as any} size={20} color={activeTab === tab.id ? tab.color : "#888"} />
                  <Text style={[cs.tabLabel, activeTab === tab.id && { color: tab.color }]}>{tab.label}</Text>
                  <Text style={cs.tabDesc}>{tab.desc}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          {/* Active Panel */}
          {activeTab === "omniVideo" && <OmniVideoPanel onTaskCreated={handleTaskCreated} />}
          {activeTab === "motionControl" && <MotionControlPanel onTaskCreated={handleTaskCreated} />}
          {activeTab === "lipSync" && <LipSyncPanel onTaskCreated={handleTaskCreated} />}
          {activeTab === "elements" && <ElementsPanel />}

          {/* Task History */}
          {tasks.length > 0 && (
            <View style={cs.taskSection}>
              <Text style={cs.sectionTitle}>任务列表</Text>
              {tasks.map((task) => (
                <TaskStatusCard
                  key={task.taskId}
                  task={task}
                  onPoll={() => handlePollTask(task.taskId, task.type)}
                />
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

// ═══════════════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════════════

const cs = StyleSheet.create({
  header: {
    backgroundColor: "#0A0A0B",
    paddingTop: isWeb ? 20 : 0,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#1C1C1E",
  },
  headerInner: {
    maxWidth: 900,
    width: "100%",
    alignSelf: "center",
    paddingHorizontal: 20,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  headerTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: "#fff",
  },
  headerSubtitle: {
    fontSize: 14,
    color: "#888",
    marginTop: 4,
  },
  content: {
    maxWidth: 900,
    width: "100%",
    alignSelf: "center",
    padding: 16,
  },
  tabScroll: {
    marginBottom: 16,
  },
  tabRow: {
    flexDirection: "row",
    gap: 10,
    paddingVertical: 4,
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2C2C2E",
    backgroundColor: "#1C1C1E",
    minWidth: 160,
    gap: 4,
  },
  tabLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: "#888",
  },
  tabDesc: {
    fontSize: 11,
    color: "#666",
    marginTop: 2,
  },
  panel: {
    backgroundColor: "#1C1C1E",
    borderRadius: 16,
    padding: 20,
    gap: 14,
    borderWidth: 1,
    borderColor: "#2C2C2E",
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: "#ccc",
    marginBottom: 4,
  },
  textArea: {
    backgroundColor: "#0A0A0B",
    borderRadius: 10,
    padding: 12,
    color: "#fff",
    fontSize: 14,
    minHeight: 100,
    textAlignVertical: "top",
    borderWidth: 1,
    borderColor: "#2C2C2E",
  },
  input: {
    backgroundColor: "#0A0A0B",
    borderRadius: 10,
    padding: 12,
    color: "#fff",
    fontSize: 14,
    borderWidth: 1,
    borderColor: "#2C2C2E",
  },
  charCount: {
    fontSize: 11,
    color: "#666",
    textAlign: "right",
  },
  modeRow: {
    gap: 6,
  },
  modeGroup: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  modeBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#2C2C2E",
    backgroundColor: "#0A0A0B",
  },
  modeBtnActive: {
    borderColor: "#A855F7",
    backgroundColor: "rgba(168,85,247,0.15)",
  },
  modeBtnActivePro: {
    borderColor: "#FFD60A",
    backgroundColor: "rgba(255,214,10,0.15)",
  },
  modeBtnText: {
    fontSize: 13,
    color: "#888",
    fontWeight: "600",
  },
  modeBtnTextActive: {
    color: "#fff",
  },
  costBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,214,10,0.08)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    alignSelf: "flex-start",
  },
  costText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFD60A",
  },
  costUsd: {
    fontSize: 12,
    color: "#999",
  },
  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#A855F7",
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 8,
  },
  submitBtnDisabled: {
    opacity: 0.5,
  },
  submitBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#fff",
  },
  imagePicker: {
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#2C2C2E",
    borderStyle: "dashed",
    overflow: "hidden",
    minHeight: 120,
  },
  imagePickerPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
    padding: 30,
    gap: 8,
  },
  imagePickerText: {
    fontSize: 13,
    color: "#666",
  },
  previewImage: {
    width: "100%",
    height: 200,
  },
  videoSelected: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 30,
  },
  videoSelectedText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#10B981",
  },
  imageSection: {
    gap: 6,
  },
  subTabRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  },
  subTab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#0A0A0B",
    borderWidth: 1,
    borderColor: "#2C2C2E",
  },
  subTabActive: {
    borderColor: "#A855F7",
    backgroundColor: "rgba(168,85,247,0.15)",
  },
  subTabText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#888",
  },
  subTabTextActive: {
    color: "#A855F7",
  },
  storyboardSection: {
    gap: 10,
  },
  shotCard: {
    backgroundColor: "#0A0A0B",
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "#2C2C2E",
    gap: 8,
  },
  shotHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  shotLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#A855F7",
    flex: 1,
  },
  shotDuration: {
    flexDirection: "row",
    gap: 4,
  },
  shotInput: {
    backgroundColor: "#1C1C1E",
    borderRadius: 8,
    padding: 10,
    color: "#fff",
    fontSize: 13,
    minHeight: 50,
    textAlignVertical: "top",
  },
  addShotBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#A855F7",
    borderStyle: "dashed",
  },
  addShotText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#A855F7",
  },
  miniBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "#1C1C1E",
    borderWidth: 1,
    borderColor: "#2C2C2E",
  },
  miniBtnActive: {
    borderColor: "#A855F7",
    backgroundColor: "rgba(168,85,247,0.15)",
  },
  miniBtnText: {
    fontSize: 11,
    color: "#888",
    fontWeight: "600",
  },
  miniBtnTextActive: {
    color: "#A855F7",
  },
  infoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: "rgba(59,130,246,0.08)",
    padding: 12,
    borderRadius: 10,
  },
  infoText: {
    fontSize: 12,
    color: "#aaa",
    flex: 1,
    lineHeight: 18,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
  },
  toggleText: {
    fontSize: 13,
    color: "#ccc",
    flex: 1,
  },
  toggle: {
    width: 44,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#2C2C2E",
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  toggleActive: {
    backgroundColor: "#10B981",
  },
  toggleDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#666",
  },
  toggleDotActive: {
    backgroundColor: "#fff",
    alignSelf: "flex-end",
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 0,
    marginVertical: 8,
  },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#2C2C2E",
    alignItems: "center",
    justifyContent: "center",
  },
  stepDotActive: {
    backgroundColor: "#EC4899",
  },
  stepNum: {
    fontSize: 13,
    fontWeight: "700",
    color: "#fff",
  },
  stepLine: {
    width: 60,
    height: 2,
    backgroundColor: "#2C2C2E",
  },
  stepLineActive: {
    backgroundColor: "#EC4899",
  },
  faceSection: {
    gap: 8,
  },
  faceGrid: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
  },
  faceCard: {
    width: 70,
    height: 70,
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "#2C2C2E",
  },
  faceCardSelected: {
    borderColor: "#10B981",
  },
  faceImage: {
    width: "100%",
    height: "100%",
  },
  faceCheck: {
    position: "absolute",
    bottom: 2,
    right: 2,
  },
  volumeRow: {
    gap: 6,
  },
  volumeBar: {
    flexDirection: "row",
    gap: 8,
  },
  volumeDot: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: "#0A0A0B",
    borderWidth: 1,
    borderColor: "#2C2C2E",
  },
  volumeDotActive: {
    borderColor: "#EC4899",
    backgroundColor: "rgba(236,72,153,0.15)",
  },
  volumeDotText: {
    fontSize: 12,
    color: "#ccc",
    fontWeight: "600",
  },
  taskSection: {
    marginTop: 24,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#fff",
    marginBottom: 4,
  },
  taskCard: {
    backgroundColor: "#1C1C1E",
    borderRadius: 12,
    padding: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: "#2C2C2E",
  },
  taskHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  taskType: {
    fontSize: 14,
    fontWeight: "600",
    color: "#fff",
    flex: 1,
  },
  taskStatus: {
    fontSize: 13,
    fontWeight: "600",
  },
  taskId: {
    fontSize: 11,
    color: "#666",
    fontFamily: Platform.OS === "web" ? "monospace" : undefined,
  },
  pollBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: "rgba(168,85,247,0.1)",
    borderWidth: 1,
    borderColor: "rgba(168,85,247,0.3)",
  },
  pollBtnText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#A855F7",
  },
  resultSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  resultText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#10B981",
    flex: 1,
  },
  downloadBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: "#A855F7",
  },
  downloadBtnText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#fff",
  },
  errorText: {
    fontSize: 12,
    color: "#EF4444",
  },
});
