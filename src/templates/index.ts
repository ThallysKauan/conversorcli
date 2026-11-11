import { readFile } from 'node:fs/promises';
export async function loadProfile() {
  return JSON.parse(await readFile(new URL('../../templates/next-company/profile.json', import.meta.url), 'utf8'));
}
