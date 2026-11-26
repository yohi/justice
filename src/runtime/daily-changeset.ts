import {spawn,type ChildProcess,type SpawnOptions} from 'node:child_process';
import {lstat,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {isSafeIdentifier} from '../core/s1a/contract.js';
import type {ChangeSet,ChangedPath} from '../core/s1c/contract.js';
import {inspectChangeSet} from '../core/s1c/path-rules.js';
import {compareUtf8} from '../core/s1c/shared-utils.js';
import type {CheckResult,DailyBinding,DailyOwnerConfig,DailyReason,Unavailable} from './daily-intent.js';

export type GitReadResult = Readonly<{state: "OK"; exitCode: number; stdout: Uint8Array}> | Unavailable;
export interface DailyGitReadPort {
  run(args: readonly string[], maxBytes: number, signal: AbortSignal): Promise<GitReadResult>;
}
export type DailyChangeSetResult = Readonly<{
  state: "VALID"; changeSet: Extract<ChangeSet, {availability: "PRESENT"}>;
  baseCommit: string; headCommit: string;
}> | Unavailable;
/** Process launcher seam (tests only); the binary path, prefix and env are fixed by this module. */
export type GitSpawner = (file: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

const GIT_BINARY = '/usr/bin/git';
const GIT_ENV: Readonly<Record<string, string>> = Object.freeze({
  PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
  // GIT_NO_REPLACE_OBJECTS: refs/replace must never rewrite the history ls-tree/diff report.
  GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1', LC_ALL: 'C',
});
const MAX_STDOUT_BYTES = 1_048_576;
const MAX_STDERR_BYTES = 1_048_576;
const PROCESS_TIMEOUT_MS = 5_000;
const SNAPSHOT_DEADLINE_MS = 30_000;
const MAX_ENTRIES = 128;
const MAX_JSON_BYTES = 262_144;
const SHA1_HEX = /^[0-9a-f]{40}$/;
const SUPPORTED_MODES = new Set(['100644', '100755']);
const PORT_REASONS = new Set<DailyReason>(['GIT_UNAVAILABLE', 'GIT_UNSTABLE', 'GIT_UNSUPPORTED', 'GIT_LIMIT', 'ABORTED', 'TIMEOUT']);

const DIFF_FLAGS = ['--name-status', '-z', '--no-renames', '--no-ext-diff', '--no-textconv'] as const;
const CMD = Object.freeze({
  toplevel: ['rev-parse', '--show-toplevel'],
  format: ['rev-parse', '--show-object-format'],
  config: ['config', '--local', '--no-includes', '--null', '--list'],
  head: ['rev-parse', '--verify', 'HEAD'],
  status: ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none'],
  stage: ['ls-files', '--stage', '-z'],
  flags: ['ls-files', '-v', '-z'],
  untracked: ['ls-files', '--others', '--exclude-standard', '-z'],
  unstaged: ['diff', ...DIFF_FLAGS, '--'],
} as const);
const ancestryArgs = (base: string, head: string): readonly string[] => ['merge-base', '--is-ancestor', base, head];
const treeArgs = (rev: string): readonly string[] => ['ls-tree', '-r', '-z', rev];
const committedArgs = (base: string, head: string): readonly string[] => ['diff', ...DIFF_FLAGS, base, head, '--'];
const stagedArgs = (head: string): readonly string[] => ['diff', '--cached', ...DIFF_FLAGS, head, '--'];

const unavailable = (reason: DailyReason): Unavailable => Object.freeze({state: 'UNAVAILABLE' as const, reason});
const ok: CheckResult = Object.freeze({state: 'OK' as const});
class Stop extends Error {constructor(readonly reason: DailyReason) {super(reason);}}
const stop = (reason: DailyReason): never => {throw new Stop(reason);};
const sameArgs = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);
const isSha1 = (v: unknown): v is string => typeof v === 'string' && SHA1_HEX.test(v);

/** Snapshot argv into a fresh array of strings; anything else is rejected. */
function snapshotArgs(args: unknown): string[] | null {
  if (!Array.isArray(args) || args.length > 16) return null;
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const v: unknown = (args as unknown[])[i];
    if (typeof v !== 'string') return null;
    out.push(v);
  }
  return out;
}

