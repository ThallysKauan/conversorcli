import Engine from 'php-parser';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import {resolveInclude} from './resolve.ts';
import {expressionToken,placeholderToken} from './placeholders.ts';
import {phpDate} from './date.ts';
import {builtins,Ref} from './builtins.ts';
type N=any;
export interface Notice {file:string;line:number;message:string}
const parser=new Engine.Engine({parser:{suppressErrors:false},lexer:{short_tags:true},ast:{withPositions:true}});
const cache=new Map<string,{stamp:number;ast:N}>();
const own=(v:any,k:any)=>v!=null&&Object.hasOwn(Object(v),k)?v[k]:undefined;
const truth=(v:any):boolean=>v!==null&&v!==undefined&&v!==false&&v!==0&&v!==''&&v!=='0'&&(typeof v!=='object'||Object.keys(v).length>0);
// Comparação frouxa do PHP 8: null == false/""/0/[], bool converte o outro lado, strings numéricas comparam como número.
const numeric=(v:any)=>typeof v==='number'||(typeof v==='string'&&v.trim()!==''&&!Number.isNaN(Number(v)));
function looseEqual(a:any,b:any):boolean{
 a=a===undefined?null:a;b=b===undefined?null:b;
 if(typeof a==='boolean'||typeof b==='boolean')return truth(a)===truth(b);
 if(a===null||b===null){const other=a===null?b:a;return other===null||other===''||other===0||(typeof other==='object'&&Object.keys(other).length===0);}
 if(numeric(a)&&numeric(b))return Number(a)===Number(b);
 if(typeof a==='object'&&typeof b==='object')return JSON.stringify(a)===JSON.stringify(b);
 return String(a)===String(b);
}
const urlencode=(v:string,raw:boolean)=>{const out=encodeURIComponent(v).replace(raw?/[!'()*]/g:/[!'()*~]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());return raw?out:out.replace(/%20/g,'+');};
const str=(v:any):string=>v===null||v===undefined||v===false?'':v===true?'1':typeof v==='object'?'Array':String(v);
// Código arbitrário ou comandos nunca são avaliados: só bloqueia quando o caminho executado chega neles
// (bibliotecas como PHPMailer têm exec/call_user_func em funções que a renderização GET não chama).
class Blocked extends Error {}
const dangerousCalls=new Set(['eval','system','exec','shell_exec','passthru','popen','proc_open','assert','call_user_func','call_user_func_array','create_function','pcntl_exec']);
class PhpException {message:string;constructor(message:string){this.message=message;}toString(){return 'Exceção PHP não tratada: '+this.message;}}
class Control {kind:string;value:any;constructor(kind:string,value:any=null){this.kind=kind;this.value=value;}}
export async function renderExtended(rootInput:string,entry:string,options:{siteUrl?:string;mobile?:boolean;omitIncludes?:string[];configFile?:string;post?:Record<string,string>}={}) {
 const root=await realpath(rootInput), origin=new URL(options.siteUrl||'https://example.invalid');
 let responseStatus=200;let redirect:string|undefined;let sessionUsed=false;let env:Record<string,any>=Object.create(null),file=path.join(root,entry),html='',steps=0,depth=0;
 const globals=env, functions=new Map<string,{node:N;file:string}>(), active=new Set<string>(), included=new Set<string>(), deps=new Set<string>();
 const notices:Notice[]=[], noticeKeys=new Set<string>();
 // Variáveis sem valor: em condições valem null (como no PHP); impressas como texto viram marcador de settings.variaveis.
 const constants=new Map<string,any>(),classes=new Set<string>();
 const undefinedNames=new Set<string>(), assignedIn=new Map<string,string>(), cwd=path.dirname(path.join(root,entry));
 env._SERVER={PHP_SELF:'/'+entry,SCRIPT_NAME:'/'+entry,REQUEST_URI:'/'+entry,QUERY_STRING:'',HTTP_HOST:origin.host,HTTPS:origin.protocol==='https:'?'on':'off',REQUEST_METHOD:'GET'};
 env._GET=Object.create(null);env._POST=Object.assign(Object.create(null),options.post||{});if(options.post){env._SERVER.REQUEST_METHOD='POST';env._REQUEST=env._POST;}env._SESSION=Object.create(null);
 function warn(message:string,n?:N){const item={file:path.relative(root,file).split(path.sep).join('/'),line:n?.loc?.start?.line||0,message};const key=JSON.stringify(item);if(!noticeKeys.has(key)){noticeKeys.add(key);notices.push(item);}}
 function tick(){if(++steps>250000)throw new Error('Limite de interpretação local excedido.');}
 async function safePath(name:string){return resolveInclude(root,file,name,cwd);}
 async function readAsset(name:string){if(!/\.(css|scss|sass|less|js|svg|json|html?|txt|xml|csv|md)$/i.test(name.split(/[?#]/)[0]))throw new Error('Leitura permitida apenas para arquivos de texto locais (css, js, svg, json, html, txt, xml): '+name);const p=await safePath(name);const s=await stat(p);if(s.size>5_000_000)throw new Error('Recurso acima do limite de leitura.');return readFile(p,'utf8');}
 async function get(n:N,quiet=false):Promise<any>{
  if(!n)return null;tick();
  switch(n.kind){
   case 'string':case 'boolean':return n.value;
   case 'number':return Number(n.value);
   case 'nullkeyword':return null;
   case 'variable':{if(n.name==='_SESSION')sessionUsed=true;if(n.name==='GLOBALS')return globals;const v=own(env,n.name);if(v===undefined&&!quiet)undefinedNames.add(n.name);return v;}
   // $_SERVER[HTTP_HOST] (chave sem aspas, comum em strings interpoladas) é a chave em texto se não houver constante com esse nome.
   case 'offsetlookup':{const value=await get(n.what,quiet),key=n.offset?.kind==='name'&&!constants.has(n.offset.name)?n.offset.name:await get(n.offset,quiet);return own(value,key);}
   case 'encapsed':{let s='';for(const item of n.value)s+=quiet?str(await get(item.expression||item,true)):await text(item.expression||item);return s;}
   case 'magic':if(n.value==='__DIR__')return path.dirname(file);if(n.value==='__FILE__')return file;break;
   case 'name':case 'identifier':{
    const name=String(n.name).replace(/^\\/,'');if(constants.has(name))return constants.get(name);
    const known:Record<string,any>={ENT_QUOTES:3,ENT_COMPAT:2,ENT_HTML5:48,ENT_NOQUOTES:0,PATHINFO_FILENAME:8,PATHINFO_EXTENSION:4,PATHINFO_BASENAME:2,PATHINFO_DIRNAME:1,E_ALL:32767,E_ERROR:1,E_WARNING:2,E_NOTICE:8,SORT_REGULAR:0,SORT_STRING:2,SORT_NUMERIC:1,PHP_EOL:'\n',DIRECTORY_SEPARATOR:'/',PHP_VERSION:'8.2.0',PHP_INT_MAX:Number.MAX_SAFE_INTEGER,PHP_INT_SIZE:8,M_PI:Math.PI,STR_PAD_LEFT:0,STR_PAD_RIGHT:1,STR_PAD_BOTH:2,ARRAY_FILTER_USE_KEY:2,ARRAY_FILTER_USE_BOTH:1,PREG_SPLIT_NO_EMPTY:1,JSON_UNESCAPED_UNICODE:256,JSON_UNESCAPED_SLASHES:64,JSON_PRETTY_PRINT:128,LC_ALL:6,LC_TIME:2,MB_CASE_TITLE:2,MB_CASE_UPPER:0,MB_CASE_LOWER:1,GLOB_BRACE:1024,FILTER_VALIDATE_EMAIL:274,FILTER_SANITIZE_STRING:513,FILTER_VALIDATE_INT:257,FILTER_VALIDATE_URL:273,FILTER_DEFAULT:516,JSON_HEX_TAG:1,JSON_HEX_AMP:2,JSON_HEX_APOS:4,JSON_HEX_QUOT:8,JSON_NUMERIC_CHECK:32,JSON_INVALID_UTF8_SUBSTITUTE:2097152,JSON_INVALID_UTF8_IGNORE:1048576,JSON_THROW_ON_ERROR:4194304,JSON_PRESERVE_ZERO_FRACTION:1024,PHP_URL_SCHEME:0,PHP_URL_HOST:1,PHP_URL_PORT:2,PHP_URL_USER:3,PHP_URL_PASS:4,PHP_URL_PATH:5,PHP_URL_QUERY:6,PHP_URL_FRAGMENT:7,PHP_SESSION_NONE:1,PHP_SESSION_ACTIVE:2,PHP_SESSION_DISABLED:0,ENT_SUBSTITUTE:8,ENT_HTML401:0,ENT_XML1:16,COUNT_RECURSIVE:1,LOCK_EX:2,FILE_APPEND:8,SEEK_SET:0,PHP_FLOAT_EPSILON:Number.EPSILON,PHP_OS:'Linux',PHP_OS_FAMILY:'Linux',E_STRICT:2048,E_DEPRECATED:8192,E_USER_ERROR:256,E_USER_WARNING:512,E_USER_NOTICE:1024,INF:Infinity,NAN:NaN,SORT_FLAG_CASE:8,SORT_NATURAL:6,EXTR_OVERWRITE:0,EXTR_SKIP:1,CASE_LOWER:0,CASE_UPPER:1,ARRAY_UNIQUE_REGULAR:0};
    if(Object.hasOwn(known,name))return known[name];if(/^(true|false|null)$/i.test(name))return name.toLowerCase()==='true'?true:name.toLowerCase()==='false'?false:null;
    // <?php//comentário (sem espaço após a tag) vira a constante php no lexer: não é conteúdo.
    if(name==='php')return null;
    warn('Constante sem valor: '+name,n);return name;}
   case 'nowdoc':return n.value;
   case 'print':html+=await text(n.expression);return 1;
   case 'silent':return get(n.expr,true);
   case 'closure':case 'arrowfunc':return {__closure:n,scope:env};
   case 'propertylookup':case 'nullsafepropertylookup':{const target=await get(n.what,quiet);const key=n.offset?.kind==='identifier'?n.offset.name:await get(n.offset,quiet);return own(target,key);}
   case 'staticlookup':{const key=n.offset?.name;if(key==='class')return str(n.what?.name);warn('Acesso estático sem regra: '+str(n.what?.name)+'::'+str(key),n);return null;}
   case 'match':{const value=await get(n.cond);for(const arm of n.arms||[]){if(!arm.conds)return get(arm.body);for(const c of arm.conds)if(value===await get(c))return get(arm.body);}throw new PhpException('UnhandledMatchError');}
   case 'exit':{if(n.expression){const v=await get(n.expression);if(typeof v==='string')html+=v;}throw new Control('exit');}
   case '__value':return n.value;
   case 'array':{const a:any=Object.create(null);let i=0;for(const item of n.items){if(!item)continue;const key=item.key?await get(item.key):i++;a[key]=await get(item.value);}return a;}
   case 'isset':{for(const v of n.variables)if((await get(v,true))==null)return false;return true;}
   case 'empty':return !truth(await get(n.expression,true));
   case 'unary':{const v=await get(n.what);if(n.type==='!')return !truth(v);if(n.type==='-')return -Number(v);if(n.type==='+')return Number(v);break;}
   case 'cast':{const v=await get(n.expr);if(n.type==='float'||n.type==='double')return Number(v)||0;if(n.type==='array')return v!==null&&typeof v==='object'?v:v==null?Object.create(null):Object.assign(Object.create(null),{0:v});if(n.type==='object')return v;if(n.type==='string')return str(v);if(n.type==='int')return Math.trunc(Number(v));if(n.type==='bool')return truth(v);break;}
   case 'retif':return truth(await get(n.test))?await get(n.trueExpr||n.test):await get(n.falseExpr);
   case 'bin':{
    if(n.type==='.'&&!quiet)return (await text(n.left))+(await text(n.right));
    const a=await get(n.left,n.type==='??');
    if(n.type==='&&'||n.type==='and')return truth(a)&&truth(await get(n.right));
    if(n.type==='||'||n.type==='or')return truth(a)||truth(await get(n.right));
    if(n.type==='??')return a??await get(n.right);
    const b=await get(n.right);switch(n.type){case '.':return str(a)+str(b);case '===':return a===b;case '!==':return a!==b;case '==':return looseEqual(a,b);case '!=':case '<>':return !looseEqual(a,b);case '<':return a<b;case '>':return a>b;case '<=':return a<=b;case '>=':return a>=b;case '+':return Number(a)+Number(b);case '-':return Number(a)-Number(b);case '*':return Number(a)*Number(b);case '/':return Number(a)/Number(b);case '%':return Number(a)%Number(b);case '**':return Number(a)**Number(b);case '<=>':return a<b?-1:a>b?1:0;case '|':return Number(a)|Number(b);case '&':return Number(a)&Number(b);case '^':return Number(a)^Number(b);case '<<':return Number(a)<<Number(b);case '>>':return Number(a)>>Number(b);case 'xor':return truth(a)!==truth(b);case 'instanceof':return false;}break;
   }
   case 'assign':{let value=await get(n.right);if(n.operator==='.=')value=str(await get(n.left,true))+str(value);else if(n.operator==='+=')value=Number(await get(n.left,true))+Number(value);else if(n.operator==='-=')value=Number(await get(n.left,true))-Number(value);else if(n.operator==='*=')value=Number(await get(n.left,true))*Number(value);else if(n.operator==='/=')value=Number(await get(n.left,true))/Number(value);else if(n.operator==='%=')value=Number(await get(n.left,true))%Number(value);else if(n.operator==='**=')value=Number(await get(n.left,true))**Number(value);else if(n.operator==='??='){const old=await get(n.left,true);if(old!=null)return old;}else if(n.operator!=='=')throw new Error('Operador não suportado: '+n.operator);await set(n.left,value);return value;}
   case 'post':case 'pre':{const old=Number(await get(n.what));const value=old+((n.type==='++'||n.type==='+')?1:-1);await set(n.what,value);return n.kind==='post'?old:value;}
   case 'new':if(['stdclass'].includes(String(n.what?.name).toLowerCase().replace(/^\\/,'')))return Object.create(null);if(n.what?.name?.toLowerCase()==='exception')return new PhpException(str(await get(n.arguments?.[0])));if(n.what?.name?.toLowerCase()==='mobile_detect'){warn('Mobile_Detect adaptado para seleção por User-Agent; validar dispositivos.',n);return {__mobileDetect:true};}break;
   case 'call':return call(n);
   case 'eval':case 'shell':throw new Blocked('Execução dinâmica ou de comandos bloqueada para revisão.');
   case 'include':{
    const target=str(await get(n.target));if(options.omitIncludes?.includes(target.replaceAll('\\','/')))return 1;let resolved:string;
    try{resolved=await safePath(target);}catch(error){warn(error instanceof Error?error.message:String(error),n);return null;}
    const value=await load(resolved,n.once);return value===undefined?1:value;
   }
  }
  throw new Error('Expressão PHP ainda não suportada: '+n.kind);
 }
 // Texto impresso ou concatenado: variável sem valor vira marcador (placeholder em settings.variaveis).
 async function text(n:N):Promise<string>{
  if(n?.kind==='variable'&&typeof n.name==='string'&&!n.name.startsWith('_')&&n.name!=='GLOBALS'&&own(env,n.name)===undefined){undefinedNames.add(n.name);return placeholderToken(n.name);}
  // date('Y') impresso sem timestamp: calculado na requisição (src/settings/date.ts), não congelado na geração.
  if(n?.kind==='call'&&String(n.what?.name||'').toLowerCase()==='date'&&n.arguments?.length===1){const format=str(await get(n.arguments[0]));return expressionToken('phpDate('+JSON.stringify(format)+')',()=>phpDate(format));}
  return str(await get(n));
 }
 async function set(n:N,v:any){
  if(n.kind==='variable'&&typeof n.name==='string'){env[n.name]=v;if(env===globals&&!assignedIn.has(n.name))assignedIn.set(n.name,path.relative(root,file).split(path.sep).join('/'));return;}
  if(n.kind==='offsetlookup'){const parent=await get(n.what,true);if(parent==null){await set(n.what,Object.create(null));}const obj=await get(n.what,true);const key=n.offset?await get(n.offset):Object.keys(obj).length;Object.defineProperty(obj,key,{value:v,writable:true,configurable:true,enumerable:true});return;}
  if(n.kind==='list'||n.kind==='array'){let i=0;for(const item of n.items||[]){if(!item){i++;continue;}const target=item.kind==='entry'?item.value:item;const key=item.kind==='entry'&&item.key?await get(item.key):i++;if(target)await set(target,own(v,key)??null);}return;}
  if(n.kind==='propertylookup'){let obj=await get(n.what,true);if(obj==null||typeof obj!=='object'){obj=Object.create(null);await set(n.what,obj);}obj[n.offset?.kind==='identifier'?n.offset.name:str(await get(n.offset))]=v;return;}
  if(n.kind==='staticlookup'){warn('Atribuição estática sem regra: '+str(n.what?.name),n);return;}
  throw new Error('Atribuição não suportada.');
 }
 const buffers:number[]=[];
 let declared:Set<string>|undefined;
 async function siteFunctionNames(){
  if(declared)return declared;declared=new Set();
  const walk=async(dir:string):Promise<void>=>{let items;try{items=await readdir(dir,{withFileTypes:true});}catch{return;}for(const item of items){const full=path.join(dir,item.name);if(item.isDirectory()){if(!/^(node_modules|\.git|vendor)$/.test(item.name))await walk(full);}else if(/\.php$/i.test(item.name))for(const m of (await readFile(full,'utf8')).matchAll(/function\s+&?\s*([A-Za-z_]\w*)\s*\(/g))declared!.add(m[1].toLowerCase());}};
  await walk(root);return declared;
 }
 // Função do usuário ou closure: escopo próprio com superglobais; arrow function vê o escopo onde foi criada.
 async function runUser(node:N,args:any[],source:string,scope?:Record<string,any>):Promise<any>{
  if(++depth>64)throw new Error('Recursão excessiva.');const previous=env,previousFile=file;
  env=Object.assign(Object.create(null),{_SERVER:globals._SERVER,_GET:globals._GET,_POST:globals._POST,_SESSION:globals._SESSION},node.kind==='arrowfunc'?scope:{});
  if(node.kind==='closure')for(const use of node.uses||[]){const name=use.name?.name??use.name;env[name]=own(scope,name);}
  file=source;
  for(const [i,p] of (node.arguments||[]).entries()){const name=p.name?.name??p.name;env[name]=p.variadic?Object.assign(Object.create(null),args.slice(i)):args[i]??(p.value?await get(p.value):null);}
  try{if(node.kind==='arrowfunc')return await get(node.body);await statement(node.body);}catch(control){if(control instanceof Control&&control.kind==='return')return control.value;throw control;}finally{env=previous;file=previousFile;depth--;}return null;
 }
 // Callback de array_map/usort/preg_replace_callback: closure, nome de função do usuário ou nativa.
 async function invoke(callable:any,args:any[]):Promise<any>{
  if(callable?.__closure)return runUser(callable.__closure,args,file,callable.scope);
  const name=str(callable).toLowerCase();if(!name)throw new Error('Callback inválido.');
  return call({kind:'call',what:{kind:'name',name},arguments:args.map(value=>({kind:'__value',value}))});
 }
 async function call(n:N):Promise<any>{
  if(n.what?.kind==='variable'||n.what?.kind==='closure'||n.what?.kind==='arrowfunc'){const callable=await get(n.what);const args:any[]=[];for(const a of n.arguments||[])args.push(await get(a));return invoke(callable,args);}
  if(n.what?.kind==='propertylookup'){
   const receiver=await get(n.what.what);if(receiver instanceof PhpException&&n.what.offset?.name==='getMessage')return receiver.message;if(receiver?.__mobileDetect&&n.what.offset?.name==='isMobile')return !!options.mobile;
   throw new Error('Método não suportado.');
  }
  const name=String(n.what?.name||'').toLowerCase();
  if(dangerousCalls.has(name))throw new Blocked('Execução dinâmica ou de comandos bloqueada para revisão.');
  const args:any[]=[];for(const a of n.arguments||[])args.push(await get(a));
  const s=(i:number)=>str(args[i]);
  switch(name){
   case 'session_start':warn('Sessão PHP não migrada; renderização GET sem persistência de sessão.',n);return true;
   case 'error_reporting':return 32767;
   // Configuração de runtime (erros, sessão, memória) não muda o HTML gerado.
   case 'ini_set':case 'ini_get':return '';
   case 'header':{const status=s(0).match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/i);if(status){responseStatus=Number(status[1]);return null;}
    const location=s(0).match(/^Location:\s*(.+)$/i);if(location){redirect=location[1].trim();if(responseStatus<300||responseStatus>=400)responseStatus=Number(args[2])||302;return null;}
    if(/^(Content-Type:\s*text\/html|X-|Cache-Control|Pragma|Expires|Access-Control|Vary|Content-Language|Referrer-Policy|Strict-Transport|Permissions-Policy)/i.test(s(0)))return null;if(/^Content-Type:\s*text\/html(?:;\s*charset=utf-8)?$/i.test(s(0)))return null;warn('Cabeçalho HTTP precisa de regra de servidor: '+s(0),n);return null;}
   case 'http_response_code':{const previous=responseStatus;if(args[0]!==undefined){const value=Number(args[0]);if(!Number.isInteger(value)||value<100||value>599)throw new Error('Status HTTP inválido.');responseStatus=value;}return previous;}
   case 'explode':return s(1).split(s(0));
   case 'implode':return Object.values(args[1]||{}).map(str).join(s(0));
   case 'end':return Object.values(args[0]||{}).at(-1);
   case 'count':return Object.keys(args[0]||{}).length;
   case 'strpos':{const i=s(0).indexOf(s(1),Number(args[2]||0));return i<0?false:i;}
   case 'strtolower':case 'mb_strtolower':return s(0).toLowerCase();
   case 'strtoupper':return s(0).toUpperCase();
   case 'ucfirst':return s(0).charAt(0).toUpperCase()+s(0).slice(1);
   case 'trim':{if(args[1]===undefined)return s(0).replace(/^[ \t\n\r\0\v]+|[ \t\n\r\0\v]+$/g,'');const chars=new Set(s(1));let start=0,end=s(0).length;while(start<end&&chars.has(s(0)[start]))start++;while(end>start&&chars.has(s(0)[end-1]))end--;return s(0).slice(start,end);}
   case 'strlen':return Buffer.byteLength(s(0));
   case 'dirname':return path.dirname(s(0));
   case 'array_keys':return Object.keys(args[0]||{});
   case 'array_values':return Object.values(args[0]||{});
   case 'in_array':return Object.values(args[1]||{}).some(v=>args[2]?v===args[0]:v==args[0]);
   case 'array_key_exists':return Object.hasOwn(args[1]||{},s(0));
   case 'array_pop':{const obj=args[0]||{},key=Object.keys(obj).at(-1);if(key===undefined)return null;const value=obj[key];delete obj[key];return value;}
   case 'array_push':{const obj=args[0]||{};let index=Math.max(-1,...Object.keys(obj).map(Number).filter(Number.isFinite))+1;for(const value of args.slice(1))obj[index++]=value;return Object.keys(obj).length;}
   case 'substr':return s(0).slice(Number(args[1]),args[2]===undefined?undefined:Number(args[1])+Number(args[2]));
   case 'str_replace':{
    const searches=typeof args[0]==='object'?Object.values(args[0]):[args[0]],replacements=typeof args[1]==='object'?Object.values(args[1]):[args[1]];
    let result=s(2);if(searches.some(v=>v==='\n')&&result.includes('//')){warn('Minificação de quebras de linha dispensada para preservar comentários JavaScript.',n);return result;}
    searches.forEach((q,i)=>{result=result.split(str(q)).join(str(replacements.length===1?replacements[0]:replacements[i]));});return result;
   }
   case 'htmlspecialchars':case 'htmlentities':return s(0).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
   case 'json_decode':return JSON.parse(s(0));
   case 'json_encode':return JSON.stringify(args[0]);
   case 'basename':{const value=path.posix.basename(s(0));return args[1]&&value.endsWith(s(1))?value.slice(0,-s(1).length):value;}
   case 'pathinfo':return path.parse(s(0)).name;
   case 'ksort':case 'asort':case 'uksort':{
    const obj=args[0]||{},pairs=Object.entries(obj);if(name==='uksort'){warn('Ordenação aleatória fixada nesta geração.',n);}else pairs.sort((a,b)=>String(name==='ksort'?a[0]:a[1]).localeCompare(String(name==='ksort'?b[0]:b[1])));
    await set(n.arguments[0],Object.fromEntries(pairs));return true;
   }
   case 'urlencode':case 'rawurlencode':return urlencode(s(0),name==='rawurlencode');
   case 'glob':{
    // Somente leitura dentro do site, com * e ?; caminhos relativos ao diretório da página como no PHP.
    const pattern=s(0).replace(/\\/g,'/'),dir=path.posix.dirname(pattern),abs=path.resolve(cwd,dir),rel=path.relative(root,abs);
    if(rel.startsWith('..')||path.isAbsolute(rel)){warn('glob fora do site bloqueado: '+pattern,n);return Object.create(null);}
    const matcher=new RegExp('^'+path.posix.basename(pattern).split('*').map(part=>part.split('?').map(p=>p.replace(/[.+^$(){}|[\]\\]/g,'\\$&')).join('.')).join('.*')+'$');
    let names:string[]=[];try{names=(await readdir(abs)).filter(item=>matcher.test(item)).sort();}catch{}
    const result:any=Object.create(null);names.forEach((item,i)=>{result[i]=(pattern.includes('/')?dir+'/':'')+item;});return result;
   }
   case 'file_exists':{try{await safePath(s(0));return true;}catch{return false;}}
   case 'file_get_contents':return readAsset(s(0));
   case 'filectime':case 'filemtime':{try{const info=await stat(await safePath(s(0)));return (name==='filectime'?info.birthtimeMs:info.mtimeMs)/1000;}catch{warn('Data de arquivo não disponível: '+s(0),n);return 0;}}
   case 'date':{const d=new Date(args[1]!==undefined?Number(args[1])*1000:Date.now());if(args[1]===undefined)warn('Data PHP materializada na geração (usada em cálculo); validar.',n);const p=(v:number)=>String(v).padStart(2,'0');const fields:Record<string,string>={Y:String(d.getUTCFullYear()),m:p(d.getUTCMonth()+1),d:p(d.getUTCDate()),H:p(d.getUTCHours()),i:p(d.getUTCMinutes()),s:p(d.getUTCSeconds()),P:'+00:00'};return s(0).replace(/\\(.)|[YmdHisP]/g,(x,escaped)=>escaped||fields[x]);}
   case 'rand':case 'mt_rand':warn('Valor aleatório fixado nesta geração; não preserva variação por requisição.',n);return Math.trunc(args[0]===undefined?0:Number(args[0]));
   case 'preg_replace':{const pattern=s(0),end=pattern.lastIndexOf(pattern[0]);try{return s(2).replace(new RegExp(pattern.slice(1,end),pattern.slice(end+1).replace(/[^imsu]/g,'')+'g'),s(1));}catch{warn('Minificação por expressão PCRE dispensada; conteúdo original preservado.',n);return args[2];}}
   case 'preg_match_all':{const pattern=s(0),end=pattern.lastIndexOf(pattern[0]);const matches=[...s(1).matchAll(new RegExp(pattern.slice(1,end),pattern.slice(end+1).replace(/[^imsu]/g,'')+'g'))];const groups:any=[];for(const match of matches)match.forEach((v,i)=>(groups[i]??=[]).push(v));await set(n.arguments[2],groups);return matches.length;}
  }
  const custom=functions.get(name);
  if(custom)return runUser(custom.node,args,custom.file);
  switch(name){
   case 'function_exists':return functions.has(s(0).toLowerCase())||Object.hasOwn(builtins,s(0).toLowerCase());
   case 'class_exists':case 'interface_exists':return classes.has(s(0).toLowerCase().replace(/^\\/,''));
   case 'method_exists':return false;
   case 'define':constants.set(s(0),args[1]);return true;
   case 'defined':return constants.has(s(0));
   case 'constant':return constants.get(s(0))??null;
   case 'compact':{const out:any=Object.create(null);for(const v of args)for(const k of (typeof v==='object'&&v?Object.values(v):[v]))if(own(env,str(k))!==undefined)out[str(k)]=env[str(k)];return out;}
   case 'extract':{let n=0;for(const [k,v] of Object.entries(args[0]||{})){env[k]=v;n++;}return n;}
   case 'time':warn('Data PHP materializada na geração (usada em cálculo); validar.',n);return Math.floor(Date.now()/1000);
   case 'mktime':{const d=new Date();const v=(i:number,cur:number)=>args[i]===undefined?cur:Number(args[i]);return Math.floor(new Date(v(5,d.getFullYear()),v(3,d.getMonth()+1)-1,v(4,d.getDate()),v(0,d.getHours()),v(1,d.getMinutes()),v(2,d.getSeconds())).getTime()/1000);}
   case 'strtotime':{const t=Date.parse(s(0));if(Number.isNaN(t)){warn('strtotime sem equivalente: '+s(0),n);return false;}return Math.floor(t/1000);}
   case 'checkdate':{const d=new Date(Number(args[2]),Number(args[0])-1,Number(args[1]));return d.getMonth()===Number(args[0])-1;}
   case 'printf':{const out=String(await builtins.sprintf(args,invoke));html+=out;return out.length;}
   case 'is_file':case 'is_readable':{try{const info=await stat(await safePath(s(0)));return info.isFile();}catch{return false;}}
   case 'is_dir':{try{const info=await stat(path.resolve(cwd,s(0)));return info.isDirectory()&&!path.relative(root,path.resolve(cwd,s(0))).startsWith('..');}catch{return false;}}
   case 'filesize':{try{return (await stat(await safePath(s(0)))).size;}catch{return false;}}
   case 'scandir':{const dir=path.resolve(cwd,s(0));if(path.relative(root,dir).startsWith('..'))return false;try{const items=['.','..',...(await readdir(dir)).sort()];return Object.assign(Object.create(null),items);}catch{return false;}}
   case 'call_user_func_array':case 'call_user_func':break;
   case 'ob_start':buffers.push(html.length);return true;
   case 'ob_get_clean':case 'ob_get_contents':{const start=buffers.at(-1)??html.length;const out=html.slice(start);if(name==='ob_get_clean'){buffers.pop();html=html.slice(0,start);}return out;}
   case 'ob_end_clean':{const start=buffers.pop();if(start!==undefined)html=html.slice(0,start);return true;}
   case 'ob_end_flush':case 'ob_get_flush':buffers.pop();return true;
   case 'filter_var':return Number(args[1])===274?(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s(0))?s(0):false):args[0];
   case 'array_key_exists':break;
  }
  const builtin=builtins[name];
  if(builtin){const result=await builtin(args,invoke);if(result instanceof Ref){for(const [i,value] of Object.entries(result.refs))if(n.arguments?.[Number(i)])await set(n.arguments[Number(i)],value);return result.result;}return result;}
  switch(name){
   case 'session_status':return sessionUsed?2:1;
   case 'session_id':return '';
   case 'setcookie':case 'setrawcookie':return true;
   case 'version_compare':{const a=s(0).split(/[.-]/).map(Number),b=s(1).split(/[.-]/).map(Number);let c=0;for(let i=0;i<Math.max(a.length,b.length)&&!c;i++)c=Math.sign((a[i]||0)-(b[i]||0));if(args[2]===undefined)return c;const op=s(2);return op==='<'||op==='lt'?c<0:op==='<='||op==='le'?c<=0:op==='>'||op==='gt'?c>0:op==='>='||op==='ge'?c>=0:op==='=='||op==='eq'?c===0:c!==0;}
   case 'array_replace':return Object.assign(Object.create(null),...args.map(a=>a||{}));
   case 'readfile':{const content=await readAsset(s(0));html+=content;return content.length;}
   case 'file':{const content=await readAsset(s(0));return Object.assign(Object.create(null),content.split(/(?<=\n)/));}
   case 'array_key_exists':case 'key_exists':return Object.hasOwn(Object(args[1]),str(args[0]));
  }
  // Função chamada mas não declarada em nenhum arquivo da origem: no ar é erro fatal; a chamada é ignorada.
  // Função do site não carregada nesta página, ou inexistente: no ar é erro fatal; a chamada é ignorada e registrada.
  // Nome com cara de função nativa do PHP continua como lacuna do conversor.
  const nativeLike=/^(str|array_|mb_|preg_|json_|is_|html|url|date|time|file|dir|ctype_|iconv|intl|number|sort|key|in_|ucf|lcf|imap|curl|gz|hash|openssl|image|exif|filter|session|ob_|func_|get|set|spl_|stream|fopen|fwrite|fread|fclose)/.test(name);
  if(name&&!nativeLike){warn('Função inexistente na origem (erro fatal no ar): '+name+'()'+((await siteFunctionNames()).has(name)?', declarada no site mas não carregada nesta página':'')+'; chamada ignorada.',n);return null;}
  throw new Error('Função PHP ainda não suportada: '+(name||'dinâmica'));
 }
 async function statement(n:N):Promise<void>{
  if(!n)return;tick();
  try{switch(n.kind){
   case 'program':case 'block':for(const c of n.children)await statement(c);return;
   case 'inline':html+=n.value;return;
   case 'echo':for(const e of n.expressions)html+=await text(e);return;
   case 'expressionstatement':await get(n.expression);return;
   case 'if':await statement(truth(await get(n.test))?n.body:n.alternate);return;
   case 'foreach':{const values=await get(n.source);for(const [k,v] of Object.entries(values||{})){if(n.key)await set(n.key,k);await set(n.value,v);try{await statement(n.body);}catch(c){if(c instanceof Control&&c.kind==='break')break;if(c instanceof Control&&c.kind==='continue')continue;throw c;}}return;}
   case 'for':{for(const init of n.init||[])await get(init);let iterations=0;while(!n.test?.length||truth(await get(n.test.at(-1)))){if(++iterations>10000)throw new Error('Limite de laço excedido.');try{await statement(n.body);}catch(c){if(c instanceof Control&&c.kind==='break')break;if(!(c instanceof Control&&c.kind==='continue'))throw c;}for(const inc of n.increment||[])await get(inc);}return;}
   case 'while':case 'do':{let iterations=0;while((n.kind==='do'&&iterations===0)||truth(await get(n.test))){if(++iterations>10000)throw new Error('Limite de laço excedido.');try{await statement(n.body);}catch(c){if(c instanceof Control&&c.kind==='break')break;if(!(c instanceof Control&&c.kind==='continue'))throw c;}}return;}
   case 'switch':{const value=await get(n.test);const cases=n.body.children;let start=-1,fallback=-1;for(let i=0;i<cases.length;i++){if(!cases[i].test)fallback=i;else if(start<0&&looseEqual(value,await get(cases[i].test)))start=i;}if(start<0)start=fallback;if(start>=0)try{for(let i=start;i<cases.length;i++)await statement(cases[i].body);}catch(c){if(!(c instanceof Control&&c.kind==='break'))throw c;}return;}
   case 'throw':{const exception=await get(n.what);if(exception instanceof PhpException)throw exception;throw new Error('Exceção PHP não suportada.');}
   case 'try':{try{await statement(n.body);}catch(e){if(!(e instanceof PhpException))throw e;const handler=n.catches?.find((c:any)=>c.what?.some((t:any)=>['exception','throwable'].includes(t.name?.toLowerCase())));if(!handler)throw e;await set(handler.variable,e);await statement(handler.body);}finally{if(n.always)await statement(n.always);}return;}
   case 'function':functions.set(n.name.name.toLowerCase(),{node:n,file});return;
   case 'global':for(const item of n.items){const name=item.name;Object.defineProperty(env,name,{get:()=>globals[name],set:v=>{globals[name]=v;},enumerable:true,configurable:true});}return;
   case 'return':throw new Control('return',await get(n.expr));
   case 'break':case 'continue':throw new Control(n.kind);
   case 'namespace':case 'declare':for(const c of n.children||[])await statement(c);return;
   case 'usegroup':case 'useitem':case 'inlinehtml':case 'noop':return;
   case 'unset':for(const v of n.variables||[]){if(v.kind==='variable')delete env[v.name];else if(v.kind==='offsetlookup'){const parent=await get(v.what,true);if(parent&&typeof parent==='object')delete parent[await get(v.offset)];}}return;
   case 'static':for(const item of n.variables||[]){const name=item.variable?.name??item.name;if(own(env,name)===undefined)env[name]=item.defaultValue?await get(item.defaultValue):null;}return;
   case 'constantstatement':for(const c of n.constants||[])constants.set(c.name?.name??c.name,await get(c.value));return;
   case 'interface':case 'trait':classes.add(String(n.name?.name).toLowerCase());return;
   case 'class':classes.add(String(n.name?.name).toLowerCase());if(n.name?.name?.toLowerCase()==='mobile_detect'){warn('Biblioteca Mobile_Detect substituída por regra de User-Agent.',n);return;}
    // Classe declarada não executa nada: só falha se a renderização instanciar (new) uma classe sem regra.
    return;throw new Error('Classe sem regra de migração: '+n.name?.name);
   default:throw new Error('Instrução PHP ainda não suportada: '+n.kind);
  }}catch(error){if(error instanceof Control||error instanceof PhpException||error instanceof Blocked)throw error;if(steps>250000)throw error;warn(error instanceof Error?error.message:String(error),n);}
 }
 async function load(target:string,once=false){
  const resolved=await realpath(target);const rel=path.relative(root,resolved);if(rel.startsWith('..')||path.isAbsolute(rel))throw new Error('Caminho externo bloqueado.');
  if(once&&included.has(resolved))return;if(active.has(resolved)||active.size>=32)throw new Error('Ciclo de includes.');
  const info=await stat(resolved);if(info.isDirectory())throw new Error('Include ausente: '+rel+' é uma pasta (referenciado por '+path.relative(root,file)+')');if(info.size>2_000_000)throw new Error('PHP acima do limite de análise.');
  let ast=cache.get(resolved)?.stamp===info.mtimeMs?cache.get(resolved)!.ast:undefined;
  if(!ast){ast=parser.parseCode(await readFile(resolved,'utf8'),resolved);cache.set(resolved,{stamp:info.mtimeMs,ast});}
  const previous=file;file=resolved;active.add(resolved);included.add(resolved);deps.add(rel);
  // Como no PHP, funções declaradas no topo do arquivo existem antes da linha em que aparecem.
  const hoist=(nodes:N[])=>{for(const c of nodes||[]){if(c.kind==='function'&&!functions.has(c.name.name.toLowerCase()))functions.set(c.name.name.toLowerCase(),{node:c,file:resolved});if(c.kind==='namespace')hoist(c.children);if(c.kind==='class')classes.add(String(c.name?.name).toLowerCase());}};hoist(ast.children);
  // return no topo de um arquivo incluído encerra só esse include e vira o valor do include.
  try{await statement(ast);}catch(control){if(control instanceof Control&&control.kind==='return')return control.value;throw control;}finally{file=previous;active.delete(resolved);}
 }
 try{await load(path.resolve(root,entry));}catch(control){if(!(control instanceof Control&&control.kind==='exit'))throw control;}
 if(!sessionUsed){for(let i=notices.length-1;i>=0;i--)if(notices[i].message.startsWith('Sessão PHP não migrada'))notices.splice(i,1);}
 return {html,responseStatus,redirect,dependencies:[...deps],notices,settings:Object.fromEntries(Object.entries(globals).filter(([k,v])=>!k.startsWith('_')&&typeof v==='string'&&['nomeSite','h1','description','key','url','email','telefone','linkWhatsapp','ddd','whatsapp','rua','endereco','numero','cidade','estado','cep','urlMaps','linkMaps','mapaEmbed','mapa','indexRobots'].includes(k))),
  // Valores do arquivo de configurações (como no ar, após a renderização), sem credenciais.
  variables:Object.fromEntries(Object.entries(globals).filter(([k,v])=>options.configFile&&assignedIn.get(k)===options.configFile&&['string','number','boolean'].includes(typeof v)&&!/\uE000/.test(String(v))&&!/senha|password|pass$|smtp|secret|token|recaptcha|api_?key/i.test(k))) as Record<string,string|number|boolean>,
  undefinedVariables:[...undefinedNames].sort()};
}



