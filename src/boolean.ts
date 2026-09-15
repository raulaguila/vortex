/** Parse explicit boolean representations; undefined means the value is not recognized. */
export function parseBoolean(value:unknown):boolean|undefined{
 if(typeof value==='boolean')return value;
 if(value===1)return true;
 if(value===0)return false;
 if(typeof value==='string'){
  switch(value.trim().toLowerCase()){
   case 'true':case '1':case 'on':return true;
   case 'false':case '0':case 'off':return false;
  }
 }
 return undefined;
}
