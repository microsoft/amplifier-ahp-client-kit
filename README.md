# Amplifier client kit

Start with the [local vision](docs/VISION.md), [contract v1](contracts/client-kit.v1.md) and [contributor entry point](AGENTS.md). They apply the approved family direction; qualification is recorded separately.

Protocol and persistence primitives for independent JavaScript clients. No React, web product selectors, native runtime imports, or sibling checkout dependencies.

- `ConfirmedResources`: official AHP reducers, per-resource confirmed baselines, duplicate sequence suppression, explicit missing-baseline result and eviction.
- `openConnection`: transport-agnostic official AHP JSON-RPC client; event reader registered before handshake.
- `recoverConnection`: upstream initialize/reconnect snapshot/replay flow, missing baseline fresh initialization, explicit pending-action discard signal. Catalog refresh and reconnect retry timing remain the caller's application policy.
- `IntentJournal`: captures the original target/action before asynchronous storage, records intent durably before dispatch, and serializes admission and settlement per identity on the same storage adapter. Settlement preserves original identity/payload and earlier receipt details; it never retries unknown work. The storage contract is asynchronous `read(key)` and durable `write(key,value)`.
- `@amplifier/ahp-client-kit/indexeddb`: scoped browser store, isolated by host/account/tab, for private drafts, blobs, journal records and optional disposable caches. Consumers supply their authenticated nonsecret account identity.

Browser and file writes capture their supported value before waiting for storage
readiness or queued durability. Later edits to a private draft object cannot
change an earlier submitted write. Unsupported values reject without a saved
record; a later explicit valid write remains possible. File storage supports
JSON values; browser storage supports structured-clone values, including blobs.

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

`--agent` selects a host-advertised ACP agent for a new session. A resumed
session keeps its original agent, workspace and configuration. Hosts advertising
`managedCreation` v1 also support new managed chats with configured bundle aliases
and typed provider-instance/model selections:

```sh
amplifier-ahp run --server wss://your-host/ahp --token-file host-token.txt \
  --managed --agent amplifier --bundle work --provider work-openai \
  --model YOUR_MODEL --effort low --prompt-file request.txt --command managed-input
```

`--managed` cannot be combined with `--session` or `--workspace`. The optional
`--bundle` is an exact advertised alias, not a file or source URL; its revision
is read and bound before creation. `--provider` names the configured provider
**instance**, separate from the ACP `--agent`, and requires `--model` (and vice
versa). `--effort` requires that pair. These options never reconfigure a resumed
session. Omitted selections retain native defaults; unavailable negotiation,
bundle or provider instance refuses before creation without a fallback. A model
name is passed exactly; a successful creation does not establish model/account
availability until the explicitly requested input executes.

Managed creation has a separately saved original creation command, target session
and frozen request. A lost creation acknowledgement is recovered with the host's
exact passive receipt. Even after creation is confirmed, that recovery never sends
an input. If the original local attempt conclusively stopped before delivery,
the result says `not-sent`; explicitly use the returned `--session` with a new
input command. A still-running or interrupted local admission stays unconfirmed. Unknown receipts stay unknown; current settings are never used as
proof of an earlier command.
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

Managed flags qualification uses `AHP_HEADLESS_HOST_MODULE` and
`AHP_HEADLESS_NATIVE_PYTHON` with `test/managed-native.test.mjs`. The fixture owns
all home/settings/state paths, supplies an offline public Core provider, guards
real shared settings/keys against changes, and verifies bundle/instance/model/effort
on an explicit input and cold continuation. It does not establish real account,
remote model, current deployment or physical terminal acceptance. Failures retain
the owned fixture; `AHP_HEADLESS_KEEP_FIXTURE=1` also retains success evidence.
