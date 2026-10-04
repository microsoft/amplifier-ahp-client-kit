import test from 'node:test';
import assert from 'node:assert/strict';
import {WebSocketServer} from 'ws';
import {runPrompt,inspectCommand} from '../src/headless.js';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const execute=promisify(execFile);
const METHOD='x-amplifier/managedSession',revision='a'.repeat(64);
function storage(){const rows=new Map();return {rows,async claim(){return async()=>{};},async read(key){return structuredClone(rows.get(key));},async write(key,value){rows.set(key,structuredClone(value));}};}
// Public AHP wire fixture, not a replacement native implementation or provider.
async function fixture(mode='normal'){
 const wss=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise(r=>wss.once('listening',r));
 const calls=[],turns=[];let creation,releaseCreate,failReceipts=false,seq=1;
 wss.on('connection',socket=>socket.on('message',raw=>{
  const m=JSON.parse(raw),p=m.params??{};calls.push(m);
  const send=result=>socket.send(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));
  const proof=()=>({session:creation.session,receipt:creation.commandId,creationConfirmed:true,runtimeStarted:false,workReplayed:false,configurationScope:'global-and-session'});
  if(m.method==='initialize')send({protocolVersion:'0.9.0',serverSeq:seq,snapshots:[],_meta:mode==='absent'?{}:{'amplifier.dev/managedCreation':{version:1,method:METHOD,operations:['options','defaults','create','receipt'],passive:true,typedSelection:true}}});
  else if(m.method===METHOD){
   assert.equal(p.channel,'ahp-root://');
   if(p.operation==='options')send({provider:'engine',version:1,bundles:[{id:'work',name:'work',revision}],runtimeStarted:false,configurationScope:'global-and-session'});
   if(p.operation==='defaults')send({provider:'engine',providers:[{id:'configured-instance'}],runtimeStarted:false,configurationScope:'global-and-session',bundleSelection:{id:'work',revision:mode==='stale-defaults'?'b'.repeat(64):revision}});
   if(p.operation==='create'){
    if(mode==='refuse'){socket.send(JSON.stringify({jsonrpc:'2.0',id:m.id,error:{code:-32011,message:'refused',data:{executed:false}}}));return;}
    creation=structuredClone(p.args);
    if(mode==='lost-create'||mode==='unknown-create'){socket.close();return;}
    if(mode==='held-create'){releaseCreate=()=>send(proof());return;}
    send(mode==='wrong-proof'?{...proof(),session:'ahp-session:/wrong'}:proof());
   }
   if(p.operation==='receipt'&&failReceipts){socket.close();return;}
   if(p.operation==='receipt')send(creation&&mode!=='unknown-create'?{commandId:creation.commandId,status:'completed',result:mode==='wrong-receipt'?{...proof(),receipt:'different'}:proof(),replayed:false}:null);
  }else if(m.method==='subscribe')send({snapshot:{resource:p.channel,fromSeq:seq,state:p.channel.startsWith('ahp-session:')?{defaultChat:'ahp-chat:/owned'}:{resource:p.channel,turns}},serverSeq:seq});
  else if(m.method==='dispatchAction'){
   const action=p.action;turns.push({id:action.turnId,state:'complete',responseParts:[{kind:'markdown',content:'selected reply'}]});
   if(mode==='lost-input'){socket.close();return;}
   socket.send(JSON.stringify({jsonrpc:'2.0',method:'action',params:{channel:p.channel,serverSeq:++seq,action}}));
   socket.send(JSON.stringify({jsonrpc:'2.0',method:'action',params:{channel:p.channel,serverSeq:++seq,action:{type:'chat/turnComplete',turnId:action.turnId,duration:1}}}));
  }
 }));
 return {calls,turns,failReceipts:()=>{failReceipts=true;},releaseCreate:()=>releaseCreate(),get creation(){return creation;},url:`ws://127.0.0.1:${wss.address().port}`,async close(){for(const c of wss.clients)c.terminate();await new Promise(r=>wss.close(r));}};
}
const base={commandId:'original-input',prompt:'hello',managed:true,agent:'engine',bundle:'work',provider:'configured-instance',model:'model/two',effort:'medium',timeoutMs:1000};
test('managed typed creation binds alias revision and configured instance before a distinct original input',async()=>{
 const f=await fixture();const s=storage();try{
  const options={...base,url:f.url,storage:s};await runPrompt(options);
  assert.deepEqual(f.creation,{session:s.rows.get('command:original-input').session,commandId:s.rows.get('command:original-input').creationCommandId,provider:'engine',bundle:'work',bundleRevision:revision,selection:{instance:'configured-instance',model:'model/two',effort:'medium'}});
  assert.notEqual(f.creation.commandId,base.commandId);assert.equal(f.turns.length,1);
  assert.equal((await inspectCommand(options)).status,'completed');
  assert.equal((await runPrompt(options)).status,'completed');
  for(const key of ['bundle','provider','model','effort','agent'])await assert.rejects(runPrompt({...options,[key]:'changed'}),/different input/);
  assert.equal(f.calls.filter(m=>m.method===METHOD&&m.params.operation==='create').length,1);assert.equal(f.turns.length,1);
 }finally{await f.close();}
});
for(const mode of ['lost-create','unknown-create','wrong-proof','wrong-receipt'])test(`${mode}: exact creation recovery never delivers the originally unsent input`,async()=>{
 const f=await fixture(mode);const s=storage();try{
  const options={...base,url:f.url,storage:s};
  // Wrong-receipt represents a crash after creation and before input admission.
  if(mode==='wrong-receipt'){const write=s.write;s.write=async(k,v)=>{if(v.creationPhase==='confirmed')throw Error('lost local write');await write(k,v);};}
  assert.equal((await runPrompt(options)).status,'unknown');
  const result=await inspectCommand({...options,storage:{...s}});
  assert.equal(result.status,['unknown-create','wrong-receipt'].includes(mode)?'unknown':'not-sent');
  await runPrompt(options);assert.equal(f.turns.length,0);
  assert.equal(f.calls.filter(m=>m.method===METHOD&&m.params.operation==='create').length,1);
  assert.ok(f.calls.filter(m=>m.method===METHOD&&m.params.operation==='receipt').every(m=>m.params.args.commandId===f.creation.commandId));
 }finally{await f.close();}
});
test('lost input response recovers exact turn without another creation or input',async()=>{
 const f=await fixture('lost-input');try{const options={...base,url:f.url,storage:storage()};assert.equal((await runPrompt(options)).status,'unknown');assert.equal((await inspectCommand(options)).status,'completed');assert.equal(f.turns.length,1);assert.equal(f.calls.filter(m=>m.method===METHOD&&m.params.operation==='create').length,1);}finally{await f.close();}
});
for(const mode of ['absent','stale-defaults','refuse'])test(`${mode} fails before input and never invents selection fallback`,async()=>{
 const f=await fixture(mode);try{const options={...base,url:f.url,storage:storage()};assert.equal((await runPrompt(options)).status,'not-sent');assert.equal((await inspectCommand(options)).status,'not-sent');assert.equal(f.turns.length,0);assert.equal(f.calls.filter(m=>m.method===METHOD&&m.params.operation==='create').length,mode==='refuse'?1:0);}finally{await f.close();}
});
test('invalid or unsupported overrides fail without a connection',async()=>{
 let connects=0;const options={...base,storage:storage(),transportFactory:async()=>{connects++;throw Error('not allowed');}};
 for(const delta of [{session:'ahp-session:/old'},{workspace:'/host/project'},{managed:false},{model:undefined},{provider:undefined},{effort:9},{model:''},{model:'x'.repeat(501)}])await assert.rejects(runPrompt({...options,...delta}));
 assert.equal(connects,0);
 const f=await fixture();try{for(const delta of [{bundle:'unknown'},{provider:'unknown'}])assert.equal((await runPrompt({...base,...delta,url:f.url,storage:storage()})).status,'not-sent');assert.equal(f.calls.filter(m=>m.method===METHOD&&m.params.operation==='create').length,0);}finally{await f.close();}
});
test('CLI exposes managed flags but refuses them for inspection and resumed selection',async()=>{
 const cli=new URL('../src/cli.js',import.meta.url).pathname;
 assert.match((await execute(process.execPath,[cli,'--help'])).stdout,/--provider INSTANCE/);
 await assert.rejects(execute(process.execPath,[cli,'inspect','--server','ws://unused','--command','old','--managed']),e=>e.code===2&&/accepts no new/.test(e.stderr));
});
test('failed durable creation admission sends no creation; read-only recovery never retries',async()=>{
 const f=await fixture();const s=storage(),write=s.write;try{
  s.write=async(key,value)=>{if(value.creationPhase==='requested')throw Error('owned disk failure');await write(key,value);};
  const options={...base,url:f.url,storage:s};assert.equal((await runPrompt(options)).status,'unknown');assert.equal((await inspectCommand(options)).status,'unknown');
  assert.equal(f.calls.filter(m=>m.method===METHOD&&m.params.operation==='create').length,0);assert.equal(f.turns.length,0);
 }finally{await f.close();}
});

