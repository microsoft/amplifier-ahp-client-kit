import test from 'node:test';import assert from 'node:assert/strict';import {ConfirmedResources,IntentJournal,MemoryStorage,recoverConnection} from '../src/index.js';import {ScopedIndexedDBStore} from '../src/indexeddb.js';import {indexedDB} from 'fake-indexeddb';
const snapshot={resource:'ahp-chat:/one',fromSeq:10,state:{resource:'ahp-chat:/one',title:'One',status:1,modifiedAt:'now',turns:[]}};
test('official chat reducer changes only subscribed baseline; rejection/duplicates do not mutate',()=>{const store=new ConfirmedResources();store.snapshot(snapshot);const event={channel:snapshot.resource,serverSeq:12,action:{type:'chat/turnStarted',turnId:'t',startedAt:'now',message:{text:'hello',origin:{kind:'user'}}}};assert.equal(store.apply(event),'applied');assert.equal(store.resources.get(snapshot.resource).activeTurn.id,'t');assert.equal(store.apply(event),'duplicate');const current=store.resources.get(snapshot.resource);assert.equal(store.apply({...event,serverSeq:13,rejectionReason:'No'}),'rejected');assert.equal(store.resources.get(snapshot.resource),current);assert.equal(store.apply({...event,channel:'ahp-chat:/absent',serverSeq:14}),'missing-baseline');assert.equal(store.resources.size,1);});
test('missing baseline initializes; valid baseline requests upstream reconnect and eviction',async()=>{const store=new ConfirmedResources();let calls=[];const client={async initialize(params){calls.push(['initialize',params]);return {protocolVersion:'0.9.0',serverSeq:10,snapshots:[snapshot]};},async reconnect(params){calls.push(['reconnect',params]);return {type:'replay',actions:[],missing:['ahp-chat:/one']};}};await recoverConnection(client,{store,clientId:'c',subscriptions:new Set(['ahp-chat:/one']),initialized:true});assert.equal(calls[0][0],'initialize');const result=await recoverConnection(client,{store,clientId:'c',subscriptions:new Set(['ahp-chat:/one']),initialized:true});assert.equal(calls[1][0],'reconnect');assert.equal(result.discardPending,true);assert.equal(store.resources.size,0);});
test('durable journal is independent of disposable protocol baseline and never resubmits unknown',async()=>{const storage=new MemoryStorage(),journal=new IntentJournal(storage);const intent={channel:'ahp-chat:/one',action:{type:'chat/turnStarted'}};assert.equal((await journal.begin('id',intent)).created,true);assert.equal((await journal.begin('id',intent)).created,false);assert.equal((await journal.read('id')).status,'unknown');await journal.settle('id','accepted');assert.equal((await journal.read('id')).status,'accepted');});
test('browser private store isolates identities and waits for durable completion',async()=>{const a=new ScopedIndexedDBStore({host:'host',account:'a',tab:'tab',indexedDB}),b=new ScopedIndexedDBStore({host:'host',account:'b',tab:'tab',indexedDB});await a.write('draft',{text:'private',blob:new Blob(['data'])});assert.equal((await a.read('draft')).text,'private');assert.equal(await b.read('draft'),undefined);a.close();b.close();});
test('concurrent admission with identical identity is durable only once',async()=>{const storage=new MemoryStorage();const first=new IntentJournal(storage),second=new IntentJournal(storage);const outcomes=await Promise.all([first.begin('same',{channel:'c',action:{}}),second.begin('same',{channel:'c',action:{}})]);assert.equal(outcomes.filter(x=>x.created).length,1);});

test('initialization metadata is explicit and absent from upstream reconnect',async()=>{const store=new ConfirmedResources();const calls=[];const client={async initialize(params){calls.push(params);return {protocolVersion:'0.9.0',serverSeq:1,snapshots:[{...snapshot,fromSeq:1}]};},async reconnect(params){calls.push(params);return {type:'replay',actions:[],missing:[]};}};const options={store,clientId:'c',subscriptions:new Set(['ahp-chat:/one']),initialized:true,initializationMeta:{'example/client':{id:'legacy'}}};await recoverConnection(client,options);await recoverConnection(client,options);assert.equal(calls[0]._meta['example/client'].id,'legacy');assert.equal(calls[1]._meta,undefined);});

test('admission captures original target and action before a private draft changes',async()=>{
 const storage=new MemoryStorage(),journal=new IntentJournal(storage);
 const payload={channel:'ahp-chat:/original',action:{type:'chat/turnStarted',message:{text:'original'}}};
 const admission=journal.begin('original',payload);
 payload.channel='ahp-chat:/new-selection';payload.action.message.text='new draft';
 await admission;
 assert.equal((await journal.read('original')).channel,'ahp-chat:/original');
 assert.equal((await journal.read('original')).action.message.text,'original');
});

test('settlement queued during admission waits for durability and captures its details',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve),memory=new MemoryStorage();
 const storage={read:key=>memory.read(key),async write(key,value){await gate;await memory.write(key,value);}};
 const journal=new IntentJournal(storage),admission=journal.begin('command',{channel:'chat',action:{type:'original'}});
 const details={receipt:{id:'original'}};
 const settlement=journal.settle('command','accepted',details);details.receipt.id='changed';release();
 await Promise.all([admission,settlement]);
 assert.equal((await journal.read('command')).status,'accepted');
 assert.equal((await journal.read('command')).receipt.id,'original');
});

test('concurrent settlements retain receipt evidence and cannot retarget original intent',async()=>{
 const storage=new MemoryStorage(),one=new IntentJournal(storage),two=new IntentJournal(storage);
 await one.begin('same',{channel:'original',action:{type:'original'}});
 await Promise.all([one.settle('same','accepted',{receipt:'accepted'}),two.settle('same','completed',{output:'done',id:'other',channel:'other',action:{type:'other'},createdAt:0})]);
 const result=await one.read('same');assert.equal(result.receipt,'accepted');assert.equal(result.output,'done');
 assert.equal(result.status,'completed');assert.equal(result.id,'same');assert.equal(result.channel,'original');
 assert.deepEqual(result.action,{type:'original'});assert.ok(result.createdAt>0);
});

test('failed durable write releases the identity queue without dispatch or automatic replay',async()=>{
 const memory=new MemoryStorage();let fail=true;
 const storage={read:key=>memory.read(key),async write(key,value){if(fail){fail=false;throw Error('quota');}await memory.write(key,value);}};
 const journal=new IntentJournal(storage);await assert.rejects(journal.begin('id',{channel:'chat',action:{}}),/quota/);
 assert.equal(await journal.read('id'),undefined);
 assert.equal((await journal.begin('id',{channel:'chat',action:{}})).created,true);
});

test('global cursor gaps are valid and buffered events after a snapshot apply exactly once',()=>{
 const store=new ConfirmedResources(),event={channel:snapshot.resource,serverSeq:1000,action:{type:'chat/turnStarted',turnId:'buffered',startedAt:'now',message:{text:'hello',origin:{kind:'user'}}}};
 store.snapshot(snapshot);assert.equal(store.apply(event),'applied');assert.equal(store.apply(event),'duplicate');
 assert.equal(store.resources.get(snapshot.resource).activeTurn.id,'buffered');assert.equal(store.serverSeq,1000);
});
