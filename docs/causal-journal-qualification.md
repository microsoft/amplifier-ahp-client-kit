# Causal journal qualification (2026-10-03)

The client kit baseline is `de17dde1a432d133a93ebc4d587a0bce945c70aa`.
The reviewed consumers are web `af015ed97fc2c94db889d5dee66ad65559cd2f0c`
and TUI `512bacb47c79e3abe44638f39ad5b7e7b62501b9`. Both were fetched
independently; their tracked source was unchanged. Upstream SDK 0.9.0 owns
reducers, request types and replay semantics.

## Consumer audit

- Web `src/ahp/client.js` uses kit recovery and official reducers, buffers actions
  during handshake/resource reads, bounds queues to 512 envelopes/2 MiB, requests
  50-turn selected snapshots, evicts deselected baselines, and resets connection-local
  catalog cursors. Presentation and drafts use asynchronous client-local storage.
- Web `src/ahp/capabilities.js` owns interest, invalidation coalescing and stale read
  guards. Its existing tests cover invalidation during baseline reads, hiding a panel
  during a read, accepting a newer revision, and reopening an action-cached panel.
  `tests/ahp-client.test.mjs` covers delayed new-draft detach against newer selection.
  These policies remain client-owned.
- TUI `ahp/bridge.js` imports official AHP SDK/reducers directly, requests 50-turn
  selected snapshots, unsubscribes old resources, buffers handshake frames, recovers
  through upstream reconnect, and clears pending writes. Python transport owns
  private drafts/journal and invalidates catalog cursors after reconnect. The Rust
  Ratatui renderer consumes its presentation bridge, not a Rust client-kit package.
  No Rust package or Rust client-kit consumer is provided by this repository.
- Headless kit consumers retain durable original command identity, fetch selected
  50-turn snapshots and inspect receipts without replay after lost replies.

## Scoped change and evidence

`IntentJournal.begin` captures its target/action before asynchronous storage;
`settle` uses the same per-identity queue and preserves immutable original fields.
Concurrent receipt/output settlements retain both sets of details. The queue is
local to one adapter object; storage owners retain responsibility for cross-tab
or cross-process exclusivity. No public signature, protocol or reducer changes.
This implements CS1/CS2/CS4 and preserves WS5 proportional work: only the specific
intent record is copied/read/written, never the full app.

Three new causal tests fail against the baseline and pass against the candidate:
mutable admission payload, settlement before admission durability, and concurrent
settlement evidence. Additional tests cover failed durable write recovery and
valid global sequence gaps with buffered duplicate suppression.

On Node 25.2.1, source suite: 13 passed, 5 skipped, 0 failed. The five skips require
an independently installed host; the native case additionally requires an installed
Core/Foundation fixture provider. Fresh archive consumer: 11 passed, 0 skipped.
Strict TypeScript consumer compilation passes with upstream declaration checking
skipped (`--skipLibCheck`); the kit declarations and consumer are checked.
Installed archive in the unmodified web consumer: 39 passed, 0 skipped across
client, capability, canvas, queue, performance and conversation-window suites.

This does not establish browser/device/account acceptance, Rust renderer execution,
Node 22 verification, production adoption or native Core/Foundation execution for
this candidate. Historical baseline headless evidence is not counted as a fresh pass.

## Optional consumer follow-up

Web dispatch currently sends the caller's action object after journal admission.
Consumers should dispatch the captured `started.intent.action` to its captured
channel; the helper cannot stop a caller sending a later-mutated object. Web echo
settlement also writes directly to storage; routing that update through `settle`
would participate in this queue. These observations were sent to the distribution
coordinator for web-owner coordination; no consumer source was changed here.

## Reproduction

Run `npm ci && npm test` and `npm pack`, install the archive in a fresh directory,
and run the copied kit tests with imports pointed at the public package. For
headless integration set `AHP_HEADLESS_HOST_MODULE` to an installed host's
`dist/index.js`; set `AHP_HEADLESS_NATIVE_PYTHON` and
`AHP_HEADLESS_NATIVE_PROVIDER` for the native fixture case. Run the named web
suites after independently installing the archive into that consumer.
