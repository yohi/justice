import { randomUUID } from "node:crypto";
import type { ErrorClass, FileReader, FileWriter, TaskFeedbackStatus } from "./types";

const ERROR_CLASSES: readonly ErrorClass[] = [
  "syntax_error",
  "type_error",
  "test_failure",
  "design_error",
  "timeout",
  "loop_detected",
  "provider_transient",
  "provider_config",
  "unknown",
];

export type TelemetryEvent =
  | {
      readonly type: "task_completed";
      readonly taskId: string;
      readonly status: TaskFeedbackStatus;
      readonly errorClass?: ErrorClass;
      readonly timestamp: string;
    }
  | {
      readonly type: "wisdom_injected";
      readonly taskId: string;
      readonly entryIds: readonly string[];
      readonly timestamp: string;
    }
  | {
      readonly type: "wisdom_hit";
      readonly entryId: string;
      readonly taskId?: string;
      readonly timestamp: string;
    };

export interface TelemetrySnapshot {
  readonly windowSize: number;
  readonly failureRate: number;
  readonly wisdomHitRate: number;
  readonly errorDistribution: Readonly<Record<ErrorClass, number>>;
  readonly generatedAt: string;
}

export class TelemetryStore {
  private events: TelemetryEvent[] = [];
  private saveQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly fileReader: FileReader,
    private readonly fileWriter: FileWriter,
    private readonly telemetryPath = ".justice/telemetry.json",
    private readonly maxEvents = 500,
  ) {}

  recordTaskCompleted(taskId: string, status: TaskFeedbackStatus, errorClass?: ErrorClass): void {
    this.push({
      type: "task_completed",
      taskId,
      status,
      errorClass,
      timestamp: new Date().toISOString(),
    });
  }

  recordWisdomInjection(entryIds: readonly string[], taskId: string): void {
    this.push({
      type: "wisdom_injected",
      entryIds: [...entryIds],
      taskId,
      timestamp: new Date().toISOString(),
    });
  }

  recordWisdomHit(entryId: string, taskId?: string): void {
    this.push({
      type: "wisdom_hit",
      entryId,
      ...(taskId === undefined ? {} : { taskId }),
      timestamp: new Date().toISOString(),
    });
  }

  computeSnapshot(windowSize = 100): TelemetrySnapshot {
    const events = this.events.slice(-Math.max(0, windowSize));
    const completed = events.filter((event) => event.type === "task_completed");
    const injected = new Set(
      events.filter((event) => event.type === "wisdom_injected").map((event) => event.taskId),
    );
    const completedInjected = new Set(
      completed.map((event) => event.taskId).filter((taskId) => injected.has(taskId)),
    );
    const hitTasks = new Set(
      events
        .filter((event) => event.type === "wisdom_hit" && event.taskId !== undefined)
        .map((event) => event.taskId)
        .filter((taskId): taskId is string => taskId !== undefined),
    );
    const failures = completed.filter((event) => event.status !== "success").length;
    const errorDistribution = Object.fromEntries(
      ERROR_CLASSES.map((errorClass) => [
        errorClass,
        completed.length === 0
          ? 0
          : completed.filter(
              (event) =>
                event.status !== "success" && (event.errorClass ?? "unknown") === errorClass,
            ).length / completed.length,
      ]),
    ) as Record<ErrorClass, number>;

    return {
      windowSize: events.length,
      failureRate: completed.length === 0 ? 0 : failures / completed.length,
      wisdomHitRate:
        completedInjected.size === 0
          ? 0
          : [...completedInjected].filter((taskId) => hitTasks.has(taskId)).length /
            completedInjected.size,
      errorDistribution,
      generatedAt: new Date().toISOString(),
    };
  }

  async load(): Promise<void> {
    try {
      if (!(await this.fileReader.fileExists(this.telemetryPath))) return;
      const parsed: unknown = JSON.parse(await this.fileReader.readFile(this.telemetryPath));
      if (Array.isArray(parsed))
        this.events = parsed.filter(isTelemetryEvent).slice(-this.maxEvents);
    } catch (error: unknown) {
      console.warn("[JUSTICE] Telemetry load failed", error);
    }
  }

  async save(): Promise<void> {
    // Serialize save operations so concurrent callers cannot complete out of order;
    // each write-and-rename sequence is enqueued behind the previous one.
    const queued = this.saveQueue.then(() => this.saveNow());
    this.saveQueue = queued.catch(() => undefined);
    return queued;
  }

  private async saveNow(): Promise<void> {
    const tmpPath = `${this.telemetryPath}.tmp.${randomUUID()}`;
    try {
      await this.fileWriter.writeFile(tmpPath, JSON.stringify(this.events, null, 2));
      await this.fileWriter.rename(tmpPath, this.telemetryPath);
    } catch (error: unknown) {
      await this.fileWriter.deleteFile(tmpPath).catch(() => undefined);
      console.warn("[JUSTICE] Telemetry save failed", error);
    }
  }
  private push(event: TelemetryEvent): void {
    this.events.push(event);
    if (this.events.length > this.maxEvents)
      this.events.splice(0, this.events.length - this.maxEvents);
  }
}

function isTelemetryEvent(value: unknown): value is TelemetryEvent {
  if (
    typeof value !== "object" ||
    value === null ||
    !("type" in value) ||
    !("timestamp" in value)
  ) {
    return false;
  }
  const event = value as Record<string, unknown>;
  if (typeof event.timestamp !== "string") return false;
  switch (event.type) {
    case "task_completed":
      return (
        typeof event.taskId === "string" &&
        ["success", "failure", "timeout", "compaction_risk"].includes(String(event.status)) &&
        (event.errorClass === undefined ||
          ERROR_CLASSES.some((errorClass) => errorClass === event.errorClass))
      );
    case "wisdom_injected":
      return (
        typeof event.taskId === "string" &&
        Array.isArray(event.entryIds) &&
        event.entryIds.every((entryId): entryId is string => typeof entryId === "string")
      );
    case "wisdom_hit":
      return (
        typeof event.entryId === "string" &&
        (event.taskId === undefined || typeof event.taskId === "string")
      );
    default:
      return false;
  }
}
