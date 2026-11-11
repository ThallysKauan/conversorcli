import { realpath } from 'node:fs/promises';
import path from 'node:path';
/** include_path='.': diretório da página (cwd do PHP), raiz da origem e pasta do arquivo que inclui. */
export async function resolveInclude(root:string,caller:string,target:string,cwd:string=root):Promise<string> {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target)||target.includes('\0')) throw new Error('Include remoto ou inválido bloqueado.');
  const explicit=/^\.{1,2}([\\/]|$)/.test(target);
  const candidates=path.isAbsolute(target)?[target]:explicit?[path.resolve(cwd,target),path.resolve(root,target)]:[path.resolve(cwd,target),path.resolve(root,target),path.resolve(path.dirname(caller),target)];
  for(const candidate of [...new Set(candidates)]) {
    const relative=path.relative(root,candidate);
    if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)) throw new Error('Include fora da origem bloqueado.');
    try {
      const found=await realpath(candidate);const rel=path.relative(root,found);
      if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw new Error('Include fora da origem bloqueado.');
      return found;
    } catch(error:any) {if(error.code!=='ENOENT'&&error.code!=='ENOTDIR')throw error;}
  }
  throw new Error('Include ausente: '+target+' (referenciado por '+path.relative(root,caller)+')');
}
