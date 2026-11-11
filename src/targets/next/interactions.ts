import {splitStatements} from '../../conversion/js/statements.ts';

// Interpretador estático de handlers de clique: traduz operações de classe, estilo e aria
// em ações serializáveis aplicadas pelo componente Interactive. Nada é executado.
export type Ref={kind:'selector';selector:string;all:boolean}|{kind:'self'}|{kind:'body'};
export type Action=
 {op:'class';mode:'toggle'|'add'|'remove';ref:Ref;names:string[]}
|{op:'style';ref:Ref;prop:string;value:string}
|{op:'styleToggle';ref:Ref;prop:string;when:string[];then:string;otherwise:string}
|{op:'prop';ref:Ref;prop:string;value?:string;from?:{ref:Ref;prop:string}}
|{op:'scroll';top:number;behavior?:string}
|{op:'call';name:string;self?:boolean};
export interface AttrBinding {ref:Ref;name:string;source:{ref:Ref;className:string}}
export interface Handler {actions:Action[];preventDefault:boolean;stopPropagation?:boolean;selfOnly:boolean;guards:Ref[];attrs:AttrBinding[];uses:Set<string>}
export type Scope=Map<string,Ref>;
export interface Listener {targets:Ref;handler:Handler}

const flat=(text:string)=>text.replace(/\s+/g,' ').trim();
const str=`(['"])([^'"]*)`;
const lookup=new RegExp(`^document\\.(getElementById|querySelector|querySelectorAll|getElementsByClassName)\\(\\s*${str}\\2\\s*\\)$`);
const scoped=new RegExp(`^(.+)\\.(querySelector|querySelectorAll)\\(\\s*${str}\\3\\s*\\)$`);

/** Resolve uma expressão que aponta para elemento(s) do DOM. */
export function refExpression(expression:string,scope:Scope,uses?:Set<string>):Ref|undefined{
 const text=flat(expression).replace(/^Array\.from\(\s*([\s\S]+)\s*\)$/,'$1');let m:RegExpMatchArray|null;
 if(text==='this'||/^[\w$]+\.currentTarget$/.test(text))return {kind:'self'};
 if(text==='document.body')return {kind:'body'};
 if((m=text.match(lookup))){const [,method,,value]=m;if(method==='getElementById')return {kind:'selector',selector:'#'+value,all:false};if(method==='getElementsByClassName')return {kind:'selector',selector:value.trim().split(/\s+/).map(c=>'.'+c).join(''),all:true};return {kind:'selector',selector:value,all:method==='querySelectorAll'};}
 if((m=text.match(scoped))){const base=refExpression(m[1],scope,uses);if(base?.kind!=='selector'||base.selector.includes(','))return undefined;return {kind:'selector',selector:base.selector+' '+m[4],all:m[2]==='querySelectorAll'};}
 if(/^[\w$]+$/.test(text)){const ref=scope.get(text);if(ref)uses?.add(text);return ref;}
 return undefined;
}
/** `const x = document.getElementById(...)` (com ou sem declaração). */
export function binding(statement:string,scope:Scope):[string,Ref]|undefined{
 const m=flat(statement).match(/^(?:(?:const|let|var)\s+)?([\w$]+)\s*=\s*([\s\S]+)$/);if(!m||m[1]==='window')return undefined;
 const ref=refExpression(m[2],scope);return ref?[m[1],ref]:undefined;
}

