import { useState, useCallback, useRef, useMemo } from "react";
import {
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Dimensions,
  Platform,
  Modal,
} from "react-native";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import * as Sharing from "expo-sharing";
import * as Clipboard from "expo-clipboard";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { showAlert, hapticImpact, hapticNotification } from "@/lib/web-utils";
import { MVVideoPlayerInline } from "@/components/mv-video-player";
import { SEOHead } from "@/components/seo-head";
import { MvReviewSection } from "@/components/mv-review-section";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

type SortKey = "publishDate" | "views" | "default";
type SortOrder = "asc" | "desc";

type MVItem = {
  id: string;
  title: string;
  subtitle: string;
  song: string;
  duration: string;
  durationSec: number;
  size: string;
  scenes: string[];
  effects: string[];
  mood: string;
  thumbnail: any;
  highlight: string;
  viralScore: number;
  format: string;
  resolution: string;
  lyricsCount: number;
  lyrics: string[];
  videoUrl: string;
  publishDate: string; // YYYY-MM-DD
  views: number;
};

/* ===== Real Lyrics - 意想爱 (shared by both songs) ===== */
const LYRICS_VERSE1 = [
  "落叶轻轻飘落 在windows' corner",
  "像极了当初 心动的模样",
  "我以为爱情 会像童话说的",
  "Prince holds my hands 就能到永远",
  "风吹过的季节 我学会沉默",
  "把眼泪藏进 in the dark night",
];
const LYRICS_PRECHORUS = [
  "谁说女人就该 wait and stay",
  "谁说我的幸福 要别人给的",
  "当月光洒下 照着孤单的我",
  "心里有个声音 开始慢慢醒了",
];
const LYRICS_CHORUS1 = [
  "这是意想爱 unexpected love",
  "像春风吹开 冰封已久的情怀",
  "我从没想过 会这样勇敢",
  "为一个人 把心门打开",
  "这是意想爱 意想之中的爱",
  "原来我一直 都在等待",
  "等待那个人 看穿我的伪装",
  "让我终于敢 去爱一场",
];
const LYRICS_VERSE2 = [
  "曾经以为爱 是一种负担",
  "会让人变软弱 失去方向感",
  "直到遇见你 才渐渐明白",
  "真正的爱 make me unafraid",
  "你不需要完美 我也不要光环",
  "两个不完美 却刚好互补的圆",
];
const LYRICS_BRIDGE = [
  "也曾经受伤 也曾经徬徨",
  "以为爱情只是 fantasy",
  "但你的温柔 一点一滴渗透",
  "融化了我 筑起的高墙",
  "爱不是运气 也不是注定",
  "是两个灵魂 愿意靠近的觉醒",
  "我不再逃避 也不再怀疑",
  "因为这份爱 it's my choice",
];
const LYRICS_FINAL = [
  "这是意想爱 unexpected love",
  "像春风吹开 冰封已久的情怀",
  "我从没想过 可以这样勇敢",
  "为一个人 把心门打开",
  "这是意想爱 我选择的爱",
  "不是谁给的 it's my destiny",
  "从此以后 rain or shine",
  "都一起承担 这份意想爱",
  "是我最美的答案",
];
const LYRICS_OUTRO = [
  "意想爱 意想爱",
  "意料之中 意料之外",
  "意想爱 make me unafraid",
  "终于明白 Love is brave",
];

