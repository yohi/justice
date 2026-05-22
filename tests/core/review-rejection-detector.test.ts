import { describe, expect, it } from "vitest";
import { ReviewRejectionDetector } from "../../src/core/review-rejection-detector";
import { REVIEW_REJECTION_PATTERNS, matchesReviewRejection } from "../../src/core/review-rejection-patterns";

describe("ReviewRejectionDetector", () => {
  const detector = new ReviewRejectionDetector();

  it("ignores empty text", () => {
    const signal = detector.detect("");

    expect(signal).toEqual({ matched: false, excerpts: [], summary: "" });
  });

  it("does not treat approval as rejection", () => {
    const signal = detector.detect("approved with minor nits");

    expect(signal).toEqual({ matched: false, excerpts: [], summary: "" });
  });

  it("detects a single-line rejection", () => {
    const signal = detector.detect("REJECTED: missing error handling");

    expect(signal.matched).toBe(true);
    expect(signal.excerpts).toEqual(["REJECTED: missing error handling"]);
    expect(signal.summary.length).toBeGreaterThan(0);
    expect(signal.summary.length).toBeLessThanOrEqual(300);
  });

  it("detects multiline rejections up to three excerpts", () => {
    const signal = detector.detect("BLOCKER: race condition\nMUST FIX: nullable\ndo not merge");

    expect(signal.matched).toBe(true);
    expect(signal.excerpts).toEqual(["BLOCKER: race condition", "MUST FIX: nullable", "do not merge"]);
    expect(signal.summary.length).toBeLessThanOrEqual(300);
  });

  it("caps excerpts at three matches", () => {
    const signal = detector.detect(
      "BLOCKER: race condition\nMUST FIX: nullable\ndo not merge\n❌ critical issue",
    );

    expect(signal.matched).toBe(true);
    expect(signal.excerpts).toHaveLength(3);
    expect(signal.excerpts).not.toContain("❌ critical issue");
    expect(signal.summary.length).toBeLessThanOrEqual(300);
  });

  it("truncates each excerpt to 200 characters", () => {
    const signal = detector.detect(`MUST FIX: ${"x".repeat(500)}`);

    expect(signal.matched).toBe(true);
    expect(signal.excerpts).toHaveLength(1);
    expect(signal.excerpts[0]).toHaveLength(200);
    expect(signal.summary.length).toBeLessThanOrEqual(300);
  });

  it("detects Japanese rejection wording", () => {
    const signal = detector.detect("不承認: アーキテクチャ要修正");

    expect(signal.matched).toBe(true);
    expect(signal.excerpts).toEqual(["不承認: アーキテクチャ要修正"]);
    expect(signal.summary.length).toBeGreaterThan(0);
  });

  it("detects the bare reject verb", () => {
    const signal = detector.detect("please reject this approach");

    expect(signal.matched).toBe(true);
    expect(signal.excerpts).toEqual(["please reject this approach"]);
  });

  it("detects approval denied wording", () => {
    const signal = detector.detect("approval denied due to security");

    expect(signal.matched).toBe(true);
    expect(signal.excerpts).toEqual(["approval denied due to security"]);
  });

  it("detects uppercase do not merge wording", () => {
    const signal = detector.detect("DO NOT MERGE");

    expect(signal.matched).toBe(true);
    expect(signal.excerpts).toEqual(["DO NOT MERGE"]);
  });

  it.each([
    "cannot approve this patch",
    "requested changes before merge",
    "blocking concern in the queue handler",
    "致命的な不具合",
    "請求された変更があります",
  ])("matches pattern sample: %s", (text) => {
    expect(matchesReviewRejection(text)).toBe(true);
    expect(detector.detect(text).matched).toBe(true);
  });

  it("exports frozen review rejection patterns", () => {
    expect(Object.isFrozen(REVIEW_REJECTION_PATTERNS)).toBe(true);
    expect(REVIEW_REJECTION_PATTERNS).toHaveLength(11);
  });
});
