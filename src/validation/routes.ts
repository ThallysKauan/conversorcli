import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {parse} from 'parse5';
export function pageSignature(root:any){
 const text=(node:any):string=>typeof node==='string'?node:node.nodeName==='#text'?node.value:(node.children||node.childNodes||[]).map(text).join('');
 const find=(node:any,tag:string):any=>{if(!node||typeof node==='string')return undefined;if((node.tag||node.tagName)===tag)return node;for(const child of node.children||node.childNodes||[]){const found=find(child,tag);if(found)return found;}};
 return Object.fromEntries(['title','h1'].map(tag=>[tag,text(find(root,tag)||{children:[]}).replace(/\s+/g,' ').trim()]));
}
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
export async function verifyRoutes(destination:string,onProgress:(s:string)=>void=()=>{}){
 const out=path.resolve(destination),project=path.join(out,'project'),reportPath=path.join(out,'report.json');
 const report=JSON.parse(await readFile(reportPath,'utf8'));
 if(report.checks?.build!=='passed')throw new Error('Execute validate primeiro: o build precisa estar aprovado.');
 const server=createServer();await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const port=(server.address() as {port:number}).port;await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
 const child=spawn(process.execPath,[path.join(project,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','-p',String(port)],{cwd:project,windowsHide:true});
 let logs='',startupError='';child.stdout.on('data',data=>logs+=data);child.stderr.on('data',data=>logs+=data);child.on('error',error=>startupError=error.message);
 const formCount=(node:any):number=>{if(!node||typeof node==='string')return 0;return ((node.tag==='contact-form'||(node.attrs||[]).some((attr:any)=>attr.name==='data-contact-form'))?1:0)+(node.children||node.childNodes||[]).reduce((sum:number,child:any)=>sum+formCount(child),0);};
 const checks:{route:string;expected:number;actual?:number;error?:string}[]=[];
 try{
  const origin='http://127.0.0.1:'+port;let ready=false;
  for(let attempt=0;attempt<120;attempt++){if(startupError||child.exitCode!==null)throw new Error(startupError||logs);if(/Ready in/.test(logs)){ready=true;break;}await pause(250);}
  if(!ready)throw new Error('Servidor Next não iniciou em 30 segundos. '+logs.slice(-2000));
  const routes=report.parts.filter((part:any)=>part.route!==undefined);
  for(const [index,part] of routes.entries()){
   const expected=part.httpStatus||200;
   try{const response=await fetch(origin+part.route,{redirect:'manual',signal:AbortSignal.timeout(30000)});const html=await response.text();const reference=JSON.parse(await readFile(path.join(out,'reference',part.id+'.desktop.json'),'utf8'));const wanted=pageSignature(reference),actual=pageSignature(parse(html));const mismatch=Object.keys(wanted).filter(key=>wanted[key]!==actual[key]);if(formCount(reference)!==formCount(parse(html)))mismatch.push('formulários');checks.push({route:part.route,expected,actual:response.status,...(mismatch.length?{error:'Conteúdo divergente: '+mismatch.join(', ')}:{})});}catch(error){checks.push({route:part.route,expected,error:String(error)});}
   if((index+1)%20===0||index===routes.length-1)onProgress('HTTP: '+(index+1)+'/'+routes.length+' rotas verificadas.');
  }
  if(report.siteStructure){
   for(const route of ['/sitemap.xml','/robots.txt',...(report.siteStructure.generatedMap?['/mapa-site']:[])]){
    try{const response=await fetch(origin+route,{signal:AbortSignal.timeout(10000)});const body=await response.text();let error:string|undefined;
     if(route==='/sitemap.xml'){
      const found=[...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1].replace(/&amp;/g,'&'));
      const wanted=(report.siteStructure.indexableRoutes as string[]).map(r=>new URL(r,report.siteUrl).href);
      if(!response.headers.get('content-type')?.includes('application/xml')||JSON.stringify([...found].sort())!==JSON.stringify([...wanted].sort()))error='Sitemap diverge das páginas indexáveis geradas.';
     }
     if(route==='/robots.txt'&&!body.includes('Sitemap: '+new URL('/sitemap.xml',report.siteUrl).href))error='Robots não aponta para o sitemap esperado.';
     checks.push({route,expected:200,actual:response.status,...(error?{error}:{})});
    }catch(error){checks.push({route,expected:200,error:String(error)});}
   }
  }
  const aliases:{source:string;destination:string}[]=report.legacyRedirects||[];
  for(const alias of aliases){try{const response=await fetch(origin+alias.source,{redirect:'manual',signal:AbortSignal.timeout(10000)});await response.text();const target=response.headers.get('location');checks.push({route:alias.source,expected:(alias as {permanent?:boolean}).permanent===false?307:308,actual:response.status,...(target&&new URL(target,origin).pathname===alias.destination?{}:{error:'Redirecionamento incorreto: '+target})});}catch(error){checks.push({route:alias.source,expected:308,error:String(error)});}}
  if(report.formConversion?.mode==='template'){try{const response=await fetch(origin+'/api/send-email',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(10000)});await response.text();checks.push({route:'POST /api/send-email (campos vazios)',expected:400,actual:response.status});}catch(error){checks.push({route:'POST /api/send-email (campos vazios)',expected:400,error:String(error)});}}
  report.checks.http=checks.length&&checks.every(check=>check.actual===check.expected&&!check.error)?'passed':'failed';
  report.httpValidation={tested:checks.length,failed:checks.filter(check=>check.actual!==check.expected||check.error)};
  await writeFile(reportPath,JSON.stringify(report,null,2));await writeFile(path.join(out,'validation-http.json'),JSON.stringify(checks,null,2));
  onProgress('HTTP: '+report.checks.http+' ('+report.httpValidation.failed.length+' falhas).');return report;
 }catch(error){report.checks.http='failed';report.httpValidation={tested:checks.length,error:String(error)};await writeFile(reportPath,JSON.stringify(report,null,2));throw error;}finally{child.kill();await writeFile(path.join(out,'validation-server.log'),logs);}
}
