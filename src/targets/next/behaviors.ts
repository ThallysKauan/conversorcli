import path from 'node:path';
import type {LegacyNode} from '../../validation/legacy.ts';
import {objectLiteral,readyBody,splitStatements,stripComments} from '../../conversion/js/statements.ts';
import {applyScriptedRules,styleAssignments} from './scripted.ts';
import {binding,functionDefinition,handlerExpression,parseHandler,parseListener,refExpression} from './interactions.ts';
import type {Action,Handler,Listener,Ref,Scope} from './interactions.ts';

// Migra scripts e eventos do HTML antigo para componentes React (tags "react:Nome").
// Nenhum JavaScript da origem é executado no projeto gerado: o que não tem regra vira pendência.
export interface BehaviorNotice {file:string;line:number;message:string;code?:string}
export interface BehaviorResult {pending:BehaviorNotice[];migrated:string[];decisions:string[];components:Set<string>;dependencies:Record<string,string>}
export interface BehaviorContext {pages?:Set<string>;endpoint?:(file:string)=>Promise<string>;entry:string;files:Set<string>;readSource:(file:string)=>Promise<string|undefined>;libraries:{file:string;name:string;content:string}[];thirdPartyHosts:string[];formMessage?:string}
interface Statement {text:string;flat:string;origin:string;claimed?:string}
interface ScriptRef {node:LegacyNode;parents:LegacyNode[]}

export const libraryCatalog=[
 {name:'jQuery',file:/(^|\/)jquery[\w.-]*\.js$/i},
 {name:'Slick',file:/(^|\/)slick[\w.-]*\.js$/i},
 {name:'OverlayScrollbars',file:/(^|\/)overlayscrollbars[\w.-]*\.js$/i},
 {name:'GSAP',file:/(^|\/)gsap(\.min)?\.js$/i},
 {name:'ScrollTrigger',file:/(^|\/)ScrollTrigger(\.min)?\.js$/},
 {name:'AOS',file:/(^|\/)aos(@[\w.-]+)?\/dist\/aos\.js$|(^|\/)aos[\w.-]*\.js$/i},
];
const normalize=(text:string)=>text.replace(/\r\n?/g,'\n');
const flat=(text:string)=>text.replace(/\s+/g,' ').trim();
const escape=(text:string)=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const snippet=(text:string)=>{const value=flat(text);return value.length>140?value.slice(0,140)+'…':value;};

