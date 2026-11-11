// Funções nativas do PHP sem efeito colateral, sobre a representação do interpretador:
// arrays são objetos sem protótipo (chave => valor). Callbacks (array_map, usort...) chegam por `invoke`.
export type Invoke=(callable:any,args:any[])=>Promise<any>;
const truth=(v:any):boolean=>v!==null&&v!==undefined&&v!==false&&v!==0&&v!==''&&v!=='0'&&(typeof v!=='object'||Object.keys(v).length>0);
const str=(v:any):string=>v===null||v===undefined||v===false?'':v===true?'1':typeof v==='object'?'Array':String(v);
const num=(v:any)=>{const n=Number(typeof v==='string'?v.trim().match(/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i)?.[0]??0:v);return Number.isNaN(n)?0:n;};
const list=(values:any[])=>{const a:any=Object.create(null);values.forEach((v,i)=>{a[i]=v;});return a;};
const entries=(a:any):[string,any][]=>a&&typeof a==='object'?Object.entries(a):[];
const values=(a:any)=>entries(a).map(e=>e[1]);
const isList=(a:any)=>entries(a).every(([k],i)=>k===String(i));
const object=(pairs:[any,any][])=>{const a:any=Object.create(null);for(const [k,v] of pairs)a[k]=v;return a;};
const pcre=(pattern:string,global=false)=>{const end=pattern.lastIndexOf(pattern[0]===')'?'(':pattern[0]==='{'?'}':pattern[0]);const body=pattern.slice(1,end),flags=pattern.slice(end+1).replace(/[^imsux]/g,'').replace('x','');return new RegExp(body.replace(/\(\?<([a-zA-Z_]\w*)>/g,'(?<$1>').replace(/\\A/g,'^').replace(/\\z|\\Z/g,'$'),flags+(global?'g':'')+(/u/.test(flags)?'':''));};
function sprintf(format:string,args:any[]){
 let index=0;
 return format.replace(/%(?:(\d+)\$)?([-+ 0]|'.)*(\d+)?(?:\.(\d+))?([bcdeEfFgGosuxX%])/g,(match,position,_flag,width,precision,type)=>{
  if(type==='%')return '%';
  const flags=match.slice(1).match(/^(?:\d+\$)?((?:[-+ 0]|'.)*)/)![1];const value=args[position?Number(position)-1:index++];
  let out:string;
  switch(type){
   case 'd':case 'u':out=String(Math.trunc(num(value)));if(flags.includes('+')&&num(value)>=0)out='+'+out;break;
   case 'f':case 'F':out=num(value).toFixed(precision===undefined?6:Number(precision));break;
   case 'e':case 'E':out=num(value).toExponential(precision===undefined?6:Number(precision));if(type==='E')out=out.toUpperCase();break;
   case 'g':case 'G':out=String(num(value));break;
   case 'x':out=Math.trunc(num(value)).toString(16);break;case 'X':out=Math.trunc(num(value)).toString(16).toUpperCase();break;
   case 'o':out=Math.trunc(num(value)).toString(8);break;case 'b':out=Math.trunc(num(value)).toString(2);break;
   case 'c':out=String.fromCharCode(num(value));break;
   default:out=str(value);if(precision!==undefined)out=out.slice(0,Number(precision));
  }
  if(width&&out.length<Number(width)){const pad=flags.match(/'(.)/)?.[1]??(flags.includes('0')&&!flags.includes('-')?'0':' ');out=flags.includes('-')?out.padEnd(Number(width),pad===' '||pad==='0'?' ':pad):out.padStart(Number(width),pad);}
  return out;
 });
}
function numberFormat(value:any,decimals=0,point='.',thousands=','){
 const fixed=Math.abs(num(value)).toFixed(decimals);const [int,frac]=fixed.split('.');
 return (num(value)<0&&Number(fixed)!==0?'-':'')+int.replace(/\B(?=(\d{3})+(?!\d))/g,thousands)+(frac?point+frac:'');
}
const ucwords=(s:string,delimiters=' \t\r\n\f\v')=>s.replace(new RegExp('(^|['+delimiters.replace(/[\]\\^-]/g,'\\$&')+'])(\\S)','g'),(_,a,b)=>a+b.toUpperCase());
const stripTags=(s:string)=>s.replace(/<!--[\s\S]*?-->|<\/?[a-z!?][^>]*>/gi,'');
const decodeEntities=(s:string)=>s.replace(/&(#\d+|#x[\da-f]+|amp|lt|gt|quot|#039|apos|nbsp);/gi,(m,e)=>{const l=e.toLowerCase();if(l[0]==='#')return String.fromCodePoint(l[1]==='x'?parseInt(l.slice(2),16):Number(l.slice(1)));return ({amp:'&',lt:'<',gt:'>',quot:'"','#039':"'",apos:"'",nbsp:' '} as any)[l];});
const compare=(a:any,b:any)=>typeof a==='number'||typeof b==='number'?num(a)-num(b):str(a)<str(b)?-1:str(a)>str(b)?1:0;
// Funções que alteram argumentos por referência (sort, preg_match com $matches...): o interpretador grava refs de volta.
export class Ref {result:any;refs:Record<number,any>;constructor(result:any,refs:Record<number,any>){this.result=result;this.refs=refs;}}
async function sorted(a:any,invoke:Invoke|undefined,cb:any,by:'value'|'key',keep:boolean,reverse=false){
 const pairs=entries(a);
 if(cb){for(let i=1;i<pairs.length;i++){const item=pairs[i];let j=i-1;while(j>=0&&num(await invoke!(cb,by==='key'?[pairs[j][0],item[0]]:[pairs[j][1],item[1]]))>0){pairs[j+1]=pairs[j];j--;}pairs[j+1]=item;}}
 else pairs.sort((x,y)=>compare(by==='key'?x[0]:x[1],by==='key'?y[0]:y[1]));
 if(reverse)pairs.reverse();
 return new Ref(true,{0:keep?object(pairs):list(pairs.map(p=>p[1]))});
}
export const builtins:Record<string,(args:any[],invoke:Invoke)=>any>={
 // strings
 substr_count:a=>str(a[1])?str(a[0]).split(str(a[1])).length-1:0,
 stripos:a=>{const i=str(a[0]).toLowerCase().indexOf(str(a[1]).toLowerCase(),num(a[2]??0));return i<0?false:i;},
 strrpos:a=>{const i=str(a[0]).lastIndexOf(str(a[1]));return i<0?false:i;},
 strripos:a=>{const i=str(a[0]).toLowerCase().lastIndexOf(str(a[1]).toLowerCase());return i<0?false:i;},
 strstr:a=>{const s=str(a[0]),i=s.indexOf(str(a[1]));return i<0?false:a[2]?s.slice(0,i):s.slice(i);},
 stristr:a=>{const s=str(a[0]),i=s.toLowerCase().indexOf(str(a[1]).toLowerCase());return i<0?false:a[2]?s.slice(0,i):s.slice(i);},
 strrchr:a=>{const s=str(a[0]),i=s.lastIndexOf(str(a[1])[0]);return i<0?false:s.slice(i);},
 str_contains:a=>str(a[0]).includes(str(a[1])),str_starts_with:a=>str(a[0]).startsWith(str(a[1])),str_ends_with:a=>str(a[0]).endsWith(str(a[1])),
 ltrim:a=>a[1]===undefined?str(a[0]).replace(/^[\s\0\x0B]+/,''):str(a[0]).replace(new RegExp('^['+str(a[1]).replace(/[\]\\^-]/g,'\\$&')+']+'),''),
 rtrim:a=>a[1]===undefined?str(a[0]).replace(/[\s\0\x0B]+$/,''):str(a[0]).replace(new RegExp('['+str(a[1]).replace(/[\]\\^-]/g,'\\$&')+']+$'),''),
 chop:a=>str(a[0]).replace(/[\s\0\x0B]+$/,''),
 lcfirst:a=>{const s=str(a[0]);return s.charAt(0).toLowerCase()+s.slice(1);},
 ucwords:a=>ucwords(str(a[0]),a[1]===undefined?undefined:str(a[1])),
 mb_strtoupper:a=>str(a[0]).toUpperCase(),mb_strlen:a=>[...str(a[0])].length,
 mb_substr:a=>{const c=[...str(a[0])];const start=num(a[1]),length=a[2]===undefined||a[2]===null?undefined:num(a[2]);const from=start<0?Math.max(0,c.length+start):start;return c.slice(from,length===undefined?undefined:length<0?c.length+length:from+length).join('');},
 mb_convert_case:a=>{const s=str(a[0]);const mode=num(a[1]);return mode===0?s.toUpperCase():mode===1?s.toLowerCase():s.toLowerCase().replace(/(^|\s)(\S)/g,(_,x,y)=>x+y.toUpperCase());},
 mb_internal_encoding:()=>true,mb_strpos:a=>{const i=str(a[0]).indexOf(str(a[1]),num(a[2]??0));return i<0?false:i;},
 str_pad:a=>{const s=str(a[0]),length=num(a[1]),pad=a[2]===undefined?' ':str(a[2]),type=a[3]===undefined?1:num(a[3]);if(length<=s.length||!pad)return s;const total=length-s.length;if(type===0)return s.padStart(length,pad);if(type===2){const left=Math.floor(total/2);return ''.padStart(left,pad)+s+''.padStart(total-left,pad);}return s.padEnd(length,pad);},
 str_repeat:a=>str(a[0]).repeat(Math.max(0,num(a[1]))),strrev:a=>[...str(a[0])].reverse().join(''),
 str_split:a=>{const s=str(a[0]),n=Math.max(1,num(a[1]??1));const out:string[]=[];for(let i=0;i<s.length;i+=n)out.push(s.slice(i,i+n));return list(out.length?out:['']);},
 str_word_count:a=>(str(a[0]).match(/[\p{L}'-]+/gu)||[]).length,
 wordwrap:a=>{const width=num(a[1]??75),brk=a[2]===undefined?'\n':str(a[2]);return str(a[0]).split(' ').reduce((lines:string[],word)=>{const last=lines[lines.length-1];if(last!==undefined&&(last+' '+word).length<=width)lines[lines.length-1]=last+' '+word;else lines.push(word);return lines;},[]).join(brk);},
 nl2br:a=>str(a[0]).replace(/(\r\n|\n|\r)/g,'<br />$1'),strip_tags:a=>stripTags(str(a[0])),
 addslashes:a=>str(a[0]).replace(/([\\'"\0])/g,'\\$1'),stripslashes:a=>str(a[0]).replace(/\\(.?)/g,'$1'),
 html_entity_decode:a=>decodeEntities(str(a[0])),htmlspecialchars_decode:a=>decodeEntities(str(a[0])),
 urldecode:a=>decodeURIComponent(str(a[0]).replace(/\+/g,' ')),rawurldecode:a=>decodeURIComponent(str(a[0])),
 base64_encode:a=>Buffer.from(str(a[0]),'utf8').toString('base64'),base64_decode:a=>Buffer.from(str(a[0]),'base64').toString('utf8'),
 md5:a=>require_hash('md5',str(a[0])),sha1:a=>require_hash('sha1',str(a[0])),crc32:a=>crc32(str(a[0])),
 sprintf:a=>sprintf(str(a[0]),a.slice(1)),vsprintf:a=>sprintf(str(a[0]),values(a[1])),
 number_format:a=>numberFormat(a[0],num(a[1]??0),a[2]===undefined?'.':str(a[2]),a[3]===undefined?',':str(a[3])),
 nl_langinfo:()=>'',quotemeta:a=>str(a[0]).replace(/([.\\+*?[^\]$()])/g,'\\$1'),
 ord:a=>str(a[0]).charCodeAt(0)||0,chr:a=>String.fromCharCode(num(a[0])%256),
 strcmp:a=>compare(str(a[0]),str(a[1])),strcasecmp:a=>compare(str(a[0]).toLowerCase(),str(a[1]).toLowerCase()),strncmp:a=>compare(str(a[0]).slice(0,num(a[2])),str(a[1]).slice(0,num(a[2]))),strnatcmp:a=>str(a[0]).localeCompare(str(a[1]),undefined,{numeric:true}),strnatcasecmp:a=>str(a[0]).localeCompare(str(a[1]),undefined,{numeric:true,sensitivity:'base'}),
 similar_text:a=>{const x=str(a[0]),y=str(a[1]);let n=0;for(const c of x)if(y.includes(c))n++;return n;},
 iconv:a=>str(a[2]),utf8_encode:a=>str(a[0]),utf8_decode:a=>str(a[0]),mb_convert_encoding:a=>str(a[0]),
 // regex
 preg_match:a=>{const m=str(a[1]).match(pcre(str(a[0])));const groups:any=Object.create(null);if(m){m.forEach((v,i)=>{groups[i]=v??'';});for(const [k,v] of Object.entries(m.groups||{}))groups[k]=v??'';}return new Ref(m?1:0,{2:groups});},
 preg_split:a=>{const flags=num(a[3]??0);let parts=str(a[1]).split(pcre(str(a[0])));if(flags&1)parts=parts.filter(p=>p!=='');return list(parts.filter(p=>p!==undefined));},
 preg_quote:a=>str(a[0]).replace(/[.\\+*?[^\]$(){}=!<>|:#\/-]/g,'\\$&'),
 preg_grep:a=>object(entries(a[1]).filter(([,v])=>pcre(str(a[0])).test(str(v)))),
 preg_replace_callback:async(a,invoke)=>{const re=pcre(str(a[0]),true),s=str(a[2]);let out='',last=0;for(const m of s.matchAll(re)){out+=s.slice(last,m.index)+str(await invoke(a[1],[list([...m])]));last=(m.index||0)+m[0].length;}return out+s.slice(last);},
 // arrays
 array_slice:a=>{const pairs=entries(a[0]);const start=num(a[1]),length=a[2]===undefined||a[2]===null?undefined:num(a[2]);const from=start<0?Math.max(0,pairs.length+start):start;const part=pairs.slice(from,length===undefined?undefined:length<0?pairs.length+length:from+length);return a[3]||!isList(a[0])?object(part.map(([k,v])=>[/^\d+$/.test(k)&&!a[3]?undefined as any:k,v]).map(([k,v],i)=>[k===undefined?i:k,v])):list(part.map(p=>p[1]));},
 array_splice:a=>{const v=values(a[0]);const removed=v.splice(num(a[1]),a[2]===undefined||a[2]===null?v.length:num(a[2]),...(a[3]===undefined?[]:typeof a[3]==='object'?values(a[3]):[a[3]]));return new Ref(list(removed),{0:list(v)});},
 array_merge:a=>{const out:any=Object.create(null);let i=0;for(const arr of a)for(const [k,v] of entries(arr)){if(/^\d+$/.test(k))out[i++]=v;else out[k]=v;}return out;},
 array_merge_recursive:a=>builtins.array_merge(a,async()=>null),
 array_combine:a=>object(values(a[0]).map((k,i)=>[str(k),values(a[1])[i]])),
 array_flip:a=>object(entries(a[0]).map(([k,v])=>[str(v),/^\d+$/.test(k)?Number(k):k])),
 array_fill:a=>object(Array.from({length:num(a[1])},(_,i)=>[num(a[0])+i,a[2]])),
 array_fill_keys:a=>object(values(a[0]).map(k=>[str(k),a[1]])),
 array_reverse:a=>{const pairs=entries(a[0]).reverse();return a[1]||!isList(a[0])?object(pairs):list(pairs.map(p=>p[1]));},
 array_unique:a=>{const seen=new Set<string>();return object(entries(a[0]).filter(([,v])=>{const k=str(v);if(seen.has(k))return false;seen.add(k);return true;}));},
 array_search:a=>{const found=entries(a[1]).find(([,v])=>a[2]?v===a[0]:str(v)===str(a[0]));return found?(/^\d+$/.test(found[0])?Number(found[0]):found[0]):false;},
 array_column:a=>list(values(a[0]).map(row=>row?.[str(a[1])]).filter(v=>v!==undefined)),
 array_sum:a=>values(a[0]).reduce((s,v)=>s+num(v),0),array_product:a=>values(a[0]).reduce((s,v)=>s*num(v),1),
 array_key_first:a=>{const k=Object.keys(a[0]||{})[0];return k===undefined?null:/^\d+$/.test(k)?Number(k):k;},
 array_key_last:a=>{const k=Object.keys(a[0]||{}).at(-1);return k===undefined?null:/^\d+$/.test(k)?Number(k):k;},
 array_shift:a=>{const v=values(a[0]);const first=v.shift();return new Ref(first===undefined?null:first,{0:list(v)});},
 array_unshift:a=>{const v=[...a.slice(1),...values(a[0])];return new Ref(v.length,{0:list(v)});},
 array_rand:a=>{const k=Object.keys(a[0]||{})[0];return /^\d+$/.test(k)?Number(k):k;},
 array_count_values:a=>{const out:any=Object.create(null);for(const v of values(a[0]))out[str(v)]=(out[str(v)]||0)+1;return out;},
 array_diff:a=>list(values(a[0]).filter(v=>!a.slice(1).some(o=>values(o).map(str).includes(str(v))))),
 array_intersect:a=>list(values(a[0]).filter(v=>a.slice(1).every(o=>values(o).map(str).includes(str(v))))),
 array_diff_key:a=>object(entries(a[0]).filter(([k])=>!a.slice(1).some(o=>Object.hasOwn(Object(o),k)))),
 array_chunk:a=>{const v=values(a[0]),n=Math.max(1,num(a[1]));const out:any[]=[];for(let i=0;i<v.length;i+=n)out.push(list(v.slice(i,i+n)));return list(out);},
 array_pad:a=>{const v=values(a[0]);const n=num(a[1]);while(v.length<Math.abs(n))n>0?v.push(a[2]):v.unshift(a[2]);return list(v);},
 array_map:async(a,invoke)=>{if(a.length>2){const lists=a.slice(1).map(values);const n=Math.max(...lists.map(l=>l.length));const out=[];for(let i=0;i<n;i++)out.push(a[0]===null?list(lists.map(l=>l[i]??null)):await invoke(a[0],lists.map(l=>l[i]??null)));return list(out);}const out:[string,any][]=[];for(const [k,v] of entries(a[1]))out.push([k,a[0]===null?v:await invoke(a[0],[v])]);return isList(a[1])?list(out.map(o=>o[1])):object(out);},
 array_filter:async(a,invoke)=>{const out:[string,any][]=[];const mode=num(a[2]??0);for(const [k,v] of entries(a[0])){const key=/^\d+$/.test(k)?Number(k):k;const keep=a[1]===undefined||a[1]===null?truth(v):truth(await invoke(a[1],mode===2?[key]:mode===1?[v,key]:[v]));if(keep)out.push([k,v]);}return object(out);},
 array_reduce:async(a,invoke)=>{let acc=a[2]??null;for(const v of values(a[0]))acc=await invoke(a[1],[acc,v]);return acc;},
 array_walk:async(a,invoke)=>{for(const [k,v] of entries(a[0]))await invoke(a[1],[v,/^\d+$/.test(k)?Number(k):k]);return true;},
 range:a=>{const from=a[0],to=a[1],step=Math.abs(num(a[2]??1))||1;if(typeof from==='string'&&typeof to==='string'&&from.length===1&&to.length===1&&!/\d/.test(from)){const out=[];const s=from.charCodeAt(0),e=to.charCodeAt(0);for(let c=s;s<=e?c<=e:c>=e;c+=s<=e?step:-step)out.push(String.fromCharCode(c));return list(out);}const s=num(from),e=num(to);const out=[];for(let i=s;s<=e?i<=e:i>=e;i+=s<=e?step:-step)out.push(i);return list(out);},
 compact:()=>Object.create(null),
 is_array:a=>a[0]!==null&&typeof a[0]==='object'&&!(a[0] as any).__closure,is_string:a=>typeof a[0]==='string',is_numeric:a=>typeof a[0]==='number'||(typeof a[0]==='string'&&a[0].trim()!==''&&!Number.isNaN(Number(a[0]))),
 is_int:a=>Number.isInteger(a[0]),is_integer:a=>Number.isInteger(a[0]),is_float:a=>typeof a[0]==='number'&&!Number.isInteger(a[0]),is_bool:a=>typeof a[0]==='boolean',is_null:a=>a[0]===null||a[0]===undefined,is_object:a=>a[0]!==null&&typeof a[0]==='object'&&!isList(a[0]),
 is_callable:a=>typeof a[0]==='string'||!!a[0]?.__closure,
 sort:async a=>sorted(a[0],undefined,undefined,'value',false),rsort:async a=>sorted(a[0],undefined,undefined,'value',false,true),
 arsort:async a=>sorted(a[0],undefined,undefined,'value',true,true),krsort:async a=>sorted(a[0],undefined,undefined,'key',true,true),natsort:async a=>sorted(a[0],undefined,undefined,'value',true),
 usort:async(a,invoke)=>sorted(a[0],invoke,a[1],'value',false),uasort:async(a,invoke)=>sorted(a[0],invoke,a[1],'value',true),
 shuffle:()=>true,
 // números
 abs:a=>Math.abs(num(a[0])),floor:a=>Math.floor(num(a[0])),ceil:a=>Math.ceil(num(a[0])),
 round:a=>{const p=10**num(a[1]??0);return Math.round(num(a[0])*p)/p;},
 max:a=>{const v=a.length===1?values(a[0]):a;return v.reduce((m,x)=>compare(x,m)>0?x:m);},min:a=>{const v=a.length===1?values(a[0]):a;return v.reduce((m,x)=>compare(x,m)<0?x:m);},
 intval:a=>Math.trunc(num(a[0])),floatval:a=>num(a[0]),boolval:a=>truth(a[0]),strval:a=>str(a[0]),settype:()=>true,
 pow:a=>num(a[0])**num(a[1]),sqrt:a=>Math.sqrt(num(a[0])),intdiv:a=>Math.trunc(num(a[0])/num(a[1])),fmod:a=>num(a[0])%num(a[1]),pi:()=>Math.PI,
 dechex:a=>Math.trunc(num(a[0])).toString(16),hexdec:a=>parseInt(str(a[0]),16)||0,decbin:a=>Math.trunc(num(a[0])).toString(2),bindec:a=>parseInt(str(a[0]),2)||0,
 // tipos e variáveis
 gettype:a=>a[0]===null||a[0]===undefined?'NULL':typeof a[0]==='string'?'string':typeof a[0]==='boolean'?'boolean':Number.isInteger(a[0])?'integer':typeof a[0]==='number'?'double':'array',
 var_export:a=>a[1]?JSON.stringify(a[0]):'',print_r:a=>a[1]?JSON.stringify(a[0]):'',
 serialize:a=>JSON.stringify(a[0]),unserialize:a=>{try{return JSON.parse(str(a[0]));}catch{return false;}},
 // ambiente sem efeito na renderização estática
 date_default_timezone_set:()=>true,date_default_timezone_get:()=>'America/Sao_Paulo',setlocale:()=>'pt_BR',set_error_handler:()=>null,set_exception_handler:()=>null,restore_error_handler:()=>true,
 error_log:()=>true,ob_implicit_flush:()=>null,flush:()=>null,ignore_user_abort:()=>0,set_time_limit:()=>true,spl_autoload_register:()=>true,
 headers_sent:()=>false,php_sapi_name:()=>'apache2handler',phpversion:()=>'8.2.0',getenv:()=>false,
 microtime:a=>a[0]?Date.now()/1000:'0 '+Math.floor(Date.now()/1000),uniqid:()=>'000000000000',
 json_last_error:()=>0,json_last_error_msg:()=>'No error',
 parse_url:a=>{try{const u=new URL(str(a[0]),'http://relative.invalid');const full:any=Object.create(null);if(u.host!=='relative.invalid'){full.scheme=u.protocol.slice(0,-1);full.host=u.hostname;}if(u.pathname)full.path=u.pathname;if(u.search)full.query=u.search.slice(1);if(u.hash)full.fragment=u.hash.slice(1);if(a[1]!==undefined){const parts=[ 'scheme','host','port','user','pass','path','query','fragment'];return full[parts[num(a[1])]]??null;}return full;}catch{return false;}},
 http_build_query:a=>new URLSearchParams(entries(a[0]).map(([k,v])=>[k,str(v)])).toString(),
 parse_str:()=>null,
};
import {createHash} from 'node:crypto';
function require_hash(algorithm:string,value:string){return createHash(algorithm).update(value).digest('hex');}
function crc32(value:string){let c,crc=0xFFFFFFFF;for(const byte of Buffer.from(value)){c=(crc^byte)&0xFF;for(let k=0;k<8;k++)c=c&1?(c>>>1)^0xEDB88320:c>>>1;crc=(crc>>>8)^c;}return (crc^0xFFFFFFFF)>>>0;}