// Funções: function f(){}, window.f = function(){}, f = () => {}, const f = function(){}.
const functionForms=[
 /^function\s+([\w$]+)\s*\(([^)]*)\)\s*\{([\s\S]*)\}$/,
 /^(?:window\.|(?:const|let|var)\s+)?([\w$]+)\s*=\s*function\s*[\w$]*\s*\(([^)]*)\)\s*\{([\s\S]*)\}$/,
 /^(?:window\.|(?:const|let|var)\s+)?([\w$]+)\s*=\s*\(?([\w$,\s]*)\)?\s*=>\s*\{([\s\S]*)\}$/,
];
export function functionDefinition(statement:string){for(const form of functionForms){const m=statement.trim().match(form);if(m)return {name:m[1],params:m[2].split(',').map(p=>p.trim()).filter(Boolean),body:m[3]};}return undefined;}
/** Função anônima usada como handler: function(e){...}, (e) => {...}, e => expr. */
export function handlerExpression(text:string){
 const value=text.trim();let m=value.match(/^function\s*[\w$]*\s*\(([^)]*)\)\s*\{([\s\S]*)\}$/);if(m)return {params:m[1].split(',').map(p=>p.trim()).filter(Boolean),body:m[2]};
 m=value.match(/^\(?([\w$,\s]*)\)?\s*=>\s*\{([\s\S]*)\}$/);if(m)return {params:m[1].split(',').map(p=>p.trim()).filter(Boolean),body:m[2]};
 m=value.match(/^\(?([\w$,\s]*)\)?\s*=>\s*([\s\S]+)$/);if(m)return {params:m[1].split(',').map(p=>p.trim()).filter(Boolean),body:m[2]};
 return undefined;
}

