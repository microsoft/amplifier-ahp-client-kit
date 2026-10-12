import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {indexedDB} from 'fake-indexeddb';
const entry=process.env.AHP_STORAGE_PACKAGE_ENTRY;
const {ScopedIndexedDBStore}=await import(entry?new URL('./indexeddb.js',entry):'../src/indexeddb.js');
const {FileStorage}=await import(entry?new URL('./file-storage.js',entry):'../src/file-storage.js');
const draft=()=>({name:'original',routing:{roles:{general:{candidates:[{provider:'fixture',model:'original-model'}]}}},bytes:new Uint8Array([1,2,3])});
test('transaction error exposes the failing request before transaction.error is set',async()=>{
 const store=new ScopedIndexedDBStore({host:'fixture',account:'fixture',tab:'failure'}),failure=new DOMException('Cannot store file','UnknownError');
 let attempts=0;
 store.db={transaction(){const tx={error:null,objectStore:()=>({put(){queueMicrotask(()=>{if(!attempts++){tx.onerror({target:{error:failure}});tx.onabort();}else tx.oncomplete();});}})};return tx;}};
 await assert.rejects(store.write('file',{bytes:[1]}),error=>error===failure);
 await store.write('later',{bytes:[2]});
});
function edit(value){value.name='later edit';value.routing.roles.general.candidates[0].model='later-model';value.bytes[0]=9;}
test('browser private write captures nested draft and bytes before queued durability',async()=>{
 const store=new ScopedIndexedDBStore({host:'fixture-host',account:'fixture-account',tab:crypto.randomUUID(),indexedDB});
 let release;store.tail=new Promise(resolve=>release=resolve);const value=draft(),expected=structuredClone(value),written=store.write('provider-routing-draft',value);edit(value);release();
 try{await written;assert.deepEqual(await store.read('provider-routing-draft'),expected);await store.write('newer-draft',value);assert.deepEqual(await store.read('newer-draft'),value);}finally{store.close();}
});
test('file private write captures JSON before directory readiness',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'kit-draft-capture-')),store=new FileStorage(directory);let release;
 const ready=store.ready.bind(store),gate=new Promise(resolve=>release=resolve);store.ready=async()=>{await gate;await ready();};
 const value=draft(),expected=JSON.parse(JSON.stringify(value)),written=store.write('provider-routing-draft',value);edit(value);release();
 try{await written;assert.deepEqual(await store.read('provider-routing-draft'),expected);assert.equal((await readdir(directory)).length,1);}finally{await rm(directory,{recursive:true,force:true});}
});
test('uncloneable browser draft rejects without poisoning the write queue',async()=>{
 const store=new ScopedIndexedDBStore({host:'fixture-host',account:'fixture-account',tab:crypto.randomUUID(),indexedDB});
 try{await assert.rejects(store.write('invalid',{callback(){}}));assert.equal(await store.read('invalid'),undefined);await store.write('valid',{text:'kept'});assert.deepEqual(await store.read('valid'),{text:'kept'});}finally{store.close();}
});
test('unserializable file draft rejects before creating any record',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'kit-draft-invalid-')),store=new FileStorage(directory),value={};value.self=value;
 try{await assert.rejects(store.write('invalid',value));assert.deepEqual(await readdir(directory),[]);await store.write('valid',{text:'kept'});assert.deepEqual(await store.read('valid'),{text:'kept'});}finally{await rm(directory,{recursive:true,force:true});}
});
