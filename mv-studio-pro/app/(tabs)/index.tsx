import React, { useState, useEffect, useRef, useCallback } from "react";
import { Text, View, ScrollView, TouchableOpacity, StyleSheet, Platform, Dimensions } from "react-native";
import { useRouter, type Href } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { SEOHead } from "@/components/seo-head";
import { SEOJsonLd } from "@/components/seo-jsonld";
import { GuestbookSection } from "@/components/guestbook-section";
import { Image } from "expo-image";
import { useAuth } from "@/hooks/use-auth";
import { LaunchCountdownBanner } from "@/components/launch-countdown-banner";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const isWeb = Platform.OS === "web";
const isWide = isWeb && SCREEN_WIDTH > 768;

/* ===== Video Data - All 7 Videos ===== */
const MV_SHOWCASE = [
  { id: "red-dress", title: "红裙舞曲", song: "忆网情深 M&F", thumbnail: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/FMaQrMFVSirXzkvD.jpg", videoUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/nVaXOtnFWoIlIwgl.mp4", color: "#FF6B6B" },
  { id: "city-night", title: "城市夜曲", song: "忆网情深 M&F", thumbnail: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/gjuvwUewnWpQtpRZ.jpg", videoUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/xFrRgHsYXEyBwrbk.mp4", color: "#64D2FF" },
  { id: "rain-song", title: "雨中深情", song: "忆网情深 M&F", thumbnail: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/BrPAcibOmXsyMiua.jpg", videoUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/RHktyzVRIArjQRMQ.mp4", color: "#C77DBA" },
  { id: "angel-wings", title: "天使之翼", song: "忆网情深 M&F", thumbnail: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/nthPJMSIfmabjtqj.jpg", videoUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/zPVbhqOJzROkfvad.mp4", color: "#30D158" },
  { id: "garden-morning", title: "花园晨曦", song: "意想爱 韩风版", thumbnail: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/hQnLktLWcgmziiqC.jpg", videoUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/iptvPNntjTJbiFzN.mp4", color: "#FFD60A" },
  { id: "smile-moment", title: "微笑瞬间", song: "意想爱 韩风版", thumbnail: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/LpxiifHsrGYKIrGE.jpg", videoUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/IzJpdKpGDDZtSYrJ.mp4", color: "#FF9F0A" },
  { id: "love-melody", title: "爱的旋律", song: "意想爱 韩风版", thumbnail: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/CXzVPwztIGcraPfw.jpg", videoUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/HNlwtOKbnwxeWYbd.mp4", color: "#FF2D55" },
];

