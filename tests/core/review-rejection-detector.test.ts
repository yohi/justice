import { describe, expect, it } from "vitest";
import { ReviewRejectionDetector } from "../../src/core/review-rejection-detector";
import {
  REVIEW_REJECTION_PATTERNS,
  matchesReviewRejection,
} from "../../src/core/review-rejection-patterns";

describe("ReviewRejectionDetector", () => {
  const detector = new ReviewRejectionDetector();

  it("ignores empty text", () => {
    const signal = detector.detect("");

    expect(signal).toEqual({ matched: false, excerpts: [], summary: "", severity: "minor" });
  });

  it("does not treat approval as rejection", () => {
    const signal = detector.detect("approved with minor nits");

    expect(signal).toEqual({ matched: false, excerpts: [], summary: "", severity: "minor" });
  });

  it("detects a single-line rejection", () => {
    const signal = detector.detect("REJECTED: missing error handling");

    expect(signal.matched).toBe(true);
    expect(signal.excerpts).toEqual(["REJECTED: missing error handling"]);
    expect(signal.severity).toBe("minor");
    expect(signal.summary.length).toBeGreaterThan(0);
    expect(signal.summary.length).toBeLessThanOrEqual(300);
  });

  it("detects multiline rejections up to three excerpts", () => {
    const signal = detector.detect("BLOCKER: race condition\nMUST FIX: nullable\ndo not merge");

    expect(signal.matched).toBe(true);
    expect(signal.excerpts).toEqual([
      "BLOCKER: race condition",
      "MUST FIX: nullable",
      "do not merge",
    ]);
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

  it("detects lowercase must fix and blocker wording", () => {
    const signal = detector.detect("must fix: typo\nblocker: race condition");

    expect(signal.matched).toBe(true);
    expect(signal.excerpts).toEqual(["must fix: typo", "blocker: race condition"]);
    expect(signal.summary.length).toBeLessThanOrEqual(300);
  });

  it("appends ellipsis when summary exceeds max length", () => {
    const longExcerpt = "x".repeat(400);
    const signal = detector.detect(
      `BLOCKER: ${longExcerpt}\nMUST FIX: ${longExcerpt}\nDO NOT MERGE: ${longExcerpt}`,
    );

    expect(signal.matched).toBe(true);
    expect(signal.excerpts).toHaveLength(3);
    expect(signal.summary.length).toBeLessThanOrEqual(300);
    expect(signal.summary.endsWith("...")).toBe(true);
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

  it("parses every rejection line into a deterministic review item", () => {
    // Given
    const output = [
      "BLOCKER: security vulnerability at src/auth.ts:42",
      "MUST FIX: parser regression at src/parser.ts:10",
    ].join("\n");

    // When
    const items = detector.detectMultiple(output);

    // Then
    expect(items).toHaveLength(2);
    expect(items).toMatchObject([
      {
        severity: "critical",
        summary: "BLOCKER: security vulnerability at src/auth.ts:42",
        location: "src/auth.ts:42",
        status: "open",
      },
      {
        severity: "major",
        summary: "MUST FIX: parser regression at src/parser.ts:10",
        location: "src/parser.ts:10",
        status: "open",
      },
    ]);
    expect(items.every((item) => item.evidenceId === item.itemKey)).toBe(true);
  });

  it("reuses the detected signal severity for the corresponding review item", () => {
    const output = "BLOCKER: security vulnerability at src/auth.ts:42";

    const signal = detector.detect(output);
    const items = detector.detectMultiple(output);

    expect(signal.severity).toBe("critical");
    expect(items[0]?.severity).toBe(signal.severity);
  });

  it("does not escalate a blocker heading beyond the D57 severity classifier", () => {
    const items = detector.detectMultiple("BLOCKER: style suggestion at src/parser.ts:10");

    expect(items).toHaveLength(1);
    expect(items[0]?.severity).toBe("minor");
  });

  it("classifies a rejection from its immediately following detail line", () => {
    // Given
    const output = "BLOCKER:\nsecurity vulnerability at src/auth.ts:42";

    // When
    const items = detector.detectMultiple(output);

    // Then
    expect(items).toMatchObject([
      {
        severity: "critical",
        summary: "BLOCKER:\nsecurity vulnerability at src/auth.ts:42",
        location: "src/auth.ts:42",
      },
    ]);
  });

  it("stops rejection continuation at a blank line", () => {
    // Given
    const output = "BLOCKER:\n\nsecurity vulnerability at src/auth.ts:42";

    // When
    const items = detector.detectMultiple(output);

    // Then
    expect(items).toMatchObject([
      { severity: "minor", summary: "BLOCKER:", location: "unknown" },
    ]);
  });

  it("stops rejection continuation at a Markdown heading", () => {
    // Given
    const output = "BLOCKER:\n## Security vulnerability at src/auth.ts:42";

    // When
    const items = detector.detectMultiple(output);

    // Then
    expect(items).toMatchObject([
      { severity: "minor", summary: "BLOCKER:", location: "unknown" },
    ]);
  });

  it("deduplicates repeated review findings by item key", () => {
    // Given
    const finding = "MUST FIX: parser regression at src/parser.ts:10";

    // When
    const items = detector.detectMultiple(`${finding}\n${finding}`);

    // Then
    expect(items).toHaveLength(1);
  });

  it("produces the same item key for absolute and relative location summaries", () => {
    // Given
    const relativeFinding = "MUST FIX: parser regression at src/parser.ts:10";
    const absoluteFinding = "MUST FIX: parser regression at /workspace/src/parser.ts:10";

    // When
    const relativeItems = detector.detectMultiple(relativeFinding, {}, "/workspace");
    const absoluteItems = detector.detectMultiple(absoluteFinding, {}, "/workspace");

    // Then
    expect(relativeItems).toHaveLength(1);
    expect(absoluteItems).toHaveLength(1);
    expect(relativeItems[0]?.itemKey).toBe(absoluteItems[0]?.itemKey);
  });

  it("produces the same item key for dotted and plain relative locations", () => {
    // Given
    const plainFinding = "MUST FIX: parser regression at src/parser.ts:10";
    const dottedFinding = "MUST FIX: parser regression at ./src/parser.ts:10";

    // When
    const plainItems = detector.detectMultiple(plainFinding);
    const dottedItems = detector.detectMultiple(dottedFinding);

    // Then
    expect(plainItems).toHaveLength(1);
    expect(dottedItems).toHaveLength(1);
    expect(plainItems[0]?.itemKey).toBe(dottedItems[0]?.itemKey);
  });

  it("does not trust raw metadata to identify a complete review snapshot", () => {
    // Given
    const output = "review finished";

    // When / Then
    expect(detector.isCompleteSnapshot(output, { isCompleteSnapshot: true })).toBe(false);
    expect(detector.isCompleteSnapshot(output, { isCompleteSnapshot: false })).toBe(false);
  });

  it("does not infer a complete review snapshot without metadata", () => {
    // Given / When / Then
    expect(detector.isCompleteSnapshot("complete review with no findings")).toBe(false);
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
