import { loadProfile } from '../../templates/index.ts';
import type { SiteInventory } from '../../intermediate/index.ts';
export async function planNext(site: SiteInventory) {
  return { schemaVersion: 1, status: 'planning-only', createdAt: new Date().toISOString(),
    profile: await loadProfile(), inventory: site,
    limitations: ['Inventário por extensão; não interpreta PHP.', 'Nenhum arquivo convertido.', 'Fidelidade visual e funcionalidades não verificadas.', 'O comando plan não executa a conversão experimental disponível em convert.'],
    nextSteps: ['Ampliar regras PHP além de expressões estáticas.', 'Validar mapeamento das páginas ao template limpo.', 'Implementar geração e validação.', 'Integrar Gemini com consentimento por envio.'] };
}
