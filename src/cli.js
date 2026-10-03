#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {FileStorage} from './file-storage.js';
import {runPrompt,inspectCommand} from './headless.js';

const help=`Usage: amplifier-ahp run --server ws://host:port --prompt-file prompt.txt [options]
       amplifier-ahp inspect --server ws://host:port --command ID [options]

  --session URI       Submit new input to this existing AHP session
  --agent ID          Advertised agent for a new session (default: host default)
  --workspace PATH    Host-side workspace for a new session
  --command ID        Durable input identity (generated for run)
  --token-file PATH   Host bearer token; never a URL query parameter
  --ca-file PATH      Additional trusted CA for the host TLS connection
  --state-dir PATH    Private local command journal directory
  --identity NAME     Local credential identity; useful across token rotation
  --wait-ms NUMBER    Wait limit (default: 300000 run / 30000 inspect)
  --output FORMAT     text, json, or jsonl (default: text)
  --trace             Include selected session actions in jsonl output
  --prompt-file -     Read the prompt from standard input (maximum 1 MiB)

Repeated command IDs inspect the original input; they never resend it.
An interrupted wait leaves host work running. Approval requires an interactive client.
Agent/model/bundle defaults come from the configured host; this client does not change them.
Exit codes: 0 completed, 1 failed/rejected, 2 usage, 3 unconfirmed/running, 4 input needed.
`;

async function promptFile(path){
  if(path!=='-'){const file=await import('node:fs/promises').then(fs=>fs.open(path,'r'));try{const stat=await file.stat();if(!stat.isFile()||stat.size>1024*1024)throw Error('Prompt file must be a regular file of at most 1 MiB');return await file.readFile('utf8');}finally{await file.close();}}
  const chunks=[];let bytes=0;for await(const chunk of process.stdin){bytes+=chunk.length;if(bytes>1024*1024)throw Error('Prompt exceeds 1 MiB');chunks.push(chunk);}return Buffer.concat(chunks).toString('utf8');
}

async function main(){
  const {values:v,positionals}=parseArgs({allowPositionals:true,options:Object.fromEntries(['server','prompt-file','session','agent','workspace','command','token-file','ca-file','state-dir','identity','wait-ms','output'].map(key=>[key,{type:'string'}]).concat([['help',{type:'boolean',short:'h'}],['trace',{type:'boolean'}]]))});
  if(v.help){process.stdout.write(help);return;}
  const mode=positionals[0];if(positionals.length!==1||!['run','inspect'].includes(mode)||!v.server)throw Error('Choose run or inspect and provide --server. Use --help for options.');
  if(mode==='run'&&!v['prompt-file'])throw Error('run requires --prompt-file');
  if(mode==='inspect'&&(!v.command||v['prompt-file']||v.session||v.agent||v.workspace))throw Error('inspect requires --command and accepts no new session or input options');
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
  const result=mode==='run'?await runPrompt({...options,prompt:await promptFile(v['prompt-file']),session:v.session,agent:v.agent,workspace:v.workspace}):await inspectCommand(options);
  if(format==='text'){if(result.output)process.stdout.write(result.output+'\n');process.stderr.write(`${result.status}: ${result.commandId}\nSession ${result.session}\n${result.message??''}\n`);}else emit({type:'result',...result});
  process.exitCode=result.status==='completed'?0:['error','cancelled','rejected','not-sent'].includes(result.status)?1:result.status==='input-required'?4:3;
}

main().catch(error=>{process.stderr.write(`${error.message}\n`);process.exitCode=2;});
