import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

const ignored = new Set(['.git', 'node_modules', 'vendor', '.next', '__pycache__']);
export async function localSource(input: string) {
  const root = await realpath(input);
  if (!(await lstat(root)).isDirectory()) throw new Error('A origem precisa ser uma pasta.');
  return root;
}
export async function inventory(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(folder: string) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || ignored.has(entry.name) || entry.name.startsWith('.env')) continue;
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) files.push(path.relative(root, full).split(path.sep).join('/'));
    }
  }
  await walk(root);
  return files.sort();
}
