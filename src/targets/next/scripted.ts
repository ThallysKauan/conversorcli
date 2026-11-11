import {objectLiteral} from '../../conversion/js/statements.ts';
// Regras para scripts que manipulam o DOM por seletor: GSAP/ScrollTrigger, rotação de classe por intervalo
// e carrossel centralizado com classes ativo/anterior/próximo. Cada regra exige a forma exata do código original.
interface Statement {text:string;flat:string;origin:string;claimed?:string}
export interface Tween {method:'to'|'from'|'set'|'fromTo';selector:string;vars:Record<string,unknown>;fromVars?:Record<string,unknown>}
export interface Rotator {selector:string;className:string;interval:number}
export interface CenteredCarousel {slides:string;prev:string;next:string;container:string;track:string;classes:{active:string;prev:string;next:string};gap:number;iframeQuery?:string}
export interface ScriptedRules {tweens:{tween:Tween;marker:string}[];rotators:{rule:Rotator;marker:string}[];carousels:{rule:CenteredCarousel;marker:string}[]}

const I='([\\w$]+)',Q='[\'"]',S='([^\'"]+)';
const esc=(text:string)=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
// Remove espaços fora de strings (exceto entre palavras) e ";" antes de "}": formas equivalentes ficam iguais.
export function compact(code:string){
 let out='',i=0;
 while(i<code.length){
  const c=code[i];
  if(c==='"'||c==="'"){let j=i+1;while(j<code.length&&code[j]!==c){if(code[j]==='\\')j++;j++;}out+=code.slice(i,j+1);i=j+1;continue;}
  if(/\s/.test(c)){while(/\s/.test(code[i]||''))i++;if(/[\w$]$/.test(out)&&/^[\w$]/.test(code[i]||''))out+=' ';continue;}
  out+=c;i++;
 }
 return out.replace(/;+(?=\})/g,'').replace(/;$/,'');
}
function claim(statement:Statement|undefined,reason:string){if(statement&&!statement.claimed)statement.claimed=reason;}
// Última declaração de `name` antes da posição: const x = document.querySelector(All)('sel').
function element(statements:Statement[],before:number,name:string,all:boolean){
 const pattern=new RegExp('^(?:const|let|var) '+esc(name)+'=document\\.querySelector'+(all?'All':'')+'\\('+Q+S+Q+'\\)$');
 for(let i=before-1;i>=0;i--){const m=compact(statements[i].text).match(pattern);if(m)return {statement:statements[i],selector:m[1]};if(new RegExp('^(?:const|let|var) '+esc(name)+'=').test(compact(statements[i].text)))return undefined;}
 return undefined;
}
function find(statements:Statement[],from:number,pattern:RegExp){for(let i=from;i<statements.length;i++)if(!statements[i].claimed&&pattern.test(compact(statements[i].text)))return statements[i];return undefined;}

