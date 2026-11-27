// Daily Assurance: Native x Superpowers explicit Task boundaries and V2 production wiring
// (design §4.1 production wiring, §4.3 RG-003 lifecycle / bounded finish, RG-001 TERMINAL revalidation).
//
// - One in-process coordinator per Plugin setup, for ONE Owner-approved Task (no Gate, no persistence).
// - All lifecycle transitions, in-flight map updates, taint flags, epoch counter, shared promise
//   reservation and terminal cache assignment happen synchronously before the first await.
// - Fail-open toward the Host (hooks/tools never throw to cancel), fail-closed toward assurance
//   (fixed reason codes only; never raw payloads, paths, IDs or exception text).
//
// SDK surface: `@opencode/plugin@2.3.2` types are not installed in this environment, so this module
// does NOT import them. It declares narrow local structural interfaces (`DailyPluginContext` etc.) that
// mirror the fixed v2.3.2 shapes referenced by the design (§2 fixed references: promise/tool.ts
// `ToolDomain.hook/transform`, `ToolHooks["execute.before"|"execute.after"]`, `Tool.Options.codemode`,
// promise/skill.ts `SkillDomain.list`, registration.ts `Registration`).
import {createHash} from 'node:crypto';
import {lstat,open,realpath} from 'node:fs/promises';
import {isLowercaseSha256Hex,isSafeIdentifier,type S1aReadOnlySource} from '../core/s1a/contract.js';
import {
  DAILY_APPROVAL_ENV,DAILY_HOST_SHA256,DAILY_OWNER_ROOT,loadDailyOwnerConfig,matchRuleInput,prepareDailyBinding,verifyDailyBinding,
  type CheckResult,type DailyBinding,type DailyConfigResult,type DailyOwnerConfig,type DailyPreflightPorts,type DailyReason,
  type OwnerConfigReadPort,type Unavailable,
} from './daily-intent.js';
import {
  checkBeginPrefix,checkFinishBoundary,checkNoRunningShells,collectDailyNativeEvidence,createNativeReadPort,readNativeSnapshot,
  type CallIdentity,type DailyEvidenceResult,type NativeEpoch,type NativeObservation,type NativeReadPort,
} from './daily-native-evidence.js';
import {checkCleanBase,collectDailyChangeSet,createDailyGitReadPort,type DailyChangeSetResult,type DailyGitReadPort} from './daily-changeset.js';
import {makeDailyUnavailable,markDailyBoundaryUncertain,runDailyAdvisory,type DailyAdvisoryReport,type DailyBoundary} from './daily-advisory.js';
import {createS1aReadOnlySource} from './s1a-read-only-fs.js';

// ---------------------------------------------------------------------------
// Public contract (Plan Task 5)
// ---------------------------------------------------------------------------

export type DailyLifecycle = "ARMED"|"STARTING"|"ACTIVE"|"FINISHING"|"TERMINAL"|"DISPOSED";
export type BoundaryCall = Readonly<CallIdentity & {agent:string;signal:AbortSignal}>;
export type DailyBeginResult = Readonly<{state:"READY";bindingKey:string}>
  | Unavailable;
export interface DailyCoordinatorPorts {
  readonly config:DailyOwnerConfig;
  readonly preflight:DailyPreflightPorts;
  readonly native:NativeReadPort;
  readonly git:DailyGitReadPort;
  isSkillReady():boolean;
  // Internal diagnostic seam only. Production binds the actual imported function.
  diagnose:typeof runDailyAdvisory;
}
export interface DailyCoordinator {
  getState():DailyLifecycle;
  isActive(sessionId:string):boolean;
  begin(call:BoundaryCall):Promise<DailyBeginResult>;
  observe(event:NativeObservation):void;
  finish(bindingKey:string,call:BoundaryCall):Promise<DailyAdvisoryReport>;
  dispose():void;
}
export type DailyRuntimeResult = Readonly<{
  state:"READY"; ports:DailyCoordinatorPorts;
  markSkillReady(ready:boolean):void;
}> | Readonly<{state:"OFF";reason:DailyReason}>;

// ---------------------------------------------------------------------------
// Narrow structural SDK surface (fixed v2.3.2 shapes; see module header)
// ---------------------------------------------------------------------------

export interface DailyRegistration {readonly dispose: () => Promise<void>}
export interface DailyToolContextLike {
  readonly sessionID?: unknown; readonly messageID?: unknown; readonly id?: unknown;
  readonly agent?: unknown; readonly signal?: unknown;
}
export interface DailyToolInfo {
  readonly name: string; readonly description: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly options: Readonly<{codemode: false}>;
  readonly execute: (input: unknown, context: DailyToolContextLike) => Promise<{readonly content: string}>;
}
export interface DailyToolEditorLike {add(tool: DailyToolInfo): void}
export interface DailyPluginContext {
  readonly location?: Readonly<{directory?: unknown}>;
  readonly tool: {
    hook(name: "execute.before" | "execute.after", callback: (input: unknown) => Promise<void> | void): Promise<DailyRegistration>;
    transform(callback: (editor: DailyToolEditorLike) => void): Promise<DailyRegistration>;
  };
  readonly skill: {
    /** promise/skill.ts `SkillDomain extends SkillApi`: final Skill list after every transform (`{data: Skill.Info[]}`). */
    list(): Promise<unknown>;
  };
}

// ---------------------------------------------------------------------------
// Fixed constants
// ---------------------------------------------------------------------------

const CONTROL_BEGIN = 'justice_task_begin';
const CONTROL_FINISH = 'justice_task_finish';
const OBSERVATION_CAP = 4_096;
const BEGIN_DEADLINE_MS = 45_000;
const FINISH_DEADLINE_MS = 90_000;
const SETUP_DEADLINE_MS = 30_000;
const APPROVAL_PATH = `${DAILY_OWNER_ROOT}/approval.json`;
const MANIFEST_PATH = `${DAILY_OWNER_ROOT}/manifest.json`;
const INTENT_PATH = `${DAILY_OWNER_ROOT}/intent.json`;
const ARTIFACTS_ROOT = `${DAILY_OWNER_ROOT}/artifacts`;
const APPROVAL_MAX_BYTES = 65_536;
const MOUNTINFO_PATH = '/proc/self/mountinfo';
const MOUNTINFO_MAX_BYTES = 4_194_304;
const EXE_PATH = '/proc/self/exe';
const EXE_MAX_BYTES = 512 * 1_048_576;
const EXE_DEADLINE_MS = 10_000;
const READ_CHUNK = 1_048_576;
const KEY_PATTERN = /^[0-9a-f]{64}$/;
/** Host IDs (session/message/call/agent): bounded ASCII token, never echoed back. */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
/** `agent` is never used after validation: only a bounded, printable string is required (Host name format unverified). */
const AGENT_PATTERN = /^[\x20-\x7E]{1,256}$/u;
const TOOL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;

