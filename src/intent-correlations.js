import {exclusive} from './intent-lock.js';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const token=value=>typeof value==='string'&&value.length>0&&value.length<=1024&&!/[\x00-\x1f]/.test(value);
// Wire actions are JSON. Ignore property insertion order, preserve array order,
// and refuse lossy/non-JSON values rather than invent an acknowledgement match.
function canonical(value){
 if(value===null||typeof value==='string'||typeof value==='boolean')return value;
 if(typeof value==='number'&&Number.isFinite(value))return value;
 if(Array.isArray(value))return Array.from(value,item=>item===undefined?null:canonical(item));
 if(object(value)&&Object.getPrototypeOf(value)===Object.prototype)return Object.fromEntries(Object.keys(value).filter(key=>value[key]!==undefined).sort().map(key=>[key,canonical(value[key])]));
 throw Error('Exact JSON action required for intent correlation');
}
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const ownKeys=(value,keys)=>object(value)&&same(Object.keys(value).sort(),[...keys].sort());
const bindingKeys=['intentId','clientId','clientSeq','channel','action'];
function validBinding(row){return ownKeys(row,bindingKeys)&&token(row.intentId)&&token(row.clientId)&&token(row.channel)&&Number.isSafeInteger(row.clientSeq)&&row.clientSeq>0&&object(row.action)&&token(row.action.type);}

/** Private durable dispatch index. The caller authenticates envelope provenance
 * and supplies host/account/tab-isolated storage plus cross-process exclusion.
 * No method dispatches an action, replays work, or reads remote current state. */
