import {spawn} from 'node:child_process';
import {access,readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';

export type CommandRunner=(cwd:string,command:string,args:string[])=>Promise<{code:number;output:string}>;
export const runCommand:CommandRunner=async(cwd,command,args)=>new Promise(resolve=>{
 // Windows precisa do shell para npm.cmd; a linha vai montada e com aspas (sem args separados, que o Node 24 depreciou).
 const quote=(value:string)=>/^[\w@:./=-]+$/.test(value)?value:'"'+value.replace(/"/g,'\\"')+'"';
 const child=process.platform==='win32'?spawn([command,...args].map(quote).join(' '),{cwd,shell:true,windowsHide:true}):spawn(command,args,{cwd,windowsHide:true});
 let output='';child.stdout?.on('data',data=>{output+=String(data);process.stdout.write(data);});child.stderr?.on('data',data=>{output+=String(data);process.stderr.write(data);});
 child.on('error',error=>resolve({code:1,output:output+'\n'+error.message}));child.on('close',code=>resolve({code:code??1,output}));
});
// Prune dependency/build directories before descent (not after enumerating their files).
export async function projectFiles(root:string):Promise<string[]>{
 const files:string[]=[];
 async function visit(relative:string){for(const entry of await readdir(path.join(root,relative),{withFileTypes:true})){
  const file=path.join(relative,entry.name);
  if(entry.isDirectory()){if(!['node_modules','.next','.git'].includes(entry.name))await visit(file);}
  else if(entry.isFile())files.push(file);
 }}
 await visit('');return files;
}
export async function validateConversion(destination:string,onProgress:(s:string)=>void=()=>{},run:CommandRunner=runCommand){
 const out=path.resolve(destination),project=path.join(out,'project'),reportPath=path.join(out,'report.json');
 const report=JSON.parse(await readFile(reportPath,'utf8'));
 const routes=report.parts.filter((part:any)=>part.status==='converted'||part.status==='partial');
 const pages=report.rules?.applied?.pages||'src/app/(paginas)';
 if(typeof pages!=='string'||!pages.startsWith('src/app/')||pages.split(/[\\/]/).includes('..'))throw new Error('Regra pages inválida no relatório.');
 const checks={...report.checks,build:'not-run',routes:'not-run'};
 const validation={generated:routes.length,missing:[] as string[],install:'not-run',buildLog:'validation-build.log',scope:'TSX files and production build; visual and behavior not verified'};
 const save=async()=>{report.checks=checks;report.validation=validation;await writeFile(reportPath,JSON.stringify(report,null,2));};
 for(const part of routes){
  if(typeof part.route!=='string'||!/^\/(?:[a-zA-Z0-9_-]+\/?)*$/.test(part.route))throw new Error('Rota inválida no relatório.');
  try{await access(path.join(project,pages,part.route.slice(1).split('/').map((segment:string)=>segment.startsWith('_')?'%5F'+segment.slice(1):segment).join('/'),'page.tsx'));}catch{validation.missing.push(part.route);}
 }
 checks.routes=routes.length&&!validation.missing.length?'passed':'failed';
 // Nenhum adaptador de scripts antigos pode restar no projeto gerado.
 const legacy:string[]=[];
 for(const file of await readdir(path.join(project,'src'),{recursive:true}).catch(()=>[] as string[])){if(!/\.(tsx?|json)$/.test(file))continue;const text=await readFile(path.join(project,'src',file),'utf8');if(/LegacyRuntime|data-ppnet-events|data-ppnet-script|application\/x-ppnet|ppnet-generated/.test(text))legacy.push(file);}
 checks.legacyRuntime=legacy.length?'failed':'passed';(validation as any).legacyRuntimeFiles=legacy;
 // Projeto independente: só Next. Nada do conversor, de arquivos PHP, de JavaScript da origem ou de HTML renderizado em JSON.
 const branded:{file:string;reason:string}[]=[];
 const forbidden:[RegExp,string][]=[[/ppnet/i,'referência ao conversor'],[/["'(=]\s*(?!https?:)[^"'()\s%]*\.php\b/i,'link para arquivo PHP'],[/inc-midia|js-midia/i,'pasta da origem PHP'],[/src\/data\/pages\/|loadDocument|siteDocument/,'página renderizada em JSON'],[/javascript:/i,'URL javascript:'],[/<script(?![^>]*application\/ld\+json)[^>]*dangerouslySetInnerHTML/i,'script inline da origem']];
 for(const file of await projectFiles(project)){
  const normalized=String(file).replace(/\\/g,'/');if(/(^|\/)(node_modules|\.next)(\/|$)/.test(normalized))continue;
  if(/\.(php|phtml|htaccess)$/i.test(normalized)||/^public\/(?!scripts\/).*\.m?js$/i.test(normalized)){branded.push({file:normalized,reason:'arquivo PHP/JavaScript da origem'});continue;}
  if(!/\.(tsx?|json|mjs|scss|css)$/.test(normalized)||/package-lock\.json$/.test(normalized))continue;
  // Única exceção: o placeholder declarado no settings para variáveis PHP sem valor na origem.
  const text=(await readFile(path.join(project,file),'utf8')).replace(/^\s*const preencher\s*=\s*["']ppnet["'];?\s*$/m,'');for(const [pattern,reason] of forbidden)if(pattern.test(normalized)||pattern.test(text)){branded.push({file:normalized,reason});break;}
 }
 checks.independent=branded.length?'failed':'passed';(validation as any).dependentFiles=branded;await save();
 if(branded.length){onProgress('Validação interrompida: o projeto ainda depende da origem em '+branded.length+' arquivo(s): '+branded.slice(0,5).map(b=>b.file+' ('+b.reason+')').join(', '));return report;}
 if(checks.routes==='failed'){onProgress('Validação interrompida: nenhuma rota gerada ou arquivos TSX ausentes.');return report;}
 onProgress(routes.length+' rotas possuem page.tsx. Instalando dependências na pasta project...');
 validation.install='running';await save();
 let result=await run(project,'npm',['install','--no-audit','--no-fund']);
 await writeFile(path.join(out,'validation-install.log'),result.output);
 validation.install=result.code===0?'passed':'failed';await save();
 if(result.code!==0){onProgress('Instalação falhou. Consulte validation-install.log.');return report;}
 onProgress('Executando build Next.js de todas as rotas...');checks.build='running';await save();
 result=await run(project,'npm',['run','build']);await writeFile(path.join(out,validation.buildLog),result.output);
 checks.build=result.code===0?'passed':'failed';await save();
 onProgress(result.code===0?'Build aprovado. Aparência e comportamento continuam pendentes.':'Build falhou. Consulte validation-build.log; a migração não foi aprovada.');
 return report;
}