/** Fixed Skill instruction (design §4.3); appended after a single newline delimiter, never interpolated. */
export const DAILY_SKILL_APPEND = [
  '## Justice Daily Assurance (Owner opt-in; advisory only)',
  'Before the approved inline Task\'s first implementation action, call the direct',
  'justice_task_begin tool with {} in its own assistant tool-call message, not',
  'inside execute and not in parallel. Keep the returned bindingKey only if READY.',
  'Use only the pre-approved direct shell invocation for AC evidence; do not start',
  'child sessions, detached/background jobs, or concurrent tasks. Follow the',
  'existing executing-plans workflow unchanged. At the existing task-done candidate',
  'boundary, after all task tools have settled, call the direct justice_task_finish',
  'with that bindingKey in its own assistant tool-call message, not inside execute',
  'or in parallel. Treat returned diagnostics as advisory, never as formal PASS.',
  'If unavailable, preserve the limitation; follow existing safety/Owner boundaries.',
  'Do not start an extra review, fix, retry, or approval cycle because of this tool.',
].join('\n');
const SKILL_SUFFIX = `\n${DAILY_SKILL_APPEND}`;

const BEGIN_INPUT = Object.freeze({type: 'object', properties: Object.freeze({}), additionalProperties: false});
const FINISH_INPUT = Object.freeze({
  type: 'object',
  properties: Object.freeze({bindingKey: Object.freeze({type: 'string', pattern: '^[0-9a-f]{64}$'})}),
  required: Object.freeze(['bindingKey']),
  additionalProperties: false,
});
const DIRECT_OPTIONS = Object.freeze({codemode: false as const});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Rec = Readonly<Record<string, unknown>>;
const isRecord = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const unavailable = (reason: DailyReason): Unavailable => Object.freeze({state: 'UNAVAILABLE' as const, reason});
const off = (reason: DailyReason): DailyRuntimeResult => Object.freeze({state: 'OFF' as const, reason});
const OK: CheckResult = Object.freeze({state: 'OK' as const});
const keyOf = (i: CallIdentity): string => JSON.stringify([i.sessionId, i.messageId, i.callId]);
const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
/** Own data property only (never invokes getters on raw SDK payloads). */
function field(record: unknown, name: string): unknown {
  if (!isRecord(record)) return undefined;
  const d = Object.getOwnPropertyDescriptor(record, name);
  return d !== undefined && 'value' in d ? d.value : undefined;
}
const isAbortSignal = (v: unknown): v is AbortSignal =>
  isRecord(v) && typeof (v as {aborted?: unknown}).aborted === 'boolean' && typeof (v as {addEventListener?: unknown}).addEventListener === 'function';

function identityOf(call: unknown): CallIdentity | null {
  if (!isRecord(call)) return null;
  const sessionId = call.sessionId, messageId = call.messageId, callId = call.callId, agent = call.agent;
  if (typeof sessionId !== 'string' || typeof messageId !== 'string' || typeof callId !== 'string' || typeof agent !== 'string') return null;
  if (![sessionId, messageId, callId].every(v => ID_PATTERN.test(v)) || !AGENT_PATTERN.test(agent) || !isAbortSignal(call.signal)) return null;
  return Object.freeze({sessionId, messageId, callId});
}

function isObservation(e: unknown): e is NativeObservation {
  if (!isRecord(e)) return false;
  const {sessionId, messageId, callId, tool, phase, status, ruleId} = e as Record<string, unknown>;
  if (typeof sessionId !== 'string' || typeof messageId !== 'string' || typeof callId !== 'string' || typeof tool !== 'string') return false;
  if (![sessionId, messageId, callId].every(v => ID_PATTERN.test(v)) || !TOOL_NAME_PATTERN.test(tool)) return false;
  if (phase === 'BEFORE' ? status !== 'STARTED' : phase === 'AFTER' ? status !== 'COMPLETED' && status !== 'ERROR' : true) return false;
  return ruleId === null || isSafeIdentifier(ruleId);
}
const sameObservation = (a: NativeObservation, b: NativeObservation): boolean =>
  a.tool === b.tool && a.phase === b.phase && a.status === b.status && a.ruleId === b.ruleId;

const ABORTED = Symbol('aborted');
class Halt extends Error {constructor(readonly reason: DailyReason) {super(reason);}}

/** First matching control signal + lifetime + fixed deadline; further matching waiters may join. */
type Operation = Readonly<{
  signal: AbortSignal; follow(signal: AbortSignal): void; race<T>(p: Promise<T>): Promise<T | typeof ABORTED>;
  reason(): DailyReason; dispose(): void;
}>;
function createOperation(lifetime: AbortSignal, first: AbortSignal, ms: number): Operation {
  const ctl = new AbortController();
  let expired = false;
  const listeners: [AbortSignal, () => void][] = [];
  const follow = (s: AbortSignal): void => {
    if (s.aborted) {ctl.abort(); return;}
    const onAbort = (): void => ctl.abort();
    s.addEventListener('abort', onAbort, {once: true});
    listeners.push([s, onAbort]);
  };
  follow(lifetime);
  follow(first);
  const timer = setTimeout(() => {expired = true; ctl.abort();}, ms);
  const aborted = new Promise<typeof ABORTED>((resolve) => {
    if (ctl.signal.aborted) resolve(ABORTED);
    else ctl.signal.addEventListener('abort', () => resolve(ABORTED), {once: true});
  });
  return Object.freeze({
    signal: ctl.signal,
    follow,
    race: <T>(p: Promise<T>): Promise<T | typeof ABORTED> => {
      p.catch(() => undefined); // a suppressed late rejection must not surface
      return Promise.race([p, aborted]);
    },
    reason: (): DailyReason => lifetime.aborted ? 'DISPOSED' : expired ? 'TIMEOUT' : 'ABORTED',
    dispose: (): void => {
      clearTimeout(timer);
      for (const [s, fn] of listeners) s.removeEventListener('abort', fn);
      listeners.length = 0;
    },
  });
}

// ---------------------------------------------------------------------------
// Coordinator
// ---------------------------------------------------------------------------

type CallRecord = {readonly tool: string; readonly control: boolean; before: NativeObservation | null; after: NativeObservation | null};
type Terminal = {report: DailyAdvisoryReport; invalidated: boolean; late: boolean};

