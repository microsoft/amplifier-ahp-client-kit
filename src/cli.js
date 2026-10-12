#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {FileStorage} from './file-storage.js';
import {runPrompt,runTool,inspectCommand} from './headless.js';

const help=`Usage: amplifier-ahp run --server ws://host:port --prompt-file prompt.txt [options]
       amplifier-ahp run "prompt" --server ws://host:port [options]
       amplifier-ahp continue "prompt" --resume ahp-session:/ID --server ws://host:port [options]
       amplifier-ahp tool NAME --args '{"key":"value"}' --server ws://host:port [options]
       amplifier-ahp inspect --server ws://host:port --command ID [options]

  --session URI       Submit new input to this existing AHP session
  --agent ID          Advertised agent for a new session (default: host default)
  --workspace PATH    Host-side workspace for a new session
  --managed           Create a new host-managed chat (no workspace or --session)
  --bundle ALIAS      Configured bundle alias for --managed
  --provider INSTANCE Configured provider instance (requires --model)
  --model ID          Exact model for that instance (requires --provider)
  --effort VALUE      Optional effort for the explicit provider/model pair
  --command ID        Durable input identity (generated for run)
  --token-file PATH   Host bearer token; never a URL query parameter
  --ca-file PATH      Additional trusted CA for the host TLS connection
  --state-dir PATH    Private local command journal directory
  --identity NAME     Local credential identity; useful across token rotation
  --wait-ms NUMBER    Wait limit (default: 300000 run / 30000 inspect)
  --output FORMAT     text, json, or jsonl (default: text)
  --trace             Include selected session actions in jsonl output
  --prompt-file -     Read the prompt from standard input (maximum 1 MiB)
  --args JSON         Configured-tool arguments (object, maximum 64 KiB)

Tools use the selected session's normal schemas, policy and approval hooks.
Tool receipt recovery never invokes again or invents missing result bytes.

Repeated command IDs inspect the original input; they never resend it.
An interrupted wait leaves host work running. Approval requires an interactive client.
Managed overrides use advertised host choices; existing sessions keep their configuration.
Exit codes: 0 completed, 1 failed/rejected, 2 usage, 3 unconfirmed/running, 4 input needed.
`;

async function promptFile(path){
  if(path!=='-'){const file=await import('node:fs/promises').then(fs=>fs.open(path,'r'));try{const stat=await file.stat();if(!stat.isFile()||stat.size>1024*1024)throw Error('Prompt file must be a regular file of at most 1 MiB');return await file.readFile('utf8');}finally{await file.close();}}
  const chunks=[];let bytes=0;for await(const chunk of process.stdin){bytes+=chunk.length;if(bytes>1024*1024)throw Error('Prompt exceeds 1 MiB');chunks.push(chunk);}return Buffer.concat(chunks).toString('utf8');
}

async function main(){
  const {values:v,positionals}=parseArgs({allowPositionals:true,options:Object.fromEntries(['server','prompt-file','session','resume','agent','workspace','bundle','provider','model','effort','command','token-file','ca-file','state-dir','identity','wait-ms','output','args','output-format','timeout'].map(key=>[key,{type:'string'}]).concat([['help',{type:'boolean',short:'h'}],['trace',{type:'boolean'}],['managed',{type:'boolean'}]]))});
  if(v.help){process.stdout.write(help);return;}
  let mode=positionals[0];if(positionals.length>2||!['run','continue','tool','inspect'].includes(mode)||!v.server)throw Error('Choose run, continue, tool or inspect and provide --server. Use --help for options.');
  if(v.resume&&v.session)throw Error('Choose either --resume or --session');v.session??=v.resume;
  if(mode==='continue'){if(!v.session)throw Error('continue requires --resume with an AHP session URI');mode='run';}
  if(v['output-format']){if(v.output)throw Error('Choose one output format');if(!['text','json','json-trace'].includes(v['output-format']))throw Error('Unknown output format');v.output=v['output-format']==='json-trace'?'jsonl':v['output-format'];v.trace ||= v['output-format']==='json-trace';}
  if(v.timeout){if(v['wait-ms']||!Number.isInteger(Number(v.timeout)))throw Error('Choose one integer timeout');v['wait-ms']=String(Number(v.timeout)*1000);}
  if(mode==='run'&&(!v['prompt-file']&&!positionals[1]||v['prompt-file']&&positionals[1]||v.args))throw Error('run requires one prompt or --prompt-file and no tool arguments');
  if(mode==='tool'&&(!positionals[1]||v['prompt-file']))throw Error('tool requires a name and no prompt file');
  if(mode==='inspect'&&(!v.command||positionals[1]||v.args||v['prompt-file']||v.session||v.agent||v.workspace||v.managed||v.bundle||v.provider||v.model||v.effort))throw Error('inspect requires --command and accepts no new session or input options');
  const format=v.output??'text';if(!['text','json','jsonl'].includes(format)||v.trace&&format!=='jsonl')throw Error('Use text, json, or jsonl output; --trace requires jsonl');
  const url=new URL(v.server);if(!['ws:','wss:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('Use a ws:// or wss:// server URL without credentials, query, or fragment');
  const token=v['token-file']?(await readFile(v['token-file'],'utf8')).trim():undefined;
  const identity=v.identity??createHash('sha256').update(token??'anonymous').digest('hex');
  const scope=createHash('sha256').update(JSON.stringify([url.href,identity])).digest('hex');
  const storage=new FileStorage(join(v['state-dir']?resolve(v['state-dir']):join(homedir(),'.local/state/amplifier-ahp'),scope));
  const commandId=v.command??randomUUID();
  const emit=value=>{if(process.stdout.writableLength>1024*1024)throw Error('Output consumer is too slow. Inspect the saved command; host work was not cancelled.');process.stdout.write(JSON.stringify(value)+'\n');};
  const options={url:url.href,token,ca:v['ca-file']?await readFile(v['ca-file']):undefined,storage,commandId,timeoutMs:Number(v['wait-ms']??(mode==='run'?300000:30000)),
    onStarted:record=>{if(format==='jsonl')emit({type:'started',...record});else process.stderr.write(`Command ${record.commandId}\nSession ${record.session}\n`);},
    ...(v.trace?{onEvent:envelope=>{if(envelope.channel!== 'ahp-root://')emit({type:'action',envelope});}}:{})};
  const selection={session:v.session,agent:v.agent,workspace:v.workspace,managed:v.managed,bundle:v.bundle,provider:v.provider,model:v.model,effort:v.effort};
  let argumentsValue;if(mode==='tool')try{argumentsValue=JSON.parse(v.args??'{}')}catch{throw Error('Tool arguments must be valid JSON')}
  const result=mode==='run'?await runPrompt({...options,...selection,prompt:v['prompt-file']?await promptFile(v['prompt-file']):positionals[1]}):mode==='tool'?await runTool({...options,...selection,tool:positionals[1],arguments:argumentsValue}):await inspectCommand(options);
  if(format==='text'){if(result.output)process.stdout.write(result.output+'\n');process.stderr.write(`${result.status}: ${result.commandId}\nSession ${result.session}\n${result.message??''}\n`);}else emit({type:'result',...result});
  process.exitCode=result.status==='completed'?0:['error','cancelled','rejected','not-sent'].includes(result.status)?1:result.status==='input-required'?4:3;
}

await main().catch(error=>{process.stderr.write(`${error.message}\n`);process.exitCode=2;});
