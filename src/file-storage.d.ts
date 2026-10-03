import type {CommandStorage} from './headless.js';
export class FileStorage implements CommandStorage {
  constructor(directory:string);
  readonly directory:string;
  read(key:string):Promise<any>;
  write(key:string,value:unknown):Promise<void>;
  claim(key:string):Promise<()=>Promise<void>>;
}