/* ===== Platform Data with Real Logos ===== */
const PLATFORMS = [
  { name: "小红书", logo: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/hkYmsnUmkxkJXvgF.png", color: "#FF2442", bgColor: "rgba(255,36,66,0.15)" },
  { name: "B站", logo: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/fgWLyaPfYtWXQqdG.jpg", color: "#00A1D6", bgColor: "rgba(0,161,214,0.15)" },
  { name: "抖音", logo: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/dGQvXHbFCfMxyBXq.png", color: "#FE2C55", bgColor: "rgba(254,44,85,0.15)" },
  { name: "视频号", logo: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/RJDBMVuSAVJVCTSc.png", color: "#FA9D3B", bgColor: "rgba(250,157,59,0.15)" },
];

/* ===== Feature Cards ===== */
const FEATURES = [
  { id: "gallery", title: "视频展厅", desc: "浏览 7 支精选视频作品，支持在线播放、评论交互和留言板功能", icon: "videocam" as const, color: "#FF6B6B", route: "/mv-gallery", available: true },
  { id: "analyze", title: "视频 PK 评分", desc: "上传视频视频，AI 自动分析画面构图、色彩风格、节奏感与爆款潜力评分", icon: "graphic-eq" as const, color: "#64D2FF", route: "/(tabs)/analyze", available: true },
  { id: "avatar", title: "虚拟偶像工坊", desc: "输入描述即可生成动漫风、写实风、赛博庞克等多风格虚拟偶像形象", icon: "groups" as const, color: "#C77DBA", route: "/(tabs)/avatar", available: true },
  { id: "storyboard", title: "智能脚本与分镜生成", desc: "输入歌词或文本，AI 自动生成专业视频分镜脚本，免费 10 个分镜或 600 字以内", icon: "movie-creation" as const, color: "#FFD60A", route: "/(tabs)/storyboard", available: true },
  { id: "effects", title: "分镜转视频", desc: "将分镜脚本转化为高质量视频片段，支持情感滤镜、动态特效和转场效果", icon: "auto-fix-high" as const, color: "#30D158", route: "/effects", available: true },
  { id: "video-submit", title: "爆款视频奖励", desc: "上传已发布的爆款视频，AI 自动评分，80分以上可获得 30-80 Credits 奖励", icon: "emoji-events" as const, color: "#FFD60A", route: "/video-submit", available: true },
  { id: "my-videos", title: "我的视频", desc: "查看已上传视频的评分历史、Credits 奖励记录和分析详情", icon: "video-library" as const, color: "#64D2FF", route: "/my-videos", available: true },
  { id: "showcase", title: "平台展厅", desc: "浏览 90 分以上的获奖爆款视频，发现优秀创作者和爆款灵感", icon: "local-fire-department" as const, color: "#FF6B6B", route: "/showcase", available: true },
  { id: "kling-studio", title: "Kling AI 工作室", desc: "3.0 Omni 视频生成、Motion Control 动作迁移、Lip-Sync 对口型，一站式 AI 视频制作", icon: "auto-fix-high" as const, color: "#A855F7", route: "/kling-studio", available: true },
];

/* ===== Animated Counter Component ===== */
function AnimatedCounter({ value, color, suffix = "", delay = 0 }: { value: string; color: string; suffix?: string; delay?: number }) {
  const isNumeric = /^\d+$/.test(value);
  const targetNum = isNumeric ? parseInt(value, 10) : 0;
  const [displayVal, setDisplayVal] = useState(isNumeric ? "0" : value);
  const animatedRef = useRef(false);

  useEffect(() => {
    if (!isNumeric || animatedRef.current) return;
    animatedRef.current = true;
    const startDelay = 800 + delay; // Wait for page to render + stagger
    const duration = 1600;
    const steps = 50;
    const stepTime = duration / steps;
    let current = 0;
    const startTimer = setTimeout(() => {
      const timer = setInterval(() => {
        current++;
        const progress = current / steps;
        // easeOutExpo for satisfying deceleration
        const eased = 1 - Math.pow(2, -10 * progress);
        const val = Math.round(eased * targetNum);
        setDisplayVal(String(val));
        if (current >= steps) {
          clearInterval(timer);
          setDisplayVal(String(targetNum));
        }
      }, stepTime);
    }, startDelay);
    return () => clearTimeout(startTimer);
  }, [isNumeric, targetNum, delay]);

  if (!isNumeric) {
    return <Text style={[s.statVal, { color }]}>{value}{suffix}</Text>;
  }

  return <Text style={[s.statVal, { color }]}>{displayVal}{suffix}</Text>;
}

export default function HomeScreen() {
  const router = useRouter();
  const { user, isAuthenticated } = useAuth();
  const [playingVideo, setPlayingVideo] = useState<typeof MV_SHOWCASE[0] | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const handlePlayMV = useCallback((mv: typeof MV_SHOWCASE[0]) => { setPlayingVideo(mv); }, []);
  const handleCloseVideo = useCallback(() => { setPlayingVideo(null); if (videoRef.current) videoRef.current.pause(); }, []);

  return (
    <ScreenContainer edges={isWeb ? [] : ["top", "left", "right"]} containerClassName="bg-background">
      <SEOHead title="首页" description="AI 驱动的一站式视频创作平台" ogUrl="https://mvstudiopro.com" />
      <SEOJsonLd />
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>

        {/* ===== Launch Countdown Banner ===== */}
        <LaunchCountdownBanner />

        {/* ===== Nav Bar ===== */}
        <View style={s.navBar}>
          <View style={s.navInner}>
            <View style={s.navLeft}>
              <View style={s.logoMark}><MaterialIcons name="music-note" size={18} color="#FF6B6B" /></View>
              <Text style={s.navLogo}>MV Studio Pro</Text>
            </View>
            <View style={s.navRight}>
              <TouchableOpacity onPress={() => router.push("/mv-gallery" as Href)} activeOpacity={0.7}><Text style={s.navLink}>视频展厅</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => router.push("/(tabs)/analyze" as Href)} activeOpacity={0.7}><Text style={s.navLink}>视频PK评分</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => router.push("/(tabs)/avatar" as Href)} activeOpacity={0.7}><Text style={s.navLink}>虚拟偶像</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => router.push("/kling-studio" as Href)} activeOpacity={0.7}><Text style={[s.navLink, { color: "#A855F7" }]}>Kling AI</Text></TouchableOpacity>
              {isAuthenticated && (
                <TouchableOpacity onPress={() => router.push("/submit-payment" as Href)} activeOpacity={0.7}>
                  <View style={[s.submitPaymentBtn, { borderColor: "#30D158", backgroundColor: "rgba(48, 209, 88, 0.1)" }]}>
                    <MaterialIcons name="upload-file" size={16} color="#30D158" />
                    <Text style={[s.submitPaymentBtnText, { color: "#30D158" }]}>提交付款</Text>
                  </View>
                </TouchableOpacity>
              )}
              {isAuthenticated && (
                <TouchableOpacity onPress={() => router.push("/team-manage" as Href)} activeOpacity={0.7}>
                  <View style={[s.adminBtn, { borderColor: "rgba(100,210,255,0.40)", backgroundColor: "rgba(100,210,255,0.08)" }]}>
                    <MaterialIcons name="groups" size={16} color="#64D2FF" />
                    <Text style={[s.adminBtnText, { color: "#64D2FF" }]}>团队管理</Text>
                  </View>
                </TouchableOpacity>
              )}
              {isAuthenticated && user?.role === "admin" && (
                <>

                  <TouchableOpacity onPress={() => router.push("/admin-payment-review" as Href)} activeOpacity={0.7}>
                    <View style={s.adminBtn}>
                      <MaterialIcons name="payment" size={16} color="#30D158" />
                      <Text style={s.adminBtnText}>付款审核</Text>
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => router.push("/admin-finance" as Href)} activeOpacity={0.7}>
                    <View style={s.adminBtn}>
                      <MaterialIcons name="analytics" size={16} color="#FF6B35" />
                      <Text style={s.adminBtnText}>财务监控</Text>
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => router.push("/admin-team-stats" as Href)} activeOpacity={0.7}>
                    <View style={[s.adminBtn, { borderColor: "rgba(168,85,247,0.40)", backgroundColor: "rgba(168,85,247,0.08)" }]}>
                      <MaterialIcons name="bar-chart" size={16} color="#A855F7" />
                      <Text style={[s.adminBtnText, { color: "#A855F7" }]}>团队统计</Text>
                    </View>
                  </TouchableOpacity>
                </>
              )}
              {isAuthenticated && user ? (
                <TouchableOpacity onPress={() => router.push("/login" as Href)} activeOpacity={0.7}>
                  <View style={s.userAvatar}>
                    <Text style={s.userAvatarText}>{(user.name || user.email || "U").charAt(0).toUpperCase()}</Text>
                  </View>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity onPress={() => router.push("/login" as Href)} activeOpacity={0.7}>
                  <View style={s.loginBtn}>
                    <MaterialIcons name="person" size={16} color="#FFF" />
                    <Text style={s.loginBtnText}>登录</Text>
                  </View>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>

        {/* ========== HERO SECTION - Deep Purple/Red Gradient ========== */}
        <View style={s.hero}>
          {isWeb && <View style={s.heroBgLayer} />}
          {isWeb && <View style={s.heroOrb1} />}
          {isWeb && <View style={s.heroOrb2} />}
          {isWeb && <View style={s.heroOrb3} />}

          {/* Floating album covers with neon borders */}
          <View style={s.floatCovers}>
            {MV_SHOWCASE.slice(0, isWide ? 7 : 4).map((mv, i) => (
              <View key={mv.id} style={[s.floatCard, {
                transform: [{ rotate: `${(i % 2 === 0 ? -1 : 1) * (5 + i * 2)}deg` }, { translateY: i % 2 === 0 ? -10 : 10 }],
                opacity: 0.5 + (i * 0.07), borderColor: mv.color,
              }]}>
                <Image source={{ uri: mv.thumbnail }} style={{ width: "100%", height: "100%" }} contentFit="cover" />
              </View>
            ))}
          </View>

          <View style={s.heroContent}>
            <View style={s.heroBadge}>
              <MaterialIcons name="auto-awesome" size={14} color="#FFD60A" />
              <Text style={s.heroBadgeText}>AI-POWERED VIDEO CREATION</Text>
            </View>
            <Text style={s.heroTitle}>让每一帧都成为</Text>
            <Text style={s.heroTitleAccent}>爆款的起点</Text>
            <Text style={s.heroDesc}>从视频 PK 评分到虚拟偶像生成，AI 驱动的一站式视频创作平台</Text>
            <View style={s.heroBtns}>
              <TouchableOpacity style={s.btnPrimary} onPress={() => router.push("/mv-gallery" as Href)} activeOpacity={0.8}>
                <MaterialIcons name="play-arrow" size={22} color="#FFF" />
                <Text style={s.btnPrimaryText}>探索视频展厅</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.btnSecondary} onPress={() => router.push("/(tabs)/analyze" as Href)} activeOpacity={0.7}>
                <MaterialIcons name="upload" size={18} color="#64D2FF" />
                <Text style={s.btnSecondaryText}>上传分析</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* ===== Rainbow Animated Divider ===== */}
        {isWeb && <View style={s.rainbowBar} />}

        {/* ========== VIDEO SHOWCASE - All 7 Videos ========== */}
        <View style={s.mvSection}>
          {isWeb && <View style={s.mvSectionBg} />}
          <View style={s.secHeader}>
            <View style={s.secTagRow}>
              <MaterialIcons name="local-fire-department" size={18} color="#FF6B6B" />
              <Text style={[s.secTag, { color: "#FF6B6B" }]}>FEATURED WORKS</Text>
            </View>
            <Text style={s.secTitle}>精华视频集锦</Text>
            <Text style={s.secDesc}>点击播放，即刻感受每支视频的独特魅力</Text>
          </View>

          <View style={s.mvGrid}>
            {MV_SHOWCASE.map((mv) => (
              <TouchableOpacity key={mv.id} style={[s.mvCard, { borderColor: `${mv.color}60` }]} onPress={() => handlePlayMV(mv)} activeOpacity={0.85}>
                <View style={s.mvThumb}>
                  <Image source={{ uri: mv.thumbnail }} style={{ width: "100%", height: "100%" }} contentFit="cover" />
                  <View style={s.mvOverlay}>
                    <View style={[s.mvPlay, { backgroundColor: mv.color }]}>
                      <MaterialIcons name="play-arrow" size={30} color="#FFF" />
                    </View>
                  </View>
                  {/* Neon glow bar at bottom */}
                  <View style={[s.mvNeonBar, { backgroundColor: mv.color }]} />
                </View>
                <View style={s.mvInfo}>
                  <Text style={s.mvTitle} numberOfLines={1}>{mv.title}</Text>
                  <Text style={[s.mvSong, { color: mv.color }]} numberOfLines={1}>{mv.song}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity style={s.viewAllBtn} onPress={() => router.push("/mv-gallery" as Href)} activeOpacity={0.8}>
            <Text style={s.viewAllText}>查看全部视频与评论</Text>
            <MaterialIcons name="arrow-forward" size={18} color="#FF6B6B" />
          </TouchableOpacity>
        </View>

        {/* ===== Rainbow Animated Divider ===== */}
        {isWeb && <View style={s.rainbowBar} />}

        {/* ========== LATEST UPLOADS - User Generated Content ========== */}
        <View style={s.latestSection}>
          <View style={s.secHeader}>
            <View style={s.secTagRow}>
              <MaterialIcons name="fiber-new" size={18} color="#30D158" />
              <Text style={[s.secTag, { color: "#30D158" }]}>LATEST UPLOADS</Text>
            </View>
            <Text style={s.secTitle}>最新上传</Text>
            <Text style={s.secDesc}>社群用户最近生成的视频作品</Text>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 16 }}>
            {MV_SHOWCASE.slice(0, 5).map((mv, idx) => (
              <TouchableOpacity
                key={`latest-${mv.id}`}
                style={[s.latestCard, { borderColor: `${mv.color}60` }]}
                onPress={() => handlePlayMV(mv)}
                activeOpacity={0.85}
              >
                <View style={s.latestThumb}>
                  <Image source={{ uri: mv.thumbnail }} style={{ width: "100%", height: "100%" }} contentFit="cover" />
                  <View style={s.mvOverlay}>
                    <View style={[s.mvPlay, { backgroundColor: mv.color, width: 40, height: 40 }]}>
                      <MaterialIcons name="play-arrow" size={24} color="#FFF" />
                    </View>
                  </View>
                  <View style={[s.latestBadge, { backgroundColor: mv.color }]}>
                    <Text style={s.latestBadgeText}>新</Text>
                  </View>
                </View>
                <View style={s.latestInfo}>
                  <Text style={s.latestTitle} numberOfLines={1}>{mv.title}</Text>
                  <Text style={[s.latestSong, { color: mv.color }]} numberOfLines={1}>{mv.song}</Text>
                  <View style={s.latestMeta}>
                    <MaterialIcons name="access-time" size={12} color="#9BA1A6" />
                    <Text style={s.latestTime}>{idx + 1} 小时前</Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* ===== Rainbow Animated Divider ===== */}
        {isWeb && <View style={s.rainbowBar} />}

        {/* ========== FEATURES - Colorful Cards on Tinted BG ========== */}
        <View style={s.featSection}>
          {isWeb && <View style={s.featSectionBg} />}
          <View style={s.secHeader}>
            <View style={s.secTagRow}>
              <MaterialIcons name="auto-awesome" size={18} color="#C77DBA" />
              <Text style={[s.secTag, { color: "#C77DBA" }]}>CREATIVE TOOLS</Text>
            </View>
            <Text style={s.secTitle}>创作工具</Text>
            <Text style={s.secDesc}>探索 AI 驱动的全方位视频创作工具</Text>
          </View>

          <View style={s.featGrid}>
            {FEATURES.map((f) => (
              <TouchableOpacity key={f.id} style={[s.featCard, { borderColor: `${f.color}50` }]}
                onPress={() => f.available && router.push(f.route as Href)} activeOpacity={0.8}>
                {/* Colored top accent bar */}
                <View style={[s.featTopBar, { backgroundColor: f.color }]} />
                <View style={[s.featIconWrap, { backgroundColor: `${f.color}20`, borderWidth: 1.5, borderColor: `${f.color}40` }]}>
                  <MaterialIcons name={f.icon} size={32} color={f.color} />
                </View>
                <Text style={s.featTitle}>{f.title}</Text>
                <Text style={s.featDesc}>{f.desc}</Text>
                <View style={[s.featBtn, { backgroundColor: `${f.color}25`, borderColor: `${f.color}60` }]}>
                  <Text style={[s.featBtnText, { color: f.color }]}>立即使用</Text>
                  <MaterialIcons name="arrow-forward" size={14} color={f.color} />
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ========== STATS - Colorful Gradient Background ========== */}
        <View style={s.statsSection}>
          {isWeb && <View style={s.statsBg} />}
          <View style={s.statsGrid}>
            {[
              { value: "7", label: "精选视频", color: "#FF6B6B", icon: "videocam" as const, suffix: "+" },
              { value: "5", label: "创意工具", color: "#64D2FF", icon: "palette" as const, suffix: "" },
              { value: "AI", label: "智能分析", color: "#C77DBA", icon: "auto-awesome" as const, suffix: "" },
              { value: "4", label: "发布平台", color: "#30D158", icon: "trending-up" as const, suffix: "" },
            ].map((st, i) => (
              <View key={i} style={s.statItem}>
                <View style={[s.statIcon, { backgroundColor: `${st.color}30`, borderColor: `${st.color}60`, borderWidth: 2 }]}>
                  <MaterialIcons name={st.icon} size={24} color={st.color} />
                </View>
                <AnimatedCounter value={st.value} color={st.color} suffix={st.suffix} delay={i * 200} />
                <Text style={s.statLabel}>{st.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ===== Rainbow Animated Divider ===== */}
        {isWeb && <View style={s.rainbowBar} />}

        {/* ========== CONTACT ========== */}
        <View style={s.contactSection} nativeID="contact-section">
          {isWeb && <View style={s.contactBg} />}
          <View style={s.contactInner}>
            <View style={s.secHeader}>
              <View style={s.secTagRow}>
                <MaterialIcons name="mail" size={18} color="#FFD60A" />
                <Text style={[s.secTag, { color: "#FFD60A" }]}>GET IN TOUCH</Text>
              </View>
              <Text style={[s.secTitle, { marginBottom: 8 }]}>联系我们</Text>
              <Text style={[s.secDesc, { marginBottom: 32 }]}>有任何问题或合作需求？留下您的消息。</Text>
            </View>
            <GuestbookSection />
          </View>
        </View>

        {/* ========== FOOTER ========== */}
        <View style={s.footer}>
          {isWeb && <View style={s.footerTopBar} />}
          <View style={s.footerInner}>
            <View style={s.footerBrand}>
              <View style={s.logoMark}><MaterialIcons name="music-note" size={16} color="#FF6B6B" /></View>
              <Text style={s.footerLogo}>MV Studio Pro</Text>
            </View>
            <Text style={s.footerCopy}>© 2026 MV Studio Pro. All rights reserved.</Text>
          </View>
        </View>

      </ScrollView>

      {/* ===== Video Player Modal ===== */}
      {isWeb && playingVideo && (
        <View style={s.videoModal}>
          <View style={s.videoBg}><TouchableOpacity style={{ flex: 1 }} onPress={handleCloseVideo} activeOpacity={1} /></View>
          <View style={s.videoBox}>
            <View style={s.videoHead}>
              <View><Text style={s.videoTitle}>{playingVideo.title}</Text><Text style={s.videoSong}>{playingVideo.song}</Text></View>
              <TouchableOpacity onPress={handleCloseVideo} style={s.videoClose} activeOpacity={0.7}><MaterialIcons name="close" size={24} color="#F7F4EF" /></TouchableOpacity>
            </View>
            <View style={s.videoPlayer}>
              <video ref={videoRef as any} src={playingVideo.videoUrl} controls autoPlay playsInline style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: 12 } as any} />
            </View>
          </View>
        </View>
      )}

    </ScreenContainer>
  );
}

const s = StyleSheet.create({
  /* Nav */
  navBar: {
    backgroundColor: "rgba(16, 16, 18, 0.92)",
    ...(isWeb ? { position: "sticky" as any, top: 0, zIndex: 100, backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)" } as any : {}),
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)",
  },
  navInner: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: isWide ? 48 : 20, paddingVertical: 14, maxWidth: 1200, alignSelf: "center", width: "100%" },
  navLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  logoMark: { width: 32, height: 32, borderRadius: 8, backgroundColor: "rgba(255,107,107,0.15)", alignItems: "center", justifyContent: "center" },
  navLogo: { fontSize: 18, fontWeight: "700", color: "#F7F4EF", letterSpacing: -0.3 },
  navRight: { flexDirection: "row", alignItems: "center", gap: isWide ? 24 : 12 },
  navLink: { fontSize: 14, fontWeight: "500", color: "#9B9691" },
  adminBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 18,
    backgroundColor: "rgba(255,214,10,0.15)",
    borderWidth: 1,
    borderColor: "rgba(255,214,10,0.40)",
  },
  adminBtnText: { fontSize: 13, fontWeight: "700", color: "#FFD60A" },
  submitPaymentBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 18,
    borderWidth: 1,
  },
  submitPaymentBtnText: { fontSize: 13, fontWeight: "700" },
  loginBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 18,
    backgroundColor: "#FF6B6B",
  },
  loginBtnText: { fontSize: 13, fontWeight: "700", color: "#FFF" },
  userAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "#FF6B6B", alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "rgba(255,107,107,0.4)",
  },
  userAvatarText: { fontSize: 15, fontWeight: "700", color: "#FFF" },

  /* ===== HERO - Deep purple/magenta gradient ===== */
  hero: {
    minHeight: isWide ? 640 : 540,
    justifyContent: "center", alignItems: "center",
    paddingHorizontal: 24, paddingVertical: isWide ? 80 : 60,
    position: "relative", overflow: "hidden",
    backgroundColor: "#120818",
  },
  heroBgLayer: {
    ...(isWeb ? {
      position: "absolute" as any, top: 0, left: 0, right: 0, bottom: 0,
      backgroundImage: "linear-gradient(135deg, #2D0A3E 0%, #1A0525 25%, #0D1B2A 50%, #0A1628 75%, #1A0A2E 100%)",
    } as any : {}),
  },
  heroOrb1: {
    ...(isWeb ? {
      position: "absolute" as any, top: "-20%", left: "-15%", width: "60%", height: "80%", borderRadius: "50%",
      backgroundImage: "radial-gradient(ellipse, rgba(255,80,120,0.50) 0%, rgba(255,60,90,0.25) 40%, transparent 70%)",
      filter: "blur(60px)", animationName: "auroraFloat", animationDuration: "12s", animationTimingFunction: "ease-in-out", animationIterationCount: "infinite",
    } as any : {}),
  },
  heroOrb2: {
    ...(isWeb ? {
      position: "absolute" as any, top: "5%", right: "-15%", width: "55%", height: "70%", borderRadius: "50%",
      backgroundImage: "radial-gradient(ellipse, rgba(80,140,255,0.45) 0%, rgba(100,210,255,0.20) 40%, transparent 70%)",
      filter: "blur(60px)", animationName: "auroraFloat", animationDuration: "15s", animationTimingFunction: "ease-in-out", animationIterationCount: "infinite", animationDirection: "reverse",
    } as any : {}),
  },
  heroOrb3: {
    ...(isWeb ? {
      position: "absolute" as any, bottom: "-15%", left: "20%", width: "55%", height: "60%", borderRadius: "50%",
      backgroundImage: "radial-gradient(ellipse, rgba(199,125,186,0.45) 0%, rgba(255,214,10,0.20) 40%, transparent 70%)",
      filter: "blur(60px)", animationName: "auroraFloat", animationDuration: "18s", animationTimingFunction: "ease-in-out", animationIterationCount: "infinite",
    } as any : {}),
  },
  floatCovers: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    flexDirection: "row", flexWrap: "wrap", justifyContent: "space-around", alignItems: "center",
    paddingHorizontal: isWide ? 40 : 10,
  },
  floatCard: {
    width: isWide ? 110 : 65, height: isWide ? 150 : 95, borderRadius: 12, overflow: "hidden",
    borderWidth: 2.5,
    ...(isWeb ? { boxShadow: "0 8px 32px rgba(0,0,0,0.5)" } as any : { elevation: 8 }),
  },
  heroContent: { alignItems: "center", zIndex: 2, maxWidth: 700 },
  heroBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
    backgroundColor: "rgba(255,214,10,0.18)", borderWidth: 1, borderColor: "rgba(255,214,10,0.40)",
    marginBottom: 24,
  },
  heroBadgeText: { fontSize: 12, fontWeight: "700", color: "#FFD60A", letterSpacing: 2 },
  heroTitle: {
    fontSize: isWide ? 56 : 34, fontWeight: "800", color: "#FFFFFF",
    textAlign: "center", letterSpacing: -1.5, lineHeight: isWide ? 68 : 44,
    ...(isWeb ? { textShadow: "0 2px 20px rgba(255,107,107,0.3)" } as any : {}),
  },
  heroTitleAccent: {
    fontSize: isWide ? 56 : 34, fontWeight: "800",
    textAlign: "center", letterSpacing: -1.5, lineHeight: isWide ? 68 : 44,
    color: "#FFFFFF",
    ...(isWeb ? { textShadow: "0 2px 20px rgba(255,107,107,0.3)" } as any : {}),
  },
  heroDesc: {
    fontSize: isWide ? 18 : 15, color: "#D0CCC7", textAlign: "center",
    marginTop: 20, lineHeight: isWide ? 28 : 24, maxWidth: 520,
  },
  heroBtns: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 36 },
  btnPrimary: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 28, paddingVertical: 15, borderRadius: 28,
    ...(isWeb ? {
      backgroundImage: "linear-gradient(135deg, #FF6B6B 0%, #C77DBA 50%, #64D2FF 100%)",
      boxShadow: "0 4px 24px rgba(255,107,107,0.4)",
    } as any : { backgroundColor: "#FF6B6B" }),
  },
  btnPrimaryText: { color: "#FFF", fontSize: 16, fontWeight: "700" },
  btnSecondary: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 22, paddingVertical: 15, borderRadius: 28,
    borderWidth: 1.5, borderColor: "rgba(100,210,255,0.5)",
    backgroundColor: "rgba(100,210,255,0.12)",
  },
  btnSecondaryText: { color: "#64D2FF", fontSize: 16, fontWeight: "600" },

  /* Rainbow divider */
  rainbowBar: {
    height: 3,
    ...(isWeb ? {
      backgroundImage: "linear-gradient(90deg, #FF6B6B, #FF9F0A, #FFD60A, #30D158, #64D2FF, #C77DBA, #FF6B6B)",
      backgroundSize: "200% auto",
      animationName: "shimmer", animationDuration: "6s", animationTimingFunction: "linear", animationIterationCount: "infinite",
    } as any : { backgroundColor: "#FF6B6B" }),
  },

  /* ===== Video Section - Warm tinted dark ===== */
  mvSection: {
    paddingVertical: isWide ? 80 : 56, paddingHorizontal: 24,
    position: "relative", overflow: "hidden",
    backgroundColor: "#140D1A",
  },
  mvSectionBg: {
    ...(isWeb ? {
      position: "absolute" as any, top: 0, left: 0, right: 0, bottom: 0,
      backgroundImage: "linear-gradient(180deg, rgba(255,107,107,0.10) 0%, rgba(199,125,186,0.08) 50%, rgba(100,210,255,0.06) 100%)",
    } as any : {}),
  },
  secHeader: { alignItems: "center", marginBottom: 8, zIndex: 2 },
  secTagRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 },
  secTag: { fontSize: 13, fontWeight: "700", letterSpacing: 2 },
  secTitle: {
    fontSize: isWide ? 40 : 28, fontWeight: "700", color: "#FFFFFF",
    textAlign: "center", letterSpacing: -0.8,
  },
  secDesc: {
    fontSize: isWide ? 17 : 15, color: "#B5B0AB", textAlign: "center",
    marginTop: 12, lineHeight: isWide ? 26 : 22, maxWidth: 500, alignSelf: "center",
  },
  mvGrid: {
    flexDirection: "row", flexWrap: "wrap", justifyContent: "center",
    gap: isWide ? 16 : 10, marginTop: 36, maxWidth: 1100, alignSelf: "center", zIndex: 2,
    width: "100%",
  },
  mvCard: {
    width: isWide ? 145 : (SCREEN_WIDTH - 58) / 2,
    borderRadius: 16, overflow: "hidden",
    backgroundColor: "#1E1428",
    borderWidth: 2,
    ...(isWeb ? { boxShadow: "0 4px 20px rgba(0,0,0,0.3)" } as any : { elevation: 4 }),
  },
  mvThumb: { position: "relative", aspectRatio: 3 / 4, backgroundColor: "#0A0A0A" },
  mvOverlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.25)", alignItems: "center", justifyContent: "center",
  },
  mvPlay: {
    width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center",
    ...(isWeb ? { boxShadow: "0 4px 20px rgba(0,0,0,0.5)" } as any : { elevation: 6 }),
  },
  mvNeonBar: {
    position: "absolute", bottom: 0, left: 0, right: 0, height: 4,
    ...(isWeb ? { boxShadow: "0 0 12px currentColor" } as any : {}),
  },
  mvInfo: { padding: 10 },
  mvTitle: { fontSize: 13, fontWeight: "700", color: "#FFF", marginBottom: 2 },
  mvSong: { fontSize: 11, fontWeight: "500" },
  viewAllBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, marginTop: 32, paddingVertical: 12, zIndex: 2,
  },
  viewAllText: { fontSize: 16, fontWeight: "600", color: "#FF6B6B" },

  /* ===== Latest Uploads Section ===== */
  latestSection: {
    paddingVertical: isWide ? 60 : 40,
    backgroundColor: "#0D1220",
  },
  latestCard: {
    width: isWide ? 240 : 180,
    backgroundColor: "#1A1D29",
    borderRadius: 16,
    borderWidth: 1.5,
    overflow: "hidden",
  },
  latestThumb: {
    width: "100%",
    height: isWide ? 180 : 135,
    backgroundColor: "#0A0C14",
    position: "relative",
  },
  latestBadge: {
    position: "absolute",
    top: 8,
    left: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  latestBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#FFF",
  },
  latestInfo: {
    padding: 12,
  },
  latestTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#FFF",
    marginBottom: 4,
  },
  latestSong: {
    fontSize: 11,
    fontWeight: "500",
    marginBottom: 8,
  },
  latestMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  latestTime: {
    fontSize: 10,
    color: "#9BA1A6",
  },

  /* ===== Features - Cool blue/purple tinted ===== */
  featSection: {
    paddingVertical: isWide ? 80 : 56, paddingHorizontal: 24,
    position: "relative", overflow: "hidden",
    backgroundColor: "#0D1220",
  },
  featSectionBg: {
    ...(isWeb ? {
      position: "absolute" as any, top: 0, left: 0, right: 0, bottom: 0,
      backgroundImage: "linear-gradient(135deg, rgba(100,210,255,0.08) 0%, rgba(199,125,186,0.06) 50%, rgba(48,209,88,0.08) 100%)",
    } as any : {}),
  },
  featGrid: {
    flexDirection: isWide ? "row" : "column", flexWrap: "wrap",
    justifyContent: "center", gap: isWide ? 16 : 12,
    marginTop: 36, maxWidth: 1000, alignSelf: "center", width: "100%", zIndex: 2,
  },
  featCard: {
    width: isWide ? "18.5%" : "100%",
    backgroundColor: "#141825",
    borderRadius: 18, overflow: "hidden",
    borderWidth: 1.5,
    alignItems: isWide ? "flex-start" : "center",
    ...(isWeb ? { boxShadow: "0 4px 16px rgba(0,0,0,0.2)" } as any : { elevation: 3 }),
  },
  featTopBar: { width: "100%", height: 4 },
  featIconWrap: {
    width: 60, height: 60, borderRadius: 16,
    alignItems: "center", justifyContent: "center",
    marginTop: 20, marginBottom: 16,
    ...(isWide ? { marginLeft: 24 } : {}),
  },
  featTitle: {
    fontSize: 17, fontWeight: "700", color: "#FFF", marginBottom: 8,
    textAlign: isWide ? "left" : "center",
    ...(isWide ? { paddingHorizontal: 24 } : {}),
  },
  featDesc: {
    fontSize: 14, color: "#B5B0AB", lineHeight: 20,
    textAlign: isWide ? "left" : "center", marginBottom: 16,
    ...(isWide ? { paddingHorizontal: 24 } : {}),
  },
  featBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 14,
    borderWidth: 1, marginBottom: 20,
    ...(isWide ? { marginLeft: 24 } : {}),
  },
  featBtnText: { fontSize: 13, fontWeight: "600" },

  /* ===== Stats - Colorful gradient bg ===== */
  statsSection: {
    paddingVertical: isWide ? 60 : 40, paddingHorizontal: 24,
    position: "relative", overflow: "hidden",
    backgroundColor: "#151020",
  },
  statsBg: {
    ...(isWeb ? {
      position: "absolute" as any, top: 0, left: 0, right: 0, bottom: 0,
      backgroundImage: "linear-gradient(90deg, rgba(255,107,107,0.12) 0%, rgba(100,210,255,0.10) 33%, rgba(199,125,186,0.12) 66%, rgba(48,209,88,0.10) 100%)",
    } as any : {}),
  },
  statsGrid: {
    flexDirection: "row", justifyContent: "space-around",
    maxWidth: 800, alignSelf: "center", width: "100%", zIndex: 2,
  },
  statItem: { alignItems: "center", gap: 8 },
  statIcon: {
    width: 56, height: 56, borderRadius: 16,
    alignItems: "center", justifyContent: "center", marginBottom: 4,
  },
  statVal: { fontSize: isWide ? 36 : 28, fontWeight: "800", letterSpacing: -1 },
  statLabel: { fontSize: isWide ? 14 : 12, color: "#B5B0AB", fontWeight: "500" },

  /* ===== Platforms ===== */
  platSection: {
    paddingVertical: isWide ? 80 : 56, paddingHorizontal: 24,
    backgroundColor: "#0D1220",
  },
  platGrid: { flexDirection: "row", justifyContent: "center", gap: isWide ? 40 : 24, marginTop: 32 },
  platItem: { alignItems: "center", gap: 10 },
  platIcon: {
    width: isWide ? 72 : 60, height: isWide ? 72 : 60,
    borderRadius: isWide ? 20 : 16, alignItems: "center", justifyContent: "center",
    overflow: "hidden",
  },
  platLogoImg: {
    width: isWide ? 44 : 36, height: isWide ? 44 : 36,
  },
  platName: { fontSize: isWide ? 14 : 12, fontWeight: "600" },

  /* ===== Contact ===== */
  contactSection: {
    paddingVertical: isWide ? 80 : 56, paddingHorizontal: 24,
    position: "relative", overflow: "hidden",
    backgroundColor: "#140D1A",
  },
  contactBg: {
    ...(isWeb ? {
      position: "absolute" as any, top: 0, left: 0, right: 0, bottom: 0,
      backgroundImage: "linear-gradient(180deg, rgba(255,214,10,0.06) 0%, rgba(255,159,10,0.04) 50%, transparent 100%)",
    } as any : {}),
  },
  contactInner: { maxWidth: 600, alignSelf: "center", width: "100%", alignItems: "center", zIndex: 2 },

  /* ===== Footer ===== */
  footer: { paddingVertical: 24, paddingHorizontal: 24, backgroundColor: "#0A0A0E", position: "relative" },
  footerTopBar: {
    ...(isWeb ? {
      position: "absolute" as any, top: 0, left: 0, right: 0, height: 3,
      backgroundImage: "linear-gradient(90deg, #FF6B6B, #FF9F0A, #FFD60A, #30D158, #64D2FF, #C77DBA)",
      opacity: 0.6,
    } as any : {}),
  },
  footerInner: { maxWidth: 1200, alignSelf: "center", width: "100%", alignItems: "center", gap: 12 },
  footerBrand: { flexDirection: "row", alignItems: "center", gap: 8 },
  footerLogo: { fontSize: 16, fontWeight: "700", color: "#F7F4EF" },
  footerCopy: { fontSize: 13, color: "#6B6762" },

  /* ===== Video Modal ===== */
  videoModal: {
    ...(isWeb ? { position: "fixed" as any, top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000 } as any : {}),
    justifyContent: "center", alignItems: "center",
  },
  videoBg: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.88)" },
  videoBox: {
    width: isWide ? "60%" : "92%", maxWidth: 700,
    backgroundColor: "#1A1A22", borderRadius: 16, overflow: "hidden", zIndex: 1,
    ...(isWeb ? { boxShadow: "0 24px 80px rgba(0,0,0,0.6)" } as any : {}),
  },
  videoHead: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)",
  },
  videoTitle: { fontSize: 18, fontWeight: "700", color: "#F7F4EF" },
  videoSong: { fontSize: 14, color: "#9B9691", marginTop: 2 },
  videoClose: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center", justifyContent: "center",
  },
  videoPlayer: { aspectRatio: 9 / 16, maxHeight: isWide ? 500 : 400, backgroundColor: "#000" },
});
