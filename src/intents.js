const operations = new WeakMap();

// Serialize each identity on the same adapter, including settlements. Storage
// adapters used across processes must supply their own exclusive admission.
async function exclusive(storage, id, run) {
 let keys = operations.get(storage);
 if (!keys) { keys = new Map(); operations.set(storage, keys); }
 const previous = keys.get(id) || Promise.resolve();
 const operation = previous.catch(() => {}).then(run);
 keys.set(id, operation);
 try { return await operation; }
 finally { if (keys.get(id) === operation) keys.delete(id); }
}

/** Async storage interface: read(key) -> value, write(key,value) -> durable promise. */
export class IntentJournal {
 constructor(storage) { this.storage = storage; }
 async begin(id, {channel, action}) {
  if (typeof id !== 'string' || !id) throw Error('A durable command identity is required');
  // Capture intent before the first await: the caller may replace or edit its
  // private draft while the storage adapter is reading the original identity.
  const payload = structuredClone({channel, action});
  return exclusive(this.storage, id, async () => {
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
  return exclusive(this.storage, id, async () => {
   const old = await this.storage.read(`intent:${id}`);
   if (!old) throw Error('Unknown durable command');
   const intent = {...old, ...captured, id: old.id, channel: old.channel, action: old.action, createdAt: old.createdAt, status};
   await this.storage.write(`intent:${id}`, intent);
   return intent;
  });
 }
 read(id) { return this.storage.read(`intent:${id}`); }
}
export class MemoryStorage {
 constructor() { this.records = new Map(); }
 async read(key) { return structuredClone(this.records.get(key)); }
 async write(key, value) { this.records.set(key, structuredClone(value)); }
}
