import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFile,spawnSync} from 'node:child_process';
import {promisify} from 'node:util';
import {FileStorage} from '../src/file-storage.js';
import {runPrompt,inspectCommand} from '../src/headless.js';
const execute=promisify(execFile);
const hostModule=process.env.AHP_HEADLESS_HOST_MODULE;

test('durable file records survive replacement and command ownership cannot be stolen',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'ahp-journal-'));try{
  const one=new FileStorage(directory),two=new FileStorage(directory);
  await one.write('private/input',{text:'preserved'});assert.deepEqual(await two.read('private/input'),{text:'preserved'});
  if(process.platform!=='win32')assert.equal((await stat(one.path('private/input'))).mode&0o777,0o600);
  const release=await one.claim('command');await assert.rejects(two.claim('command'),/already owned/);await release();await (await two.claim('command'))();
  await writeFile(one.path('private/input'),'partial');await assert.rejects(two.read('private/input'));
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('validation refuses unsupported identity and changes before any transport work',async()=>{
 let connected=0;const storage={claim:async()=>()=>{},read:async()=>undefined,write:async()=>{}};
 const base={storage,commandId:'bad identity',prompt:'hello',transportFactory:async()=>{connected++;throw Error('unexpected');}};
 await assert.rejects(runPrompt(base),/Command ID/);
 await assert.rejects(runPrompt({...base,commandId:'valid',session:'ahp-session:/s',agent:'other'}),/retains/);
 assert.equal(connected,0);
});

async function setup(){
 const {createHost}=await import(pathToFileURL(resolve(hostModule)).href);
 const directory=await mkdtemp(join(tmpdir(),'ahp-headless-')),log=join(directory,'prompts.jsonl');
 const peer=join(dirname(dirname(resolve(hostModule))),'fixtures/acp-peer.mjs');
 const host=await createHost({stateDirectory:join(directory,'host'),allowedWorkspaceRoots:[directory],bearerToken:'owned-fixture-token',engines:[{id:'fixture',label:'Fixture',command:process.execPath,args:[peer],env:{FIXTURE_LOG:log}}]});
 return {directory,host,log,storage:new FileStorage(join(directory,'client')),async close(){await host.close();await rm(directory,{recursive:true,force:true});}};
}

test('installed public host runs, resumes and inspects through AHP without duplicate inputs',{skip:!hostModule},async()=>{
 const f=await setup();try{
  const options={url:f.host.url,token:'owned-fixture-token',storage:f.storage,commandId:'first',prompt:'hello',workspace:f.directory,agent:'fixture',timeoutMs:10000};
  const first=await runPrompt(options);assert.equal(first.status,'completed');assert.equal(first.output,'Echo: hello');
  assert.equal((await runPrompt(options)).output,'Echo: hello');
  await assert.rejects(runPrompt({...options,prompt:'different'}),/different input/);
  const next=await runPrompt({...options,commandId:'next',prompt:'again',session:first.session,workspace:undefined,agent:undefined});assert.equal(next.output,'Echo: again');
  const recovered=await inspectCommand({...options,storage:new FileStorage(f.storage.directory)});assert.equal(recovered.output,'Echo: hello');
  await assert.rejects(inspectCommand({...options,url:'ws://different.invalid/ahp'}),/different host/);
  assert.equal((await readFile(f.log,'utf8')).trim().split('\n').length,2);
 }finally{await f.close();}
});

const nativePython=process.env.AHP_HEADLESS_NATIVE_PYTHON,nativeProvider=process.env.AHP_HEADLESS_NATIVE_PROVIDER;
test('installed native Core/Foundation executes new and resumed inputs through the independent client',{skip:!hostModule||!nativePython||!nativeProvider,timeout:120000},async()=>{
 const {createHost}=await import(pathToFileURL(resolve(hostModule)).href);
 const directory=await mkdtemp(join(tmpdir(),'ahp-headless-native-'));let host;
 try{
  const workspace=join(directory,'workspace');await mkdir(workspace);
  const setup=spawnSync(nativePython,['-I','-c',String.raw`
import importlib.util,json,sys
from pathlib import Path
p=Path(sys.argv[1]);home=p/'native-home';home.mkdir()
(home/'settings.yaml').write_text('bundle:\n  app: []\n')
context=Path(importlib.util.find_spec('amplifier_module_context_simple').origin).parent
bundle=p/'bundle.yaml';bundle.write_text('bundle:\n  name: headless-fixture\n  version: 1.0.0\nsession:\n  orchestrator:\n    module: loop-live\n  context:\n    module: context-simple\n    source: '+str(context)+'\nproviders:\n  - module: provider-fixture\n    source: '+sys.argv[2]+'\n')
(p/'native.json').write_text(json.dumps({'home':str(home),'appHome':str(p/'native-app'),'bundle':str(bundle),'startupTimeout':90}))
`,directory,nativeProvider],{encoding:'utf8'});assert.equal(setup.status,0,setup.stderr);
  host=await createHost({stateDirectory:join(directory,'host'),defaultWorkspace:workspace,allowedWorkspaceRoots:[workspace],engines:[{id:'amplifier',label:'Core/Foundation',command:nativePython,args:['-I','-m','amplifier_acp','--config',join(directory,'native.json')]}]});
  const options={url:host.url,storage:new FileStorage(join(directory,'client')),workspace,commandId:'native-first',prompt:'headless first input',timeoutMs:90000};
  const first=await runPrompt(options);assert.equal(first.status,'completed',JSON.stringify(first));assert.equal(first.output,'Native graph reply: headless first input');
  const next=await runPrompt({...options,workspace:undefined,session:first.session,commandId:'native-next',prompt:'headless next input'});assert.equal(next.status,'completed',JSON.stringify(next));assert.equal(next.output,'Native graph reply: headless next input');
  assert.equal((await inspectCommand(options)).output,first.output);
  const state=await host.inspectSession(first.session);assert.ok(state.nativeSessionId);
  const context=await host.readSessionContext(first.session,10);assert.equal(context.messages.filter(message=>message.role==='user').length,2);
 }finally{await host?.close();await rm(directory,{recursive:true,force:true});}
});

test('wait timeout and a dropped client acknowledgement preserve exactly one original turn',{skip:!hostModule},async()=>{
 const f=await setup();try{
  const options={url:f.host.url,token:'owned-fixture-token',storage:f.storage,commandId:'slow',prompt:'slow',workspace:f.directory,timeoutMs:10};
  const pending=await runPrompt(options);assert.ok(['unknown','running'].includes(pending.status));
  await new Promise(resolve=>setTimeout(resolve,300));
  const recovered=await inspectCommand({...options,timeoutMs:10000});assert.equal(recovered.status,'completed');assert.equal(recovered.output,'Echo: slow');
  const lost=await runPrompt({...options,commandId:'lost',prompt:'lost acknowledgement',timeoutMs:10000,onEvent:envelope=>{if(envelope.action.type==='chat/turnStarted')throw Error('drop event consumer');}});assert.ok(['running','unknown'].includes(lost.status));
  await new Promise(resolve=>setTimeout(resolve,300));
  assert.equal((await inspectCommand({...options,commandId:'lost',timeoutMs:10000})).output,'Echo: lost acknowledgement');
  assert.equal((await readFile(f.log,'utf8')).trim().split('\n').length,2);
 }finally{await f.close();}
});

test('approval is surfaced and never silently confirmed by the headless client',{skip:!hostModule},async()=>{
 const f=await setup();try{
  const result=await runPrompt({url:f.host.url,token:'owned-fixture-token',storage:f.storage,commandId:'approval',prompt:'approval',workspace:f.directory,timeoutMs:5000});
  assert.equal(result.status,'input-required');
  const state=await f.host.inspectSession(result.session);assert.ok(state);
  assert.equal((await readFile(f.log,'utf8')).trim().split('\n').length,1);
 }finally{await f.close();}
});

test('real CLI accepts token-file and emits machine-readable output with recoverable identities',{skip:!hostModule},async()=>{
 const f=await setup();try{
  const prompt=join(f.directory,'prompt.txt'),token=join(f.directory,'token');await writeFile(prompt,'from cli');await writeFile(token,'owned-fixture-token\n',{mode:0o600});
  const shared=['--server',f.host.url,'--token-file',token,'--state-dir',join(f.directory,'cli'),'--command','cli-command','--output','json'];
  const {stdout,stderr}=await execute(process.execPath,['src/cli.js','run',...shared,'--workspace',f.directory,'--prompt-file',prompt],{cwd:resolve(import.meta.dirname,'..')});
  const result=JSON.parse(stdout);assert.equal(result.status,'completed');assert.equal(result.output,'Echo: from cli');assert.ok(!stderr.includes('owned-fixture-token'));
  const recovered=await execute(process.execPath,['src/cli.js','inspect',...shared],{cwd:resolve(import.meta.dirname,'..')});assert.equal(JSON.parse(recovered.stdout).output,result.output);
  assert.equal((await readFile(f.log,'utf8')).trim().split('\n').length,1);
 }finally{await f.close();}
});
