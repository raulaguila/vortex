const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseBoolean}=require('../dist/boolean');
test('boolean parser accepts true/false, 1/0 and on/off without truthiness coercion',()=>{
 for(const value of [true,1,'true','1','on',' TRUE ',' On '])assert.equal(parseBoolean(value),true,String(value));
 for(const value of [false,0,'false','0','off',' FALSE ',' Off '])assert.equal(parseBoolean(value),false,String(value));
 for(const value of [null,undefined,'',' ','yes','no','null',2,-1,0.5,NaN,Infinity,[],{},['true'],new Boolean(false)])assert.equal(parseBoolean(value),undefined);
});
