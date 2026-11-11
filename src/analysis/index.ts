import { inventory, localSource } from '../sources/index.ts';
import type { SiteInventory } from '../intermediate/index.ts';

export async function analyze(input: string): Promise<SiteInventory> {
  const source = await localSource(input);
  const files = await inventory(source);
  return { source, files, phpFiles: files.filter(f => /\.php$/i.test(f)),
    htmlFiles: files.filter(f => /\.html?$/i.test(f)),
    styleFiles: files.filter(f => /\.(css|scss|sass)$/i.test(f)),
    scriptFiles: files.filter(f => /\.(js|mjs|ts|tsx|jsx)$/i.test(f)) };
}
