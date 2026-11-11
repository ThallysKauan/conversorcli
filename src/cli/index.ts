import { createTemplate } from "../templates/create.ts";

import { inspectEnvironment } from '../environment/index.ts';
import { analyze } from '../analysis/index.ts';
import { planNext } from '../targets/next/index.ts';
import { writeReport } from '../reports/index.ts';

export async function main(args: string[]) {
  const [command, source, ...rest] = args;
  if (!command || command === 'help' || command === '--help') {
    console.log('PPNet — conversor inicial de entrada PHP estática\n\nppnet start [origem] [--out pasta-nova]\nppnet verify-routes <pasta-da-conversao>\nppnet validate <pasta-da-conversao>\nppnet init <pasta-nova>\nppnet convert <origem> --entry index.php --out <pasta-nova>\nppnet doctor\nppnet plan <pasta-local> [--report <arquivo.json>]\n\nGemini e entrada por repositório ainda não implementados.');
    return;
  }
  if (command === 'start') { const { start } = await import('./start.ts'); await start(args.slice(1)); return; }
  if(command==='verify-routes'){
    if(!source||rest.length)throw new Error('Use: ppnet verify-routes <pasta-da-conversao>');
    const {verifyRoutes}=await import('../validation/routes.ts');
    const report=await verifyRoutes(source,console.log);if(report.checks.http!=='passed')process.exitCode=2;return;
  }
  if (command === 'validate') {
    if(!source||rest.length)throw new Error('Use: ppnet validate <pasta-da-conversao>');
    const {validateConversion}=await import('../validation/project.ts');
    const report=await validateConversion(source,console.log);
    if(report.checks.build!=='passed'||report.status==='incomplete')process.exitCode=2;
    return;
  }
  if (command === 'init') {
    if (!source || rest.length) throw new Error('Use: ppnet init <pasta-nova>');
    console.log('Template criado em ' + await createTemplate(source)); return;
  }
  if (command === 'convert') throw new Error('O comando convert foi removido: ele gerava páginas a partir de JSON renderizado. Use ppnet start <origem> --out <pasta-nova>.');
  if (command === 'doctor') {
    if (source) throw new Error('doctor não recebe argumentos.');
    for (const item of inspectEnvironment()) console.log(`${item.available ? 'OK' : 'AUSENTE'} ${item.name}: ${item.detail}${item.available ? '' : '\n  ' + item.guidance}`);
    console.log('npm: acompanha a instalação padrão do Node.js; confirme com npm --version antes de instalar as dependências de desenvolvimento.');
    return;
  }
  if (command === 'plan') {
    if (!source || (rest.length !== 0 && !(rest.length === 2 && rest[0] === '--report' && rest[1]))) throw new Error('Use: ppnet plan <pasta-local> [--report <arquivo.json>]');
    const plan = await planNext(await analyze(source));
    if (rest[1]) { await writeReport(rest[1], plan); console.log(`Plano salvo em ${rest[1]}. Nenhum arquivo convertido.`); }
    else console.log(JSON.stringify(plan, null, 2));
    return;
  }
  throw new Error(`Comando desconhecido: ${command}. Use ppnet help.`);
}

