const {test}=require('node:test');
const assert=require('node:assert/strict');
const {verifySum}=require('../scripts/eval-math.cjs');
test('external arithmetic evaluator accepts all fixture export styles',async()=>{
 for(const code of ['export const sum=(a,b)=>a+b;','export function sum(a,b){return a+b;}','const sum=(a,b)=>a+b; export {sum};','export const sum=(left,right)=>left+right;','export function sum(left,right){const result=left+right;return result;}'])assert.equal(await verifySum(code),true,code);
});
test('external arithmetic evaluator rejects broken, unsafe and stalled fixtures',async()=>{
 for(const code of ['export const sum=(a,b)=>a-b;','export const sum=()=>5;','import fs from "node:fs"; export const sum=(a,b)=>a+b;','export const sum=()=>process.exit();','export function sum(){while(true){}}'])assert.equal(await verifySum(code),false,code);
});
