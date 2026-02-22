// @ts-nocheck
import { useLocation, Link } from "wouter";
import { Film, ZoomIn, Zap, Palette, Film, Rotate3d, Check, Timer, Loader2, Play, Download, ArrowLeft, CheckCircle, Wand2 } from "lucide-react";
import { useState, useCallback, useRef } from "react";
import { toast } from "sonner";

/* ===== Intro Animation Templates ===== */
const INTRO_TEMPLATES = [
  {
    id: "logo-zoom",
    title: "Logo 缩放光效",
    desc: "Logo 从中心放大，搭配光晕扩散效果",
    duration: "3s",
    icon: ZoomIn,
    color: "#FF6B6B",
    previewBg: "#1A0A0A",
  },
  {
    id: "particle-burst",
    title: "粒子爆发",
    desc: "粒子从四面八方汇聚成 Logo 形状",
    duration: "4s",
    icon: Zap,
    color: "#64D2FF",
    previewBg: "#0A1520",
  },
  {
    id: "glitch-reveal",
    title: "故障风揭示",
    desc: "赛博朋克风格故障效果揭示 Logo",
    duration: "3s",
    icon: Zap,
    color: "#C77DBA",
    previewBg: "#150A1A",
  },
  {
    id: "neon-trace",
    title: "霓虹描边",
    desc: "霓虹光线沿 Logo 轮廓描绘动画",
    duration: "5s",
    icon: Palette,
    color: "#30D158",
    previewBg: "#0A150A",
  },
  {
    id: "cinematic-fade",
    title: "电影级淡入",
    desc: "搭配镜头光晕的电影级淡入效果",
    duration: "4s",
    icon: Film,
    color: "#FFD60A",
    previewBg: "#1A1500",
  },
  {
    id: "3d-rotate",
    title: "3D 旋转入场",
    desc: "Logo 3D 旋转翻转入场动画",
    duration: "3s",
    icon: Rotate3d,
    color: "#FF9F0A",
    previewBg: "#1A1005",
  },
];

/* ===== Video Intro Videos (existing MV data for download) ===== */
const INTRO_VIDEOS = [
  {
    id: "mv-intro-1",
    title: "忆网情深 M&F — 红裙舞曲",
    thumbnail: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/FMaQrMFVSirXzkvD.jpg",
    videoUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/jxmFvYYJQHLTAQWr.mp4",
    duration: "0:35",
    size: "8.2 MB",
  },
  {
    id: "mv-intro-2",
    title: "忆网情深 M&F — 城市夜曲",
    thumbnail: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/gjuvwUewnWpQtpRZ.jpg",
    videoUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/bGfNjLQhJfLqnXWQ.mp4",
    duration: "0:35",
    size: "7.8 MB",
  },
  {
    id: "mv-intro-3",
    title: "意想爱 韩风版 — 花园晨曦",
    thumbnail: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/CXzVPwztIGcraPfw.jpg",
    videoUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/YPTNJpRfFjJxGNpP.mp4",
    duration: "0:35",
    size: "9.1 MB",
  },
];

