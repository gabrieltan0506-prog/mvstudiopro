import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const mvGalleryPath = path.join(__dirname, "../app/mv-gallery.tsx");
const mvGalleryContent = fs.readFileSync(mvGalleryPath, "utf-8");

describe("MV Gallery Sort Filter", () => {
  describe("Data Model", () => {
    it("MVItem type includes publishDate field", () => {
      expect(mvGalleryContent).toContain("publishDate: string;");
    });

    it("MVItem type includes views field", () => {
      expect(mvGalleryContent).toContain("views: number;");
    });

    it("SortKey type is defined with correct values", () => {
      expect(mvGalleryContent).toContain('"publishDate" | "views" | "default"');
    });

    it("SortOrder type is defined", () => {
      expect(mvGalleryContent).toContain('"asc" | "desc"');
    });
  });

  describe("MV Data has publishDate and views", () => {
    // Extract all publishDate values
    const publishDateMatches = mvGalleryContent.match(/publishDate:\s*"(\d{4}-\d{2}-\d{2})"/g);
    const viewsMatches = mvGalleryContent.match(/views:\s*(\d+)/g);

    it("all 7 MVs have publishDate", () => {
      expect(publishDateMatches).not.toBeNull();
      expect(publishDateMatches!.length).toBe(7);
    });

    it("all 7 MVs have views count", () => {
      expect(viewsMatches).not.toBeNull();
      expect(viewsMatches!.length).toBe(7);
    });

    it("publishDate values are valid dates", () => {
      publishDateMatches!.forEach((match) => {
        const dateStr = match.match(/"(\d{4}-\d{2}-\d{2})"/)?.[1];
        expect(dateStr).toBeDefined();
        const date = new Date(dateStr!);
        expect(date.toString()).not.toBe("Invalid Date");
      });
    });

    it("views values are positive numbers", () => {
      viewsMatches!.forEach((match) => {
        const num = parseInt(match.match(/(\d+)/)?.[1] || "0");
        expect(num).toBeGreaterThan(0);
      });
    });
  });

  describe("Sort State Management", () => {
    it("has sortKey state initialized to default", () => {
      expect(mvGalleryContent).toContain('useState<SortKey>("default")');
    });

    it("has sortOrder state initialized to desc", () => {
      expect(mvGalleryContent).toContain('useState<SortOrder>("desc")');
    });

    it("has handleSortChange callback", () => {
      expect(mvGalleryContent).toContain("const handleSortChange = useCallback");
    });
  });

  describe("Sort Logic", () => {
    it("uses useMemo for sorted list", () => {
      expect(mvGalleryContent).toContain("useMemo(() =>");
    });

    it("sorts by publishDate when sortKey is publishDate", () => {
      expect(mvGalleryContent).toContain('sortKey === "publishDate"');
      expect(mvGalleryContent).toContain("new Date(a.publishDate).getTime()");
      expect(mvGalleryContent).toContain("new Date(b.publishDate).getTime()");
    });

    it("sorts by views when sortKey is views", () => {
      expect(mvGalleryContent).toContain('sortKey === "views"');
      expect(mvGalleryContent).toContain("b.views - a.views");
      expect(mvGalleryContent).toContain("a.views - b.views");
    });

    it("supports ascending and descending order", () => {
      expect(mvGalleryContent).toContain('sortOrder === "desc"');
    });

    it("returns baseMvs when sortKey is default", () => {
      expect(mvGalleryContent).toContain('sortKey === "default") return baseMvs');
    });

    it("toggles sort order when same key is pressed again", () => {
      expect(mvGalleryContent).toContain('prev === "desc" ? "asc" : "desc"');
    });
  });

  describe("Sort Filter UI", () => {
    it("has sort filter container", () => {
      expect(mvGalleryContent).toContain("sortFilterContainer");
    });

    it("has sort label", () => {
      expect(mvGalleryContent).toContain("sortLabel");
    });

    it("has three sort buttons (default, publishDate, views)", () => {
      expect(mvGalleryContent).toContain('handleSortChange("default")');
      expect(mvGalleryContent).toContain('handleSortChange("publishDate")');
      expect(mvGalleryContent).toContain('handleSortChange("views")');
    });

    it("shows sort direction arrows for active sort", () => {
      // Check for ascending/descending arrow indicators
      expect(mvGalleryContent).toMatch(/sortOrder === "desc" \? "[\u2193\u2191↓↑]" : "[\u2193\u2191↓↑]"/);
    });

    it("has sort button styles", () => {
      expect(mvGalleryContent).toContain("sortBtn:");
      expect(mvGalleryContent).toContain("sortBtnActive:");
      expect(mvGalleryContent).toContain("sortBtnText:");
    });
  });

  describe("Card Display", () => {
    it("displays views count on each card", () => {
      expect(mvGalleryContent).toContain("formatViews(item.views)");
    });

    it("displays publish date on each card", () => {
      expect(mvGalleryContent).toContain("item.publishDate");
    });

    it("has formatViews helper function", () => {
      expect(mvGalleryContent).toContain("const formatViews");
    });

    it("formatViews handles large numbers (10000+)", () => {
      expect(mvGalleryContent).toContain("views >= 10000");
    });

    it("has viewsBadge and dateBadge styles", () => {
      expect(mvGalleryContent).toContain("viewsBadge:");
      expect(mvGalleryContent).toContain("dateBadge:");
    });
  });
});
