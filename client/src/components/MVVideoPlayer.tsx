import React, { useState, useCallback, useRef, useEffect } from "react";
import { Loader2, Play, Pause, Expand, X } from "lucide-react";

interface MVVideoPlayerProps {
  videoUrl: string;
  title?: string;
  aspectRatio?: number; // height/width, default 16/9 for vertical
  onClose?: () => void;
}

export function MVVideoPlayer({
  videoUrl,
  title,
  aspectRatio = 16 / 9,
  onClose,
}: MVVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const progressBarRef = useRef<HTMLButtonElement | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);

  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetControlsTimer = useCallback(() => {
    if (controlsTimerRef.current) {
      clearTimeout(controlsTimerRef.current);
    }
    setShowControls(true);
    controlsTimerRef.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) {
        setShowControls(false);
      }
    }, 3000);
  }, []);

  useEffect(() => {
    resetControlsTimer();
    return () => {
      if (controlsTimerRef.current) {
        clearTimeout(controlsTimerRef.current);
      }
    };
  }, [resetControlsTimer]);

  const handleContainerHover = () => {
    if (videoRef.current && !videoRef.current.paused) {
        setShowControls(true);
    }
  };

  const handleContainerLeave = () => {
    if (videoRef.current && !videoRef.current.paused) {
        setShowControls(false);
    }
  };

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => setError("无法播放视频"));
    } else {
      video.pause();
    }
    resetControlsTimer();
  }, [resetControlsTimer]);

  const seekTo = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = time;
    setCurrentTime(time);
  }, []);

  const handleSeek = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!progressBarRef.current || duration === 0) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    seekTo(ratio * duration);
  };

  const toggleFullscreen = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (document.fullscreenElement) {
        document.exitFullscreen();
    } else {
        video.requestFullscreen().catch(() => console.error("Maximize failed"));
    }
  }, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="relative w-full max-w-md mx-auto font-sans bg-[#0A0A0C] rounded-xl overflow-hidden">
      {title && (
        <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between p-3 bg-gradient-to-b from-black/70 to- ">
          <p className="text-white text-sm font-bold truncate pr-4">{title}</p>
          {onClose && (
            <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
              <X size={20} />
            </button>
          )}
        </div>
      )}

      <div
        className="relative w-full bg-black"
        style={{ aspectRatio: `${1 / aspectRatio}` }}
        onMouseMove={handleContainerHover}
        onMouseLeave={handleContainerLeave}
      >
        <video
          ref={videoRef}
          src={videoUrl}
          className="w-full h-full object-cover"
          playsInline
          preload="metadata"
          onLoadedMetadata={(e) => {
            setDuration(e.currentTarget.duration);
            setIsLoading(false);
          }}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => {
            setIsPlaying(false);
            setCurrentTime(0);
            setShowControls(true);
          }}
          onError={() => {
            setError("视频加载失败");
            setIsLoading(false);
          }}
          onWaiting={() => setIsLoading(true)}
          onCanPlay={() => setIsLoading(false)}
          onClick={togglePlay}
        />

        {isLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 text-white">
            <Loader2 size={48} className="animate-spin text-primary" />
            <span className="mt-2 text-sm">加载中...</span>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 text-white p-4">
            <span className="text-3xl mb-2">⚠️</span>
            <span className="text-center text-sm">{error}</span>
          </div>
        )}

        {showControls && !isLoading && !error && (
            <div className="absolute inset-0 flex items-center justify-center" onClick={togglePlay}>
                <div className="bg-primary/80 rounded-full p-4 transition-transform hover:scale-110">
                    {isPlaying ? <Pause size={32} className="text-white" /> : <Play size={32} className="text-white" />}
                </div>
            </div>
        )}

        {showControls && !error && (
          <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/70 to- ">
            <button
              ref={progressBarRef}
              onClick={handleSeek}
              className="w-full h-5 group flex items-center"
            >
              <div className="w-full h-1 bg-white/30 rounded-full relative">
                <div
                  className="absolute h-full bg-primary rounded-full"
                  style={{ width: `${progress}%` }}
                />
                <div
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 bg-primary rounded-full transition-transform group-hover:scale-125"
                  style={{ left: `${progress}%` }}
                />
              </div>
            </button>

            <div className="flex items-center justify-between text-white text-xs font-medium mt-1">
              <button onClick={togglePlay} className="p-1">
                {isPlaying ? <Pause size={18} /> : <Play size={18} />}
              </button>
              <span>
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
              <button onClick={toggleFullscreen} className="p-1">
                <Expand size={18} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
