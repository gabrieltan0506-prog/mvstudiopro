import { describe, it, expect } from "vitest";

// MV data types matching the gallery page
type MVItem = {
  id: string;
  title: string;
  song: string;
  scenes: number;
  viralScore: number;
  durationSec: number;
  format: string;
  resolution: string;
  lyricsCount: number;
  size: string;
  videoUrl: string;
};

describe("MV Gallery - 精華 MV 展廳", () => {
  const YWQS_MVS: MVItem[] = [
    { id: "ywqs_mv1", title: "滑雪奇遇", song: "憶网情深 M&F", scenes: 5, viralScore: 85, durationSec: 46.8, format: "9:16 豎屏", resolution: "1080×1920", lyricsCount: 12, size: "6.7MB", videoUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/nXHOnoBCANcChwCo.mp4" },
    { id: "ywqs_mv2", title: "森林夢境", song: "憶网情深 M&F", scenes: 5, viralScore: 88, durationSec: 46.8, format: "9:16 豎屏", resolution: "1080×1920", lyricsCount: 12, size: "5.3MB", videoUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/dJzioxYqLNWqOFFx.mp4" },
    { id: "ywqs_mv3", title: "熱氣球浪漫", song: "憶网情深 M&F", scenes: 5, viralScore: 92, durationSec: 46.8, format: "9:16 豎屏", resolution: "1080×1920", lyricsCount: 12, size: "6.3MB", videoUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/MnqUbgKzkhDHQNnd.mp4" },
    { id: "ywqs_mv4", title: "城市夜曲", song: "憶网情深 M&F", scenes: 5, viralScore: 82, durationSec: 43.8, format: "9:16 豎屏", resolution: "1080×1920", lyricsCount: 12, size: "5.6MB", videoUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/fQUTdQKXDEgLkXKl.mp4" },
  ];

  const YXA_MVS: MVItem[] = [
    { id: "yxa_mv1", title: "櫻花戀曲", song: "意想愛 韓風版Q版", scenes: 5, viralScore: 90, durationSec: 41.8, format: "9:16 豎屏", resolution: "1080×1920", lyricsCount: 12, size: "6.4MB", videoUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/GyvfhvadmhvuBfTz.mp4" },
    { id: "yxa_mv2", title: "極光之夜", song: "意想愛 韓風版Q版", scenes: 5, viralScore: 87, durationSec: 48.8, format: "9:16 豎屏", resolution: "1080×1920", lyricsCount: 12, size: "6.6MB", videoUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/FpsDqrXSAEPGyeZQ.mp4" },
    { id: "yxa_mv3", title: "薰衣草之夢", song: "意想愛 韓風版Q版", scenes: 5, viralScore: 86, durationSec: 43.8, format: "9:16 豎屏", resolution: "1080×1920", lyricsCount: 12, size: "6.0MB", videoUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/BikdrRpbAUAEFMzJ.mp4" },
    { id: "yxa_mv4", title: "落日終章", song: "意想愛 韓風版Q版", scenes: 5, viralScore: 84, durationSec: 40.9, format: "9:16 豎屏", resolution: "1080×1920", lyricsCount: 12, size: "5.9MB", videoUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/BXmRQVRiPhZCTeUf.mp4" },
  ];

  const ALL_MVS = [...YWQS_MVS, ...YXA_MVS];

  // ========== Original Gallery Tests ==========
  it("should have 4 MVs for 憶网情深", () => {
    expect(YWQS_MVS).toHaveLength(4);
  });

  it("should have 4 MVs for 意想愛", () => {
    expect(YXA_MVS).toHaveLength(4);
  });

  it("should have 8 MVs total", () => {
    expect(ALL_MVS).toHaveLength(8);
  });

  it("each MV should have 5 scenes", () => {
    ALL_MVS.forEach((mv) => {
      expect(mv.scenes).toBe(5);
    });
  });

  it("each MV should have unique id", () => {
    const allIds = ALL_MVS.map((mv) => mv.id);
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it("viral scores should be between 0 and 100", () => {
    ALL_MVS.forEach((mv) => {
      expect(mv.viralScore).toBeGreaterThanOrEqual(0);
      expect(mv.viralScore).toBeLessThanOrEqual(100);
    });
  });

  it("highest viral score should be 熱氣球浪漫 at 92", () => {
    const highest = ALL_MVS.reduce((a, b) => (a.viralScore > b.viralScore ? a : b));
    expect(highest.title).toBe("熱氣球浪漫");
    expect(highest.viralScore).toBe(92);
  });

  it("all 憶网情深 MVs should reference correct song", () => {
    YWQS_MVS.forEach((mv) => {
      expect(mv.song).toBe("憶网情深 M&F");
    });
  });

  it("all 意想愛 MVs should reference correct song", () => {
    YXA_MVS.forEach((mv) => {
      expect(mv.song).toBe("意想愛 韓風版Q版");
    });
  });

  it("score color logic should work correctly", () => {
    const getScoreColor = (score: number) => {
      if (score >= 90) return "#22C55E";
      if (score >= 85) return "#0a7ea4";
      if (score >= 80) return "#F59E0B";
      return "#9BA1A6";
    };
    expect(getScoreColor(92)).toBe("#22C55E");
    expect(getScoreColor(88)).toBe("#0a7ea4");
    expect(getScoreColor(82)).toBe("#F59E0B");
    expect(getScoreColor(75)).toBe("#9BA1A6");
  });

  it("MV titles should cover all planned themes", () => {
    const allTitles = ALL_MVS.map((mv) => mv.title);
    expect(allTitles).toContain("滑雪奇遇");
    expect(allTitles).toContain("森林夢境");
    expect(allTitles).toContain("熱氣球浪漫");
    expect(allTitles).toContain("櫻花戀曲");
    expect(allTitles).toContain("極光之夜");
    expect(allTitles).toContain("薰衣草之夢");
    expect(allTitles).toContain("落日終章");
  });

  // ========== Vertical Format Tests ==========
  it("all MVs should be in 9:16 vertical format", () => {
    ALL_MVS.forEach((mv) => {
      expect(mv.format).toBe("9:16 豎屏");
    });
  });

  it("all MVs should have 1080×1920 resolution", () => {
    ALL_MVS.forEach((mv) => {
      expect(mv.resolution).toBe("1080×1920");
    });
  });

  it("all MVs should have synchronized lyrics", () => {
    ALL_MVS.forEach((mv) => {
      expect(mv.lyricsCount).toBeGreaterThan(0);
      expect(mv.lyricsCount).toBe(12);
    });
  });

  it("all MVs should have duration between 40-50 seconds", () => {
    ALL_MVS.forEach((mv) => {
      expect(mv.durationSec).toBeGreaterThanOrEqual(40);
      expect(mv.durationSec).toBeLessThanOrEqual(50);
    });
  });

  // ========== Splice / Reorder Logic Tests ==========
  describe("Splice & Reorder Logic", () => {
    it("should add items to splice list without duplicates", () => {
      let spliceList: MVItem[] = [];
      const addToSplice = (item: MVItem) => {
        if (spliceList.find(m => m.id === item.id)) return;
        spliceList = [...spliceList, item];
      };
      addToSplice(YWQS_MVS[0]);
      addToSplice(YWQS_MVS[1]);
      addToSplice(YWQS_MVS[0]); // duplicate
      expect(spliceList).toHaveLength(2);
    });

    it("should remove items from splice list", () => {
      let spliceList = [YWQS_MVS[0], YWQS_MVS[1], YWQS_MVS[2]];
      const removeFromSplice = (id: string) => {
        spliceList = spliceList.filter(m => m.id !== id);
      };
      removeFromSplice("ywqs_mv2");
      expect(spliceList).toHaveLength(2);
      expect(spliceList.map(m => m.id)).toEqual(["ywqs_mv1", "ywqs_mv3"]);
    });

    it("should reorder items by moving up", () => {
      let spliceList = [YWQS_MVS[0], YWQS_MVS[1], YWQS_MVS[2]];
      const moveItem = (fromIdx: number, toIdx: number) => {
        const newList = [...spliceList];
        const [moved] = newList.splice(fromIdx, 1);
        newList.splice(toIdx, 0, moved);
        spliceList = newList;
      };
      moveItem(2, 1); // move index 2 to index 1
      expect(spliceList.map(m => m.id)).toEqual(["ywqs_mv1", "ywqs_mv3", "ywqs_mv2"]);
    });

    it("should reorder items by moving down", () => {
      let spliceList = [YWQS_MVS[0], YWQS_MVS[1], YWQS_MVS[2]];
      const moveItem = (fromIdx: number, toIdx: number) => {
        const newList = [...spliceList];
        const [moved] = newList.splice(fromIdx, 1);
        newList.splice(toIdx, 0, moved);
        spliceList = newList;
      };
      moveItem(0, 1); // move index 0 to index 1
      expect(spliceList.map(m => m.id)).toEqual(["ywqs_mv2", "ywqs_mv1", "ywqs_mv3"]);
    });

    it("should calculate total duration with crossfade deduction", () => {
      const spliceList = [YWQS_MVS[0], YWQS_MVS[1], YWQS_MVS[2]]; // 46.8 + 46.8 + 46.8
      const crossfadeDuration = 1.0;
      const totalRaw = spliceList.reduce((sum, m) => sum + m.durationSec, 0);
      const crossfades = Math.max(0, spliceList.length - 1) * crossfadeDuration;
      const totalDuration = Math.max(0, totalRaw - crossfades);
      expect(totalRaw).toBeCloseTo(140.4, 1);
      expect(crossfades).toBe(2.0);
      expect(totalDuration).toBeCloseTo(138.4, 1);
    });

    it("should handle single clip splice (no crossfade)", () => {
      const spliceList = [YWQS_MVS[0]]; // 46.8s
      const crossfades = Math.max(0, spliceList.length - 1) * 1.0;
      const totalDuration = spliceList.reduce((sum, m) => sum + m.durationSec, 0) - crossfades;
      expect(crossfades).toBe(0);
      expect(totalDuration).toBe(46.8);
    });

    it("should handle empty splice list", () => {
      const spliceList: MVItem[] = [];
      const crossfades = Math.max(0, spliceList.length - 1) * 1.0;
      const totalDuration = Math.max(0, spliceList.reduce((sum, m) => sum + m.durationSec, 0) - crossfades);
      expect(totalDuration).toBe(0);
    });

    it("should calculate average viral score for spliced clips", () => {
      const spliceList = [YWQS_MVS[0], YWQS_MVS[2], YXA_MVS[0]]; // 85, 92, 90
      const avgScore = Math.round(spliceList.reduce((s, m) => s + m.viralScore, 0) / spliceList.length);
      expect(avgScore).toBe(89);
    });

    it("should allow mixing clips from both songs", () => {
      const spliceList = [YWQS_MVS[0], YXA_MVS[0], YWQS_MVS[2], YXA_MVS[3]];
      const songs = new Set(spliceList.map(m => m.song));
      expect(songs.size).toBe(2);
      expect(spliceList).toHaveLength(4);
    });

    it("should support full 8-clip splice", () => {
      const spliceList = [...ALL_MVS];
      const crossfades = Math.max(0, spliceList.length - 1) * 1.0; // 7 crossfades
      const totalRaw = spliceList.reduce((sum, m) => sum + m.durationSec, 0);
      const totalDuration = totalRaw - crossfades;
      expect(spliceList).toHaveLength(8);
      expect(crossfades).toBe(7);
      expect(totalDuration).toBeGreaterThan(300); // > 5 minutes
    });

    it("should filter available clips for quick-add (exclude already added)", () => {
      const spliceList = [YWQS_MVS[0], YXA_MVS[0]];
      const available = ALL_MVS.filter(m => !spliceList.find(s => s.id === m.id));
      expect(available).toHaveLength(6);
      expect(available.find(m => m.id === "ywqs_mv1")).toBeUndefined();
      expect(available.find(m => m.id === "yxa_mv1")).toBeUndefined();
    });

    it("should estimate output file size (90% of sum due to re-encoding)", () => {
      const spliceList = [YWQS_MVS[0], YWQS_MVS[1]]; // 6.7MB + 5.3MB
      const totalSize = spliceList.reduce((s, m) => s + parseFloat(m.size), 0);
      const estimatedSize = totalSize * 0.9;
      expect(estimatedSize).toBeCloseTo(10.8, 1);
    });
  });

  // ========== Video Player Tests ==========
  describe("Video Player - 影片播放器", () => {
    it("all MVs should have valid video URLs", () => {
      ALL_MVS.forEach((mv) => {
        expect(mv.videoUrl).toBeDefined();
        expect(mv.videoUrl.length).toBeGreaterThan(0);
        expect(mv.videoUrl).toMatch(/^https:\/\//);
      });
    });

    it("all video URLs should be .mp4 format", () => {
      ALL_MVS.forEach((mv) => {
        expect(mv.videoUrl).toMatch(/\.mp4$/);
      });
    });

    it("all video URLs should be unique", () => {
      const urls = ALL_MVS.map((mv) => mv.videoUrl);
      expect(new Set(urls).size).toBe(urls.length);
    });

    it("video URLs should be from CDN domain", () => {
      ALL_MVS.forEach((mv) => {
        expect(mv.videoUrl).toContain("manuscdn.com");
      });
    });

    it("憶网情深 MVs should have distinct video URLs", () => {
      const ywqsUrls = YWQS_MVS.map((mv) => mv.videoUrl);
      expect(new Set(ywqsUrls).size).toBe(4);
    });

    it("意想愛 MVs should have distinct video URLs", () => {
      const yxaUrls = YXA_MVS.map((mv) => mv.videoUrl);
      expect(new Set(yxaUrls).size).toBe(4);
    });

    it("play state toggle should work correctly", () => {
      let playingId: string | null = null;
      const togglePlay = (id: string) => {
        playingId = playingId === id ? null : id;
      };
      togglePlay("ywqs_mv1");
      expect(playingId).toBe("ywqs_mv1");
      togglePlay("ywqs_mv1"); // toggle off
      expect(playingId).toBeNull();
      togglePlay("yxa_mv2"); // play different
      expect(playingId).toBe("yxa_mv2");
    });

    it("only one video should play at a time", () => {
      let playingId: string | null = null;
      const togglePlay = (id: string) => {
        playingId = playingId === id ? null : id;
      };
      togglePlay("ywqs_mv1");
      expect(playingId).toBe("ywqs_mv1");
      togglePlay("ywqs_mv2"); // switch to another
      expect(playingId).toBe("ywqs_mv2");
      // Only one playing at a time
      expect(playingId).not.toBe("ywqs_mv1");
    });

    it("time formatting should work correctly", () => {
      const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, "0")}`;
      };
      expect(formatTime(0)).toBe("0:00");
      expect(formatTime(5.5)).toBe("0:05");
      expect(formatTime(46.8)).toBe("0:46");
      expect(formatTime(65)).toBe("1:05");
      expect(formatTime(125.3)).toBe("2:05");
    });

    it("progress calculation should be accurate", () => {
      const calcProgress = (currentTime: number, duration: number) => {
        return duration > 0 ? (currentTime / duration) * 100 : 0;
      };
      expect(calcProgress(0, 46.8)).toBe(0);
      expect(calcProgress(23.4, 46.8)).toBeCloseTo(50, 1);
      expect(calcProgress(46.8, 46.8)).toBeCloseTo(100, 1);
      expect(calcProgress(10, 0)).toBe(0); // edge case: zero duration
    });
  });
});
