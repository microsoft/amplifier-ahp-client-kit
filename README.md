# Amplifier client kit

Protocol and persistence primitives for independent JavaScript clients. No React, web product selectors, native runtime imports, or sibling checkout dependencies.

- `ConfirmedResources`: official AHP reducers, per-resource confirmed baselines, duplicate sequence suppression, explicit missing-baseline result and eviction.
- `openConnection`: transport-agnostic official AHP JSON-RPC client; event reader registered before handshake.
- `recoverConnection`: upstream initialize/reconnect snapshot/replay flow, missing baseline fresh initialization, explicit pending-action discard signal. Catalog refresh and reconnect retry timing remain the caller's application policy.
- `IntentJournal`: durable intent recorded before dispatch, separately settled after echo/rejection or receipt; it never retries unknown work. The storage contract is asynchronous `read(key)` and durable `write(key,value)`.
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

The intended repository/package names are `amplifier-unified-client-web` / `@amplifier/unified-client-web`. Independent primitives are packaged as `@amplifier/ahp-client-kit`; Unified-specific schemas are `@amplifier/unified-protocol-extensions`. Both are installed from their checked-in `vendor/` archives for reproducible local integration until registry publication. This repository does not import another checkout's private source. Repository URL metadata names the intended publication destination and does not mean a remote was created.

Client-local actions and AHP client-provided tools are described in [the capability seam](docs/capability-seam.md). The real browser fixture checks targeted agent inspection/UI action as well as drafts, reload, duplicate-tab isolation and shared conversation updates. Native accounts, audio/video hardware, publication and the remaining optional capability providers have separate acceptance boundaries.
