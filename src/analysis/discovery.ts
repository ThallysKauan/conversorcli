import { readFile } from 'node:fs/promises';
import path from 'node:path';
import Engine from 'php-parser';
import { resolveInclude } from '../conversion/php/resolve.ts';
export interface DependencyIssue {source:string;reason:string;affectedPages:string[]}
export async function discover(root:string,files:string[],omitIncludes:string[]=[],keywordConfig?:string ) {
  const code=files.filter(f=>/\.(php|html?)$/i.test(f));
  const auxiliary=code.filter(f=>/^(inc-midia|includes?|partials|libraries|vendor)\//i.test(f));
  let entries=code.filter(f=>!auxiliary.includes(f));
  const excludedSources:{source:string;reason:string}[]=[];
  // Não são páginas públicas: caminhos bloqueados no robots.txt, páginas salvas do navegador e HTML dentro de pastas de recursos,
  // pastas internas (_x, backup) e cópias de arquivo (nome com espaço, "(1)", copy, old, backup).
  let robots='';try{robots=await readFile(path.join(root,'robots.txt'),'utf8');}catch{}
  const disallowed=[...robots.matchAll(/^\s*disallow:\s*\/?(\S+)/gim)].map(m=>m[1].replace(/\*.*$/,'')).filter(p=>p.endsWith('/')&&p!=='/');
  const notPage=(file:string):string|undefined=>{
   const lower=file.toLowerCase(),dirs=lower.split('/').slice(0,-1),base=path.posix.basename(lower);
   if(disallowed.some(p=>lower.startsWith(p.toLowerCase())))return 'Caminho bloqueado no robots.txt; não é página pública.';
   if(dirs.some(d=>d.endsWith('_files'))||(/\.html?$/.test(lower)&&dirs.some(d=>/^(assets|css|js|img|imgs|images|imagens|fonts|midia|media|uploads)$/.test(d))))return 'Página salva do navegador ou HTML dentro de pasta de recursos; não é página do site.';
   if(dirs.some(d=>/^_|^(backups?|bkp|old|antigo|temp|tmp|teste?s?)$|backup|^gerador|^generator/.test(d)))return 'Pasta interna, de teste, backup ou gerador; não é página pública.';
   if(/\s|\(\d+\)|[ ._-](copy|copia|cópia|old|bkp|backup|antigo)(\d*)\.(php|html?)$/.test(base))return 'Cópia ou backup de arquivo; não é página pública.';
   return undefined;
  };
  for(const file of [...entries]){const reason=notPage(file);if(reason){excludedSources.push({source:file,reason});entries=entries.filter(e=>e!==file);}}
  const keywordPaths=new Set<string>();
  const edges=new Map<string,string[]>();const issues=new Map<string,DependencyIssue>();
  const parser=new Engine.Engine({parser:{suppressErrors:false},lexer:{short_tags:true}});
  for(const file of code.filter(f=>/\.php$/i.test(f))) {
    if(omitIncludes.includes(file)){excludedSources.push({source:file,reason:'Backend de formulário excluído explicitamente pela regra de conversão.'});continue;}
    let ast:any;try{ast=parser.parseCode(await readFile(path.join(root,file),'utf8'),file);}catch(error){if(file===keywordConfig)throw new Error('Não foi possível analisar as configurações de dataString: '+String(error));continue;}
    function constant(n:any):string|undefined {
      if(n?.kind==='string')return n.value;
      if(n?.kind==='magic'&&n.value==='__DIR__')return path.dirname(path.join(root,file));
      if(n?.kind==='bin'&&n.type==='.') {const a=constant(n.left),b=constant(n.right);if(a!==undefined&&b!==undefined)return a+b;}
      return undefined;
    }
    const targets:string[]=[];let unsafe=false,readsConfig=false,hasHtml=false,hasFileRead=false;let configLiteral=false;
    function walk(n:any){if(!n||typeof n!=='object')return;if(file===keywordConfig&&n.kind==='assign'&&n.left?.kind==='variable'&&n.left.name==='dataString'){const json=constant(n.right);if(json===undefined)throw new Error('dataString precisa ser JSON literal para excluir páginas com segurança.');const data=JSON.parse(json);if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('dataString precisa ser um objeto de URLs.');for(const key of Object.keys(data)){const clean=key.replace(/^\//,'').split(/[?#]/)[0];if(/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.php$/.test(clean)){keywordPaths.add(clean);keywordPaths.add('paginas/'+clean);}}}if(n.kind==='inline'&&/<(?:html|body|!doctype)/i.test(n.value))hasHtml=true;if(n.kind==='string'&&n.value.includes('.htaccess'))configLiteral=true;if(n.kind==='call'&&n.what?.name?.toLowerCase()==='file_get_contents')hasFileRead=true;if(n.kind==='eval'||n.kind==='shell'||(n.kind==='call'&&['eval','system','exec','shell_exec','passthru','popen','proc_open'].includes(n.what?.name?.toLowerCase())))unsafe=true;if(n.kind==='include'){const target=constant(n.target);if(target!==undefined)targets.push(target);}for(const [key,value] of Object.entries(n)){if(key!=='loc')if(Array.isArray(value))value.forEach(walk);else walk(value);}}
    walk(ast);readsConfig=configLiteral&&hasFileRead&&!hasHtml;if(entries.includes(file)&&(unsafe||readsConfig)){excludedSources.push({source:file,reason:unsafe?'Execução de código/comandos: quarentena, não publicada.':'Utilitário de exposição de configuração do servidor; não é página pública migrável.'});entries=entries.filter(entry=>entry!==file);}
    const dependencies:string[]=[];
    for(const target of targets.filter(target=>!omitIncludes.includes(target))){try{dependencies.push(path.relative(root,await resolveInclude(root,path.join(root,file),target)).split(path.sep).join('/'));}catch(error){const reason=error instanceof Error?error.message:String(error);issues.set(file+'|'+reason,{source:file,reason,affectedPages:[]});}}
    edges.set(file,dependencies);
  }
  for(const entry of entries.filter(entry=>keywordPaths.has(entry)))excludedSources.push({source:entry,reason:'Página de frase-chave listada em dataString; excluída por configuração.'});
  entries=entries.filter(entry=>!keywordPaths.has(entry));
  for(const entry of entries){const visited=new Set<string>();function visit(file:string){if(visited.has(file))return;visited.add(file);for(const child of edges.get(file)||[])visit(child);}visit(entry);for(const issue of issues.values())if(visited.has(issue.source))issue.affectedPages.push(entry);}
  return {entries,excludedSources,auxiliary:auxiliary.map(source=>({source,reason:'Diretório auxiliar reconhecido; analisado como dependência, não como página.'})),dependencyIssues:[...issues.values()].filter(i=>i.affectedPages.length)};
}
