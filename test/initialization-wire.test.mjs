import test from 'node:test';
import assert from 'node:assert/strict';
import {AhpClient,InMemoryTransport} from '@microsoft/agent-host-protocol/client';
import {ConfirmedResources,recoverConnection} from '../src/index.js';

test('real SDK sends additive initialization metadata on the wire without replaying it on reconnect',async()=>{
 const [transport,peer]=InMemoryTransport.pair(),client=new AhpClient(transport),store=new ConfirmedResources();
 client.connect();
 const snapshot={resource:'ahp-root://',fromSeq:1,state:{}};
 const options={store,clientId:'c',subscriptions:new Set(['ahp-root://']),initialized:true,clientInfo:{name:'consumer'},initializationMeta:{'example/migration':{clientId:'legacy-tab'}}};
 try{
  const initialized=recoverConnection(client,options);
  const first=JSON.parse((await peer.recv()).text);
  assert.equal(first.method,'initialize');assert.equal(first.params._meta['example/migration'].clientId,'legacy-tab');assert.equal(first.params.clientInfo.name,'consumer');
  await peer.send({jsonrpc:'2.0',id:first.id,result:{protocolVersion:'0.9.0',serverSeq:1,snapshots:[snapshot]}});await initialized;
  const recovered=recoverConnection(client,options),second=JSON.parse((await peer.recv()).text);
  assert.equal(second.method,'reconnect');assert.equal(second.params._meta,undefined);assert.equal(second.params.clientInfo,undefined);
  await peer.send({jsonrpc:'2.0',id:second.id,result:{type:'replay',actions:[],missing:[]}});await recovered;
 }finally{await transport.close();await peer.close();}
});