export function createDailyCoordinator(ports:DailyCoordinatorPorts):DailyCoordinator {
  const config = ports.config;
  const sessionId = config.approval.sessionId;
  const lifetime = new AbortController();
  let lifecycle: DailyLifecycle = 'ARMED';
  let stored = 0;
  let overLimit = false;
  const calls = new Map<string, CallRecord>();
  const active = new Set<string>();
  let epochObservations: NativeObservation[] = [];
  const taints: DailyReason[] = [];
  let counter = 0; // non-control observations after ACTIVE
  let startDisturbed = false;
  let beginCall: CallIdentity | null = null;
  let binding: DailyBinding | null = null;
  let prefix: readonly string[] = [];
  let finishKeys = new Set<string>();
  let finishOp: Operation | null = null;
  let finishPromise: Promise<DailyAdvisoryReport> | null = null;
  let concurrentFinish = false;
  let terminal: Terminal | null = null;

  const taint = (reason: DailyReason): void => {if (!taints.includes(reason)) taints.push(reason);};
  const skillReady = (): boolean => {try {return ports.isSkillReady() === true;} catch {return false;}};
  const isControl = (tool: string): boolean => tool === CONTROL_BEGIN || tool === CONTROL_FINISH;

  function markLate(): void {
    if (terminal !== null && !terminal.late && !terminal.invalidated) {
      terminal.late = true;
      terminal.report = markDailyBoundaryUncertain(terminal.report, 'LATE_OBSERVATION', {afterReturn: true});
    }
  }

  /** A malformed or over-limit observation: fixed taint per phase, no storage. */
  function disturb(reason: DailyReason): void {
    switch (lifecycle) {
      case 'STARTING': startDisturbed = true; taint(reason); return;
      case 'ACTIVE': taint(reason); return;
      case 'FINISHING': counter += 1; taint(reason); return;
      case 'TERMINAL': markLate(); return;
      default: return;
    }
  }

  function observe(event: NativeObservation): void {
    try {
      if (lifecycle === 'DISPOSED') return;
      const observedSessionId = field(event, 'sessionId');
      if (typeof observedSessionId === 'string' && ID_PATTERN.test(observedSessionId) && observedSessionId !== sessionId) return;
      if (!isObservation(event)) {disturb('BOUNDARY_UNCERTAIN'); return;}
      if (observedSessionId !== sessionId) {disturb('BOUNDARY_UNCERTAIN'); return;}
      const control = isControl(event.tool);
      // FINISHING retains rule identity only to deduplicate an ACTIVE event replay;
      // FINISHING observations are never added to the sealed evidence epoch.
      const ruleId = (lifecycle === 'ACTIVE' || lifecycle === 'FINISHING') && event.tool === 'shell' ? event.ruleId : null;
      const obs: NativeObservation = Object.freeze({
        sessionId: event.sessionId, messageId: event.messageId, callId: event.callId,
        tool: event.tool, phase: event.phase, status: event.status, ruleId,
      });
      const key = keyOf(obs);
      const record = calls.get(key);
      const prior = record === undefined ? null : obs.phase === 'BEFORE' ? record.before : record.after;
      if (prior !== null && sameObservation(prior, obs)) return; // exact duplicate: idempotent
      if (stored >= OBSERVATION_CAP) {overLimit = true; disturb('OBSERVATION_LIMIT'); return;}
      stored += 1;
      let conflict = false;
      if (obs.phase === 'BEFORE') {
        if (record === undefined) {
          calls.set(key, {tool: obs.tool, control, before: obs, after: null});
          active.add(key);
        } else conflict = true; // conflicting same phase / identity reuse
      } else if (record === undefined || record.after !== null) {
        conflict = true; // unknown after, or a contradictory second after
      } else {
        record.after = obs;
        active.delete(key);
        if (record.tool !== obs.tool || record.before?.ruleId !== obs.ruleId) conflict = true; // alias / rule change
      }
      switch (lifecycle) {
        case 'ARMED': return; // tracked for quietness only, never an AC candidate
        case 'STARTING':
          if (!(control && beginCall !== null && key === keyOf(beginCall)) || conflict) startDisturbed = true;
          return;
        case 'ACTIVE':
          if (conflict) taint('BOUNDARY_UNCERTAIN');
          epochObservations.push(obs);
          if (!control) counter += 1;
          return;
        case 'FINISHING':
          if (!control || conflict) counter += 1;
          return;
        case 'TERMINAL':
          if (!control) markLate();
          return;
      }
    } catch {
      disturb('BOUNDARY_UNCERTAIN');
    }
  }

  // ----- begin ------------------------------------------------------------

  function failStart(reason: DailyReason): DailyBeginResult {
    if (lifecycle === 'DISPOSED') return unavailable('DISPOSED');
    lifecycle = 'TERMINAL';
    binding = null;
    terminal = {report: makeDailyUnavailable(reason), invalidated: false, late: false};
    return unavailable(reason);
  }

  async function runBegin(id: CallIdentity, op: Operation): Promise<DailyBeginResult> {
    const stop = (): DailyReason | null => {
      if (lifecycle !== 'STARTING') return lifecycle === 'DISPOSED' ? 'DISPOSED' : 'ABORTED';
      if (op.signal.aborted) return op.reason();
      if (overLimit) return 'OBSERVATION_LIMIT';
      if (startDisturbed) return 'BOUNDARY_UNCERTAIN';
      return null;
    };
    const step = async <T>(p: Promise<T>): Promise<T> => {
      const r = await op.race(p);
      const s = stop();
      if (s !== null || r === ABORTED) throw new Halt(s ?? op.reason());
      return r as T;
    };
    try {
      const prepared = await step(prepareDailyBinding(config, ports.preflight, op.signal));
      if (prepared.state !== 'READY') return failStart(prepared.reason);
      const b = prepared.binding;
      const shells = await step(checkNoRunningShells(b, ports.native, op.signal));
      if (shells.state !== 'OK') return failStart(shells.reason);
      const snap = await step(readNativeSnapshot(b, ports.native, `daily-${b.key.slice(0, 16)}-begin`, op.signal));
      if (snap.state === 'REJECTED') return failStart('SOURCE_REJECTED');
      if (snap.state !== 'READY') return failStart(snap.reason);
      const pre = checkBeginPrefix(snap.snapshot, id);
      if (pre.state !== 'READY') return failStart(pre.reason);
      const s = stop();
      if (s !== null) return failStart(s);
      if (!skillReady()) return failStart('SKILL_UNSUPPORTED');
      binding = b;
      prefix = pre.prefixMessageIds;
      epochObservations = [];
      counter = 0;
      lifecycle = 'ACTIVE';
      return Object.freeze({state: 'READY' as const, bindingKey: b.key});
    } catch (e) {
      return failStart(e instanceof Halt ? e.reason : 'SETUP_FAILED');
    } finally {
      op.dispose();
    }
  }

  function begin(call: BoundaryCall): Promise<DailyBeginResult> {
    try {
      if (lifecycle === 'DISPOSED') return Promise.resolve(unavailable('DISPOSED'));
      const id = identityOf(call);
      if (id === null) return Promise.resolve(unavailable('IDENTITY_UNMATCHED'));
      if (id.sessionId !== sessionId) return Promise.resolve(unavailable('SESSION_MISMATCH'));
      if (lifecycle === 'TERMINAL') return Promise.resolve(unavailable('ALREADY_TERMINAL'));
      if (lifecycle !== 'ARMED') return Promise.resolve(unavailable('BUSY'));
      if (!skillReady()) return Promise.resolve(unavailable('SKILL_UNSUPPORTED'));
      if (call.signal.aborted) return Promise.resolve(unavailable('ABORTED'));
      // Reserve synchronously: no second Task per process from here on.
      lifecycle = 'STARTING';
      beginCall = id;
      startDisturbed = false;
      const key = keyOf(id);
      const own = calls.get(key);
      if (overLimit) return Promise.resolve(failStart('OBSERVATION_LIMIT'));
      if (own === undefined || own.tool !== CONTROL_BEGIN || own.before === null || own.after !== null) return Promise.resolve(failStart('NOT_OBSERVED'));
      if ([...active].some(k => k !== key)) return Promise.resolve(failStart('TOOL_IN_FLIGHT'));
      return runBegin(id, createOperation(lifetime.signal, call.signal, BEGIN_DEADLINE_MS));
    } catch {
      return Promise.resolve(lifecycle === 'STARTING' ? failStart('SETUP_FAILED') : unavailable('SETUP_FAILED'));
    }
  }

  // ----- finish -----------------------------------------------------------

  function publish(report: DailyAdvisoryReport): DailyAdvisoryReport {
    if (lifecycle !== 'FINISHING') return makeDailyUnavailable(lifecycle === 'DISPOSED' ? 'DISPOSED' : 'ABORTED');
    lifecycle = 'TERMINAL';
    terminal = {report, invalidated: false, late: false};
    return report;
  }

  type Sealed = Readonly<{
    binding: DailyBinding; epoch: NativeEpoch; sealCounter: number;
    preReasons: readonly DailyReason[]; inFlight: boolean;
  }>;

  async function runFinish(sealed: Sealed, op: Operation): Promise<DailyAdvisoryReport> {
    const b = sealed.binding;
    const stop = (): DailyReason | null =>
      lifecycle !== 'FINISHING' ? (lifecycle === 'DISPOSED' ? 'DISPOSED' : 'ABORTED') : op.signal.aborted ? op.reason() : null;
    const step = async <T>(p: Promise<T>): Promise<T> => {
      const r = await op.race(p);
      const s = stop();
      if (s !== null || r === ABORTED) throw new Halt(s ?? op.reason());
      return r as T;
    };
    try {
      const verified = await step(verifyDailyBinding(b, ports.preflight, op.signal));
      if (verified.state !== 'OK') return publish(makeDailyUnavailable(verified.reason));
      const shellsA = await step(checkNoRunningShells(b, ports.native, op.signal));
      const snapA = await step(readNativeSnapshot(b, ports.native, `daily-${b.key.slice(0, 16)}-end-a`, op.signal));
      const blocked: DailyReason | null = sealed.inFlight ? 'TOOL_IN_FLIGHT' : overLimit ? 'OBSERVATION_LIMIT'
        : shellsA.state !== 'OK' ? shellsA.reason : counter !== sealed.sealCounter ? 'LATE_OBSERVATION' : null;
      const sourceMismatchA = snapA.state === 'UNAVAILABLE'
        && (snapA.reason === 'WORKSPACE_MISMATCH' || snapA.reason === 'SESSION_MISMATCH') ? snapA.reason : null;
      let changes: DailyChangeSetResult = sourceMismatchA !== null ? unavailable(sourceMismatchA)
        : blocked !== null ? unavailable(blocked) : await step(collectDailyChangeSet(b, ports.git, op.signal));
      const snapB = await step(readNativeSnapshot(b, ports.native, `daily-${b.key.slice(0, 16)}-end-b`, op.signal));
      const shellsB = await step(checkNoRunningShells(b, ports.native, op.signal));
      const quietCounter = counter;
      const late = quietCounter !== sealed.sealCounter;
      const sourceMismatchB = snapB.state === 'UNAVAILABLE'
        && (snapB.reason === 'WORKSPACE_MISMATCH' || snapB.reason === 'SESSION_MISMATCH') ? snapB.reason : null;
      if (changes.state === 'VALID' && sourceMismatchB !== null) {
        changes = unavailable(sourceMismatchB);
      } else if (changes.state === 'VALID' && (late || shellsB.state !== 'OK' || overLimit)) {
        changes = unavailable(late ? 'LATE_OBSERVATION' : shellsB.state !== 'OK' ? shellsB.reason : 'OBSERVATION_LIMIT');
      }

      const concurrentAtEvaluation = concurrentFinish;
      const uncertain: DailyReason[] = [...sealed.preReasons];
      if (shellsA.state !== 'OK') uncertain.push(shellsA.reason);
      if (shellsB.state !== 'OK') uncertain.push(shellsB.reason);
      if (concurrentAtEvaluation) uncertain.push('BOUNDARY_UNCERTAIN');
      if (late) uncertain.push('LATE_OBSERVATION');
      if (overLimit) uncertain.push('OBSERVATION_LIMIT');
      let evidence: DailyEvidenceResult;
      let bounded = false;
      if (snapA.state === 'REJECTED') evidence = snapA;
      else if (snapB.state === 'REJECTED') evidence = snapB;
      else if (snapA.state !== 'READY') evidence = unavailable(snapA.reason);
      else if (snapB.state !== 'READY') evidence = unavailable(snapB.reason);
      else {
        const check = checkFinishBoundary(snapA.snapshot, snapB.snapshot, sealed.epoch);
        if (check.state !== 'BOUNDED') uncertain.push(check.reason);
        bounded = uncertain.length === 0;
        evidence = bounded ? collectDailyNativeEvidence(b, snapB.snapshot, sealed.epoch) : unavailable(uncertain[0]!);
      }
      const boundary: DailyBoundary = bounded ? 'BOUNDED' : 'UNCERTAIN';

      let report = await step(ports.diagnose(b, evidence, changes, boundary, ports.preflight, op.signal));
      // Late work after the quiet proof: Native evidence is withdrawn; Git validity was established earlier.
      if (counter !== quietCounter) report = markDailyBoundaryUncertain(report, 'LATE_OBSERVATION');
      if (concurrentFinish && !concurrentAtEvaluation) report = markDailyBoundaryUncertain(report, 'BOUNDARY_UNCERTAIN');
      if (!skillReady()) report = markDailyBoundaryUncertain(report, 'SKILL_UNSUPPORTED');
      const s = stop();
      if (s !== null) throw new Halt(s);
      return publish(report);
    } catch (e) {
      const reason = e instanceof Halt ? e.reason : 'DIAGNOSTIC_UNAVAILABLE';
      if (lifecycle === 'DISPOSED' || reason === 'DISPOSED') return makeDailyUnavailable('DISPOSED');
      return publish(makeDailyUnavailable(reason));
    } finally {
      op.dispose();
    }
  }

  function startFinish(bindingKey: string, id: CallIdentity, signal: AbortSignal): Promise<DailyAdvisoryReport> {
    const b = binding;
    if (b === null || beginCall === null || bindingKey !== b.key) return Promise.resolve(makeDailyUnavailable('BINDING_KEY_MISMATCH'));
    // Seal synchronously before any read.
    lifecycle = 'FINISHING';
    const own = keyOf(id);
    finishKeys = new Set([own]);
    concurrentFinish = false;
    const beginRecord = calls.get(keyOf(beginCall));
    const finishRecord = calls.get(own);
    const others = [...active].filter(k => k !== own);
    const inFlight = others.some(k => calls.get(k)?.control !== true);
    const preReasons: DailyReason[] = [...taints];
    if (beginRecord?.after?.status !== 'COMPLETED') preReasons.push('BOUNDARY_UNCERTAIN');
    if (finishRecord === undefined || finishRecord.tool !== CONTROL_FINISH || finishRecord.before === null || finishRecord.after !== null) preReasons.push('NOT_OBSERVED');
    if (inFlight) preReasons.push('TOOL_IN_FLIGHT');
    if (others.some(k => calls.get(k)?.control === true)) preReasons.push('BOUNDARY_UNCERTAIN');
    if (!skillReady()) preReasons.push('SKILL_UNSUPPORTED');
    const sealed: Sealed = Object.freeze({
      binding: b, sealCounter: counter, inFlight, preReasons: Object.freeze([...new Set(preReasons)]),
      epoch: Object.freeze({begin: beginCall, finish: id, prefixMessageIds: prefix, observations: Object.freeze([...epochObservations])}),
    });
    const op = createOperation(lifetime.signal, signal, FINISH_DEADLINE_MS);
    finishOp = op;
    finishPromise = runFinish(sealed, op);
    return finishPromise;
  }

  function joinFinish(bindingKey: string, id: CallIdentity, signal: AbortSignal): Promise<DailyAdvisoryReport> {
    if (binding === null || bindingKey !== binding.key || finishPromise === null || finishOp === null) {
      return Promise.resolve(makeDailyUnavailable('BINDING_KEY_MISMATCH'));
    }
    const key = keyOf(id);
    if (!finishKeys.has(key)) {concurrentFinish = true; finishKeys.add(key);}
    finishOp.follow(signal); // a matching waiter may cancel the shared operation
    return finishPromise;
  }

  function terminalLookup(bindingKey: string, signal: AbortSignal): Promise<DailyAdvisoryReport> {
    const t = terminal;
    const b = binding;
    if (t === null) return Promise.resolve(makeDailyUnavailable('DIAGNOSTIC_UNAVAILABLE'));
    if (b === null) return Promise.resolve(t.report); // no established binding: only the safe unavailable result
    if (bindingKey !== b.key) return Promise.resolve(makeDailyUnavailable('BINDING_KEY_MISMATCH'));
    if (t.invalidated) return Promise.resolve(makeDailyUnavailable('BINDING_INVALID'));
    const op = createOperation(lifetime.signal, signal, FINISH_DEADLINE_MS);
    return (async (): Promise<DailyAdvisoryReport> => {
      try {
        // RG-001: full T1 revalidation (Owner package/digest, runtime, manifest/intent, selected Artifact
        // bytes, Scope Policy) against the current fixed supply. No Native/Git read, no diagnosis.
        const verified = await op.race(verifyDailyBinding(b, ports.preflight, op.signal));
        if (lifecycle === 'DISPOSED') return makeDailyUnavailable('DISPOSED');
        if (verified === ABORTED || op.signal.aborted) return makeDailyUnavailable(op.reason());
        if (verified.state !== 'OK') {
          if (verified.reason === 'ABORTED') return makeDailyUnavailable('ABORTED');
          t.invalidated = true;
          return makeDailyUnavailable('BINDING_INVALID');
        }
        if (t.invalidated || terminal !== t) return makeDailyUnavailable('BINDING_INVALID');
        return t.report;
      } catch {
        return makeDailyUnavailable('BINDING_INVALID');
      } finally {
        op.dispose();
      }
    })();
  }

  function finish(bindingKey: string, call: BoundaryCall): Promise<DailyAdvisoryReport> {
    try {
      if (lifecycle === 'DISPOSED') return Promise.resolve(makeDailyUnavailable('DISPOSED'));
      const id = identityOf(call);
      if (id === null) return Promise.resolve(makeDailyUnavailable('IDENTITY_UNMATCHED'));
      if (id.sessionId !== sessionId) return Promise.resolve(makeDailyUnavailable('SESSION_MISMATCH'));
      if (typeof bindingKey !== 'string' || !KEY_PATTERN.test(bindingKey)) return Promise.resolve(makeDailyUnavailable('BINDING_KEY_MISMATCH'));
      switch (lifecycle) {
        case 'ARMED': return Promise.resolve(makeDailyUnavailable('NOT_OBSERVED'));
        case 'STARTING': return Promise.resolve(makeDailyUnavailable('BUSY'));
        case 'ACTIVE': return startFinish(bindingKey, id, call.signal);
        case 'FINISHING': return joinFinish(bindingKey, id, call.signal);
        case 'TERMINAL': return terminalLookup(bindingKey, call.signal);
      }
    } catch {
      return Promise.resolve(makeDailyUnavailable('DIAGNOSTIC_UNAVAILABLE'));
    }
  }

  function dispose(): void {
    try {
      lifecycle = 'DISPOSED';
      lifetime.abort();
    } finally {
      calls.clear();
      active.clear();
      epochObservations = [];
      taints.length = 0;
      binding = null;
      terminal = null;
      finishKeys = new Set();
      beginCall = null;
      prefix = [];
    }
  }

  return Object.freeze({
    getState: (): DailyLifecycle => lifecycle,
    isActive: (id: string): boolean => lifecycle === 'ACTIVE' && id === sessionId,
    begin, observe, finish, dispose,
  });
}

