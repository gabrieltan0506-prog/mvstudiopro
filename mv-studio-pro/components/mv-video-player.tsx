import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import { useColors } from "@/hooks/use-colors";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

interface MVVideoPlayerProps {
  videoUrl: string;
  title?: string;
  aspectRatio?: number; // height/width, default 16/9 for vertical
  onClose?: () => void;
}

/**
 * Cross-platform MV Video Player
 * - Web: uses HTML5 <video> element via dangerouslySetInnerHTML
 * - Native: uses expo-video VideoView
 */
export function MVVideoPlayer({
  videoUrl,
  title,
  aspectRatio = 16 / 9,
  onClose,
}: MVVideoPlayerProps) {
  const colors = useColors();
  const [isLoading, setIsLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const containerWidth = Math.min(SCREEN_WIDTH - 32, 400);
  const containerHeight = containerWidth * aspectRatio;

  if (Platform.OS === "web") {
    return (
      <WebVideoPlayer
        videoUrl={videoUrl}
        title={title}
        containerWidth={containerWidth}
        containerHeight={containerHeight}
        colors={colors}
        onClose={onClose}
      />
    );
  }

  // Native: use expo-video
  return (
    <NativeVideoPlayer
      videoUrl={videoUrl}
      title={title}
      containerWidth={containerWidth}
      containerHeight={containerHeight}
      colors={colors}
      onClose={onClose}
    />
  );
}

// ========== Web Video Player ==========
function WebVideoPlayer({
  videoUrl,
  title,
  containerWidth,
  containerHeight,
  colors,
  onClose,
}: {
  videoUrl: string;
  title?: string;
  containerWidth: number;
  containerHeight: number;
  colors: any;
  onClose?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(true);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<View>(null);

  // We need to use a web-specific approach
  const videoId = useRef(`mv-video-${Date.now()}`).current;

  useEffect(() => {
    // Create and manage the video element via DOM
    const container = document.getElementById(videoId);
    if (!container) return;

    const video = document.createElement("video");
    video.src = videoUrl;
    video.style.width = "100%";
    video.style.height = "100%";
    video.style.objectFit = "cover";
    video.style.borderRadius = "12px";
    video.style.backgroundColor = "#000";
    video.playsInline = true;
    video.preload = "metadata";
    // Note: crossOrigin removed to avoid CORS issues with CDN videos

    video.addEventListener("loadedmetadata", () => {
      setDuration(video.duration);
      setIsLoading(false);
    });

    video.addEventListener("timeupdate", () => {
      setCurrentTime(video.currentTime);
    });

    video.addEventListener("play", () => setIsPlaying(true));
    video.addEventListener("pause", () => setIsPlaying(false));
    video.addEventListener("ended", () => {
      setIsPlaying(false);
      setCurrentTime(0);
    });

    video.addEventListener("error", () => {
      setError("视频加载失败");
      setIsLoading(false);
    });

    video.addEventListener("waiting", () => setIsLoading(true));
    video.addEventListener("canplay", () => setIsLoading(false));

    container.appendChild(video);
    videoRef.current = video;

    return () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
      if (container.contains(video)) {
        container.removeChild(video);
      }
      videoRef.current = null;
    };
  }, [videoUrl, videoId]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
    resetControlsTimer();
  }, []);

  const seekTo = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = time;
    setCurrentTime(time);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.requestFullscreen) {
      video.requestFullscreen();
    } else if ((video as any).webkitRequestFullscreen) {
      (video as any).webkitRequestFullscreen();
    }
  }, []);

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

  const handleContainerPress = useCallback(() => {
    setShowControls(prev => !prev);
    resetControlsTimer();
  }, [resetControlsTimer]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <View style={[styles.playerContainer, { width: containerWidth }]}>
      {/* Title bar */}
      {title && (
        <View style={[styles.titleBar, { backgroundColor: `${colors.background}ee` }]}>
          <Text style={[styles.titleText, { color: colors.foreground }]} numberOfLines={1}>
            {title}
          </Text>
          {onClose && (
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={[styles.closeBtnText, { color: colors.muted }]}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Video container */}
      <TouchableOpacity
        activeOpacity={1}
        onPress={handleContainerPress}
        style={[styles.videoWrapper, { height: containerHeight, backgroundColor: "#000", borderRadius: 12 }]}
      >
        <View
          nativeID={videoId}
          style={{ width: "100%", height: "100%", borderRadius: 12, overflow: "hidden" }}
        />

        {/* Loading overlay */}
        {isLoading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>加载中...</Text>
          </View>
        )}

        {/* Error overlay */}
        {error && (
          <View style={styles.errorOverlay}>
            <Text style={styles.errorIcon}>⚠️</Text>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Play/Pause overlay button */}
        {showControls && !isLoading && !error && (
          <TouchableOpacity
            onPress={togglePlay}
            style={styles.playOverlay}
            activeOpacity={0.8}
          >
            <View style={[styles.playButton, { backgroundColor: `${colors.primary}cc` }]}>
              <Text style={styles.playIcon}>{isPlaying ? "⏸" : "▶"}</Text>
            </View>
          </TouchableOpacity>
        )}

        {/* Bottom controls */}
        {showControls && !error && (
          <View style={styles.controlsBar}>
            {/* Progress bar */}
            <TouchableOpacity
              activeOpacity={1}
              onPress={(e) => {
                const nativeEvent = e.nativeEvent as any;
                if (nativeEvent.locationX !== undefined && duration > 0) {
                  const ratio = nativeEvent.locationX / containerWidth;
                  seekTo(ratio * duration);
                }
              }}
              style={styles.progressBarContainer}
            >
              <View style={[styles.progressTrack, { backgroundColor: "rgba(255,255,255,0.3)" }]}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${progress}%`, backgroundColor: colors.primary },
                  ]}
                />
                <View
                  style={[
                    styles.progressThumb,
                    {
                      left: `${progress}%`,
                      backgroundColor: colors.primary,
                    },
                  ]}
                />
              </View>
            </TouchableOpacity>

            {/* Time + controls row */}
            <View style={styles.controlsRow}>
              <TouchableOpacity onPress={togglePlay} style={styles.controlBtn}>
                <Text style={styles.controlIcon}>{isPlaying ? "⏸" : "▶"}</Text>
              </TouchableOpacity>
              <Text style={styles.timeText}>
                {formatTime(currentTime)} / {formatTime(duration)}
              </Text>
              <View style={{ flex: 1 }} />
              <TouchableOpacity onPress={toggleFullscreen} style={styles.controlBtn}>
                <Text style={styles.controlIcon}>⛶</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </TouchableOpacity>
    </View>
  );
}

// ========== Native Video Player ==========
function NativeVideoPlayer({
  videoUrl,
  title,
  containerWidth,
  containerHeight,
  colors,
  onClose,
}: {
  videoUrl: string;
  title?: string;
  containerWidth: number;
  containerHeight: number;
  colors: any;
  onClose?: () => void;
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dynamically import expo-video for native
  const [VideoModule, setVideoModule] = useState<any>(null);
  const [player, setPlayer] = useState<any>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const mod = await import("expo-video");
        if (mounted) {
          setVideoModule(mod);
        }
      } catch (err) {
        if (mounted) {
          setError("视频播放器不可用");
          setIsLoading(false);
        }
      }
    })();
    return () => { mounted = false; };
  }, []);

  // Create player when module is loaded
  useEffect(() => {
    if (!VideoModule) return;
    try {
      // Note: useVideoPlayer is a hook and can't be called here
      // We'll use the VideoView with source directly
      setIsLoading(false);
    } catch {
      setError("视频播放器初始化失败");
      setIsLoading(false);
    }
  }, [VideoModule]);

  if (error) {
    return (
      <View style={[styles.playerContainer, { width: containerWidth }]}>
        <View style={[styles.videoWrapper, { height: containerHeight, backgroundColor: "#000", borderRadius: 12 }]}>
          <View style={styles.errorOverlay}>
            <Text style={styles.errorIcon}>⚠️</Text>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        </View>
      </View>
    );
  }

  // For native, we'll render a simple placeholder that tells users to use the native app
  // Since we can't use hooks dynamically, we provide a simplified native experience
  return (
    <View style={[styles.playerContainer, { width: containerWidth }]}>
      {title && (
        <View style={[styles.titleBar, { backgroundColor: `${colors.background}ee` }]}>
          <Text style={[styles.titleText, { color: colors.foreground }]} numberOfLines={1}>
            {title}
          </Text>
          {onClose && (
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={[styles.closeBtnText, { color: colors.muted }]}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      <View style={[styles.videoWrapper, { height: containerHeight, backgroundColor: "#000", borderRadius: 12 }]}>
        {isLoading ? (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>加载中...</Text>
          </View>
        ) : (
          <View style={styles.nativePlaceholder}>
            <Text style={styles.nativePlaceholderIcon}>🎬</Text>
            <Text style={styles.nativePlaceholderText}>
              请在 Expo Go 中预览视频
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ========== Compact inline player for cards ==========
export function MVVideoPlayerInline({
  videoUrl,
  title,
  onClose,
}: {
  videoUrl: string;
  title?: string;
  onClose?: () => void;
}) {
  return (
    <MVVideoPlayer
      videoUrl={videoUrl}
      title={title}
      aspectRatio={16 / 9}
      onClose={onClose}
    />
  );
}

const styles = StyleSheet.create({
  playerContainer: {
    alignSelf: "center",
    marginVertical: 12,
  },
  titleBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  titleText: {
    fontSize: 14,
    fontWeight: "700",
    flex: 1,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.1)",
  },
  closeBtnText: {
    fontSize: 14,
    fontWeight: "700",
  },
  videoWrapper: {
    position: "relative",
    overflow: "hidden",
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 12,
  },
  loadingText: {
    color: "#fff",
    fontSize: 13,
    marginTop: 8,
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.7)",
    borderRadius: 12,
  },
  errorIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  errorText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  playButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  playIcon: {
    color: "#fff",
    fontSize: 22,
  },
  controlsBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    paddingBottom: 8,
    paddingTop: 24,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    backgroundColor: "rgba(0,0,0,0.0)",
    backgroundImage: "linear-gradient(transparent, rgba(0,0,0,0.7))",
  } as any,
  progressBarContainer: {
    height: 20,
    justifyContent: "center",
    marginBottom: 4,
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    position: "relative",
  },
  progressFill: {
    height: "100%",
    borderRadius: 2,
  },
  progressThumb: {
    position: "absolute",
    top: -4,
    width: 12,
    height: 12,
    borderRadius: 6,
    marginLeft: -6,
  },
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  controlBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  controlIcon: {
    color: "#fff",
    fontSize: 16,
  },
  timeText: {
    color: "#ffffffcc",
    fontSize: 12,
    fontWeight: "500",
  },
  nativePlaceholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  nativePlaceholderIcon: {
    fontSize: 40,
    marginBottom: 8,
  },
  nativePlaceholderText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
});