export class IntentCorrelations {
 constructor(storage,{scope,limit=128,maxBytes=4*1024*1024}={}){
  if(!token(scope)||!Number.isSafeInteger(limit)||limit<1||limit>4096||!Number.isSafeInteger(maxBytes)||maxBytes<1024||maxBytes>16*1024*1024)throw Error('Bounded isolated intent correlation scope required');
  this.storage=storage;this.scope=scope;this.limit=limit;this.maxBytes=maxBytes;this.key=`intent-correlations:${scope}`;
 }
 bounded(state){if(new TextEncoder().encode(JSON.stringify(state)).length>this.maxBytes)throw Error('Intent correlation storage capacity reached; unresolved work preserved');return state;}
 async load(){
  const saved=await this.storage.read(this.key);if(saved===undefined)return {version:1,clients:[],entries:[]};
  if(!ownKeys(saved,['version','clients','entries'])||saved.version!==1||!Array.isArray(saved.clients)||saved.clients.length>4096||saved.clients.some(row=>!ownKeys(row,['clientId','clientSeq'])||!token(row.clientId)||!Number.isSafeInteger(row.clientSeq)||row.clientSeq<1)||new Set(saved.clients.map(row=>row.clientId)).size!==saved.clients.length||!Array.isArray(saved.entries)||saved.entries.length>this.limit||saved.entries.some(row=>!validBinding(row)||!saved.clients.some(client=>client.clientId===row.clientId&&row.clientSeq<=client.clientSeq))||new Set(saved.entries.map(row=>row.intentId)).size!==saved.entries.length||new Set(saved.entries.map(row=>JSON.stringify([row.clientId,row.clientSeq]))).size!==saved.entries.length)throw Error('Original intent correlation index unavailable; no implicit repair');
  canonical(saved);return this.bounded(saved);
 }
 async bindDispatch(id,{clientId,clientSeq}={}){
  const captured=structuredClone({clientId,clientSeq});
  if(!token(id)||!token(captured.clientId)||!Number.isSafeInteger(captured.clientSeq)||captured.clientSeq<1)throw Error('Exact original wire dispatch identity required');
  return exclusive(this.storage,this.key,async()=>{
   const state=await this.load();
   return exclusive(this.storage,`intent:${id}`,async()=>{
    const key=`intent:${id}`,old=await this.storage.read(key),retained=state.entries.find(row=>row.intentId===id);
    if(!old||old.id!==id||!token(old.channel)||!object(old.action)||!token(old.action.type))throw Error('Original admitted intent required before dispatch binding');
    canonical(old.action);
    const correlation={intentId:id,...captured,channel:old.channel,action:structuredClone(old.action)};
    if(old.dispatchCorrelation){
     if(!this.matchesIntent(correlation,old)||!retained||!same(retained,correlation))throw Error('Original dispatch binding changed or lookup unavailable; no implicit repair');
     return {created:false,correlation:retained};
    }
    if(retained||old.status!=='unknown')throw Error('Original dispatch is already bound or settled');
    const prior=state.clients.find(row=>row.clientId===captured.clientId);
    if(prior&&captured.clientSeq<=prior.clientSeq)throw Error('Original client sequence cannot be reused');
    if(state.entries.length>=this.limit||!prior&&state.clients.length>=4096)throw Error('Intent correlation capacity reached; unresolved work preserved');
    const clients=prior?state.clients.map(row=>row.clientId===captured.clientId?captured:row):[...state.clients,captured];
    const next=this.bounded({...state,clients,entries:[...state.entries,correlation]});
    const intent={...old,dispatchCorrelation:{scope:this.scope,...captured}};
    // Only a newly admitted intent AND created:true after BOTH durable writes
    // permit the caller's first dispatch. A partial write never permits repair
    // followed by dispatch, because a previous write outcome may be uncertain.
    await this.storage.write(key,intent);await this.storage.write(this.key,next);
    return {created:true,correlation};
   });
  });
 }
 matchesIntent(row,intent){return intent.id===row.intentId&&intent.channel===row.channel&&same(intent.action,row.action)&&same(intent.dispatchCorrelation,{scope:this.scope,clientId:row.clientId,clientSeq:row.clientSeq});}
 async settleEcho(envelope){
  const echo=structuredClone(envelope);
  if(!object(echo)||!token(echo.origin?.clientId)||!Number.isSafeInteger(echo.origin?.clientSeq)||echo.origin.clientSeq<1||!token(echo.channel)||!object(echo.action)||!token(echo.action.type)||!Number.isSafeInteger(echo.serverSeq)||echo.serverSeq<0||(echo.rejectionReason!==undefined&&(typeof echo.rejectionReason!=='string'||!echo.rejectionReason)))return {matched:false,reason:'invalid-echo'};
  canonical(echo.action);
  return exclusive(this.storage,this.key,async()=>{
   const state=await this.load(),row=state.entries.find(item=>item.clientId===echo.origin.clientId&&item.clientSeq===echo.origin.clientSeq);
   if(!row)return {matched:false,reason:'no-original-correlation'};
   if(row.channel!==echo.channel||!same(row.action,echo.action))return {matched:false,reason:'original-action-mismatch'};
   const status=echo.rejectionReason===undefined?'accepted':'rejected';
   const receipt={scope:this.scope,channel:row.channel,action:row.action,origin:{clientId:row.clientId,clientSeq:row.clientSeq},serverSeq:echo.serverSeq,...(echo.rejectionReason===undefined?{}:{rejectionReason:echo.rejectionReason})};
   const result=await exclusive(this.storage,`intent:${row.intentId}`,async()=>{
    const key=`intent:${row.intentId}`,old=await this.storage.read(key);
    if(!old||!this.matchesIntent(row,old))throw Error('Original correlated intent unavailable or changed; no settlement');
    if(old.echoReceipt){
     if(old.status!==status||!same(old.echoReceipt,receipt))return {matched:false,reason:'conflicting-original-echo'};
     return {matched:true,intent:old,correlation:row};
    }
    if(old.status!=='unknown')return {matched:false,reason:'original-outcome-already-settled'};
    const intent={...old,status,echoReceipt:receipt,...(echo.rejectionReason===undefined?{}:{rejectionReason:echo.rejectionReason})};
    await this.storage.write(key,intent);return {matched:true,intent,correlation:row};
   });
   if(result.matched){
    // Retire only the lookup, AFTER confirmed original evidence is durable.
    // The sequence high-water mark and complete intent receipt remain retained.
    try{await this.storage.write(this.key,{...state,entries:state.entries.filter(item=>item.intentId!==row.intentId)});}
    catch(error){return {...result,retirementError:error.message};}
   }
   return result;
  });
 }
}
