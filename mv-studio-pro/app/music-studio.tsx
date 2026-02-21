/**
 * Suno 音乐工作室
 *
 * 参考 Suno 官网设计，提供两种模式：
 * - Simple：输入描述 + 选风格标签 → AI 自动生成歌曲
 * - Custom：手动填入歌词 + 选风格 + 高级选项 → 精细控制
 *
 * 引擎选择：V4（12 Credits）/ V5（22 Credits）
 */

import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Platform,
  Linking,
  StyleSheet,
  Alert,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  FadeIn,
  FadeInDown,
  SlideInRight,
} from "react-native-reanimated";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as Haptics from "expo-haptics";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";

// ─── 类型 ─────────────────────────────────────────
type Mode = "simple" | "custom";
type Engine = "V4" | "V5";
type GenerationStatus = "idle" | "generating" | "polling" | "success" | "error";

interface GeneratedSong {
  id: string;
  audioUrl: string;
  streamUrl?: string;
  imageUrl?: string;
  title: string;
  tags?: string;
  duration?: number;
}

// ─── 风格标签 ─────────────────────────────────────
const STYLE_TAGS = [
  { id: "pop", label: "流行", emoji: "🎵" },
  { id: "rock", label: "摇滚", emoji: "🎸" },
  { id: "electronic", label: "电子", emoji: "🎹" },
  { id: "hip_hop", label: "嘻哈", emoji: "🎤" },
  { id: "rnb", label: "R&B", emoji: "🎷" },
  { id: "jazz", label: "爵士", emoji: "🎺" },
  { id: "folk", label: "民谣", emoji: "🪕" },
  { id: "chinese", label: "中国风", emoji: "🏮" },
  { id: "anime", label: "日系动漫", emoji: "🌸" },
  { id: "kpop", label: "韩流", emoji: "💜" },
  { id: "cinematic", label: "电影配乐", emoji: "🎬" },
  { id: "lofi", label: "Lo-Fi", emoji: "☕" },
  { id: "ambient", label: "氛围", emoji: "🌊" },
  { id: "classical", label: "古典", emoji: "🎻" },
];

const MOOD_TAGS = [
  { id: "upbeat", label: "欢快", style: "Upbeat, Energetic, Bright" },
  { id: "emotional", label: "感人", style: "Emotional, Heartfelt, Gentle" },
  { id: "dark", label: "暗黑", style: "Dark, Mysterious, Intense" },
  { id: "dreamy", label: "梦幻", style: "Dreamy, Ethereal, Floating" },
  { id: "powerful", label: "震撼", style: "Powerful, Epic, Grand" },
  { id: "chill", label: "放松", style: "Chill, Relaxing, Smooth" },
  { id: "romantic", label: "浪漫", style: "Romantic, Warm, Sweet" },
  { id: "melancholy", label: "忧郁", style: "Melancholy, Sad, Reflective" },
];