test('concurrent receipt observation cannot claim an in-flight original input is unsent',{timeout:10000},async()=>{
 const f=await fixture('held-create');try{
  const options={...base,url:f.url,storage:storage()};const pending=runPrompt({...options,timeoutMs:5000});
  const deadline=Date.now()+4000;while(!f.creation&&Date.now()<deadline)await new Promise(r=>setTimeout(r,1));
  assert.ok(f.creation,'the original request must reach the held create boundary');
  const read=await inspectCommand(options);assert.equal(read.status,'unknown');assert.equal(read.creationReceipt.status,'completed');assert.equal(f.turns.length,0);
  f.failReceipts();assert.equal((await inspectCommand(options)).status,'unknown');assert.equal((await options.storage.read('command:'+base.commandId)).inputNotSent,undefined);
  f.releaseCreate();assert.equal((await pending).status,'completed');assert.equal(f.turns.length,1);
 }finally{await f.close();}
});

test('independent CLI processes recover lost creation through saved child ID without sending input',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'headless-create-loss-')),f=await fixture('lost-create');
 try{
  const cli=new URL('../src/cli.js',import.meta.url).pathname,prompt=join(directory,'prompt.txt');await writeFile(prompt,'original private input');
  const args=['--server',f.url,'--state-dir',join(directory,'state'),'--command','original-cli','--output','json','--wait-ms','1000'];
  let original;try{await execute(process.execPath,[cli,'run',...args,'--managed','--bundle','work','--provider','configured-instance','--model','model/two','--prompt-file',prompt]);assert.fail('lost reply must not report completion');}catch(e){assert.equal(e.code,3);original=JSON.parse(e.stdout);}
  let recovered;try{await execute(process.execPath,[cli,'inspect',...args]);assert.fail('unsent input is not completed');}catch(e){assert.equal(e.code,1);recovered=JSON.parse(e.stdout);}
  assert.equal(original.status,'unknown');assert.equal(recovered.status,'not-sent');assert.equal(recovered.creationCommandId,original.creationCommandId);assert.equal(recovered.session,original.session);assert.equal(recovered.creationReceipt.status,'completed');
  assert.notEqual(original.commandId,original.creationCommandId);assert.equal(f.turns.length,0);assert.equal(f.calls.filter(m=>m.method===METHOD&&m.params.operation==='create').length,1);
 }finally{await f.close();await rm(directory,{recursive:true,force:true});}
});