function isAllowedArgv(args: readonly string[], base: string): boolean {
  if (Object.values(CMD).some(c => sameArgs(args, c))) return true;
  const [a0, a1, a2, a3] = [args[0], args[1], args[2], args[3]];
  if (args.length === 4 && a0 === 'merge-base' && a1 === '--is-ancestor' && a2 === base && isSha1(a3)) return true;
  if (args.length === 4 && a0 === 'ls-tree' && a1 === '-r' && a2 === '-z' && (a3 === base || isSha1(a3))) return true;
  if (args.length === 9 && sameArgs(args.slice(0, 6), ['diff', ...DIFF_FLAGS]) && args[6] === base && isSha1(args[7]) && args[8] === '--') return true;
  if (args.length === 9 && sameArgs(args.slice(0, 7), ['diff', '--cached', ...DIFF_FLAGS]) && isSha1(args[7]) && args[8] === '--') return true;
  return false;
}

/**
 * Fixed read-only Git port with an injectable launcher (test seam). No shell, fixed binary,
 * fixed `-C <Owner root>` prefix, fixed environment, allowlisted argv only.
 */
export function createDailyGitReadPortWithSpawner(config: DailyOwnerConfig, spawner: GitSpawner): DailyGitReadPort {
  const root = config.approval.worktreeRoot;
  const base = config.approval.baseCommit;
  // diff.autoRefreshIndex=false: porcelain `git diff` would otherwise rewrite .git/index for
  // stat-dirty files even with GIT_OPTIONAL_LOCKS=0 (no Git writes allowed).
  const prefix = Object.freeze(['-C', root, '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'diff.autoRefreshIndex=false']);
  return Object.freeze({
    run(args: readonly string[], maxBytes: number, signal: AbortSignal): Promise<GitReadResult> {
      return new Promise<GitReadResult>((resolve) => {
        if (signal.aborted) {resolve(unavailable('ABORTED')); return;}
        const argv = snapshotArgs(args);
        if (argv === null || !isAllowedArgv(argv, base) || !isSha1(base)
          || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_STDOUT_BYTES) {
          resolve(unavailable('GIT_UNSUPPORTED')); return;
        }
        let child: ChildProcess;
        try {
          child = spawner(GIT_BINARY, [...prefix, ...argv], {
            env: {...GIT_ENV}, shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
          });
        } catch {
          resolve(unavailable('GIT_UNAVAILABLE')); return;
        }
        let done = false;
        const chunks: Buffer[] = [];
        let outBytes = 0, errBytes = 0;
        const finish = (result: GitReadResult, kill: boolean): void => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          // Terminate only the launched child, by handle.
          if (kill) {try {child.kill('SIGKILL');} catch {/* already gone */}}
          resolve(result);
        };
        const onAbort = (): void => finish(unavailable('ABORTED'), true);
        const timer = setTimeout(() => finish(unavailable('TIMEOUT'), true), PROCESS_TIMEOUT_MS);
        signal.addEventListener('abort', onAbort, {once: true});
        if (child.stdout === null || child.stderr === null) {finish(unavailable('GIT_UNAVAILABLE'), true); return;}
        child.stdout.on('data', (chunk: unknown) => {
          if (done) return;
          if (!Buffer.isBuffer(chunk)) {finish(unavailable('GIT_UNAVAILABLE'), true); return;}
          outBytes += chunk.byteLength;
          if (outBytes > maxBytes) {finish(unavailable('GIT_LIMIT'), true); return;}
          chunks.push(chunk);
        });
        child.stderr.on('data', (chunk: unknown) => {
          // Drained and discarded; bounded.
          if (done) return;
          errBytes += Buffer.isBuffer(chunk) ? chunk.byteLength : 0;
          if (errBytes > MAX_STDERR_BYTES) finish(unavailable('GIT_LIMIT'), true);
        });
        child.on('error', () => finish(unavailable('GIT_UNAVAILABLE'), true));
        child.on('close', (code: unknown) => {
          if (typeof code !== 'number' || !Number.isInteger(code)) {finish(unavailable('GIT_UNAVAILABLE'), false); return;}
          finish(Object.freeze({state: 'OK' as const, exitCode: code, stdout: new Uint8Array(Buffer.concat(chunks))}), false);
        });
      });
    },
  });
}

/** Production port: fixed `/usr/bin/git` launched via node:child_process without a shell. */
export function createDailyGitReadPort(config: DailyOwnerConfig): DailyGitReadPort {
  return createDailyGitReadPortWithSpawner(config, spawn as GitSpawner);
}

type Ctx = Readonly<{git: DailyGitReadPort; signal: AbortSignal; abortReason: () => DailyReason}>;

async function withDeadline<T>(git: DailyGitReadPort, parent: AbortSignal, fn: (ctx: Ctx) => Promise<T>): Promise<T | Unavailable> {
  if (parent.aborted) return unavailable('ABORTED');
  const ctl = new AbortController();
  let expired = false;
  const timer = setTimeout(() => {expired = true; ctl.abort();}, SNAPSHOT_DEADLINE_MS);
  const onAbort = (): void => ctl.abort();
  parent.addEventListener('abort', onAbort, {once: true});
  const abortReason = (): DailyReason => parent.aborted ? 'ABORTED' : expired ? 'TIMEOUT' : 'ABORTED';
  try {
    const value = await fn({git, signal: ctl.signal, abortReason});
    if (ctl.signal.aborted) return unavailable(abortReason());
    return value;
  } catch (e) {
    if (ctl.signal.aborted) return unavailable(abortReason());
    return unavailable(e instanceof Stop ? e.reason : 'GIT_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
    parent.removeEventListener('abort', onAbort);
  }
}

/** One bounded port call; races cancellation so a non-cooperative port cannot hang the snapshot. */
async function call(ctx: Ctx, args: readonly string[]): Promise<Readonly<{exitCode: number; stdout: Uint8Array}>> {
  if (ctx.signal.aborted) stop(ctx.abortReason());
  let removeAbort = (): void => {};
  const aborted = new Promise<'ABORTED'>((resolve) => {
    const onAbort = (): void => resolve('ABORTED');
    ctx.signal.addEventListener('abort', onAbort, {once: true});
    removeAbort = () => ctx.signal.removeEventListener('abort', onAbort);
  });
  let raw: unknown;
  try {
    raw = await Promise.race([ctx.git.run(args, MAX_STDOUT_BYTES, ctx.signal), aborted]);
  } catch {
    return stop(ctx.signal.aborted ? ctx.abortReason() : 'GIT_UNAVAILABLE');
  } finally {
    removeAbort();
  }
  if (ctx.signal.aborted) stop(ctx.abortReason());
  if (raw === null || typeof raw !== 'object') return stop('GIT_UNAVAILABLE');
  const r = raw as Record<string, unknown>;
  if (r.state === 'UNAVAILABLE') {
    const reason = r.reason as DailyReason;
    if (!PORT_REASONS.has(reason)) return stop('GIT_UNAVAILABLE');
    return stop(reason === 'ABORTED' ? ctx.abortReason() : reason);
  }
  if (r.state !== 'OK' || typeof r.exitCode !== 'number' || !Number.isInteger(r.exitCode) || !(r.stdout instanceof Uint8Array)) {
    return stop('GIT_UNAVAILABLE');
  }
  if (r.stdout.byteLength > MAX_STDOUT_BYTES) return stop('GIT_LIMIT');
  return {exitCode: r.exitCode, stdout: Uint8Array.from(r.stdout)};
}

async function call0(ctx: Ctx, args: readonly string[]): Promise<Uint8Array> {
  const r = await call(ctx, args);
  if (r.exitCode !== 0) stop('GIT_UNAVAILABLE');
  return r.stdout;
}

const decoder = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true});
function decode(bytes: Uint8Array): string {
  try {return decoder.decode(bytes);} catch {return stop('GIT_UNSUPPORTED');}
}
/** Strict NUL-terminated record list; partial trailing record is rejected. */
function nulFields(bytes: Uint8Array): string[] {
  if (bytes.byteLength === 0) return [];
  if (bytes[bytes.byteLength - 1] !== 0) stop('GIT_UNSUPPORTED');
  return decode(bytes).slice(0, -1).split('\0');
}
function singleLine(bytes: Uint8Array): string {
  const text = decode(bytes);
  if (!text.endsWith('\n') || text.indexOf('\n') !== text.length - 1) stop('GIT_UNSUPPORTED');
  return text.slice(0, -1);
}
const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a).equals(Buffer.from(b));

