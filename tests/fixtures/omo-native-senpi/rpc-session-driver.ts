import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { z } from "zod";
import {
  RPC_RECORD_SCHEMA,
  RpcSessionDriverSummarySchema,
  observeAppendedEntry,
  readFixtureCapabilityIds,
  type AppendObservation,
} from "./rpc-session-observations";

const SUMMARY_PREFIX = "JUSTICE_SPIKE_RPC_SESSION_SUMMARY=";
const MAX_RPC_OUTPUT_BYTES = 64 * 1024 * 1024;

const ExpectedCapabilityCallSchema = z.object({
  toolCallId: z.string().min(1),
  originalDescription: z.string().nullable(),
}).readonly();
const DriverConfigSchema = z.object({
  command: z.string().min(1),
  commandArgs: z.array(z.string()).readonly(),
  cwd: z.string().min(1),
  prompts: z.array(z.string().min(1)).min(1).readonly(),
  expectedCapabilityCalls: z.array(ExpectedCapabilityCallSchema).readonly(),
  expectedSyntheticToolCallIds: z.array(z.string()).readonly(),
}).readonly();
const RpcRecordSchema = RPC_RECORD_SCHEMA;

type RpcRecord = z.infer<typeof RpcRecordSchema>;
type QueueReader = (record: RpcRecord | null) => void;
type EntryObservationArray = AppendObservation[];

function rpcErrorHint(value: unknown, tokens: readonly string[]): string {
  if (typeof value !== "string" || value.length === 0) return "no_error_text";
  let safe = value.toLowerCase();
  for (const token of tokens) safe = safe.replaceAll(token.toLowerCase(), "<token>");
  return safe
    .replace(/(?:[a-z]:)?(?:\/[\w.-]+)+/giu, "<path>")
    .replace(/\b[0-9a-f]{8,}\b/giu, "<id>")
    .replace(/\s+/gu, " ")
    .slice(0, 120);
}

