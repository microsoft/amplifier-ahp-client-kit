import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile),hostModule=process.env.AHP_HEADLESS_HOST_MODULE,python=process.env.AHP_HEADLESS_NATIVE_PYTHON;
async function privateStamp(path){try{return createHash('sha256').update(await readFile(path)).digest('hex');}catch(e){if(e.code==='ENOENT')return null;throw e;}}
test('actual installed Core/Foundation CLI uses typed bundle/instance/model and cold resume retains them',{skip:!hostModule||!python,timeout:180000},async()=>{
 const {createHost}=await import(pathToFileURL(resolve(hostModule)).href);
 const directory=await realpath(await mkdtemp(join(process.env.AHP_HEADLESS_FIXTURE_ROOT??(process.platform==='darwin'?'/private/tmp':tmpdir()),'ahp-hm-')));let host,success=false;
 const protectedPaths=['settings.yaml','keys.env'].map(name=>join(homedir(),'.amplifier',name)),before=await Promise.all(protectedPaths.map(privateStamp));
 const env={PATH:process.env.PATH,HOME:join(directory,'user'),TMPDIR:directory,PYTHONDONTWRITEBYTECODE:'1',AMPLIFIER_HOME:join(directory,'native-home'),AMPLIFIER_SESSION_STATE_HOME:join(directory,'leases'),XDG_CACHE_HOME:join(directory,'cache'),XDG_CONFIG_HOME:join(directory,'config'),XDG_DATA_HOME:join(directory,'data'),XDG_STATE_HOME:join(directory,'state')};
 try{
  await mkdir(env.HOME);await execute(python,['-I','-B',new URL('./fixtures/managed-native.py',import.meta.url).pathname,directory],{env});
  const config={stateDirectory:join(directory,'host'),managedSessionRoot:join(directory,'managed'),defaultWorkspace:directory,allowedWorkspaceRoots:[directory],engines:[{id:'engine',label:'Actual offline Core/Foundation',command:python,args:['-I','-B','-m','amplifier_acp','--config',join(directory,'native.json')],env}]};
  host=await createHost(config);const port=Number(new URL(host.url).port);
  const prompt=join(directory,'prompt.txt');await writeFile(prompt,'explicit offline input');
  const cli=new URL('../src/cli.js',import.meta.url).pathname;
  const shared=['--server',host.url,'--state-dir',join(directory,'client'),'--output','json','--wait-ms','90000'];
  const first=JSON.parse((await execute(process.execPath,[cli,'run',...shared,'--prompt-file',prompt,'--command','managed-original','--managed','--agent','engine','--bundle','work','--provider','configured-instance','--model','second-model','--effort','low'],{env,timeout:100000})).stdout);
  assert.equal(first.status,'completed');assert.equal(first.output,'Offline reply: second-model');
  const record=await host.inspectSession(first.session);assert.equal(record.engineId,'engine');assert.ok(record.nativeSessionId);
  const originalContext=await host.readSessionContext(first.session,10);assert.equal(originalContext.messages.filter(x=>x.role==='user').length,1);
  await host.close();host=await createHost({...config,port});
  const recovered=JSON.parse((await execute(process.execPath,[cli,'inspect',...shared,'--command','managed-original'],{env})).stdout);assert.equal(recovered.status,'completed');
  const next=JSON.parse((await execute(process.execPath,[cli,'run',...shared,'--prompt-file',prompt,'--command','resumed-input','--session',first.session],{env,timeout:100000})).stdout);assert.equal(next.status,'completed');assert.equal(next.output,'Offline reply: second-model');
  const audit=(await readFile(join(directory,'provider-audit.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(audit.length>=2);assert.ok(audit.every(row=>row.model==='second-model'&&row.bundle==='chosen'&&row.effort==='low'),JSON.stringify(audit));
  assert.equal((await host.readSessionContext(first.session,10)).messages.filter(x=>x.role==='user').length,2);
  const result={kind:'actual-installed-core-foundation-headless',first,recovered,next,audit,zeroRemoteProviders:true};await writeFile(join(directory,'receipt.json'),JSON.stringify(result,null,2)+'\n');
  success=true;
 }finally{
  await host?.close();assert.deepEqual(await Promise.all(protectedPaths.map(privateStamp)),before,'shared settings and keys remain unchanged');
  if(success&&!process.env.AHP_HEADLESS_KEEP_FIXTURE)await rm(directory,{recursive:true,force:true});else console.log('Retained owned fixture:',directory);
 }
});