export function applyScriptedRules(statements:Statement[]):ScriptedRules{
 const rules:ScriptedRules={tweens:[],rotators:[],carousels:[]};
 // GSAP: gsap.to/from/set(".sel", {...}) e gsap.fromTo(".sel", {...}, {...}) com objetos literais; registerPlugin(ScrollTrigger).
 const tweens:{statement:Statement;tween:Tween}[]=[];let plugin:Statement|undefined;
 for(const statement of statements){
  if(statement.claimed)continue;const text=compact(statement.text);let m:RegExpMatchArray|null;
  if(/^gsap\.registerPlugin\(ScrollTrigger\)$/.test(text)){plugin=statement;continue;}
  if((m=text.match(new RegExp('^gsap\\.(to|from|set|fromTo)\\('+Q+S+Q+',(\\{[\\s\\S]*\\})\\)$')))){
   try{
    const method=m[1] as Tween['method'];let tween:Tween;
    if(method==='fromTo'){const parts=splitObjects(m[3]);if(parts.length!==2)continue;tween={method,selector:m[2],fromVars:objectLiteral(parts[0]),vars:objectLiteral(parts[1])};}
    else tween={method,selector:m[2],vars:objectLiteral(m[3])};
    tweens.push({statement,tween});
   }catch{}
  }
 }
 if(tweens.length){claim(plugin,'gsap');for(const {statement,tween} of tweens){claim(statement,'gsap');rules.tweens.push({tween,marker:statement.flat});}}
 // Rotação de classe: function f(){ L[i].classList.remove('c'); i = (i + 1) % L.length; L[i].classList.add('c') } + setInterval(f, N).
 statements.forEach((statement,index)=>{
  if(statement.claimed)return;
  const m=compact(statement.text).match(new RegExp('^function '+I+'\\(\\)\\{'+I+'\\['+I+'\\]\\.classList\\.remove\\('+Q+'([\\w-]+)'+Q+'\\);\\3=\\(\\3\\+1\\)%\\2\\.length;\\2\\[\\3\\]\\.classList\\.add\\('+Q+'\\4'+Q+'\\)\\}$'));if(!m)return;
  const [ ,name,list,current,className]=m;const items=element(statements,index,list,true);
  const counter=statements.slice(0,index).reverse().find(s=>new RegExp('^(?:let|var) '+esc(current)+'=0$').test(compact(s.text)));
  const timer=find(statements,index+1,new RegExp('^setInterval\\((?:'+esc(name)+'|\\(\\)=>\\{?'+esc(name)+'\\(\\)\\}?),(\\d+)\\)$'));
  if(!items||!counter||!timer)return;
  for(const s of [statement,items.statement,counter,timer])claim(s,'rotacao');
  rules.rotators.push({rule:{selector:items.selector,className,interval:Number(compact(timer.text).match(/,(\d+)\)$/)![1])},marker:timer.flat});
 });
 // Carrossel centralizado: classes ativo/anterior/próximo, iframe com data-src no ativo e trilho em translateX.
 statements.forEach((statement,index)=>{
  if(statement.claimed)return;
  const iframe='(?:const (?<fr>[\\w$]+)=\\k<el>\\.querySelector\\('+Q+'iframe'+Q+'\\);if\\(\\k<fr>\\)\\{\\k<fr>\\.src='+Q+Q+'\\})?';
  const activeFrame='(?:;if\\(\\k<fr>\\)\\{const (?<base>[\\w$]+)=\\k<fr>\\.getAttribute\\('+Q+'data-src'+Q+'\\);\\k<fr>\\.src=`\\$\\{\\k<base>\\}(?<query>[^`$]*)`\\})?';
  const pattern=new RegExp('^function (?<fn>[\\w$]+)\\(\\)\\{(?<list>[\\w$]+)\\.forEach\\(\\((?<el>[\\w$]+),(?<i>[\\w$]+)\\)=>\\{\\k<el>\\.classList\\.remove\\('+Q+'(?<active>[\\w-]+)'+Q+','+Q+'(?<prev>[\\w-]+)'+Q+','+Q+'(?<next>[\\w-]+)'+Q+'\\);'
   +iframe+'if\\(\\k<i>===(?<idx>[\\w$]+)\\)\\{\\k<el>\\.classList\\.add\\('+Q+'\\k<active>'+Q+'\\)'+activeFrame
   +'\\}else if\\(\\k<i>===\\(\\k<idx>-1\\+(?<total>[\\w$]+)\\)%\\k<total>\\)\\{\\k<el>\\.classList\\.add\\('+Q+'\\k<prev>'+Q+'\\)\\}else if\\(\\k<i>===\\(\\k<idx>\\+1\\)%\\k<total>\\)\\{\\k<el>\\.classList\\.add\\('+Q+'\\k<next>'+Q+'\\)\\}\\}\\);'
   +'const (?<w>[\\w$]+)=\\k<list>\\[0\\]\\.offsetWidth\\+(?<gap>\\d+);const (?<c>[\\w$]+)=document\\.querySelector\\('+Q+'(?<container>[^\'"]+)'+Q+'\\);const (?<cw>[\\w$]+)=\\k<c>\\.offsetWidth;(?:let|const|var) (?<off>[\\w$]+)=\\(\\k<cw>-\\k<w>\\)/2;const (?<u>[\\w$]+)=document\\.querySelector\\('+Q+'(?<track>[^\'"]+)'+Q+'\\);\\k<u>\\.style\\.transform=`translateX\\(\\$\\{-\\k<idx>\\*\\k<w>\\+\\k<off>\\}px\\)`\\}$');
  const g=compact(statement.text).match(pattern)?.groups;if(!g)return;
  const slides=element(statements,index,g.list,true);
  const counter=statements.slice(0,index).reverse().find(s=>new RegExp('^(?:let|var) '+esc(g.idx)+'=0$').test(compact(s.text)));
  const total=statements.slice(0,index).reverse().find(s=>new RegExp('^(?:const|let|var) '+esc(g.total)+'='+esc(g.list)+'\\.length$').test(compact(s.text)));
  const step=(delta:string)=>new RegExp('^'+I+'\\.addEventListener\\('+Q+'click'+Q+',(?:\\(\\)|function\\(\\))(?:=>)?\\{'+esc(g.idx)+'=\\('+esc(g.idx)+(delta==='-'?'-1\\+'+esc(g.total):'\\+1')+'\\)%'+esc(g.total)+';'+esc(g.fn)+'\\(\\)\\}\\)$');
  const prevStatement=find(statements,index+1,step('-')),nextStatement=find(statements,index+1,step('+'));
  const prev=prevStatement&&element(statements,index,compact(prevStatement.text).match(step('-'))![1],false),next=nextStatement&&element(statements,index,compact(nextStatement.text).match(step('+'))![1],false);
  const resize=find(statements,index+1,new RegExp('^window\\.addEventListener\\('+Q+'resize'+Q+','+esc(g.fn)+'\\)$'));
  const call=find(statements,index+1,new RegExp('^'+esc(g.fn)+'\\(\\)$'));
  if(!slides||!counter||!total||!prev||!next||!call||!g.fr!==(g.query===undefined))return;
  for(const s of [statement,slides.statement,counter,total,prevStatement,nextStatement,prev.statement,next.statement,resize,call])claim(s,'carrossel-centralizado');
  rules.carousels.push({rule:{slides:slides.selector,prev:prev.selector,next:next.selector,container:g.container,track:g.track,classes:{active:g.active,prev:g.prev,next:g.next},gap:Number(g.gap),...(g.fr&&g.query!==undefined?{iframeQuery:g.query}:{})},marker:statement.flat});
 });
 return rules;
}
// "{a},{b}" → ["{a}","{b}"] respeitando aninhamento e strings.
function splitObjects(text:string){
 const out:string[]=[];let depth=0,start=0,quote='';
 for(let i=0;i<text.length;i++){const c=text[i];if(quote){if(c==='\\')i++;else if(c===quote)quote='';continue;}if(c==='"'||c==="'")quote=c;else if(c==='{'||c==='[')depth++;else if(c==='}'||c===']')depth--;else if(c===','&&depth===0){out.push(text.slice(start,i));start=i+1;}}
 out.push(text.slice(start));return out.map(s=>s.trim()).filter(Boolean);
}
// Eventos inline só com this.style.prop = 'valor' (ex.: onmouseover/onmouseout) → estilos aplicados pelo componente HoverStyle.
export function styleAssignments(code:string){
 const parts=compact(code.trim()).split(';').filter(Boolean);if(!parts.length)return undefined;const style:Record<string,string>={};
 for(const part of parts){const m=part.match(/^this\.style\.([a-zA-Z]+)=(['"])([^'"]*)\2$/);if(!m)return undefined;style[m[1]]=m[3];}
 return style;
}
