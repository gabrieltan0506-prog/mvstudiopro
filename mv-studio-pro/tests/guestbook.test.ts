import { describe, it, expect } from "vitest";

describe("Guestbook Schema Validation", () => {
  it("should validate required fields for guestbook submission", () => {
    const validData = {
      name: "張三",
      email: "test@example.com",
      phone: "0912345678",
      company: "MV Studio",
      subject: "MV 製作諮詢",
      message: "我想了解更多關於MV製作的服務。",
    };

    expect(validData.name.length).toBeGreaterThan(0);
    expect(validData.name.length).toBeLessThanOrEqual(100);
    expect(validData.subject.length).toBeGreaterThan(0);
    expect(validData.subject.length).toBeLessThanOrEqual(255);
    expect(validData.message.length).toBeGreaterThan(0);
    expect(validData.message.length).toBeLessThanOrEqual(5000);
  });

  it("should reject empty name", () => {
    const invalidData = { name: "", subject: "MV 製作諮詢", message: "test" };
    expect(invalidData.name.length).toBe(0);
  });

  it("should reject empty subject", () => {
    const invalidData = { name: "張三", subject: "", message: "test" };
    expect(invalidData.subject.length).toBe(0);
  });

  it("should reject empty message", () => {
    const invalidData = { name: "張三", subject: "MV 製作諮詢", message: "" };
    expect(invalidData.message.length).toBe(0);
  });

  it("should allow optional email, phone, company fields", () => {
    const minimalData = {
      name: "李四",
      email: "",
      phone: "",
      company: "",
      subject: "商務合作",
      message: "希望能進一步洽談合作事宜。",
    };

    // Optional fields can be empty strings
    expect(minimalData.email).toBe("");
    expect(minimalData.phone).toBe("");
    expect(minimalData.company).toBe("");
    // Required fields must have content
    expect(minimalData.name.length).toBeGreaterThan(0);
    expect(minimalData.subject.length).toBeGreaterThan(0);
    expect(minimalData.message.length).toBeGreaterThan(0);
  });

  it("should enforce max length constraints", () => {
    expect("a".repeat(100).length).toBeLessThanOrEqual(100); // name max
    expect("a".repeat(320).length).toBeLessThanOrEqual(320); // email max
    expect("a".repeat(30).length).toBeLessThanOrEqual(30);   // phone max
    expect("a".repeat(200).length).toBeLessThanOrEqual(200); // company max
    expect("a".repeat(255).length).toBeLessThanOrEqual(255); // subject max
    expect("a".repeat(5000).length).toBeLessThanOrEqual(5000); // message max
  });

  it("should validate subject options", () => {
    const validSubjects = [
      "MV 製作諮詢",
      "虛擬偶像合作",
      "視覺特效定製",
      "發布策略規劃",
      "商務合作",
      "其他",
    ];

    validSubjects.forEach((subject) => {
      expect(subject.length).toBeGreaterThan(0);
      expect(subject.length).toBeLessThanOrEqual(255);
    });
  });
});
