import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function inspectEnvironment() {
  const git = spawnSync('git', ['--version'], { encoding: 'utf8', windowsHide: true });
  const npm = spawnSync(process.execPath, [path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), '--version'], {encoding:'utf8',windowsHide:true});
  return [
    { name:'npm', available:npm.status===0, detail:npm.status===0 ? npm.stdout.trim() : 'Não encontrado junto ao Node.js', guidance:'Instale Node.js com npm ou verifique npm --version no terminal.' },
    { name: 'Node.js >=24', available: Number(process.versions.node.split('.')[0]) >= 24, detail: process.version, guidance: 'Instale em https://nodejs.org/ e reabra o terminal.' },
    { name: 'Git (somente para repositórios)', available: git.status === 0, detail: git.status === 0 ? git.stdout.trim() : 'Não encontrado', guidance: 'Instale em https://git-scm.com/downloads ou use uma pasta local.' },
  ];
}
