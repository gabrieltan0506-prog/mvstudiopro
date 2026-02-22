
import React, { useState, useCallback, useRef } from "react";
import { useLocation, Link } from "wouter";
import { 
  Sun, Snowflake, Droplets, Zap, Film, Heart, Brain, Vibrate, Waves, Cloud, GitCompare, 
  ArrowLeft, Upload, Eye, EyeOff, ArrowLeftRight, Palette, Sparkles, ZoomIn, 
  ArrowDownToLine, ImageOff, X, CheckCircle, Loader2 
} from 'lucide-react';

/* ===== Filter Presets ===== */
const FILTERS = [
  { id: "warm-nostalgia", label: "暖色怀旧", icon: Sun, color: "#FF9F0A", css: "sepia(0.4) saturate(1.3) brightness(1.05) contrast(1.1)", desc: "温暖复古色调，适合情感回忆场景" },
  { id: "cold-lonely", label: "冷色孤寂", icon: Snowflake, color: "#64D2FF", css: "saturate(0.7) brightness(0.9) hue-rotate(200deg) contrast(1.15)", desc: "冷冽蓝调，营造孤独深沉氛围" },
  { id: "dream-soft", label: "梦幻柔光", icon: Droplets, color: "#C77DBA", css: "brightness(1.15) contrast(0.9) saturate(1.2) blur(0.5px)", desc: "柔和光晕效果，梦境般的视觉体验" },
  { id: "neon-cyber", label: "霓虹赛博", icon: Zap, color: "#30D158", css: "saturate(1.8) contrast(1.3) brightness(1.1) hue-rotate(10deg)", desc: "高饱和霓虹色彩，未来科技感" },
  { id: "retro-film", label: "复古胶片", icon: Film, color: "#FFD60A", css: "sepia(0.25) contrast(1.2) brightness(0.95) saturate(0.9)", desc: "经典胶片质感，电影般的颗粒感" },
  { id: "romantic-pink", label: "浪漫粉调", icon: Heart, color: "#FF6B6B", css: "saturate(1.1) brightness(1.1) hue-rotate(330deg) contrast(1.05)", desc: "粉色浪漫色调，适合爱情主题" },
];

/* ===== Dynamic Effects ===== */
const EFFECTS = [
  { id: "particle-fall", label: "粒子飘落", icon: Brain, color: "#FFD60A", desc: "雪花/花瓣/星尘飘落效果" },
  { id: "light-pulse", label: "光晕脉动", icon: Sun, color: "#FF6B6B", desc: "柔和光晕呼吸式脉动" },
  { id: "camera-shake", label: "镜头摇晃", icon: Vibrate, color: "#64D2FF", desc: "仿真手持摄影的微晃动" },
  { id: "color-wave", label: "色彩波动", icon: Waves, color: "#C77DBA", desc: "色彩渐变波浪式流动" },
  { id: "flash-beat", label: "闪光节拍", icon: Zap, color: "#FF9F0A", desc: "跟随音乐节拍的闪光效果" },
  { id: "smoke-atmo", label: "烟雾氛围", icon: Cloud, color: "#30D158", desc: "烟雾弥漫的神秘氛围" },
];

/* ===== Transition Effects ===== */
const TRANSITIONS = [
  { id: "crossfade", label: "交叉淡化", icon: GitCompare, color: "#64D2FF" },
  { id: "slide-left", label: "左滑切换", icon: ArrowLeft, color: "#FF6B6B" },
  { id: "zoom-in", label: "缩放进入", icon: ZoomIn, color: "#30D158" },
  { id: "blur-trans", label: "模糊过渡", icon: Droplets, color: "#C77DBA" },
  { id: "wipe-down", label: "下擦切换", icon: ArrowDownToLine, color: "#FFD60A" },
  { id: "glitch", label: "故障效果", icon: ImageOff, color: "#FF9F0A" },
];

