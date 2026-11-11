import type {LegacyNode} from '../../validation/legacy.ts';

// Reescreve referências às páginas da origem (x.php, /x.php, https://dominio/x.php) para as rotas Next.
export function routeFor(entry:string){
 // Extensão repetida (x.php.php, erro de digitação em links) também sai: a rota nunca carrega .php.
 const segments=entry.replace(/(\.(php|html?))+$/i,'').split('/');if(segments.at(-1)?.toLowerCase()==='index')segments.pop();
 if(segments.some(s=>!/^[\p{L}\p{N}_.-]+$/u.test(s)||/^\.+$/.test(s)))throw new Error('Nome de rota ainda não suportado.');
 return '/'+segments.join('/');
}
const host=(value:string)=>value.toLowerCase().replace(/^www\./,'');
const pageFile=/\.(php|html?)$/i;

export function rewriteLinks(doc:LegacyNode,entry:string,routes:Map<string,string>,siteUrl:string,excluded:Set<string>,sources:Set<string>=new Set(),apps:string[]=[]){
 const unresolved=new Set<string>(),linked=new Set<string>(),missing=new Set<string>();const origin=new URL(siteUrl);
 const resolve=(value:string,navigation=false):string|undefined=>{
  // Só valores com forma de URL: código em eventos (popup('https://.../sharer.php')) não é link para PHP local.
  const raw=value.trim();if(!raw||/^(mailto:|tel:|data:|#|javascript:)/i.test(raw)||/[\s'"()<>{}]/.test(raw))return undefined;
  let url:URL;try{url=new URL(raw,origin.origin+'/'+entry);}catch{return undefined;}
  if(!/^https?:$/.test(url.protocol)||host(url.hostname)!==host(origin.hostname))return undefined;
  let file=url.pathname.replace(/\/{2,}/g,'/').replace(/^\/+/,'');try{file=decodeURI(file);}catch{}
  // CMS mantido no domínio original (blog em WordPress): link e imagem absolutos, qualquer que seja a extensão.
  if(apps.some(root=>file===root||file.startsWith(root+'/')))return origin.origin+url.pathname+url.search+url.hash;
  if(!pageFile.test(file))return undefined;
  if(excluded.has(file))return undefined;
  const route=routes.get(file.toLowerCase());
  if(route===undefined){
   // Página inexistente na origem: o link já estava quebrado; vira a rota equivalente (404 também no Next).
   if(!sources.has(file.toLowerCase())){try{const target=routeFor(file);missing.add(file);linked.add(target);return (!navigation&&/^https?:/i.test(raw)?origin.origin:'')+target+url.search+url.hash;}catch{}}
   if(/\.php$/i.test(file))unresolved.add(raw);return undefined;
  }
  // URLs absolutas (canonical, og:url, JSON-LD) continuam absolutas no domínio do site.
  linked.add(route);return (!navigation&&/^https?:/i.test(raw)?origin.origin:'')+route+url.search+url.hash;
 };
 // URLs absolutas do próprio site embutidas em texto (JSON-LD) ou em outros links (validador?uri=https://site/x.php).
 const embedded=(value:string)=>value.replace(/https?:\/\/[^\s"'<>&?#]+?\.(?:php|html?)(?=[\s"'<>&?#]|$)/gi,m=>resolve(m)??m);
 const visit=(node:LegacyNode)=>{
  for(const [name,value] of Object.entries(node.props)){if(typeof value!=='string')continue;if(/(href|src|action|content|url)$/i.test(name)||pageFile.test(value.split(/[?#]/)[0])){const next=resolve(value,(node.tag==='a'||node.props.as==='a')&&name==='href');if(next!==undefined){node.props[name]=next;continue;}}if(/https?:\/\//i.test(value))node.props[name]=embedded(value);}
  if(node.tag==='script'&&String(node.props.type||'').toLowerCase()==='application/ld+json')node.children=node.children.map(c=>typeof c!=='string'?c:embedded(c));
  for(const c of node.children)if(typeof c!=='string')visit(c);
 };
 visit(doc);
 return {unresolved:[...unresolved],linked:[...linked],missing:[...missing]};
}
