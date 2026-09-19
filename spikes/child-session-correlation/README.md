# Spike: child-session correlation boundary

**Task:** SDD Task 3.3 — Prove the child-session correlation boundary (JUS-P0-04, INV-15, Design §4.9).
**Verdict:** **OK** — Phase 3 correlation boundary is proven on the installed runtime. Not BLOCKED.
**Runtime under test:** `opencode-ai@1.18.29` (pinned by Task 3.3a inside the devcontainer), driven headless via `opencode serve`.
**Probe:** `spikes/child-session-correlation/verify.ts` (Bun-native, no external dependencies).

```bash
devcontainer exec --workspace-folder . bun spikes/child-session-correlation/verify.ts
# → prints one JSON verdict; exit 0 = OK, non-zero = BLOCKED
```

## What the probe proves

The installed OpenCode runtime correlates a parent `task()` tool call to the
child session it spawns, for both worker categories `sp-review` and
`sp-final-review`, and exposes the correlation through three observable
surfaces (plugin hooks, the event bus, and the session REST API). Every
identity below is **runtime-provided**: the probe never infers an identity
from prompt text, category, artifact path, or worker self-report.

## Observed runtime contract

### 1. Plugin hook payloads (spike observation plugin)

| Payload | Event name | Exact field path | Content |
| --- | --- | --- | --- |
| Parent call ID | `tool.execute.before` (plugin hook) | `input.callID` | non-empty call ID of the `task` tool call in the parent session |
| Parent call ID (echo) | `tool.execute.after` (plugin hook) | `input.callID` | identical value; pairs before/after for the same call |
| Child session ID | `tool.execute.after` (plugin hook) | `output.metadata.sessionId` | non-empty child session ID, present in the same payload as the paired `callID` |
| Parent session cross-check | `tool.execute.after` (plugin hook) | `output.metadata.parentSessionId` | equals `input.sessionID` of the same payload |
| Task tool args (canonical wire) | `tool.execute.before` | `input.args` | `{ description, prompt, subagent_type, task_id?, command? }` — note the snake_case `subagent_type`; optional `task_id` resumes the *same* child session instead of creating a new one |

`tool.execute.after` **does not fire when a tool fails** (observed when a
`task` dispatch referenced an unknown agent): only `tool.execute.before` is
emitted. Correlation logic must tolerate a before-hook without a matching
after-hook.

### 2. Event bus (`GET /event` SSE; the same events a plugin `event` hook receives)

| Event | Exact field path | Content |
| --- | --- | --- |
| `session.created` / `session.updated` | `properties.info.parentID` | child sessions carry the parent session ID |
| `session.created` / `session.updated` | `properties.info.id` | the child session ID (matches `metadata.sessionId`) |
| `message.updated` | `properties.sessionID` | child-session message observation when set to the child session ID |
| `message.part.updated` | `properties.part.sessionID`, `properties.part.type`, `properties.part.state.status` | child message parts; `type: "tool"` parts carry the child's own `callID` and state (`pending` → `running` → `completed`) |

### 3. Session REST API

| Endpoint | Field | Content |
| --- | --- | --- |
| `GET /session` | `Session.parentID` | child sessions list their parent session ID |
| `GET /session/{childId}/message` | message/parts array | child-session messages and parts are readable after the dispatch completes |

### Correlation rule proven

```
parent call ID  = tool.execute.before hook input.callID
child session   = tool.execute.after hook output.metadata.sessionId
                  (same payload ⇒ direct correlation, no windowing needed)
corroboration   = metadata.parentSessionId == hook input.sessionID
                ∧ event bus session.created/updated where
                  properties.info.parentID == parent sessionID
                ∧ child message.updated / message.part.updated events
                ∧ GET /session/{childId}/message returns the child's messages
```

## Redacted traces (observed 2026-09-18, opencode 1.18.29)

One parent session drove exactly two dispatches. Prompt contents and
ephemeral fixture paths are redacted; IDs are opaque runtime tokens from the
observed run. The `sp-review` child additionally emitted a completed `read`
tool part so the trace demonstrates child-session **tool** observation, not
just message observation.

### Trace 1 — `sp-review` dispatch

