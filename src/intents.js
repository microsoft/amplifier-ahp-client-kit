import {exclusive} from './intent-lock.js';
import {IntentCorrelations} from './intent-correlations.js';

/** Async storage interface: read(key) -> value, write(key,value) -> durable promise. */
export class IntentJournal {
 constructor(storage, correlationOptions = {}) { this.storage = storage; this.correlations = new IntentCorrelations(storage, {scope: 'ahp', ...correlationOptions}); }
 async begin(id, {channel, action}) {
  if (typeof id !== 'string' || !id) throw Error('A durable command identity is required');
  // Capture intent before the first await: the caller may replace or edit its
  // private draft while the storage adapter is reading the original identity.
  const payload = structuredClone({channel, action});
  return exclusive(this.storage, `intent:${id}`, async () => {
   const existing = await this.storage.read(`intent:${id}`);
   if (existing) return {created: false, intent: existing};
   const intent = {id, ...payload, status: 'unknown', createdAt: Date.now()};
   await this.storage.write(`intent:${id}`, intent);
   return {created: true, intent};
  });
 }
 async settle(id, status, details = {}) {
  if (!['accepted', 'rejected', 'unknown', 'completed'].includes(status)) throw Error('Invalid command outcome');
  const captured = structuredClone(details);
  return exclusive(this.storage, `intent:${id}`, async () => {
   const old = await this.storage.read(`intent:${id}`);
   if (!old) throw Error('Unknown durable command');
   if (old.echoReceipt && status !== old.status) throw Error('Confirmed original echo outcome cannot be replaced');
   const intent = {...old, ...captured, id: old.id, channel: old.channel, action: old.action, createdAt: old.createdAt, status,
    ...(old.dispatchCorrelation ? {dispatchCorrelation: old.dispatchCorrelation} : {}),
    ...(old.echoReceipt ? {echoReceipt: old.echoReceipt, rejectionReason: old.rejectionReason} : {})};
   await this.storage.write(`intent:${id}`, intent);
   return intent;
  });
 }
 bindDispatch(id, binding) { return this.correlations.bindDispatch(id, binding); }
 async acceptEcho(envelope) { const result = await this.correlations.settleEcho(envelope); return result.matched ? {id: result.intent.id, status: result.intent.status, intent: result.intent, correlation: result.correlation, ...(result.retirementError ? {retirementError: result.retirementError} : {})} : null; }
 read(id) { return this.storage.read(`intent:${id}`); }
}
export class MemoryStorage {
 constructor() { this.records = new Map(); }
 async read(key) { return structuredClone(this.records.get(key)); }
 async write(key, value) { this.records.set(key, structuredClone(value)); }
}
