import {structuredPatch,applyPatch,StructuredPatch} from 'diff';
export function reviewPatch(before:string,after:string):StructuredPatch {
 const patch=structuredPatch('before','after',before,after,undefined,undefined,{context:3,timeout:1000});
 if(!patch)throw new Error('Diff is too complex for partial review. Review the whole file.');return patch;
}
export function selectHunks(before:string,patch:StructuredPatch,indices:number[]):string {
 if(indices.some(i=>!Number.isInteger(i)||i<0||i>=patch.hunks.length))throw new Error('Invalid hunk selection.');
 const result=applyPatch(before,{...patch,hunks:patch.hunks.filter((_,i)=>indices.includes(i))},{fuzzFactor:0});
 if(result===false)throw new Error('Selected changes conflict. Reopen the diff.');return result;
}
