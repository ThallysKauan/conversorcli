# Estado atual

A arquitetura abaixo registra o planejamento inicial. A versão 0.2 já possui template mínimo executável e regras para uma entrada PHP estática. Consulte conversion-v0.2.md para o escopo implementado. Formulários, Gemini, múltiplas páginas e fidelidade automatizada continuam pendentes.

# Arquitetura e escopo

CLI local para sites institucionais, landing pages e catálogos com formulários. Sem lojas, autenticação ou painéis. Primeiro par: PHP para Next.js, sem PHP no resultado.

Fluxo futuro: entrada -> inventário -> análise sintática PHP -> representação intermediária -> regras do perfil -> geração -> validação -> relatório. Gemini é fallback opcional por trecho, com consentimento por envio. Ausência de rede ou chave não interrompe partes independentes.

Saída sempre em pasta nova. Não sobrescrever origem nem template. Separar projeto, relatório e inacabados; artefatos como contato(inacabado).tsx ficam fora da árvore compilável. O relatório relaciona origem, destino previsto, regra, uso de Gemini, verificações, falhas e dependências. Qualquer pendência mantém o resultado global incompleto. Deve ser possível retomar futuramente sem repetir partes verificadas.

O inventário atual só lista extensões, ignora links simbólicos, dependências, Git e nomes .env. Não constitui scanner de segredos nem auditoria de segurança. Nenhum código de entrada é executado ou enviado a serviços.

## Perfil da empresa

Inspecionados package.json, tsconfig, layout e página dinâmica da base. Referência declara Next ^15.5.9, React 19.1.0, TypeScript, SCSS, alias @/*, App Router, dados em pagesData e configurações em settings. Essas versões são observações da referência, não recomendações de atualização.

O layout atual insere fontes, formulário global e componentes próprios. Não copiá-lo indiscriminadamente: manter organização e adaptar comportamento/aparência ao site de origem. Mapeamentos iniciais são propostas, não regras executáveis. Não copiar .env, conteúdo de exemplo, rastreadores ou credenciais. O template executável sanitizado ainda será preparado e versionado; atualizar a base não deve alterar conversões anteriores silenciosamente.

## Critérios futuros de conclusão

PHP removido do projeto gerado; recursos e URLs preservados; tipos e build aprovados; comportamento de formulários e navegação verificado; comparação visual registrada; nenhuma pendência. Verificações indisponíveis devem constar como não verificadas, nunca aprovadas.

## Próximas etapas

1. Preparar e validar template mínimo executável no padrão da empresa.
2. Implementar parser e regras para variáveis, includes e templates simples com fixtures.
3. Gerar páginas, assets, estilos e relatórios por parte.
4. Converter formulários e URLs e validar resultado.
5. Adicionar Gemini, consentimento, limites e retomada.
6. Adicionar clone de repositórios sem executar scripts de instalação automaticamente.
