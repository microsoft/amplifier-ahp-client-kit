import {rootReducer,sessionReducer,chatReducer,terminalReducer,changesetReducer,resourceWatchReducer,annotationsReducer,automationReducer,automationRunReducer} from '@microsoft/agent-host-protocol';
const reducers=new Map([['ahp-root',rootReducer],['ahp-session',sessionReducer],['ahp-chat',chatReducer],['ahp-terminal',terminalReducer],['ahp-changeset',changesetReducer],['ahp-resource-watch',resourceWatchReducer],['ahp-annotations',annotationsReducer],['ahp-automations',automationReducer],['ahp-automation-run',automationRunReducer]]);
/** Confirmed protocol state only. Never UI state, durable history or unsent work. */
export class ConfirmedResources {
 constructor(){this.resources=new Map();this.sequences=new Map();this.serverSeq=0;}
 hasBaseline(subscriptions){return this.resources.size>0&&[...subscriptions].every(uri=>this.resources.has(uri));}
 snapshot(snapshot){if(!Number.isSafeInteger(snapshot.fromSeq)||snapshot.fromSeq<0)throw Error('Invalid snapshot sequence');this.resources.set(snapshot.resource,snapshot.state);this.sequences.set(snapshot.resource,snapshot.fromSeq);this.serverSeq=Math.max(this.serverSeq,snapshot.fromSeq);}
 apply(envelope){const {channel,serverSeq,action,rejectionReason}=envelope;if(!Number.isSafeInteger(serverSeq))throw Error('Invalid action sequence');this.serverSeq=Math.max(this.serverSeq,serverSeq);if(rejectionReason)return 'rejected';if(serverSeq<=(this.sequences.get(channel)??-1))return 'duplicate';if(!this.resources.has(channel))return 'missing-baseline';const reduce=channel.startsWith('ahp-session:')&&channel.endsWith('/annotations')?annotationsReducer:reducers.get(channel.split(':',1)[0]);if(!reduce)return 'unknown-channel';this.resources.set(channel,reduce(this.resources.get(channel),action));this.sequences.set(channel,serverSeq);return 'applied';}
 evict(uri){this.resources.delete(uri);this.sequences.delete(uri);}
 clear(){this.resources.clear();this.sequences.clear();}
}
