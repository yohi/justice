// S2-b offline READ_ONLY adapter contract. S1 types are imported, never redefined.
import type { LoaderInput, S1aReadOnlySource, TaskIntent } from "../core/s1a/contract.js";
import type { EvidenceRefV1 } from "../core/s1b/contract.js";
import type { S1dReportV1 } from "../core/s1d/contract.js";

export type { LoaderInput, S1aReadOnlySource, TaskIntent, EvidenceRefV1, S1dReportV1 };

export const S2B_SOURCE_SCHEMA_VERSION = "justice-s2b-source-v1" as const;
export const S2B_CORRELATION_SCHEMA_VERSION = "justice-s2b-correlation-v1" as const;
export const S2B_REPORT_SCHEMA_VERSION = "justice-s2b-report-v1" as const;
export const S2B_SUPPORTED_HOST_VERSION = "2.2.5" as const;

/** Input/projection limits measured on raw UTF-8 byte spans (never re-serialized JSON). */
export const S2B_LIMITS = Object.freeze({
  sourceWrapperBytes: 75_497_472,
  sessionResponseBytes: 1_048_576,
  messagePageResponseBytes: 4_194_304,
  messagePages: 64,
  messageResponseTotalBytes: 67_108_864,
  messagesPerPage: 200,
  collectionMessages: 4_096,
  correlationBytes: 262_144,
  bindings: 512,
  toolsPerMessage: 64,
  toolsTotal: 2_048,
  diffResponseBytes: 2_097_152,
  diffEntries: 128,
  evidenceRefs: 128,
  evidenceJsonBytes: 1_048_576,
  changeSetJsonBytes: 262_144,
} as const);

export type S2bStatus = "REJECTED" | "LIMITED" | "PROJECTED";
export type CollectionStatus = "PAGINATION_COMPLETE" | "PAGINATION_INCOMPLETE";
export type DiagnosticCode =
  | "SOURCE_VERSION_UNSUPPORTED" | "SOURCE_SCHEMA_INVALID" | "SOURCE_IDENTITY_MISMATCH"
  | "UNSUPPORTED_FILTERED_COLLECTION" | "PAGINATION_INCOMPLETE" | "CONFLICT"
  | "FOREIGN_TASK_EXCLUDED" | "UNMAPPED" | "MISSING_MESSAGE" | "MISSING_TOOL"
  | "NOT_ASSISTANT_MESSAGE" | "CORRELATION_MISMATCH" | "DIFF_UNAVAILABLE"
  | "EVIDENCE_LIMIT_EXCEEDED" | "INPUT_LIMIT_EXCEEDED";
export type S2bDiagnostic = Readonly<{ code: DiagnosticCode; count: number }>;
export type S2bRequest = Readonly<{
  loaderInput: LoaderInput;
  sourcePath: string;       // justice-s2b-source-v1 wrapper JSON
  correlationPath: string;  // justice-s2b-correlation-v1 JSON
}>;
export type ValidatedSource = Readonly<{
  sessionId: string; collectionId: string;
  collectionStatus: CollectionStatus;
  lastValidatedPageIndex: number | null;
  validatedPageCount: number;
  // 生の取得ページ列のうち、先頭から連続・検証済みのMessageのみ
  messages: ReadonlyArray<Readonly<Record<string, unknown>>>;
  diagnostics: readonly S2bDiagnostic[];
}>;
export type SourceResult = Readonly<{ state: "REJECTED"; diagnostics: readonly S2bDiagnostic[] }>
  | Readonly<{ state: "ACCEPTED"; value: ValidatedSource }>;
export type CorrelationBinding = Readonly<{
  messageId: string;
  taskRef: Readonly<{ artifactId: string; revision: string }>;
  scopeKey: string;
  tools: readonly Readonly<{ toolId: string; acRef: Readonly<{ artifactId: string; revision: string }> }>[];
}>;
export type CorrelationResult = Readonly<{ state: "REJECTED"; diagnostics: readonly S2bDiagnostic[] }>
  | Readonly<{ state: "ACCEPTED"; sessionId: string; bindings: readonly CorrelationBinding[]; diagnostics: readonly S2bDiagnostic[] }>;
export type Projection = Readonly<{
  status: S2bStatus;
  evidenceRefs: readonly EvidenceRefV1[];
  diagnostics: readonly S2bDiagnostic[];
  // 付加的なS2-b出力に含めるIdentityは匿名の安全トークン。
  projectionScope: Readonly<{
    sessionId: string; collectionId: string;
    taskRef: Readonly<{ artifactId: string; revision: string }>;
    scopeKey: string;
    firstPageIndex: 0 | null;
    lastValidatedPageIndex: number | null;
    validatedPageCount: number;
    selectedMessageCount: number;
    projectedEvidenceCount: number;
  }>;
  counts: Readonly<Record<string, number>>;
}>;
export type S2bReportV1 = Readonly<{
  schemaVersion: "justice-s2b-report-v1";
  adapter: Readonly<{
    status: S2bStatus;
    collectionStatus: CollectionStatus | "NOT_EVALUATED";
    selectedTaskRef?: Readonly<{ artifactId: string; revision: string }>;
    projectionScope: Projection["projectionScope"];
    coverageCompleteness: "NOT_ESTABLISHED";
    counts: Projection["counts"];
    diagnostics: readonly S2bDiagnostic[];
    diffProjection: "UNAVAILABLE";
  }>;
  s1d?: S1dReportV1;
}>;
