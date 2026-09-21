# Linux Review Artifact Provider Gate

Task 3.3a proves the native filesystem boundary before a production provider is
published. The supported deployment is Linux x86_64 with glibc and working
`openat2(2)` and `renameat2(2)` syscalls.

## Supported environment

The probe was compiled and executed inside the root-selected devcontainer with
OpenCode `1.18.29` and Rust `1.88.0-x86_64-unknown-linux-gnu`. The exact probe
JSON was:

```json
{"provider":"LinuxOpenat2ReviewArtifactProvider","nativeApi":{"openat2":true,"renameat2":true,"openat":true,"linkat":true,"fstat":true,"pread":true,"pwrite":true,"unlinkat":true,"descriptorRelative":true,"identityBoundLease":true},"platform":{"os":"linux","arch":"x86_64","libc":"glibc"},"kernel":"7.0.0-31-generic","status":"PASS","cases":{"exclusive_reservation":{"status":"PASS","detail":"exclusive marker and identity-bound lease"},"reservation_collision":{"status":"PASS","detail":"second exclusive reservation collided"},"descriptor_relative_io":{"status":"PASS","detail":"descriptor-relative pwrite/pread"},"final_component_symlink":{"status":"PASS","detail":"final-component symlink rejected"},"symlinked_ancestor":{"status":"PASS","detail":"symlinked ancestor rejected"},"ancestor_replacement":{"status":"PASS","detail":"original descriptor remained anchored"},"artifact_replacement":{"status":"PASS","detail":"artifact replacement retained","outcome":"replacement_retained","replacement_delete_count":0,"replacement_overwrite_count":0,"replacement_bytes_retained":true,"usable_reservation":false},"lease_replacement":{"status":"PASS","detail":"lease replacement retained","outcome":"replacement_retained","replacement_delete_count":0,"replacement_overwrite_count":0,"replacement_bytes_retained":true,"usable_reservation":false},"root_close_reopen":{"status":"PASS","detail":"root close/reopen preserved descriptor contract"},"reservation_local_quarantine":{"status":"PASS","detail":"matching pair retained in reservation-local quarantine","outcome":"quarantine_retained","replacement_delete_count":0,"replacement_overwrite_count":0,"replacement_bytes_retained":false,"usable_reservation":false},"post_verification_quarantine_race":{"status":"PASS","detail":"replacement survived post-verification race","outcome":"quarantine_retained","replacement_delete_count":0,"replacement_overwrite_count":0,"replacement_bytes_retained":true,"usable_reservation":false},"artifact_name_replacement_after_fstat":{"status":"PASS","detail":"artifact replacement retained; reservation unusable","outcome":"artifact_storage_unavailable","replacement_delete_count":0,"replacement_overwrite_count":0,"replacement_bytes_retained":true,"usable_reservation":false},"lease_name_replacement_after_hard_link":{"status":"PASS","detail":"lease replacement retained; reservation unusable","outcome":"artifact_storage_unavailable","replacement_delete_count":0,"replacement_overwrite_count":0,"replacement_bytes_retained":true,"usable_reservation":false}}}
```

On this environment the provider may be published only after the report has
`status: "PASS"`. A normal matching cleanup returns
`quarantine_retained`; the quarantine leaves are retained because the supported
primitive set has no identity-bound unlink operation.

## Unsupported environment

For a Linux x86_64 glibc host where `openat2(2)` is unavailable, the exact
blocked report is:

```json
{"provider":"LinuxOpenat2ReviewArtifactProvider","nativeApi":{"openat2":false,"renameat2":true,"descriptorRelative":false,"identityBoundLease":false},"platform":{"os":"linux","arch":"x86_64","libc":"glibc"},"kernel":"5.4.0","status":"BLOCKED","cases":{"exclusive_reservation":{"status":"BLOCKED","detail":"required syscall unavailable"},"reservation_collision":{"status":"BLOCKED","detail":"required syscall unavailable"},"descriptor_relative_io":{"status":"BLOCKED","detail":"required syscall unavailable"},"final_component_symlink":{"status":"BLOCKED","detail":"required syscall unavailable"},"symlinked_ancestor":{"status":"BLOCKED","detail":"required syscall unavailable"},"ancestor_replacement":{"status":"BLOCKED","detail":"required syscall unavailable"},"artifact_replacement":{"status":"BLOCKED","detail":"required syscall unavailable"},"lease_replacement":{"status":"BLOCKED","detail":"required syscall unavailable"},"root_close_reopen":{"status":"BLOCKED","detail":"required syscall unavailable"},"reservation_local_quarantine":{"status":"BLOCKED","detail":"required syscall unavailable"},"post_verification_quarantine_race":{"status":"BLOCKED","detail":"required syscall unavailable"},"artifact_name_replacement_after_fstat":{"status":"BLOCKED","detail":"required syscall unavailable"},"lease_name_replacement_after_hard_link":{"status":"BLOCKED","detail":"required syscall unavailable"}}}
```

`renameat2(2)` absence produces the same `BLOCKED` publication decision with
`renameat2: false`. Any other failed probe also prevents provider publication.
The user-visible behavior is `artifact_storage_unavailable`: no usable
reservation is returned and no artifact path is handed to a worker. The
original execution remains fail-open, but no Review Artifact, Gate,
AcceptanceDecision, or retry is created from the unusable reservation.

An unsupported runtime is a deployment failure for this provider and leaves
the supported-provider hard gate incomplete. It is not a P0 exemption or a
waiver of the Phase 3 completion criteria.
