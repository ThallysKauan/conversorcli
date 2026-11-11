import {hasPlaceholder,placeholderCode} from '../../conversion/php/placeholders.ts';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {formatSource} from './format.ts';
import {createHash} from 'node:crypto';
import {jsxAttribute,jsxRaw,jsxText,tidyDocument,whitespaceRules} from './jsx.ts';
import {applyPlan,paramPattern,planVariants,templateKey,type VariantPlan} from './variants.ts';
import type {LegacyNode} from '../../validation/legacy.ts';
// Seções compartilhadas por projeto: conteúdo (hash) → nome legível e estável.
const sections=new Map<string,{names:Map<string,string>;used:Set<string>;written:Set<string>}>();
const reserved=new Set(['Topo','Rodape','ContactForm','Page','Layout','Script','Fragment','NotFound']);
const genericTags:Record<string,string>={header:'Cabecalho',footer:'RodapeSite',section:'Secao',div:'Bloco',main:'Principal',nav:'Navegacao',aside:'Lateral',article:'Artigo',ul:'Lista',form:'Formulario'};
function pascal(text:string){return text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').split(/[^A-Za-z0-9]+/).filter(Boolean).map(w=>w[0].toUpperCase()+w.slice(1)).join('');}
function ownName(node:LegacyNode){return [node.props.id,...String(node.props.className||'').split(/\s+/)].map(v=>pascal(String(v||''))).filter(v=>v.length>1)[0];}
function pageName(route:string){const name=route==='/'?'Home':pascal(route);return /^\d/.test(name)?'Pagina'+name:name;}
function sectionBase(node:LegacyNode,route:string){
 if(node.tag==='react:InteractionProvider')return pageName(route)+'Conteudo';
 const tag=node.tag.startsWith('react:')?String(node.props.as||'div'):node.tag;
 // Sem id/classe próprios: usa o primeiro descendente identificado (até 3 níveis) ou o nome da página.
 let base=ownName(node);
 if(!base){let level=node.children.filter((c):c is LegacyNode=>typeof c!=='string');for(let depth=0;depth<3&&!base&&level.length;depth++){for(const child of level){base=ownName(child);if(base)break;}level=level.flatMap(c=>c.children.filter((x):x is LegacyNode=>typeof x!=='string'));}}
 if(!base)base=(route==='/'?'Home':pascal(route))+(genericTags[tag]||pascal(tag)||'Bloco');
 if(/^\d/.test(base))base='Secao'+base;if(reserved.has(base)||/^[A-Z][a-z]+$/.test(base)&&base.length<3)base+='Secao';
 return base;
}

export async function loadRules() {
 const rules=JSON.parse(await readFile(new URL('../../../rules/next-company/mappings.json',import.meta.url),'utf8'));
 for(const key of ['pages','header','footer','siteSettings','catalogData','globalStyles','assets','contactForm','contactValidation','emailHandler']) {
  const value=rules.mappings?.[key];
  if(typeof value!=='string'||!value||value.includes('\\')||value.split('/').some((p:string)=>!p||p==='.'||p==='..')||path.isAbsolute(value)||value.includes(':')) throw new Error('Caminho inválido na regra: '+key);
 }
 // Next serves static resources only from public.
 if(rules.mappings.assets!=='public')throw new Error('A regra assets precisa apontar para public no Next.js.');
 if(!rules.mappings.pages.startsWith('src/app/'))throw new Error('A regra pages precisa ficar em src/app.');
 for(const key of ['header','footer','siteSettings','catalogData','globalStyles','contactForm','contactValidation','emailHandler'])if(!rules.mappings[key].startsWith('src/'))throw new Error('A regra '+key+' precisa ficar em src/.');
 if(rules.conversion?.forms&&!['omit','disabled','template'].includes(rules.conversion.forms))throw new Error('Regra forms inválida.');
 if(rules.conversion?.formMarkup&&!['original','template'].includes(rules.conversion.formMarkup))throw new Error('Regra formMarkup inválida.');
 const sectionsPath=rules.mappings.sections??'src/components/Secoes';if(typeof sectionsPath!=='string'||!sectionsPath.startsWith('src/')||sectionsPath.split('/').some((p:string)=>!p||p==='.'||p==='..'))throw new Error('Caminho inválido na regra: sections');
 return rules as {version:string;mappings:Record<string,string>;conversion?:{forms?:'omit'|'disabled'|'template';formMarkup?:'original'|'template';omitIncludes?:string[];keywordConfig?:string;thirdPartyScripts?:{host:string;name:string}[];strict?:boolean;legacyRedirects?:boolean}};
}
export type Rules=Awaited<ReturnType<typeof loadRules>>;
export interface NativePage {route:string;desktop:LegacyNode;mobile:LegacyNode;status:number}
export interface SiteOptions {centralSettings?:boolean;settingsRefs?:Record<string,string>;siteUrl?:string;redirects?:{source:string;destination:string;permanent:boolean}[];stylesheets?:string[]}

const child=(node:LegacyNode,tag:string)=>node.children.find((n):n is LegacyNode=>typeof n!=='string'&&n.tag===tag);
const headOf=(doc:LegacyNode)=>(child(doc,'head')?.children||[]).filter((n):n is LegacyNode=>typeof n!=='string');
const text=(node:LegacyNode)=>node.children.filter((c):c is string=>typeof c==='string').join('').trim();
const key=(node:LegacyNode)=>JSON.stringify(node);
// Metas e títulos viram a API metadata do Next; o restante do head vira JSX.
function isMetadata(node:LegacyNode){
 if(node.tag==='title')return true;
 if(node.tag==='meta')return !node.props.httpEquiv||/^x-ua-compatible$/i.test(String(node.props.httpEquiv));
 return node.tag==='link'&&/^canonical$/i.test(String(node.props.rel||''));
}
/** Constrói o objeto metadata do Next a partir do head da página. */
export function metadataFrom(head:LegacyNode[]){
 const meta:Record<string,any>={};const og:Record<string,any>={};const twitter:Record<string,any>={};const other:Record<string,string|string[]>={};
 const add=(target:Record<string,any>,name:string,value:string)=>{target[name]=target[name]===undefined?value:[...[target[name]].flat(),value];};
 for(const node of head){
  if(node.tag==='title'){meta.title=text(node);continue;}
  if(node.tag==='link'){if(/^canonical$/i.test(String(node.props.rel||'')))meta.alternates={canonical:String(node.props.href)};continue;}
  if(node.tag!=='meta'||node.props.charSet!==undefined||node.props.httpEquiv!==undefined)continue;
  const name=String(node.props.name??node.props.property??'');const content=node.props.content===undefined?undefined:String(node.props.content);if(!name||content===undefined||name==='viewport')continue;
  if(name==='description'||name==='keywords'||name==='robots'){meta[name]=content;continue;}
  let m:RegExpMatchArray|null;
  if((m=name.match(/^og:(title|description|url|site_name|locale|type)$/))){og[{site_name:'siteName'}[m[1]]||m[1]]=content;continue;}
  if(name==='og:image'){add(og,'images',content);continue;}
  if((m=name.match(/^article:(published_time|modified_time|section|tag)$/))){const k={published_time:'publishedTime',modified_time:'modifiedTime',section:'section',tag:'tags'}[m[1]]!;if(k==='tags')og.tags=[...(og.tags||[]),content];else og[k]=content;continue;}
  if((m=name.match(/^twitter:(card|title|description|image)$/))){if(m[1]==='image')add(twitter,'images',content);else twitter[m[1]]=content;continue;}
  add(other,name,content);
 }
 if(og.type&&!['article','website','profile','book'].includes(og.type)){other['og:type']=og.type;delete og.type;}
 if(og.type!=='article')for(const k of ['publishedTime','modifiedTime','section','tags'])if(og[k]!==undefined){other['article:'+{publishedTime:'published_time',modifiedTime:'modified_time',section:'section',tags:'tag'}[k]]=og[k];delete og[k];}
 if(Object.keys(og).length)meta.openGraph=og;if(Object.keys(twitter).length)meta.twitter=twitter;if(Object.keys(other).length)meta.other=other;
 return meta;
}

const knownTags=new Set('a abbr address area article aside audio b base bdi bdo big blockquote body br button canvas caption center cite code col colgroup data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure font footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe img input ins kbd keygen label legend li link main map mark menu menuitem meta meter nav noindex noscript object ol optgroup option output p param picture pre progress q rp rt ruby s samp script search section select slot small source span strong style sub summary sup table template tbody td textarea tfoot th thead time title tr track u ul var video wbr webview svg animate animateMotion animateTransform circle clipPath defs desc ellipse feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feImage feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence filter foreignObject g image line linearGradient marker mask metadata mpath path pattern polygon polyline radialGradient rect set stop switch symbol text textPath tspan use view'.split(' '));
const large=(node:LegacyNode)=>JSON.stringify(node).length>8192;
const styleTexts=(node:LegacyNode):string[]=>node.children.flatMap(c=>typeof c==='string'?[]:c.tag==='style'?[c.children.join('')]:styleTexts(c));
export async function writeNativeSite(project:string,sourcePages:NativePage[],rules:Rules,options:SiteOptions={}){
 const spacing=whitespaceRules([...(options.stylesheets||[]),...sourcePages.flatMap(p=>[...styleTexts(p.desktop),...styleTexts(p.mobile)])]);
 const pages=sourcePages.map(p=>({...p,desktop:tidyDocument(p.desktop,spacing),mobile:tidyDocument(p.mobile,spacing)}));
 const alias=(file:string)=>'@/'+file.replace(/^src\//,'').replace(/\.[^.]+$/,'');
 // Variáveis PHP sem valor impressas na página: o marcador vira leitura de settings.variaveis.
 // date() impresso usa phpDate na requisição; o layout revalida a cada hora para páginas estáticas não congelarem a data.
 let usesDate=false;
 const put=async(file:string,content:string)=>{
  if(hasPlaceholder(content)){
   content=placeholderCode(content);
   if(content.includes('settings.variaveis')&&!/import \{settings[,}]/.test(content))content='import {settings} from '+JSON.stringify(alias(rules.mappings.siteSettings))+';\n'+content;
   if(content.includes('phpDate(')){usesDate=true;content='import {phpDate} from '+JSON.stringify(alias(path.posix.dirname(rules.mappings.siteSettings)+'/date.ts'))+';\n'+content;}
  }
  if(file==='src/app/layout.tsx'&&usesDate)content+='\nexport const revalidate=3600;\n';
  await mkdir(path.dirname(path.join(project,file)),{recursive:true});await writeFile(path.join(project,file),await formatSource(file,content));
 };
 const voids=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
 const formImport=rules.conversion?.forms==='template'?'import ContactForm from '+JSON.stringify(alias(rules.mappings.contactForm))+';\n':'';
 const settingsImport=options.centralSettings?'import {settings,url} from '+JSON.stringify(alias(rules.mappings.siteSettings))+';\n':'';
 // Cada arquivo importa só o que usa: settings/url, Topo e Rodape.
 const partials=(code:string)=>{
  const settingsNames=options.centralSettings?[/\bsettings\./.test(code)&&'settings',/(?<![\w."'\/-])url(?![\w"'\/:-])/.test(code)&&'url'].filter(Boolean):[];
  return (settingsNames.length?'import {'+settingsNames.join(',')+'} from '+JSON.stringify(alias(rules.mappings.siteSettings))+';\n':'')+(code.includes('<Topo')?'import Topo from '+JSON.stringify(alias(rules.mappings.header))+';\n':'')+(code.includes('<Rodape')?'import Rodape from '+JSON.stringify(alias(rules.mappings.footer))+';\n':'');
 };
 const sectionDir=rules.mappings.sections||'src/components/Secoes';
 const registry=sections.get(project)||{names:new Map(),used:new Set(['Topo','Rodape','ContactForm']),written:new Set()};sections.set(project,registry);
 // Nomes das funções de página (MapaSitePage...) não podem ser reaproveitados por seções.
 for(const page of pages)registry.used.add(pageName(page.route)+'Page');
 const imports=(names:Set<string>)=>[...names].map(name=>name.startsWith('behaviors/')?'import '+name.slice(10)+' from "@/components/'+name+'";':name==='ContactForm'?'':'import '+name+' from '+JSON.stringify(alias(sectionDir+'/'+name))+';').filter(Boolean).join('\n');
 const header=(names:Set<string>,code:string)=>(names.has('ContactForm')?formImport:'')+partials(code)+imports(names)+'\n';
 const blocks=new Map<string,string>();const unknownTags=new Set<string>();let variant='',route='/';let variants=new Map<string,VariantPlan>();
 // Trechos grandes viram seções nomeadas pelo id/classe; conteúdos iguais reaproveitam o mesmo componente.
 function sectionName(node:LegacyNode,id=JSON.stringify(node)){
  const hash=createHash('sha256').update(id).digest('hex');let name=registry.names.get(hash);if(name)return name;
  const base=sectionBase(node,route);name=base;
  if(registry.used.has(name)&&variant)name=base+variant;
  for(let i=2;registry.used.has(name);i++)name=base+(variant||'')+i;
  registry.used.add(name);registry.names.set(hash,name);return name;
 }
 function jsx(node:LegacyNode|string,used:Set<string>,inline=false):string {
  if(typeof node!=='string'&&!inline&&large(node)){
   const plan=variants.get(templateKey(node));
   if(plan){
    // Variantes que só mudam em alguns textos: um componente, os textos viram props.
    const name=sectionName(node,'variantes:'+plan.key);used.add(name);const {template,values}=applyPlan(node,plan);const names=plan.params.map(p=>p.name);
    if(!blocks.has(name)&&!registry.written.has(name)){const nested=new Set<string>();const content=jsx(template,nested,true).replace(paramPattern,(_,i)=>'{'+names[Number(i)]+'}');blocks.set(name,header(nested,content)+'export default function '+name+'({'+names.join(',')+'}:{'+names.map(n=>n+':string').join(';')+'}){return '+content+';}\n');}
    return '<'+name+values.map((value,i)=>' '+names[i]+'='+(options.settingsRefs?.[value]?'{'+options.settingsRefs[value]+'}':jsxAttribute(value))).join('')+' />';
   }
   const name=sectionName(node);used.add(name);if(!blocks.has(name)&&!registry.written.has(name)){const nested=new Set<string>();const content=jsx(node,nested,true);blocks.set(name,header(nested,content)+'export default function '+name+'(){return '+content+';}\n');}return '<'+name+' />';
  }
  if(typeof node==='string')return options.settingsRefs?.[node]?'{'+options.settingsRefs[node]+'}':jsxText(node);
  const behavior=node.tag.match(/^react:([A-Z][A-Za-z0-9]*)$/)?.[1];if(behavior)used.add('behaviors/'+behavior);
  if(node.tag==='contact-form')used.add('ContactForm');
  const tag=behavior||(node.tag==='contact-form'?'ContactForm':node.tag==='header'?'Topo':node.tag==='footer'?'Rodape':node.tag);
  if(!behavior&&!/^[a-z][a-zA-Z0-9-]*$/.test(node.tag))throw new Error('Tag não suportada em TSX: '+node.tag);
  // Garantia: nenhum JavaScript da origem chega ao projeto (só dados JSON-LD).
  if(node.tag==='script'&&String(node.props.type||'').toLowerCase()!=='application/ld+json')throw new Error('Script da origem chegou à saída sem migração.');
  for(const [name,value] of Object.entries(node.props)){if(/^on[A-Z]/.test(name)&&typeof value==='string')throw new Error('Evento inline da origem chegou à saída: '+name);if(typeof value==='string'&&/^\s*javascript:/i.test(value))throw new Error('URL javascript: da origem chegou à saída ('+name+').');}
  const props=Object.entries(node.props).map(([name,value])=>{
   // Quebras de linha entre classes são só separadores: "\n\t\trolado\n\t" vira "rolado".
   if(name==='className'&&typeof value==='string')value=value.replace(/[ \t\n\r\f]+/g,' ').trim();
   if(!/^[A-Za-z_][A-Za-z0-9_:-]*$/.test(name))return ' {...'+JSON.stringify({[name]:value})+' as const}';
   if(value===true)return ' '+name;
   if(typeof value==='string'&&!options.settingsRefs?.[value])return ' '+name+'='+jsxAttribute(value);
   return ' '+name+'={'+(typeof value==='string'&&options.settingsRefs?.[value]||JSON.stringify(value))+(value!==null&&typeof value==='object'?' as const':'')+'}';
  }).join('');
  if(!behavior&&!knownTags.has(tag)&&!['Topo','Rodape','ContactForm'].includes(tag))unknownTags.add(tag);
  if(voids.has(tag))return '<'+tag+props+' />';
  if(tag==='script'){const raw=node.children.join('');let data:unknown;try{data=JSON.parse(raw);}catch{return '<script'+props+' dangerouslySetInnerHTML={{__html:'+jsxRaw(raw)+'.replace(/</g,"\\\\u003c")}} />';}return '<script'+props+' dangerouslySetInnerHTML={{__html:JSON.stringify('+JSON.stringify(data)+').replace(/</g,"\\\\u003c")}} />';}
  if(tag==='style')return '<'+tag+props+' dangerouslySetInnerHTML={{__html:'+jsxRaw(node.children.join(''))+'}} />';
  return '<'+tag+props+'>'+node.children.map(c=>jsx(c,used)).join('')+'</'+tag+'>';
 }
 // Head: o que é igual em todas as páginas e variantes fica no layout; o restante, no topo da página.
 const extras=(doc:LegacyNode)=>headOf(doc).filter(n=>!isMetadata(n)&&!(n.tag==='meta'&&(n.props.charSet!==undefined||n.props.name==='viewport')));
 const docs=pages.flatMap(p=>[p.desktop,p.mobile]);const counts=new Map<string,number>();
 for(const doc of docs)for(const k of new Set(extras(doc).map(key)))counts.set(k,(counts.get(k)||0)+1);
 const shared=new Set([...counts].filter(([,n])=>n===docs.length).map(([k])=>k));
 const own=(doc:LegacyNode)=>extras(doc).filter(n=>!shared.has(key(n)));
 // Todas as seções que viram componente, de todas as páginas: base para juntar variantes.
 const candidates:LegacyNode[]=[];const collect=(node:LegacyNode,top:boolean)=>{if(!top&&large(node))candidates.push(node);for(const c of node.children)if(typeof c!=='string')collect(c,false);};
 for(const doc of pages.flatMap(p=>[p.desktop,p.mobile])){for(const n of own(doc))collect(n,true);for(const c of child(doc,'body')?.children||[])if(typeof c!=='string')collect(c,false);}
 variants=planVariants(candidates,large);
 const layoutUsed=new Set<string>();const first=pages[0]?.desktop;
 const sharedNodes=first?extras(first).filter(n=>shared.has(key(n))):[];
 const headJsx=sharedNodes.filter(n=>!n.tag.startsWith('react:')).map(n=>jsx(n,layoutUsed,true)).join('');
 const bodyStart=sharedNodes.filter(n=>n.tag.startsWith('react:')).map(n=>jsx(n,layoutUsed,true)).join('');
 // O topo aceita a regra de topo fixo gerada a partir do script da origem.
 await put(rules.mappings.header,'import type {ComponentProps} from "react";\nimport ScrollClass from "@/components/behaviors/ScrollClass";\ntype Props=ComponentProps<"header">&{scrollClass?:{className:string;afterSelector?:string;addAt?:number;removeAt?:number;minWidth?:number}};\nexport default function Topo({scrollClass,...props}:Props){return scrollClass?<ScrollClass as="header" scrollClass={scrollClass} {...props} />:<header {...props} />;}\n');
 await put(rules.mappings.footer,'import type {ComponentProps} from "react";\nexport default function Rodape(props:ComponentProps<"footer">){return <footer {...props} />;}\n');
 const content=(doc:LegacyNode,used:Set<string>)=>{const body=child(doc,'body');return '<>'+[...own(doc).map(n=>jsx(n,used,true)),...(body?.children||[]).map(c=>jsx(c,used))].join('')+'</>';};
 const notFound=pages.find(p=>p.status===404);
 const catalog:{route:string;title:string}[]=[];
 for(const page of pages){
  route=page.route;const used=new Set<string>();
  variant='';const desktopJsx=content(page.desktop,used);variant='Mobile';const mobileJsx=content(page.mobile,used);variant='';
  const metadata=metadataFrom(headOf(page.desktop));catalog.push({route:page.route,title:String(metadata.title||'')});
  // Mesma marcação desktop/mobile da origem: a variante é escolhida pelo User-Agent no servidor.
  const choose=desktopJsx===mobileJsx?'return '+desktopJsx+';':'const mobile=/Android|iPhone|iPad|iPod|Mobile/i.test((await headers())'+'.get("user-agent")||"");return mobile?'+mobileJsx+':'+desktopJsx+';';
  const headerImports=desktopJsx===mobileJsx?'':'import {headers} from "next/headers";\n';
  // Pasta com _ inicial é privada no App Router: %5F gera a URL /_x igual à da origem.
  const file=path.posix.join(rules.mappings.pages,page.route.slice(1).split('/').map(segment=>segment.startsWith('_')?'%5F'+segment.slice(1):segment).join('/'),'page.tsx');
  // Página de erro: renderizada normalmente (HTML no servidor) e respondida com 404 pelo middleware;
  // o not-found.tsx do Next reaproveita a mesma página para URLs inexistentes.
  if(page===notFound)await put('src/app/not-found.tsx','import Page,{metadata} from '+JSON.stringify('./'+path.posix.relative('src/app',file).replace(/\.tsx$/,''))+';\nexport {metadata};\nexport default Page;\n');
  await put(file,header(used,choose)+'import type {Metadata} from "next";\n'+headerImports+'export const metadata:Metadata='+JSON.stringify(metadata)+';\n// Rota: '+page.route+'\nexport default async function '+pageName(page.route)+'Page(){'+choose+'}\n');
 }
 for(const [name,code] of blocks)if(!registry.written.has(name)){await put(sectionDir+'/'+name+'.tsx',code);registry.written.add(name);}
 const htmlProps=first?first.props:{lang:'pt-BR'};const bodyProps=first?child(first,'body')?.props||{}:{};
 const base=options.siteUrl&&!options.siteUrl.endsWith('.invalid')?'export const metadata:Metadata={metadataBase:new URL('+(options.centralSettings?'url':JSON.stringify(options.siteUrl))+')};\n':'';
 await put('src/app/layout.tsx','import type {ReactNode} from "react";\nimport type {Metadata} from "next";\nimport "@/styles/globals.scss";\n'+settingsImport+imports(layoutUsed)+'\n'+base+'export default function Layout({children}:{children:ReactNode}){return <html {...'+JSON.stringify(htmlProps)+' as const}><head>'+headJsx+'</head><body {...'+JSON.stringify(bodyProps)+' as const}>'+bodyStart+'{children}</body></html>;}\n');
 const errorRoutes=pages.filter(p=>p.status===404).map(p=>p.route);
 if(errorRoutes.length)await put('src/middleware.ts','import {NextResponse} from "next/server";\n// Páginas de erro da origem respondem com status 404.\nexport function middleware(){return NextResponse.next({status:404});}\nexport const config={matcher:'+JSON.stringify(errorRoutes)+'};\n');
 // Tags que o navegador aceita mas o React não declara (custom elements, <h> da origem): declaradas para o TypeScript.
 if(unknownTags.size)await put('src/types/elementos-origem.d.ts','import "react";\n// Elementos da origem fora do HTML/SVG padrão: o navegador os renderiza como elementos genéricos.\ndeclare module "react" {\n  namespace JSX {\n    interface IntrinsicElements {\n'+[...unknownTags].sort().map(t=>'      '+JSON.stringify(t)+': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & Record<string, unknown>;').join('\n')+'\n    }\n  }\n}\n');
 await put('next.config.ts','import type {NextConfig} from "next";\nconst config:NextConfig={'+(options.redirects?.length?'async redirects(){return '+JSON.stringify(options.redirects)+';}':'')+'};\nexport default config;\n');
 await put(rules.mappings.catalogData,'export default '+JSON.stringify(catalog,null,1)+' as const;\n');
}
/** Compatível com chamadas por página: gera a rota e o layout a partir dela. */
export async function writeNativePage(project:string,route:string,desktop:LegacyNode,mobile:LegacyNode,rules:Rules){await writeNativeSite(project,[{route,desktop,mobile,status:200}],rules);}