export default function IntroPreviewPage() {
  const [, navigate] = useLocation();
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [playingVideo, setPlayingVideo] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const handleGenerate = useCallback(async () => {
    if (!selectedTemplate) return;
    setGenerating(true);
    // Simulate generation
    await new Promise(r => setTimeout(r, 3000));
    setGenerating(false);
    setGenerated(true);
    toast.success("生成成功", { description: "片头动画已生成，可以预览和下载" });
  }, [selectedTemplate]);

  const handleDownloadVideo = useCallback(async (videoUrl: string, title: string) => {
    setDownloading(videoUrl);
    try {
      const response = await fetch(videoUrl);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("下载成功", { description: `${title} 已开始下载` });
    } catch (err) {
      console.error("Download failed:", err);
      toast.error("下载失败", { description: "请稍后重试" });
    } finally {
      setDownloading(null);
    }
  }, []);

  const handlePlayVideo = useCallback((videoUrl: string) => {
    if (playingVideo === videoUrl) {
      setPlayingVideo(null);
      return;
    }
    setPlayingVideo(videoUrl);
  }, [playingVideo]);

  return (
    <div className="min-h-screen bg-[#0A0A0C] text-[#F7F4EF]">
      <div className="flex-grow pb-10">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3">
          <button onClick={() => window.history.back()} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-lg font-bold">片头动画工坊</h1>
          <div className="w-10" />
        </div>

        {/* Hero Section */}
        <div className="flex flex-col items-center px-6 py-8 text-center">
          <div className="mb-4 flex h-18 w-18 items-center justify-center rounded-2xl bg-yellow-500/10">
            <Film size={40} className="text-yellow-400" />
          </div>
          <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-2">打造震撼开场</h2>
          <p className="text-gray-400 max-w-md">
            选择动画模板，为您的视频生成专业级片头动画
          </p>
        </div>

        {/* Rainbow divider */}
        <div className="mx-6 my-2 h-1 rounded-full overflow-hidden flex">
          <div className="flex-1 bg-[#FF6B6B]"></div>
          <div className="flex-1 bg-[#FFD60A]"></div>
          <div className="flex-1 bg-[#30D158]"></div>
          <div className="flex-1 bg-[#64D2FF]"></div>
          <div className="flex-1 bg-[#C77DBA]"></div>
        </div>

        {/* Animation Templates */}
        <div className="px-5 py-6">
          <p className="text-center text-xs font-bold tracking-widest text-yellow-400 mb-1.5">ANIMATION TEMPLATES</p>
          <h3 className="text-center text-2xl md:text-3xl font-extrabold tracking-tight mb-1">动画模板</h3>
          <p className="text-center text-sm text-gray-400 mb-5">选择一种片头动画风格</p>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {INTRO_TEMPLATES.map((tmpl) => {
              const isSelected = selectedTemplate === tmpl.id;
              return (
                <button
                  key={tmpl.id}
                  className={`bg-[#1A1A1E] rounded-2xl overflow-hidden border ${isSelected ? 'border-2' : 'border-white/10'}`}
                  style={{ borderColor: isSelected ? tmpl.color : 'rgba(255,255,255,0.06)' }}
                  onClick={() => {
                    setSelectedTemplate(tmpl.id);
                    setGenerated(false);
                  }}
                >
                  <div className="h-20 flex items-center justify-center relative" style={{ backgroundColor: tmpl.previewBg }}>
                    <tmpl.icon size={32} color={tmpl.color} />
                    {isSelected && (
                      <div className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center" style={{ backgroundColor: tmpl.color }}>
                        <Check size={14} color="#FFF" />
                      </div>
                    )}
                  </div>
                  <div className="p-3 text-left">
                    <p className="font-bold text-sm mb-1">{tmpl.title}</p>
                    <p className="text-xs text-gray-400 leading-snug mb-1.5">{tmpl.desc}</p>
                    <div className="flex items-center gap-1 text-gray-400">
                      <Timer size={12} />
                      <span className="text-xs">{tmpl.duration}</span>
                    </div>
                  </div>
                  <div className="h-1" style={{ backgroundColor: tmpl.color }} />
                </button>
              );
            })}
          </div>

          {/* Generate Button */}
          <button
            className="w-full mt-5 flex items-center justify-center gap-2 rounded-full py-4 text-base font-bold text-white bg-gradient-to-r from-[#FF6B6B] via-[#C77DBA] to-[#64D2FF] disabled:opacity-40 transition-opacity"
            onClick={handleGenerate}
            disabled={generating || !selectedTemplate}
          >
            {generating ? (
              <Loader2 size={22} className="animate-spin" />
            ) : generated ? (
              <>
                <CheckCircle size={22} />
                <span>生成完成！</span>
              </>
            ) : (
              <>
                <Wand2 size={22} />
                <span>生成片头动画</span>
              </>
            )}
          </button>
        </div>

        {/* Rainbow divider */}
        <div className="mx-6 my-2 h-1 rounded-full overflow-hidden flex">
          <div className="flex-1 bg-[#C77DBA]"></div>
          <div className="flex-1 bg-[#64D2FF]"></div>
          <div className="flex-1 bg-[#30D158]"></div>
          <div className="flex-1 bg-[#FFD60A]"></div>
          <div className="flex-1 bg-[#FF6B6B]"></div>
        </div>

        {/* MV Download Section */}
        <div className="px-5 py-6">
          <p className="text-center text-xs font-bold tracking-widest text-blue-400 mb-1.5">VIDEO DOWNLOADS</p>
          <h3 className="text-center text-2xl md:text-3xl font-extrabold tracking-tight mb-1">视频视频下载</h3>
          <p className="text-center text-sm text-gray-400 mb-5">下载精选视频视频到本地</p>

          <div className="space-y-3">
            {INTRO_VIDEOS.map((video) => {
              const isPlaying = playingVideo === video.videoUrl;
              const isDownloading = downloading === video.videoUrl;
              return (
                <div key={video.id} className="bg-[#1A1A1E] rounded-2xl overflow-hidden border border-white/10">
                  {/* Video Preview / Player */}
                  <button
                    className="w-full h-52 bg-[#111114] relative"
                    onClick={() => handlePlayVideo(video.videoUrl)}
                  >
                    {isPlaying ? (
                      <div className="w-full h-full">
                        <video
                          ref={videoRef}
                          src={video.videoUrl}
                          autoPlay
                          controls
                          playsInline
                          className="w-full h-full object-cover rounded-t-2xl"
                        />
                      </div>
                    ) : (
                      <>
                        <img src={video.thumbnail} alt={video.title} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                          <div className="w-14 h-14 rounded-full bg-red-500/90 flex items-center justify-center">
                            <Play size={32} className="text-white" />
                          </div>
                        </div>
                        <div className="absolute bottom-2 right-2 bg-black/70 px-2 py-0.5 rounded">
                          <span className="text-xs font-semibold text-white">{video.duration}</span>
                        </div>
                      </>
                    )}
                  </button>

                  {/* Video Info */}
                  <div className="p-3.5 pt-3">
                    <p className="font-bold text-base truncate mb-1">{video.title}</p>
                    <p className="text-xs text-gray-400">{video.size}</p>
                  </div>

                  {/* Download Button */}
                  <div className="p-3.5 pt-0">
                    <button
                      className="w-full flex items-center justify-center gap-1.5 py-3 rounded-lg bg-green-500 disabled:opacity-50 transition-opacity"
                      onClick={() => handleDownloadVideo(video.videoUrl, video.title)}
                      disabled={isDownloading}
                    >
                      {isDownloading ? (
                        <Loader2 size={20} className="animate-spin text-white" />
                      ) : (
                        <>
                          <Download size={20} className="text-white" />
                          <span className="text-sm font-bold text-white">下载</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="h-16" />
      </div>
    </div>
  );
}