const isBool = (v: string): boolean => v === 'true' || v === 'false';
const isInert = (v: string): boolean => {
  if (v.length === 0) return false;
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f) return false;
  }
  return true;
};
const REQUIRED_CONFIG = ['core.repositoryformatversion', 'core.bare', 'core.filemode', 'core.logallrefupdates'];
function configValueAllowed(key: string, value: string): boolean {
  switch (key) {
    case 'core.repositoryformatversion': return value === '0';
    case 'core.bare': return value === 'false';
    case 'core.filemode': case 'core.logallrefupdates': case 'core.symlinks': return isBool(value);
    case 'core.ignorecase': return value === 'false';
    case 'user.name': case 'user.email': case 'remote.origin.url': case 'remote.origin.fetch': return isInert(value);
    default: {
      const m = /^branch\.(.+)\.(remote|merge)$/.exec(key);
      return m !== null && isSafeIdentifier(m[1]) && isInert(value);
    }
  }
}
/** Allowlist-only local config; values are never logged or returned. */
function validateConfig(bytes: Uint8Array): void {
  const seen = new Set<string>();
  for (const field of nulFields(bytes)) {
    const nl = field.indexOf('\n');
    if (nl <= 0) stop('GIT_UNSUPPORTED');
    const key = field.slice(0, nl), value = field.slice(nl + 1);
    if (seen.has(key) || !configValueAllowed(key, value)) stop('GIT_UNSUPPORTED');
    seen.add(key);
  }
  if (!REQUIRED_CONFIG.every(k => seen.has(k))) stop('GIT_UNSUPPORTED');
}
function validateStage(bytes: Uint8Array): void {
  for (const f of nulFields(bytes)) {
    const m = /^(\d{6}) ([0-9a-f]{40}) (\d)\t[\s\S]+$/.exec(f);
    if (m === null || !SUPPORTED_MODES.has(m[1]!) || m[3] !== '0') stop('GIT_UNSUPPORTED');
  }
}
function validateFlags(bytes: Uint8Array): void {
  for (const f of nulFields(bytes)) if (!/^H [\s\S]+$/.test(f)) stop('GIT_UNSUPPORTED');
}
function validateTree(bytes: Uint8Array): void {
  for (const f of nulFields(bytes)) {
    const m = /^(\d{6}) ([a-z]+) ([0-9a-f]{40})\t[\s\S]+$/.exec(f);
    if (m === null || !SUPPORTED_MODES.has(m[1]!) || m[2] !== 'blob') stop('GIT_UNSUPPORTED');
  }
}
type PathChange = Readonly<{kind: 'ADD' | 'MODIFY' | 'DELETE'; path: string}>;
const DIFF_KIND: Readonly<Record<string, PathChange['kind']>> = Object.freeze({A: 'ADD', M: 'MODIFY', D: 'DELETE'});
function parseDiff(bytes: Uint8Array): PathChange[] {
  const fields = nulFields(bytes);
  if (fields.length % 2 !== 0) stop('GIT_UNSUPPORTED');
  const out: PathChange[] = [];
  for (let i = 0; i < fields.length; i += 2) {
    const kind = Object.hasOwn(DIFF_KIND, fields[i]!) ? DIFF_KIND[fields[i]!] : undefined;
    if (kind === undefined) return stop('GIT_UNSUPPORTED');
    out.push({kind, path: fields[i + 1]!});
  }
  return out;
}