/* ===== Sample video frames for preview ===== */
const SAMPLE_FRAMES = [
  { id: "frame1", url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/FMaQrMFVSirXzkvD.jpg", label: "红裙舞曲" },
  { id: "frame2", url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/gjuvwUewnWpQtpRZ.jpg", label: "城市夜曲" },
  { id: "frame3", url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/BrPAcibOmXsyMiua.jpg", label: "雨中深情" },
  { id: "frame4", url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/nthPJMSIfmabjtqj.jpg", label: "天使之翼" },
];

export default function EffectsPage() {
  const [location, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState<"filters" | "effects" | "transitions">("filters");
  const [selectedFilter, setSelectedFilter] = useState<string | null>(null);
  const [selectedEffects, setSelectedEffects] = useState<string[]>([]);
  const [selectedTransition, setSelectedTransition] = useState<string | null>(null);
  const [filterIntensity, setFilterIntensity] = useState(75);
  const [effectIntensity, setEffectIntensity] = useState(50);
  const [previewFrame, setPreviewFrame] = useState(0);
  const [showBefore, setShowBefore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);

  const toggleEffect = useCallback((id: string) => {
    setSelectedEffects(prev =>
      prev.includes(id) ? prev.filter(e => e !== id) : [...prev, id]
    );
  }, []);

  const handleUpload = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setUploadedImage(ev.target?.result as string);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleExport = useCallback(async () => {
    setExporting(true);
    await new Promise(r => setTimeout(r, 1500));
    const config = {
      filter: selectedFilter,
      effects: selectedEffects,
      transition: selectedTransition,
      filterIntensity,
      effectIntensity,
      exportedAt: new Date().toISOString(),
    };
    try {
      const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mv-effects-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Export failed:", e);
    }
    setExporting(false);
    setExported(true);
    setTimeout(() => setExported(false), 3000);
  }, [selectedFilter, selectedEffects, selectedTransition, filterIntensity, effectIntensity]);

  const currentFilter = FILTERS.find(f => f.id === selectedFilter);
  const currentFrame = uploadedImage || SAMPLE_FRAMES[previewFrame].url;
  const filterStyle = currentFilter
    ? `${currentFilter.css.replace(/[\d.]+/g, (m, offset, str) => {
        const num = parseFloat(m);
        if (isNaN(num)) return m;
        const factor = filterIntensity / 100;
        if (str.substring(offset - 10, offset).includes("blur")) return String(num * factor);
        if (num > 1) return String(1 + (num - 1) * factor);
        if (num < 1) return String(1 - (1 - num) * factor);
        return m;
      })}`
    : "none";

  const TABS = [
    { id: "filters" as const, label: "情感滤镜", icon: Palette },
    { id: "effects" as const, label: "动态特效", icon: Sparkles },
    { id: "transitions" as const, label: "转场效果", icon: ArrowLeftRight },
  ];

  return (
    <div className="min-h-screen bg-[#0D0D0F] text-[#F7F4EF]">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={handleFileChange}
      />
      <div className="flex-grow bg-[#0D0D0F]">
        {/* ===== Header ===== */}
        <header className="sticky top-0 z-50 bg-[rgba(16,16,18,0.92)] border-b border-[rgba(255,255,255,0.06)] backdrop-blur-xl">
          <div className="flex items-center justify-between max-w-6xl mx-auto px-5 md:px-12 py-3.5">
            <button onClick={() => window.history.back()} className="w-10 h-10 rounded-full bg-[rgba(255,255,255,0.08)] flex items-center justify-center">
              <ArrowLeft size={22} />
            </button>
            <div className="flex-1 ml-3.5">
              <h1 className="text-lg font-bold text-[#F7F4EF]">分镜转视频</h1>
              <p className="text-xs text-[#9B9691] mt-0.5">打造电影级视觉体验</p>
            </div>
            <button onClick={handleUpload} className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-[rgba(48,209,88,0.12)] border border-[rgba(48,209,88,0.3)]">
              <Upload size={20} className="text-[#30D158]" />
              <span className="text-sm font-semibold text-[#30D158]">上传素材</span>
            </button>
          </div>
        </header>

        {/* ===== Preview Panel ===== */}
        <section className="px-4 md:px-12 py-6 flex flex-col items-center">
          <div className="w-full max-w-2xl flex flex-col items-center">
            <button
              className="self-end flex items-center gap-1.5 mb-2.5 px-3 py-1.5 rounded-full bg-[rgba(255,255,255,0.08)]"
              onClick={() => setShowBefore(!showBefore)}
            >
              {showBefore ? <EyeOff size={16} /> : <Eye size={16} />}
              <span className="text-xs font-semibold">{showBefore ? "原图" : "效果"}</span>
            </button>

            <div className="w-full aspect-[16/10] rounded-xl overflow-hidden bg-[#1A1A1D] relative shadow-2xl shadow-black/50">
              <img
                src={currentFrame}
                className="w-full h-full object-contain transition-all duration-300 ease-in-out rounded-xl"
                style={{ filter: showBefore ? "none" : filterStyle }}
              />

              {!showBefore && selectedEffects.length > 0 && (
                <div className="absolute bottom-2.5 left-2.5 flex flex-wrap gap-1.5">
                  {selectedEffects.map(eid => {
                    const eff = EFFECTS.find(e => e.id === eid);
                    if (!eff) return null;
                    const Icon = eff.icon;
                    return (
                      <div key={eid} className="flex items-center gap-1 px-2 py-1 rounded-lg border" style={{ backgroundColor: `${eff.color}30`, borderColor: `${eff.color}60` }}>
                        <Icon size={12} color={eff.color} />
                        <span className="text-xs font-semibold" style={{ color: eff.color }}>{eff.label}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {!showBefore && selectedTransition && (
                <div className="absolute top-2.5 right-2.5 flex items-center gap-1 px-2.5 py-1.5 rounded-lg border bg-[rgba(100,210,255,0.15)] border-[rgba(100,210,255,0.3)]">
                  <ArrowLeftRight size={14} className="text-[#64D2FF]" />
                  <span className="text-xs font-semibold text-[#64D2FF]">
                    {TRANSITIONS.find(t => t.id === selectedTransition)?.label}
                  </span>
                </div>
              )}
            </div>

            {!uploadedImage && (
              <div className="flex gap-2.5 mt-4 justify-center">
                {SAMPLE_FRAMES.map((frame, index) => (
                  <button key={frame.id} onClick={() => setPreviewFrame(index)} className={`w-16 md:w-20 rounded-lg overflow-hidden border-2 ${previewFrame === index ? 'border-[#FF6B6B]' : 'border- '}`}>
                    <img src={frame.url} className="w-full aspect-[0.75] object-cover rounded-md" />
                    <span className={`text-xs mt-1 text-center ${previewFrame === index ? 'text-[#FF6B6B] font-semibold' : 'text-[#9B9691]'}`}>{frame.label}</span>
                  </button>
                ))}
              </div>
            )}
            {uploadedImage && (
              <button onClick={() => setUploadedImage(null)} className="flex items-center gap-1 mt-3 px-3 py-1.5 rounded-full bg-[rgba(255,107,107,0.1)]">
                <X size={14} className="text-[#FF6B6B]" />
                <span className="text-xs text-[#FF6B6B]">清除上传</span>
              </button>
            )}
          </div>
        </section>

        {/* ===== Tabs ===== */}
        <div className="flex justify-center gap-2 md:gap-4 px-4 py-3 border-b border-[rgba(255,255,255,0.06)]">
          {TABS.map(tab => {
            const isActive = activeTab === tab.id;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3.5 md:px-5 py-2.5 rounded-full ${isActive ? 'bg-[rgba(255,107,107,0.12)] border border-[rgba(255,107,107,0.3)]' : 'bg-[rgba(255,255,255,0.04)]'}`}>
                <Icon size={18} className={isActive ? 'text-[#FF6B6B]' : 'text-[#9B9691]'} />
                <span className={`text-sm font-medium ${isActive ? 'text-[#FF6B6B] font-semibold' : 'text-[#9B9691]'}`}>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* ===== Controls ===== */}
        <section className="px-4 md:px-12 py-5 max-w-5xl mx-auto w-full">
          {activeTab === 'filters' && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 md:gap-3.5">
              {FILTERS.map(filter => {
                const isSelected = selectedFilter === filter.id;
                const Icon = filter.icon;
                return (
                  <div key={filter.id} onClick={() => setSelectedFilter(isSelected ? null : filter.id)} className="bg-[#161618] rounded-2xl p-4 border border-[rgba(255,255,255,0.06)] relative cursor-pointer">
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-2.5" style={{ backgroundColor: `${filter.color}20` }}>
                      <Icon size={24} color={filter.color} />
                    </div>
                    <h3 className="text-base font-bold text-[#F7F4EF] mb-1">{filter.label}</h3>
                    <p className="text-xs text-[#9B9691] leading-relaxed">{filter.desc}</p>
                    {isSelected && (
                      <div className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full flex items-center justify-center" style={{ backgroundColor: filter.color }}>
                        <CheckCircle size={14} className="text-white" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {activeTab === 'effects' && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 md:gap-3.5">
              {EFFECTS.map(effect => {
                const isSelected = selectedEffects.includes(effect.id);
                const Icon = effect.icon;
                return (
                  <div key={effect.id} onClick={() => toggleEffect(effect.id)} className="bg-[#161618] rounded-2xl p-4 border border-[rgba(255,255,255,0.06)] relative cursor-pointer">
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-2.5" style={{ backgroundColor: `${effect.color}20` }}>
                      <Icon size={24} color={effect.color} />
                    </div>
                    <h3 className="text-base font-bold text-[#F7F4EF] mb-1">{effect.label}</h3>
                    <p className="text-xs text-[#9B9691] leading-relaxed">{effect.desc}</p>
                    {isSelected && (
                      <div className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full flex items-center justify-center" style={{ backgroundColor: effect.color }}>
                        <CheckCircle size={14} className="text-white" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {activeTab === 'transitions' && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 md:gap-3.5">
              {TRANSITIONS.map(trans => {
                const isSelected = selectedTransition === trans.id;
                const Icon = trans.icon;
                return (
                  <div key={trans.id} onClick={() => setSelectedTransition(isSelected ? null : trans.id)} className="bg-[#161618] rounded-2xl p-4 border border-[rgba(255,255,255,0.06)] relative cursor-pointer">
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-2.5" style={{ backgroundColor: `${trans.color}20` }}>
                      <Icon size={24} color={trans.color} />
                    </div>
                    <h3 className="text-base font-bold text-[#F7F4EF] mb-1">{trans.label}</h3>
                    {isSelected && (
                      <div className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full flex items-center justify-center" style={{ backgroundColor: trans.color }}>
                        <CheckCircle size={14} className="text-white" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Sliders */}
          {(activeTab === 'filters' && selectedFilter) && (
            <div className="mt-6 bg-[#161618] rounded-2xl p-5 border border-[rgba(255,255,255,0.06)]">
              <div className="flex justify-between items-center mb-3.5">
                <label className="text-base font-semibold text-[#F7F4EF]">滤镜强度</label>
                <span className="text-xl font-extrabold" style={{ color: currentFilter?.color }}>{filterIntensity}%</span>
              </div>
              <input type="range" min="0" max="100" value={filterIntensity} onChange={(e) => setFilterIntensity(Number(e.target.value))} className="w-full h-1.5 bg-[rgba(255,255,255,0.08)] rounded-full appearance-none cursor-pointer" />
              <p className="text-xs text-[#9B9691] mt-2.5">调整滤镜的应用强度，0为无效果，100为最强效果。</p>
            </div>
          )}
          {(activeTab === 'effects' && selectedEffects.length > 0) && (
            <div className="mt-6 bg-[#161618] rounded-2xl p-5 border border-[rgba(255,255,255,0.06)]">
              <div className="flex justify-between items-center mb-3.5">
                <label className="text-base font-semibold text-[#F7F4EF]">特效强度</label>
                <span className="text-xl font-extrabold text-[#FF6B6B]">{effectIntensity}%</span>
              </div>
              <input type="range" min="0" max="100" value={effectIntensity} onChange={(e) => setEffectIntensity(Number(e.target.value))} className="w-full h-1.5 bg-[rgba(255,255,255,0.08)] rounded-full appearance-none cursor-pointer" />
              <p className="text-xs text-[#9B9691] mt-2.5">统一调整所有选中动态特效的强度。</p>
            </div>
          )}
        </section>

        {/* ===== Summary & Export ===== */}
        <section className="px-4 md:px-12 py-6 max-w-5xl mx-auto w-full">
          <h2 className="text-lg font-bold text-[#F7F4EF] mb-4">效果总览</h2>
          <div className="grid gap-2.5 mb-6">
            <div className="flex items-center gap-2.5 bg-[#161618] rounded-xl p-3.5 border border-[rgba(255,255,255,0.06)]">
              <span className="text-sm font-semibold text-[#9B9691] w-12">滤镜</span>
              <span className="text-sm text-[#F7F4EF] flex-1">{currentFilter?.label || '未选择'}</span>
            </div>
            <div className="flex items-center gap-2.5 bg-[#161618] rounded-xl p-3.5 border border-[rgba(255,255,255,0.06)]">
              <span className="text-sm font-semibold text-[#9B9691] w-12">特效</span>
              <span className="text-sm text-[#F7F4EF] flex-1">{selectedEffects.map(id => EFFECTS.find(e => e.id === id)?.label).join(', ') || '未选择'}</span>
            </div>
            <div className="flex items-center gap-2.5 bg-[#161618] rounded-xl p-3.5 border border-[rgba(255,255,255,0.06)]">
              <span className="text-sm font-semibold text-[#9B9691] w-12">转场</span>
              <span className="text-sm text-[#F7F4EF] flex-1">{TRANSITIONS.find(t => t.id === selectedTransition)?.label || '未选择'}</span>
            </div>
          </div>
          <button onClick={handleExport} disabled={exporting || exported} className="w-full flex items-center justify-center gap-2 py-4 rounded-3xl bg-gradient-to-r from-[#FF6B6B] via-[#C77DBA] to-[#64D2FF] shadow-lg shadow-[#FF6B6B]/30 disabled:opacity-40">
            {exporting ? <Loader2 className="animate-spin" /> : <span className="text-base font-bold text-white">{exported ? '已导出配置' : '导出效果配置'}</span>}
          </button>
        </section>

        {/* ===== Tool Description ===== */}
        <section className="py-7 border-t border-[rgba(255,255,255,0.06)] max-w-6xl mx-auto w-full">
          <h2 className="text-lg font-bold text-[#F7F4EF] mb-4 px-4 md:px-12">工具说明</h2>
          <div className="flex overflow-x-auto px-4 md:px-12 gap-3 pb-4">
            {[...FILTERS, ...EFFECTS].map(tool => {
              const Icon = tool.icon;
              return (
                <div key={tool.id} className="w-40 md:w-52 flex-shrink-0 bg-[#161618] rounded-2xl p-4 border border-[rgba(255,255,255,0.06)]">
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-2.5" style={{ backgroundColor: `${tool.color}20` }}>
                    <Icon size={24} color={tool.color} />
                  </div>
                  <h4 className="text-sm font-bold text-[#F7F4EF] mb-1.5">{tool.label}</h4>
                  <p className="text-xs text-[#9B9691] leading-relaxed">{tool.desc}</p>
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