```json
{
  "worker": "sp-review",
  "parentCallId": "call-1-sp-review",
  "parentSessionId": "ses_f4afb9f2dffeT5OdKD0UZl41Nu",
  "childSessionId": "ses_f4afb9d41ffeAVXq4Q7w9pUV4M",
  "hookEvent": "plugin hook tool.execute.before + tool.execute.after",
  "hookInput": { "tool": "task", "sessionID": "ses_f4afb9f2dffeT5OdKD0UZl41Nu", "callID": "call-1-sp-review" },
  "hookArgsEchoed": { "subagent_type": "sp-review" },
  "hookAfterMetadata": {
    "parentSessionId": "ses_f4afb9f2dffeT5OdKD0UZl41Nu",
    "sessionId": "ses_f4afb9d41ffeAVXq4Q7w9pUV4M",
    "truncated": false
  },
  "childSessionEvent": {
    "type": "session.created",
    "field": "properties.info.parentID",
    "parentID": "ses_f4afb9f2dffeT5OdKD0UZl41Nu",
    "matches": true
  },
  "childObservation": {
    "messageEvents": 7,
    "partEvents": 10,
    "partTypes": ["step-finish", "step-start", "text", "tool"],
    "toolParts": [{ "tool": "read", "callID": "call-child-read", "state": "completed" }],
    "restMessages": 3
  }
}
```

### Trace 2 — `sp-final-review` dispatch

```json
{
  "worker": "sp-final-review",
  "parentCallId": "call-2-sp-final-review",
  "parentSessionId": "ses_f4afb9f2dffeT5OdKD0UZl41Nu",
  "childSessionId": "ses_f4afb9ceaffebkD3kKXV0Bw4XM",
  "hookEvent": "plugin hook tool.execute.before + tool.execute.after",
  "hookInput": { "tool": "task", "sessionID": "ses_f4afb9f2dffeT5OdKD0UZl41Nu", "callID": "call-2-sp-final-review" },
  "hookArgsEchoed": { "subagent_type": "sp-final-review" },
  "hookAfterMetadata": {
    "parentSessionId": "ses_f4afb9f2dffeT5OdKD0UZl41Nu",
    "sessionId": "ses_f4afb9ceaffebkD3kKXV0Bw4XM",
    "truncated": false
  },
  "childSessionEvent": {
    "type": "session.created",
    "field": "properties.info.parentID",
    "parentID": "ses_f4afb9f2dffeT5OdKD0UZl41Nu",
    "matches": true
  },
  "childObservation": {
    "messageEvents": 4,
    "partEvents": 5,
    "partTypes": ["step-finish", "step-start", "text"],
    "toolParts": [],
    "restMessages": 2
  }
}
```

Both traces: non-empty runtime-provided parent call ID (`input.callID`) and
child session ID (`output.metadata.sessionId`), mutually corroborated by the
event-bus `parentID` linkage and child message/tool observations. The two
dispatches resolved to distinct child sessions.

## How the probe works (runtime-only, no production code touched)

1. Asserts `opencode --version` is exactly `1.18.29`; any drift exits non-zero.
2. Creates a throwaway workspace under the OS temp dir with:
   - an `opencode.json` that registers a **spike-local observation plugin**
     (records `tool.execute.before` / `tool.execute.after` payloads and bus
     events to a JSONL file; fails open on its own I/O errors),
   - a deterministic **scripted OpenAI-compatible model endpoint** (in-process
     `Bun.serve`) so the probe needs no external provider or credentials. The
     script instructs the parent model to call `task` twice (`subagent_type:
     "sp-review"`, then `"sp-final-review"`) and gives the `sp-review` child a
     `read` tool call so a child tool part is observable.
3. Starts `opencode serve` with isolated `XDG_DATA_HOME`/`XDG_CONFIG_HOME`,
   subscribes to `GET /event` (SSE), creates a session via `POST /session`,
   and drives the turn via `POST /session/{id}/message`.
4. Correlates strictly from the payloads above, prints a JSON verdict with
   both redacted traces, and exits `0` only when both traces are complete.
5. On `BLOCKED`, the verdict embeds the raw hook/event shapes observed so the
   failure can be recorded without re-running anything.
6. Always cleans up: kills the server, stops the mock endpoint, and removes
   the temporary workspace.

## Notes and limits observed on this runtime

- The `callID` value originates from the model-provider tool-call protocol
  and is propagated unchanged by the runtime through hooks and the persisted
  parent-session tool parts (`ToolPart.callID`). Consumers must treat it as
  opaque.
- `output.output` of the `task` after-hook also embeds
  `<task id="ses_…" state="completed">` text; `metadata.sessionId` is the
  structured field and is the one this contract pins.
- Headless `opencode serve` emits plugin hook payloads and bus events
  reliably; this supersedes the earlier uncertainty recorded in SPEC §15.12
  about the headless path (that note concerned Justice's own observation-log
  writes, not hook availability).
