#!/usr/bin/env node
if (Number(process.versions.node.split('.')[0]) < 24) {
  console.error('PPNet precisa do Node.js 24 ou superior. Instale pelo site https://nodejs.org/ e reabra o terminal.');
  process.exit(1);
}
try {
  const { main } = await import('../src/cli/index.ts');
  await main(process.argv.slice(2));
} catch (error) {
  console.error(`Erro: ${error.message}`);
  process.exitCode = 1;
}
