import { describe, expect, it } from "vitest";
import type {
  FindingRemediatedV1,
  FindingReopenedV1,
  GateCreatedV1,
  PlanClearV1,
  ReviewGateEvent,
} from "../../../src/core/review-gate-types";
import {
  buildHistoryFindingsDto,
  buildHistoryRoundsDto,
  buildHistorySummaryDto,
  renderHistoryDisplayText,
} from "../../../src/core/review-gate/history";
import { computeCanonicalJsonFingerprint } from "../../../src/core/review-gate/identity";

const GATE_ID = "gate-test-1";
const SCOPE_ID = "scope-test-1";

let emittedCounter = 0;
function at(next: number): string {
  return new Date(Date.UTC(2026, 9, 8, 0, 0, next)).toISOString();
}
function nextAt(): string {
  emittedCounter += 1;
  return at(emittedCounter);
}

function gateCreated(overrides: Partial<GateCreatedV1["payload"]> = {}): GateCreatedV1 {
  const event: GateCreatedV1 = {
    eventType: "GATE_CREATED",
    gateId: GATE_ID,
    writerId: "writer-1",
    epochId: "epoch-1",
    emittedAt: nextAt(),
    payload: {
      reviewScopeId: SCOPE_ID,
      designArtifact: { canonicalPath: "docs/design.md", digest: "d1", gitMode: "100644" },
      planArtifact: { canonicalPath: "docs/plan.md", digest: "p1", gitMode: "100644" },
      requirementsResolution: { source: "explicit", canonicalPath: "requirements.md", digest: "r1" },
      reviewProtocolFingerprint: "f".repeat(64),
      ...overrides,
    },
  };
  return event;
}

function designClear(): ReviewGateEvent {
  return {
    eventType: "DESIGN_CLEAR",
    gateId: GATE_ID,
    writerId: "writer-1",
    epochId: "epoch-1",
    emittedAt: nextAt(),
    payload: { designProtocolFingerprint: "e".repeat(64) },
  };
}

function findingDiscovered(lineage: number): ReviewGateEvent {
  return {
    eventType: "FINDING_DISCOVERED",
    gateId: GATE_ID,
    writerId: "writer-1",
    epochId: "epoch-1",
    emittedAt: nextAt(),
    payload: {
      lineageId: `lineage-${lineage}`,
      findingId: `finding-${lineage}`,
      observedPhase: "design",
      ownerScope: "design",
      descriptionDigest: `dd${lineage}`,
    },
  } satisfies ReviewGateEvent;
}

function findingRemediated(lineage: number, round: { phase: "design"; ordinal: number }): FindingRemediatedV1 {
  return {
    eventType: "FINDING_REMEDIATED",
    gateId: GATE_ID,
    writerId: "writer-1",
    epochId: "epoch-1",
    emittedAt: nextAt(),
    payload: { lineageId: `lineage-${lineage}`, findingId: `finding-${lineage}`, remediationRound: round },
  };
}

function findingReopened(lineage: number, epochId: string): FindingReopenedV1 {
  return {
    eventType: "FINDING_REOPENED",
    gateId: GATE_ID,
    writerId: "writer-1",
    epochId,
    emittedAt: nextAt(),
    payload: { lineageId: `lineage-${lineage}`, findingId: `finding-${lineage}`, reopenedBy: epochId },
  };
}

function completedApproval(): PlanClearV1 | ReviewGateEvent {
  return {
    eventType: "COMPLETED_APPROVAL_BINDING",
    gateId: GATE_ID,
    writerId: "writer-2",
    epochId: "epoch-3",
    emittedAt: nextAt(),
    payload: {
      approvalBinding: {
        reviewScopeId: SCOPE_ID,
        gateId: GATE_ID,
        designArtifact: { canonicalPath: "docs/design.md", digest: "d2", gitMode: "100644" },
        planArtifact: { canonicalPath: "docs/plan.md", digest: "p2", gitMode: "100644" },
        requirementsResolution: { source: "explicit", canonicalPath: "requirements.md", digest: "r2" },
        reviewProtocolFingerprint: "f".repeat(64),
        designProtocolFingerprint: "e".repeat(64),
        planProtocolFingerprint: "g".repeat(64),
        approvedAt: "2026-10-08T00:10:00.000Z",
      },
    },
  };
}