// ---------- utilidades de árvore e seletores ----------
function elements(node:LegacyNode){return node.children.filter((child):child is LegacyNode=>typeof child!=='string');}
function walk(node:LegacyNode,visit:(node:LegacyNode,parents:LegacyNode[])=>void,parents:LegacyNode[]=[]){visit(node,parents);for(const child of elements(node))walk(child,visit,[...parents,node]);}
function classes(node:LegacyNode){return String(node.props.className||'').split(/\s+/).filter(Boolean);}
function originalTag(node:LegacyNode){return node.tag.startsWith('react:')?String(node.props.as||''):node.tag;}
type Compound={tag?:string;id?:string;classes:string[]};
function parseSelector(selector:string):Compound[][]|undefined{
 const groups:Compound[][]=[];
 for(const group of selector.split(',')){
  const parts=group.trim().split(/\s+/).filter(Boolean);if(!parts.length)return undefined;const chain:Compound[]=[];
  for(const part of parts){const match=part.match(/^([a-zA-Z][\w-]*)?((?:[#.][\w-]+)*)$/);if(!match||(!match[1]&&!match[2]))return undefined;const compound:Compound={tag:match[1]?.toLowerCase(),classes:[]};for(const token of match[2].match(/[#.][\w-]+/g)||[]){if(token[0]==='#')compound.id=token.slice(1);else compound.classes.push(token.slice(1));}chain.push(compound);}
  groups.push(chain);
 }
 return groups;
}
function matchesCompound(node:LegacyNode,compound:Compound){const own=classes(node);return (!compound.tag||originalTag(node)===compound.tag)&&(!compound.id||node.props.id===compound.id)&&compound.classes.every(name=>own.includes(name));}
function matches(node:LegacyNode,parents:LegacyNode[],chain:Compound[]){
 if(!matchesCompound(node,chain[chain.length-1]))return false;let index=parents.length-1;
 for(let part=chain.length-2;part>=0;part--){while(index>=0&&!matchesCompound(parents[index],chain[part]))index--;if(index<0)return false;index--;}
 return true;
}
/** Equivalente estático de querySelectorAll; undefined quando o seletor não é suportado. */
export function selectAll(root:LegacyNode,selector:string){
 const groups=parseSelector(selector);if(!groups)return undefined;const found:{node:LegacyNode;parents:LegacyNode[]}[]=[];
 walk(root,(node,parents)=>{if(node.tag!=='script'&&groups.some(chain=>matches(node,parents,chain)))found.push({node,parents});});
 return found;
}
function become(node:LegacyNode,component:string,props:Record<string,any>){if(!node.tag.startsWith('react:')){node.props={as:node.tag,...node.props};node.tag='react:'+component;}Object.assign(node.props,props);}
function wrap(node:LegacyNode,component:string,props:Record<string,any>){const inner:LegacyNode={tag:node.tag,props:node.props,children:node.children};node.tag='react:'+component;node.props=props;node.children=[inner];}

// ---------- coleta de scripts ----------
function libraryFor(src:string){let file=src.split(/[?#]/)[0];try{file=new URL(src,'https://example.invalid').pathname;}catch{}file=file.replace(/^\//,'');return {file,library:libraryCatalog.find(item=>item.file.test(file))};}
async function scriptStatements(ref:ScriptRef,context:BehaviorContext,result:BehaviorResult,statements:Statement[],external:ScriptRef[],versions:Record<string,string>){
 const {node}=ref;const type=String(node.props.type||'text/javascript').toLowerCase();
 if(!['text/javascript','application/javascript','module',''].includes(type)){result.pending.push({file:context.entry,line:0,message:'Script de tipo '+type+' sem regra de migração; omitido.'});return;}
 const src=typeof node.props.src==='string'?node.props.src:undefined;
 if(src){
  const {file,library}=libraryFor(src);
  if(library){const found=src.match(/@(\d[\w.-]*|next|latest)\/|\/ajax\/libs\/[\w.-]+\/(\d[\w.-]*)\//),version=found?.[1]||found?.[2];if(version)versions[library.name]=version;node.props['data-ppnet-library']=library.name;result.migrated.push('Biblioteca '+library.name+' ('+file+') substituída por componentes React.');return;}
  if(/^(https?:)?\/\//i.test(src)){external.push(ref);return;}
  const code=context.files.has(file)?await context.readSource(file):undefined;
  if(code===undefined){result.pending.push({file:context.entry,line:0,message:'Script local não encontrado: '+src+'; omitido.'});return;}
  collect(normalize(code),file,statements);return;
 }
 let code=normalize(node.children.join(''));
 for(const library of context.libraries){const content=normalize(library.content);if(content.trim()&&code.includes(content)){code=code.split(content).join('\n');result.migrated.push('Biblioteca '+library.name+' embutida ('+library.file+') substituída por componentes React.');}}
 collect(code,'script inline em '+context.entry,statements);
}
function collect(code:string,origin:string,statements:Statement[]){
 for(const text of splitStatements(code)){const body=readyBody(text);if(body!==undefined)collect(body,origin,statements);else statements.push({text,flat:flat(text),origin});}
}

// ---------- regras ----------
interface StickyRule {selector?:string;ref?:Ref;className:string;afterSelector?:string;addAt?:number;removeAt?:number;minWidth?:number}
interface RevealRule {observer:string;className:string;ratio:number;removeOnExit:boolean;once:boolean;options:Record<string,unknown>;targets:Ref[]}
interface ProgressRule {selector:string;mode:'dasharray'|'dashoffset'|'text'|'width'|'classes';radius?:number;above?:number;on?:string;off?:string}
interface Features {
 tabs:{triggers:string;panels:string;selectedClass:string;duration:number}[];carousels:{selector:string;options:any}[];
 backToTop:Map<string,Record<string,number>>;progress:ProgressRule[];sticky:StickyRule[];
 lazyImages:boolean;scrollbars?:any;gtm:Set<string>;gtagConfigs:string[];activeNav:{className:string}[];modal:boolean;
 listeners:Listener[];named:Map<string,{statement:Statement;params:string[];body:string;handler?:Handler|null}>;scope:Scope;
 aos?:Record<string,unknown>;reveals:RevealRule[];keys:{key:string;handler:Handler}[];sliders:{track:string;slides?:string;buttons:{selector:string;delta:number}[];interval:number}[];phoneMask?:string;recaptcha:Set<string>;pixel:{ids:Set<string>;events:string[]};
}
function claim(statement:Statement|undefined,reason:string){if(statement&&!statement.claimed)statement.claimed=reason;}
function args(text:string){const out:string[]=[];let depth=0,start=0,quote='';for(let i=0;i<text.length;i++){const c=text[i];if(quote){if(c==='\\')i++;else if(c===quote)quote='';continue;}if(c==='"'||c==="'"||c==='`'){quote=c;continue;}if('([{'.includes(c))depth++;else if(')]}'.includes(c))depth--;else if(c===','&&depth===0){out.push(text.slice(start,i).trim());start=i+1;}}out.push(text.slice(start).trim());return out.filter(Boolean);}

function applyRules(statements:Statement[],features:Features,result:BehaviorResult){
 // Escopo global: ligações a elementos e funções nomeadas.
 for(const statement of statements){const bound=binding(statement.text,features.scope);if(bound)features.scope.set(bound[0],bound[1]);const fn=functionDefinition(statement.text);if(fn)features.named.set(fn.name,{statement,params:fn.params,body:fn.body});}
 const bindingStatements=new Map<string,Statement[]>();for(const statement of statements){const bound=binding(statement.text,new Map(features.scope));if(bound)bindingStatements.set(bound[0],[...(bindingStatements.get(bound[0])||[]),statement]);}
 // Com self, o primeiro parâmetro é o elemento clicado: onclick="f(this)".
 const selfHandlers=new Map<string,Handler|null>();
 const named=(name:string,self=false)=>{
  const item=features.named.get(name);if(!item)return undefined;
  if(self){if(!item.params[0])return undefined;if(!selfHandlers.has(name)){selfHandlers.set(name,null);const scope=new Map(features.scope);scope.set(item.params[0],{kind:'self'});selfHandlers.set(name,parseHandler(item.body,scope,item.params.slice(1))||null);}return selfHandlers.get(name)||undefined;}
  if(item.handler===undefined){item.handler=null;item.handler=parseHandler(item.body,features.scope,item.params)||null;}return item.handler||undefined;
 };
 const claimUses=(handler:Handler,reason:string,seen=new Set<Handler>())=>{if(seen.has(handler))return;seen.add(handler);for(const name of handler.uses){for(const s of bindingStatements.get(name)||[])claim(s,reason);const fn=features.named.get(name);const parsed=fn?.handler||selfHandlers.get(name);if(fn&&parsed){claim(fn.statement,reason);claimUses(parsed,reason,seen);}}};
 (features as any).claimUses=claimUses;(features as any).namedHandler=named;
 for(const statement of statements){
  if(statement.claimed)continue;const text=statement.flat;let match:RegExpMatchArray|null;
  // Progresso circular de rolagem: strokeDasharray em função ligada a scroll/load.
  if((match=text.match(/^function\s+([\w$]+)\s*\(\s*\)\s*\{[\s\S]*scrollTop[\s\S]*scrollHeight[\s\S]*clientHeight[\s\S]*\b([\w$]+)\.style\.strokeDasharray[\s\S]*\}$/))){
   const bound=features.scope.get(match[2]);const radius=statements.find(s=>/^(?:const|let|var)\s+radius\s*=\s*\d+(?:\.\d+)?$/.test(s.flat));
   if(bound?.kind==='selector'){const name=match[1];features.progress.push({selector:bound.selector,mode:'dasharray',radius:radius?Number(radius.flat.split('=')[1]):20});claim(statement,'progresso');for(const s of bindingStatements.get(match[2])||[])claim(s,'progresso');claim(radius,'progresso');claim(statements.find(s=>/^(?:const|let|var)\s+circumference\s*=\s*2\s*\*\s*Math\.PI\s*\*\s*radius$/.test(s.flat)),'progresso');for(const s of statements)if(new RegExp('^window\\.addEventListener\\(\\s*([\'"])(?:scroll|load)\\1\\s*,\\s*'+escape(name)+'\\s*\\)$').test(s.flat))claim(s,'progresso');result.migrated.push('Indicador circular de rolagem convertido em componente React.');continue;}
  }
  // setupScrollProgress({buttonId, barId, textId, showOnScroll}): anel, porcentagem e botão.
  if(/^function\s+setupScrollProgress\s*\(/.test(text)&&text.includes('strokeDashoffset')&&/innerText|textContent/.test(text)){claim(statement,'progresso');continue;}
  if((match=statement.text.match(/^setupScrollProgress\(\s*(\{[\s\S]*\})\s*\)$/))&&features.named.has('setupScrollProgress')){
   try{const o=objectLiteral(match[1]);if(o.barId&&o.textId){features.progress.push({selector:'#'+o.barId,mode:'dashoffset',radius:20},{selector:'#'+o.textId,mode:'text'});if(o.showOnScroll&&o.buttonId)features.progress.push({selector:'#'+o.buttonId,mode:'classes',above:5,on:'visible',off:'hidden'});}claim(statement,'progresso');result.migrated.push('setupScrollProgress convertido em componentes React.');continue;}catch{}
  }
  // Barra horizontal de progresso: elemento.style.width = porcentagem rolada.
  if((match=statement.text.match(/^window\.addEventListener\(\s*(['"])scroll\1\s*,\s*([\s\S]+)\)$/))){
   const fn=handlerExpression(match[2]);const body=fn?flat(fn.body):'';const element=body.match(/(?:const|let|var)\s+([\w$]+)\s*=\s*document\.getElementById\(\s*(['"])([^'"]+)\2\s*\)/);
   if(fn&&element&&/scrollHeight/.test(body)&&new RegExp(escape(element[1])+'\\.style\\.width\\s*=').test(body)){features.progress.push({selector:'#'+element[3],mode:'width'});claim(statement,'progresso');result.migrated.push('Barra de progresso de rolagem convertida em componente React.');continue;}
   // Classe por rolagem: if (window.scrollY > N) { x.classList.add('c') } else { x.classList.remove('c') }
   const sticky=body.match(/^if\s*\(\s*(?:window\.scrollY|window\.pageYOffset|document\.documentElement\.scrollTop|document\.body\.scrollTop)(?:\s*\|\|\s*[\w.]+)*\s*>\s*(\d+)\s*\)\s*\{\s*(.+?)\.classList\.add\(\s*(['"])([\w-]+)\3\s*\);?\s*\}\s*else\s*\{\s*\2\.classList\.remove\(\s*(['"])\4\5\s*\);?\s*\}$/);
   if(sticky){const ref=refExpression(sticky[2],features.scope);if(ref){features.sticky.push({ref,className:sticky[4],addAt:Number(sticky[1])});claim(statement,'topo-fixo');const name=sticky[2].trim();for(const s of bindingStatements.get(name)||[])claim(s,'topo-fixo');result.migrated.push('Classe '+sticky[4]+' por rolagem convertida em componente React.');continue;}}
  }
  // function f(){ x.classList.toggle('c', window.scrollY > N) } + window.addEventListener('scroll', f).
  if((match=text.match(/^function\s+([\w$]+)\s*\(\s*\)\s*\{\s*(?:if\s*\(\s*!\s*([\w$]+)\s*\)\s*return;?\s*)?(.+?)\.classList\.toggle\(\s*(['"])([\w-]+)\4\s*,\s*(?:window\.scrollY|window\.pageYOffset|document\.documentElement\.scrollTop)\s*>\s*(\d+)\s*\);?\s*\}$/))){
   const name=match[1],ref=refExpression(match[3],features.scope);const listener=statements.find(s=>new RegExp('^window\\.addEventListener\\(\\s*([\'"])scroll\\1\\s*,\\s*'+escape(name)+'\\s*(?:,[^)]*)?\\)$').test(s.flat));
   if(ref&&listener){features.sticky.push({ref,className:match[5],addAt:Number(match[6])});claim(statement,'topo-fixo');claim(listener,'topo-fixo');for(const s of statements)if(s.flat===name+'()')claim(s,'topo-fixo');for(const s of bindingStatements.get(match[3].trim())||[])claim(s,'topo-fixo');result.migrated.push('Classe '+match[5]+' por rolagem convertida em componente React.');continue;}
  }
  // Tecla Escape: document.addEventListener('keydown', e => { if (e.key === 'Escape') { ... } }).
  if((match=statement.text.match(/^document\.addEventListener\(\s*(['"])keydown\1\s*,\s*([\s\S]+)\)$/))){
   const fn=handlerExpression(match[2]);const inner=fn?.params[0]?flat(fn.body).replace(/;$/,'').match(new RegExp('^if\\s*\\(\\s*'+escape(fn.params[0])+'\\.key\\s*===?\\s*([\'"])(\\w+)\\1\\s*\\)\\s*\\{([\\s\\S]*)\\}$')):null;
   const handler=inner?parseHandler(inner[3],features.scope,[]):undefined;
   if(inner&&handler){features.keys.push({key:inner[2],handler});claim(statement,'tecla');claimUses(handler,'tecla');continue;}
  }
  // Slider por translateX: function go(i){ limites; track.style.transform = `translateX(-${i * 100}%)`; atual = i }.
  if((match=statement.text.match(/^function\s+([\w$]+)\s*\(\s*([\w$]+)\s*\)\s*\{([\s\S]*)\}$/))){
   const [ ,name,param,body]=match;const b=flat(body);const e=escape(param);
   const transform=b.match(new RegExp('([\\w$]+)\\.style\\.transform\\s*=\\s*`translateX\\(-\\$\\{\\s*'+e+'\\s*\\*\\s*100\\s*\\}%\\)`'));const current=b.match(new RegExp('([\\w$]+)\\s*=\\s*'+e+';?\\s*$'));
   const wraps=new RegExp('if\\s*\\(\\s*'+e+'\\s*<\\s*0\\s*\\)\\s*'+e+'\\s*=\\s*([\\w$]+)\\s*-\\s*1;?\\s*else\\s+if\\s*\\(\\s*'+e+'\\s*>=\\s*\\1\\s*\\)\\s*'+e+'\\s*=\\s*0').exec(b);
   const track=transform?features.scope.get(transform[1]):undefined;
   if(transform&&current&&wraps&&track?.kind==='selector'){
    const cur=escape(current[1]);const step=(s:Statement)=>{const m=s.flat.match(new RegExp('^(.+?)\\.addEventListener\\(\\s*([\'"])click\\2\\s*,\\s*\\(\\s*\\)\\s*=>\\s*\\{?\\s*'+escape(name)+'\\(\\s*'+cur+'\\s*([+-])\\s*1\\s*\\);?\\s*\\}?\\s*\\)$'));return m?{ref:refExpression(m[1],features.scope),delta:m[3]==='+'?1:-1,name:m[1].trim()}:undefined;};
    const buttons=statements.map(s=>({s,b:step(s)})).filter(x=>x.b?.ref?.kind==='selector');
    const auto=statements.find(s=>new RegExp('^setInterval\\(\\s*\\(\\s*\\)\\s*=>\\s*\\{?\\s*'+escape(name)+'\\(\\s*'+cur+'\\s*\\+\\s*1\\s*\\);?\\s*\\}?\\s*,\\s*(\\d+)\\s*\\)$').test(s.flat));
    const lengthOf=statements.map(s=>s.flat.match(new RegExp('^(?:const|let|var)\\s+'+escape(wraps[1])+'\\s*=\\s*([\\w$]+)\\.length$'))).find(Boolean)?.[1];const slides=lengthOf?features.scope.get(lengthOf):undefined;
    features.sliders.push({track:track.selector,slides:slides?.kind==='selector'?slides.selector:undefined,buttons:buttons.map(x=>({selector:(x.b!.ref as {selector:string}).selector,delta:x.b!.delta})),interval:auto?Number(auto.flat.match(/,\s*(\d+)\s*\)$/)![1]):0});
    claim(statement,'slider');claim(auto,'slider');for(const x of buttons){claim(x.s,'slider');for(const s of bindingStatements.get(x.b!.name)||[])claim(s,'slider');}
    for(const s of [...(bindingStatements.get(transform[1])||[]),...(bindingStatements.get(wraps[1])||[])])claim(s,'slider');
    for(const s of statements)if(new RegExp('^(?:const|let|var)\\s+('+cur+'|'+escape(wraps[1])+')\\s*=\\s*(?:0|[\\w$]+\\.length)$').test(s.flat))claim(s,'slider');
    const list=statements.find(s=>new RegExp('^(?:const|let|var)\\s+([\\w$]+)\\s*=').test(s.flat)&&statements.some(t=>new RegExp('^(?:const|let|var)\\s+'+escape(wraps[1])+'\\s*=\\s*'+escape(s.flat.match(/^(?:const|let|var)\s+([\w$]+)/)![1])+'\\.length$').test(t.flat)));claim(list,'slider');
    continue;
   }
  }
  // Abas com slideUp/slideDown (regiões).
  if(/^if\s*\(/.test(text)&&text.includes('.slideUp(')&&text.includes('.slideDown(')){
   const vars=[...text.matchAll(/var\s+([\w$]+)\s*=\s*\$\(\s*(['"])([^'"]+?)\2\s*\)/g)];const numbers=new Map([...text.matchAll(/var\s+([\w$]+)\s*=\s*(\d+)/g)].map(m=>[m[1],Number(m[2])]));
   const trigger=vars.find(v=>new RegExp(escape(v[1])+'\\.click\\(').test(text)),panel=vars.find(v=>new RegExp(escape(v[1])+'\\s*\\.eq\\([^)]*\\)\\s*\\.stop\\([^)]*\\)\\s*\\.slideDown').test(text));
   const selected=text.match(/addClass\(\s*(['"])([\w-]+)\1\s*\)/),duration=text.match(/slideDown\(\s*([\w$]+|\d+)\s*\)/);
   if(trigger&&panel&&selected){features.tabs.push({triggers:trigger[3],panels:panel[3],selectedClass:selected[2],duration:duration?(numbers.get(duration[1])??(Number(duration[1])||400)):400});claim(statement,'abas');continue;}
  }
  // Voltar ao topo: visibilidade por rolagem e clique com animação.
  if((match=text.match(/^\$\(\s*window\s*\)\.scroll\(\s*function\s*\(\s*\)\s*\{\s*if\s*\(\s*\$\(\s*this\s*\)\.scrollTop\(\)\s*>\s*(\d+)\s*\)\s*\{\s*\$\(\s*(['"])([^'"]+?)\2\s*\)\.fadeIn\(\s*(\d*)\s*\);?\s*\}\s*else\s*\{\s*\$\(\s*(['"])([^'"]+?)\5\s*\)\.fadeOut\(\s*(\d*)\s*\);?\s*\}\s*\}\s*\)$/))&&match[3]===match[6]){
   const item=features.backToTop.get(match[3])||{};Object.assign(item,{showAfter:Number(match[1]),fadeIn:Number(match[4]||400),fadeOut:Number(match[7]||400)});features.backToTop.set(match[3],item);claim(statement,'topo');continue;
  }
  if((match=text.match(/^\$\(\s*(['"])([^'"]+?)\1\s*\)\.click\(\s*function\s*\(\s*([\w$]*)\s*\)\s*\{\s*(?:([\w$]+)\.preventDefault\(\);?\s*)?\$\(\s*(['"])html,\s*body\5\s*\)\.animate\(\s*\{\s*scrollTop\s*:\s*0\s*\}\s*,\s*(\d+)\s*\);?\s*\}\s*\)$/))){
   const item=features.backToTop.get(match[2])||{};item.scrollDuration=Number(match[6]);features.backToTop.set(match[2],item);claim(statement,'topo');continue;
  }
  // Carrossel slick.
  if((match=statement.text.match(/^\$\(\s*(['"])([^'"]+?)\1\s*\)\.slick\(\s*(\{[\s\S]*\})\s*\)$/))){
   try{features.carousels.push({selector:match[2],options:objectLiteral(match[3])});claim(statement,'carrossel');continue;}catch{}
  }
  // Topo fixo jQuery: altura de outro elemento ou limiares com histerese.
  if(/^if\s*\(\s*\$\(/.test(text)&&/addClass\(/.test(text)&&/removeClass\(/.test(text)&&/scrollTop\(\)/.test(text)){
   const target=text.match(/var\s+([\w$]+)\s*=\s*\$\(\s*(['"])([^'"]+?)\2\s*\)/),after=text.match(/\$\(\s*(['"])([^'"]+?)\1\s*\)\.outerHeight\(\)/),cls=text.match(/addClass\(\s*(['"])([\w-]+)\1\s*\)/);
   const add=text.match(/[\w$]+\s*>\s*(\d+)\s*&&\s*[\w$]+\s*>\s*(\d+)/)||text.match(/if\s*\(\s*[\w$]+\s*>\s*(\d+)\s*\)\s*\{\s*[\w$]+\.addClass\(\s*['"][\w-]+['"]\s*\);?\s*\}\s*else\s*\{\s*[\w$]+\.removeClass\(/),remove=text.match(/[\w$]+\s*<\s*(\d+)\s*\|\|\s*[\w$]+\s*<=\s*(\d+)/),width=text.match(/[\w$]+\s*>\s*(\d+)\s*\)/);
   if(target&&cls&&(after||add)){
    const rule:StickyRule={selector:target[3],className:cls[2]};
    if(after){rule.afterSelector=after[2];rule.minWidth=width?Number(width[1]):0;}else{rule.addAt=Number(add![1]);if(add![2])rule.minWidth=Number(add![2]);if(remove)rule.removeAt=Number(remove[1]);}
    features.sticky.push(rule);claim(statement,'topo-fixo');result.migrated.push('Topo fixo ('+cls[2]+') convertido em componente React.');continue;
   }
  }
  // Barra de rolagem OverlayScrollbars.
  if(/^(?:var|let|const)\s*\{[^}]*\}\s*=\s*OverlayScrollbarsGlobal$/.test(text)){claim(statement,'scrollbar');continue;}
  if((match=statement.text.match(/^(?:(?:var|let|const)\s+[\w$]+\s*=\s*)?OverlayScrollbars\(\s*document\.body\s*,\s*(\{[\s\S]*\})\s*\)$/))){try{features.scrollbars=objectLiteral(match[1]);claim(statement,'scrollbar');result.migrated.push('OverlayScrollbars convertido em componente React com o pacote npm.');continue;}catch{}}
  // AOS (animações ao rolar).
  if((match=statement.text.match(/^AOS\.init\(\s*(\{[\s\S]*\})?\s*\)$/))){try{features.aos=match[1]?objectLiteral(match[1]):{};claim(statement,'aos');result.migrated.push('AOS.init convertido em componente React com o pacote npm.');continue;}catch{}}
  // Google Tag Manager, gtag e Meta Pixel.
  if(text.includes('gtm.start')&&text.includes('googletagmanager.com/gtm.js')&&(match=text.match(/(['"])(GTM-[A-Z0-9]+)\1/))){features.gtm.add(match[2]);claim(statement,'gtm');result.migrated.push('Google Tag Manager '+match[2]+' carregado por next/script.');continue;}
  if(/^window\.dataLayer\s*=\s*window\.dataLayer\s*\|\|\s*\[\]$/.test(text)||/^function\s+gtag\s*\(\s*\)\s*\{\s*dataLayer\.push\(\s*arguments\s*\);?\s*\}$/.test(text)||/^gtag\(\s*(['"])js\1\s*,\s*new Date\(\)\s*\)$/.test(text)){claim(statement,'gtag');continue;}
  if((match=text.match(/^gtag\(\s*(['"])config\1\s*,\s*(['"])([\w-]+)\2\s*\)$/))){features.gtagConfigs.push(match[3]);claim(statement,'gtag');continue;}
  if(/connect\.facebook\.net\/[\w_]+\/fbevents\.js/.test(text)&&/^!?function\s*\(\s*f\s*,\s*b\s*,\s*e\s*,\s*v/.test(text)){claim(statement,'pixel');continue;}
  if((match=text.match(/^fbq\(\s*(['"])init\1\s*,\s*(['"])(\d+)\2\s*\)$/))){features.pixel.ids.add(match[3]);claim(statement,'pixel');result.migrated.push('Meta Pixel '+match[3]+' carregado por next/script.');continue;}
  if((match=text.match(/^fbq\(\s*(['"])track\1\s*,\s*(['"])(\w+)\2\s*\)$/))){features.pixel.events.push(match[3]);claim(statement,'pixel');continue;}
  // Carregamento preguiçoso de imagens: aplicado estaticamente aos atributos.
  if((match=text.match(/^function\s+([\w$]+)\s*\(\s*\)\s*\{[\s\S]*querySelectorAll\(\s*(['"])img\2\s*\)[\s\S]*setAttribute\(\s*(['"])loading\3\s*,\s*(['"])lazy\4\s*\)[\s\S]*\}$/))){
   const name=match[1];features.lazyImages=true;claim(statement,'lazy');for(const s of statements)if(s.flat===name+'()'||new RegExp('^document\\.addEventListener\\(\\s*([\'"])DOMContentLoaded\\1\\s*,\\s*'+escape(name)+'\\s*\\)$').test(s.flat))claim(s,'lazy');
   result.migrated.push('Atributos loading/alt/title das imagens aplicados estaticamente na geração.');result.decisions.push('width/height medidos em tempo de execução por '+name+'() não foram fixados: dependem do tamanho renderizado e o CSS da origem define as dimensões.');continue;
  }
  // Menu ativo por classe.
  if((match=text.match(/^Array\.from\(\s*([\w$]+)\s*\)\.forEach\([\s\S]*getAttribute\(\s*(['"])href\2\s*\)[\s\S]*classList\.add\(\s*(['"])active\3\s*\)[\s\S]*$/))){
   const collection=statements.find(s=>new RegExp('^(?:const|let|var)\\s+'+escape(match![1])+'\\s*=\\s*document\\.getElementsByClassName\\(\\s*([\'"])([\\w-]+)\\1\\s*\\)$').test(s.flat));const location=statements.find(s=>/^(?:const|let|var)\s+[\w$]+\s*=\s*window\.location\.pathname\.split\(\s*(['"])\/\1\s*\)\.pop\(\)$/.test(s.flat));
   if(collection&&location){features.activeNav.push({className:collection.flat.match(/getElementsByClassName\(\s*['"]([\w-]+)['"]/)![1]});claim(statement,'menu-ativo');claim(collection,'menu-ativo');claim(location,'menu-ativo');continue;}
  }
  // Revelação ao rolar com IntersectionObserver.
  if((match=statement.text.match(/^(?:const|let|var)\s+([\w$]+)\s*=\s*new\s+IntersectionObserver\(\s*([\s\S]*)\)$/))){
   const parts=args(match[2]);const fn=parts[0]?handlerExpression(parts[0]):undefined;let rule:RevealRule|undefined;
   if(fn&&fn.params[0]){
    const list=fn.params[0];const inner=flat(fn.body).replace(/;$/,'').match(new RegExp('^(?:Array\\.from\\(\\s*'+escape(list)+'\\s*\\)|'+escape(list)+')\\.forEach\\(\\s*(?:function\\s*\\(\\s*([\\w$]+)\\s*\\)|\\(?\\s*([\\w$]+)\\s*\\)?\\s*=>)\\s*\\{?\\s*([\\s\\S]*?)\\s*\\}?\\s*\\)$'));
    if(inner){
     const e=escape(inner[1]||inner[2]),body=inner[3].replace(/;\s*$/,''),o=escape(match[1]);let m:RegExpMatchArray|null;
     if((m=body.match(new RegExp('^if\\s*\\(\\s*'+e+'\\.isIntersecting\\s*\\)\\s*\\{\\s*'+e+'\\.target\\.classList\\.add\\(\\s*([\'"])([\\w-]+)\\1\\s*\\);?\\s*('+o+'\\.unobserve\\(\\s*'+e+'\\.target\\s*\\);?)?\\s*\\}(\\s*else\\s*\\{\\s*'+e+'\\.target\\.classList\\.remove\\(\\s*([\'"])\\2\\5\\s*\\);?\\s*\\})?$'))))rule={observer:match[1],className:m[2],ratio:0,removeOnExit:!!m[4],once:!!m[3],options:{},targets:[]};
     else if((m=body.match(new RegExp('^'+e+'\\.target\\.classList\\.remove\\(\\s*([\'"])([\\w-]+)\\1\\s*\\);?\\s*if\\s*\\(\\s*'+e+'\\.intersectionRatio\\s*>=?\\s*([\\d.]+)\\s*\\)\\s*\\{\\s*'+e+'\\.target\\.classList\\.add\\(\\s*([\'"])\\2\\4\\s*\\);?\\s*\\}$'))))rule={observer:match[1],className:m[2],ratio:Number(m[3]),removeOnExit:true,once:false,options:{},targets:[]};
     else if((m=body.match(new RegExp('^if\\s*\\(\\s*'+e+'\\.intersectionRatio\\s*>=?\\s*([\\d.]+)\\s*\\)\\s*\\{\\s*'+e+'\\.target\\.classList\\.add\\(\\s*([\'"])([\\w-]+)\\2\\s*\\);?\\s*\\}\\s*else\\s*\\{\\s*'+e+'\\.target\\.classList\\.remove\\(\\s*([\'"])\\3\\4\\s*\\);?\\s*\\}$'))))rule={observer:match[1],className:m[3],ratio:Number(m[1]),removeOnExit:true,once:false,options:{},targets:[]};
    }
   }
   if(rule&&parts[1]){try{rule.options=objectLiteral(parts[1]);}catch{rule=undefined;}}
   if(rule){features.reveals.push(rule);claim(statement,'revelar');continue;}
  }
  {
   const reveal=features.reveals.find(r=>new RegExp('\\b'+escape(r.observer)+'\\.observe\\(').test(text));
   if(reveal){
    let m=text.match(new RegExp('^(.+?)\\.forEach\\(\\s*(?:function\\s*\\(\\s*([\\w$]+)\\s*\\)|\\(?\\s*([\\w$]+)\\s*\\)?\\s*=>)\\s*\\{?\\s*'+escape(reveal.observer)+'\\.observe\\(\\s*([\\w$]+)\\s*\\);?\\s*\\}?\\s*\\)$'));
    let ref=m&&(m[2]||m[3])===m[4]?refExpression(m[1],features.scope):undefined;
    if(!m){m=text.match(new RegExp('^'+escape(reveal.observer)+'\\.observe\\(\\s*(.+)\\s*\\)$'));if(m)ref=refExpression(m[1],features.scope);}
    if(ref?.kind==='selector'){reveal.targets.push(ref);claim(statement,'revelar');const base=m![1].trim();for(const s of bindingStatements.get(base)||[])claim(s,'revelar');result.migrated.push('Revelação ao rolar ('+reveal.className+') convertida em componente React.');continue;}
   }
  }
  // Máscara de telefone window.validade() e carregador de reCAPTCHA addCode().
  if((match=text.match(/^window\.([\w$]+)\s*=\s*function\s*\(\s*\)\s*\{\s*mascara\(\s*[\w$]+\s*,\s*mtel\s*\);?\s*\}$/))){features.phoneMask=match[1];statement.claimed='mascara?';continue;}
  if((match=text.match(/^function\s+([\w$]+)\s*\(\s*\)\s*\{[\s\S]*recaptcha\/api\.js[\s\S]*\}$/))){features.recaptcha.add(match[1]);statement.claimed='recaptcha?';continue;}
  if(features.recaptcha.size&&(match=text.match(/^(?:Array\.from\(\s*)?([\w$]+)\)?\.forEach\(\s*(?:function\s*\(\s*([\w$]+)\s*\)|\(?\s*([\w$]+)\s*\)?\s*=>)\s*\{?\s*\2?\3?\.addEventListener\(\s*(['"])(?:click|focus)\4\s*,\s*([\w$]+)\s*\);?\s*\}?\s*\)$/))&&features.recaptcha.has(match[5])){claim(statement,'recaptcha');result.decisions.push('Carregamento antecipado do reCAPTCHA ('+match[5]+') dispensado: o ContactForm do template carrega a verificação.');continue;}
  // Cliques genéricos: addEventListener('click'), onclick e forEach.
  const listener=parseListener(statement.text,features.scope,named);
  if(listener){features.listeners.push(listener);claim(statement,'interação');claimUses(listener.handler,'interação');const target=text.match(/^(?:Array\.from\(\s*)?([\w$]+)\b/)?.[1];if(target)for(const s of bindingStatements.get(target)||[])claim(s,'interação');continue;}
  // Modal de imagem openModal(this)/closeModal().
  if(/^function\s+openModal\s*\(\s*[\w$]+\s*\)\s*\{[\s\S]*myModal[\s\S]*modal-content[\s\S]*\}$/.test(text)){features.modal=true;statement.claimed='modal?';continue;}
  if(/^function\s+closeModal\s*\(\s*\)\s*\{[\s\S]*myModal[\s\S]*\.remove\(\)[\s\S]*\}$/.test(text)){statement.claimed='modal?';continue;}
 }
}

// Declarações sem efeito e sem referências no HTML ou em código ainda ativo são descartadas.
const pureDeclaration=/^(?:function\s+([\w$]+)\s*\(|(?:window\.)?([\w$]+)\s*=\s*(?:function\b|\([^)]*\)\s*=>)|(?:const|let|var)\s+([\w$]+)\s*=\s*(?:-?\d+(?:\.\d+)?|(['"])[^'"]*\4|(?:true|false|null)|document\.(?:getElementById|querySelector|querySelectorAll|getElementsByClassName)\(\s*(['"])[^'"]+\5\s*\)|window\.location\.[\w.]+(?:\(\s*(['"])[^'"]*\6\s*\))?(?:\.\w+\(\))?|localStorage\.getItem\(\s*['"][^'"]+['"]\s*\)|function\b[\s\S]*|\([^)]*\)\s*=>[\s\S]*)$|([\w$]+)\s*=\s*(?:-?\d+(?:\.\d+)?|(['"])[^'"]*\8|document\.(?:getElementById|querySelector|querySelectorAll)\(\s*['"][^'"]+['"]\s*\))$)/;
function removeDeadCode(statements:Statement[],domText:string,result:BehaviorResult){
 const declared=(s:Statement)=>{const m=s.flat.match(pureDeclaration);return m?(m[1]||m[2]||m[3]||m[7]):undefined;};
 const open=(s:Statement)=>!s.claimed||s.claimed.endsWith('?');
 let changed=true;
 while(changed){
  changed=false;
  for(const statement of statements){
   if(!open(statement))continue;const name=declared(statement);if(!name)continue;const pattern=new RegExp('(^|[^\\w$])'+escape(name)+'(?![\\w$])');
   // Cópias idênticas (script incluído duas vezes) não contam como uso uma da outra.
   const used=pattern.test(domText)||statements.some(other=>other.flat!==statement.flat&&open(other)&&pattern.test(other.text));
   if(!used){statement.claimed='sem-uso';result.decisions.push('Código sem chamadas no HTML convertido descartado: '+name+' ('+statement.origin+').');changed=true;}
  }
 }
}

// Referências possíveis a funções globais ficam em atributos (eventos, data-callback), não em textos.
function attributeText(root:LegacyNode){const values:string[]=[];walk(root,node=>{for(const [key,value] of Object.entries(node.props)){if(typeof value!=='string')continue;if(/^on/i.test(key)||/^javascript:/i.test(value)||(/^data-/.test(key)&&/^[\w$.]+$/.test(value)))values.push(value);}});return values.join('\n');}

// ---------- interações: resolução das ações para elementos concretos ----------
type Resolved=Record<string,any>;
function interactionsResolver(document:LegacyNode,body:LegacyNode,result:BehaviorResult,use:(name:string)=>string,named:(name:string,self?:boolean)=>Handler|undefined,entry:string){
 const keys=new Map<LegacyNode,string>();let used=false;
 const keyOf=(node:LegacyNode)=>{if(node===body)return 'body';let key=keys.get(node);if(!key){key='k'+(keys.size+1);keys.set(node,key);become(node,use('Interactive'),{stateKey:key});}used=true;return key;};
 const resolve=(ref:Ref,trigger:LegacyNode):LegacyNode[]|undefined=>{if(ref.kind==='self')return [trigger];if(ref.kind==='body')return [body];const found=selectAll(document,ref.selector);if(!found)return undefined;return (ref.all?found:found.slice(0,1)).map(f=>f.node);};
 const flatten=(handler:Handler,trigger:LegacyNode,depth=0):{actions:Resolved[];attrs:{node:LegacyNode;name:string;key:string;className:string;initial:boolean}[]}|string=>{
  const out:Resolved[]=[];const attrs:any[]=[];
  for(const guard of handler.guards){const nodes=resolve(guard,trigger);if(!nodes?.length)return 'guard';}
  for(const action of handler.actions){
   if(action.op==='scroll'){out.push({op:'scroll',top:action.top,...(action.behavior?{behavior:action.behavior}:{})});continue;}
   if(action.op==='call'){const inner=depth<5?named(action.name,action.self):undefined;if(!inner)return 'Função '+action.name+'() sem regra de migração';const nested=flatten(inner,trigger,depth+1);if(typeof nested==='string'){if(nested==='guard')continue;return nested;}out.push(...nested.actions);attrs.push(...nested.attrs);continue;}
   const nodes=resolve(action.ref,trigger);if(nodes===undefined)return 'seletor não suportado';
   if(!nodes.length){if(action.ref.kind==='selector'&&!action.ref.all){result.decisions.push('Elemento '+action.ref.selector+' ausente em '+entry+': o código original parava com TypeError neste ponto; as ações seguintes não são aplicadas.');break;}continue;}
   for(const node of nodes){
    const key=keyOf(node);
    if(action.op==='class')for(const name of action.names)out.push({op:'class',mode:action.mode,key,name,initial:classes(node).includes(name)});
    else if(action.op==='style')out.push({op:'style',key,prop:action.prop,value:action.value});
    else if(action.op==='prop'){let value=action.value;if(action.from){const source=resolve(action.from.ref,trigger)?.[0];if(!source)return 'origem de '+action.prop+' ausente';value=String(source.props[action.from.prop]??'');}out.push({op:'prop',key,prop:action.prop==='innerText'?'textContent':action.prop,value});}
    else out.push({op:'styleToggle',key,prop:action.prop,when:action.when,then:action.then,otherwise:action.otherwise,initial:String(node.props.style?.[action.prop]??'')});
   }
  }
  for(const attr of handler.attrs){const targets=resolve(attr.ref,trigger),sources=resolve(attr.source.ref,trigger);if(!targets?.length||!sources?.length)continue;const source=sources[0];const key=keyOf(source);for(const node of targets)attrs.push({node,name:attr.name,key,className:attr.source.className,initial:classes(source).includes(attr.source.className)});}
  return {actions:out,attrs};
 };
 const attach=(trigger:LegacyNode,handler:Handler,label:string)=>{
  if(handler.selfOnly){const self=(handler as any).selfRef as Ref;const nodes=resolve(self,trigger);if(!nodes?.includes(trigger)){result.pending.push({file:entry,line:0,message:'Interação '+label+' com condição event.target não suportada; removida.'});return false;}}
  const resolved=flatten(handler,trigger);if(resolved==='guard'){result.decisions.push('Interação '+label+' sem efeito nesta página: elemento verificado pelo código original não existe.');return true;}
  if(typeof resolved==='string'){result.pending.push({file:entry,line:0,message:'Interação '+label+' não migrada: '+resolved+'.'});return false;}
  for(const attr of resolved.attrs){keyOf(attr.node);attr.node.props.bindAttrs={...(attr.node.props.bindAttrs||{}),[attr.name]:{key:attr.key,className:attr.className,initial:attr.initial}};}
  keyOf(trigger);trigger.props.handlers=[...(trigger.props.handlers||[]),{actions:resolved.actions,preventDefault:handler.preventDefault,...(handler.stopPropagation?{stopPropagation:true}:{}),selfOnly:handler.selfOnly}];return true;
 };
 return {attach,resolve,flatten,get used(){return used;}};
}

// ---------- aplicação das regras ao DOM ----------
export async function migrateBehaviors(document:LegacyNode,context:BehaviorContext):Promise<BehaviorResult>{
 const result:BehaviorResult={pending:[],migrated:[],decisions:[],components:new Set(),dependencies:{}};
 const body=elements(document).find(node=>node.tag==='body');if(!body)return result;
 const scripts:ScriptRef[]=[];walk(document,(node,parents)=>{if(node.tag==='script'&&String(node.props.type||'').toLowerCase()!=='application/ld+json')scripts.push({node,parents});});
 const statements:Statement[]=[],external:ScriptRef[]=[],versions:Record<string,string>={};
 for(const ref of scripts)await scriptStatements(ref,context,result,statements,external,versions);
 const features:Features={tabs:[],carousels:[],backToTop:new Map(),progress:[],sticky:[],lazyImages:false,gtm:new Set(),gtagConfigs:[],activeNav:[],modal:false,listeners:[],named:new Map(),scope:new Map(),reveals:[],keys:[],sliders:[],recaptcha:new Set(),pixel:{ids:new Set(),events:[]}};
 // Regras por seletor antes das genéricas: os cliques do carrossel centralizado não viram interações soltas.
 const scripted=applyScriptedRules(statements);
 applyRules(statements,features,result);
 const use=(name:string)=>{result.components.add(name);return name;};
 // Substitui cada script pelo componente equivalente na mesma posição.
 const placedScripted=new Set<object>();
 function placeScripted(match:(item:{marker:string})=>boolean){
  const nodes:LegacyNode[]=[];const take=<T extends {marker:string}>(list:T[])=>list.filter(item=>!placedScripted.has(item)&&match(item)).map(item=>{placedScripted.add(item);return item;});
  const tweens=take(scripted.tweens);
  if(tweens.length){nodes.push({tag:'react:'+use('ScrollTween'),props:{tweens:tweens.map(t=>t.tween)},children:[]});result.dependencies.gsap=versions.GSAP||'^3.12.2';result.migrated.push('Animações GSAP/ScrollTrigger convertidas em componente React (pacote gsap).');}
  for(const {rule} of take(scripted.rotators)){
   if(!selectAll(document,rule.selector)?.length){result.decisions.push('Rotação de classe em '+rule.selector+' sem elementos nesta página; o código original falhava com TypeError e nada foi aplicado.');continue;}
   nodes.push({tag:'react:'+use('ClassRotator'),props:{...rule},children:[]});result.migrated.push('Rotação da classe '+rule.className+' em '+rule.selector+' convertida em componente React.');
  }
  for(const {rule} of take(scripted.carousels)){
   const missing=[rule.slides,rule.prev,rule.next,rule.container,rule.track].filter(selector=>!selectAll(document,selector)?.length);
   if(missing.length){result.decisions.push('Carrossel '+rule.slides+' sem '+missing.join(', ')+' nesta página; o código original falhava com TypeError e nada foi aplicado.');continue;}
   nodes.push({tag:'react:'+use('CenteredCarousel'),props:{...rule},children:[]});result.migrated.push('Carrossel centralizado '+rule.slides+' convertido em componente React.');
  }
  return nodes;
 }
 const gaSources=new Map<ScriptRef,string>();
 for(const ref of external){const src=String(ref.node.props.src);const ga=src.match(/googletagmanager\.com\/gtag\/js\?id=([\w-]+)/);if(ga)gaSources.set(ref,ga[1]);}
 let gtmPlaced=false,gaPlaced=gaSources.size>0,pixelPlaced=false;
 for(const ref of scripts){
  const node=ref.node;const src=typeof node.props.src==='string'?node.props.src:undefined;
  if(src&&gaSources.has(ref)){const id=gaSources.get(ref)!;node.tag='react:'+use('GoogleAnalytics');node.props={id,configs:[...new Set(features.gtagConfigs.length?features.gtagConfigs:[id])]};node.children=[];continue;}
  if(src&&external.includes(ref)){
   const host=new URL(src,'https://example.invalid').host;node.tag='react:'+use('ExternalScript');node.props={src,...(node.props.id?{id:node.props.id}:{})};node.children=[];
   if(context.thirdPartyHosts.some(item=>host===item||host.endsWith('.'+item)))result.migrated.push('Script de terceiro '+host+' carregado por next/script.');
   else result.pending.push({file:context.entry,line:0,message:'Script externo sem regra ('+host+') carregado por next/script; validar necessidade.'});
   continue;
  }
  const code=node.children.join('');
  if(!gtmPlaced&&features.gtm.size&&code.includes('gtm.start')){node.tag='react:'+use('GoogleTagManager');node.props={ids:[...features.gtm]};node.children=[];gtmPlaced=true;continue;}
  if(!gaPlaced&&features.gtagConfigs.length&&/gtag\(\s*['"]config/.test(code)){node.tag='react:'+use('GoogleAnalytics');node.props={id:features.gtagConfigs[0],configs:[...new Set(features.gtagConfigs)]};node.children=[];gaPlaced=true;continue;}
  if(!pixelPlaced&&features.pixel.ids.size&&/fbq\(\s*['"]init/.test(code)){node.tag='react:'+use('MetaPixel');node.props={ids:[...features.pixel.ids],events:[...new Set(features.pixel.events)]};node.children=[];pixelPlaced=true;continue;}
  // GSAP, rotação de classe e carrossel centralizado ficam na posição do script de origem.
  const stripped=flat(stripComments(normalize(code)));const placed=placeScripted(item=>stripped.includes(item.marker));
  if(placed.length){const parent=ref.parents[ref.parents.length-1];parent.children.splice(parent.children.indexOf(node),1,...placed);continue;}
  node.tag='react:remove';
 }
 // Regras vindas de arquivos .js locais: componentes no fim do body.
 body.children.push(...placeScripted(()=>true));
 const prune=(node:LegacyNode)=>{node.children=node.children.filter(child=>typeof child==='string'||child.tag!=='react:remove');for(const child of elements(node))prune(child);};prune(document);
 // Interações de clique (listeners e eventos inline).
 const named=(features as any).namedHandler as (name:string,self?:boolean)=>Handler|undefined;const claimUses=(features as any).claimUses as (h:Handler,r:string)=>void;
 const interactions=interactionsResolver(document,body,result,use,named,context.entry);
 for(const listener of features.listeners){
  const label=listener.targets.kind==='selector'?listener.targets.selector:'elemento';const triggers=interactions.resolve(listener.targets,body);
  if(triggers===undefined){result.pending.push({file:context.entry,line:0,message:'Seletor de clique não suportado: '+label});continue;}
  if(!triggers.length){if(listener.targets.kind==='selector'&&!listener.targets.all)result.decisions.push('Clique em '+label+' sem elemento nesta página; o código original falhava com TypeError e nada foi aplicado.');continue;}
  let ok=true;for(const trigger of triggers)ok=interactions.attach(trigger,listener.handler,label)&&ok;if(ok)result.migrated.push('Clique em '+label+' convertido em estado React.');
 }
 const handled=new Set<string>();
 walk(document,node=>{
  const raw=node.props['data-ppnet-events'];if(!raw)return;delete node.props['data-ppnet-events'];
  for(const [event,code] of Object.entries(JSON.parse(raw) as Record<string,string>)){
   const call=String(code).trim().replace(/;?\s*return\s+false;?$/,'').replace(/;$/,'').trim().replace(/^return\s+/,'');let match:RegExpMatchArray|null;
   if(event==='onclick'&&(match=call.match(/^(?:window\.)?([\w$]+)\(\s*(this)?\s*\)$/))){const handler=named(match[1],!!match[2]);if(handler){const own={...handler,preventDefault:handler.preventDefault||/return\s+false/.test(String(code))};if(interactions.attach(node,own,match[1]+'()')){handled.add(match[1]);const item=features.named.get(match[1]);if(item){claim(item.statement,'interação');claimUses(handler,'interação');}result.migrated.push('onclick="'+match[1]+'()" convertido em estado React.');}continue;}}
   if(event==='onclick'&&features.modal&&/^openModal\(\s*this\s*\)$/.test(call)){become(node,use('ZoomImage'),{});handled.add('openModal');continue;}
   if(features.phoneMask&&/^on(keyup|keydown|input|change)$/.test(event)&&call===features.phoneMask+'()'){become(node,use('PhoneMask'),{});handled.add('mascara');continue;}
   if(/^on(focus|click)$/.test(event)&&(match=call.match(/^([\w$]+)\(\s*\)$/))&&features.recaptcha.has(match[1])){handled.add('recaptcha');result.decisions.push('Evento '+event+'="'+match[1]+'()" de carregamento do reCAPTCHA dispensado: o ContactForm do template carrega a verificação.');continue;}
   const hover=/^onmouse(over|enter)$/.test(event)?'hoverStyle':/^onmouse(out|leave)$/.test(event)?'leaveStyle':undefined;const style=hover?styleAssignments(String(code)):undefined;
   if(hover&&style&&(!node.tag.startsWith('react:')||node.tag==='react:HoverStyle')){become(node,use('HoverStyle'),{[hover]:style});result.migrated.push(event+' com this.style convertido em componente React.');continue;}
   result.pending.push({file:context.entry,line:0,message:'Evento não migrado: '+event+'="'+snippet(String(code))+'" em <'+originalTag(node)+'>; removido.'});
  }
 });
 const keys:{key:string;actions:Resolved[]}[]=[];
 for(const item of features.keys){const resolved=interactions.flatten(item.handler,body);if(typeof resolved==='string'){if(resolved!=='guard')result.pending.push({file:context.entry,line:0,message:'Tecla '+item.key+' não migrada: '+resolved+'.'});continue;}keys.push({key:item.key,actions:resolved.actions});result.migrated.push('Tecla '+item.key+' convertida em estado React.');}
 if(interactions.used||keys.length)body.children=[{tag:'react:'+use('InteractionProvider'),props:keys.length?{keys}:{},children:body.children}];
 for(const statement of statements){if(statement.claimed==='modal?'&&handled.has('openModal'))statement.claimed='modal';if(statement.claimed==='mascara?'&&handled.has('mascara'))statement.claimed='mascara';if(statement.claimed==='recaptcha?')statement.claimed='recaptcha';}
 if(handled.has('mascara'))for(const statement of statements)if(/^function\s+(mascara|mtel)\s*\(/.test(statement.flat)||/^(?:const|let|var)\s+[\w$]+\s*=\s*document\.getElementById\(\s*['"]telefone['"]\s*\)$/.test(statement.flat))claim(statement,'mascara');
 // Abas.
 for(const tab of features.tabs){
  const triggers=selectAll(document,tab.triggers),panels=selectAll(document,tab.panels);
  if(!triggers?.length||!panels?.length){result.decisions.push('Abas '+tab.triggers+' sem elementos nesta página; nada a aplicar.');continue;}
  const all=[...triggers,...panels];let common=all[0].parents;for(const item of all){let i=0;while(i<common.length&&i<item.parents.length&&common[i]===item.parents[i])i++;common=common.slice(0,i);}
  const host=common[common.length-1];
  for(const item of triggers){const siblings=elements(item.parents[item.parents.length-1]);become(item.node,use('TabTrigger'),{index:siblings.indexOf(item.node),selectedClass:tab.selectedClass});}
  panels.forEach((item,index)=>become(item.node,use('TabPanel'),{index,duration:tab.duration}));
  if(host===body)body.children=[{tag:'react:'+use('TabsProvider'),props:{},children:body.children}];else wrap(host,use('TabsProvider'),{});
  result.migrated.push('Abas '+tab.triggers+' convertidas em componentes React.');
 }
 // Sliders por translateX: trilho e botões compartilham o índice no ancestral comum.
 for(const slider of features.sliders){
  const track=selectAll(document,slider.track)?.[0];if(!track){result.decisions.push('Slider '+slider.track+' sem elemento nesta página.');continue;}
  const total=slider.slides?selectAll(document,slider.slides)?.length??0:elements(track.node).length;const buttons=slider.buttons.map(b=>({b,found:selectAll(document,b.selector)?.[0]})).filter(x=>x.found);
  const all=[track,...buttons.map(x=>x.found!)];let common=all[0].parents;for(const item of all){let i=0;while(i<common.length&&i<item.parents.length&&common[i]===item.parents[i])i++;common=common.slice(0,i);}
  become(track.node,use('SlideTrack'),{});for(const {b,found} of buttons)become(found!.node,use('SlideButton'),{delta:b.delta});
  const host=common[common.length-1];const props={total,interval:slider.interval};
  if(host===body)body.children=[{tag:'react:'+use('SliderProvider'),props,children:body.children}];else wrap(host,use('SliderProvider'),props);
  result.migrated.push('Slider '+slider.track+' (translateX'+(slider.interval?', autoplay':'')+') convertido em componentes React.');
 }
 // Carrosséis.
 for(const carousel of features.carousels){
  const found=selectAll(document,carousel.selector);if(found===undefined){result.pending.push({file:context.entry,line:0,message:'Seletor de carrossel não suportado: '+carousel.selector});continue;}
  if(!found.length){result.decisions.push('Carrossel '+carousel.selector+' sem elementos nesta página; nada a aplicar.');continue;}
  for(const item of found)become(item.node,use('Carousel'),{options:carousel.options});
  result.migrated.push('Carrossel slick '+carousel.selector+' convertido em componente React.');
 }
 // Voltar ao topo.
 for(const [selector,options] of features.backToTop){const found=selectAll(document,selector);if(!found?.length){result.decisions.push('Botão '+selector+' sem elementos nesta página; nada a aplicar.');continue;}for(const item of found)become(item.node,use('BackToTop'),options);result.migrated.push('Botão '+selector+' (exibição por rolagem e volta ao topo) convertido em componente React.');}
 // Indicadores de progresso de rolagem (querySelector/getElementById: primeiro elemento).
 for(const progress of features.progress){const found=selectAll(document,progress.selector)?.[0];if(!found){result.decisions.push('Indicador '+progress.selector+' ausente; nada a aplicar.');continue;}const {selector,...props}=progress;become(found.node,use('ScrollProgress'),props);}
 // Classe por rolagem (topo fixo).
 for(const sticky of features.sticky){
  const found:LegacyNode[]|undefined=sticky.ref?interactions.resolve(sticky.ref,body):selectAll(document,sticky.selector!)?.map(f=>f.node);if(!found?.length)continue;
  const rule:Record<string,unknown>={className:sticky.className};for(const key of ['afterSelector','addAt','removeAt','minWidth'] as const)if(sticky[key]!==undefined)rule[key]=sticky[key];
  for(const node of (sticky.ref?.kind==='selector'&&!sticky.ref.all?found.slice(0,1):found)){if(node===body)continue;if(node.tag==='header')node.props.scrollClass=rule;else become(node,use('ScrollClass'),{scrollClass:rule});}result.components.add('ScrollClass');
 }
 // Revelação ao rolar.
 for(const reveal of features.reveals){let count=0;for(const ref of reveal.targets)for(const node of interactions.resolve(ref,body)||[]){become(node,use('Reveal'),{revealClass:reveal.className,ratio:reveal.ratio,removeOnExit:reveal.removeOnExit,once:reveal.once,options:reveal.options});count++;}if(!count)result.decisions.push('Revelação '+reveal.className+' sem elementos nesta página.');}
 // Bibliotecas com componente equivalente.
 if(features.scrollbars){body.children.unshift({tag:'react:'+use('CustomScrollbars'),props:{options:features.scrollbars},children:[]});const version=context.libraries.find(l=>l.name==='OverlayScrollbars')?.content.match(/Version:\s*(\d+\.\d+\.\d+)/)?.[1];result.dependencies.overlayscrollbars=version||'^2.4.6';}
 if(features.aos){body.children.unshift({tag:'react:'+use('AnimateOnScroll'),props:{options:features.aos},children:[]});const version=versions.AOS;result.dependencies.aos=version==='next'?'3.0.0-beta.6':version&&/^\d/.test(version)?version:'^2.3.4';}
 // Ajustes estáticos.
 if(features.lazyImages)walk(document,node=>{if(node.tag!=='img')return;if(!('loading' in node.props))node.props.loading='lazy';if(!('title' in node.props))node.props.title='Imagem';if(!('alt' in node.props))node.props.alt='Imagem';});
 for(const nav of features.activeNav){const links=selectAll(document,'.'+nav.className)||[];if(!links.length){result.decisions.push('Menu ativo .'+nav.className+' sem links nesta página; nada a aplicar.');continue;}const current=/^index\.(php|html?)$/i.test(path.posix.basename(context.entry))?'':path.posix.basename(context.entry);const add=(node:LegacyNode,on:boolean)=>{const list=classes(node).filter(c=>c!=='active');if(on)list.push('active');node.props.className=list.join(' ');};for(const link of links){const href=String(link.node.props.href||'').replace(/^\//,'');if(current&&href===current){add(links[0].node,false);add(link.node,true);}else if(!current)add(links[0].node,true);}result.migrated.push('Menu ativo .'+nav.className+' aplicado estaticamente por rota.');}
 // Formulários sem backend.
 walk(document,node=>{if(node.tag==='form'&&node.props['data-ppnet-unfinished-form']){delete node.props['data-ppnet-unfinished-form'];delete node.props.action;delete node.props.method;become(node,use('DisabledForm'),{message:context.formMessage||'Envio ainda não disponível nesta conversão. Entre em contato pelos canais exibidos no site.'});}});
 // URLs javascript: (ex.: href="javascript:void(0)") não são publicadas. Com clique migrado, viram "#" com preventDefault;
 // sem clique, o link original não fazia nada e perde o href.
 walk(document,node=>{
  for(const [name,value] of Object.entries(node.props)){
   if(typeof value!=='string'||!/^\s*javascript:/i.test(value))continue;
   const handlers=node.tag==='react:Interactive'?node.props.handlers as {preventDefault?:boolean}[]|undefined:undefined;
   if(name==='href'&&handlers?.length){node.props.href='#';for(const handler of handlers)handler.preventDefault=true;continue;}
   if(name==='href'&&/^\s*javascript:\s*(void\s*\(\s*0\s*\)|;)?\s*;?\s*$/i.test(value)){delete node.props.href;continue;}
   delete node.props[name];result.pending.push({file:context.entry,line:0,message:'URL JavaScript não migrada: '+name+'="'+snippet(value)+'" em <'+originalTag(node)+'>; removida.'});
  }
 });
 // Código restante. Cópias idênticas de instruções já migradas (script incluído duas vezes) seguem a original.
 const migratedText=new Set(statements.filter(s=>s.claimed&&!s.claimed.endsWith('?')).map(s=>s.flat));
 for(const statement of statements)if(!statement.claimed&&migratedText.has(statement.flat))statement.claimed='duplicado';
 const domText=attributeText(document);removeDeadCode(statements,domText,result);
 for(const statement of statements){if(statement.claimed?.endsWith('?'))statement.claimed=undefined;if(!statement.claimed)result.pending.push({file:statement.origin,line:0,message:'JavaScript sem regra de migração (não executado): '+snippet(statement.text),code:statement.text});}
 result.migrated=[...new Set(result.migrated)];result.decisions=[...new Set(result.decisions)];
 return result;
}

// ---------- fallback genérico ----------
// Página com JavaScript sem regra React: os scripts da origem rodam como no site, na ordem do documento (OriginalScripts),
// e os eventos inline voltam a ser atributos (document.write é capturado em tempo de execução).
// Bloqueia só padrão de código malicioso: payload ofuscado executado por eval/document.write e mineradores.
const unsafeCode=/\beval\s*\(\s*(?:window\.)?(?:atob|unescape|decodeURIComponent|String\.fromCharCode)\s*\(|\bdocument\.write(?:ln)?\s*\(\s*(?:unescape|atob)\s*\(|coinhive|cryptonight|coin-hive/i;
export async function originalScripts(document:LegacyNode,context:BehaviorContext,publish:(file:string,content:string)=>Promise<string>):Promise<BehaviorResult>{
 const result:BehaviorResult={pending:[],migrated:[],decisions:[],components:new Set(),dependencies:{}};
 const body=elements(document).find(node=>node.tag==='body');if(!body)return result;
 const refs:LegacyNode[]=[];walk(document,node=>{if(node.tag==='script'&&String(node.props.type||'').toLowerCase()!=='application/ld+json')refs.push(node);});
 const items:{src?:string;code?:string;type?:string;id?:string}[]=[];let events=0;
 // Strings 'pagina.php' de páginas do site viram a rota Next, como nos links do HTML.
 const routes=(code:string)=>code.replace(/(['"\x60])(?:\.\/|\/)?((?:[\w-]+\/)*[\w-]+)\.php(?=[?#'"\x60])/g,(match,quote,page)=>context.files.has(page+'.php')?quote+(page==='index'?'/':'/'+page.replace(/\/index$/,'')):match);
 // Include PHP buscado por AJAX ('/inc-midia/popup-aviso', 'ajax/x.php'): pré-renderizado e servido em /fragmentos/<nome>.
 const endpoints=async(code:string)=>{
  if(!context.endpoint)return code;const found=new Map<string,string>();
  for(const m of code.matchAll(/(['"\x60])((?:\.{0,2}\/)?(?:[\w-]+\/)*[\w-]+)(\.php)?(?=[?'"\x60])/g)){
   const clean=m[2].replace(/^(\.{0,2}\/)+/,''),file=m[3]?clean+'.php':clean+'.php';
   if(found.has(m[0])||!context.files.has(file)||context.pages?.has(file)||!/[\/.]/.test(m[2]+(m[3]||''))&&!m[3])continue;
   found.set(m[0],m[1]+await context.endpoint(file));
  }
  for(const [from,to] of found)code=code.split(from).join(to);return code;
 };
 const check=(code:string,where:string)=>{if(unsafeCode.test(code))result.pending.push({file:context.entry,line:0,message:'JavaScript com eval/new Function/document.write não executado ('+where+'): '+snippet(code)});};
 for(const node of refs){
  const type=typeof node.props.type==='string'&&!/^(text|application)\/javascript$/i.test(node.props.type)?node.props.type:undefined;
  const src=typeof node.props.src==='string'?node.props.src:undefined;const extra={...(type?{type}:{}),...(typeof node.props.id==='string'?{id:node.props.id}:{})};node.tag='react:remove';
  if(!src){const code=await endpoints(routes(node.children.join('')));check(code,'script inline');items.push({code,...extra});continue;}
  if(/^(https?:)?\/\//i.test(src)){items.push({src,...extra});continue;}
  const {file,library}=libraryFor(src);const content=context.files.has(file)?await context.readSource(file):undefined;
  if(content===undefined){result.decisions.push('Script local ausente já na origem: '+src+'.');continue;}
  check(content,file);
  items.push({src:await publish(file,await endpoints(routes(content))),...extra});
 }
 const prune=(node:LegacyNode)=>{node.children=node.children.filter(child=>typeof child==='string'||child.tag!=='react:remove');for(const child of elements(node))prune(child);};prune(document);
 walk(document,node=>{
  const raw=node.props['data-ppnet-events'];
  if(raw){delete node.props['data-ppnet-events'];for(const [event,code] of Object.entries(JSON.parse(raw) as Record<string,string>)){check(code,event);node.props['data-evento-'+event.toLowerCase()]=routes(code);events++;}}
  for(const [name,value] of Object.entries(node.props)){
   if(typeof value!=='string'||!/^\s*javascript:/i.test(value))continue;
   const code=decodeURIComponent(value.replace(/^\s*javascript:/i,'')).trim();
   if(name==='href'&&/^(void\s*\(\s*0\s*\)|;)?\s*;?$/i.test(code)){delete node.props.href;continue;}
   if(name==='href'){check(code,'href');node.props.href='#';node.props['data-evento-onclick']=(node.props['data-evento-onclick']?node.props['data-evento-onclick']+';':'')+code+';return false';events++;continue;}
   delete node.props[name];result.pending.push({file:context.entry,line:0,message:'URL JavaScript não migrada: '+name+'="'+snippet(value)+'" em <'+originalTag(node)+'>; removida.'});
  }
 });
 // Formulários sem backend continuam visíveis e sem envio, como nas páginas com regra.
 walk(document,node=>{if(node.tag==='form'&&node.props['data-ppnet-unfinished-form']){delete node.props['data-ppnet-unfinished-form'];delete node.props.action;delete node.props.method;result.components.add('DisabledForm');become(node,'DisabledForm',{message:context.formMessage||'Envio ainda não disponível nesta conversão. Entre em contato pelos canais exibidos no site.'});}});
 if(items.length||events){body.children.push({tag:'react:OriginalScripts',props:{items},children:[]});result.components.add('OriginalScripts');}
 result.decisions.push('JavaScript sem regra React executado como na origem: '+items.length+' script(s), '+events+' evento(s) inline.');
 return result;
}
