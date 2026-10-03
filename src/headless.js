import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import WebSocket from 'ws';
import {WebSocketTransport} from '@microsoft/agent-host-protocol/ws';
import {openConnection} from './connection.js';
import {ConfirmedResources} from './resources.js';

const ROOT='ahp-root://';
const MAX_PROMPT_BYTES=1024*1024;
export async function nodeTransport({url,token,ca,timeoutMs=15000}) {
  const target=new URL(url);
  if(!['ws:','wss:'].includes(target.protocol)||target.username||target.password||target.search||target.hash)throw Error('Use a ws:// or wss:// host URL without credentials, query, or fragment');
  if(token&&/[\r\n]/.test(token))throw Error('Invalid token');
  const socket=new WebSocket(target,{...(token?{headers:{Authorization:`Bearer ${token}`}}:{}),...(ca?{ca}:{}),handshakeTimeout:timeoutMs,maxPayload:4*1024*1024});
  await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',()=>reject(Error('Could not connect to the AHP host')));});
  return WebSocketTransport.fromSocket(socket);
}

class Observer {
  constructor(options){this.options=options;this.store=new ConfirmedResources();this.loading=new Map();this.waiters=new Set();this.closed=false;this.clientId=randomUUID();}
  wake(){for(const wake of this.waiters)wake();this.waiters.clear();}
  async open(){
    const connection=await openConnection({transportFactory:this.options.transportFactory??(()=>nodeTransport(this.options)),clientConfig:{requestTimeoutMs:Math.max(1000,Math.min(this.options.timeoutMs,30000)),subscriptionBuffer:256}});
    this.client=connection.client;
    this.consume=(async()=>{try{for await(const {event} of connection.events){if(event.type!=='action')continue;const envelope=event.params,loading=this.loading.get(envelope.channel);
      if(loading){loading.bytes+=Buffer.byteLength(JSON.stringify(envelope));if(loading.items.length>=512||loading.bytes>2*1024*1024)throw Error('Host updates exceeded the recovery buffer');loading.items.push(envelope);}
      else this.apply(envelope);
    }}catch(error){this.error=error;}finally{this.closed=true;this.wake();}})();
    this.initialization=await this.client.initialize({channel:ROOT,clientId:this.clientId,protocolVersions:['0.9.0'],clientInfo:{name:'Amplifier AHP CLI',version:'0.1.0'},initialSubscriptions:[ROOT]});
    if(this.initialization.protocolVersion!=='0.9.0')throw Error('Host selected an unoffered protocol');
    for(const snapshot of this.initialization.snapshots)this.store.snapshot(snapshot);
  }
  apply(envelope){if(envelope.origin?.clientId===this.clientId&&envelope.rejectionReason)this.rejection=envelope.rejectionReason;this.store.apply(envelope);this.options.onEvent?.(envelope);this.wake();}
  async subscribe(channel){
    const loading={items:[],bytes:0};this.loading.set(channel,loading);
    try{const {result,subscription}=await this.client.subscribe(channel,{...(channel.startsWith('ahp-chat:')?{view:{turns:50}}:{}),delivery:{maxLatencyMs:30}});await subscription.close();if(!result.snapshot)throw Error('Host did not provide a resource snapshot');this.store.snapshot(result.snapshot);this.loading.delete(channel);for(const action of loading.items)this.apply(action);return this.store.resources.get(channel);}
    finally{this.loading.delete(channel);}
  }
  async wait(milliseconds){if(this.closed)return;let wake;await new Promise(resolve=>{const timer=setTimeout(()=>{this.waiters.delete(wake);resolve();},milliseconds);wake=()=>{clearTimeout(timer);resolve();};this.waiters.add(wake);});}
  close(){this.client?.shutdown();}
}

function outcome(observer,record){
  const chat=observer.store.resources.get(record.channel),turn=chat?.turns?.find(turn=>turn.id===record.commandId);
  const base={commandId:record.commandId,session:record.session};
  if(turn)return {...base,status:turn.state==='complete'?'completed':turn.state,output:(turn.responseParts??[]).filter(part=>part.kind==='markdown').map(part=>typeof part.content==='string'?part.content:part.content?.value??'').join(''),usage:turn.usage};
  if(observer.rejection)return {...base,status:'rejected',message:observer.rejection};
  const active=chat?.activeTurn;
  if(active?.id===record.commandId){
    const tool=active.responseParts?.find(part=>part.kind==='toolCall'&&['pending-confirmation','pending-result-confirmation','auth-required'].includes(part.toolCall.status));
    if(tool||observer.store.resources.get(record.session)?.inputNeeded?.length)return {...base,status:'input-required',message:'Open this session in an interactive client to provide the requested input.'};
    return {...base,status:'running'};
  }
  return {...base,status:'unknown'};
}

