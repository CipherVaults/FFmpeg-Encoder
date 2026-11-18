# Current state: fresh ordinary session recovery

Checkpoint 043 cutoff: 2026-11-18T09:41:18.591336+00:00. Reviewed V3 is integrated and source-tested; preservation is pending. Six source/test paths change, with no runtime/default/pin/audio-policy change.

The candidate-only New ordinary session action retires a cancelled owner, settles resources/diagnostics, clears grants/plans and acquires a new fixed owner/window. It does not revive observers, replay work or transfer capabilities. V1 alternate-action authority was tightened in V2; wider lead tests then exposed fixture incompatibility and a real initial-close regression, both addressed in V3.

Final integrated checks pass 191/191 focused, 229/229 protection and 335/335 explicit Linux, zero failures/skips/cancellations; all 644 tracked files remained byte-identical through tests. Scopes overlap, not summed. Original four lead failures remain recorded. Expected SHUTTING_DOWN suppression is candidate-only after successful cleanup; cleanup failures stay fatal and replacement blocked. Missing active-owner references on failed acquisition are not proof of complete resource settlement or retry ownership.

Earlier bounded service/native evidence remains on earlier immutable sources. New native/Windows recovery is untested. The reuse-only native plan is unbound, unexecuted and review-pending at cutoff. Next preserve/review this checkpoint before binding a bounded recovery journey. No default promotion or audio-policy change follows.