// ---------------------------------------------------------------------------
// Production Owner supply (fixed root + fixed env only)
// ---------------------------------------------------------------------------

/** Bounded streaming read of a fixed path; abort is checked around every chunk. */
async function readFixed(path: string, maxBytes: number, signal: AbortSignal, onChunk: (chunk: Uint8Array) => void): Promise<void> {
  if (signal.aborted) throw new Error('aborted');
  const handle = await open(path, 'r');
  try {
    const buffer = new Uint8Array(READ_CHUNK);
    let total = 0;
    for (;;) {
      if (signal.aborted) throw new Error('aborted');
      const {bytesRead} = await handle.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) return;
      total += bytesRead;
      if (total > maxBytes) throw new Error('over_limit');
      onChunk(buffer.subarray(0, bytesRead));
    }
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/** Exact mountpoint, `ro` per-mount flag, no stacked/nested mounts, real non-symlink directory. */
async function verifyOwnerMount(signal: AbortSignal): Promise<CheckResult> {
  const bad = unavailable('OWNER_BOUNDARY_UNVERIFIED');
  try {
    const chunks: Uint8Array[] = [];
    await readFixed(MOUNTINFO_PATH, MOUNTINFO_MAX_BYTES, signal, c => {chunks.push(Uint8Array.from(c));});
    if (signal.aborted) return unavailable('ABORTED');
    const text = new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks));
    let exact = 0, ro = false;
    for (const line of text.split('\n')) {
      if (line === '') continue;
      const fields = line.split(' ');
      const mountPoint = fields[4], options = fields[5];
      if (mountPoint === undefined || options === undefined) return bad;
      if (mountPoint === DAILY_OWNER_ROOT) {exact += 1; ro = options.split(',').includes('ro');}
      else if (mountPoint.startsWith(`${DAILY_OWNER_ROOT}/`)) return bad;
    }
    if (exact !== 1 || !ro) return bad;
    if (await realpath(DAILY_OWNER_ROOT) !== DAILY_OWNER_ROOT) return bad;
    const st = await lstat(DAILY_OWNER_ROOT);
    if (st.isSymbolicLink() || !st.isDirectory()) return bad;
    return signal.aborted ? unavailable('ABORTED') : OK;
  } catch {
    return signal.aborted ? unavailable('ABORTED') : bad;
  }
}

