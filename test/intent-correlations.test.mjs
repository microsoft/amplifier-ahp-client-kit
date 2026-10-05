import test from 'node:test';
import assert from 'node:assert/strict';
import {IntentJournal,MemoryStorage,ConfirmedResources,recoverConnection} from '../src/index.js';
const payload={channel:'ahp-session:/original',action:{type:'session/configChanged',config:{model:'original'}}};
const wire={clientId:'original-client',clientSeq:1};
const envelope=(binding,extra={})=>({channel:binding.channel,action:structuredClone(binding.action),origin:{clientId:binding.clientId,clientSeq:binding.clientSeq},serverSeq:4,...extra});
async function admit(journal,id='original',binding=wire){const start=await journal.begin(id,payload);assert.equal(start.created,true);return (await journal.bindDispatch(id,binding)).correlation;}
test('binding captures original intent, survives waiter lifetime/reload, and accepts only exact late original echo',async()=>{
 const storage=new MemoryStorage(),j=new IntentJournal(storage);const original=await admit(j);const late=new IntentJournal(storage);const changed={...payload.action,config:{model:'newer private draft'}};
 assert.equal(await late.acceptEcho(envelope(original,{origin:{...wire,clientId:'other-client'}})),null);
 assert.equal(await late.acceptEcho(envelope(original,{origin:{...wire,clientSeq:2}})),null);
 assert.equal(await late.acceptEcho(envelope(original,{channel:'ahp-session:/other'})),null);
 assert.equal(await late.acceptEcho(envelope(original,{action:changed})),null);
 assert.equal((await j.read('original')).status,'unknown');
 const result=await late.acceptEcho(envelope(original));assert.equal(result.id,'original');assert.equal(result.status,'accepted');assert.deepEqual(result.intent.action,payload.action);assert.equal(changed.config.model,'newer private draft');
 assert.equal(await late.acceptEcho(envelope(original,{rejectionReason:'contradictory'})),null);assert.equal((await j.read('original')).status,'accepted');
 assert.equal((await j.begin('original',payload)).created,false);await assert.rejects(j.settle('original','unknown'),/Confirmed original echo/);
});
test('late rejected echo settles original after clientId rotation, preserves current sequence and newer intent',async()=>{
 const storage=new MemoryStorage(),first=new IntentJournal(storage),old=await admit(first);
 const current=new IntentJournal(storage),newer=await admit(current,'newer',{clientId:'reload-client',clientSeq:1});
 const rejected=await current.acceptEcho(envelope(old,{rejectionReason:'Owner refused original'}));assert.equal(rejected.status,'rejected');assert.equal(rejected.intent.rejectionReason,'Owner refused original');assert.equal((await current.read('newer')).status,'unknown');
 assert.equal((await current.acceptEcho(envelope(newer,{serverSeq:5}))).status,'accepted');
});
test('wire binding persists before caller may dispatch; failed index write cannot be repaired into a send',async()=>{
 const storage=new MemoryStorage(),j=new IntentJournal(storage);await j.begin('original',payload);const write=storage.write.bind(storage);storage.write=async(key,value)=>{if(key==='intent-correlations:ahp')throw Error('Index durability unavailable');return write(key,value)};
 await assert.rejects(j.bindDispatch('original',wire),/Index durability/);assert.equal((await j.read('original')).status,'unknown');storage.write=write;
 await assert.rejects(j.bindDispatch('original',wire),/lookup unavailable/);assert.equal(await j.acceptEcho(envelope({...payload,...wire})),null);
});
test('failed original binding write does not create lookup; failed settlement keeps binding and original unknown',async()=>{
 const storage=new MemoryStorage(),j=new IntentJournal(storage);await j.begin('original',payload);const write=storage.write.bind(storage);
 storage.write=async(key,value)=>{if(key==='intent:original'&&value.dispatchCorrelation)throw Error('Original binding write failed');return write(key,value)};
 await assert.rejects(j.bindDispatch('original',wire),/Original binding write/);assert.equal(await storage.read('intent-correlations:ahp'),undefined);storage.write=write;const row=(await j.bindDispatch('original',wire)).correlation;
 storage.write=async(key,value)=>{if(key==='intent:original'&&value.status==='accepted')throw Error('Acknowledgement write failed');return write(key,value)};
 await assert.rejects(j.acceptEcho(envelope(row)),/Acknowledgement write/);assert.equal((await j.read('original')).status,'unknown');assert.equal((await storage.read('intent-correlations:ahp')).entries.length,1);storage.write=write;assert.equal((await j.acceptEcho(envelope(row))).status,'accepted');
});
test('lookup retirement failure preserves confirmed evidence and exact duplicate retry is monotonic',async()=>{
 const storage=new MemoryStorage(),j=new IntentJournal(storage),row=await admit(j),write=storage.write.bind(storage);
 storage.write=async(key,value)=>{if(key==='intent-correlations:ahp'&&!value.entries.length)throw Error('Lookup cleanup failed');return write(key,value)};
 const result=await j.acceptEcho(envelope(row));assert.equal(result.status,'accepted');assert.match(result.retirementError,/cleanup/);const saved=await j.read('original');
 assert.equal(await j.acceptEcho(envelope(row,{rejectionReason:'conflict'})),null);assert.deepEqual(await j.read('original'),saved);storage.write=write;
 assert.deepEqual((await j.acceptEcho(envelope(row))).intent,saved);assert.equal((await storage.read('intent-correlations:ahp')).entries.length,0);
});
test('concurrent same-adapter bindings prohibit overlapping sequences and preserve durable high-water after retirement',async()=>{
 const storage=new MemoryStorage(),one=new IntentJournal(storage),two=new IntentJournal(storage);await one.begin('one',payload);await one.begin('two',payload);
 const results=await Promise.allSettled([one.bindDispatch('one',wire),two.bindDispatch('two',wire)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/sequence cannot be reused/);
 const row=results.find(r=>r.status==='fulfilled').value.correlation;await one.acceptEcho(envelope(row));await assert.rejects(two.bindDispatch('two',wire),/sequence cannot be reused/);assert.equal((await two.bindDispatch('two',{...wire,clientSeq:2})).created,true);
});
test('binding is immutable, requires admitted unknown intent, and generic settlement preserves original wire metadata',async()=>{
 const storage=new MemoryStorage(),j=new IntentJournal(storage);await assert.rejects(j.bindDispatch('missing',wire),/Original admitted/);const row=await admit(j);assert.equal((await j.bindDispatch('original',wire)).created,false);await assert.rejects(j.bindDispatch('original',{...wire,clientId:'changed'}),/binding changed/);
 await j.settle('original','unknown',{dispatchCorrelation:{clientId:'injected'},receipt:{id:'earlier-owner'}});assert.equal((await j.acceptEcho(envelope(row))).intent.receipt.id,'earlier-owner');assert.equal((await j.read('original')).dispatchCorrelation.clientId,wire.clientId);
});
test('storage capacity or malformed original index refuses admission without evicting unresolved identities',async()=>{
 const storage=new MemoryStorage(),j=new IntentJournal(storage,{limit:1}),row=await admit(j);await j.begin('next',payload);await assert.rejects(j.bindDispatch('next',{...wire,clientSeq:2}),/capacity/);assert.equal((await j.read('next')).dispatchCorrelation,undefined);assert.equal((await storage.read('intent-correlations:ahp')).entries[0].intentId,'original');
 await j.acceptEcho(envelope(row));assert.equal((await j.bindDispatch('next',{...wire,clientSeq:2})).created,true);
 const saved=await storage.read('intent-correlations:ahp');await storage.write('intent-correlations:ahp',{...saved,version:0});await assert.rejects(j.acceptEcho(envelope(row)),/no implicit repair/);assert.equal((await storage.read('intent-correlations:ahp')).version,0);
});
test('account-scoped adapters with overlapping IDs/sequences cannot settle one another without original exact identity',async()=>{
 const a=new IntentJournal(new MemoryStorage()),b=new IntentJournal(new MemoryStorage());const left=await admit(a,'same',{clientId:'account-a',clientSeq:1}),right=await admit(b,'same',{clientId:'account-b',clientSeq:1});assert.equal(await b.acceptEcho(envelope(left)),null);assert.equal((await b.read('same')).status,'unknown');assert.equal((await a.acceptEcho(envelope(left))).status,'accepted');assert.equal((await b.acceptEcho(envelope(right))).status,'accepted');
});
test('JSON key order is semantic equality; absent, malformed or substituted proof remains unknown',async()=>{
 const j=new IntentJournal(new MemoryStorage()),row=await admit(j);assert.equal(await j.acceptEcho({...envelope(row),origin:undefined}),null);assert.equal(await j.acceptEcho(envelope(row,{serverSeq:NaN})),null);assert.equal(await j.acceptEcho(envelope(row,{rejectionReason:''})),null);
 const result=await j.acceptEcho(envelope(row,{action:{config:{model:'original'},type:'session/configChanged'}}));assert.equal(result.status,'accepted');
});
test('reconnect replay processes exact acknowledgements before duplicate filtering; snapshot alone never settles',async()=>{
 const j=new IntentJournal(new MemoryStorage()),row=await admit(j),confirmed=new ConfirmedResources();confirmed.snapshot({resource:payload.channel,fromSeq:8,state:{}});
 const echo=envelope(row),observed=[];const client={reconnect:async()=>({type:'replay',actions:[echo],missing:[]})};
 const recovered=await recoverConnection(client,{store:confirmed,clientId:'original-client',subscriptions:[payload.channel],initialized:true,onAction:async action=>{observed.push(action);assert.equal((await j.read('original')).status,'unknown');await j.acceptEcho(action)}});
 assert.equal(recovered.discardPending,true);assert.equal(observed.length,1);assert.equal((await j.read('original')).status,'accepted');
 const next=await admit(j,'snapshot-only',{...wire,clientSeq:2});client.reconnect=async()=>({type:'snapshot',snapshots:[{resource:payload.channel,fromSeq:9,state:{}}]});await recoverConnection(client,{store:confirmed,clientId:'original-client',subscriptions:[payload.channel],initialized:true,onAction:action=>j.acceptEcho(action)});assert.equal((await j.read(next.intentId)).status,'unknown');
});
test('binding captures caller wire identity before asynchronous reads and cannot be retargeted by edits',async()=>{
 const storage=new MemoryStorage(),j=new IntentJournal(storage);await j.begin('original',payload);const read=storage.read.bind(storage);let unblock;storage.read=async key=>{if(key==='intent-correlations:ahp'&&!unblock)await new Promise(resolve=>unblock=resolve);return read(key)};
 const mutable={...wire},pending=j.bindDispatch('original',mutable);while(!unblock)await new Promise(resolve=>setImmediate(resolve));mutable.clientId='newer';mutable.clientSeq=99;unblock();const row=(await pending).correlation;assert.equal(row.clientId,wire.clientId);assert.equal(row.clientSeq,wire.clientSeq);
 assert.equal((await j.acceptEcho(envelope(row,{action:{...payload.action,optional:undefined}}))).status,'accepted');
});
test('real filesystem store preserves original binding after adapter replacement and keeps draft separate',async t=>{
 const {FileStorage}=await import('../src/file-storage.js');const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const directory=await mkdtemp(join(tmpdir(),'kit-correlations-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const originalStore=new FileStorage(directory),j=new IntentJournal(originalStore);const row=await admit(j);await originalStore.write('draft:original',{text:'newer private draft'});
 const restoredStore=new FileStorage(directory),restored=new IntentJournal(restoredStore);assert.equal((await restored.read('original')).status,'unknown');assert.equal((await restored.acceptEcho(envelope(row,{rejectionReason:'original rejected'}))).status,'rejected');assert.deepEqual(await restoredStore.read('draft:original'),{text:'newer private draft'});
});
test('scoped IndexedDB close/reopen retains original wire identity and isolates host/account/tab',async()=>{
 const {ScopedIndexedDBStore}=await import('../src/indexeddb.js');const {indexedDB}=await import('fake-indexeddb');const database='correlation-reopen',options={host:'authenticated-host',account:'account-a',tab:'owned-tab',database,indexedDB};
 const store=new ScopedIndexedDBStore(options),j=new IntentJournal(store),row=await admit(j);store.close();
 const restored=new ScopedIndexedDBStore(options),other=new ScopedIndexedDBStore({...options,account:'account-b'});try{assert.equal(await new IntentJournal(other).acceptEcho(envelope(row)),null);assert.equal((await new IntentJournal(restored).acceptEcho(envelope(row))).status,'accepted');}finally{restored.close();other.close();}
});

test('additive recursive metadata confirms steering and queued payloads while preserving original journal action',async()=>{
 for(const kind of ['steering','queued'])for(const held of [false,true]){
  const storage=new MemoryStorage(),j=new IntentJournal(storage),action={type:'chat/pendingMessageSet',kind,id:'original',message:{text:'Original correction',origin:{kind:'user'},_meta:{'amplifier.dev/steering':{activeTurnId:'A'},owned:{scope:'project',nested:{bound:'original'}}}}};
  await j.begin('original',{channel:'chat',action});const row=(await j.bindDispatch('original',wire)).correlation;
  const added=structuredClone(action);added._meta={server:{version:1}};added.message._meta['amplifier.dev/steering'].held=held;added.message._meta.owned.nested.extra={server:true};added.message._meta['amplifier.dev/queue']={held};
  assert.equal((await j.acceptEcho(envelope(row,{action:added}))).status,'accepted');assert.deepEqual((await j.read('original')).action,action);assert.deepEqual((await j.read('original')).echoReceipt.action,action);assert.equal((await j.begin('original',{channel:'chat',action:{...action,id:'replacement'}})).created,false);
 }
});
test('metadata enrichment cannot change or remove original semantic fields, binding, scope, provenance, or arrays',async()=>{
 const action={type:'chat/pendingMessageSet',kind:'steering',id:'original',message:{text:'Original text',origin:{kind:'user'},_meta:{'amplifier.dev/steering':{activeTurnId:'A'},owned:{scope:'project',values:[1,2],nested:{bound:true}}}}};
 const changes=[a=>a.message.text='Changed',a=>a.id='other',a=>a.kind='queued',a=>a.type='chat/pendingMessageRemoved',a=>a.message._meta['amplifier.dev/steering'].activeTurnId='B',a=>delete a.message._meta['amplifier.dev/steering'].activeTurnId,a=>a.message._meta.owned.scope='global',a=>a.message._meta.owned.nested.bound=false,a=>a.message._meta.owned.values.push(3),a=>a.message._meta.owned.values.reverse(),a=>a.extra='not metadata',a=>a.message._meta=null,a=>delete a.message._meta];
 for(const change of changes){const storage=new MemoryStorage(),j=new IntentJournal(storage);await j.begin('original',{channel:'chat',action});const row=(await j.bindDispatch('original',wire)).correlation,changed=structuredClone(action);change(changed);assert.equal(await j.acceptEcho(envelope(row,{action:changed})),null);assert.equal((await j.read('original')).status,'unknown');assert.deepEqual((await j.read('original')).action,action);assert.equal((await j.acceptEcho(envelope(row))).status,'accepted')}
 for(const changed of [{origin:{...wire,clientId:'other'}},{origin:{...wire,clientSeq:2}},{channel:'other'}]){const j=new IntentJournal(new MemoryStorage());await j.begin('original',{channel:'chat',action});const row=(await j.bindDispatch('original',wire)).correlation;assert.equal(await j.acceptEcho(envelope(row,changed)),null);assert.equal((await j.read('original')).status,'unknown')}
});
