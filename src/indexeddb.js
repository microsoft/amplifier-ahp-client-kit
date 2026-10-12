// Browser adapter for the client kit storage interface. No host network activity.
export class ScopedIndexedDBStore {
 constructor({host,account,tab,database='amplifier-client-state',indexedDB=globalThis.indexedDB}){if([host,account,tab].some(value=>typeof value!=='string'||!value))throw Error('Host, account and tab identity are required');this.database=database;this.scope=JSON.stringify([host,account,tab]);this.indexedDB=indexedDB;this.tail=Promise.resolve();}
 async open(){if(this.db)return this;if(this.opening)return this.opening;this.opening=(async()=>{const db=await new Promise((resolve,reject)=>{if(!this.indexedDB)return reject(Error('Private storage is unavailable. Your drafts cannot survive a restart.'));const request=this.indexedDB.open(this.database,1);request.onupgradeneeded=()=>request.result.createObjectStore('records');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||Error('Private storage request failed'))});this.db=db;db.onclose=()=>{if(this.db===db)this.db=null;};db.onversionchange=()=>{db.close();if(this.db===db)this.db=null;};return this;})();try{return await this.opening}finally{this.opening=null;}}
 // A closed connection can reject transaction creation before any request was
 // admitted. Reopen once at that boundary only; never retry a created transaction.
 async transaction(mode='readonly'){
  for(let attempt=0;attempt<2;attempt++){
   await this.open();const db=this.db;
   try{return db.transaction('records',mode)}catch(error){
    if(attempt||error?.name!=='InvalidStateError')throw error;
    if(this.db===db){this.db=null;db.close();}
   }
  }
 }
 key(key){return `${this.scope}:${key}`}
 async read(key){const tx=await this.transaction();return new Promise((resolve,reject)=>{const request=tx.objectStore('records').get(this.key(key));request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||Error('Private storage request failed'))});}
 write(key,value){let captured;try{captured=structuredClone(value)}catch(error){return Promise.reject(error)}const operation=this.tail.then(async()=>{const tx=await this.transaction('readwrite');await new Promise((resolve,reject)=>{tx.objectStore('records').put(captured,this.key(key));tx.oncomplete=()=>resolve();tx.onerror=event=>reject(event.target?.error||tx.error||Error('Private storage transaction failed'));tx.onabort=()=>reject(tx.error||Error('Private storage transaction aborted'))});});this.tail=operation.catch(()=>{});return operation;}
 close(){this.db?.close();this.db=null;}
}
