// @ts-nocheck
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useState, useRef } from "react";
import { Play, Star, MessageCircle, X, Send, Film, Pause, Volume2, VolumeX, Maximize } from "lucide-react";
import { VideoInteraction } from "@/components/VideoInteraction";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const MV_LIST = [
  { id: "mv1", title: "Neon Dreams", artist: "CyberVox", genre: "电子/赛博朋克", duration: "0:40", thumbnail: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800&h=450&fit=crop", videoUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/LGlMSFWBoydTFxjO.mp4", description: "霓虹灯下的赛博朋克世界，虚拟偶像与数字灵魂的交织。" },
  { id: "mv2", title: "Sakura Rain", artist: "Luna AI", genre: "J-Pop/动漫", duration: "0:18", thumbnail: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=800&h=450&fit=crop", videoUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/HsKLmjIiEdfqJwTS.mp4", description: "樱花飘落的季节，AI 生成的唯美动漫画面与旋律完美融合。" },
  { id: "mv3", title: "Digital Soul", artist: "PixelBeat", genre: "电子/实验", duration: "0:20", thumbnail: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=800&h=450&fit=crop", videoUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/gieWbRLnhzizmXwt.mp4", description: "数字灵魂在虚拟空间中的觉醒之旅。" },
  { id: "mv4", title: "Midnight City", artist: "NeonWave", genre: "Synthwave", duration: "0:36", thumbnail: "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=800&h=450&fit=crop", videoUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/cBwAZMJQmgvCVdFD.mp4", description: "午夜城市的霓虹光影，复古未来主义的视觉盛宴。" },
  { id: "mv5", title: "Ocean Waves", artist: "AquaVerse", genre: "Ambient/Chill", duration: "0:20", thumbnail: "https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=800&h=450&fit=crop", videoUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/oFwinfDXhonlAtPs.mp4", description: "海浪与音乐的完美交融，沉浸式的视听体验。" },
  { id: "mv6", title: "Fire Dance", artist: "BlazeStar", genre: "Hip-Hop/Trap", duration: "0:18", thumbnail: "https://images.unsplash.com/photo-1501386761578-0a55d4e96e87?w=800&h=450&fit=crop", videoUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/WHScAGWIfOVpIKFQ.mp4", description: "火焰与舞蹈的碰撞，热血沸腾的视觉冲击。" },
  { id: "mv7", title: "Star Voyage", artist: "CosmicAI", genre: "Space/Ambient", duration: "0:20", thumbnail: "https://images.unsplash.com/photo-1506157786151-b8491531f063?w=800&h=450&fit=crop", videoUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/ivSRHHzRgsCmuhFi.mp4", description: "穿越星际的音乐旅程，AI 生成的宇宙奇观。" },
];

/** Inline video player component */
function VideoPlayer({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (playing) videoRef.current.pause();
    else videoRef.current.play();
    setPlaying(!playing);
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div className="relative bg-black">
      <video
        ref={videoRef}
        src={src}
        className="w-full aspect-video object-contain"
        onTimeUpdate={() => videoRef.current && setCurrentTime(videoRef.current.currentTime)}
        onLoadedMetadata={() => videoRef.current && setDuration(videoRef.current.duration)}
        onEnded={() => setPlaying(false)}
        muted={muted}
        playsInline
      />
      {/* Play overlay */}
      {!playing && (
        <button
          className="absolute inset-0 flex items-center justify-center bg-black/20"
          onClick={togglePlay}
        >
          <div className="w-16 h-16 rounded-full bg-primary/90 flex items-center justify-center hover:bg-primary transition-colors">
            <Play className="h-7 w-7 text-primary-foreground ml-0.5" />
          </div>
        </button>
      )}
      {/* Controls bar */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3 flex items-center gap-3">
        <button onClick={togglePlay} className="text-white hover:text-primary transition-colors">
          {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
        </button>
        <div className="flex-1">
          <input
            type="range"
            min={0}
            max={duration || 100}
            value={currentTime}
            onChange={e => {
              const t = Number(e.target.value);
              if (videoRef.current) videoRef.current.currentTime = t;
              setCurrentTime(t);
            }}
            className="w-full h-1 accent-primary"
          />
        </div>
        <span className="text-xs text-white/80 min-w-[70px] text-right">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
        <button onClick={() => setMuted(!muted)} className="text-white hover:text-primary transition-colors">
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
        <button
          onClick={() => videoRef.current?.requestFullscreen?.()}
          className="text-white hover:text-primary transition-colors"
        >
          <Maximize className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function ReviewSection({ mvId }: { mvId: string }) {
  const { data: reviews, refetch } = trpc.mvReview.list.useQuery({ mvId });
  const [nickname, setNickname] = useState("");
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const submitReview = trpc.mvReview.submit.useMutation({
    onSuccess: () => { toast.success("评论已提交！"); setNickname(""); setComment(""); setRating(5); refetch(); },
    onError: () => toast.error("提交失败"),
  });

  return (
    <div className="mt-6 space-y-4">
      <h4 className="font-semibold flex items-center gap-2">
        <MessageCircle className="h-4 w-4" /> 评论 ({reviews?.length || 0})
      </h4>

      {/* Review Form */}
      <div className="space-y-3 p-4 rounded-lg bg-background/50 border border-border/50">
        <div className="flex gap-3">
          <Input placeholder="昵称" value={nickname} onChange={e => setNickname(e.target.value)} className="bg-background/50 flex-1" />
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map(s => (
              <button key={s} onClick={() => setRating(s)} className="p-0.5">
                <Star className={`h-5 w-5 ${s <= rating ? "fill-primary text-primary" : "text-muted-foreground"}`} />
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-3">
          <Textarea placeholder="写下你的评论..." value={comment} onChange={e => setComment(e.target.value)} rows={2} className="bg-background/50 flex-1" />
          <Button
            size="sm"
            className="self-end bg-primary text-primary-foreground"
            disabled={!nickname || !comment || submitReview.isPending}
            onClick={() => submitReview.mutate({ mvId, nickname, rating, comment })}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Review List */}
      <div className="space-y-3 max-h-60 overflow-y-auto">
        {reviews?.map((r) => (
          <div key={r.id} className="p-3 rounded-lg bg-background/30 border border-border/30">
            <div className="flex items-center justify-between mb-1">
              <span className="font-medium text-sm">{r.nickname}</span>
              <div className="flex items-center gap-0.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className={`h-3 w-3 ${i < r.rating ? "fill-primary text-primary" : "text-muted-foreground/30"}`} />
                ))}
              </div>
            </div>
            <p className="text-sm text-muted-foreground">{r.comment}</p>
          </div>
        ))}
        {(!reviews || reviews.length === 0) && (
          <p className="text-sm text-muted-foreground text-center py-4">暂无评论，来写第一条吧！</p>
        )}
      </div>
    </div>
  );
}

export default function MVGallery() {
  const [selectedMV, setSelectedMV] = useState<typeof MV_LIST[0] | null>(null);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />

      <section className="pt-24 pb-10">
        <div className="container">
          <div className="mb-10">
            <h1 className="text-3xl font-bold mb-2">MV 展厅</h1>
            <p className="text-muted-foreground">精选 7 支 AI 辅助创作的 MV 作品，点击即可播放</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {MV_LIST.map((mv) => (
              <Card
                key={mv.id}
                className="overflow-hidden bg-card/50 border-border/50 hover:border-primary/30 transition-all group cursor-pointer"
                onClick={() => setSelectedMV(mv)}
              >
                <div className="relative aspect-video overflow-hidden">
                  <img
                    src={mv.thumbnail}
                    alt={mv.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="w-14 h-14 rounded-full bg-primary/90 flex items-center justify-center">
                      <Play className="h-6 w-6 text-primary-foreground ml-0.5" />
                    </div>
                  </div>
                  <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-black/60 text-white text-xs">
                    {mv.duration}
                  </div>
                </div>
                <CardContent className="p-4">
                  <h3 className="font-semibold mb-1">{mv.title}</h3>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">{mv.artist}</p>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">{mv.genre}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{mv.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* MV Player Dialog */}
      <Dialog open={!!selectedMV} onOpenChange={() => setSelectedMV(null)}>
        <DialogContent className="max-w-4xl bg-card border-border/50 p-0 overflow-hidden">
          {selectedMV && (
            <>
              <VideoPlayer src={selectedMV.videoUrl} />
              <div className="p-6">
                <DialogHeader>
                  <DialogTitle className="text-xl">{selectedMV.title}</DialogTitle>
                </DialogHeader>
                <div className="flex items-center gap-3 mt-2 mb-4">
                  <span className="text-muted-foreground">{selectedMV.artist}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">{selectedMV.genre}</span>
                  <span className="text-xs text-muted-foreground">{selectedMV.duration}</span>
                </div>
                <p className="text-sm text-muted-foreground mb-4">{selectedMV.description}</p>
                
                {/* 评论与分享互动 */}
                <div className="border-t border-border/30 pt-4 mt-4">
                  <VideoInteraction videoUrl={selectedMV.videoUrl} title={selectedMV.title} />
                </div>
                
                <ReviewSection mvId={selectedMV.id} />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Footer */}
      <footer className="py-10 border-t border-border/30">
        <div className="container flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Film className="h-5 w-5 text-primary" />
            <span className="font-semibold">MV Studio Pro</span>
          </div>
          <p className="text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} MV Studio Pro. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
