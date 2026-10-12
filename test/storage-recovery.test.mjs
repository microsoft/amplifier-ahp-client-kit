import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory,forceCloseDatabase} from 'fake-indexeddb';
const entry=process.env.AHP_STORAGE_PACKAGE_ENTRY;
const {ScopedIndexedDBStore}=await import(entry?new URL('./indexeddb.js',entry):'../src/indexeddb.js');

function fixture(){
 const factory=new IDBFactory();let opens=0;
 const indexedDB={open(...args){opens++;return factory.open(...args);}};
 const options={host:'fixture',account:'owned',tab:'original',indexedDB};
 return {factory,store:new ScopedIndexedDBStore(options),other:new ScopedIndexedDBStore({...options,tab:'other'}),get opens(){return opens;}};
}
test('closed browser connection reopens without losing drafts, unknown intents or tab isolation',async()=>{
 const f=fixture(),draft={text:'keep unsent',quote:{messageId:'saved-message'},bytes:new Uint8Array([1,2,3])};
 const intent={commandId:'original',status:'unknown',text:'never resend'};
 try{
  await f.store.write('draft',draft);await f.store.write('intent',intent);
  const closed=f.store.db;closed.close();
  const [read]=await Promise.all([f.store.read('draft'),f.store.write('later',{text:'newer unsent'})]);
  assert.deepEqual(read,draft);assert.deepEqual(await f.store.read('intent'),intent);
  assert.equal(f.opens,2,'concurrent recovery shares one reopened connection');
  assert.notEqual(f.store.db,closed);
  assert.equal(await f.other.read('draft'),undefined);
  assert.equal(await f.other.read('intent'),undefined);
 }finally{f.store.close();f.other.close();}
});
test('unexpected close clears the connection while retaining its records',async()=>{
 const f=fixture();try{
  await f.store.write('draft','saved');const db=f.store.db;
  const closed=new Promise(resolve=>db.addEventListener('close',resolve,{once:true}));
  forceCloseDatabase(db);await closed;assert.equal(f.store.db,null);
  assert.equal(await f.store.read('draft'),'saved');assert.equal(f.opens,2);
 }finally{f.store.close();f.other.close();}
});
test('version-change relinquishes the old connection',async()=>{
 const f=fixture();try{
  await f.store.write('draft','saved');const db=f.store.db;
  const upgrade=f.factory.open(f.store.database,2);
  const upgraded=await new Promise((resolve,reject)=>{upgrade.onsuccess=()=>resolve(upgrade.result);upgrade.onerror=()=>reject(upgrade.error);});
  assert.equal(f.store.db,null);assert.throws(()=>db.transaction('records'),{name:'InvalidStateError'});
  upgraded.close();await assert.rejects(f.store.read('draft'),{name:'VersionError'});
 }finally{f.store.close();f.other.close();}
});
test('a created transaction that aborts is not retried and leaves the prior draft intact',async()=>{
 const f=fixture();try{
  await f.store.write('draft','original');const db=f.store.db,transaction=db.transaction.bind(db);let transactions=0;
  db.transaction=(...args)=>{transactions++;const tx=transaction(...args),records=tx.objectStore('records'),put=records.put.bind(records);records.put=(...values)=>{const request=put(...values);queueMicrotask(()=>tx.abort());return request;};return tx;};
  await assert.rejects(f.store.write('draft','should not persist'),{name:'AbortError'});
  assert.equal(transactions,1);assert.equal(f.opens,1);
  db.transaction=transaction;assert.equal(await f.store.read('draft'),'original');
  await f.store.write('draft','explicit later save');assert.equal(await f.store.read('draft'),'explicit later save');
 }finally{f.store.close();f.other.close();}
});
test('reopening is bounded to one attempt and other creation failures do not reopen',async()=>{
 for(const [name,expected]of [['InvalidStateError',2],['QuotaExceededError',1]]){
  const f=fixture();let attempts=0;
  f.store.open=async()=>{f.store.db={close(){},transaction(){attempts++;throw new DOMException('Owned failure',name);}};return f.store;};
  await assert.rejects(f.store.write('draft','unsaved'),{name});assert.equal(attempts,expected);
  f.store.close();
 }
});
