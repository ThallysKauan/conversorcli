# Correção do diagnóstico de estandes

A execução enviada pelo usuário terminou sem páginas convertidas. Não é erro de uso. A versão 0.3.1 corrige resolução de includes e separação de auxiliares.

O perfil de includes assume diretório de execução igual à raiz da origem e include_path padrão com ponto. Busca referências simples na raiz e na pasta do chamador; caminhos iniciados por ponto são relativos à raiz de execução; __DIR__ continua explícito. Caminhos externos e remotos são bloqueados. include_path customizado e chdir não são suportados. Referência: https://www.php.net/manual/en/function.include.php

Diretórios inc-midia, include/includes, partials, libraries e vendor são classificados como auxiliares e registrados no relatório. Esse critério é uma convenção inicial e pode exigir ajuste em outros sites. A análise estática de dependências não executa PHP nem resolve includes dinâmicos.

Erros comuns são agrupados por causa; zero páginas convertidas recebe aviso explícito. session_start, header e demais comportamentos ainda sem regra não são descartados para fabricar um resultado.

No repositório estandes, inc-midia/contato-envio.php exige inc-midia/form/form.php, mas esse arquivo não foi encontrado. A pasta contém env.php e arquivos de configuração. Essa ausência precisa ser resolvida para reproduzir o envio original. Não houve alteração na origem nem chamada a Gemini.
