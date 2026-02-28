
import React, { useState, useCallback, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { Sparkles, Youtube, Music, Video, Heart, TrendingUp, GraduationCap, Film, Trophy, Handshake, Sun, Cloud, Moon, ArrowLeft, RefreshCw, Settings, Send, Check, Globe, Newspaper, Pencil, Clock, RectangleHorizontal, Copy, CheckCircle, Loader2 } from "lucide-react";

/* ===== Platform Data ===== */
const PLATFORMS = [
  {
    id: "xiaohongshu",
    name: "小红书",
    icon: Sparkles,
    color: "#FF2442",
    bestTime: "周二/四/六 18:00-21:00",
    format: "竖屏 9:16 | 3-5分钟",
    audience: "18-35岁女性为主",
    tips: ["封面图决定 80% 点击率", "标题用数字+情绪词", "前 3 秒必须抓住注意力"],
  },
  {
    id: "bilibili",
    name: "B站",
    icon: Youtube,
    color: "#00A1D6",
    bestTime: "周五/六/日 19:00-22:00",
    format: "横屏 16:9 | 5-15分钟",
    audience: "15-30岁 Z世代",
    tips: ["封面要有信息量", "标题党适度使用", "交互区引导三连"],
  },
  {
    id: "douyin",
    name: "抖音",
    icon: Music,
    color: "#FE2C55",
    bestTime: "每天 12:00-14:00, 18:00-22:00",
    format: "竖屏 9:16 | 15-60秒",
    audience: "全年龄层",
    tips: ["前 1 秒是生死线", "BGM 选择决定流量", "评论区交互提升推荐"],
  },
  {
    id: "channels",
    name: "视频号",
    icon: Video,
    color: "#07C160",
    bestTime: "周一至周五 20:00-22:00",
    format: "竖屏 9:16 | 1-3分钟",
    audience: "30-55岁",
    tips: ["社交裂变是内核", "正能量内容更易传播", "朋友圈分享带动播放"],
  },
];

/* ===== Content Templates ===== */
const CONTENT_TEMPLATES = [
  { id: "emotional", label: "情感共鸣", icon: Heart, color: "#FF6B6B", desc: "触动人心的故事叙述" },
  { id: "trending", label: "热点追踪", icon: TrendingUp, color: "#FFD60A", desc: "紧跟当下流行趋势" },
  { id: "tutorial", label: "教学分享", icon: GraduationCap, color: "#64D2FF", desc: "专业知识输出" },
  { id: "behind", label: "幕后花絮", icon: Film, color: "#C77DBA", desc: "创作过程揭秘" },
  { id: "challenge", label: "挑战交互", icon: Trophy, color: "#30D158", desc: "引发用户参与" },
  { id: "collab", label: "联名合作", icon: Handshake, color: "#FF9F0A", desc: "跨界破圈传播" },
];

/* ===== Time Slots ===== */
const TIME_SLOTS = [
  { id: "morning", label: "上午", time: "09:00-12:00", icon: Sun },
  { id: "noon", label: "午间", time: "12:00-14:00", icon: Sun },
  { id: "afternoon", label: "下午", time: "14:00-18:00", icon: Cloud },
  { id: "evening", label: "黄金时段", time: "18:00-22:00", icon: Moon },
  { id: "late", label: "深夜", time: "22:00-00:00", icon: Moon },
];

type GeneratedContent = {
  title: string;
  caption: string;
  hashtags: string[];
  tips: string;
};

export default function VFXEngine() {
  const [location, navigate] = useLocation();
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isAuthenticated) {
      navigate("/login");
    }
  }, [isAuthenticated, navigate]);

  if (!isAuthenticated) {
    return null;
  }

  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<string>("evening");
  const [mvTitle, setMvTitle] = useState("");
  const [mvDescription, setMvDescription] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generatedContents, setGeneratedContents] = useState<Record<string, GeneratedContent>>({});
  const [activeDetailPlatform, setActiveDetailPlatform] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [publishStep, setPublishStep] = useState<"config" | "generate" | "review">("config");

  const togglePlatform = useCallback((id: string) => {
    setSelectedPlatforms(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  }, []);

  const handleCopy = useCallback(async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      console.error("Failed to copy: ", err);
    }
  }, []);

  const handleGenerate = useCallback(async () => {
    if (selectedPlatforms.length === 0) return;
    setGenerating(true);

    const contents: Record<string, GeneratedContent> = {};
    const template = CONTENT_TEMPLATES.find(t => t.id === selectedTemplate);

    for (const platformId of selectedPlatforms) {
      const platform = PLATFORMS.find(p => p.id === platformId);
      if (!platform) continue;

      const titlePrefix: Record<string, string> = {
        xiaohongshu: "🔥",
        bilibili: "【必看】",
        douyin: "❤️",
        channels: "✨",
      };

      const hashtagSets: Record<string, string[]> = {
        xiaohongshu: ["#视频制作", "#音乐视频", "#创作灵感", `#${platform.name}推荐`, "#视觉艺术"],
        bilibili: ["#视频", "#音乐", "#原创", "#视觉特效", "#创作分享"],
        douyin: ["#视频", "#音乐推荐", "#视觉冲击", "#创作者", "#热门"],
        channels: ["#视频分享", "#音乐生活", "#创意视频", "#正能量", "#好歌推荐"],
      };

      const captionStyles: Record<string, string> = {
        xiaohongshu: `这支视频真的太绝了！${mvDescription || "每一帧都是视觉盛宴"}✨\n\n${template ? `用${template.label}的方式呈现，` : ""}从构图到色彩都经过精心设计，看完整个人都被治愈了～\n\n💡 创作心得：好的视频不只是画面好看，更要能触动人心。\n\n📌 收藏这条，下次创作时参考！`,
        bilibili: `【${mvTitle || "视频创作"}】${mvDescription || "从零到一的视觉创作之旅"}\n\n${template ? `本期以「${template.label}」为主题，` : ""}带大家深入了解视频制作的每一个环节。\n\n⏰ 时间轴：\n00:00 开场\n00:15 内核片段\n00:30 幕后解析\n\n🎵 BGM 信息见评论区置顶\n\n如果喜欢的话，一键三连支持一下吧！`,
        douyin: `${mvDescription || "这个视频你一定没见过"}👀\n${template ? `#${template.label} ` : ""}每一秒都是惊喜！\n\n看到最后有彩蛋🎁`,
        channels: `分享一支用心制作的视频 🎬\n\n${mvDescription || "音乐与视觉的完美融合"}，${template ? `以「${template.label}」的风格呈现，` : ""}希望能带给大家一些美好的感受。\n\n创作不易，感谢每一位观看和分享的朋友 🙏`,
      };

      contents[platformId] = {
        title: `${titlePrefix[platformId] || ""} ${mvTitle || "震撞视频首发"}｜${template?.label || "视觉盛宴"}`,
        caption: captionStyles[platformId] || "",
        hashtags: hashtagSets[platformId] || [],
        tips: platform.tips.join("\n"),
      };
    }

    await new Promise(r => setTimeout(r, 1500));
    setGeneratedContents(contents);
    setGenerating(false);
    setPublishStep("review");
  }, [selectedPlatforms, selectedTemplate, mvTitle, mvDescription]);

  const handleReset = useCallback(() => {
    setPublishStep("config");
    setGeneratedContents({});
    setActiveDetailPlatform(null);
  }, []);

  return (
    <div className="min-h-screen bg-[#0A0A0C] text-[#F7F4EF] page-enter">
      <div className="ambient-glow" />
      <div className="overflow-y-auto">
        {/* ===== Header ===== */}
        <div className="sticky top-0 z-50 bg-[rgba(16,16,18,0.92)] border-b border-[rgba(255,255,255,0.06)] backdrop-blur-xl">
          <div className="flex items-center justify-between max-w-5xl mx-auto px-6 md:px-12 py-3.5">
            <button onClick={() => window.history.back()} className="w-10 h-10 rounded-full bg-[rgba(255,255,255,0.08)] flex items-center justify-center">
              <ArrowLeft size={22} />
            </button>
            <div className="flex-1 ml-3.5">
              <h1 className="text-lg font-bold">多平台发布中心</h1>
              <p className="text-xs text-[#9B9691] mt-0.5">智能制定跨平台发布策略</p>
            </div>
            {publishStep === "review" && (
              <button onClick={handleReset} className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-[rgba(255,107,107,0.1)]">
                <RefreshCw size={18} className="text-[#FF6B6B]" />
                <span className="text-sm font-semibold text-[#FF6B6B]">重新配置</span>
              </button>
            )}
          </div>
        </div>

        {/* ===== Step Indicator ===== */}
        <div className="flex items-center justify-center gap-2 md:gap-4 px-6 py-5">
          {[
            { step: "config", label: "配置", icon: Settings },
            { step: "generate", label: "生成", icon: Sparkles },
            { step: "review", label: "预览发布", icon: Send },
          ].map((s, i) => {
            const isActive = s.step === publishStep;
            const isPast = (publishStep === "review" && i < 2) || (publishStep === "generate" && i < 1);
            const Icon = s.icon;
            return (
              <React.Fragment key={s.step}>
                {i > 0 && <div className={`h-0.5 flex-grow max-w-[60px] mx-2 mb-5 ${isPast || isActive ? 'bg-[#FF6B6B]' : 'bg-[rgba(255,255,255,0.08)]'}`} />}
                <div className="flex flex-col items-center gap-1.5">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${isActive || isPast ? 'bg-gradient-to-br from-[#FF6B6B] to-[#C77DBA]' : 'bg-[rgba(255,255,255,0.08)]'}`}>
                    {isPast ? <Check size={16} /> : <Icon size={16} className={`${isActive || isPast ? 'text-white' : 'text-[#9B9691]'}`} />}
                  </div>
                  <span className={`text-xs font-medium ${isActive || isPast ? 'text-[#F7F4EF] font-semibold' : 'text-[#9B9691]'}`}>{s.label}</span>
                </div>
              </React.Fragment>
            );
          })}
        </div>

        {/* ===== Config Step ===== */}
        {publishStep === "config" && (
          <div className="max-w-4xl mx-auto px-4 md:px-12 py-4">
            {/* Platform Selection */}
            <div className="mb-8">
              <div className="flex items-center gap-2 mb-4">
                <Globe size={20} className="text-[#FFD60A]" />
                <h2 className="text-lg font-bold flex-1">选择发布平台</h2>
                <span className="text-xs font-semibold text-[#FFD60A] bg-[rgba(255,214,10,0.12)] px-2.5 py-1 rounded-full">{selectedPlatforms.length} 个已选</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
                {PLATFORMS.map(platform => {
                  const isSelected = selectedPlatforms.includes(platform.id);
                  const Icon = platform.icon;
                  return (
                    <button
                      key={platform.id}
                      className={`relative glass-card-subtle p-4 text-left transition-all duration-200 hover:scale-[1.03] active:scale-[0.97] ${isSelected ? 'border-2 !border-opacity-100' : ''}`}
                      style={{ borderColor: isSelected ? platform.color : 'rgba(255,255,255,0.06)' }}
                      onClick={() => togglePlatform(platform.id)}
                    >
                      <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-2.5" style={{ backgroundColor: `${platform.color}1A`}}>
                        <Icon size={28} style={{ color: platform.color }} />
                      </div>
                      <h3 className={`text-base font-bold mb-1 ${isSelected ? 'text-[${platform.color}]' : 'text-[#F7F4EF]'}`}>{platform.name}</h3>
                      <p className="text-xs text-[#9B9691] mb-2">{platform.audience}</p>
                      <div className="flex items-center gap-1 mt-1">
                        <Clock size={12} className="text-[#9B9691]" />
                        <span className="text-xs text-[#9B9691]">{platform.bestTime}</span>
                      </div>
                      <div className="flex items-center gap-1 mt-1">
                        <RectangleHorizontal size={12} className="text-[#9B9691]" />
                        <span className="text-xs text-[#9B9691]">{platform.format}</span>
                      </div>
                      {isSelected && (
                        <div className="absolute top-2.5 right-2.5 w-6 h-6 rounded-full flex items-center justify-center" style={{ backgroundColor: platform.color }}>
                          <Check size={14} className="text-white" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Content Template */}
            <div className="mb-8">
              <div className="flex items-center gap-2 mb-4">
                <Newspaper size={20} className="text-[#C77DBA]" />
                <h2 className="text-lg font-bold">内容风格</h2>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {CONTENT_TEMPLATES.map(tmpl => {
                  const isSelected = selectedTemplate === tmpl.id;
                  const Icon = tmpl.icon;
                  return (
                    <button
                      key={tmpl.id}
                      className={`relative glass-card-subtle p-3.5 text-center transition-all duration-200 hover:scale-[1.05] active:scale-[0.95] ${isSelected ? 'border-2 !border-opacity-100' : ''}`}
                      style={{ borderColor: isSelected ? tmpl.color : 'rgba(255,255,255,0.06)' }}
                      onClick={() => setSelectedTemplate(selectedTemplate === tmpl.id ? null : tmpl.id)}
                    >
                      <Icon size={22} className="mx-auto" style={{ color: tmpl.color }} />
                      <p className="text-sm font-bold mt-2">{tmpl.label}</p>
                      <p className="text-xs text-[#9B9691] mt-1">{tmpl.desc}</p>
                      {isSelected && (
                        <div className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center" style={{ backgroundColor: tmpl.color }}>
                          <Check size={12} className="text-white" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Video Info */}
            <div className="mb-8">
              <div className="flex items-center gap-2 mb-4">
                <Pencil size={20} className="text-[#64D2FF]" />
                <h2 className="text-lg font-bold">视频信息</h2>
              </div>
              <div className="mb-4">
                <label className="text-sm font-semibold text-[#F7F4EF] mb-2 block">视频标题</label>
                <input
                  type="text"
                  className="w-full glass-input px-4 py-3.5 text-base focus:ring-2 focus:ring-[#64D2FF]"
                  placeholder="例如：忆网情深 M&F"
                  value={mvTitle}
                  onChange={(e) => setMvTitle(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-[#F7F4EF] mb-2 block">视频描述（可选）</label>
                <textarea
                  className="w-full glass-input px-4 py-3.5 text-base min-h-[80px] focus:ring-2 focus:ring-[#64D2FF]"
                  placeholder="简述视频的主题、风格或亮点..."
                  value={mvDescription}
                  onChange={(e) => setMvDescription(e.target.value)}
                  rows={3}
                />
              </div>
            </div>

            {/* Time Slot */}
            <div className="mb-8">
              <div className="flex items-center gap-2 mb-4">
                <Clock size={20} className="text-[#30D158]" />
                <h2 className="text-lg font-bold">发布时段</h2>
              </div>
              <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
                {TIME_SLOTS.map(slot => {
                  const isSelected = selectedTimeSlot === slot.id;
                  const Icon = slot.icon;
                  return (
                    <button
                      key={slot.id}
                      className={`glass-card-subtle p-3 text-center transition-all duration-200 ${isSelected ? '!border-[#FFD60A] !bg-[rgba(255,214,10,0.08)]' : ''}`}
                      onClick={() => setSelectedTimeSlot(slot.id)}
                    >
                      <Icon size={20} className={`mx-auto ${isSelected ? 'text-[#FFD60A]' : 'text-[#9B9691]'}`} />
                      <p className={`text-sm font-semibold mt-1.5 ${isSelected ? 'text-[#FFD60A]' : 'text-[#9B9691]'}`}>{slot.label}</p>
                      <p className="text-xs text-[#6B6762] mt-0.5">{slot.time}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Generate Button */}
            <div className="py-6">
              <button
                className="w-full flex items-center justify-center gap-2.5 py-4 rounded-full bg-gradient-to-r from-[#FF6B6B] via-[#C77DBA] to-[#64D2FF] shadow-[0_4px_20px_rgba(255,107,107,0.3)] disabled:opacity-40 transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] hover:shadow-[0_8px_30px_rgba(255,107,107,0.4)] ripple-effect"
                onClick={() => {
                  setPublishStep("generate");
                  handleGenerate();
                }}
                disabled={selectedPlatforms.length === 0 || generating}
              >
                <Sparkles size={22} className="text-white" />
                <span className="text-base font-bold text-white">生成 {selectedPlatforms.length} 个平台发布方案</span>
              </button>
              {selectedPlatforms.length === 0 && (
                <p className="text-xs text-[#9B9691] text-center mt-2.5">请先选择至少一个发布平台</p>
              )}
            </div>
          </div>
        )}

        {/* ===== Generating Step ===== */}
        {publishStep === "generate" && generating && (
          <div className="flex flex-col items-center justify-center text-center py-20 px-6">
            <Loader2 size={48} className="text-[#FF6B6B] animate-spin" />
            <h2 className="text-xl font-bold text-[#F7F4EF] mt-6">AI 正在生成发布方案...</h2>
            <p className="text-sm text-[#9B9691] mt-2">正在为 {selectedPlatforms.length} 个平台量身定制标题、文案和标签</p>
            <div className="flex gap-2.5 mt-5 flex-wrap justify-center">
              {selectedPlatforms.map(pid => {
                const p = PLATFORMS.find(pl => pl.id === pid);
                if (!p) return null;
                const Icon = p.icon;
                return (
                  <div key={pid} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full" style={{ backgroundColor: `${p.color}1A`}}>
                    <Icon size={14} style={{ color: p.color }} />
                    <span className="text-sm font-semibold" style={{ color: p.color }}>{p.name}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ===== Review Step ===== */}
        {publishStep === "review" && !generating && (
          <div className="max-w-3xl mx-auto px-4 md:px-12 py-4">
            {/* Platform tabs */}
            <div className="flex justify-center gap-2.5 p-4">
              {selectedPlatforms.map(pid => {
                const p = PLATFORMS.find(pl => pl.id === pid);
                if (!p) return null;
                const isActive = activeDetailPlatform === pid || (!activeDetailPlatform && selectedPlatforms[0] === pid);
                const Icon = p.icon;
                return (
                  <button
                    key={pid}
                    className={`flex items-center gap-1.5 px-4 py-2.5 rounded-full border transition-all duration-200 ${isActive ? 'bg-opacity-10' : 'bg-opacity-5 border-[rgba(255,255,255,0.08)] bg-white'}`}
                    style={isActive ? { borderColor: p.color, backgroundColor: `${p.color}1A` } : {}}
                    onClick={() => setActiveDetailPlatform(pid)}
                  >
                    <Icon size={18} className={isActive ? '' : 'text-[#9B9691]'} style={isActive ? { color: p.color } : {}} />
                    <span className={`text-sm font-medium ${isActive ? '' : 'text-[#9B9691]'}`} style={isActive ? { color: p.color } : {}}>{p.name}</span>
                  </button>
                );
              })}
            </div>

            {/* Content Preview */}
            {(() => {
              const activePid = activeDetailPlatform || selectedPlatforms[0];
              const content = generatedContents[activePid];
              const platform = PLATFORMS.find(p => p.id === activePid);
              if (!content || !platform) return null;

              return (
                <div className="py-2">
                  {/* Title */}
                  <div className="glass-card-subtle p-4 mb-3">
                    <div className="flex justify-between items-center mb-2.5">
                      <h3 className="text-sm font-bold text-[#9B9691] uppercase tracking-wider">标题</h3>
                      <button onClick={() => handleCopy(content.title, `${activePid}-title`)} className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[rgba(255,255,255,0.06)] transition-all duration-200 hover:bg-[rgba(255,255,255,0.12)] hover:scale-105 active:scale-95">
                        <Copy size={16} className={copiedField === `${activePid}-title` ? "text-[#30D158]" : "text-[#9B9691]"} />
                        <span className={`text-xs font-medium ${copiedField === `${activePid}-title` ? "text-[#30D158]" : "text-[#9B9691]"}`}>
                          {copiedField === `${activePid}-title` ? "已复制" : "复制"}
                        </span>
                      </button>
                    </div>
                    <p className="text-lg font-bold text-[#F7F4EF] leading-snug">{content.title}</p>
                  </div>

                  {/* Caption */}
                  <div className="glass-card-subtle p-4 mb-3">
                    <div className="flex justify-between items-center mb-2.5">
                      <h3 className="text-sm font-bold text-[#9B9691] uppercase tracking-wider">文案</h3>
                      <button onClick={() => handleCopy(content.caption, `${activePid}-caption`)} className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[rgba(255,255,255,0.06)] transition-all duration-200 hover:bg-[rgba(255,255,255,0.12)] hover:scale-105 active:scale-95">
                        <Copy size={16} className={copiedField === `${activePid}-caption` ? "text-[#30D158]" : "text-[#9B9691]"} />
                        <span className={`text-xs font-medium ${copiedField === `${activePid}-caption` ? "text-[#30D158]" : "text-[#9B9691]"}`}>
                          {copiedField === `${activePid}-caption` ? "已复制" : "复制"}
                        </span>
                      </button>
                    </div>
                    <p className="text-base text-[#F7F4EF] leading-relaxed whitespace-pre-wrap">{content.caption}</p>
                  </div>

                  {/* Hashtags */}
                  <div className="glass-card-subtle p-4 mb-3">
                    <div className="flex justify-between items-center mb-2.5">
                      <h3 className="text-sm font-bold text-[#9B9691] uppercase tracking-wider">标签</h3>
                      <button onClick={() => handleCopy(content.hashtags.join(" "), `${activePid}-tags`)} className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[rgba(255,255,255,0.06)] transition-all duration-200 hover:bg-[rgba(255,255,255,0.12)] hover:scale-105 active:scale-95">
                        <Copy size={16} className={copiedField === `${activePid}-tags` ? "text-[#30D158]" : "text-[#9B9691]"} />
                        <span className={`text-xs font-medium ${copiedField === `${activePid}-tags` ? "text-[#30D158]" : "text-[#9B9691]"}`}>
                          {copiedField === `${activePid}-tags` ? "已复制" : "复制"}
                        </span>
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {content.hashtags.map((tag, i) => (
                        <div key={i} className="px-3 py-1.5 rounded-lg border" style={{ backgroundColor: `${platform.color}15`, borderColor: `${platform.color}30` }}>
                          <span className="text-sm font-semibold" style={{ color: platform.color }}>{tag}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Platform Tips */}
                  <div className="glass-card-subtle p-4 mb-3">
                    <h3 className="text-sm font-bold text-[#9B9691] uppercase tracking-wider mb-2.5">发布建议</h3>
                    <div className="space-y-2">
                      {platform.tips.map((tip, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <div className="w-1.5 h-1.5 rounded-full mt-1.5" style={{ backgroundColor: platform.color }} />
                          <p className="text-base text-[#F7F4EF] flex-1">{tip}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Time recommendation */}
                  <div className="flex items-center gap-3 bg-[#161618] rounded-2xl p-4 border mb-3" style={{ borderColor: `${platform.color}30` }}>
                    <Clock size={18} style={{ color: platform.color }} />
                    <div className="flex-1">
                      <p className="text-xs text-[#9B9691]">推荐发布时间</p>
                      <p className="text-base font-bold" style={{ color: platform.color }}>{platform.bestTime}</p>
                    </div>
                  </div>

                  {/* Copy All Button */}
                  <button
                    className="w-full flex items-center justify-center gap-2 py-3.5 rounded-full border transition-all duration-200"
                    style={{ backgroundColor: `${platform.color}15`, borderColor: `${platform.color}40` }}
                    onClick={() => handleCopy(
                      `${content.title}\n\n${content.caption}\n\n${content.hashtags.join(" ")}`,
                      `${activePid}-all`
                    )}
                  >
                    {copiedField === `${activePid}-all` ? <CheckCircle size={20} style={{ color: platform.color }} /> : <Copy size={20} style={{ color: platform.color }} />}
                    <span className="text-base font-bold" style={{ color: platform.color }}>
                      {copiedField === `${activePid}-all` ? "全部已复制！" : "一键复制全部内容"}
                    </span>
                  </button>
                </div>
              );
            })()}
          </div>
        )}

        <div className="h-10" />
      </div>
    </div>
  );
}
