const admissions=new WeakMap();
/** Async storage interface: read(key) -> value, write(key,value) -> durable promise. */
export class IntentJournal {
 constructor(storage){this.storage=storage;}
 async begin(id,payload){let keys=admissions.get(this.storage);if(!keys){keys=new Map();admissions.set(this.storage,keys);}const previous=keys.get(id)||Promise.resolve();const operation=previous.catch(()=>{}).then(()=>this.beginDurable(id,payload));keys.set(id,operation);try{return await operation}finally{if(keys.get(id)===operation)keys.delete(id);}}
 async beginDurable(id,{channel,action}){if(typeof id!=='string'||!id)throw Error('A durable command identity is required');const existing=await this.storage.read(`intent:${id}`);if(existing)return {created:false,intent:existing};const intent={id,channel,action,status:'unknown',createdAt:Date.now()};await this.storage.write(`intent:${id}`,intent);return {created:true,intent};}
 async settle(id,status,details={}){if(!['accepted','rejected','unknown','completed'].includes(status))throw Error('Invalid command outcome');const old=await this.storage.read(`intent:${id}`);if(!old)throw Error('Unknown durable command');const intent={...old,...details,status};await this.storage.write(`intent:${id}`,intent);return intent;}
 read(id){return this.storage.read(`intent:${id}`);}
}
export class MemoryStorage{constructor(){this.records=new Map();}async read(key){return structuredClone(this.records.get(key));}async write(key,value){this.records.set(key,structuredClone(value));}}
