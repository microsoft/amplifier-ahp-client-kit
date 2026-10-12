import test from 'node:test';
import assert from 'node:assert/strict';
import {WebSocketServer} from 'ws';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {runTool,runPrompt,inspectCommand} from '../src/headless.js';

function storage(){const rows=new Map();let held=false;return {rows,async claim(){if(held)throw Error('busy');held=true;return async()=>{held=false}},async read(k){return structuredClone(rows.get(k))},async write(k,v){rows.set(k,structuredClone(v))}}}
async function host(mode='normal'){
 const server=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise(r=>server.once('listening',r));
 const calls=[];let receipt;
 server.on('connection',socket=>socket.on('message',bytes=>{
  const m=JSON.parse(bytes);calls.push(m);const p=m.params??{};
  const send=result=>socket.send(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));
  if(m.method==='initialize')send({protocolVersion:'0.9.0',serverSeq:1,snapshots:[],_meta:{'amplifier.dev/host':{receipts:{method:'x-commandReceipt'}},...(mode==='unsupported'?{}:{'amplifier.dev/capabilities':{actions:{'runtime.control':{method:'x-amplifier/capabilityAction',topic:'runtime-control',operation:'runtime.control'}}}})}});
  else if(m.method==='createSession')send({});
  else if(m.method==='subscribe')send({snapshot:{resource:p.channel,fromSeq:1,state:p.channel.startsWith('ahp-session:')?{defaultChat:'ahp-chat:/owned'}:{resource:p.channel,turns:[],...(mode==='busy'?{activeTurn:{id:'other'}}:{})}}});
  else if(m.method==='unsubscribe')send({});
  else if(m.method==='x-amplifier/capabilityAction'){
   assert.equal(p.operation,'runtime.control');assert.equal(p.args.operation,'tool.invoke');
   assert.deepEqual(p.args.args,{name:'fixture_permit',arguments:{value:'kept'}});
   receipt={channel:p.channel,commandId:p.commandId,status:'completed'};
   if(mode==='lost'){socket.close();return;}
   send(mode==='missing-result'?{accepted:true}:{accepted:mode!=='refused',result:mode==='denied'?{callId:'denied-call',success:false,error:{message:'Denied by policy'}}:{callId:'one-call',result:{success:true,output:'kept'}}});
  }else if(m.method==='x-commandReceipt'){
   if(!receipt){socket.send(JSON.stringify({jsonrpc:'2.0',id:m.id,error:{code:-32008,message:'No receipt'}}));return;}
   send(mode==='wrong-receipt'?{...receipt,channel:'ahp-session:/different'}:receipt);
  }
 }));
 return {url:'ws://127.0.0.1:'+server.address().port,calls,close:async()=>{for(const s of server.clients)s.terminate();await new Promise(r=>server.close(r))}};
}
const base={commandId:'original',session:'ahp-session:/owned',tool:'fixture_permit',arguments:{value:'kept'},timeoutMs:1000};
test('tool result persists and repeated original identity never invokes or creates again',async()=>{
 const f=await host();try{const o={...base,url:f.url,storage:storage()},first=await runTool(o);
  assert.equal(first.status,'completed');assert.equal(first.result.result.output,'kept');
  assert.deepEqual(await runTool(o),first);assert.deepEqual(await inspectCommand(o),first);
  await assert.rejects(runTool({...o,arguments:{value:'changed'}}),/different input/);
  await assert.rejects(runPrompt({...o,prompt:'cannot reuse tool identity'}),/different input/);
  assert.equal(f.calls.filter(m=>m.method==='x-amplifier/capabilityAction').length,1);
  assert.equal(f.calls.filter(m=>['createSession','dispatchAction'].includes(m.method)).length,0);
 }finally{await f.close()}
});
test('lost tool reply inspects only original receipt without claiming missing result',async()=>{
 const f=await host('lost');try{const o={...base,url:f.url,storage:storage()};assert.equal((await runTool(o)).status,'unknown');
  const read=await inspectCommand(o);assert.equal(read.receipt.commandId,base.commandId);assert.equal(read.receipt.status,'completed');assert.equal(read.status,'unknown');assert.equal(read.result,undefined);
  await runTool(o);assert.equal(f.calls.filter(m=>m.method==='x-amplifier/capabilityAction').length,1);
 }finally{await f.close()}
});
for(const [mode,status] of [['unsupported','not-sent'],['busy','not-sent'],['denied','error'],['refused','rejected'],['missing-result','unknown']])test(mode+' tool outcome stays honest',async()=>{
 const f=await host(mode);try{const o={...base,url:f.url,storage:storage()};assert.equal((await runTool(o)).status,status);
  await inspectCommand(o);assert.equal(f.calls.filter(m=>m.method==='x-amplifier/capabilityAction').length,['unsupported','busy'].includes(mode)?0:1);
 }finally{await f.close()}
});
test('unsupported host refuses before new session creation; journal failure prevents invocation',async()=>{
 const f=await host('unsupported');try{const o={...base,session:undefined,url:f.url,storage:storage()};assert.equal((await runTool(o)).status,'not-sent');assert.equal(f.calls.filter(m=>m.method==='createSession').length,0)}finally{await f.close()}
 const g=await host();try{const s=storage();s.write=async()=>{throw Error('disk unavailable')};await assert.rejects(runTool({...base,url:g.url,storage:s}));assert.equal(g.calls.length,0)}finally{await g.close()}
});
test('tool validation rejects malformed or oversized arguments before connection',async()=>{
 let calls=0;const o={...base,url:'ws://unused',storage:storage(),transportFactory:async()=>{calls++;throw Error('unexpected')}};
 for(const change of [{tool:''},{tool:'bad name'},{arguments:null},{arguments:[]},{arguments:'text'},{arguments:{large:'x'.repeat(65536)}}])await assert.rejects(runTool({...o,...change}));
 assert.equal(calls,0);
});
test('separate CLI processes recover the saved tool result and malformed JSON sends nothing',async()=>{
 const f=await host(),dir=await mkdtemp(join(tmpdir(),'headless-tool-cli-')),exec=promisify(execFile),entry=new URL('../src/cli.js',import.meta.url).pathname;
 try{
  const common=['--server',f.url,'--command','cli-tool','--state-dir',dir,'--output-format','json'];
  const first=JSON.parse((await exec(process.execPath,[entry,'tool','fixture_permit','--args','{"value":"kept"}','--resume',base.session,...common])).stdout);
  assert.equal(first.status,'completed');
  const read=JSON.parse((await exec(process.execPath,[entry,'inspect',...common])).stdout);assert.deepEqual(read,first);
  const before=f.calls.length;await assert.rejects(exec(process.execPath,[entry,'tool','fixture_permit','--args','invalid',...common]),e=>e.code===2&&/valid JSON/.test(e.stderr));assert.equal(f.calls.length,before);
  assert.equal(f.calls.filter(m=>m.method==='x-amplifier/capabilityAction').length,1);
 }finally{await f.close();await rm(dir,{recursive:true,force:true})}
});