/**
 * Paths that `status --porcelain=v1 -z` (content-refreshed in memory, no index write) reports
 * with a worktree-side change (Y column not ' '; untracked/ignored excluded).
 */
function statusWorktreePaths(bytes: Uint8Array): ReadonlySet<string> {
  const fields = nulFields(bytes);
  const out = new Set<string>();
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]!;
    if (f.length < 4 || f[2] !== ' ') stop('GIT_UNSUPPORTED');
    const x = f[0]!, y = f[1]!, path = f.slice(3);
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
      i += 1;
      if (i >= fields.length) stop('GIT_UNSUPPORTED');
    }
    if (y !== ' ' && y !== '?' && y !== '!') out.add(path);
  }
  return out;
}

async function absent(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return false;
  } catch (e) {
    if ((e as {code?: unknown}).code === 'ENOENT') return true;
    return stop('GIT_UNAVAILABLE');
  }
}
/** Dedicated standalone checkout: real root, real `.git` directory, no shared gitdir, alternates or grafts. */
async function checkRootStructure(root: string): Promise<void> {
  try {
    if (await realpath(root) !== root) stop('GIT_UNSUPPORTED');
    for (const rel of [['.git'], ['.git', 'objects']]) {
      const st = await lstat(join(root, ...rel));
      if (st.isSymbolicLink() || !st.isDirectory()) stop('GIT_UNSUPPORTED');
    }
  } catch (e) {
    if (e instanceof Stop) throw e;
    stop((e as {code?: unknown}).code === 'ENOENT' ? 'GIT_UNSUPPORTED' : 'GIT_UNAVAILABLE');
  }
  for (const rel of [['.git', 'commondir'], ['.git', 'objects', 'info', 'alternates'], ['.git', 'objects', 'info', 'http-alternates'],
    ['.git', 'info', 'grafts']]) {
    if (!await absent(join(root, ...rel))) stop('GIT_UNSUPPORTED');
  }
}