async function main(): Promise<void> {
  let rawConfig: unknown;
  try {
    rawConfig = JSON.parse(process.argv[2] ?? "null");
  } catch (cause: unknown) {
    if (cause instanceof Error) rawConfig = null;
    else throw cause;
  }
  const configResult = DriverConfigSchema.safeParse(rawConfig);
  if (!configResult.success) {
    process.stdout.write(`${SUMMARY_PREFIX}${JSON.stringify({ setupError: "rpc_driver_config_invalid" })}\n`);
    return;
  }
  const config = configResult.data;
  const evidencePath = process.env.JUSTICE_SPIKE_EVIDENCE_PATH;
  if (evidencePath === undefined) {
    process.stdout.write(`${SUMMARY_PREFIX}${JSON.stringify({ setupError: "rpc_driver_evidence_path_missing" })}\n`);
    return;
  }
  const child = spawn(config.command, [...config.commandArgs], {
    cwd: config.cwd,
    env: process.env,
    detached: false,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const closeResult = new Promise<number>((resolve) => {
    child.once("close", (code: number | null) => resolve(code ?? 1));
    child.once("error", () => resolve(1));
  });
  const queued: RpcRecord[] = [];
  const waiters: QueueReader[] = [];
  let streamClosed = false;
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let parseFailure = false;
  let lineBuffer = "";
  const decoder = new StringDecoder("utf8");
  let sessionId = "";
  let sessionFile = "";
  let routedSessionId: string | undefined;
  let agentEndCount = 0;
  let requestId = 0;
  let sessionEventSequence = 0;
  const toolExecutionStartSequences = new Map<string, number>();
  const appendObservations: EntryObservationArray = [];
  const syntheticResultObservations: EntryObservationArray = [];
  const fallbackAppendObservations: EntryObservationArray = [];
  const rpcResponseTrace: string[] = [];
  let failureStage = "session_stats";
  const expectedCalls: ReadonlyMap<string, string | null> = new Map(
    config.expectedCapabilityCalls.map((item) => [item.toolCallId, item.originalDescription]),
  );
  const expectedSyntheticToolCallIds = new Set(config.expectedSyntheticToolCallIds);
  const fixtureTokenSource = readFixtureCapabilityIds();
  if (fixtureTokenSource.kind === "unavailable") {
    process.stdout.write(`${SUMMARY_PREFIX}${JSON.stringify({ setupError: `fixture_${fixtureTokenSource.reason}` })}\n`);
    return;
  }
  const fixtureTokens = fixtureTokenSource.tokens;
  const enqueue = (record: RpcRecord): void => {
    const waiter = waiters.shift();
    if (waiter) waiter(record);
    else queued.push(record);
  };
  const closeQueue = (): void => {
    streamClosed = true;
    while (waiters.length > 0) waiters.shift()?.(null);
  };
  const nextRecord = (): Promise<RpcRecord | null> => {
    const record = queued.shift();
    if (record !== undefined) return Promise.resolve(record);
    if (streamClosed) return Promise.resolve(null);
    return new Promise((resolve) => waiters.push(resolve));
  };

  const handleRecord = (record: RpcRecord): void => {
    const matchesSession =
      routedSessionId === undefined || record.sessionId === routedSessionId;
    if (record.type === "response") {
      const command = typeof record.command === "string" ? record.command : "unknown_command";
      const outcome = record.success === true ? "success" : "failure";
      const errorCode = typeof record.errorCode === "string" ? "coded" : "uncoded";
      rpcResponseTrace.push(
        `${command}:${outcome}:${errorCode}:${rpcErrorHint(record.error, fixtureTokens)}`,
      );
    }
    if (record.type === "agent_end" && matchesSession) agentEndCount++;
    if (!matchesSession || record.type === "response") return;
    sessionEventSequence++;
    if (record.type === "tool_execution_start" && typeof record.toolCallId === "string") {
      toolExecutionStartSequences.set(record.toolCallId, sessionEventSequence);
    }
    if (record.type !== "entry_appended" || !matchesSession) return;
    const entry = RpcRecordSchema.safeParse(record.entry);
    if (!entry.success) {
      parseFailure = true;
      return;
    }
    const value = entry.data;
    if (sessionFile.length > 0 && sessionId.length > 0) {
      const observed = observeAppendedEntry({
        record: { entry: value },
        sessionId,
        sessionFile,
        expectedCapabilityCalls: expectedCalls,
        expectedSyntheticToolCallIds,
        knownCapabilityIds: fixtureTokens,
      });
      appendObservations.push(
        ...observed.assistantToolCalls.map((observation) => ({
          ...observation,
          rpcEventSequence: sessionEventSequence,
        })),
      );
      syntheticResultObservations.push(...observed.syntheticToolResults);
      fallbackAppendObservations.push(...observed.fallbackMessages);
    }
  };

  const consumeLine = (line: string): void => {
    if (line.trim().length === 0) return;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (cause: unknown) {
      if (cause instanceof Error) parseFailure = true;
      else throw cause;
      return;
    }
    const parsed = RpcRecordSchema.safeParse(raw);
    if (!parsed.success) {
      parseFailure = true;
      return;
    }
    handleRecord(parsed.data);
    enqueue(parsed.data);
  };

  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBytes += chunk.byteLength;
    if (stdoutBytes + stderrBytes > MAX_RPC_OUTPUT_BYTES) {
      parseFailure = true;
      child.kill("SIGTERM");
      return;
    }
    lineBuffer += decoder.write(chunk);
    let newline = lineBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = lineBuffer.slice(0, newline).replace(/\r$/u, "");
      lineBuffer = lineBuffer.slice(newline + 1);
      consumeLine(line);
      newline = lineBuffer.indexOf("\n");
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderrBytes += chunk.byteLength;
    if (stdoutBytes + stderrBytes > MAX_RPC_OUTPUT_BYTES) {
      parseFailure = true;
      child.kill("SIGTERM");
    }
  });
  child.stdout.on("end", () => {
    lineBuffer += decoder.end();
    if (lineBuffer.length > 0) consumeLine(lineBuffer);
    closeQueue();
  });
  child.once("close", () => closeQueue());

  const send = (command: RpcRecord): void => {
    if (!child.stdin.writable) throw new Error("rpc_input_closed");
    child.stdin.write(`${JSON.stringify(command)}\n`);
  };
  const request = async (type: string, fields: RpcRecord = {}): Promise<RpcRecord> => {
    requestId++;
    const id = `justice-task1-rpc-${String(requestId)}`;
    send({ id, type, ...fields });
    while (true) {
      const record = await nextRecord();
      if (record === null) throw new Error("rpc_server_closed_before_response");
      if (
        record.type === "response" &&
        record.command === type &&
        (record.id === id || record.id === undefined)
      ) {
        if (record.success !== true) throw new Error("rpc_command_refused");
        return record;
      }
    }
  };

  try {
    failureStage = "protocol_info";
    const protocolInfo = await request("get_protocol_info");
    const protocolData = RpcRecordSchema.safeParse(protocolInfo.data);
    if (!protocolData.success || protocolData.data.mode !== "multi") {
      throw new Error("rpc_multi_session_mode_unavailable");
    }

    failureStage = "open_session";
    const opened = await request("open_session", {
      cwd: config.cwd,
      provider: "omo-mock",
      modelId: "mock-1",
      kind: "interactive",
    });
    const openedData = RpcRecordSchema.safeParse(opened.data);
    if (!openedData.success || typeof openedData.data.sessionId !== "string") {
      throw new Error("rpc_open_session_missing_route");
    }
    routedSessionId = openedData.data.sessionId;

    failureStage = "session_stats";
    const stats = await request("get_session_stats", { sessionId: routedSessionId });
    const data = RpcRecordSchema.safeParse(stats.data);
    if (!data.success || typeof data.data.sessionId !== "string" || typeof data.data.sessionFile !== "string") {
      throw new Error("rpc_session_stats_missing_identity");
    }
    sessionId = data.data.sessionId;
    sessionFile = data.data.sessionFile;
    for (const prompt of config.prompts) {
      const agentEndsBeforePrompt = agentEndCount;
      failureStage = "prompt";
      await request("prompt", { sessionId: routedSessionId, message: prompt });
      failureStage = "agent_end";
      while (agentEndCount === agentEndsBeforePrompt) {
        const record = await nextRecord();
        if (record === null) throw new Error("rpc_stream_closed_before_agent_end");
        if (record.type === "response" && record.success === false) throw new Error("rpc_turn_refused");
      }
    }
    failureStage = "list_sessions_before_shutdown";
    const listed = await request("list_sessions", { include_workers: true });
    const listedData = RpcRecordSchema.safeParse(listed.data);
    if (!listedData.success || !Array.isArray(listedData.data.sessions)) {
      throw new Error("rpc_session_list_unavailable_before_shutdown");
    }
    const listedSessionCount = listedData.data.sessions.length;
    const attachedSessions = listedData.data.sessions.flatMap((value: unknown) => {
      const session = RpcRecordSchema.safeParse(value);
      if (
        !session.success ||
        typeof session.data.sessionId !== "string" ||
        typeof session.data.attachments !== "number" ||
        session.data.attachments < 1
      ) {
        return [];
      }
      return [{ sessionId: session.data.sessionId, kind: session.data.kind }];
    });
    const attachedSessionCount = attachedSessions.length;
    const shutdownSessions = [
      ...attachedSessions.filter((session) => session.kind === "worker"),
      ...attachedSessions.filter((session) => session.kind !== "worker"),
    ];
    let closedSessionCount = 0;
    failureStage = "close_session";
    for (const session of shutdownSessions) {
      await request("close_session", { sessionId: session.sessionId });
      closedSessionCount++;
    }
    failureStage = "shutdown";
    child.stdin.end();
    const exitCode = await closeResult;
    const appendObservationsWithExecutionOrder = appendObservations.map((observation) => {
      const toolCallId = observation.toolCallId;
      const executionSequence = typeof toolCallId === "string" ? toolExecutionStartSequences.get(toolCallId) : undefined;
      const appendSequence = observation.rpcEventSequence;
      return {
        ...observation,
        toolExecutionStartSequence: executionSequence ?? null,
        toolExecutionStartedAfterAppend:
          typeof appendSequence === "number" && typeof executionSequence === "number" && executionSequence > appendSequence,
      };
    });
    const summary = RpcSessionDriverSummarySchema.parse({
      setupError: exitCode === 0 && !parseFailure ? undefined : "rpc_session_failed",
      runtimeMode: "rpc",
      sessionId,
      listedSessionCount,
      attachedSessionCount,
      closedSessionCount,
      agentEndCount,
      entryAppendedObservations: appendObservationsWithExecutionOrder,
      syntheticToolResultObservations: syntheticResultObservations,
      fallbackAppendObservations,
    });
    process.stdout.write(`${SUMMARY_PREFIX}${JSON.stringify(summary)}\n`);
  } catch {
    child.stdin.end();
    child.kill("SIGTERM");
    await closeResult;
    process.stdout.write(`${SUMMARY_PREFIX}${JSON.stringify({
      setupError: `rpc_${failureStage}_failed`,
      rpcResponseTrace,
    })}\n`);
  }
}

void main();
