import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { convertSite } from '../targets/next/site.ts';
import {validateConversion} from '../validation/project.ts';
export async function start(args:string[]) {
  // --url informa o domínio quando a origem não o revela (sem sitemap, canonical ou email da empresa).
  let source:string|undefined; let destination:string|undefined; let siteUrl:string|undefined;
  for(let i=0;i<args.length;i++){
   if(args[i]==='--out'&&args[i+1])destination=args[++i];
   else if(args[i]==='--url'&&args[i+1]){try{siteUrl=new URL(args[++i]).origin;}catch{throw new Error('URL inválida em --url: '+args[i]);}}
   else if(!source&&!args[i].startsWith('--'))source=args[i];
   else throw new Error('Use: start [pasta-origem] [--out pasta-nova] [--url https://www.dominio.com.br]');
  }
  const prompt=stdin.isTTY?createInterface({input:stdin,output:stdout}):undefined;
  try {
    if(!source){if(!prompt)throw new Error('Informe a pasta de origem: npm start -- "D:\\caminho\\site"'); source=(await prompt.question('Pasta do site que deseja converter: ')).trim().replace(/^"|"$/g,'');}
    if(!source)throw new Error('A origem não pode ficar vazia.');
    const suggestion=path.resolve(source)+'-next-conversao-'+new Date().toISOString().replace(/[:.]/g,'-');
    if(!destination)destination=prompt?((await prompt.question('Pasta NOVA de saída ['+suggestion+']: ')).trim().replace(/^"|"$/g,'')||suggestion):suggestion;
  } finally {prompt?.close();}
  console.log('Iniciando conversão de todas as entradas PHP/HTML. As falhas serão registradas sem interromper as próximas páginas.');
  const report=await convertSite(source,destination,console.log,{siteUrl});
  console.log('\nProcessamento finalizado. '+report.summary.converted+' sem pendências detectadas; '+report.summary.partial+' parciais; '+report.summary.unfinished+' inacabadas; '+report.summary.fragments+' fragmentos não publicados.');
  if(report.summary.generated===0)console.log('NENHUMA PÁGINA CONVERTIDA. A saída contém somente estrutura de diagnóstico; ainda não é um site migrado.');
  for(const blocker of report.blockers.slice(0,8))console.log('Bloqueio em '+blocker.count+' páginas: '+blocker.reason);
  console.log('Auxiliares separados: '+report.auxiliary.length);
  const keywordExclusions=report.excludedSources.filter(item=>item.reason.includes('dataString'));
  console.log('Páginas de frase-chave excluídas: '+keywordExclusions.length+' (lista no relatório).');
  for(const excluded of report.excludedSources.filter(item=>!item.reason.includes('dataString')))console.log('Excluído: '+excluded.source+' — '+excluded.reason);
  console.log('Projeto: '+path.join(report.destination,'project'));
  console.log('Relatório: '+path.join(report.destination,'report.json'));
  const validated=await validateConversion(report.destination,console.log);
  console.log('Para abrir: cd '+JSON.stringify(path.join(report.destination,'project'))+' e npm run dev.');
  if(validated.checks.build!=='passed')process.exitCode=2;
  else {const {verifyRoutes}=await import('../validation/routes.ts');const verified=await verifyRoutes(report.destination,console.log);if(verified.checks.http!=='passed')process.exitCode=2;}
  if(report.status==='incomplete')process.exitCode=2;
}