// ─── 组件 ─────────────────────────────────────────
export default function MusicStudioScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // 状态
  const [mode, setMode] = useState<Mode>("simple");
  const [engine, setEngine] = useState<Engine>("V4");
  const [title, setTitle] = useState("");

  // Simple 模式
  const [description, setDescription] = useState("");
  const [selectedStyles, setSelectedStyles] = useState<string[]>([]);
  const [selectedMoods, setSelectedMoods] = useState<string[]>([]);
  const [instrumental, setInstrumental] = useState(false);

  // Custom 模式
  const [lyrics, setLyrics] = useState("");
  const [customStyle, setCustomStyle] = useState("");
  const [vocalGender, setVocalGender] = useState<"" | "male" | "female">("");

  // 生成状态
  const [status, setStatus] = useState<GenerationStatus>("idle");
  const [taskId, setTaskId] = useState("");
  const [songs, setSongs] = useState<GeneratedSong[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [creditCost, setCreditCost] = useState(0);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // tRPC mutations
  const generateMusic = trpc.suno.generateMusic.useMutation();
  const generateLyrics = trpc.suno.generateLyrics.useMutation();

  // 清理轮询
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  // ─── 风格标签切换 ──────────────────────────────
  const toggleStyle = useCallback((id: string) => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setSelectedStyles(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  }, []);

  const toggleMood = useCallback((id: string) => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setSelectedMoods(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  }, []);

  // ─── 构建风格字符串 ────────────────────────────
  const buildStyleString = (): string => {
    const parts: string[] = [];

    // 风格标签
    selectedStyles.forEach(id => {
      const tag = STYLE_TAGS.find(t => t.id === id);
      if (tag) parts.push(tag.label);
    });

    // 情绪标签
    selectedMoods.forEach(id => {
      const mood = MOOD_TAGS.find(m => m.id === id);
      if (mood) parts.push(mood.style);
    });

    // 人声性别
    if (vocalGender === "male") parts.push("Male Vocal");
    if (vocalGender === "female") parts.push("Female Vocal");

    return parts.join(", ") || "Pop, Modern";
  };

  // ─── 轮询任务状态 ──────────────────────────────
  const startPolling = useCallback((tid: string) => {
    setStatus("polling");
    let attempts = 0;
    const maxAttempts = 60; // 最多轮询 5 分钟

    pollingRef.current = setInterval(async () => {
      attempts++;
      if (attempts > maxAttempts) {
        if (pollingRef.current) clearInterval(pollingRef.current);
        setStatus("error");
        setErrorMsg("生成超时，请稍后在历史记录中查看结果");
        return;
      }

      try {
        const response = await fetch(
          `/api/trpc/suno.getTaskStatus?input=${encodeURIComponent(JSON.stringify({ taskId: tid }))}`,
          { credentials: "include" }
        );
        const json = await response.json();
        const data = json?.result?.data;

        if (!data) return;

        if (data.status === "SUCCESS") {
          if (pollingRef.current) clearInterval(pollingRef.current);
          setSongs(data.songs || []);
          setStatus("success");
          if (Platform.OS !== "web") {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
        } else if (data.status === "FAILED") {
          if (pollingRef.current) clearInterval(pollingRef.current);
          setStatus("error");
          setErrorMsg(data.errorMessage || "生成失败，请重试");
        }
      } catch {
        // 忽略单次轮询错误
      }
    }, 5000);
  }, []);

  // ─── 提交生成 ──────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }

    const songTitle = title.trim() || (mode === "simple" ? "AI 生成歌曲" : "自定义歌曲");

    // 验证
    if (mode === "simple" && !description.trim() && selectedStyles.length === 0) {
      Alert.alert("提示", "请输入歌曲描述或选择至少一个风格标签");
      return;
    }
    if (mode === "custom" && !lyrics.trim()) {
      Alert.alert("提示", "Custom 模式需要填入歌词");
      return;
    }

    setStatus("generating");
    setErrorMsg("");
    setSongs([]);

    try {
      const styleStr = mode === "custom" && customStyle.trim()
        ? customStyle.trim()
        : buildStyleString();

      const moodStr = selectedMoods
        .map(id => MOOD_TAGS.find(m => m.id === id)?.style)
        .filter(Boolean)
        .join(", ");

      if (mode === "simple") {
        // Simple 模式 → BGM 或带描述的歌曲
        const result = await generateMusic.mutateAsync({
          mode: instrumental ? "bgm" : "theme_song",
          model: engine,
          title: songTitle,
          lyrics: instrumental ? undefined : description.trim() || undefined,
          customStyle: styleStr || undefined,
          mood: moodStr || description.trim() || undefined,
        });

        setTaskId(result.taskId);
        setCreditCost(result.creditCost);
        startPolling(result.taskId);
      } else {
        // Custom 模式 → 主题曲（带歌词）
        const result = await generateMusic.mutateAsync({
          mode: "theme_song",
          model: engine,
          title: songTitle,
          lyrics: lyrics.trim(),
          mood: styleStr || undefined,
        });

        setTaskId(result.taskId);
        setCreditCost(result.creditCost);
        startPolling(result.taskId);
      }
    } catch (err: any) {
      setStatus("error");
      setErrorMsg(err?.message || "生成失败，请检查 Credits 余额后重试");
    }
  }, [mode, engine, title, description, lyrics, customStyle, selectedStyles, selectedMoods, instrumental, vocalGender, generateMusic, startPolling, buildStyleString]);

  // ─── AI 歌词助手 ──────────────────────────────
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [lyricsPrompt, setLyricsPrompt] = useState("");

  const handleGenerateLyrics = useCallback(async () => {
    if (!lyricsPrompt.trim()) {
      Alert.alert("提示", "请输入歌词主题或故事描述");
      return;
    }
    setLyricsLoading(true);
    try {
      const result = await generateLyrics.mutateAsync({
        script: lyricsPrompt.trim(),
        mood: selectedMoods.map(id => MOOD_TAGS.find(m => m.id === id)?.label).filter(Boolean).join("、") || "流行",
        language: "zh",
      });
      setLyrics(result.lyrics);
      setLyricsPrompt("");
    } catch (err: any) {
      Alert.alert("歌词生成失败", err?.message || "请稍后重试");
    } finally {
      setLyricsLoading(false);
    }
  }, [lyricsPrompt, selectedMoods, generateLyrics]);

  // ─── 重置 ──────────────────────────────────────
  const handleReset = useCallback(() => {
    setStatus("idle");
    setTaskId("");
    setSongs([]);
    setErrorMsg("");
    setDescription("");
    setLyrics("");
    setCustomStyle("");
    setTitle("");
    setSelectedStyles([]);
    setSelectedMoods([]);
    setVocalGender("");
    setInstrumental(false);
    if (pollingRef.current) clearInterval(pollingRef.current);
  }, []);

  // ─── 渲染 ──────────────────────────────────────
  const isGenerating = status === "generating" || status === "polling";

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
          >
            <MaterialIcons name="arrow-back" size={24} color="#F7F4EF" />
          </Pressable>
          <View style={styles.headerCenter}>
            <MaterialIcons name="music-note" size={22} color="#E8825E" />
            <Text style={styles.headerTitle}>音乐工作室</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        {/* Mode + Engine Selector */}
        <View style={styles.controlRow}>
          {/* Simple / Custom 切换 */}
          <View style={styles.modeSwitch}>
            <Pressable
              onPress={() => { setMode("simple"); if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              style={[styles.modeSwitchBtn, mode === "simple" && styles.modeSwitchBtnActive]}
            >
              <Text style={[styles.modeSwitchText, mode === "simple" && styles.modeSwitchTextActive]}>Simple</Text>
            </Pressable>
            <Pressable
              onPress={() => { setMode("custom"); if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              style={[styles.modeSwitchBtn, mode === "custom" && styles.modeSwitchBtnActive]}
            >
              <Text style={[styles.modeSwitchText, mode === "custom" && styles.modeSwitchTextActive]}>Custom</Text>
            </Pressable>
          </View>

          {/* Engine 选择 */}
          <View style={styles.engineSwitch}>
            <Pressable
              onPress={() => { setEngine("V4"); if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              style={[styles.engineBtn, engine === "V4" && styles.engineBtnActive]}
            >
              <Text style={[styles.engineText, engine === "V4" && styles.engineTextActive]}>V4</Text>
              <Text style={styles.engineCost}>12C</Text>
            </Pressable>
            <Pressable
              onPress={() => { setEngine("V5"); if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              style={[styles.engineBtn, engine === "V5" && styles.engineBtnActive]}
            >
              <Text style={[styles.engineText, engine === "V5" && styles.engineTextActive]}>V5</Text>
              <Text style={styles.engineCost}>22C</Text>
            </Pressable>
          </View>
        </View>

        {/* ═══ Simple 模式 ═══ */}
        {mode === "simple" && (
          <Animated.View entering={FadeIn.duration(250)}>
            {/* 歌曲描述 */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <MaterialIcons name="edit" size={16} color="#9B9691" />
                <Text style={styles.sectionTitle}>歌曲描述</Text>
              </View>
              <TextInput
                style={styles.descriptionInput}
                placeholder="描述你想要的歌曲，例如：一首关于夏天海边的轻快流行歌..."
                placeholderTextColor="#555"
                multiline
                maxLength={500}
                value={description}
                onChangeText={setDescription}
                textAlignVertical="top"
              />
              <Text style={styles.charCount}>{description.length}/500</Text>
            </View>

            {/* Instrumental 开关 */}
            <Pressable
              onPress={() => { setInstrumental(!instrumental); if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              style={({ pressed }) => [styles.instrumentalToggle, pressed && { opacity: 0.8 }]}
            >
              <MaterialIcons name="music-off" size={18} color={instrumental ? "#E8825E" : "#666"} />
              <Text style={[styles.instrumentalText, instrumental && { color: "#E8825E" }]}>
                纯音乐（无人声）
              </Text>
              <View style={[styles.toggleDot, instrumental && styles.toggleDotActive]} />
            </Pressable>
          </Animated.View>
        )}

        {/* ═══ Custom 模式 ═══ */}
        {mode === "custom" && (
          <Animated.View entering={FadeIn.duration(250)}>
            {/* 歌词输入 */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <MaterialIcons name="lyrics" size={16} color="#9B9691" />
                <Text style={styles.sectionTitle}>歌词</Text>
                <Text style={styles.sectionHint}>用 [Verse] [Chorus] [Bridge] 标记段落</Text>
              </View>
              <TextInput
                style={styles.lyricsInput}
                placeholder={"[Verse]\n在城市的霓虹灯下\n我们走过无数个夜晚\n\n[Chorus]\n让音乐带我们飞翔\n穿越时间的海洋..."}
                placeholderTextColor="#444"
                multiline
                maxLength={3000}
                value={lyrics}
                onChangeText={setLyrics}
                textAlignVertical="top"
              />
              <Text style={styles.charCount}>{lyrics.length}/3000</Text>
            </View>

            {/* AI 歌词助手 */}
            <View style={styles.lyricsAssistant}>
              <View style={styles.assistantHeader}>
                <MaterialIcons name="auto-awesome" size={16} color="#C77DBA" />
                <Text style={styles.assistantTitle}>AI 歌词助手</Text>
                <Text style={styles.assistantCost}>3 Credits</Text>
              </View>
              <View style={styles.assistantInputRow}>
                <TextInput
                  style={styles.assistantInput}
                  placeholder="输入主题或故事，AI 帮你写歌词..."
                  placeholderTextColor="#555"
                  value={lyricsPrompt}
                  onChangeText={setLyricsPrompt}
                  maxLength={500}
                />
                <Pressable
                  onPress={handleGenerateLyrics}
                  disabled={lyricsLoading}
                  style={({ pressed }) => [styles.assistantBtn, pressed && { opacity: 0.7 }, lyricsLoading && { opacity: 0.5 }]}
                >
                  {lyricsLoading ? (
                    <ActivityIndicator size="small" color="#FFF" />
                  ) : (
                    <MaterialIcons name="auto-fix-high" size={18} color="#FFF" />
                  )}
                </Pressable>
              </View>
            </View>

            {/* 自定义风格 */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <MaterialIcons name="tune" size={16} color="#9B9691" />
                <Text style={styles.sectionTitle}>自定义风格</Text>
                <Text style={styles.sectionHint}>可选</Text>
              </View>
              <TextInput
                style={styles.styleInput}
                placeholder="例如：Synthwave, Dark, Female Vocal, 80s Retro"
                placeholderTextColor="#555"
                value={customStyle}
                onChangeText={setCustomStyle}
                maxLength={500}
              />
            </View>

            {/* 人声性别 */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <MaterialIcons name="record-voice-over" size={16} color="#9B9691" />
                <Text style={styles.sectionTitle}>人声性别</Text>
              </View>
              <View style={styles.genderRow}>
                {(["", "male", "female"] as const).map(g => (
                  <Pressable
                    key={g || "auto"}
                    onPress={() => { setVocalGender(g); if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                    style={[styles.genderBtn, vocalGender === g && styles.genderBtnActive]}
                  >
                    <MaterialIcons
                      name={g === "male" ? "male" : g === "female" ? "female" : "auto-awesome"}
                      size={16}
                      color={vocalGender === g ? "#E8825E" : "#888"}
                    />
                    <Text style={[styles.genderText, vocalGender === g && styles.genderTextActive]}>
                      {g === "male" ? "男声" : g === "female" ? "女声" : "自动"}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </Animated.View>
        )}

        {/* ═══ 共用：风格标签 ═══ */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="style" size={16} color="#9B9691" />
            <Text style={styles.sectionTitle}>风格</Text>
          </View>
          <View style={styles.tagsGrid}>
            {STYLE_TAGS.map(tag => (
              <Pressable
                key={tag.id}
                onPress={() => toggleStyle(tag.id)}
                style={[styles.tag, selectedStyles.includes(tag.id) && styles.tagActive]}
              >
                <Text style={styles.tagEmoji}>{tag.emoji}</Text>
                <Text style={[styles.tagLabel, selectedStyles.includes(tag.id) && styles.tagLabelActive]}>
                  {tag.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* 情绪标签 */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="mood" size={16} color="#9B9691" />
            <Text style={styles.sectionTitle}>情绪</Text>
          </View>
          <View style={styles.tagsGrid}>
            {MOOD_TAGS.map(tag => (
              <Pressable
                key={tag.id}
                onPress={() => toggleMood(tag.id)}
                style={[styles.moodTag, selectedMoods.includes(tag.id) && styles.moodTagActive]}
              >
                <Text style={[styles.moodTagLabel, selectedMoods.includes(tag.id) && styles.moodTagLabelActive]}>
                  {tag.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* 歌曲标题 */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="title" size={16} color="#9B9691" />
            <Text style={styles.sectionTitle}>歌曲标题</Text>
            <Text style={styles.sectionHint}>可选</Text>
          </View>
          <TextInput
            style={styles.titleInput}
            placeholder="给你的歌曲起个名字..."
            placeholderTextColor="#555"
            value={title}
            onChangeText={setTitle}
            maxLength={80}
          />
        </View>

        {/* ═══ 生成结果 ═══ */}
        {status === "success" && songs.length > 0 && (
          <Animated.View entering={FadeInDown.duration(400)} style={styles.resultSection}>
            <View style={styles.resultHeader}>
              <MaterialIcons name="check-circle" size={20} color="#34C759" />
              <Text style={styles.resultTitle}>生成完成！</Text>
              <Text style={styles.resultCost}>消耗 {creditCost} Credits</Text>
            </View>
            {songs.map((song, idx) => (
              <View key={song.id || idx} style={styles.songCard}>
                <View style={styles.songInfo}>
                  <View style={styles.songIcon}>
                    <MaterialIcons name="music-note" size={24} color="#E8825E" />
                  </View>
                  <View style={styles.songMeta}>
                    <Text style={styles.songTitle} numberOfLines={1}>{song.title || `歌曲 ${idx + 1}`}</Text>
                    {song.tags && <Text style={styles.songTags} numberOfLines={1}>{song.tags}</Text>}
                    {song.duration && (
                      <Text style={styles.songDuration}>
                        {Math.floor(song.duration / 60)}:{String(Math.floor(song.duration % 60)).padStart(2, "0")}
                      </Text>
                    )}
                  </View>
                </View>
                <View style={styles.songActions}>
                  {song.audioUrl && (
                    <Pressable
                      onPress={() => {
                        if (Platform.OS === "web") {
                          window.open(song.audioUrl, "_blank");
                        } else {
                          Linking.openURL(song.audioUrl);
                        }
                      }}
                      style={({ pressed }) => [styles.playBtn, pressed && { opacity: 0.7 }]}
                    >
                      <MaterialIcons name="play-arrow" size={20} color="#FFF" />
                      <Text style={styles.playBtnText}>播放</Text>
                    </Pressable>
                  )}
                  {song.audioUrl && (
                    <Pressable
                      onPress={() => {
                        if (Platform.OS === "web") {
                          const a = document.createElement("a");
                          a.href = song.audioUrl;
                          a.download = `${song.title || "song"}.mp3`;
                          a.click();
                        } else {
                          Linking.openURL(song.audioUrl);
                        }
                      }}
                      style={({ pressed }) => [styles.downloadBtn, pressed && { opacity: 0.7 }]}
                    >
                      <MaterialIcons name="file-download" size={18} color="#E8825E" />
                    </Pressable>
                  )}
                </View>
              </View>
            ))}
          </Animated.View>
        )}

        {/* 错误提示 */}
        {status === "error" && (
          <Animated.View entering={FadeIn.duration(250)} style={styles.errorBox}>
            <MaterialIcons name="error-outline" size={20} color="#FF453A" />
            <Text style={styles.errorText}>{errorMsg}</Text>
          </Animated.View>
        )}
      </ScrollView>

      {/* ═══ 底部按钮 ═══ */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        {status === "success" ? (
          <Pressable
            onPress={handleReset}
            style={({ pressed }) => [styles.createBtn, pressed && { opacity: 0.9, transform: [{ scale: 0.97 }] }]}
          >
            <MaterialIcons name="refresh" size={20} color="#FFF" />
            <Text style={styles.createBtnText}>再来一首</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={handleGenerate}
            disabled={isGenerating}
            style={({ pressed }) => [
              styles.createBtn,
              pressed && !isGenerating && { opacity: 0.9, transform: [{ scale: 0.97 }] },
              isGenerating && styles.createBtnDisabled,
            ]}
          >
            {isGenerating ? (
              <>
                <ActivityIndicator size="small" color="#FFF" />
                <Text style={styles.createBtnText}>
                  {status === "generating" ? "提交中..." : "生成中，请稍候..."}
                </Text>
              </>
            ) : (
              <>
                <MaterialIcons name="music-note" size={20} color="#FFF" />
                <Text style={styles.createBtnText}>
                  生成 · {engine === "V4" ? "12" : "22"} Credits
                </Text>
              </>
            )}
          </Pressable>
        )}
      </View>
    </ScreenContainer>
  );
}

// ─── 样式 ─────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0C0A10",
  },
  content: {
    paddingHorizontal: 16,
  },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCenter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#F7F4EF",
  },

  // Control Row
  controlRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  modeSwitch: {
    flexDirection: "row",
    backgroundColor: "rgba(255,159,10,0.08)",
    borderRadius: 12,
    padding: 3,
  },
  modeSwitchBtn: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 10,
  },
  modeSwitchBtnActive: {
    backgroundColor: "#2A2A2E",
  },
  modeSwitchText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#666",
  },
  modeSwitchTextActive: {
    color: "#F7F4EF",
  },
  engineSwitch: {
    flexDirection: "row",
    gap: 8,
  },
  engineBtn: {
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: "#1A1A1D",
    borderWidth: 1,
    borderColor: "transparent",
  },
  engineBtnActive: {
    borderColor: "#E8825E",
    backgroundColor: "rgba(232,130,94,0.1)",
  },
  engineText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#666",
  },
  engineTextActive: {
    color: "#E8825E",
  },
  engineCost: {
    fontSize: 10,
    color: "#888",
    marginTop: 1,
  },

  // Section
  section: {
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#9B9691",
  },
  sectionHint: {
    fontSize: 11,
    color: "#555",
    marginLeft: 4,
  },

  // Description Input (Simple)
  descriptionInput: {
    backgroundColor: "#1A1A1D",
    borderRadius: 14,
    padding: 14,
    fontSize: 15,
    color: "#F7F4EF",
    minHeight: 100,
    lineHeight: 22,
    borderWidth: 1,
    borderColor: "#2A2A2E",
  },
  charCount: {
    fontSize: 11,
    color: "#555",
    textAlign: "right",
    marginTop: 4,
  },

  // Instrumental Toggle
  instrumentalToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#1A1A1D",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#2A2A2E",
  },
  instrumentalText: {
    flex: 1,
    fontSize: 14,
    color: "#888",
    fontWeight: "500",
  },
  toggleDot: {
    width: 42,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#333",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  toggleDotActive: {
    backgroundColor: "#E8825E",
    alignItems: "flex-end",
  },

  // Lyrics Input (Custom)
  lyricsInput: {
    backgroundColor: "#1A1A1D",
    borderRadius: 14,
    padding: 14,
    fontSize: 15,
    color: "#F7F4EF",
    minHeight: 180,
    lineHeight: 22,
    borderWidth: 1,
    borderColor: "#2A2A2E",
  },

  // Lyrics Assistant
  lyricsAssistant: {
    backgroundColor: "rgba(199,125,186,0.08)",
    borderRadius: 14,
    padding: 14,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "rgba(199,125,186,0.2)",
  },
  assistantHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 10,
  },
  assistantTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#C77DBA",
    flex: 1,
  },
  assistantCost: {
    fontSize: 11,
    color: "#888",
    backgroundColor: "#1A1A1D",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  assistantInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  assistantInput: {
    flex: 1,
    backgroundColor: "#1A1A1D",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: "#F7F4EF",
  },
  assistantBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: "#C77DBA",
    alignItems: "center",
    justifyContent: "center",
  },

  // Style Input (Custom)
  styleInput: {
    backgroundColor: "#1A1A1D",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: "#F7F4EF",
    borderWidth: 1,
    borderColor: "#2A2A2E",
  },

  // Gender
  genderRow: {
    flexDirection: "row",
    gap: 10,
  },
  genderBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "#1A1A1D",
    borderWidth: 1,
    borderColor: "#2A2A2E",
  },
  genderBtnActive: {
    borderColor: "#E8825E",
    backgroundColor: "rgba(232,130,94,0.1)",
  },
  genderText: {
    fontSize: 13,
    color: "#888",
    fontWeight: "500",
  },
  genderTextActive: {
    color: "#E8825E",
  },

  // Tags
  tagsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#1A1A1D",
    borderWidth: 1,
    borderColor: "#2A2A2E",
  },
  tagActive: {
    borderColor: "#E8825E",
    backgroundColor: "rgba(232,130,94,0.12)",
  },
  tagEmoji: {
    fontSize: 14,
  },
  tagLabel: {
    fontSize: 13,
    color: "#888",
    fontWeight: "500",
  },
  tagLabelActive: {
    color: "#E8825E",
  },
  moodTag: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#1A1A1D",
    borderWidth: 1,
    borderColor: "#2A2A2E",
  },
  moodTagActive: {
    borderColor: "#C77DBA",
    backgroundColor: "rgba(199,125,186,0.12)",
  },
  moodTagLabel: {
    fontSize: 13,
    color: "#888",
    fontWeight: "500",
  },
  moodTagLabelActive: {
    color: "#C77DBA",
  },

  // Title Input
  titleInput: {
    backgroundColor: "#1A1A1D",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: "#F7F4EF",
    borderWidth: 1,
    borderColor: "#2A2A2E",
  },

  // Result
  resultSection: {
    marginTop: 8,
    marginBottom: 20,
  },
  resultHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
  },
  resultTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#34C759",
    flex: 1,
  },
  resultCost: {
    fontSize: 12,
    color: "#888",
    backgroundColor: "#1A1A1D",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  songCard: {
    backgroundColor: "#1A1A1D",
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#2A2A2E",
  },
  songInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },
  songIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: "rgba(232,130,94,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  songMeta: {
    flex: 1,
  },
  songTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#F7F4EF",
  },
  songTags: {
    fontSize: 12,
    color: "#888",
    marginTop: 2,
  },
  songDuration: {
    fontSize: 12,
    color: "#666",
    marginTop: 2,
  },
  songActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  playBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
    backgroundColor: "#E8825E",
    borderRadius: 10,
    paddingVertical: 10,
    justifyContent: "center",
  },
  playBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#FFF",
  },
  downloadBtn: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: "rgba(232,130,94,0.12)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(232,130,94,0.25)",
  },

  // Error
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255,69,58,0.1)",
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "rgba(255,69,58,0.2)",
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: "#FF453A",
    lineHeight: 18,
  },

  // Bottom Bar
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: "rgba(16,16,18,0.95)",
    borderTopWidth: 0.5,
    borderTopColor: "#2A2A2E",
  },
  createBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: "#E8825E",
  },
  createBtnDisabled: {
    backgroundColor: "#555",
  },
  createBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFF",
  },
});
