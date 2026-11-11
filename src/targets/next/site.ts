import {mkdir,readFile,writeFile,copyFile,realpath,unlink,readdir} from 'node:fs/promises';
import path from 'node:path';
import {localSource,inventory} from '../../sources/index.ts';
import {discover} from '../../analysis/discovery.ts';
import {detectSiteUrl} from '../../analysis/domain.ts';
import {embeddedApps} from '../../analysis/embedded.ts';
import {renderExtended} from '../../conversion/php/extended.ts';
import {fillPlaceholders,placeholderNames} from '../../conversion/php/placeholders.ts';
import {legacyDocument} from '../../validation/legacy.ts';
import {migrateBehaviors,libraryCatalog,originalScripts} from './behaviors.ts';
import {createHash} from 'node:crypto';
import {createTemplate} from '../../templates/create.ts';
import {writeContactTemplate} from './forms.ts';
import {loadRules,writeNativeSite} from './rules.ts';
import type {NativePage} from './rules.ts';
import {rewriteLinks,routeFor} from './links.ts';
import {formatProject} from './format.ts';
import {publicSettings,settingReferences,prepareSiteMap,writeSiteStructure} from './structure.ts';
export interface Part {source:string;status:'converted'|'partial'|'unfinished'|'fragment';route?:string;httpStatus?:number;id?:string;reason?:string;dependencies?:string[];notices?:any[];behaviors?:{migrated:string[];decisions:string[]}}
// copyAssets:false serve para levantamentos em massa (sem copiar imagens/CSS para public).
export async function convertSite(input:string,destination:string,onProgress:(s:string)=>void=()=>{},options:{copyAssets?:boolean;siteUrl?:string}={}){
 const rules=await loadRules();
 const source=await localSource(input),parent=await realpath(path.dirname(path.resolve(destination))),out=path.join(parent,path.basename(destination));
 const relative=path.relative(source,out);if(!relative||(!relative.startsWith('..')&&!path.isAbsolute(relative)))throw new Error('A saída precisa ficar fora da pasta de origem.');
 // CMS numa subpasta (blog em WordPress...) fica fora da conversão; os links para ele seguem para o domínio original.
 const allFiles=await inventory(source),apps=embeddedApps(allFiles),appRoots=apps.map(app=>app.root);
 const files=allFiles.filter(file=>!appRoots.some(root=>file.startsWith(root+'/'))),fileSet=new Set(files),discovery=await discover(source,files,['omit','template'].includes(rules.conversion?.forms||'')?rules.conversion?.omitIncludes:[],rules.conversion?.keywordConfig),entries=discovery.entries;
 const excludedPages=new Set(discovery.excludedSources.filter(item=>item.reason.includes('dataString')).map(item=>item.source));
 if(!entries.length)throw new Error('Nenhuma página PHP ou HTML encontrada.');
 const detected=options.siteUrl?{url:options.siteUrl,source:'--url'}:await detectSiteUrl(source,files,rules.conversion?.keywordConfig);let siteUrl=detected?.url||'https://example.invalid';
 try{await mkdir(out);}catch(error:any){if(error.code==='EEXIST')throw new Error('A pasta de saída já existe. Escolha uma pasta nova.');throw error;}
 const project=await createTemplate(path.join(out,'project'));
 // O projeto recebe o nome do site de origem, não o do conversor.
 const packageName=(path.basename(source).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')||'site')+'-next';
 for(const file of ['package.json','package-lock.json']){const target=path.join(project,file);try{const data=JSON.parse(await readFile(target,'utf8'));data.name=packageName;if(data.packages?.[''])data.packages[''].name=packageName;await writeFile(target,JSON.stringify(data,null,2)+'\n');}catch{}}await unlink(path.join(project,'src/app/(paginas)/page.tsx'));if(rules.conversion?.forms==='template')await writeContactTemplate(project,rules);
 // Documentos de referência para a validação HTTP ficam fora do projeto.
 await mkdir(path.join(out,'reference'),{recursive:true});
 let sourceSettings:Record<string,string>={};let configVariables:Record<string,string|number|boolean>={};const textVariables=new Set<string>();let configSeen=false;
 const native:(NativePage&{entry:string;part:Part})[]=[];
 const sourcesLower=new Set(files.map(f=>f.toLowerCase()));const routes=new Map<string,string>();for(const entry of entries){try{routes.set(entry.toLowerCase(),routeFor(entry));}catch{}}
 const components=new Set<string>(['ScrollClass']),dependencies:Record<string,string>={};
 const libraries=await Promise.all(files.filter(file=>libraryCatalog.some(item=>item.file.test(file))).map(async file=>({file,name:libraryCatalog.find(item=>item.file.test(file))!.name,content:await readFile(path.join(source,file),'utf8')})));
 // Includes PHP buscados por AJAX pelo JavaScript da origem: renderizados em GET e em POST (ajax=true) e servidos em /fragmentos/<nome>.
 const fragments=new Map<string,{slug:string;get:string;post:string}>();
 const endpoint=async(file:string)=>{
  let item=fragments.get(file);
  if(!item){
   const base=path.posix.basename(file,'.php').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'')||'fragmento';
   const used=new Set([...fragments.values()].map(f=>f.slug));let slug=base;for(let i=2;used.has(slug);i++)slug=base+'-'+i;
   const render=async(post?:Record<string,string>)=>{try{return (await renderExtended(source,file,{siteUrl,post,configFile:rules.conversion?.keywordConfig})).html;}catch{return '';}};
   item={slug,get:await render(),post:await render({ajax:'true'})};fragments.set(file,item);
  }
  return '/fragmentos/'+item.slug;
 };
 const pageSet=new Set(entries);
 const behaviorContext=(entry:string)=>({pages:pageSet,endpoint,entry,files:fileSet,libraries,thirdPartyHosts:(rules.conversion?.thirdPartyScripts||[]).map(item=>item.host),readSource:async(file:string)=>{try{return await readFile(path.join(source,file),'utf8');}catch{return undefined;}}});
 const parts:Part[]=[],assets:string[]=[],assetFailures:any[]=[],published=new Set<string>();
 const report={version:5,siteUrlSource:detected?.source||'não identificado',rules:{version:rules.version,applied:Object.fromEntries(Object.entries(rules.mappings).filter(([key])=>['pages','header','footer','siteSettings','catalogData','assets',...(rules.conversion?.forms==='template'?['contactForm','contactValidation','emailHandler']:[])].includes(key))),pending:['omit','template'].includes(rules.conversion?.forms||'')?['globalStyles']:['contactForm','contactValidation','emailHandler','globalStyles'],excluded:rules.conversion?.forms==='omit'?['contactForm','contactValidation','emailHandler']:[]},formConversion:{mode:rules.conversion?.forms||'disabled',markup:rules.conversion?.formMarkup||'original',smtp:'not-tested',configuration:'requires-env'},source,destination:out,siteUrl,status:'incomplete',geminiUsed:false,behaviorMigration:{runtime:'react',components:[] as string[],dependencies,pending:0},parts,assets,assetFailures,auxiliary:discovery.auxiliary,excludedSources:discovery.excludedSources,dependencyIssues:discovery.dependencyIssues,blockers:[] as {reason:string;count:number;files:string[]}[],checks:{build:'not-run',visual:'not-run',behavior:'not-run'},summary:{converted:0,partial:0,generated:0,unfinished:0,fragments:0},limitations:['As páginas parciais não garantem equivalência completa.','Formulários reconhecidos mantêm a marcação original (formMarkup) e enviam pela API do template; configurar SMTP/reCAPTCHA e validar entrega. Formulários desconhecidos permanecem bloqueados.','Scripts da origem não são executados: interações reconhecidas viram componentes React; o restante consta como pendência.','GET materializado por página; datas, ordenação aleatória e detecção móvel precisam de revisão.']};
 async function checkpoint(){report.summary={converted:parts.filter(p=>p.status==='converted').length,partial:parts.filter(p=>p.status==='partial').length,generated:parts.filter(p=>p.status==='converted'||p.status==='partial').length,unfinished:parts.filter(p=>p.status==='unfinished').length,fragments:parts.filter(p=>p.status==='fragment').length};const groups=new Map<string,{reason:string;count:number;files:string[]}>();for(const part of parts){if(part.status==='fragment')continue;const reasons=new Set([...(part.reason?[part.reason]:[]),...(part.notices||[]).map(n=>n.message)]);for(const reason of reasons){const group=groups.get(reason)||{reason,count:0,files:[] as string[]};group.count++;group.files.push(part.source);groups.set(reason,group);}}report.blockers=[...groups.values()].sort((a,b)=>b.count-a.count);await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));}
 await checkpoint();onProgress(entries.length+' candidatas; '+discovery.auxiliary.length+' auxiliares. URL de referência: '+siteUrl);
 // Arquivos .js locais executados como na origem: servidos de public/scripts, um por conteúdo.
 const publishedScripts=new Map<string,string>();const pageRedirects:{source:string;destination:string;permanent:boolean}[]=[];
 const publishScript=async(file:string,content:string)=>{const hash=createHash('sha256').update(content).digest('hex').slice(0,10);let url=publishedScripts.get(hash);if(!url){url='/scripts/'+hash+'-'+path.posix.basename(file).replace(/[^\w.-]/g,'_');const target=path.join(project,'public',url);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,content);publishedScripts.set(hash,url);}return url;};
 // A index e as páginas da raiz vêm primeiro: são as mais importantes e não dependem das subpastas.
 const depth=(entry:string)=>entry.split('/').length;const isHome=(entry:string)=>/^index\.(php|html?)$/i.test(entry)?0:1;
 entries.sort((a,b)=>isHome(a)-isHome(b)||depth(a)-depth(b)||(a<b?-1:a>b?1:0));
 for(const app of apps){discovery.excludedSources.push({source:app.root+'/',reason:'Instalação '+app.name+' (depende de banco de dados): não convertida; os links seguem para o domínio original.'});}
 for(const [index,entry] of entries.entries()){
  if(index===0||(index+1)%20===0||index===entries.length-1)onProgress('['+(index+1)+'/'+entries.length+'] '+entry);
  try{
   const desktop=/\.php$/i.test(entry)?await renderExtended(source,entry,{siteUrl,omitIncludes:['omit','template'].includes(rules.conversion?.forms||'')?rules.conversion?.omitIncludes:[],configFile:rules.conversion?.keywordConfig}):{html:await readFile(path.join(source,entry),'utf8'),dependencies:[entry],notices:[],settings:{},responseStatus:200,variables:{} as Record<string,string|number|boolean>,undefinedVariables:[] as string[],redirect:undefined as string|undefined};
   // header('Location: ...'): a URL antiga vira redirecionamento do Next, não página.
   if(desktop.redirect){
    let destination=desktop.redirect;try{const target=new URL(destination,siteUrl+'/'+entry);if(target.host===new URL(siteUrl).host){const file=target.pathname.replace(/^\/+/,'');destination=(routes.get(file.toLowerCase())??(/\.php$/i.test(file)?'/'+file.replace(/\.php$/i,'').replace(/(^|\/)index$/,''):target.pathname))+target.search+target.hash||'/';}else destination=target.href;}catch{}
    pageRedirects.push({source:routeFor(entry),destination,permanent:desktop.responseStatus===301||desktop.responseStatus===308});
    parts.push({source:entry,status:'fragment',reason:'Redirecionamento para '+destination+' (next.config).'});await checkpoint();continue;
   }
   if(!/<(?:!doctype\s+html|html|head|body)(?:\s|>)/i.test(desktop.html)){
    // Sem saída e com erro: a página falhou. Trecho HTML (include solto) é fragmento mesmo com avisos.
    if(!desktop.html.trim()&&desktop.notices.length)throw new Error(desktop.notices.map(n=>n.message).join('; '));
    parts.push({source:entry,status:'fragment',reason:'Trecho auxiliar sem documento HTML.'});await checkpoint();continue;
   }
   const mobile=/\.php$/i.test(entry)?await renderExtended(source,entry,{siteUrl,mobile:true,omitIncludes:['omit','template'].includes(rules.conversion?.forms||'')?rules.conversion?.omitIncludes:[],configFile:rules.conversion?.keywordConfig}):desktop;
   const convert=(html:string)=>legacyDocument(html,entry,fileSet,siteUrl,{forms:rules.conversion?.forms,formMarkup:rules.conversion?.formMarkup,excludedPages});
   let converted=convert(desktop.html),convertedMobile=convert(mobile.html);
   const route=routeFor(entry);if(published.has(route))throw new Error('Conflito de rota: '+route);
   let behavior=await migrateBehaviors(converted.document,behaviorContext(entry)),behaviorMobile=await migrateBehaviors(convertedMobile.document,behaviorContext(entry));
   // JavaScript sem regra React (qualquer biblioteca ou código próprio): a página roda os scripts da origem como no site.
   if(behavior.pending.length||behaviorMobile.pending.length){
    const fallback=convert(desktop.html),fallbackMobile=convert(mobile.html);
    const original=await originalScripts(fallback.document,behaviorContext(entry),publishScript),originalMobile=await originalScripts(fallbackMobile.document,behaviorContext(entry),publishScript);
    if(!original.pending.length&&!originalMobile.pending.length){converted=fallback;convertedMobile=fallbackMobile;original.decisions.push(...[...new Set([...behavior.pending,...behaviorMobile.pending].map(n=>'Sem regra React (executado como na origem): '+n.message))]);behavior=original;behaviorMobile=originalMobile;}
    else{behavior.pending.push(...original.pending);behaviorMobile.pending.push(...originalMobile.pending);}
   }
   // Modo estrito: página com comportamento não migrado (ex.: código malicioso bloqueado) não é publicada.
   if(rules.conversion?.strict!==false){
    const blocking=[...new Set([...behavior.pending,...behaviorMobile.pending].map(n=>n.file+': '+n.message))];
    if(blocking.length)throw new Error('Página não publicada: funcionalidade não migrada 100%.\n'+[...new Set(blocking)].join('\n'));
   }
   // Formulário sem backend possível (login/senha) fica visível e sem envio: a página é publicada como parcial.
   if([behavior,behaviorMobile].some(result=>result.components.has('DisabledForm')))behavior.pending.push({file:entry,line:0,message:'Formulário sem backend migrado (login/senha): visível, sem envio.'});
   // Links para páginas da origem viram rotas Next; referência a PHP sem página equivalente bloqueia a publicação.
   const links=[rewriteLinks(converted.document,entry,routes,siteUrl,excludedPages,sourcesLower,appRoots),rewriteLinks(convertedMobile.document,entry,routes,siteUrl,excludedPages,sourcesLower,appRoots)];
   const unresolved=[...new Set(links.flatMap(l=>l.unresolved))];
   if(unresolved.length&&rules.conversion?.strict!==false)throw new Error('Página não publicada: referência a PHP sem página Next equivalente.\n'+unresolved.join('\n'));
   for(const result of [behavior,behaviorMobile]){for(const name of result.components)components.add(name);Object.assign(dependencies,result.dependencies);}
   const id='page-'+String(index+1).padStart(4,'0');// Avisos sobre minificar texto JS não se aplicam: nenhum script da origem é publicado.
   const scriptOnly=(n:{message:string})=>/^Minificação .*JavaScript/.test(n.message);if([...desktop.notices,...mobile.notices].some(scriptOnly))behavior.decisions.push('Minificação PHP de JavaScript ignorada: o código foi migrado para componentes React e não é publicado.');
   const notices=[...desktop.notices.filter(n=>!scriptOnly(n)),...mobile.notices.filter(n=>!scriptOnly(n)),...[...converted.warnings,...convertedMobile.warnings].map(message=>({file:entry,line:0,message})),...behavior.pending,...behaviorMobile.pending].filter((n,i,a)=>a.findIndex(v=>JSON.stringify(v)===JSON.stringify(n))===i);
   for(const file of new Set(links.flatMap(l=>l.missing)))notices.push({file:entry,line:0,message:'Link para página inexistente já na origem ('+file+'): mantido como rota Next, responde 404.'});
   if(siteUrl==='https://example.invalid')notices.push({file:entry,line:0,message:'Domínio não identificado (sem sitemap, canonical ou email da empresa): informe com --url https://www.dominio.com.br ou ajuste NEXT_PUBLIC_SITE_URL no .env.'});
   // Mesmo comportamento do site no ar (a origem também falha, repara ou faz igual): decisão registrada, sem deixar a página parcial.
   const faithful=/^(Biblioteca Mobile_Detect substituída|Mobile_Detect adaptado|Valor aleatório fixado|Ordenação aleatória fixada|Include ausente|JSON-LD inválido na origem mantido|HTML da origem reparado pelo parser|Tag inválida na origem|Sessão PHP não migrada|Função inexistente na origem|Variável PHP sem valor em URL|Link para página inexistente já na origem|Data PHP materializada)/;
   for(let i=notices.length-1;i>=0;i--)if(faithful.test(notices[i].message)){behavior.decisions.push(notices[i].file+': '+notices[i].message);notices.splice(i,1);}
   if(route==='/mapa-site'){prepareSiteMap(converted.document);prepareSiteMap(convertedMobile.document);}
   // Variáveis sem valor: impressas → settings.variaveis (valor da configuração ou placeholder); em condições → null, como no PHP.
   // Configuração do site: só variáveis com o mesmo valor em todas as páginas (h1, nomePagina... variam por página).
   if(!configSeen){configVariables={...desktop.variables};configSeen=true;}else for(const name of Object.keys(configVariables))if(desktop.variables[name]!==configVariables[name])delete configVariables[name];
   const printed=placeholderNames(desktop.html+mobile.html);for(const name of printed)textVariables.add(name);
   const nulls=[...new Set([...desktop.undefinedVariables,...mobile.undefinedVariables])].filter(name=>!printed.includes(name));
   if(printed.length)behavior.decisions.push('Variáveis PHP sem valor impressas na página ligadas a settings.variaveis: '+printed.map(n=>'$'+n).join(', ')+'.');
   if(nulls.length)behavior.decisions.push('Variáveis PHP sem valor usadas como condição valem null, como no PHP: '+nulls.map(n=>'$'+n).join(', ')+'.');
   await writeFile(path.join(out,'reference',id+'.desktop.json'),fillPlaceholders(JSON.stringify(converted.document),desktop.variables));
   if(![200,404].includes(desktop.responseStatus))notices.push({file:entry,line:0,message:'Status HTTP '+desktop.responseStatus+' da origem não reproduzido: a rota Next responde 200.'});
   published.add(route);if(route==='/'||!Object.keys(sourceSettings).length)sourceSettings=desktop.settings;
   const part:Part={source:entry,status:notices.length?'partial':'converted',route,httpStatus:desktop.responseStatus===404?404:200,id,dependencies:desktop.dependencies,notices,behaviors:{migrated:[...new Set([...behavior.migrated,...behaviorMobile.migrated])],decisions:[...new Set([...behavior.decisions,...behaviorMobile.decisions])]}};parts.push(part);native.push({entry,part,route,desktop:converted.document,mobile:convertedMobile.document,status:part.httpStatus!});(part as any).links=[...new Set(links.flatMap(l=>l.linked))];report.behaviorMigration.pending+=behavior.pending.length+behaviorMobile.pending.length;
   if(notices.length){const warning=path.join(out,'pendencias',entry+'(parcial).txt');await mkdir(path.dirname(warning),{recursive:true});await writeFile(warning,'Página gerada parcialmente: '+route+'\n'+notices.map(n=>n.file+':'+n.line+' '+n.message).join('\n'));}
  }catch(error){const reason=error instanceof Error?error.message:String(error);parts.push({source:entry,status:'unfinished',reason});const warning=path.join(out,'inacabados',entry+'(inacabado).txt');await mkdir(path.dirname(warning),{recursive:true});await writeFile(warning,reason);onProgress('  Não gerada: '+entry+' — '+reason);}
  await checkpoint();
 }
 for(const entry of options.copyAssets===false?[]:files.filter(f=>/\.(css|png|jpe?g|webp|gif|ico|svg|woff2?|ttf|otf|eot|avif|mp4|webm|pdf)$/i.test(f))){try{const dest=path.join(project,'public',entry);await mkdir(path.dirname(dest),{recursive:true});await copyFile(path.join(source,entry),dest);assets.push(entry);}catch(error){assetFailures.push({source:entry,reason:String(error)});}}
 // Arquivo citado no CSS que falta nesse caminho mas existe com o mesmo nome em outra pasta (a cópia do site nem sempre traz tudo que está no servidor):
 // copiado para o caminho esperado, resolvido a partir do CSS e da raiz, já que CSS impresso no <style> resolve pela página.
 if(options.copyAssets!==false){
  const byName=new Map<string,string>();for(const file of files)if(/\.(png|jpe?g|webp|gif|svg|ico|woff2?|ttf|otf|eot)$/i.test(file)&&!byName.has(path.posix.basename(file).toLowerCase()))byName.set(path.posix.basename(file).toLowerCase(),file);
  const restored=new Set<string>();
  for(const css of files.filter(f=>/\.css$/i.test(f))){
   let text='';try{text=await readFile(path.join(source,css),'utf8');}catch{continue;}
   for(const m of text.matchAll(/url\(\s*['"]?([^'")?#]+)[^)]*\)/gi)){
    const value=m[1].trim();if(/^(data:|https?:|\/\/)/i.test(value))continue;
    const found=byName.get(path.posix.basename(value).toLowerCase());if(!found)continue;
    const targets=[...new Set([path.posix.normalize(path.posix.join(path.posix.dirname(css),value)),path.posix.normalize(value)].map(t=>t.replace(/^(\.\.\/)+|^\/+/,'')))];
    // Já existe por um dos dois caminhos: nada a restaurar.
    if(targets.some(target=>fileSet.has(target)))continue;
    for(const target of targets)
     if(!restored.has(target)&&!target.startsWith('..')){try{const dest=path.join(project,'public',target);await mkdir(path.dirname(dest),{recursive:true});await copyFile(path.join(source,found),dest);restored.add(target);}catch{}}
   }
  }
  (report as any).restoredAssets=[...restored];
 }
 await writeBehaviors(project,components,dependencies);report.behaviorMigration.components=[...components].sort();
 // Redirecionamentos das URLs antigas só existem se a regra pedir; por padrão o projeto não referencia arquivos PHP.
 const redirects=[...pageRedirects,...(rules.conversion?.legacyRedirects?native.map(p=>({source:'/'+p.entry,destination:p.route,permanent:true})).filter(r=>r.source!==r.destination):[])];
 (report as any).legacyRedirects=redirects;
 const settings=publicSettings(sourceSettings,siteUrl);
 // dataString é a lista de frases-chave lida pelo conversor; links "pagina.php" viram a rota Next, como no HTML.
 delete configVariables.dataString;
 // Caminhos das pastas internas do PHP (pastaInc = "inc-midia/") não são configuração do site Next.
 for(const [name,value] of Object.entries(configVariables))if(typeof value==='string'&&/(^|\/)(inc|js|ajax|css)-midia\b|^(inc|includes?|libraries|vendor)\/?$/i.test(value))delete configVariables[name];
 for(const [name,value] of Object.entries(configVariables)){
  if(typeof value!=='string'||!/\.php\b/i.test(value))continue;
  const page=value.match(/^(?:\.?\/)?((?:[\w-]+\/)*[\w-]+)\.php$/)?.[1];
  if(page)configVariables[name]=page==='index'?'/':'/'+page.replace(/\/index$/,'');else delete configVariables[name];
 }
 const variables={values:configVariables,missing:[...textVariables].filter(name=>!Object.hasOwn(configVariables,name)).sort()};
 (report as any).phpVariables={settings:rules.mappings.siteSettings,fromConfig:Object.keys(configVariables).length,placeholder:variables.missing};
 const stylesheets=await Promise.all(files.filter(f=>/\.css$/i.test(f)).map(f=>readFile(path.join(source,f),'utf8').catch(()=>'')));
 await writeNativeSite(project,native,rules,{siteUrl,redirects,settingsRefs:settingReferences(settings,configVariables),centralSettings:true,stylesheets});
 const structure=await writeSiteStructure(project,native,rules,settings,variables);
 if(fragments.size){
  // O include referenciado pela própria URL antiga (botão curtir/compartilhar) passa a apontar para a rota do fragmento.
  const self=(value:string)=>{for(const [file,f] of fragments){const name=file.replace(/\.php$/i,'').replace(/[.*+?^$(){}|[\]\\]/g,'\\$&');value=value.replace(new RegExp('(https?://[^"\'\\s/]+)?/?'+name+'(\\.php)?(?=["\'?#\\s])','g'),(_m,host)=>(host?siteUrl:'')+'/fragmentos/'+f.slug);}return value;};
  const html=(value:string)=>self(fillPlaceholders(value,configVariables)).replace(/(href|action|src)=(["'])(?!https?:|\/\/|#|mailto:|tel:)([^"']+?)\.php(?=[?#"'])/gi,(match,attr,quote,page)=>{const route=routes.get((String(page).replace(/^\.?\//,'')+'.php').toLowerCase());return route===undefined?match:attr+'='+quote+route;});
  const data=Object.fromEntries([...fragments.values()].map(f=>[f.slug,{get:html(f.get),post:html(f.post)}]));
  await mkdir(path.join(project,'src/data'),{recursive:true});
  await writeFile(path.join(project,'src/data/fragmentos.ts'),'// HTML dos includes PHP que o JavaScript da origem busca por AJAX, renderizado na conversão.\nexport const fragmentos:Record<string,{get:string;post:string}>='+JSON.stringify(data,null,1)+';\n');
  await mkdir(path.join(project,'src/app/fragmentos/[nome]'),{recursive:true});
  await writeFile(path.join(project,'src/app/fragmentos/[nome]/route.ts'),'import {fragmentos} from "@/data/fragmentos";\n// GET e POST (ex.: $.ajax com ajax:true) devolvem o HTML pré-renderizado do include.\nconst send=(html:string|undefined)=>html===undefined?new Response("Not found",{status:404}):new Response(html,{headers:{"Content-Type":"text/html; charset=utf-8"}});\nexport async function GET(_request:Request,{params}:{params:Promise<{nome:string}>}){return send(fragmentos[(await params).nome]?.get);}\nexport async function POST(_request:Request,{params}:{params:Promise<{nome:string}>}){const fragment=fragmentos[(await params).nome];return send(fragment?fragment.post||fragment.get:undefined);}\n');
  (report as any).fragments=[...fragments].map(([file,f])=>({source:file,route:'/fragmentos/'+f.slug}));
 }
 (report as any).siteStructure={settings:rules.mappings.siteSettings,pagesData:rules.mappings.catalogData,sitemap:'src/app/sitemap.xml/route.ts',robots:'src/app/robots.ts',environment:'.env',map:'/mapa-site',generatedMap:structure.generatedMap,indexableRoutes:structure.catalog.filter(p=>p.indexable).map(p=>p.route)};
 // Links para páginas que não foram publicadas apontam para rotas inexistentes.
 // Rota sem página na origem já respondia 404 no ar: decisão. Só página da origem que não foi gerada deixa o link quebrado.
 const sourceRoutes=new Set(routes.values());
 for(const page of native){const links=((page.part as any).links as string[]).filter(r=>!published.has(r));delete (page.part as any).links;const broken=links.filter(r=>sourceRoutes.has(r));for(const r of links)if(!sourceRoutes.has(r))page.part.behaviors?.decisions.push('Link para '+r+': página inexistente já na origem (404 como no ar).');if(broken.length){page.part.notices=[...(page.part.notices||[]),...broken.map(r=>({file:page.entry,line:0,message:'Link para página não publicada: '+r}))];page.part.status='partial';}}
 const guide=['# Guia de edição do site','', 'Cada rota tem um arquivo page.tsx. Altere textos e estrutura nesse arquivo ou nas seções importadas por ele.','', '| Rota | Arquivo |','| --- | --- |',...native.map(p=>'| '+p.route+' | '+path.posix.join(rules.mappings.pages,p.route.slice(1),'page.tsx')+' |'),'', '## Arquivos compartilhados','', '- Seções: '+(rules.mappings.sections||'src/components/Secoes'),'- Cabeçalho: '+rules.mappings.header,'- Rodapé: '+rules.mappings.footer,'- Formulário: '+rules.mappings.contactForm,'- Configurações públicas: '+rules.mappings.siteSettings,'- Dados das páginas: '+rules.mappings.catalogData,'- Sitemap XML: src/app/sitemap.xml/route.ts','- Robots: src/app/robots.ts','- Credenciais e domínio: .env (ignorado pelo Git)','- Interações React: src/components/behaviors','', '## Formatação','', 'Execute npm run format para formatar e npm run format:check para conferir o padrão. Assets em public não são alterados.',''];
 await writeFile(path.join(project,'README.md'),guide.join('\n'));
 await formatProject(project);
 report.status=parts.some(p=>p.status!=='converted')||assetFailures.length||discovery.dependencyIssues.length?'incomplete':'generated-unverified';await checkpoint();return report;
}


// Copia apenas os componentes de comportamento usados e registra-os para o renderizador do layout.
async function writeBehaviors(project:string,components:Set<string>,dependencies:Record<string,string>){
 const base=new URL('../../../templates/next-company/behaviors/',import.meta.url),target=path.join(project,'src/components/behaviors');await mkdir(target,{recursive:true});
 const available=(await readdir(base)).filter(file=>file.endsWith('.tsx')).map(file=>file.slice(0,-4));
 const used=available.filter(name=>components.has(name)).sort();
 for(const file of ['context.ts',...used.map(name=>name+'.tsx')])await copyFile(new URL(file,base),path.join(target,file));
 if(used.includes('AnimateOnScroll')){await mkdir(path.join(project,'src/types'),{recursive:true});await writeFile(path.join(project,'src/types/aos.d.ts'),'declare module "aos";\n');}
 if(Object.keys(dependencies).length){const packagePath=path.join(project,'package.json'),pkg=JSON.parse(await readFile(packagePath,'utf8'));Object.assign(pkg.dependencies,dependencies);await writeFile(packagePath,JSON.stringify(pkg,null,2));}
}
