# Controller Routing Runtime Signal Spike

## Environment
- OpenCode version: `1.18.29`
- @opencode-ai/plugin: `1.14.21`
- @opencode-ai/sdk: `1.14.21`
- pinned host source commit: `16747470f976aca3d362ad730bcd3fe82ecc2c9a`

## Verified candidate contract
- command.execute.before: exact command + session; capture-arm only
- chat.params: session + UserMessage.id + raw agent
- finalized message.updated: session + assistant id + parent user id + raw agent + completion
- command.executed: exact command + session + result assistant message id
- detached event trace flush: instance disposal + probe.dispose_flushed sentinel

## Nominal four-command chains
### justice-implement-brainstorming
- sessionID: `A`
- userMessageID: `B`
- assistantMessageID: `C`
- chat agent: `sisyphus`
- final agent: `sisyphus`

### justice-implement-writing-plans
- sessionID: `A`
- userMessageID: `B`
- assistantMessageID: `C`
- chat agent: `sisyphus`
- final agent: `sisyphus`

### justice-implement-subagent-driven-development
- sessionID: `A`
- userMessageID: `B`
- assistantMessageID: `C`
- chat agent: `atlas`
- final agent: `atlas`

### justice-implement-executing-plans
- sessionID: `A`
- userMessageID: `B`
- assistantMessageID: `C`
- chat agent: `sisyphus`
- final agent: `sisyphus`

## Same-session overlap
### justice-implement-subagent-driven-development
- sessionID: `A`
- userMessageID: `B`
- assistantMessageID: `C`
- chat agent: `atlas`
- final agent: `atlas`

## Result
JUS-P0-01 runtime observation = BLOCKED

## Sanitized failures
- overlap:final_message_count:justice-implement-writing-plans:0
- overlap:chain_count:1


## Failure / abandonment capability

- JUS-P0-01 abandonment observation = BLOCKED
- failure_injection_hook=command.execute.before
- a_command_executed=no
- b_command_executed=yes
- b_finalized_identity=yes
- unsafe_early_lifecycle_observed=true
- cleanup_scope=none
- cleanup_session=none
- cleanup_hook=none
- cleanup_status=none
- cleanup_order=none
- preserves_concurrent_invocation=false
- suppression_clear_authority=removeSession_only
- trace_flush=explicit_instance_dispose_then_probe.dispose_flushed
- failure=no_safe_same_session_post_failure_and_B_quiescence_boundary