describe("buildHistorySummaryDto", () => {
  it("captures exactly the Design HQ1 summary fields for an active design gate", () => {
    const events = [
      gateCreated(),
      findingDiscovered(1),
      findingRemediated(1, { phase: "design", ordinal: 1 }),
    ];
    const summary = buildHistorySummaryDto({ events });

    expect(summary).toEqual({
      dtoVersion: 1,
      reviewScopeId: SCOPE_ID,
      gateId: GATE_ID,
      status: "active",
      phase: "design",
      epochId: "epoch-1",
      epochStartedAt: events[0]?.emittedAt,
      epochReason: "gate_created",
      designClear: null,
      blockers: { remediable: 0, upstream: 0, pendingRevalidation: 1 },
      remediationUsage: { design: { used: 1, remaining: 4 }, plan: { used: 0, remaining: 3 } },
      lastTransition: {
        eventType: "FINDING_REMEDIATED",
        epochId: "epoch-1",
        emittedAt: events[2]?.emittedAt,
      },
      resumeCursor: { kind: "revalidate" },
      gateRevision: 3,
      headEventId: expect.any(String),
      storage: null,
    });
  });

  it("derives headEventId structurally from the last event and never exposes raw events", () => {
    const events = [gateCreated(), findingDiscovered(1)];
    const summary = buildHistorySummaryDto({ events });
    const otherArrangement = buildHistorySummaryDto({
      events: [gateCreated(), findingDiscovered(2)],
    });

    expect(summary.headEventId).toBe(
      computeCanonicalJsonFingerprint(events[events.length - 1]),
    );
    expect(summary.headEventId).not.toBe(otherArrangement.headEventId);
  });

  it("records Design CLEAR authority, completed state, and a completed resume cursor", () => {
    const gateCreate = gateCreated();
    const clearEvent = {
      eventType: "DESIGN_CLEAR",
      gateId: GATE_ID,
      writerId: "writer-1",
      epochId: "epoch-1",
      emittedAt: nextAt(),
      payload: { designProtocolFingerprint: "e".repeat(64) },
    } as const;
    const completion = completedApproval();
    const summary = buildHistorySummaryDto({
      events: [gateCreate, clearEvent, completion],
    });

    expect(summary.designClear).toEqual({
      epochId: "epoch-1",
      emittedAt: clearEvent.emittedAt,
      designProtocolFingerprint: "e".repeat(64),
    });
    expect(summary.status).toBe("completed");
    expect(summary.resumeCursor).toEqual({ kind: "completed" });
    expect(summary.blockers).toEqual({ remediable: 0, upstream: 0, pendingRevalidation: 0 });
  });

  it("counts pending revalidation blockers after remediation+reopening", () => {
    const summary = buildHistorySummaryDto({
      events: [
        gateCreated(),
        findingDiscovered(1),
        findingRemediated(1, { phase: "design", ordinal: 1 }),
        findingReopened(1, "epoch-2"),
      ],
    });
    // reopened current-phase finding is remediable again
    expect(summary.blockers.remediable).toBe(1);
    expect(summary.blockers.pendingRevalidation).toBe(0);
  });

  it("keeps pass-through storage diagnostics as non-authoritative display data", () => {
    const storage = {
      gateCount: 2,
      completedGates: 1,
      activeGates: 1,
      suspendedGates: 0,
      unreadableGates: 0,
      eventCount: 9,
      eventBytes: 1200,
      recoveryObjectCount: 0,
      recoveryBytes: 0,
      oldestGate: { gateId: "gate-old", createdAt: "2026-10-01T00:00:00.000Z" },
    };
    const summary = buildHistorySummaryDto({ events: [gateCreated()], storage });
    expect(summary.storage).toEqual(storage);
  });
});

describe("buildHistoryRoundsDto", () => {
  it("lists design and plan remediation rounds deterministically", () => {
    const rounds = buildHistoryRoundsDto({
      events: [
        gateCreated(),
        findingDiscovered(1),
        findingRemediated(1, { phase: "design", ordinal: 2 }),
        designClear(),
        findingDiscovered(2),
        findingRemediated(2, { phase: "plan", ordinal: 1 }),
      ],
    });

    expect(rounds).toEqual({
      dtoVersion: 1,
      reviewScopeId: SCOPE_ID,
      gateId: GATE_ID,
      designRounds: [2],
      planRounds: [1],
    });
  });
});

describe("buildHistoryFindingsDto", () => {
  it("emits findings sorted by lineage id with their lifecycle state", () => {
    const dto = buildHistoryFindingsDto({
      events: [
        gateCreated(),
        findingDiscovered(2),
        findingDiscovered(1),
        findingRemediated(1, { phase: "design", ordinal: 1 }),
      ],
    });

    expect(dto.findings).toHaveLength(2);
    expect(dto.findings[0]?.lineageId).toBe("lineage-1");
    expect(dto.findings[1]?.lineageId).toBe("lineage-2");
    expect(dto.findings[0]).toEqual({
      lineageId: "lineage-1",
      findingId: "finding-1",
      observedPhase: "design",
      ownerScope: "design",
      status: "remediated",
      remediationRound: { phase: "design", ordinal: 1 },
      reopenedBy: null,
      descriptionDigest: "dd1",
    });
  });
});

describe("renderHistoryDisplayText", () => {
  it("renders generations deterministically without raw events", () => {
    const summary = buildHistorySummaryDto({ events: [gateCreated()] });
    const pane = { view: "summary" as const, dto: summary };
    const text = renderHistoryDisplayText({
      view: "generations",
      dto: { dtoVersion: 1, reviewScopeId: SCOPE_ID, view: "summary", generations: [pane, pane] },
    });

    expect(text.split("[JUSTICE: REVIEW HISTORY]").length).toBe(3);
    expect(text).toBe(
      renderHistoryDisplayText({
        view: "generations",
        dto: { dtoVersion: 1, reviewScopeId: SCOPE_ID, view: "summary", generations: [pane, pane] },
      }),
    );
  });
});
