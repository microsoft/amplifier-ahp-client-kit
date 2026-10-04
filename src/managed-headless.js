// Optional host extension. The host owns allocation, provider policy and durable proof.
const ROOT='ahp-root://', METHOD='x-amplifier/managedSession';
const text=(value,max=200)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
export function validateManaged(options){
  if(options.managed!==undefined&&typeof options.managed!=='boolean')throw Error('managed must be a boolean');
  for(const key of ['agent','bundle','provider','model','effort'])if(options[key]!==undefined&&!text(options[key],key==='model'?500:key==='effort'?100:200))throw Error(`Invalid ${key} selector`);
  if(options.managed&&(options.session!==undefined||options.workspace!==undefined))throw Error('Managed creation requires a new session without a workspace');
  if(['bundle','provider','model','effort'].some(key=>options[key]!==undefined)&&!options.managed)throw Error('Bundle, provider, model and effort require --managed for a new session');
  if((options.provider!==undefined)!==(options.model!==undefined))throw Error('Provider instance and model must be supplied together');
  if(options.effort!==undefined&&options.provider===undefined)throw Error('Effort requires a provider instance and model');
}
export function managedMethod(initialization,operations=['options','defaults','create','receipt']){
  const marker=initialization._meta?.['amplifier.dev/managedCreation'];
  if(marker?.version!==1||marker.method!==METHOD||marker.passive!==true||marker.typedSelection!==true||!Array.isArray(marker.operations)||!operations.every(op=>marker.operations.includes(op)))throw Error('Host does not advertise typed managed creation');
  return METHOD;
}
export const managedRequest=(client,operation,args)=>client.request(METHOD,{channel:ROOT,operation,args});
export async function prepareManaged(observer,record){
  managedMethod(observer.initialization);
  const value=await managedRequest(observer.client,'options',record.agent?{provider:record.agent}:{});
  if(value?.version!==1||!text(value.provider)||record.agent!==undefined&&value.provider!==record.agent||value.runtimeStarted!==false||value.configurationScope!=='global-and-session'||!Array.isArray(value.bundles)||value.bundles.length>64)throw Error('Invalid managed choices');
  const args={session:record.session,commandId:record.creationCommandId,provider:value.provider};
  if(record.bundle!==undefined){
    const rows=value.bundles.filter(row=>row?.id===record.bundle);
    if(rows.length!==1||typeof rows[0].revision!=='string'||! /^[a-f0-9]{64}$/.test(rows[0].revision))throw Error('Configured bundle alias is unavailable');
    args.bundle=record.bundle;args.bundleRevision=rows[0].revision;
  }
  if(record.provider!==undefined){
    const defaults=await managedRequest(observer.client,'defaults',{provider:args.provider,...(args.bundle?{bundle:args.bundle,bundleRevision:args.bundleRevision}:{})});
    if(defaults?.provider!==args.provider||defaults.runtimeStarted!==false||defaults.configurationScope!=='global-and-session'||!Array.isArray(defaults.providers)||defaults.providers.length>64||args.bundle!==undefined&&(defaults.bundleSelection?.id!==args.bundle||defaults.bundleSelection?.revision!==args.bundleRevision)||defaults.providers.filter(row=>row?.id===record.provider).length!==1)throw Error('Configured provider instance is unavailable for this bundle');
    args.selection={instance:record.provider,model:record.model,...(record.effort!==undefined?{effort:record.effort}:{})};
  }
  return args;
}
export function confirmedManaged(value,record){
  return value?.session===record.session&&value.receipt===record.creationCommandId&&value.creationConfirmed===true&&value.runtimeStarted===false&&value.workReplayed===false&&value.configurationScope==='global-and-session';
}
export async function recoverManaged(observer,record){
  const base={commandId:record.commandId,session:record.session,creationCommandId:record.creationCommandId};
  if(!record.creationRequest||record.creationPhase==='refused')return {...base,status:record.inputNotSent?'not-sent':'unknown',message:record.inputNotSent?'Managed creation was not admitted. No input was sent; use a new command for a new attempt.':'The original local admission is not settled. No creation or input was repeated.'};
  managedMethod(observer.initialization,['receipt']);
  const receipt=await managedRequest(observer.client,'receipt',{commandId:record.creationCommandId});
  if(receipt?.commandId===record.creationCommandId&&receipt.status==='completed'&&receipt.replayed===false&&confirmedManaged(receipt.result,record))return {...base,status:record.inputNotSent?'not-sent':'unknown',creationReceipt:{commandId:receipt.commandId,status:'completed',replayed:false,result:{session:record.session,receipt:record.creationCommandId,creationConfirmed:true,runtimeStarted:false,workReplayed:false,configurationScope:'global-and-session'}},message:record.inputNotSent?'Original managed creation is confirmed. The original input was not sent. Use this session with a new command to submit it explicitly.':'Original managed creation is confirmed, but original input admission is not settled. Inspect the original command; no input was repeated.'};
  return {...base,status:'unknown',message:'Original managed creation is unconfirmed. No creation or input was repeated.'};
}
