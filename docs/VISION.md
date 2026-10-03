# AHP client kit vision

Status: local application of the approved Amplifier Unified family direction
(2026-10-02), not a new ratification or a claim of implementation acceptance.
The [family vision](https://github.com/microsoft/amplifier-unified/blob/main/docs/architecture/VISION.md)
and [component boundaries](https://github.com/microsoft/amplifier-unified/blob/main/contracts/component-boundaries.v1.md)
own the shared direction; [upstream AHP](https://microsoft.github.io/agent-host-protocol/)
owns wire semantics. This repository owns only reusable client mechanisms.

Independent clients should follow confirmed resources, reconnect truthfully, and
retain original local intent without importing a host or native agent runtime.
Private drafts must survive according to the client's storage policy without
backend synchronization. Losing a disposable resource baseline must neither lose
accepted work nor cause an uncertain command to be resubmitted.

The kit supplies JavaScript mechanisms, TypeScript declarations, scoped browser
storage, optional Node storage and a noninteractive AHP executable. Upstream SDKs
retain schemas and reducers. UI clients retain selection, rendering, resource
interest, bounded window policy and private presentation state. Storage adapters
retain durable writes and cross-process exclusion; hosts retain admission and
execution; native agents retain canonical history. Distribution owns compatible
package assembly and activation.

Success means a client can use the packed library independently, recover through
AHP rather than a private replay rule, capture one original target/input before
waiting, and keep subsequent private input untouched. Small journal updates work
on one identity; resource actions work on one baseline. Acceptance must identify
exact source/package/peer revisions and distinguish fixtures from actual clients
and deployed use.

A global app store, copied upstream reducers, widget ownership, a backend mirror of
private drafts, canonical history, exactly-once remote effects and native runtime
embedding are outside this repo's purpose. A Rust kit and renderer registration
API are not provided; future proposals require explicit ownership and acceptance,
not an inference from this vision. No novel obligations are ratified here.

Start at the [local contract v1](../contracts/client-kit.v1.md); its falsifiers and
checks make the direction reviewable. [Qualification](causal-journal-qualification.md)
records demonstrated evidence separately from these desired outcomes.