type Identity = Readonly<{toplevel: Uint8Array; format: Uint8Array; config: Uint8Array; head: Uint8Array}>;
type State = Identity & Readonly<{status: Uint8Array; stage: Uint8Array; flags: Uint8Array; baseTree: Uint8Array; headTree: Uint8Array}>;

async function readIdentity(ctx: Ctx): Promise<Identity> {
  return {
    toplevel: await call0(ctx, CMD.toplevel), format: await call0(ctx, CMD.format),
    config: await call0(ctx, CMD.config), head: await call0(ctx, CMD.head),
  };
}
async function readIndexState(ctx: Ctx, base: string, head: string): Promise<Omit<State, keyof Identity>> {
  return {
    status: await call0(ctx, CMD.status), stage: await call0(ctx, CMD.stage), flags: await call0(ctx, CMD.flags),
    baseTree: await call0(ctx, treeArgs(base)), headTree: await call0(ctx, treeArgs(head)),
  };
}
/** Validates root/format/config/HEAD; returns the validated HEAD. */
function validateIdentity(id: Identity, root: string): string {
  if (singleLine(id.toplevel) !== root) stop('GIT_UNSUPPORTED');
  if (singleLine(id.format) !== 'sha1') stop('GIT_UNSUPPORTED');
  validateConfig(id.config);
  const head = singleLine(id.head);
  if (!isSha1(head)) stop('GIT_UNSUPPORTED');
  return head;
}
function validateIndexState(s: Omit<State, keyof Identity>): void {
  validateStage(s.stage); validateFlags(s.flags); validateTree(s.baseTree); validateTree(s.headTree);
}

