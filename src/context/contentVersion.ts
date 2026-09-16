import {createHash} from 'node:crypto';
export const contentVersion=(text:string)=>createHash('sha256').update(text).digest('hex');
