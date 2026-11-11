# Validação da versão 0.2

- TypeScript da CLI: aprovado.
- Quatro testes automatizados: aprovados (includes/variáveis, bloqueios, HTML e ciclos).
- Fixture PHP convertida: TypeScript e build Next.js aprovados.
- HTML de produção: título e h1 conferidos contra a fixture.
- Arquivo default.php do exemplo real: recusado por instrução não suportada, sem execução; relatório e aviso de inacabado gerados.
- Nenhuma chamada ao Gemini; projetos de origem não alterados.
- Comparação visual e migração de site completo não realizadas.

O lockfile do template registra a resolução validada de dependências. A instalação inicial em C falhou por falta de espaço; os builds foram transferidos para .work em D. Os node_modules parciais criados em C foram removidos.

- Template limpo independente: TypeScript e build Next.js aprovados. Os builds em .work emitiram aviso de múltiplos lockfiles na pasta pai, sem falhar.
