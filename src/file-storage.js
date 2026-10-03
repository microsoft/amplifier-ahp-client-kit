import {createHash, randomUUID} from 'node:crypto';
import {mkdir, open, rename, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';

/** Private, durable Node storage. A command lock is never stolen after a crash. */
export class FileStorage {
  constructor(directory) { this.directory = resolve(directory); }
  path(key) { return join(this.directory, createHash('sha256').update(key).digest('hex') + '.json'); }
  async ready() { await mkdir(this.directory, {recursive:true, mode:0o700}); }
  async read(key) {
    try { const file=await open(this.path(key),'r');try{const stat=await file.stat();if(!stat.isFile()||stat.size>8*1024*1024)throw Error('Saved command exceeds the storage limit');return JSON.parse(await file.readFile('utf8'));}finally{await file.close();} }
    catch(error) { if(error.code==='ENOENT')return undefined; throw error; }
  }
  async write(key, value) {
    await this.ready(); const text=JSON.stringify(value); if(Buffer.byteLength(text)>8*1024*1024)throw Error('Saved command exceeds the storage limit');
    const path=this.path(key), temporary=path+'.'+randomUUID()+'.tmp';
    const file=await open(temporary,'wx',0o600);
    try { await file.writeFile(text); await file.sync(); } finally { await file.close(); }
    await rename(temporary,path); const directory=await open(this.directory,'r');
    try { await directory.sync(); } finally { await directory.close(); }
  }
  async claim(key) {
    await this.ready(); const path=this.path(key)+'.lock';
    try { await mkdir(path,{mode:0o700}); }
    catch(error) { if(error.code==='EEXIST')throw Error('Command is already owned or was interrupted. Inspect its saved outcome; it will not be resent.'); throw error; }
    return ()=>rm(path,{recursive:true,force:true});
  }
}
