# Amplifier client kit

Protocol and persistence primitives for independent JavaScript clients. No React, web product selectors, native runtime imports, or sibling checkout dependencies.

- `ConfirmedResources`: official AHP reducers, per-resource confirmed baselines, duplicate sequence suppression, explicit missing-baseline result and eviction.
- `openConnection`: transport-agnostic official AHP JSON-RPC client; event reader registered before handshake.
- `recoverConnection`: upstream initialize/reconnect snapshot/replay flow, missing baseline fresh initialization, explicit pending-action discard signal. Catalog refresh and reconnect retry timing remain the caller's application policy.
- `IntentJournal`: captures the original target/action before asynchronous storage, records intent durably before dispatch, and serializes admission and settlement per identity on the same storage adapter. Settlement preserves original identity/payload and earlier receipt details; it never retries unknown work. The storage contract is asynchronous `read(key)` and durable `write(key,value)`.
- `@amplifier/ahp-client-kit/indexeddb`: scoped browser store, isolated by host/account/tab, for private drafts, blobs, journal records and optional disposable caches. Consumers supply their authenticated nonsecret account identity.

```js
import {ConfirmedResources, openConnection, recoverConnection, IntentJournal} from '@amplifier/ahp-client-kit';
const store = new ConfirmedResources();
const {client, events} = await openConnection({url: 'ws://localhost:8765/ahp'});
const handshake = await recoverConnection(client, {store, clientId: crypto.randomUUID(), subscriptions: new Set(['ahp-root://'])});
// Buffer events while recovering, then apply the buffer. Refresh listSessions.
// On every reconnect clear pending optimistic actions; keep durable intent.
```

AHP is normative: https://microsoft.github.io/agent-host-protocol/ . This package does not add a wire protocol, own sessions, guarantee exactly-once effects, or decide how an app renders state. Applications must not interpret the global sequence's gaps as missing subscribed-resource actions. Consumers must cap resource interest and durable storage retention according to their requirements. Never silently truncate authoritative state; unsubscribe/resubscribe when disposing a baseline.

`npm ci && npm test` runs independently without model accounts. `npm pack` produces the publishable package. Qualification currently installs the resulting archive in the web consumer; no registry publication is implied.

The intended repository is `microsoft/amplifier-ahp-client-kit`. Repository metadata names the intended publication destination; no remote or registry publication is implied.

## Noninteractive client

The installed `amplifier-ahp` executable uses Node 22.16+ and the same public AHP
surface as interactive clients. It submits through the host's configured agent,
including its real provider/model defaults. It never loads a native runtime in the
client. Headless helpers are available from the optional `./headless` and
`./file-storage` entrypoints; `./cli` is the executable entrypoint for distribution launchers. importing the browser entrypoint does not load Node
storage or WebSocket implementations.

```sh
amplifier-ahp run --server wss://your-host/ahp --token-file host-token.txt \
  --workspace /host/work/project --prompt-file request.txt --command first-input
amplifier-ahp run --server wss://your-host/ahp --token-file host-token.txt \
  --session ahp-session:/SESSION_ID --prompt-file follow-up.txt --command next-input \
  --output json
amplifier-ahp inspect --server wss://your-host/ahp --token-file host-token.txt \
  --command first-input --output json
```

`--agent` selects a host-advertised agent for a new session. A resumed session
keeps its original agent and workspace. Bundle/provider/model overrides are not
invented by this CLI; they remain configured by that agent's advertised settings.
The host URI, session ID, command ID and original prompt are saved privately before
session creation or prompt delivery. State is scoped by host and credential
identity; supply a stable `--identity` when rotating a token. Keep these local
records to inspect an interrupted command. Reusing an ID only observes its original
input; changing its payload is rejected. A crashed command lock is never stolen.
Lost create acknowledgements are also never retried. Hosts without receipt
extensions still support standard current-page recovery; older absent output stays
unconfirmed instead of triggering an unbounded history scan or another prompt.

Text and JSON emit the final result. `--output jsonl --trace` explicitly includes
selected-session actions, which can contain private prompt/tool content. Trace
output and recovery queues are bounded; a slow consumer disconnects without
cancelling or replaying host work. `--wait-ms` bounds observation (a handshake or
in-flight request may finish later). Exit codes are 0 completed, 1 rejected or
failed, 2 invalid invocation, 3 running or unconfirmed, and 4 interactive input
needed. The CLI never grants approvals automatically and never cancels merely
because a wait, connection, or process ends.

`AHP_HEADLESS_HOST_MODULE=/absolute/installed-host/dist/index.js npm test` adds
public installed-host tests for real CLI invocation, bearer authentication,
multiple inputs, approval handoff, lost acknowledgement and no replay. Those
fixtures use a provider-free ACP peer; they do not establish real-model acceptance.
Filesystem durability is currently qualified on POSIX systems.

## Journal integration boundary

Send the captured `begin(...).intent.action` to the captured `intent.channel` only after a newly created admission completes. Editing a newer private draft must not change the admitted input. Reusing an identity returns the original record without dispatch; callers remain responsible for detecting conflicting reuse. Route echo and receipt updates through `settle` on the same adapter object to preserve concurrent evidence. Distinct adapter instances, tabs and processes require storage-owned transactions or exclusive claims; this in-process queue does not provide cross-process admission. A failed write rejects without dispatch or automatic retry. No subscription, cache policy or UI state is added by the journal.
