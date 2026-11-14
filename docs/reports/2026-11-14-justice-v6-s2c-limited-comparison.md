# S2-c controlled comparison — limited findings

**Status:** Limited no-review closure; comparison not performed.

Task 4 produced no independent review responses. The API access conditions prevented requests, and no actual model/API calls were made. Every Native-only and Native + Justice arm is `NOT_RUN`; the cases are therefore `NOT_COMPARABLE`.

| Case | Native arm | Justice arm | Comparison status |
| --- | --- | --- | --- |
| case-01 | `NOT_RUN` | `NOT_RUN` | `NOT_COMPARABLE` |
| case-02 | `NOT_RUN` | `NOT_RUN` | `NOT_COMPARABLE` |
| case-03 | `NOT_RUN` | `NOT_RUN` | `NOT_COMPARABLE` |
| case-04 | `NOT_RUN` | `NOT_RUN` | `NOT_COMPARABLE` |
| case-05 | `NOT_RUN` | `NOT_RUN` | `NOT_COMPARABLE` |
| case-06 | `NOT_RUN` | `NOT_RUN` | `NOT_COMPARABLE` |

No review results are available. TP/FP/FN/TN, additional detections, misses, improvements, and degradations were **not measured**. Comparison effectiveness is **`NOT_ESTABLISHED`**. Baseline admission remains **`NOT_ASSESSABLE`**. These findings do not show that the comparison succeeded, that Justice is superior, or that Justice provides incremental value.

## Preserved artifacts

The SDD workspace retains six neutral case inputs (`case-01` through `case-06`), six bounded S2-b diagnostic reports under those neutral identifiers, and twelve metadata-only `NOT_RUN` stop records (one per arm per case). The stop records are not review answers. Sealed Ground Truth remains private and unchanged; no label mapping is disclosed in this report.

## Limitations and residual risks

- Baseline input admission is unverified; wrapper metadata is reconstructed.
- No independent review answers exist.
- No statistical or causal claim can be drawn from six cases.
- S2-b reports are bounded diagnostics and do not prove complete Host history.

## Authorization boundary

No next steps are authorized: no new API contract, model change, rerun, additional reviews, GitHub commit/push/PR/merge, or follow-on tasks. This report is a public candidate skeleton limited to the findings above; it contains no raw Message/Tool content, secrets, host paths, or Ground Truth labels.
