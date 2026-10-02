import {AhpClient} from '@microsoft/agent-host-protocol/client';
import {WebSocketTransport} from '@microsoft/agent-host-protocol/ws';
/** Open only transport/JSON-RPC. Observe events before issuing handshake requests. */
export async function openConnection({url,transportFactory=()=>WebSocketTransport.connect(url),clientConfig}={}){const transport=await transportFactory();const client=new AhpClient(transport,clientConfig);const events=client.events();client.connect();return {client,events,transport};}
/**
 * Upstream recovery is the only authority. Notification-only catalogs must be
 * refetched by the consumer. A missing local baseline always initializes afresh.
 * The caller buffers concurrently arriving events until this function resolves,
 * then applies them through ConfirmedResources (which discards duplicate echoes).
 */
export async function recoverConnection(client,{store,clientId,subscriptions,initialized=false,protocolVersions=['0.9.0'],clientInfo,initialSubscriptions=['ahp-root://']}){
 if(initialized&&store.hasBaseline(subscriptions)){const result=await client.reconnect({channel:'ahp-root://',clientId,lastSeenServerSeq:store.serverSeq,subscriptions:[...subscriptions]});if(result.type==='replay'){for(const action of result.actions)store.apply(action);for(const uri of result.missing)store.evict(uri);return {...result,discardPending:true};}store.clear();for(const snapshot of result.snapshots)store.snapshot(snapshot);return {...result,discardPending:true};}
 const initialization=await client.initialize({channel:'ahp-root://',clientId,protocolVersions,clientInfo,initialSubscriptions});if(!protocolVersions.includes(initialization.protocolVersion))throw Error('Host selected an unoffered AHP version');store.clear();for(const snapshot of initialization.snapshots)store.snapshot(snapshot);store.serverSeq=initialization.serverSeq;return {type:'initialize',initialization,subscriptions:new Set(initialSubscriptions),discardPending:true};
}