function createOwnerConfigReadPort(): OwnerConfigReadPort {
  const reader = createS1aReadOnlySource();
  return Object.freeze({
    verifyReadOnlyMount: (signal: AbortSignal): Promise<CheckResult> => verifyOwnerMount(signal),
    async readApproval(maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
      if ((await verifyOwnerMount(signal)).state !== 'OK' || signal.aborted) throw new Error('unverified');
      const bytes = await reader.readInputFile(APPROVAL_PATH, Math.min(maxBytes, APPROVAL_MAX_BYTES));
      if (signal.aborted || (await verifyOwnerMount(signal)).state !== 'OK') throw new Error('unverified');
      return bytes;
    },
  });
}

/** The existing bounded reader constrained to the fixed manifest/intent/artifacts paths. */
function createOwnerSource(): S1aReadOnlySource {
  const reader = createS1aReadOnlySource();
  return Object.freeze({
    async readInputFile(path: string, maxBytes: number): Promise<Uint8Array> {
      if (path !== MANIFEST_PATH && path !== INTENT_PATH) throw new Error('unreadable');
      return reader.readInputFile(path, maxBytes);
    },
    async readArtifact(root: string, relativePath: string, maxBytes: number): Promise<Uint8Array> {
      if (root !== ARTIFACTS_ROOT) throw new Error('unreadable');
      return reader.readArtifact(root, relativePath, maxBytes);
    },
  });
}

