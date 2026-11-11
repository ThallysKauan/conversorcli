# Conversão inicial

Template mínimo executável derivado das convenções de sitebasenext. Não é cópia integral: sem dados, domínios, rastreadores, fontes remotas, segredos, formulário global nem envio de backups da base. Mantém App Router, TypeScript, SCSS, alias e diretórios. Bibliotecas de funcionalidades serão adicionadas quando necessárias.

init cria projeto limpo. convert exige entrada explícita e pasta nova; converte uma entrada em /, nunca o site inteiro. Suporta texto PHP, atribuições simples de strings/números, concatenação, echo, includes locais e __DIR__. Parser real, sem executar PHP. HTML é interpretado com parse5; scripts, formulários, eventos, estilos inline, SVG inline e lógica desconhecida ficam pendentes. Recursos permitidos: CSS, imagens raster e fontes. URLs não são reescritas.

Saída: project/, report.json e inacabados/ quando há falha. generated-unverified não significa concluído: build, aparência, comportamento, recursos e demais URLs precisam ser validados. Gemini ainda não integrado.

Comandos:
```powershell
node bin/ppnet.mjs init D:\novo-template
node bin/ppnet.mjs convert tests/fixtures/basic-php --entry index.php --out D:\conversao-teste
```

No projeto gerado: npm install, npm run check e npm run build. A CLI não executa instalação nem build automaticamente. Node.js 24+ é requisito da CLI.