async function observe(options,record,dispatch){
  const observer=new Observer(options),deadline=Date.now()+options.timeoutMs;
  try{
    await observer.open();
    if(dispatch&&record.create){
      await observer.client.request('createSession',{channel:record.session,...(record.agent?{provider:record.agent}:{}),...(record.workspace?{workingDirectories:[record.workspace.startsWith('file:')?record.workspace:pathToFileURL(record.workspace).href]}:{})});
    }
    const session=await observer.subscribe(record.session);record.channel=session.defaultChat;
    if(!record.channel)throw Error('The session has no default chat');
    await observer.subscribe(record.channel);
    if(dispatch){
      if(observer.store.resources.get(record.channel)?.activeTurn)return {commandId:record.commandId,session:record.session,status:'not-sent',message:'This session already has an active turn.'};
      // A durable record exists before either creation or this notification.
      await options.storage.write('command:'+record.commandId,record);
      observer.client.dispatch(record.channel,{type:'chat/turnStarted',turnId:record.commandId,startedAt:record.startedAt,message:{text:record.prompt,origin:{kind:'user'}}});
    }
    while(true){
      const result=outcome(observer,record);
      if(!['running','unknown'].includes(result.status))return result;
      if(!dispatch&&result.status==='unknown'){
        const method=observer.initialization._meta?.['amplifier.dev/host']?.receipts?.method;
        if(method){try{const receipt=await observer.client.request(method,{commandId:record.commandId});return {...result,receipt,message:'Host receipt retrieved. Work was not resubmitted; its output may be outside the current history page.'};}catch(error){if(error.code!==-32008)throw error;}}
        return {...result,message:'No matching turn is present in the current page. Work was not resubmitted.'};
      }
      if(observer.closed||Date.now()>=deadline)return {...result,message:observer.closed?'Connection closed; inspect this command to recover without resubmitting.':'Wait limit reached. The session remains available; no cancellation was sent.'};
      await observer.wait(Math.min(1000,Math.max(1,deadline-Date.now())));
    }
  }catch(error){return {commandId:record.commandId,session:record.session,status:'unknown',message:'The outcome is unconfirmed. Inspect the saved command before taking further action.',errorCode:typeof error.code==='number'?error.code:undefined};}
  finally{observer.close();}
}

function validate(options){
  if(!options.storage?.claim)throw Error('A durable command storage with exclusive claims is required');
  if(typeof options.commandId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(options.commandId))throw Error('Command ID must use 1–128 letters, digits, underscores or hyphens');
  if(!Number.isFinite(options.timeoutMs)||options.timeoutMs<1||options.timeoutMs>86400000)throw Error('Wait must be between 1 millisecond and 24 hours');
}

/** One durable admission. Reusing an identity only observes the original command. */
export async function runPrompt(options){
  options={timeoutMs:300000,...options};validate(options);
  if(typeof options.prompt!=='string'||!options.prompt.trim()||Buffer.byteLength(options.prompt)>MAX_PROMPT_BYTES)throw Error('Prompt must be nonempty and at most 1 MiB');
  const existing=await options.storage.read('command:'+options.commandId);
  if(existing){if(existing.host!==options.url||existing.prompt!==options.prompt||existing.session!==(options.session??existing.session)||existing.agent!==options.agent||existing.workspace!==options.workspace)throw Error('Command ID already belongs to a different input');return observe(options,existing,false);}
  const release=await options.storage.claim('command:'+options.commandId);
  try{
    if(await options.storage.read('command:'+options.commandId))throw Error('Command was concurrently saved. Inspect its outcome.');
    if(options.session&&!/^ahp-session:\/[A-Za-z0-9_-]{1,200}$/.test(options.session))throw Error('Invalid AHP session URI');
    if(options.session&&(options.agent||options.workspace))throw Error('An existing session retains its original agent and workspace');
    const record={commandId:options.commandId,host:options.url,session:options.session??`ahp-session:/${randomUUID()}`,create:!options.session,prompt:options.prompt,agent:options.agent,workspace:options.workspace,startedAt:new Date().toISOString()};
    await options.storage.write('command:'+options.commandId,record);
    options.onStarted?.({commandId:record.commandId,session:record.session});
    return await observe(options,record,true);
  }finally{await release();}
}

/** Read-only recovery: never creates a session, prompts, approves or cancels. */
export async function inspectCommand(options){
  options={timeoutMs:30000,...options};validate(options);
  const record=await options.storage.read('command:'+options.commandId);if(!record)throw Error('No saved command exists for this identity and host');
  if(record.host!==options.url)throw Error('Saved command belongs to a different host');
  return observe(options,record,false);
}