/** Interpreta o corpo de um handler; undefined se houver qualquer instrução sem regra. */
export function parseHandler(body:string,outer:Scope,params:string[]=[]):Handler|undefined{
 const scope:Scope=new Map(outer);const handler:Handler={actions:[],preventDefault:false,selfOnly:false,guards:[],attrs:[],uses:new Set()};
 const toggled=new Map<string,{ref:Ref;className:string}>();
 return parseBlock(body,scope,params,handler,toggled)?handler:undefined;
}
function classNames(args:string){const names=[...args.matchAll(/(['"])([\w:-]+)\1/g)].map(m=>m[2]);return names.length&&/^\s*(['"])[\w:-]+\1(\s*,\s*(['"])[\w:-]+\3)*\s*$/.test(args)?names:undefined;}
function parseBlock(body:string,scope:Scope,params:string[],handler:Handler,toggled:Map<string,{ref:Ref;className:string}>):boolean{
 const event=params[0];
 for(const raw of splitStatements(body)){
  const text=flat(raw);let m:RegExpMatchArray|null;
  if(!text||/^console\.\w+\(/.test(text)||/^["']use strict["']$/.test(text))continue;
  const bound=binding(text,scope);if(bound&&/^(?:const|let|var)\s/.test(text)){scope.set(bound[0],bound[1]);continue;}
  if((m=text.match(/^if\s*\(\s*(!\s*[\w$]+(?:\s*\|\|\s*!\s*[\w$]+)*)\s*\)\s*\{?\s*(?:console\.\w+\([^;]*\);?\s*)?return;?\s*\}?$/))){
   for(const name of m[1].split('||').map(n=>n.replace('!','').trim())){const ref=scope.get(name);if(!ref)return false;handler.uses.add(name);handler.guards.push(ref);}continue;
  }
  if(event&&(m=text.match(new RegExp('^'+event.replace('$','\\$')+'\\.(preventDefault|stopPropagation)\\(\\)$')))){if(m[1]==='preventDefault')handler.preventDefault=true;else handler.stopPropagation=true;continue;}
  if(text==='return false'){handler.preventDefault=true;continue;}
  if((m=text.match(/^(?:(?:const|let|var)\s+([\w$]+)\s*=\s*)?(.+?)\.classList\.(toggle|add|remove)\((.*)\)$/))){
   const ref=refExpression(m[2],scope,handler.uses);const forced=m[3]==='toggle'?m[4].match(/^\s*(['"])([\w:-]+)\1\s*,\s*(true|false)\s*$/):null;
   const names=forced?[forced[2]]:classNames(m[4]);if(!ref||!names||(m[3]==='toggle'&&names.length!==1))return false;
   if(forced)m[3]=forced[3]==='true'?'add':'remove';
   handler.actions.push({op:'class',mode:m[3] as 'toggle'|'add'|'remove',ref,names});if(m[1])toggled.set(m[1],{ref,className:names[0]});continue;
  }
  if((m=text.match(/^(.+?)\.style\.([a-zA-Z]+)\s*=\s*(['"])([^'"]*)\3$/))){const ref=refExpression(m[1],scope,handler.uses);if(!ref)return false;handler.actions.push({op:'style',ref,prop:m[2],value:m[4]});continue;}
  if((m=text.match(/^(.+?)\.style\.([a-zA-Z]+)\s*=\s*\1\.style\.\2\s*===?\s*(['"])([^'"]*)\3\s*\?\s*(['"])([^'"]*)\5\s*:\s*(['"])([^'"]*)\7$/))){const ref=refExpression(m[1],scope,handler.uses);if(!ref)return false;handler.actions.push({op:'styleToggle',ref,prop:m[2],when:[m[4]],then:m[6],otherwise:m[8]});continue;}
  if((m=text.match(/^if\s*\(\s*(.+?)\.style\.([a-zA-Z]+)\s*===?\s*(['"])([^'"]*)\3((?:\s*\|\|\s*\1\.style\.\2\s*===?\s*(['"])[^'"]*\6)*)\s*\)\s*\{\s*\1\.style\.\2\s*=\s*(['"])([^'"]*)\7;?\s*\}\s*else\s*\{\s*\1\.style\.\2\s*=\s*(['"])([^'"]*)\9;?\s*\}$/))){
   const ref=refExpression(m[1],scope,handler.uses);if(!ref)return false;const when=[m[4],...[...m[5].matchAll(/(['"])([^'"]*)\1/g)].map(v=>v[2])];handler.actions.push({op:'styleToggle',ref,prop:m[2],when,then:m[8],otherwise:m[10]});continue;
  }
  // if (x.classList.contains('a')) { x.classList.remove('a') / replace('a','b') } else { ... } → alternância.
  if((m=text.match(/^if\s*\(\s*(.+?)\.classList\.contains\(\s*(['"])([\w:-]+)\2\s*\)\s*\)\s*\{\s*\1\.classList\.(?:remove\(\s*(['"])\3\4\s*\)|replace\(\s*(['"])\3\5\s*,\s*(['"])([\w:-]+)\6\s*\));?\s*\}\s*else\s*\{\s*\1\.classList\.(?:add\(\s*(['"])\3\8\s*\)|replace\(\s*(['"])\7\9\s*,\s*(['"])\3\10\s*\));?\s*\}$/))){
   const ref=refExpression(m[1],scope,handler.uses);if(!ref)return false;for(const name of [m[3],...(m[7]?[m[7]]:[])])handler.actions.push({op:'class',mode:'toggle',ref,names:[name]});continue;
  }
  if((m=text.match(/^(.+?)\.setAttribute\(\s*(['"])(aria-[\w-]+)\2\s*,\s*([\s\S]+)\)$/))){
   const ref=refExpression(m[1],scope,handler.uses);if(!ref)return false;const value=flat(m[4]);let source:{ref:Ref;className:string}|undefined;let s:RegExpMatchArray|null;
   if((s=value.match(/^(?:String\()?(.+?)\.classList\.contains\(\s*(['"])([\w:-]+)\2\s*\)\)?$/))){const from=refExpression(s[1],scope,handler.uses);if(from)source={ref:from,className:s[3]};}
   else if((s=value.match(/^(?:String\()?([\w$]+)\)?(?:\s*\?\s*(['"])true\2\s*:\s*(['"])false\3)?$/)))source=toggled.get(s[1]);
   if(!source)return false;handler.attrs.push({ref,name:m[3],source});continue;
  }
  if((m=text.match(/^if\s*\(\s*([\w$]+)\.target\s*===?\s*(.+?)\s*\)\s*\{([\s\S]*)\}$/))&&m[1]===event){
   const ref=refExpression(m[2],scope,handler.uses);if(!ref)return false;handler.selfOnly=true;(handler as any).selfRef=ref;if(!parseBlock(m[3],scope,params,handler,toggled))return false;continue;
  }
  if((m=raw.trim().match(/^([\s\S]+?)\.forEach\(([\s\S]*)\)$/))){
   const list=refExpression(m[1],scope,handler.uses);const fn=handlerExpression(m[2]);if(list?.kind!=='selector'||!fn?.params[0])return false;const child:Scope=new Map(scope);child.set(fn.params[0],list);
   if(!parseBlock(fn.body,child,params,handler,toggled))return false;continue;
  }
  if((m=text.match(/^window\.scrollTo\(\s*\{\s*top\s*:\s*(\d+)\s*(?:,\s*(?:left\s*:\s*\d+\s*,\s*)?behavior\s*:\s*(['"])(\w+)\2\s*)?,?\s*\}\s*\)$/))||(m=text.match(/^window\.scrollTo\(\s*0\s*,\s*(\d+)\s*\)$/))||(m=text.match(/^document\.(?:documentElement|body)\.scrollTop\s*=\s*(\d+)$/))){handler.actions.push({op:'scroll',top:Number(m[1]),...(m[3]?{behavior:m[3]}:{})});continue;}
  if((m=text.match(/^(.+?)\.(src|alt|title|href|textContent|innerText)\s*=\s*([\s\S]+)$/))){
   const ref=refExpression(m[1],scope,handler.uses);if(!ref)return false;const value=m[3].trim();let v:RegExpMatchArray|null;
   if((v=value.match(/^(['"])([^'"]*)\1$/)))handler.actions.push({op:'prop',ref,prop:m[2],value:v[2]});
   else if((v=value.match(/^(.+?)\.(src|alt|title|href)$/))){const from=refExpression(v[1],scope,handler.uses);if(!from)return false;handler.actions.push({op:'prop',ref,prop:m[2],from:{ref:from,prop:v[2]}});}
   else return false;continue;
  }
  if((m=text.match(/^(?:window\.)?([\w$]+)\(\s*(this)?\s*\)$/))){handler.actions.push({op:'call',name:m[1],...(m[2]?{self:true}:{})});handler.uses.add(m[1]);continue;}
  return false;
 }
 return true;
}

/** Ligações de clique em nível superior: addEventListener, onclick e forEach sobre listas. */
export function parseListener(statement:string,scope:Scope,named:(name:string)=>Handler|undefined):Listener|undefined{
 const text=statement.trim();let m=text.match(/^([\s\S]+?)\.addEventListener\(\s*(['"])click\2\s*,\s*([\s\S]+?)\s*(?:,\s*(?:true|false|\{[^}]*\}))?\s*\)$/);
 if(!m)m=text.match(/^([\s\S]+?)\.onclick\s*=\s*()([\s\S]+)$/);
 const targets=m?refExpression(m[1],scope):undefined;
 if(m&&targets){
  const value=m[3].trim();
  if(/^[\w$]+$/.test(value)){const handler=named(value);return handler?{targets,handler}:undefined;}
  const fn=handlerExpression(value);if(!fn)return undefined;const handler=parseHandler(fn.body,scope,fn.params);return handler?{targets,handler}:undefined;
 }
 m=text.match(/^([\s\S]+?)\.forEach\(([\s\S]*)\)$/);
 if(m){
  const list=refExpression(m[1],scope);const fn=handlerExpression(m[2]);if(list?.kind!=='selector'||!fn?.params[0])return undefined;const child:Scope=new Map(scope);child.set(fn.params[0],{kind:'self'});
  const statements=splitStatements(fn.body);if(statements.length!==1)return undefined;const listener=parseListener(statements[0],child,named);
  if(!listener||listener.targets.kind!=='self')return undefined;return {targets:list,handler:listener.handler};
 }
 return undefined;
}
