# AHP client mechanisms — v1

Status: inherited approved direction, applied to this repository's existing API.
This entry point adds no wire schema, scope approval or independent ratification.
Upstream [AHP](https://microsoft.github.io/agent-host-protocol/) is authoritative;
[API declarations](../src/index.d.ts), [headless API](../src/headless.d.ts) and
[README](../README.md) describe package entry points. Protocol support currently
negotiates AHP 0.9.0; changing it requires compatibility evidence.

## Authority and ownership

The shared sources are the approved
[family vision](https://github.com/microsoft/amplifier-unified/blob/main/docs/architecture/VISION.md),
[HP1–6](https://github.com/microsoft/amplifier-unified/blob/main/contracts/host-protocol.v1.md),
[CS1–4/7–9](https://github.com/microsoft/amplifier-unified/blob/main/contracts/client-state.v1.md),
[WS3–5](https://github.com/microsoft/amplifier-unified/blob/main/contracts/working-set.v1.md),
[CB1–6](https://github.com/microsoft/amplifier-unified/blob/main/contracts/component-boundaries.v1.md)
and [CD1–6](https://github.com/microsoft/amplifier-unified/blob/main/contracts/client-development.v1.md).
The kit supports [CX2/3/7](https://github.com/microsoft/amplifier-unified/blob/main/contracts/client-experience.v1.md)
without owning interactive UI acceptance. [AP1–5](https://github.com/microsoft/amplifier-unified/blob/main/contracts/agent-protocol.v1.md)
remains the host/agent boundary: a kit fixture involving ACP does not make this
package an ACP adapter or native history owner. Refer to those sources rather than
copying their normative definitions. New behavioral scope must be proposed to its
owner before this packet is revised to promise it.

## Public promises, falsifiers and checks

| Local application | Promise and boundary | Concrete falsifier | Existing executable evidence |
| --- | --- | --- | --- |
| CK1 · HP1/3, CB2/3 | Apply official reducers to confirmed resource baselines; negotiate offered versions and recover via upstream initialize/reconnect. No guessed empty baseline or private replay protocol. | Missing baseline receives a delta; rejection/duplicate mutates it; global sequence gap invents lost subscribed actions. | [kit tests](../test/kit.test.mjs): official reducer, missing baseline, recovery metadata and global-gap cases. |
| CK2 · CS1/2/4, WS5 | Capture original intent before asynchronous storage; durably record it before consumer dispatch. Admission/settlement on the same adapter serialize per identity and preserve original fields and earlier receipt details. | A newer private draft changes the admitted payload; settlement overwrites original identity or drops concurrent receipt evidence. | Kit tests: admission capture, settlement during admission, concurrent settlement, failed durable write. |
| CK3 · CS2, CB2 | Private storage is client-local and explicitly scoped by host/account/tab; browser imports do not embed Node/native runtime. No private draft upload or UI/global store. | Another identity reads a private draft; an ordinary local write sends a backend mutation. | Kit test: browser identity isolation and durable completion. Import/architecture boundary is source-inspected; no general network instrumentation pass is claimed. |
| CK4 · CS4, HP4/6, CX3 | Headless commands save original identity/payload before creation/delivery. Reuse observes original work; unknown replies do not replay, approve or cancel accepted work. Receipt extensions are optional; standard bounded current-page observation remains available. | Lost reply sends another prompt; timeout cancels work; approval is silently granted; conflicting command reuse dispatches. | [headless tests](../test/headless.test.mjs): durable ownership, validation, installed host continuation, lost reply, approval, CLI and native continuation. |
| CK5 · HP2, WS3/4, CB1/4, CD5/6 | Keep cache/history authority separate; expose resource eviction and selected headless windows. Require independent packed-consumer evidence and explicit qualification limits. | Clearing a cache deletes history; a library test is reported as deployed browser/device acceptance. | Kit eviction test; installed headless checks; [qualification record](../docs/causal-journal-qualification.md). Whole UI working-set acceptance belongs to client owners. |

## Consumer obligations

- Buffer concurrently arriving actions during recovery/resource reads; apply them
  after authoritative snapshots and discard protocol pending actions when signalled.
  Refetch notification-only catalogs; do not reuse connection-local catalog cursors.
- Dispatch the captured intent's target/action only after newly created admission
  completes. Detect conflicting identity reuse. Settle echo/receipt updates through
  the same adapter's journal queue; do not automatically dispatch an existing intent.
- Supply durable asynchronous storage and visible failure handling. Distinct adapter
  objects, tabs/processes need storage-owned atomicity/exclusive claims. The journal
  queue is not cross-process exclusion. Preserve private drafts independently of
  disposable protocol state and provide authenticated nonsecret account identity.
- Bound interest, selected windows, queues and local storage under client policy.
  Eviction must unsubscribe/resubscribe to obtain fresh baselines, never silently
  truncate required authoritative state. The kit does not impose a global cache.
- Keep host authorization, execution/admission receipts, native history and device
  effect permissions with their owners; missing optional capability is explicit.

## Acceptance boundary

`npm ci && npm test` runs the source fixture checks. Installed host/native tests
require the documented `AHP_HEADLESS_*` inputs and otherwise skip explicitly.
Pack with `npm pack`, install that archive in an independent consumer, and record
its hash, runtime, peers and pass/skip counts. Declaration compilation is separate
from runtime and client/browser acceptance. These commands do not publish or deploy.

The [qualification record](../docs/causal-journal-qualification.md) identifies the
sealed implementation and completed Node22/Node25, native fixture and web checks.
Physical devices, real provider/account use, deployed adoption, Rust renderer
execution, cross-process generic journal admission and exhaustive storage-failure
coverage are unqualified. These are limits of evidence, not permission to weaken
the inherited promises. The exact minimum patch Node22.16 is not separately tested.
