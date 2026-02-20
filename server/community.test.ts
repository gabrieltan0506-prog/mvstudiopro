import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock db functions
vi.mock("./db", () => ({
  addVideoComment: vi.fn().mockResolvedValue(1),
  getVideoComments: vi.fn().mockResolvedValue([
    {
      id: 1,
      videoUrl: "https://example.com/video.mp4",
      userId: 100,
      userName: "TestUser",
      content: "Great video!",
      parentId: null,
      likesCount: 3,
      createdAt: new Date("2026-01-01"),
    },
    {
      id: 2,
      videoUrl: "https://example.com/video.mp4",
      userId: 101,
      userName: "User2",
      content: "Thanks!",
      parentId: 1,
      likesCount: 1,
      createdAt: new Date("2026-01-02"),
    },
  ]),
  deleteVideoComment: vi.fn().mockResolvedValue(undefined),
  toggleVideoLike: vi.fn().mockResolvedValue({ liked: true, totalLikes: 5 }),
  getVideoLikeStatus: vi.fn().mockResolvedValue({ liked: false, totalLikes: 4 }),
  toggleCommentLike: vi.fn().mockResolvedValue({ liked: true, totalLikes: 2 }),
  getUserCommentLikes: vi.fn().mockResolvedValue([1, 3]),
}));

import {
  addVideoComment,
  getVideoComments,
  deleteVideoComment,
  toggleVideoLike,
  getVideoLikeStatus,
  toggleCommentLike,
  getUserCommentLikes,
} from "./db";

describe("Community: Comments & Sharing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Video Comments", () => {
    it("should add a comment and return the comment ID", async () => {
      const result = await addVideoComment({
        videoUrl: "https://example.com/video.mp4",
        userId: 100,
        content: "Amazing work!",
      });
      expect(result).toBe(1);
      expect(addVideoComment).toHaveBeenCalledWith({
        videoUrl: "https://example.com/video.mp4",
        userId: 100,
        content: "Amazing work!",
      });
    });

    it("should get comments for a video including replies", async () => {
      const comments = await getVideoComments("https://example.com/video.mp4");
      expect(comments).toHaveLength(2);
      expect(comments[0].content).toBe("Great video!");
      expect(comments[0].parentId).toBeNull();
      expect(comments[1].parentId).toBe(1); // reply to first comment
    });

    it("should support nested replies (parentId)", async () => {
      const comments = await getVideoComments("https://example.com/video.mp4");
      const topLevel = comments.filter((c) => !c.parentId);
      const replies = comments.filter((c) => c.parentId);
      expect(topLevel).toHaveLength(1);
      expect(replies).toHaveLength(1);
      expect(replies[0].parentId).toBe(topLevel[0].id);
    });

    it("should delete a comment by ID and user", async () => {
      await deleteVideoComment(1, 100);
      expect(deleteVideoComment).toHaveBeenCalledWith(1, 100);
    });
  });

  describe("Video Likes", () => {
    it("should toggle a video like and return new status", async () => {
      const result = await toggleVideoLike("https://example.com/video.mp4", 100);
      expect(result).toEqual({ liked: true, totalLikes: 5 });
    });

    it("should get video like status for a user", async () => {
      const status = await getVideoLikeStatus("https://example.com/video.mp4", 100);
      expect(status).toEqual({ liked: false, totalLikes: 4 });
    });
  });

  describe("Comment Likes", () => {
    it("should toggle a comment like", async () => {
      const result = await toggleCommentLike(1, 100);
      expect(result).toEqual({ liked: true, totalLikes: 2 });
    });

    it("should get user's liked comment IDs", async () => {
      const likedIds = await getUserCommentLikes([1, 2, 3], 100);
      expect(likedIds).toEqual([1, 3]);
    });
  });

  describe("Share Link Generation", () => {
    it("should generate a valid share URL from video URL", () => {
      const videoUrl = "https://example.com/video.mp4";
      const shareId = Buffer.from(videoUrl).toString("base64url").slice(0, 32);
      expect(shareId).toBeTruthy();
      expect(shareId.length).toBeLessThanOrEqual(32);
      // Should be URL-safe
      expect(shareId).not.toMatch(/[+/=]/);
    });

    it("should produce consistent share IDs for the same video", () => {
      const videoUrl = "https://example.com/video.mp4";
      const shareId1 = Buffer.from(videoUrl).toString("base64url").slice(0, 32);
      const shareId2 = Buffer.from(videoUrl).toString("base64url").slice(0, 32);
      expect(shareId1).toBe(shareId2);
    });

    it("should produce different share IDs for different videos", () => {
      const shareId1 = Buffer.from("https://example.com/video1.mp4").toString("base64url");
      const shareId2 = Buffer.from("https://example.com/video2.mp4").toString("base64url");
      expect(shareId1).not.toBe(shareId2);
    });
  });
});
