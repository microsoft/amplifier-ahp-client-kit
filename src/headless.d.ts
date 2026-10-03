import type {AhpTransport} from '@microsoft/agent-host-protocol/client';
import type {ActionEnvelope} from '@microsoft/agent-host-protocol';
import type {StorageAdapter} from './index.js';
export interface CommandStorage extends StorageAdapter {claim(key:string):Promise<()=>Promise<void>>;}
export interface HeadlessOptions {
  url:string; token?:string; ca?:string|Uint8Array; storage:CommandStorage;
  commandId:string; timeoutMs?:number; transportFactory?:()=>Promise<AhpTransport>;
  onEvent?:(envelope:ActionEnvelope)=>void;
  onStarted?:(record:{commandId:string;session:string})=>void;
}
export interface HeadlessResult {
  commandId:string;session:string;
  status:'completed'|'error'|'cancelled'|'rejected'|'not-sent'|'input-required'|'running'|'unknown';
  output?:string;usage?:unknown;receipt?:unknown;message?:string;errorCode?:number;
}
export function nodeTransport(options:{url:string;token?:string;ca?:string|Uint8Array;timeoutMs?:number}):Promise<AhpTransport>;
export function runPrompt(options:HeadlessOptions&{prompt:string;session?:string;agent?:string;workspace?:string}):Promise<HeadlessResult>;
export function inspectCommand(options:HeadlessOptions):Promise<HeadlessResult>;
