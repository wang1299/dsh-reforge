# ADR069 — Isolate the specific admission diagnostic on an Agent retry

[Issue #169](https://github.com/wang1299/dsh-reforge/issues/169) follows the [first live study](../evaluation/benefit-live-20261109.md). That study retained no AST reason for the rejected delivery proposals. Use newly authored public examples and the existing delivery_batch contract and independent acceptance tests.

Run the same two-attempt study controller and DSH AgentLoop in fresh workspaces. The comparison is available only on the scripted driver. The generic arm withholds the diagnostic from the retry message. Both arms use the same status, allowed Python subset, request settings and initial proposal. Keep the actual admission receipt in both arms. Observe the retry at the adapter, verify the prior request history matches across arms, and record only finite diagnostic/status values, counts and hashes in the comparison report.

Use four paired scenarios fixed before measuring. The script knows one rewrite of an identity list comprehension on a local result list. It reads its own preceding proposal and the diagnostic in the user message. A semantic-fault control must still fail independent pytest after rewriting. An unsupported rewrite must stay rejected. A valid first proposal must stop immediately. In the repairable scenario only the identified rewrite should reach acceptance. Any mismatch, unknown or incomplete pair invalidates the qualification.

This source-only rehearsal runs author-written examples with no model service. It measures the delivery and effect of a particular diagnostic on that script. Real-model recovery and the separately planned [three-arm study](https://github.com/wang1299/dsh-reforge/issues/153) require new evidence and authorization.
