// @ts-nocheck
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
import { ExpiryWarningBanner, CreationHistoryPanel, FavoriteButton } from "@/components/CreationManager";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { JOB_PROGRESS_MESSAGES, createJob, getJob } from "@/lib/jobs";
import { 
  Music, 
  ArrowLeft, 
  Pencil, 
  Music2, 
  Music2, 
  Sparkles, 
  Wand2, 
  Settings2, 
  Voicemail, 
  Mic, 
  Palette, 
  Smile, 
  ListMusic, 
  CheckCircle, 
  Play, 
  Download, 
  AlertTriangle, 
  RefreshCw, 
  Loader2 
} from "lucide-react";

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
export default function AudioLabPage() {
  const [location, navigate] = useLocation();
  const { user } = useAuth();

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
  const [progressMessage, setProgressMessage] = useState("");
  const [creditCost, setCreditCost] = useState(0);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const generateLyrics = trpc.suno.generateLyrics.useMutation();

  // 水印音频（入门版用户播放前加入 MVStudioPro.com 语音）
  const watermarkQuery = trpc.suno.getWatermarkAudio.useQuery(undefined, {
    staleTime: Infinity,
    retry: false,
  });
  const watermarkAudioRef = useRef<HTMLAudioElement | null>(null);
  const songAudioRef = useRef<HTMLAudioElement | null>(null);

  const handlePlayWithWatermark = useCallback((audioUrl: string) => {
    // 停止之前的播放
    if (watermarkAudioRef.current) {
      watermarkAudioRef.current.pause();
      watermarkAudioRef.current = null;
    }
    if (songAudioRef.current) {
      songAudioRef.current.pause();
      songAudioRef.current = null;
    }

    if (watermarkQuery.data?.enabled && watermarkQuery.data?.watermarkUrl) {
      // 入门版用户：先播放水印语音，再播放歌曲
      const wmAudio = new Audio(watermarkQuery.data.watermarkUrl);
      watermarkAudioRef.current = wmAudio;
      wmAudio.onended = () => {
        const songAudio = new Audio(audioUrl);
        songAudioRef.current = songAudio;
        songAudio.play().catch(() => {});
      };
      wmAudio.play().catch(() => {
        // 如果水印播放失败，直接播放歌曲
        const songAudio = new Audio(audioUrl);
        songAudioRef.current = songAudio;
        songAudio.play().catch(() => {});
      });
    } else {
      // 管理员或水印不可用：直接播放
      const songAudio = new Audio(audioUrl);
      songAudioRef.current = songAudio;
      songAudio.play().catch(() => {});
    }
  }, [watermarkQuery.data]);

  // 清理轮询
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, []);

  // ─── 风格标签切换 ──────────────────────────────
  const toggleStyle = useCallback((id: string) => {
    setSelectedStyles(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  }, []);

  const toggleMood = useCallback((id: string) => {
    setSelectedMoods(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  }, []);

  // ─── 构建风格字符串 ────────────────────────────
  const buildStyleString = (): string => {
    const parts: string[] = [];

    selectedStyles.forEach(id => {
      const tag = STYLE_TAGS.find(t => t.id === id);
      if (tag) parts.push(tag.label);
    });

    selectedMoods.forEach(id => {
      const mood = MOOD_TAGS.find(m => m.id === id);
      if (mood) parts.push(mood.style);
    });

    if (vocalGender === "male") parts.push("Male Vocal");
    if (vocalGender === "female") parts.push("Female Vocal");

    return parts.join(", ") || "Pop, Modern";
  };

  const startPolling = useCallback((tid: string) => {
    setStatus("polling");
    setProgressMessage(JOB_PROGRESS_MESSAGES.audio[0]);
    let attempts = 0;
    const maxAttempts = 120;

    pollingRef.current = setInterval(async () => {
      attempts++;
      if (attempts > maxAttempts) {
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
        setStatus("error");
        setErrorMsg("这次生成时间有点久，请点击重试。");
        return;
      }

      try {
        const data = await getJob(tid);
        const messageIndex = Math.floor(attempts / 2) % JOB_PROGRESS_MESSAGES.audio.length;
        setProgressMessage(JOB_PROGRESS_MESSAGES.audio[messageIndex]);

        if (data.status === "succeeded") {
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
          const output = (data.output || {}) as any;
          setSongs(output.songs || []);
          setCreditCost(typeof output.creditCost === "number" ? output.creditCost : 0);
          setStatus("success");
          toast.success("音乐生成成功！");
        } else if (data.status === "failed") {
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
          setStatus("error");
          setErrorMsg("这次生成没有成功，请点击重试。");
        }
      } catch {
        // 忽略单次轮询错误
      }
    }, 1800);
  }, []);

  // ─── 提交生成 ──────────────────────────────────
  const handleGenerate = useCallback(async () => {
    const songTitle = title.trim() || (mode === "simple" ? "AI 生成歌曲" : "自定义歌曲");

    if (mode === "simple" && !description.trim() && selectedStyles.length === 0) {
      toast.error("请输入歌曲描述或选择至少一个风格标签");
      return;
    }
    if (mode === "custom" && !lyrics.trim()) {
      toast.error("Custom 模式需要填入歌词");
      return;
    }

    setStatus("generating");
    setErrorMsg("");
    setProgressMessage("正在提交任务...");
    setSongs([]);
    if (!user?.id) {
      setStatus("error");
      setErrorMsg("登录状态已失效，请重新登录后再试。");
      return;
    }

    try {
      const styleStr = mode === "custom" && customStyle.trim()
        ? customStyle.trim()
        : buildStyleString();

      const moodStr = selectedMoods
        .map(id => MOOD_TAGS.find(m => m.id === id)?.style)
        .filter(Boolean)
        .join(", ");

      if (mode === "simple") {
        const { jobId } = await createJob({
          type: "audio",
          userId: String(user.id),
          input: {
            action: "suno_music",
            params: {
              mode: instrumental ? "bgm" : "theme_song",
              model: engine,
              title: songTitle,
              lyrics: instrumental ? undefined : description.trim() || undefined,
              customStyle: styleStr || undefined,
              mood: moodStr || description.trim() || undefined,
            },
          },
        });

        setTaskId(jobId);
        startPolling(jobId);
      } else {
        const { jobId } = await createJob({
          type: "audio",
          userId: String(user.id),
          input: {
            action: "suno_music",
            params: {
              mode: "theme_song",
              model: engine,
              title: songTitle,
              lyrics: lyrics.trim(),
              mood: styleStr || undefined,
            },
          },
        });

        setTaskId(jobId);
        startPolling(jobId);
      }
    } catch (err: any) {
      setStatus("error");
      setErrorMsg("任务提交失败，请稍后重试。");
    }
  }, [mode, engine, title, description, lyrics, customStyle, selectedStyles, selectedMoods, instrumental, vocalGender, startPolling, buildStyleString, user?.id]);

  // ─── AI 歌词助手 ──────────────────────────────
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [lyricsPrompt, setLyricsPrompt] = useState("");

  const handleGenerateLyrics = useCallback(async () => {
    if (!lyricsPrompt.trim()) {
      toast.error("请输入歌词主题或故事描述");
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
      toast.success("AI 歌词已生成！");
    } catch (err: any) {
      toast.error("歌词生成失败", { description: err?.message || "请稍后重试" });
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
    setProgressMessage("");
    setDescription("");
    setLyrics("");
    setCustomStyle("");
    setTitle("");
    setSelectedStyles([]);
    setSelectedMoods([]);
    setVocalGender("");
    setInstrumental(false);
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  // ─── 渲染 ──────────────────────────────────────
  const isGenerating = status === "generating" || status === "polling";

  return (
    <div className="flex flex-col h-screen bg-[#0A0A0C] text-[#F7F4EF]">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-white/10">
        <Link href="/">
          <button className="p-2 rounded-full hover:bg-white/10 transition-colors">
            <ArrowLeft size={24} />
          </button>
        </Link>
        <div className="flex items-center gap-2">
          <Music2 size={22} className="text-[#E8825E]" />
          <h1 className="text-lg font-bold">音乐工作室</h1>
        </div>
        <div className="w-10" />
      </div>

      <div className="flex-1 overflow-y-auto p-4 pb-32 space-y-6">
        {/* 到期提醒 */}
        <ExpiryWarningBanner />
        {/* Mode + Engine Selector */}
        <div className="flex items-center justify-between">
          <div className="flex p-1 bg-white/5 rounded-xl">
            <button 
              onClick={() => setMode("simple")}
              className={`px-5 py-2 rounded-lg text-sm font-semibold transition-colors ${mode === 'simple' ? 'bg-white/10 text-white' : 'text-gray-400 hover:bg-white/5'}`}>
              Simple
            </button>
            <button 
              onClick={() => setMode("custom")}
              className={`px-5 py-2 rounded-lg text-sm font-semibold transition-colors ${mode === 'custom' ? 'bg-white/10 text-white' : 'text-gray-400 hover:bg-white/5'}`}>
              Custom
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button 
              onClick={() => setEngine("V4")}
              className={`flex flex-col items-center px-4 py-1.5 rounded-lg border transition-all ${engine === 'V4' ? 'border-[#E8825E] bg-[#E8825E]/10' : 'border- bg-white/5 hover:bg-white/10'}`}>
              <span className={`text-sm font-bold ${engine === 'V4' ? 'text-[#E8825E]' : 'text-gray-400'}`}>V4</span>
              <span className="text-xs text-gray-500">12C</span>
            </button>
            <button 
              onClick={() => setEngine("V5")}
              className={`flex flex-col items-center px-4 py-1.5 rounded-lg border transition-all ${engine === 'V5' ? 'border-[#E8825E] bg-[#E8825E]/10' : 'border- bg-white/5 hover:bg-white/10'}`}>
              <span className={`text-sm font-bold ${engine === 'V5' ? 'text-[#E8825E]' : 'text-gray-400'}`}>V5</span>
              <span className="text-xs text-gray-500">22C</span>
            </button>
          </div>
        </div>

        {/* ═══ Simple 模式 ═══ */}
        {mode === "simple" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-gray-400">
                <Pencil size={16} />
                <h2 className="font-semibold">歌曲描述</h2>
              </div>
              <textarea
                className="w-full h-24 p-3 bg-white/5 rounded-lg border border-white/10 focus:ring-2 focus:ring-[#E8825E] focus:border-[#E8825E] outline-none transition"
                placeholder="描述你想要的歌曲，例如：一首关于夏天海边的轻快流行歌..."
                maxLength={500}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              <p className="text-xs text-right text-gray-500">{description.length}/500</p>
            </div>

            <button onClick={() => setInstrumental(!instrumental)} className="flex items-center justify-between w-full p-3 bg-white/5 rounded-lg hover:bg-white/10 transition-colors">
              <div className="flex items-center gap-2">
                <Music2 size={18} className={instrumental ? "text-[#E8825E]" : "text-gray-400"} />
                <span className={instrumental ? "text-[#E8825E] font-semibold" : "text-gray-300"}>纯音乐（无人声）</span>
              </div>
              <div className={`w-10 h-6 flex items-center rounded-full p-1 transition-colors ${instrumental ? 'bg-[#E8825E]' : 'bg-gray-600'}`}>
                  <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${instrumental ? 'translate-x-4' : ''}`} />
              </div>
            </button>
          </div>
        )}

        {/* ═══ Custom 模式 ═══ */}
        {mode === "custom" && (
          <div className="space-y-6">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-gray-400">
                <div className="flex items-center gap-2">
                  <Music2 size={16} />
                  <h2 className="font-semibold">歌词</h2>
                </div>
                <span className="text-xs">用 [Verse] [Chorus] [Bridge] 标记段落</span>
              </div>
              <textarea
                className="w-full h-48 p-3 bg-white/5 rounded-lg border border-white/10 focus:ring-2 focus:ring-[#E8825E] focus:border-[#E8825E] outline-none transition"
                placeholder="[Verse]...
[Chorus]..."
                maxLength={3000}
                value={lyrics}
                onChange={(e) => setLyrics(e.target.value)}
              />
              <p className="text-xs text-right text-gray-500">{lyrics.length}/3000</p>
            </div>

            <div className="p-3 bg-gradient-to-tr from-[#C77DBA]/10 to- rounded-lg space-y-2 border border-white/10">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles size={16} className="text-[#C77DBA]" />
                  <h3 className="font-semibold text-white">AI 歌词助手</h3>
                </div>
                <span className="text-xs font-medium text-gray-400">3 Credits</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  className="flex-1 p-2 bg-white/5 rounded-md border border-white/10 focus:ring-1 focus:ring-[#C77DBA] focus:border-[#C77DBA] outline-none transition"
                  placeholder="输入主题或故事，AI 帮你写歌词..."
                  value={lyricsPrompt}
                  onChange={(e) => setLyricsPrompt(e.target.value)}
                  maxLength={500}
                />
                <button
                  onClick={handleGenerateLyrics}
                  disabled={lyricsLoading}
                  className="p-2 rounded-md bg-[#C77DBA] hover:bg-[#b36bab] transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                  {lyricsLoading ? <Loader2 size={20} className="animate-spin" /> : <Wand2 size={20} />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-gray-400">
                <div className="flex items-center gap-2">
                  <Settings2 size={16} />
                  <h2 className="font-semibold">自定义风格</h2>
                </div>
                <span className="text-xs">可选</span>
              </div>
              <input
                type="text"
                className="w-full p-3 bg-white/5 rounded-lg border border-white/10 focus:ring-2 focus:ring-[#E8825E] focus:border-[#E8825E] outline-none transition"
                placeholder="例如：Synthwave, Dark, Female Vocal, 80s Retro"
                value={customStyle}
                onChange={(e) => setCustomStyle(e.target.value)}
                maxLength={500}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-gray-400">
                <Mic size={16} />
                <h2 className="font-semibold">人声性别</h2>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(["", "male", "female"] as const).map(g => (
                  <button
                    key={g || "auto"}
                    onClick={() => setVocalGender(g)}
                    className={`flex items-center justify-center gap-2 p-2.5 rounded-lg transition-colors ${vocalGender === g ? 'bg-white/10 text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}>
                    <Sparkles size={16} className={`${vocalGender === g ? 'text-[#E8825E]' : ''}`} />
                    <span className="font-medium">{g === "male" ? "男声" : g === "female" ? "女声" : "自动"}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ═══ 共用：风格标签 ═══ */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-gray-400">
            <Palette size={16} />
            <h2 className="font-semibold">风格</h2>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 gap-2">
            {STYLE_TAGS.map(tag => (
              <button
                key={tag.id}
                onClick={() => toggleStyle(tag.id)}
                className={`flex flex-col items-center justify-center gap-1 p-3 rounded-lg transition-colors ${selectedStyles.includes(tag.id) ? 'bg-[#E8825E]/20 border border-[#E8825E]' : 'bg-white/5 hover:bg-white/10 border border- '}`}>
                <span className="text-xl">{tag.emoji}</span>
                <span className={`text-xs font-medium ${selectedStyles.includes(tag.id) ? 'text-[#E8825E]' : 'text-gray-300'}`}>
                  {tag.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-gray-400">
            <Smile size={16} />
            <h2 className="font-semibold">情绪</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {MOOD_TAGS.map(tag => (
              <button
                key={tag.id}
                onClick={() => toggleMood(tag.id)}
                className={`px-3 py-1.5 rounded-full text-sm transition-colors ${selectedMoods.includes(tag.id) ? 'bg-[#E8825E] text-black font-semibold' : 'bg-white/10 text-gray-300 hover:bg-white/20'}`}>
                {tag.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-gray-400">
            <div className="flex items-center gap-2">
              <ListMusic size={16} />
              <h2 className="font-semibold">歌曲标题</h2>
            </div>
            <span className="text-xs">可选</span>
          </div>
          <input
            type="text"
            className="w-full p-3 bg-white/5 rounded-lg border border-white/10 focus:ring-2 focus:ring-[#E8825E] focus:border-[#E8825E] outline-none transition"
            placeholder="给你的歌曲起个名字..."
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={80}
          />
        </div>

        {/* ═══ 生成结果 ═══ */}
        {status === "success" && songs.length > 0 && (
          <div className="p-4 bg-white/5 rounded-lg space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle size={20} className="text-green-500" />
                <h3 className="font-bold text-lg text-white">生成完成！</h3>
              </div>
              <span className="text-sm font-medium text-gray-400">消耗 {creditCost} Credits</span>
            </div>
            {songs.map((song, idx) => (
              <div key={song.id || idx} className="flex items-center justify-between p-3 bg-black/20 rounded-lg">
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="p-3 bg-[#E8825E]/20 rounded-full">
                    <Music size={24} className="text-[#E8825E]" />
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <p className="font-semibold truncate text-white">{song.title || `歌曲 ${idx + 1}`}</p>
                    {song.tags && <p className="text-xs text-gray-400 truncate">{song.tags}</p>}
                    {song.duration && (
                      <p className="text-xs text-gray-500">
                        {Math.floor(song.duration / 60)}:{String(Math.floor(song.duration % 60)).padStart(2, "0")}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                  {song.audioUrl && (
                    <button
                      onClick={() => handlePlayWithWatermark(song.audioUrl)}
                      className="flex items-center gap-1.5 px-3 py-2 bg-white/10 rounded-md hover:bg-white/20 transition-colors cursor-pointer"
                    >
                      <Play size={16} />
                      <span className="text-sm font-medium">播放</span>
                    </button>
                  )}
                  {song.audioUrl && (
                    <a href={song.audioUrl} download={`${song.title || "song"}.mp3`} className="p-2.5 bg-white/10 rounded-md hover:bg-white/20 transition-colors">
                      <Download size={18} className="text-[#E8825E]" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {status === "error" && (
          <div className="space-y-3 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
            <div className="flex items-center gap-3">
              <AlertTriangle size={20} className="text-red-400" />
              <p className="text-red-300 text-sm">{errorMsg}</p>
            </div>
            <button
              onClick={handleGenerate}
              className="inline-flex items-center gap-2 rounded-lg bg-red-500/20 px-3 py-2 text-sm font-semibold text-red-200 hover:bg-red-500/30 transition-colors"
            >
              <RefreshCw size={14} />
              重试生成
            </button>
          </div>
        )}

        {isGenerating && (
          <div className="flex items-center gap-3 p-4 bg-[#E8825E]/10 border border-[#E8825E]/30 rounded-lg">
            <Loader2 size={18} className="animate-spin text-[#E8825E]" />
            <div>
              <p className="text-sm text-[#f6b39f]">正在处理中</p>
              <p className="text-xs text-[#f1a890]">{progressMessage}</p>
            </div>
          </div>
        )}

        {/* 生成历史和收藏 */}
        <div className="bg-white/5 rounded-xl p-4">
          <CreationHistoryPanel type="music" title="音乐生成历史" />
        </div>
      </div>

      {/* ═══ 底部按钮 ═══ */}
      <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-[#0A0A0C] to- ">
        {status === "success" ? (
          <button
            onClick={handleReset}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-gray-600 hover:bg-gray-500 text-white font-bold text-lg transition-all active:scale-95">
            <RefreshCw size={20} />
            <span>再来一首</span>
          </button>
        ) : (
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-[#E8825E] hover:bg-[#d9734f] text-black font-bold text-lg transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed">
            {isGenerating ? (
              <>
                <Loader2 size={20} className="animate-spin" />
                <span>{status === "generating" ? "提交中..." : "生成中..."}</span>
              </>
            ) : (
              <>
                <Music size={20} />
                <span>生成 · {engine === "V4" ? "12" : "22"} Credits</span>
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
