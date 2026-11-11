import { cp, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export async function createTemplate(destination: string) {
  const parent = await realpath(path.dirname(path.resolve(destination)));
  const target = path.join(parent,path.basename(destination));
  const skeleton = await realpath(fileURLToPath(new URL('../../templates/next-company/skeleton/',import.meta.url)));
  const relative = path.relative(skeleton,target);
  if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) throw new Error('Destino dentro do template não permitido.');
  await mkdir(target); // destino existente é sempre um erro
  await cp(fileURLToPath(new URL('../../templates/next-company/skeleton/',import.meta.url)),target,{recursive:true,errorOnExist:true,force:false});
  return target;
}
