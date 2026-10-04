const operations = new WeakMap();

// Serialize each identity on the same adapter, including settlements. Storage
// adapters used across processes must supply their own exclusive admission.
export async function exclusive(storage, id, run) {
 let keys = operations.get(storage);
 if (!keys) { keys = new Map(); operations.set(storage, keys); }
 const previous = keys.get(id) || Promise.resolve();
 const operation = previous.catch(() => {}).then(run);
 keys.set(id, operation);
 try { return await operation; }
 finally { if (keys.get(id) === operation) keys.delete(id); }
}

