import { describe, expect, it } from "vitest";

import {
  createReviewGateHostAdapter,
} from "../../src/runtime/review-gate-host-adapter";

describe("Task 17 host adapter routing translation", () => {
  const adapter = createReviewGateHostAdapter();

  it("maps execute dispositions to execute_operation without fabricating ids or reasons", () => {
    expect(adapter.translateRoutingDecision("execute_operation")).toEqual({
      kind: "execute_operation",
      operationId: null,
      reason: null,
    });
    expect(adapter.translateRoutingDecision("resume")).toEqual({
      kind: "execute_operation",
      operationId: null,
      reason: null,
    });
  });

  it("maps blocking dispositions to block with the host disposition as reason", () => {
    expect(adapter.translateRoutingDecision("block")).toEqual({
      kind: "block",
      operationId: null,
      reason: "block",
    });
    expect(adapter.translateRoutingDecision("reject")).toEqual({
      kind: "block",
      operationId: null,
      reason: "reject",
    });
    expect(adapter.translateRoutingDecision("abort")).toEqual({
      kind: "block",
      operationId: null,
      reason: "abort",
    });
  });

  it("maps await dispositions to await_evidence", () => {
    expect(adapter.translateRoutingDecision("await_evidence")).toEqual({
      kind: "await_evidence",
      operationId: null,
      reason: null,
    });
    expect(adapter.translateRoutingDecision("awaiting_evidence")).toEqual({
      kind: "await_evidence",
      operationId: null,
      reason: null,
    });
    expect(adapter.translateRoutingDecision("evidence_pending")).toEqual({
      kind: "await_evidence",
      operationId: null,
      reason: null,
    });
  });

  it("falls back to a fail-closed block for unknown dispositions", () => {
    const fallback = {
      kind: "block",
      operationId: null,
      reason: "unknown_host_disposition",
    };
    expect(adapter.translateRoutingDecision("phase_unknown_disposition")).toEqual(
      fallback,
    );
    expect(adapter.translateRoutingDecision("")).toEqual(fallback);
    // Dispositions are matched exactly — no normalization, no aliases.
    expect(adapter.translateRoutingDecision("Execute_Operation")).toEqual(fallback);
    expect(adapter.translateRoutingDecision(" execute_operation")).toEqual(fallback);
  });

  it("returns frozen immutable decision objects", () => {
    for (const disposition of [
      "execute_operation",
      "block",
      "await_evidence",
      "anything_else",
    ]) {
      expect(Object.isFrozen(adapter.translateRoutingDecision(disposition))).toBe(
        true,
      );
    }
  });
});