const YWQS_MVS: MVItem[] = [
  {
    id: "ywqs_mv1",
    title: "红裙舞曲",
    subtitle: "副歌第一段高潮",
    song: "忆网情深 M&F",
    duration: "34.7s",
    durationSec: 34.7,
    size: "22.6MB",
    videoUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/nVaXOtnFWoIlIwgl.mp4",
    scenes: ["红裙优雅転身", "花房暖光场景", "字幕同步歌词", "舞蹈特写镜头"],
    effects: ["渐进缩放", "右移平移", "缩放回拉", "左移平移"],
    mood: "优雅浪漫",
    thumbnail: { uri: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/FMaQrMFVSirXzkvD.jpg" },
    highlight: "红裙舞蹈配合暖色调花房场景，视觉冲击力极强",
    viralScore: 95,
    format: "9:16 竖屏",
    resolution: "1080×1920",
    lyricsCount: 12,
    lyrics: [...LYRICS_CHORUS1, ...LYRICS_VERSE1.slice(0, 4)],
    publishDate: "2026-02-01",
    views: 58600,
  },
  {
    id: "ywqs_mv2",
    title: "城市夜曲",
    subtitle: "副歌第二段高潮",
    song: "忆网情深 M&F",
    duration: "3:26",
    durationSec: 206.8,
    size: "11.2MB",
    videoUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/xFrRgHsYXEyBwrbk.mp4",
    scenes: ["雨中城市街头", "吉他手特写", "蓝色霜虹灯光", "行人虚化背景"],
    effects: ["渐进缩放", "景深虚化", "右移平移", "缩放回拉"],
    mood: "都市感性",
    thumbnail: { uri: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/gjuvwUewnWpQtpRZ.jpg" },
    highlight: "雨中吉他手配合城市霓虹灯光，电影感极强",
    viralScore: 91,
    format: "9:16 竖屏",
    resolution: "544×960",
    lyricsCount: 12,
    lyrics: [...LYRICS_VERSE2, ...LYRICS_PRECHORUS, ...LYRICS_CHORUS1.slice(0, 2)],
    publishDate: "2026-01-28",
    views: 42300,
  },
  {
    id: "ywqs_mv3",
    title: "雨中深情",
    subtitle: "桥段高潮",
    song: "忆网情深 M&F",
    duration: "10.0s",
    durationSec: 10.0,
    size: "23.3MB",
    videoUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/RHktyzVRIArjQRMQ.mp4",
    scenes: ["街头麦克风演唱", "雨滴特写", "城市蓝调夜景", "唇形同步"],
    effects: ["渐进缩放", "景深虚化", "右移平移"],
    mood: "沈浸演唱",
    thumbnail: { uri: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/BrPAcibOmXsyMiua.jpg" },
    highlight: "雨中唇形同步演唱，沉浸感极强，抖音爆款潜力",
    viralScore: 93,
    format: "9:16 竖屏",
    resolution: "1072×1920",
    lyricsCount: 12,
    lyrics: [...LYRICS_BRIDGE, ...LYRICS_FINAL.slice(0, 4)],
    publishDate: "2026-01-20",
    views: 37800,
  },
  {
    id: "ywqs_mv4",
    title: "天使之翼",
    subtitle: "最终副歌",
    song: "忆网情深 M&F",
    duration: "5.4s",
    durationSec: 5.4,
    size: "10.3MB",
    videoUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/zPVbhqOJzROkfvad.mp4",
    scenes: ["黑翼天使花园", "奇幻特效展翼", "阳光透射树叶"],
    effects: ["渐进缩放", "缩放回拉", "左移平移"],
    mood: "奇幻梦幻",
    thumbnail: { uri: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/nthPJMSIfmabjtqj.jpg" },
    highlight: "黑翼天使造型配合花园场景，奇幻感满分",
    viralScore: 88,
    format: "9:16 竖屏",
    resolution: "704×1280",
    lyricsCount: 12,
    lyrics: [...LYRICS_FINAL, ...LYRICS_OUTRO.slice(0, 3)],
    publishDate: "2026-02-05",
    views: 29400,
  },
];

const YXA_MVS: MVItem[] = [
  {
    id: "yxa_mv1",
    title: "花园晨曦",
    subtitle: "副歌第一段高潮",
    song: "意想爱 韩风版",
    duration: "10.0s",
    durationSec: 10.0,
    size: "26.0MB",
    videoUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/iptvPNntjTJbiFzN.mp4",
    scenes: ["阳光花园唱跳", "自然光线透射", "户外活力场景"],
    effects: ["渐进缩放", "右移平移", "缩放回拉"],
    mood: "活力清新",
    thumbnail: { uri: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/hQnLktLWcgmziiqC.jpg" },
    highlight: "阳光花园配合活力唱跳，清新自然风格",
    viralScore: 86,
    format: "9:16 竖屏",
    resolution: "1076×1928",
    lyricsCount: 12,
    lyrics: [...LYRICS_CHORUS1, ...LYRICS_PRECHORUS],
    publishDate: "2026-02-01",
    views: 18900,
  },
  {
    id: "yxa_mv2",
    title: "微笑瞬间",
    subtitle: "副歌第二段高潮",
    song: "意想爱 韩风版",
    duration: "10.1s",
    durationSec: 10.1,
    size: "3.1MB",
    videoUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/IzJpdKpGDDZtSYrJ.mp4",
    scenes: ["花园微笑特写", "镜头由下往上追踪", "自然光线背光"],
    effects: ["镜头追踪", "上升运镜", "旋转缩放"],
    mood: "清新甜美",
    thumbnail: { uri: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/LpxiifHsrGYKIrGE.jpg" },
    highlight: "镜头追踪微笑特写，小红书风格满分",
    viralScore: 85,
    format: "9:16 竖屏",
    resolution: "720×1280",
    lyricsCount: 12,
    lyrics: [...LYRICS_VERSE2, ...LYRICS_CHORUS1.slice(0, 6)],
    publishDate: "2026-02-08",
    views: 15200,
  },
  {
    id: "yxa_mv3",
    title: "爱的旋律",
    subtitle: "桥段高潮",
    song: "意想爱 韩风版",
    duration: "8.0s",
    durationSec: 8.0,
    size: "18.1MB",
    videoUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/HNlwtOKbnwxeWYbd.mp4",
    scenes: ["涂鸦背景舞台", "舞蹈全身镜头", "舒开布光效果", "活力表演"],
    effects: ["全景固定", "渐进缩放", "右移平移"],
    mood: "活力舒开",
    thumbnail: { uri: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/CXzVPwztIGcraPfw.jpg" },
    highlight: "涂鸦背景+舞台灯光，视觉冲击力强，B站爆款潜力",
    viralScore: 90,
    format: "16:9 横屏",
    resolution: "1920×1080",
    lyricsCount: 12,
    lyrics: [...LYRICS_BRIDGE, ...LYRICS_OUTRO],
    publishDate: "2026-02-10",
    views: 34500,
  },
];

const ALL_MVS = [...YWQS_MVS, ...YXA_MVS];

export default function MVGalleryScreen() {
  const router = useRouter();
  const colors = useColors();
  const [activeTab, setActiveTab] = useState<"gallery" | "splice">("gallery");
  const [activeSong, setActiveSong] = useState<"ywqs" | "yxa">("ywqs");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [fullscreenVideo, setFullscreenVideo] = useState<MVItem | null>(null);

  // Sort state
  const [sortKey, setSortKey] = useState<SortKey>("default");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  // Splice state
  const [spliceList, setSpliceList] = useState<MVItem[]>([]);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [showSplicePreview, setShowSplicePreview] = useState(false);

  const baseMvs = activeSong === "ywqs" ? YWQS_MVS : YXA_MVS;

  const mvs = useMemo(() => {
    if (sortKey === "default") return baseMvs;
    const sorted = [...baseMvs].sort((a, b) => {
      if (sortKey === "publishDate") {
        const dateA = new Date(a.publishDate).getTime();
        const dateB = new Date(b.publishDate).getTime();
        return sortOrder === "desc" ? dateB - dateA : dateA - dateB;
      }
      if (sortKey === "views") {
        return sortOrder === "desc" ? b.views - a.views : a.views - b.views;
      }
      return 0;
    });
    return sorted;
  }, [baseMvs, sortKey, sortOrder]);

  const handleMainTabSwitch = useCallback((tab: "gallery" | "splice") => {
    hapticImpact(Haptics.ImpactFeedbackStyle.Light);
    setActiveTab(tab);
  }, []);

  const handleTabSwitch = useCallback((tab: "ywqs" | "yxa") => {
    hapticImpact(Haptics.ImpactFeedbackStyle.Light);
    setActiveSong(tab);
    setExpandedId(null);
  }, []);

  const handleSortChange = useCallback((key: SortKey) => {
    hapticImpact(Haptics.ImpactFeedbackStyle.Light);
    if (key === sortKey && key !== "default") {
      // Toggle order if same key
      setSortOrder(prev => prev === "desc" ? "asc" : "desc");
    } else {
      setSortKey(key);
      setSortOrder("desc");
    }
  }, [sortKey]);

  const formatViews = (views: number): string => {
    if (views >= 10000) return `${(views / 10000).toFixed(1)}万`;
    if (views >= 1000) return `${(views / 1000).toFixed(1)}K`;
    return String(views);
  };

  const toggleExpand = useCallback((id: string) => {
    hapticImpact(Haptics.ImpactFeedbackStyle.Light);
    setExpandedId(prev => prev === id ? null : id);
  }, []);

  const addToSplice = useCallback((item: MVItem) => {
    hapticNotification(Haptics.NotificationFeedbackType.Success);
    setSpliceList(prev => {
      if (prev.find(m => m.id === item.id)) return prev;
      return [...prev, item];
    });
  }, []);

  const removeFromSplice = useCallback((id: string) => {
    hapticImpact(Haptics.ImpactFeedbackStyle.Medium);
    setSpliceList(prev => prev.filter(m => m.id !== id));
  }, []);

  const moveItem = useCallback((fromIdx: number, toIdx: number) => {
    hapticImpact(Haptics.ImpactFeedbackStyle.Light);
    setSpliceList(prev => {
      const newList = [...prev];
      const [moved] = newList.splice(fromIdx, 1);
      newList.splice(toIdx, 0, moved);
      return newList;
    });
  }, []);

  const getTotalDuration = useCallback(() => {
    const total = spliceList.reduce((sum, m) => sum + m.durationSec, 0);
    const crossfades = Math.max(0, spliceList.length - 1) * 1.0;
    return Math.max(0, total - crossfades).toFixed(1);
  }, [spliceList]);

  const getScoreColor = (score: number) => {
    if (score >= 90) return "#22C55E";
    if (score >= 85) return "#0a7ea4";
    if (score >= 80) return "#F59E0B";
    return "#9BA1A6";
  };

  // ========== Gallery Tab ==========
  const renderMVCard = ({ item }: { item: MVItem }) => {
    const isExpanded = expandedId === item.id;
    const isInSplice = spliceList.some(m => m.id === item.id);
    return (
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => toggleExpand(item.id)}
        style={[styles.card, { backgroundColor: colors.surface, borderColor: isInSplice ? colors.primary : colors.border, borderWidth: isInSplice ? 2 : 1 }]}
      >
        {/* Thumbnail with play button */}
        <View style={styles.thumbnailContainer}>
          <Image source={item.thumbnail} style={styles.thumbnail} contentFit="cover" />
          <View style={styles.durationBadge}>
            <Text style={styles.durationText}>{item.duration}</Text>
          </View>
          <View style={[styles.scoreBadge, { backgroundColor: getScoreColor(item.viralScore) }]}>
            <Text style={styles.scoreText}>爆款 {item.viralScore}</Text>
          </View>
          {/* Format badge */}
          <View style={styles.formatBadge}>
            <Text style={styles.formatText}>{item.format}</Text>
          </View>
          {/* Play button overlay */}
          <TouchableOpacity
            onPress={(e) => {
              e.stopPropagation?.();
              hapticImpact(Haptics.ImpactFeedbackStyle.Medium);
              setFullscreenVideo(item);
            }}
            style={styles.playOverlayBtn}
            activeOpacity={0.8}
          >
            <View style={[styles.playCircle, { backgroundColor: playingId === item.id ? `${colors.error}cc` : "rgba(232, 130, 94, 0.85)" }]}>
              <MaterialIcons name={playingId === item.id ? "stop" : "play-arrow"} size={28} color="#FFFFFF" />
            </View>
          </TouchableOpacity>
        </View>

        {/* Info */}
        <View style={styles.cardInfo}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>{item.title}</Text>
              <Text style={[styles.cardSubtitle, { color: colors.muted }]}>{item.subtitle}</Text>
            </View>
            {/* Add to splice button */}
            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation?.();
                if (isInSplice) {
                  removeFromSplice(item.id);
                } else {
                  addToSplice(item);
                }
              }}
              style={[
                styles.addSpliceBtn,
                { backgroundColor: isInSplice ? colors.error : colors.primary },
              ]}
            >
              <Text style={styles.addSpliceBtnText}>{isInSplice ? "移除" : "+ 拼接"}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.metaRow}>
            <View style={[styles.moodTag, { backgroundColor: `${colors.primary}20` }]}>
              <Text style={[styles.moodText, { color: colors.primary }]}>{item.mood}</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={[styles.sizeText, { color: colors.muted }]}>{item.resolution}</Text>
              <Text style={[styles.sizeText, { color: colors.muted }]}>{item.size}</Text>
            </View>
          </View>
          {/* Views & Date row */}
          <View style={{ flexDirection: "row", alignItems: "center", marginTop: 6, gap: 12 }}>
            <View style={styles.viewsBadge}>
              <Text style={[styles.viewsText, { color: colors.muted }]}>{formatViews(item.views)} 次观看</Text>
            </View>
            <View style={styles.dateBadge}>
              <Text style={[styles.dateText, { color: colors.muted }]}>{item.publishDate}</Text>
            </View>
          </View>
          {/* Lyrics badge */}
          <View style={{ flexDirection: "row", alignItems: "center", marginTop: 6, gap: 6 }}>
            <View style={[styles.lyricsBadge, { backgroundColor: `${colors.success}20` }]}>
              <Text style={[styles.lyricsText, { color: colors.success }]}>♪ {item.lyrics.length} 行歌词字幕</Text>
            </View>
            <View style={[styles.lyricsBadge, { backgroundColor: `${colors.warning}20` }]}>
              <Text style={[styles.lyricsText, { color: colors.warning }]}>节奏同步</Text>
            </View>
          </View>
        </View>



        {/* Expanded Details */}
        {isExpanded && (
          <View style={[styles.expandedSection, { borderTopColor: colors.border }]}>
            <View style={[styles.highlightBox, { backgroundColor: `${colors.primary}15` }]}>
              <Text style={[styles.highlightLabel, { color: colors.primary }]}>爆款亮点</Text>
              <Text style={[styles.highlightText, { color: colors.foreground }]}>{item.highlight}</Text>
            </View>
            {/* Lyrics Section */}
            <Text style={[styles.sectionLabel, { color: colors.foreground }]}>歌词字幕</Text>
            <View style={[styles.lyricsBox, { backgroundColor: `${colors.surface}` }]}>
              {item.lyrics.map((line, idx) => (
                <Text key={idx} style={[styles.lyricLine, { color: colors.foreground }]}>
                  {line}
                </Text>
              ))}
            </View>

            <Text style={[styles.sectionLabel, { color: colors.foreground, marginTop: 16 }]}>场景串行</Text>
            {item.scenes.map((scene, idx) => (
              <View key={idx} style={styles.sceneRow}>
                <View style={[styles.sceneNumber, { backgroundColor: colors.primary }]}>
                  <Text style={styles.sceneNumberText}>{idx + 1}</Text>
                </View>
                <View style={styles.sceneInfo}>
                  <Text style={[styles.sceneName, { color: colors.foreground }]}>{scene}</Text>
                  <Text style={[styles.sceneEffect, { color: colors.muted }]}>{item.effects[idx]}</Text>
                </View>
              </View>
            ))}
            <Text style={[styles.sectionLabel, { color: colors.foreground, marginTop: 16 }]}>爆款因素分析</Text>
            <View style={styles.viralFactors}>
              {[
                { label: "视觉冲击", score: Math.min(100, item.viralScore + 5) },
                { label: "情感共鸣", score: Math.min(100, item.viralScore + 2) },
                { label: "场景多样", score: Math.min(100, item.viralScore - 3) },
                { label: "节奏匹配", score: Math.min(100, item.viralScore + 1) },
              ].map((factor, idx) => (
                <View key={idx} style={styles.factorRow}>
                  <Text style={[styles.factorLabel, { color: colors.muted }]}>{factor.label}</Text>
                  <View style={[styles.factorBar, { backgroundColor: `${colors.border}50` }]}>
                    <View style={[styles.factorFill, { width: `${factor.score}%`, backgroundColor: getScoreColor(factor.score) }]} />
                  </View>
                  <Text style={[styles.factorScore, { color: colors.foreground }]}>{factor.score}</Text>
                </View>
              ))}
            </View>

            {/* Review & Rating Section */}
            <MvReviewSection mvId={item.id} mvTitle={item.title} />
          </View>
        )}
      </TouchableOpacity>
    );
  };

  // ========== Splice Tab ==========
  const renderSpliceItem = (item: MVItem, index: number) => {
    const isDragging = dragIdx === index;
    return (
      <View
        key={item.id}
        style={[
          styles.spliceCard,
          {
            backgroundColor: isDragging ? `${colors.primary}30` : colors.surface,
            borderColor: isDragging ? colors.primary : colors.border,
            borderWidth: isDragging ? 2 : 1,
          },
        ]}
      >
        {/* Drag handle + order number */}
        <View style={styles.spliceLeft}>
          <View style={[styles.orderBadge, { backgroundColor: colors.primary }]}>
            <Text style={styles.orderText}>{index + 1}</Text>
          </View>
        </View>

        {/* Thumbnail */}
        <Image source={item.thumbnail} style={styles.spliceThumbnail} contentFit="cover" />

        {/* Info */}
        <View style={styles.spliceInfo}>
          <Text style={[styles.spliceTitle, { color: colors.foreground }]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={[styles.spliceMeta, { color: colors.muted }]}>
            {item.song} · {item.duration}
          </Text>
        </View>

        {/* Move buttons */}
        <View style={styles.moveButtons}>
          {index > 0 && (
            <TouchableOpacity
              onPress={() => moveItem(index, index - 1)}
              style={[styles.moveBtn, { backgroundColor: `${colors.primary}20` }]}
            >
              <Text style={[styles.moveBtnText, { color: colors.primary }]}>↑</Text>
            </TouchableOpacity>
          )}
          {index < spliceList.length - 1 && (
            <TouchableOpacity
              onPress={() => moveItem(index, index + 1)}
              style={[styles.moveBtn, { backgroundColor: `${colors.primary}20` }]}
            >
              <Text style={[styles.moveBtnText, { color: colors.primary }]}>↓</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Remove button */}
        <TouchableOpacity
          onPress={() => removeFromSplice(item.id)}
          style={[styles.removeBtn, { backgroundColor: `${colors.error}20` }]}
        >
          <Text style={[styles.removeBtnText, { color: colors.error }]}>✕</Text>
        </TouchableOpacity>

        {/* Transition indicator */}
        {index < spliceList.length - 1 && (
          <View style={[styles.transitionIndicator, { borderColor: colors.border }]}>
            <View style={[styles.transitionDot, { backgroundColor: colors.primary }]} />
            <Text style={[styles.transitionText, { color: colors.muted }]}>1s 交叉淡入淡出</Text>
            <View style={[styles.transitionDot, { backgroundColor: colors.primary }]} />
          </View>
        )}
      </View>
    );
  };

  const renderSplicePreviewModal = () => (
    <Modal visible={showSplicePreview} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>拼接预览</Text>
            <TouchableOpacity onPress={() => setShowSplicePreview(false)}>
              <Text style={[styles.modalClose, { color: colors.primary }]}>关闭</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
            {/* Timeline visualization */}
            <Text style={[styles.previewSectionTitle, { color: colors.foreground }]}>时间轴</Text>
            <View style={styles.timeline}>
              {spliceList.map((item, idx) => {
                const widthPercent = (item.durationSec / spliceList.reduce((s, m) => s + m.durationSec, 0)) * 100;
                return (
                  <View key={item.id} style={[styles.timelineSegment, { width: `${widthPercent}%` }]}>
                    <View style={[styles.timelineBar, { backgroundColor: getScoreColor(item.viralScore) }]} />
                    <Text style={[styles.timelineLabel, { color: colors.muted }]} numberOfLines={1}>
                      {item.title}
                    </Text>
                  </View>
                );
              })}
            </View>

            {/* Stats */}
            <View style={[styles.previewStats, { backgroundColor: colors.surface }]}>
              <View style={styles.previewStatItem}>
                <Text style={[styles.previewStatValue, { color: colors.primary }]}>{spliceList.length}</Text>
                <Text style={[styles.previewStatLabel, { color: colors.muted }]}>片段数</Text>
              </View>
              <View style={styles.previewStatItem}>
                <Text style={[styles.previewStatValue, { color: colors.primary }]}>{getTotalDuration()}s</Text>
                <Text style={[styles.previewStatLabel, { color: colors.muted }]}>总时长</Text>
              </View>
              <View style={styles.previewStatItem}>
                <Text style={[styles.previewStatValue, { color: colors.primary }]}>
                  {Math.max(0, spliceList.length - 1)}
                </Text>
                <Text style={[styles.previewStatLabel, { color: colors.muted }]}>过渡效果</Text>
              </View>
              <View style={styles.previewStatItem}>
                <Text style={[styles.previewStatValue, { color: getScoreColor(Math.round(spliceList.reduce((s, m) => s + m.viralScore, 0) / spliceList.length)) }]}>
                  {Math.round(spliceList.reduce((s, m) => s + m.viralScore, 0) / spliceList.length)}
                </Text>
                <Text style={[styles.previewStatLabel, { color: colors.muted }]}>平均爆款分</Text>
              </View>
            </View>

            {/* Sequence */}
            <Text style={[styles.previewSectionTitle, { color: colors.foreground }]}>片段串行</Text>
            {spliceList.map((item, idx) => (
              <View key={item.id}>
                <View style={[styles.sequenceCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={[styles.seqNumber, { backgroundColor: colors.primary }]}>
                    <Text style={styles.seqNumberText}>{idx + 1}</Text>
                  </View>
                  <Image source={item.thumbnail} style={styles.seqThumb} contentFit="cover" />
                  <View style={styles.seqInfo}>
                    <Text style={[styles.seqTitle, { color: colors.foreground }]}>{item.title}</Text>
                    <Text style={[styles.seqMeta, { color: colors.muted }]}>{item.song}</Text>
                    <Text style={[styles.seqMeta, { color: colors.muted }]}>{item.duration} · {item.mood}</Text>
                  </View>
                </View>
                {idx < spliceList.length - 1 && (
                  <View style={styles.seqTransition}>
                    <View style={[styles.seqTransLine, { backgroundColor: colors.primary }]} />
                    <Text style={[styles.seqTransText, { color: colors.primary }]}>↓ 1s crossfade</Text>
                    <View style={[styles.seqTransLine, { backgroundColor: colors.primary }]} />
                  </View>
                )}
              </View>
            ))}

            {/* Export info */}
            <View style={[styles.exportInfo, { backgroundColor: `${colors.primary}10`, borderColor: colors.primary }]}>
              <Text style={[styles.exportTitle, { color: colors.primary }]}>导出设置</Text>
              <Text style={[styles.exportDetail, { color: colors.foreground }]}>
                分辨率：1080×1920 (9:16 竖屏){"\n"}
                格式：MP4 H.264{"\n"}
                过渡：1秒交叉淡入淡出{"\n"}
                字幕：保留所有动态歌词字幕{"\n"}
                预计时长：{getTotalDuration()}秒{"\n"}
                预计大小：{(spliceList.reduce((s, m) => s + parseFloat(m.size), 0) * 0.9).toFixed(1)}MB
              </Text>
            </View>

            {/* Export button */}
            <TouchableOpacity
              onPress={() => {
                hapticNotification(Haptics.NotificationFeedbackType.Success);
                showAlert("拼接任务已提交", `正在拼接 ${spliceList.length} 个片段为长视频...\n预计时长：${getTotalDuration()}秒\n完成后将自动保存到本地`);
                setShowSplicePreview(false);
              }}
              style={[styles.exportBtn, { backgroundColor: colors.primary }]}
            >
              <Text style={styles.exportBtnText}>开始拼接导出</Text>
            </TouchableOpacity>

            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <SEOHead
        title="精华视频展厅"
       description="7支精选视频作品展厅，支持在线播放、排序筛选、片段拼接，打造您的专属视频合辑"
        ogUrl="https://mvstudiopro.com/mv-gallery"
      />
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.backBtn, { backgroundColor: colors.surface }]}
        >
          <Text style={[styles.backText, { color: colors.primary }]}>← 返回</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>精华 视频展厅</Text>
        <View style={styles.headerRight}>
          {spliceList.length > 0 && (
            <View style={[styles.spliceBadge, { backgroundColor: colors.primary }]}>
              <Text style={styles.spliceBadgeText}>{spliceList.length}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Main Tabs: Gallery / Splice */}
      <View style={[styles.mainTabBar, { backgroundColor: colors.surface }]}>
        <TouchableOpacity
          onPress={() => handleMainTabSwitch("gallery")}
          style={[styles.mainTab, activeTab === "gallery" && { backgroundColor: colors.primary }]}
        >
          <Text style={[styles.mainTabText, { color: activeTab === "gallery" ? "#fff" : colors.muted }]}>
            视频展厅
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => handleMainTabSwitch("splice")}
          style={[styles.mainTab, activeTab === "splice" && { backgroundColor: colors.primary }]}
        >
          <Text style={[styles.mainTabText, { color: activeTab === "splice" ? "#fff" : colors.muted }]}>
            拼接工坊 {spliceList.length > 0 ? `(${spliceList.length})` : ""}
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === "gallery" ? (
        <>
          {/* Song Tabs */}
          <View style={[styles.tabBar, { backgroundColor: colors.surface }]}>
            <TouchableOpacity
              onPress={() => handleTabSwitch("ywqs")}
              style={[styles.tab, activeSong === "ywqs" && { backgroundColor: colors.primary }]}
            >
              <Text style={[styles.tabText, { color: activeSong === "ywqs" ? "#fff" : colors.muted }]}>
                忆网情深 M&F
              </Text>
              <Text style={[styles.tabCount, { color: activeSong === "ywqs" ? "#ffffffcc" : colors.muted }]}>
                4支 · 多风格
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => handleTabSwitch("yxa")}
              style={[styles.tab, activeSong === "yxa" && { backgroundColor: colors.primary }]}
            >
              <Text style={[styles.tabText, { color: activeSong === "yxa" ? "#fff" : colors.muted }]}>
                意想爱 韩风版
              </Text>
              <Text style={[styles.tabCount, { color: activeSong === "yxa" ? "#ffffffcc" : colors.muted }]}>
                3支 · 多风格
              </Text>
            </TouchableOpacity>
          </View>

          {/* Stats Banner */}
          <View style={[styles.statsBanner, { backgroundColor: `${colors.primary}10` }]}>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.primary }]}>7</Text>
              <Text style={[styles.statLabel, { color: colors.muted }]}>精选作品</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.primary }]}>5</Text>
              <Text style={[styles.statLabel, { color: colors.muted }]}>创意风格</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: getScoreColor(90) }]}>90</Text>
              <Text style={[styles.statLabel, { color: colors.muted }]}>平均爆款分</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.success }]}>12行</Text>
              <Text style={[styles.statLabel, { color: colors.muted }]}>歌词/首</Text>
            </View>
          </View>

          {/* Sort Filter */}
          <View style={styles.sortFilterContainer}>
            <Text style={[styles.sortLabel, { color: colors.muted }]}>排序</Text>
            <View style={styles.sortButtons}>
              <TouchableOpacity
                onPress={() => handleSortChange("default")}
                style={[
                  styles.sortBtn,
                  { backgroundColor: sortKey === "default" ? colors.primary : `${colors.surface}` },
                  sortKey === "default" && styles.sortBtnActive,
                ]}
              >
                <Text style={[
                  styles.sortBtnText,
                  { color: sortKey === "default" ? "#fff" : colors.muted },
                ]}>默认</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleSortChange("publishDate")}
                style={[
                  styles.sortBtn,
                  { backgroundColor: sortKey === "publishDate" ? colors.primary : `${colors.surface}` },
                  sortKey === "publishDate" && styles.sortBtnActive,
                ]}
              >
                <Text style={[
                  styles.sortBtnText,
                  { color: sortKey === "publishDate" ? "#fff" : colors.muted },
                ]}>发布日期 {sortKey === "publishDate" ? (sortOrder === "desc" ? "↓" : "↑") : ""}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleSortChange("views")}
                style={[
                  styles.sortBtn,
                  { backgroundColor: sortKey === "views" ? colors.primary : `${colors.surface}` },
                  sortKey === "views" && styles.sortBtnActive,
                ]}
              >
                <Text style={[
                  styles.sortBtnText,
                  { color: sortKey === "views" ? "#fff" : colors.muted },
                ]}>观看次数 {sortKey === "views" ? (sortOrder === "desc" ? "↓" : "↑") : ""}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* MV List */}
          <FlatList
            data={mvs}
            renderItem={renderMVCard}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={() => <View style={{ height: 16 }} />}
            ListFooterComponent={<View style={{ height: 100 }} />}
          />
        </>
      ) : (
        /* ========== Splice Tab Content ========== */
        <ScrollView showsVerticalScrollIndicator={false}>
          {spliceList.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={[styles.emptyIcon, { color: colors.muted }]}>🎬</Text>
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>拼接工坊</Text>
              <Text style={[styles.emptyDesc, { color: colors.muted }]}>
                在「视频展厅」中点击「+ 拼接」按钮{"\n"}将片段添加到这里，然后拖拽排序{"\n"}拼接为一个完整的长视频
              </Text>
              <TouchableOpacity
                onPress={() => handleMainTabSwitch("gallery")}
                style={[styles.goGalleryBtn, { backgroundColor: colors.primary }]}
              >
                <Text style={styles.goGalleryText}>去选择片段</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.spliceContent}>
              {/* Splice header stats */}
              <View style={[styles.spliceStats, { backgroundColor: `${colors.primary}10` }]}>
                <View style={styles.spliceStatItem}>
                  <Text style={[styles.spliceStatValue, { color: colors.primary }]}>{spliceList.length}</Text>
                  <Text style={[styles.spliceStatLabel, { color: colors.muted }]}>片段</Text>
                </View>
                <View style={styles.spliceStatItem}>
                  <Text style={[styles.spliceStatValue, { color: colors.primary }]}>{getTotalDuration()}s</Text>
                  <Text style={[styles.spliceStatLabel, { color: colors.muted }]}>总时长</Text>
                </View>
                <View style={styles.spliceStatItem}>
                  <Text style={[styles.spliceStatValue, { color: colors.primary }]}>
                    {Math.max(0, spliceList.length - 1)}
                  </Text>
                  <Text style={[styles.spliceStatLabel, { color: colors.muted }]}>过渡</Text>
                </View>
              </View>

              {/* Instruction */}
              <View style={[styles.instructionBox, { backgroundColor: `${colors.warning}15` }]}>
                <Text style={[styles.instructionText, { color: colors.warning }]}>
                  使用 ↑↓ 按钮调整片段顺序，✕ 移除片段
                </Text>
              </View>

              {/* Splice list */}
              {spliceList.map((item, index) => renderSpliceItem(item, index))}

              {/* Quick add buttons */}
              <Text style={[styles.quickAddTitle, { color: colors.foreground }]}>快速添加</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.quickAddScroll}>
                {ALL_MVS.filter(m => !spliceList.find(s => s.id === m.id)).map(item => (
                  <TouchableOpacity
                    key={item.id}
                    onPress={() => addToSplice(item)}
                    style={[styles.quickAddCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
                  >
                    <Image source={item.thumbnail} style={styles.quickAddThumb} contentFit="cover" />
                    <Text style={[styles.quickAddName, { color: colors.foreground }]} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text style={[styles.quickAddMeta, { color: colors.muted }]}>{item.duration}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Action buttons */}
              <View style={styles.spliceActions}>
                <TouchableOpacity
                  onPress={() => {
                    hapticImpact(Haptics.ImpactFeedbackStyle.Medium);
                    setShowSplicePreview(true);
                  }}
                  style={[styles.previewBtn, { backgroundColor: colors.primary }]}
                >
                  <Text style={styles.previewBtnText}>预览并导出拼接视频</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    hapticImpact(Haptics.ImpactFeedbackStyle.Medium);
                    setSpliceList([]);
                  }}
                  style={[styles.clearBtn, { borderColor: colors.error }]}
                >
                  <Text style={[styles.clearBtnText, { color: colors.error }]}>清空列表</Text>
                </TouchableOpacity>
              </View>

              <View style={{ height: 100 }} />
            </View>
          )}
        </ScrollView>
      )}

      {/* Splice Preview Modal */}
      {renderSplicePreviewModal()}

      {/* Fullscreen Video Modal */}
      {fullscreenVideo && (
        <Modal visible={true} animationType="fade" onRequestClose={() => setFullscreenVideo(null)}>
          <View style={{ flex: 1, backgroundColor: "#000" }}>
            <TouchableOpacity
              onPress={() => setFullscreenVideo(null)}
              style={{ position: "absolute", top: 50, right: 20, zIndex: 10, backgroundColor: "rgba(0,0,0,0.6)", padding: 12, borderRadius: 20 }}
            >
              <MaterialIcons name="close" size={28} color="#FFF" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={async () => {
                hapticImpact(Haptics.ImpactFeedbackStyle.Medium);
                const shareUrl = `https://www.mvstudiopro.com/mv-gallery?mv=${fullscreenVideo.id}`;
                if (await Sharing.isAvailableAsync()) {
                  await Sharing.shareAsync(fullscreenVideo.videoUrl, { dialogTitle: `分享 ${fullscreenVideo.title}` });
                } else {
                  await Clipboard.setStringAsync(shareUrl);
                  showAlert("链接已拷贝", `视频链接已拷贝到剪贴板：${shareUrl}`);
                }
              }}
              style={{ position: "absolute", top: 50, right: 80, zIndex: 10, backgroundColor: "rgba(232, 130, 94, 0.85)", padding: 12, borderRadius: 20 }}
            >
              <MaterialIcons name="share" size={28} color="#FFF" />
            </TouchableOpacity>
            <MVVideoPlayerInline
              videoUrl={fullscreenVideo.videoUrl}
              title={`${fullscreenVideo.song} - ${fullscreenVideo.title}`}
              onClose={() => setFullscreenVideo(null)}
            />
          </View>
        </Modal>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
  },
  backBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  backText: { fontSize: 16, fontWeight: "500", letterSpacing: 0.1 },
  headerTitle: { fontSize: 19, fontWeight: "600", letterSpacing: -0.3 },
  headerRight: { width: 40, alignItems: "flex-end" },
  spliceBadge: {
    width: 24, height: 24, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
  },
  spliceBadgeText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  mainTabBar: {
    flexDirection: "row", marginHorizontal: 20, marginTop: 14,
    borderRadius: 14, padding: 4,
  },
  mainTab: { flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 12 },
  mainTabText: { fontSize: 15, fontWeight: "500", letterSpacing: 0.1 },
  tabBar: {
    flexDirection: "row", marginHorizontal: 20, marginTop: 10,
    borderRadius: 14, padding: 4,
  },
  tab: { flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 12 },
  tabText: { fontSize: 15, fontWeight: "500", letterSpacing: 0.1 },
  tabCount: { fontSize: 11, marginTop: 2 },
  statsBanner: {
    flexDirection: "row", marginHorizontal: 20, marginTop: 14,
    borderRadius: 16, paddingVertical: 14, paddingHorizontal: 10, alignItems: "center",
  },
  statItem: { flex: 1, alignItems: "center" },
  statValue: { fontSize: 14, fontWeight: "700" },
  statLabel: { fontSize: 10, marginTop: 2 },
  statDivider: { width: 1, height: 24 },
  listContent: { paddingHorizontal: 16, paddingTop: 18 },
  card: { borderRadius: 20, overflow: "hidden" },
  thumbnailContainer: { position: "relative", aspectRatio: 9 / 16, backgroundColor: "#0A0A0A" },
  thumbnail: { width: "100%", height: "100%" },
  durationBadge: {
    position: "absolute", bottom: 8, right: 8,
    backgroundColor: "rgba(0,0,0,0.7)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6,
  },
  durationText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  scoreBadge: {
    position: "absolute", top: 8, right: 8,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
  },
  scoreText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  formatBadge: {
    position: "absolute", top: 8, left: 8,
    backgroundColor: "rgba(0,0,0,0.7)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6,
  },
  formatText: { color: "#fff", fontSize: 11, fontWeight: "600" },
  cardInfo: { padding: 18 },
  cardTitle: { fontSize: 21, fontWeight: "700", letterSpacing: -0.3 },
  cardSubtitle: { fontSize: 15, marginTop: 6, letterSpacing: 0.1 },
  addSpliceBtn: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
  },
  addSpliceBtnText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  metaRow: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", marginTop: 10,
  },
  moodTag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  moodText: { fontSize: 12, fontWeight: "600" },
  sizeText: { fontSize: 12 },
  lyricsBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  lyricsText: { fontSize: 11, fontWeight: "600" },
  lyricsBox: {
    padding: 14,
    borderRadius: 10,
    marginBottom: 14,
    gap: 6,
  },
  lyricLine: {
    fontSize: 14,
    lineHeight: 22,
    letterSpacing: 0.2,
  },
  expandedSection: { padding: 14, borderTopWidth: 0.5 },
  highlightBox: { padding: 12, borderRadius: 10, marginBottom: 14 },
  highlightLabel: { fontSize: 12, fontWeight: "700", marginBottom: 4 },
  highlightText: { fontSize: 14, lineHeight: 22, letterSpacing: 0.1 },
  sectionLabel: { fontSize: 15, fontWeight: "600", marginBottom: 12, letterSpacing: -0.1 },
  sceneRow: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  sceneNumber: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  sceneNumberText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  sceneInfo: { marginLeft: 10, flex: 1 },
  sceneName: { fontSize: 14, fontWeight: "600", letterSpacing: -0.1 },
  sceneEffect: { fontSize: 11, marginTop: 2 },
  viralFactors: { gap: 8 },
  factorRow: { flexDirection: "row", alignItems: "center" },
  factorLabel: { width: 70, fontSize: 12 },
  factorBar: { flex: 1, height: 8, borderRadius: 4, marginHorizontal: 8, overflow: "hidden" },
  factorFill: { height: "100%", borderRadius: 4 },
  factorScore: { width: 30, fontSize: 12, fontWeight: "600", textAlign: "right" },
  // Splice styles
  emptyState: { alignItems: "center", paddingTop: 80, paddingHorizontal: 40 },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { fontSize: 24, fontWeight: "600", marginBottom: 14, letterSpacing: -0.5 },
  emptyDesc: { fontSize: 15, lineHeight: 24, textAlign: "center", marginBottom: 28, letterSpacing: 0.1 },
  goGalleryBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  goGalleryText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  spliceContent: { paddingHorizontal: 20, paddingTop: 18 },
  spliceStats: {
    flexDirection: "row", borderRadius: 12, paddingVertical: 14, paddingHorizontal: 16,
    justifyContent: "space-around",
  },
  spliceStatItem: { alignItems: "center" },
  spliceStatValue: { fontSize: 20, fontWeight: "700" },
  spliceStatLabel: { fontSize: 11, marginTop: 2 },
  instructionBox: { padding: 10, borderRadius: 8, marginTop: 12, marginBottom: 12 },
  instructionText: { fontSize: 12, fontWeight: "600", textAlign: "center" },
  spliceCard: {
    flexDirection: "row", alignItems: "center", borderRadius: 12,
    padding: 10, marginBottom: 4, position: "relative",
  },
  spliceLeft: { marginRight: 10 },
  orderBadge: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
  },
  orderText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  spliceThumbnail: { width: 56, height: 56, borderRadius: 8 },
  spliceInfo: { flex: 1, marginLeft: 10 },
  spliceTitle: { fontSize: 14, fontWeight: "700" },
  spliceMeta: { fontSize: 11, marginTop: 2 },
  moveButtons: { flexDirection: "column", gap: 4, marginRight: 8 },
  moveBtn: { width: 28, height: 28, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  moveBtnText: { fontSize: 14, fontWeight: "700" },
  removeBtn: { width: 28, height: 28, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  removeBtnText: { fontSize: 14, fontWeight: "700" },
  transitionIndicator: {
    position: "absolute", bottom: -12, left: 48, right: 48,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
  },
  transitionDot: { width: 4, height: 4, borderRadius: 2 },
  transitionText: { fontSize: 9 },
  quickAddTitle: { fontSize: 15, fontWeight: "700", marginTop: 20, marginBottom: 10 },
  quickAddScroll: { marginBottom: 20 },
  quickAddCard: {
    width: 100, borderRadius: 10, borderWidth: 1, overflow: "hidden", marginRight: 10,
  },
  quickAddThumb: { width: 100, height: 70 },
  quickAddName: { fontSize: 11, fontWeight: "600", paddingHorizontal: 6, paddingTop: 4 },
  quickAddMeta: { fontSize: 10, paddingHorizontal: 6, paddingBottom: 6 },
  spliceActions: { gap: 12, marginTop: 8 },
  previewBtn: { paddingVertical: 16, borderRadius: 14, alignItems: "center" },
  previewBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  clearBtn: { paddingVertical: 14, borderRadius: 14, alignItems: "center", borderWidth: 1.5 },
  clearBtnText: { fontSize: 15, fontWeight: "600" },
  // Modal styles
  modalOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalContent: { borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "90%" },
  modalHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 0.5,
  },
  modalTitle: { fontSize: 19, fontWeight: "600", letterSpacing: -0.3 },
  modalClose: { fontSize: 16, fontWeight: "500" },
  modalBody: { paddingHorizontal: 20, paddingTop: 16 },
  previewSectionTitle: { fontSize: 17, fontWeight: "600", marginBottom: 14, marginTop: 10, letterSpacing: -0.2 },
  timeline: { flexDirection: "row", height: 40, gap: 2, marginBottom: 16 },
  timelineSegment: { alignItems: "center" },
  timelineBar: { height: 20, borderRadius: 4, width: "100%" },
  timelineLabel: { fontSize: 9, marginTop: 4 },
  previewStats: {
    flexDirection: "row", borderRadius: 12, paddingVertical: 14,
    paddingHorizontal: 8, marginBottom: 16,
  },
  previewStatItem: { flex: 1, alignItems: "center" },
  previewStatValue: { fontSize: 18, fontWeight: "700" },
  previewStatLabel: { fontSize: 11, marginTop: 2 },
  sequenceCard: {
    flexDirection: "row", alignItems: "center", borderRadius: 12,
    padding: 10, borderWidth: 1,
  },
  seqNumber: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: "center", justifyContent: "center", marginRight: 10,
  },
  seqNumberText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  seqThumb: { width: 50, height: 50, borderRadius: 8 },
  seqInfo: { flex: 1, marginLeft: 10 },
  seqTitle: { fontSize: 14, fontWeight: "700" },
  seqMeta: { fontSize: 11, marginTop: 2 },
  seqTransition: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 8,
  },
  seqTransLine: { height: 1, flex: 1 },
  seqTransText: { fontSize: 11, fontWeight: "600" },
  exportInfo: { borderRadius: 12, padding: 16, marginTop: 16, borderWidth: 1 },
  exportTitle: { fontSize: 15, fontWeight: "600", marginBottom: 10, letterSpacing: -0.1 },
  exportDetail: { fontSize: 14, lineHeight: 24, letterSpacing: 0.1 },
  exportBtn: { paddingVertical: 16, borderRadius: 14, alignItems: "center", marginTop: 16 },
  exportBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  // Play button overlay styles
  playOverlayBtn: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  playCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },

  // Sort filter styles
  sortFilterContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 20,
    marginTop: 12,
    gap: 10,
  },
  sortLabel: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.1,
  },
  sortButtons: {
    flexDirection: "row",
    flex: 1,
    gap: 8,
  },
  sortBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  sortBtnActive: {
    shadowColor: "#E8825E",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  sortBtnText: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.1,
  },
  // Views and date badges on card
  viewsBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  viewsText: {
    fontSize: 11,
    fontWeight: "500",
  },
  dateBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  dateText: {
    fontSize: 11,
    fontWeight: "500",
  },
});