async function hashExecutable(parent: AbortSignal): Promise<string | null> {
  const ctl = new AbortController();
  const onAbort = (): void => ctl.abort();
  parent.addEventListener('abort', onAbort, {once: true});
  const timer = setTimeout(() => ctl.abort(), EXE_DEADLINE_MS);
  try {
    if (parent.aborted) return null;
    const hash = createHash('sha256');
    await readFixed(EXE_PATH, EXE_MAX_BYTES, ctl.signal, c => {hash.update(c);});
    return ctl.signal.aborted ? null : hash.digest('hex');
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    parent.removeEventListener('abort', onAbort);
  }
}

const readApprovalEnv = (): string | undefined => {
  const value = typeof process === 'undefined' ? undefined : process.env[DAILY_APPROVAL_ENV];
  return typeof value === 'string' ? value : undefined;
};
const insideOwnerRoot = (path: string): boolean =>
  path === DAILY_OWNER_ROOT || path.startsWith(`${DAILY_OWNER_ROOT}/`) || DAILY_OWNER_ROOT.startsWith(`${path}/`);

export async function createProductionDailyPorts(context:DailyPluginContext):Promise<DailyRuntimeResult> {
  // Captured synchronously: the fixed env is the only opt-in; context options never select a provider.
  const captured = readApprovalEnv();
  if (captured === undefined) return off('NOT_OPTED_IN');
  if (!isLowercaseSha256Hex(captured)) return off('APPROVAL_INVALID');
  let directory: string | null = null;
  try {
    const d = field(field(context, 'location'), 'directory');
    directory = typeof d === 'string' && d.length > 0 ? d : null;
  } catch {
    directory = null;
  }
  const setup = new AbortController();
  let expired = false;
  let resolveTimeout: (result: DailyRuntimeResult) => void = () => undefined;
  const timeout = new Promise<DailyRuntimeResult>(resolve => {resolveTimeout = resolve;});
  const timer = setTimeout(() => {
    expired = true;
    setup.abort();
    resolveTimeout(off('TIMEOUT'));
  }, SETUP_DEADLINE_MS);
  const setupWork = async (): Promise<DailyRuntimeResult> => {
    try {
      const ownerPort = createOwnerConfigReadPort();
      const loaded = await loadDailyOwnerConfig(captured, ownerPort, setup.signal);
      if (setup.signal.aborted) return off(expired ? 'TIMEOUT' : 'ABORTED');
      if (loaded.state !== 'READY') return off(loaded.reason);
      const setupConfig = loaded.config;
      const git = createDailyGitReadPort(setupConfig);
      const native = createNativeReadPort(setupConfig);
      const sameConfig = (c: DailyOwnerConfig): boolean => c === setupConfig || JSON.stringify(c) === JSON.stringify(setupConfig);

      const preflight: DailyPreflightPorts = Object.freeze({
        async reloadOwnerConfig(signal: AbortSignal): Promise<DailyConfigResult> {
          if (readApprovalEnv() !== captured) return Object.freeze({state: 'OFF' as const, reason: 'APPROVAL_DIGEST_MISMATCH' as const});
          return loadDailyOwnerConfig(captured, ownerPort, signal);
        },
        source: createOwnerSource(),
        async verifyRuntime(config: DailyOwnerConfig, signal: AbortSignal): Promise<CheckResult> {
          try {
            if (signal.aborted) return unavailable('ABORTED');
            if (readApprovalEnv() !== captured || config.approvalSha256 !== captured) return unavailable('APPROVAL_DIGEST_MISMATCH');
            if (!sameConfig(config)) return unavailable('BINDING_INVALID');
            if ((await verifyOwnerMount(signal)).state !== 'OK') return unavailable(signal.aborted ? 'ABORTED' : 'OWNER_BOUNDARY_UNVERIFIED');
            if (config.approval.hostBinarySha256 !== DAILY_HOST_SHA256 || typeof process === 'undefined' || process.platform !== 'linux') {
              return unavailable('HOST_MISMATCH');
            }
            const root = config.approval.worktreeRoot;
            if (insideOwnerRoot(root)) return unavailable('OWNER_BOUNDARY_UNVERIFIED');
            if (directory === null) return unavailable('WORKSPACE_MISMATCH');
            let resolved: string;
            try {resolved = await realpath(directory);} catch {return unavailable(signal.aborted ? 'ABORTED' : 'WORKSPACE_MISMATCH');}
            if (signal.aborted) return unavailable('ABORTED');
            if (resolved !== root) return unavailable('WORKSPACE_MISMATCH');
            const exe = await hashExecutable(signal);
            if (signal.aborted) return unavailable('ABORTED');
            if (exe === null || exe !== DAILY_HOST_SHA256 || exe !== config.approval.hostBinarySha256) return unavailable('HOST_MISMATCH');
            return OK;
          } catch {
            return unavailable(signal.aborted ? 'ABORTED' : 'HOST_MISMATCH');
          }
        },
        async checkCleanBase(config: DailyOwnerConfig, signal: AbortSignal): Promise<CheckResult> {
          if (!sameConfig(config)) return unavailable('BINDING_INVALID');
          return checkCleanBase(config, git, signal);
        },
      });

      const runtime = await preflight.verifyRuntime(setupConfig, setup.signal);
      if (setup.signal.aborted) return off(expired ? 'TIMEOUT' : 'ABORTED');
      if (runtime.state !== 'OK') return off(runtime.reason);
      let ready = false;
      const ports: DailyCoordinatorPorts = Object.freeze({
        config: setupConfig, preflight, native, git,
        isSkillReady: (): boolean => ready,
        diagnose: runDailyAdvisory,
      });
      return Object.freeze({state: 'READY' as const, ports, markSkillReady: (value: boolean): void => {ready = value === true;}});
    } catch {
      return off(expired ? 'TIMEOUT' : 'SETUP_FAILED');
    }
  };
  try {
    return await Promise.race([setupWork(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// SDK registration
// ---------------------------------------------------------------------------

const toolResult = (value: unknown): {readonly content: string} => ({content: JSON.stringify(value)});

function boundaryCallOf(context: unknown): BoundaryCall | null {
  const sessionId = field(context, 'sessionID'), messageId = field(context, 'messageID'), callId = field(context, 'id');
  const agent = field(context, 'agent');
  // `signal` may be an accessor on the real ToolContext (reading it opts into cooperative stop).
  let signal: unknown;
  try {signal = isRecord(context) ? (context as {signal?: unknown}).signal : undefined;} catch {signal = undefined;}
  const call = {sessionId, messageId, callId, agent, signal};
  return identityOf(call) === null ? null : Object.freeze(call as BoundaryCall);
}
const isEmptyObject = (v: unknown): boolean =>
  isRecord(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null) && Reflect.ownKeys(v).length === 0;
function bindingKeyOf(v: unknown): string | null {
  if (!isRecord(v) || (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null)) return null;
  const keys = Reflect.ownKeys(v);
  if (keys.length !== 1 || keys[0] !== 'bindingKey') return null;
  const key = field(v, 'bindingKey');
  return typeof key === 'string' && KEY_PATTERN.test(key) ? key : null;
}

function defineBoundaryTools(coordinator: DailyCoordinator): readonly DailyToolInfo[] {
  const begin: DailyToolInfo = Object.freeze({
    name: CONTROL_BEGIN,
    description: 'Justice Daily Assurance: mark the start of the Owner-approved inline Task (advisory only).',
    input: BEGIN_INPUT,
    options: DIRECT_OPTIONS,
    execute: async (input: unknown, context: DailyToolContextLike): Promise<{readonly content: string}> => {
      try {
        if (!isEmptyObject(input)) return toolResult(unavailable('BINDING_INVALID'));
        const call = boundaryCallOf(context);
        if (call === null) return toolResult(unavailable('IDENTITY_UNMATCHED'));
        return toolResult(await coordinator.begin(call));
      } catch {
        return toolResult(unavailable('SETUP_FAILED'));
      }
    },
  });
  const finish: DailyToolInfo = Object.freeze({
    name: CONTROL_FINISH,
    description: 'Justice Daily Assurance: bounded advisory at the existing task-done candidate boundary (never a formal PASS).',
    input: FINISH_INPUT,
    options: DIRECT_OPTIONS,
    execute: async (input: unknown, context: DailyToolContextLike): Promise<{readonly content: string}> => {
      try {
        const key = bindingKeyOf(input);
        if (key === null) return toolResult(makeDailyUnavailable('BINDING_KEY_MISMATCH'));
        const call = boundaryCallOf(context);
        if (call === null) return toolResult(makeDailyUnavailable('IDENTITY_UNMATCHED'));
        return toolResult(await coordinator.finish(key, call));
      } catch {
        return toolResult(makeDailyUnavailable('DIAGNOSTIC_UNAVAILABLE'));
      }
    },
  });
  return Object.freeze([begin, finish]);
}

const INVALID_OBSERVATION = Object.freeze({sessionId: '', messageId: '', callId: '', tool: '', phase: 'BEFORE', status: 'STARTED', ruleId: null}) as unknown as NativeObservation;

/** Copies only sessionID/messageID/id/tool (+status) from the SDK payload; raw input is compared, never kept. */
function observeHook(coordinator: DailyCoordinator, config: DailyOwnerConfig, input: unknown, phase: 'BEFORE' | 'AFTER'): void {
  try {
    const sessionId = field(input, 'sessionID'), messageId = field(input, 'messageID'), callId = field(input, 'id'), tool = field(input, 'tool');
    if (typeof sessionId !== 'string' || typeof messageId !== 'string' || typeof callId !== 'string' || typeof tool !== 'string') {
      coordinator.observe(INVALID_OBSERVATION);
      return;
    }
    let status: unknown = 'STARTED';
    if (phase === 'AFTER') {
      const raw = field(input, 'status');
      status = raw === 'completed' ? 'COMPLETED' : raw === 'error' ? 'ERROR' : 'INVALID';
    }
    const state = coordinator.getState();
    const ruleId = tool === 'shell' && (state === 'ACTIVE' || state === 'FINISHING')
      ? matchRuleInput(config.approval.rules, 'shell', field(input, 'input')) : null;
    coordinator.observe({sessionId, messageId, callId, tool, phase, status, ruleId} as NativeObservation);
  } catch {
    try {coordinator.observe(INVALID_OBSERVATION);} catch {/* never throw to cancel Host execution */}
  }
}

/**
 * Skill delivery boundary (issue #401). OpenCode v2.3.2 rebuilds Skill State by replaying transforms in registration
 * order, and package plugins register BEFORE the internal `ConfigSkillPlugin` that adds config Skills, so a
 * `skill.transform` edit never sees the approved Skill. Instead the fixed append is applied to the result the built-in
 * `skill` tool hands to the model (`tool.hook("execute.after")`, `result` is mutable), after re-verifying the Skill
 * identity (id + name + path + content digest) from the Host's final Skill list. Readiness is set only when the
 * append was applied to the delivered text. Anything unverifiable keeps (or sets) readiness false.
 */
const SKILL_TOOL = 'skill';
const SKILL_CLOSE = '\n</skill_content>';

async function applySkillDelivery(
  input: unknown, config: DailyOwnerConfig, listSkills: () => Promise<unknown>,
  markSkillReady: (ready: boolean) => void, isClosed: () => boolean,
): Promise<void> {
  const mark = (ready: boolean): void => {if (!isClosed()) {try {markSkillReady(ready);} catch {/* readiness stays as-is */}}};
  try {
    if (field(input, 'tool') !== SKILL_TOOL) return;
    // Session attribution: only the Owner-approved Session may deliver, list, or change readiness.
    const sessionId = field(input, 'sessionID');
    if (typeof sessionId !== 'string' || sessionId === '' || sessionId !== config.approval.sessionId) return;
    const want = config.approval.skill;
    if (field(field(input, 'input'), 'id') !== want.id) return; // unapproved Skills are never touched
    if (field(input, 'status') !== 'completed') {mark(false); return;}
    const listed = await listSkills();
    const data = Array.isArray(listed) ? listed : field(listed, 'data');
    if (!Array.isArray(data)) {mark(false); return;}
    const matches = data.filter(s => field(s, 'id') === want.id);
    if (matches.length !== 1) {mark(false); return;}
    const skill = matches[0], skillContent = field(skill, 'content');
    if (field(skill, 'name') !== want.name || field(skill, 'path') !== want.path || typeof skillContent !== 'string'
      || sha(skillContent) !== want.contentSha256) {mark(false); return;}
    // v2.3.2 runtime.ts normalizeContent runs before execute.after: content is Tool.Content[] (one text element for
    // the built-in skill tool) and output.content carries the same text. A raw string or anything ambiguous is untrusted.
    const result = field(input, 'result');
    const parts = field(result, 'content');
    const output = field(result, 'output');
    if (!Array.isArray(parts) || parts.length !== 1 || typeof output !== 'object' || output === null) {mark(false); return;}
    const part = parts[0];
    const delivered = field(part, 'text');
    if (field(part, 'type') !== 'text' || typeof delivered !== 'string' || field(output, 'content') !== delivered
      || !delivered.startsWith(`<skill_content name="${want.name}">`) || !delivered.endsWith(SKILL_CLOSE)
      || !delivered.includes(skillContent.trim())) {mark(false); return;}
    if (isClosed()) return;
    if (delivered.includes(DAILY_SKILL_APPEND)) {mark(countOf(delivered, DAILY_SKILL_APPEND) === 1); return;}
    const next = delivered.slice(0, -SKILL_CLOSE.length) + SKILL_SUFFIX + SKILL_CLOSE;
    (input as {result: unknown}).result = {
      ...result as Record<string, unknown>,
      content: [{...part as Record<string, unknown>, text: next}],
      output: {...output as Record<string, unknown>, content: next},
    };
    const back = field(input, 'result');
    const backParts = field(back, 'content');
    mark(Array.isArray(backParts) && backParts.length === 1 && field(backParts[0], 'text') === next
      && field(field(back, 'output'), 'content') === next);
  } catch {
    mark(false);
  }
}

function countOf(text: string, part: string): number {
  let n = 0;
  for (let i = text.indexOf(part); i !== -1; i = text.indexOf(part, i + part.length)) n++;
  return n;
}

type HandleName = 'before' | 'after' | 'tool' | 'skill';
const DISPOSE_ORDER: readonly HandleName[] = ['skill', 'tool', 'after', 'before'];

export async function registerDailyAssurance(
  context:DailyPluginContext, runtime:Extract<DailyRuntimeResult,{state:"READY"}>
):Promise<Readonly<{state:"REGISTERED";dispose:()=>Promise<void>}>|Readonly<{state:"OFF";reason:DailyReason}>> {
  let coordinator: DailyCoordinator;
  try {
    coordinator = createDailyCoordinator(runtime.ports);
  } catch {
    return Object.freeze({state: 'OFF' as const, reason: 'SETUP_FAILED' as const});
  }
  const config = runtime.ports.config;
  const handles: Partial<Record<HandleName, DailyRegistration>> = {};
  /** Coordinator DISPOSED first, then each acquired handle exactly once in inverse order; best effort. */
  let closed = false;
  const disposeAll = async (): Promise<boolean> => {
    let clean = true;
    closed = true;
    try {coordinator.dispose();} catch {clean = false;}
    try {runtime.markSkillReady(false);} catch {clean = false;}
    for (const name of DISPOSE_ORDER) {
      const handle = handles[name];
      if (handle === undefined) continue;
      delete handles[name];
      try {await handle.dispose();} catch {clean = false;}
    }
    return clean;
  };
  try {
    handles.before = await context.tool.hook('execute.before', (input: unknown): void => observeHook(coordinator, config, input, 'BEFORE'));
    handles.after = await context.tool.hook('execute.after', (input: unknown): void => observeHook(coordinator, config, input, 'AFTER'));
    const tools = defineBoundaryTools(coordinator);
    handles.tool = await context.tool.transform((editor: DailyToolEditorLike): void => {
      for (const tool of tools) editor.add(tool);
    });
    handles.skill = await context.tool.hook('execute.after', (input: unknown): Promise<void> =>
      applySkillDelivery(input, config, () => context.skill.list(), runtime.markSkillReady, () => closed));
  } catch {
    const clean = await disposeAll();
    return Object.freeze({state: 'OFF' as const, reason: clean ? 'SETUP_FAILED' as const : 'CLEANUP_FAILED' as const});
  }
  let disposed: Promise<void> | null = null;
  return Object.freeze({
    state: 'REGISTERED' as const,
    dispose: (): Promise<void> => {
      // Cleanup failure stays an internal fixed-code status (no model-facing channel is claimed).
      disposed ??= disposeAll().then(() => undefined, () => undefined);
      return disposed;
    },
  });
}