/** Initial preflight: dedicated clean checkout exactly at the Owner-fixed base. */
export async function checkCleanBase(config: DailyOwnerConfig, git: DailyGitReadPort, signal: AbortSignal): Promise<CheckResult> {
  const root = config.approval.worktreeRoot, base = config.approval.baseCommit;
  return withDeadline(git, signal, async (ctx) => {
    if (!isSha1(base)) stop('GIT_UNSUPPORTED');
    await checkRootStructure(root);
    const head = validateIdentity(await readIdentity(ctx), root);
    if (head !== base) stop('BASE_MISMATCH');
    const state = await readIndexState(ctx, base, head);
    validateIndexState(state);
    if (state.status.byteLength !== 0) stop('DIRTY_BASE');
    return ok;
  });
}

/** End check: bounded observed-path candidate set from the fixed base, stable across two snapshots. */
export async function collectDailyChangeSet(binding: DailyBinding, git: DailyGitReadPort, signal: AbortSignal): Promise<DailyChangeSetResult> {
  const root = binding.config.approval.worktreeRoot, base = binding.config.approval.baseCommit;
  return withDeadline(git, signal, async (ctx): Promise<DailyChangeSetResult> => {
    if (!isSha1(base)) stop('GIT_UNSUPPORTED');
    await checkRootStructure(root);
    const id1 = await readIdentity(ctx);
    const head = validateIdentity(id1, root);
    const ancestry = await call(ctx, ancestryArgs(base, head));
    if (ancestry.exitCode === 1) stop('BASE_MISMATCH');
    if (ancestry.exitCode !== 0) stop('GIT_UNAVAILABLE');
    const s1 = await readIndexState(ctx, base, head);
    validateIndexState(s1);
    const committed = await call0(ctx, committedArgs(base, head));
    const staged = await call0(ctx, stagedArgs(head));
    const unstaged = await call0(ctx, CMD.unstaged);
    const untracked = await call0(ctx, CMD.untracked);
    const id2 = await readIdentity(ctx);
    const s2 = await readIndexState(ctx, base, head);
    const before: State = {...id1, ...s1}, after: State = {...id2, ...s2};
    for (const k of Object.keys(before) as (keyof State)[]) if (!sameBytes(before[k], after[k])) stop('GIT_UNSTABLE');

    // With autoRefreshIndex disabled, the unstaged diff reports stat-only (touched) files as M.
    // Keep only entries that status corroborates as a real worktree-side change; status is
    // byte-identical before/after, so a concurrent real change surfaces as GIT_UNSTABLE.
    const worktreeChanged = statusWorktreePaths(s1.status);
    const unstagedChanges = parseDiff(unstaged).filter(c => worktreeChanged.has(c.path));
    const all: PathChange[] = [...parseDiff(committed), ...parseDiff(staged), ...unstagedChanges,
      ...nulFields(untracked).map((path): PathChange => ({kind: 'ADD', path}))];
    // Exact kind/path duplicates collapse; distinct kinds for one path are retained.
    const unique = new Map<string, ChangedPath>();
    for (const c of all) unique.set(`${c.kind}\0${c.path}`, Object.freeze({kind: c.kind, path: c.path}));
    const changes = [...unique.values() as Iterable<PathChange>].sort((a, b) => compareUtf8(a.path, b.path) || compareUtf8(a.kind, b.kind));
    if (changes.length > MAX_ENTRIES) stop('GIT_LIMIT');
    const candidate = {availability: 'PRESENT' as const, changes};
    if (inspectChangeSet(candidate).state !== 'PRESENT') stop('GIT_UNSUPPORTED');
    if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') > MAX_JSON_BYTES) stop('GIT_LIMIT');
    const changeSet = Object.freeze({availability: 'PRESENT' as const, changes: Object.freeze(changes)});
    return Object.freeze({state: 'VALID' as const, changeSet, baseCommit: base, headCommit: head});
  });
}
