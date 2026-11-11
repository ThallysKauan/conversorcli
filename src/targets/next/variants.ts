import type {LegacyNode} from '../../validation/legacy.ts';
// Seções grandes que só mudam em poucos textos (o título com o nome da página, um link) viram um componente só,
// com esses textos como props: <ProdutosRelacionados titulo="..." /> em vez de ProdutosRelacionados2, 3, 4...
type Path=(number|string)[];
interface Leaf {path:Path;value:string;kind:'text'|'prop';name:string;tag:string}
export interface Param {path:Path;name:string;prefix:string;suffix:string}
export interface VariantPlan {key:string;params:Param[]}
const maxParams=3;
export const paramMark=(index:number)=>''+index+'';
export const paramPattern=/\{"(\d+)"\}/g;

/** Estrutura da seção sem os textos: seções com a mesma chave diferem só em texto e atributos de texto. */
export function templateKey(node:LegacyNode):string{
 const blank=(n:LegacyNode):unknown=>({tag:n.tag,props:Object.fromEntries(Object.entries(n.props).map(([k,v])=>[k,typeof v==='string'?'':v])),children:n.children.map(c=>typeof c==='string'?'':blank(c))});
 return JSON.stringify(blank(node));
}
function leaves(node:LegacyNode,path:Path=[]):Leaf[]{
 const own:Leaf[]=Object.entries(node.props).filter(([,v])=>typeof v==='string').map(([name,value])=>({path:[...path,'p',name],value,kind:'prop' as const,name,tag:node.tag}));
 return [...own,...node.children.flatMap((c,i)=>typeof c==='string'?[{path:[...path,'c',i],value:c,kind:'text' as const,name:'',tag:node.tag}]:leaves(c,[...path,'c',i]))];
}
const propNames:Record<string,string>={href:'link',src:'imagem',alt:'descricaoImagem',title:'dica',className:'classe'};
function paramName(leaf:Leaf,taken:Set<string>){
 const base=leaf.kind==='prop'?propNames[leaf.name]||leaf.name.replace(/[^A-Za-z0-9]/g,''):/^h[1-6]$|^title$/.test(leaf.tag)?'titulo':'texto';
 let name=base;for(let i=2;taken.has(name);i++)name=base+i;taken.add(name);return name;
}
// Parte comum no começo e no fim, cortada em espaço: "Outros assuntos relacionados a " + {titulo}.
function common(values:string[]){
 let prefix=values.reduce((p,v)=>{let i=0;while(i<p.length&&i<v.length&&p[i]===v[i])i++;return p.slice(0,i);});
 prefix=prefix.slice(0,prefix.lastIndexOf(' ')+1);
 const rest=values.map(v=>v.slice(prefix.length));
 let suffix=rest.reduce((s,v)=>{let i=0;while(i<s.length&&i<v.length&&s[s.length-1-i]===v[v.length-1-i])i++;return s.slice(s.length-i);});
 suffix=suffix.slice(suffix.indexOf(' ')<0?suffix.length:suffix.indexOf(' '));
 return {prefix,suffix};
}
const at=(node:LegacyNode,path:Path)=>{let n:any=node;for(let i=0;i<path.length;i+=2)n=path[i]==='c'?n.children[path[i+1]]:n.props[path[i+1]];return n;};
/** Agrupa as seções candidatas; cada grupo com variantes que mudam em até 3 textos ganha props. */
export function planVariants(candidates:LegacyNode[],isLarge:(node:LegacyNode)=>boolean){
 const groups=new Map<string,Map<string,LegacyNode>>();
 for(const node of candidates){const key=templateKey(node);const group=groups.get(key)||new Map();group.set(JSON.stringify(node),node);groups.set(key,group);}
 const plans=new Map<string,VariantPlan>();
 for(const [key,group] of groups){
  const nodes=[...group.values()];if(nodes.length<2)continue;
  const all=nodes.map(n=>leaves(n));
  const differing=all[0].map((leaf,i)=>({leaf,values:all.map(l=>l[i].value)})).filter(d=>new Set(d.values).size>1);
  if(!differing.length||differing.length>maxParams)continue;
  // Texto de script/style não vira prop; texto dentro de outra seção grande ficaria preso nela.
  const insideLarge=(path:Path)=>{for(let j=2;j<=path.length-2;j+=2)if(isLarge(at(nodes[0],path.slice(0,j))))return true;return false;};
  if(differing.some(({leaf})=>['script','style'].includes(leaf.tag)||insideLarge(leaf.path)))continue;
  const taken=new Set<string>();
  plans.set(key,{key,params:differing.map(({leaf,values})=>({path:leaf.path,name:paramName(leaf,taken),...(leaf.kind==='text'?common(values):{prefix:'',suffix:''})}))});
 }
 return plans;
}
/** Troca os textos variáveis por marcadores (o código vira {titulo}) e devolve os valores desta variante. */
export function applyPlan(node:LegacyNode,plan:VariantPlan){
 const template=structuredClone(node);const values:string[]=[];
 // Do fim para o começo: dividir um texto em três filhos não desloca os caminhos que ainda faltam.
 const compare=(a:Path,b:Path)=>{for(let i=0;i<Math.min(a.length,b.length);i++)if(a[i]!==b[i])return typeof a[i]==='number'&&typeof b[i]==='number'?(a[i] as number)-(b[i] as number):String(a[i]).localeCompare(String(b[i]));return a.length-b.length;};
 const order=plan.params.map((_,i)=>i).sort((a,b)=>compare(plan.params[b].path,plan.params[a].path));
 for(const i of order){
  const {path,prefix,suffix}=plan.params[i];const parent=at(template,path.slice(0,-2)) as LegacyNode;const slot=path[path.length-1];
  if(path[path.length-2]==='p'){values[i]=parent.props[slot];parent.props[slot]=paramMark(i);continue;}
  const text=parent.children[slot as number] as string;values[i]=text.slice(prefix.length,text.length-suffix.length);
  parent.children.splice(slot as number,1,...[prefix,paramMark(i),suffix].filter(Boolean));
 }
 return {template,values};
}
