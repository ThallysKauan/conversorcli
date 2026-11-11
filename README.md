# PPNet — PHP para Next.js

Execute `npm start` e informe a pasta PHP e uma pasta nova de saída. A ferramenta gera o projeto, instala dependências, executa o build e testa as rotas HTTP, os títulos, H1 e redirecionamentos. Nenhum PHP da origem é executado. As limitações permanecem no relatório.

## Instalação

Requisitos: [Node.js 24+](https://nodejs.org/) e [Git](https://git-scm.com/).

**Instalação automática (Windows, PowerShell):**

```powershell
irm https://raw.githubusercontent.com/ThallysKauan/conversorcli/main/install.ps1 | iex
```

**macOS/Linux:**

```sh
curl -fsSL https://raw.githubusercontent.com/ThallysKauan/conversorcli/main/install.sh | sh
```

O instalador baixa o PPNet em `~/ppnet` (ou na pasta definida em `PPNET_DIR`) e roda `npm install`. Rodar de novo atualiza para a versão mais recente.

**Instalação manual:**

```powershell
git clone https://github.com/ThallysKauan/conversorcli.git
cd conversorcli
npm install
npm start
```

Sem Git: em *Code → Download ZIP* no GitHub, extraia, abra o terminal na pasta e rode `npm install` e `npm start`.

## Formulários no padrão sitebasenext

A regra `conversion.forms: "template"` reconhece nome, mensagem, email/email_form e telefone/telefone_form, inclusive nos includes. Com `conversion.formMarkup: "original"` (padrão), a marcação do formulário é mantida — classes, campos extras (radios, endereço…), placeholders e ordem — para o CSS do site continuar valendo; só o `<form>` vira `<ContactForm>` com os campos como filhos, e o envio passa para a API `/api/send-email` (action, method e eventos do `<form>` são descartados). Nome, email, telefone e mensagem são obrigatórios; os demais campos seguem no email com o nome do campo. Com `formMarkup: "template"`, o formulário é substituído pelo ContactForm do template com os campos Nome, Email, Telefone, Empresa, Como nos conheceu e Mensagem, nas variações contatoForm e contatoFormIncluded e com o CSS do template. Nos dois modos: validação Zod compartilhada e Nodemailer. Mantém a posição do formulário. Formulários desconhecidos permanecem visíveis, sem envio, e são sinalizados.

Os backends PHP em `conversion.omitIncludes` são substituídos pela API, não interpretados. Não confundir essa exclusão com remoção do formulário visual. `forms: "omit"` remove o formulário visual; `forms: "disabled"` mantém o HTML antigo com envio desativado.

O projeto recebe `.env.example`. Configure `.env.local` ou o ambiente da hospedagem usando SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, EMAIL_REMETENTE, EMAIL_CONTATO, EMAIL_BCC opcional, SITE_NAME, RECAPTCHA_SECRET e NEXT_PUBLIC_RECAPTCHA_SITE_KEY. A chave pública precisa existir antes do build. RECAPTCHA_ENABLED permanece true por padrão. Credenciais reais não são copiadas; `.env.local` é ignorado pelo Git.

A API aceita os aliases PHP email_form/telefone_form/recaptcha_response e valida os campos no servidor. Só confirma sucesso após o transporte SMTP aceitar a mensagem. O backup externo e a regra EMAIL_TESTE não são migrados automaticamente. A validação automática confirma a presença dos formulários e a rejeição de campos vazios, sem enviar e-mails reais. A entrega real precisa ser validada após configurar o ambiente.

## Regras e exclusões

`rules/next-company/mappings.json` define caminhos de páginas, componentes, dados e formulário. `conversion.keywordConfig` aponta para as configurações gerais: o JSON literal atribuído a dataString determina as páginas de frase-chave excluídas, inclusive cópias em paginas/. Seus links apontam para o domínio original; exclusões são registradas e não contam como conversões.

O projeto gerado é só Next.js: cada rota é um `page.tsx` com `export const metadata` (title, description, canonical, Open Graph, Twitter), o `<head>` comum fica estático em `src/app/layout.tsx` e o erro 404 vira `src/app/not-found.tsx`. Não há HTML renderizado em JSON nem rota genérica nem arquivos, links ou pastas do PHP: `x.php`, `/x.php` e `https://dominio/x.php` viram a rota Next (`/x`), e um link para PHP sem página equivalente bloqueia a página. Redirecionamentos das URLs `.php` antigas só são criados com `conversion.legacyRedirects: true`. Scripts, eventos `on*` e URLs `javascript:` nunca chegam crus ao JSX: viram componentes React ou entram no `OriginalScripts` (ver Scripts e interações); o que escapar disso interrompe a geração da página.

Os corpos das páginas são TSX. Trechos grandes viram seções em `mappings.sections` (`src/components/Secoes`), nomeadas pelo id/classe do elemento (`ProdutosDestaque`, `ProdutosDestaqueMobile`, `Menu2`…) e reaproveitadas quando o conteúdo é igual. O projeto gerado é independente: recebe o nome do site no `package.json` e `validate` reprova (`checks.independent`) qualquer referência a "ppnet".

Modo estrito (`conversion.strict`, padrão `true`): só não é publicada a página com problema real — formulário sem backend, link para PHP sem página equivalente ou JavaScript com `eval`, `new Function`, `document.write` ou `setTimeout` com string. Ela vai para `inacabados/` com a lista do que falta. Avisos que reproduzem o site no ar (Mobile_Detect, include ou link que já falham na origem, HTML reparado pelo parser, `rand()`, JSON-LD inválido mantido) viram decisões e não deixam a página parcial. O middleware, quando gerado, serve apenas para preservar o status 404 das páginas de erro. Metadados usam a API nativa do Next.
## Scripts e interações

Os padrões conhecidos viram componentes React. `src/targets/next/behaviors.ts` divide cada script em instruções (`src/conversion/js/statements.ts`), remove bibliotecas conhecidas (jQuery, slick, OverlayScrollbars, inclusive quando embutidas por `file_get_contents`) e aplica regras que transformam o comportamento em componentes de `templates/next-company/behaviors`, copiados para `src/components/behaviors`:

- Handlers de clique (`src/targets/next/interactions.ts`) → `Interactive`/`InteractionProvider`: `onclick="f()"`/`f(this)`, `addEventListener('click')`, `onclick =`, `lista.forEach(el => el.addEventListener(...))`, com `classList.toggle/add/remove`, `style.x = '...'`, alternância de `style.display`, `aria-*` derivado de classe, `src`/`alt`/`textContent`, `window.scrollTo`, guardas `if (!x) return`, `if (e.target === x)` e `preventDefault`. Funções em `function`, `window.f =` ou arrow, com variáveis locais. Se o original falhava num elemento ausente, as ações seguintes também não são aplicadas. Tecla `Escape` em `document` → mesmo estado.
- Slider `goToSlide(i)` com `translateX(-${i*100}%)`, botões ±1 e `setInterval` → `SliderProvider`, `SlideTrack`, `SlideButton`.
- `IntersectionObserver` que adiciona/remove classe (`isIntersecting` ou `intersectionRatio`) → `Reveal`; `AOS.init` → `AnimateOnScroll` (pacote `aos`); Meta Pixel → `MetaPixel`; `setupScrollProgress` e barra `style.width` → `ScrollProgress`; `validade()`/`mtel` → `PhoneMask`.
- Abas com `slideUp/slideDown` → `TabsProvider`, `TabTrigger`, `TabPanel`.
- `.slick({...})` → `Carousel`, com a marcação e as classes do slick para reaproveitar o CSS.
- `fadeIn/fadeOut` por rolagem e `animate({scrollTop:0})` → `BackToTop`; círculo com `strokeDasharray` → `ScrollProgress`; topo com `addClass` por rolagem → `Topo`/`ScrollClass`.
- `OverlayScrollbars(document.body, ...)` → `CustomScrollbars` com o pacote npm na mesma versão.
- Google Tag Manager, gtag.js e scripts de hosts em `conversion.thirdPartyScripts` → `next/script`.
- GSAP (`gsap.to/from/set/fromTo` com seletor e objeto literal, `registerPlugin(ScrollTrigger)`) → `ScrollTween` com o pacote `gsap` na versão do script (cdnjs `/ajax/libs/gsap/x.y.z/` ou `@x.y.z`).
- Rotação de classe `L[i].classList.remove('c'); i = (i + 1) % L.length; L[i].classList.add('c')` com `setInterval` → `ClassRotator`.
- Carrossel com classes ativo/anterior/próximo, trilho centralizado em `translateX`, botões ±1, `resize` e iframe com `data-src` no slide ativo → `CenteredCarousel`.
- Eventos `onmouseover/onmouseenter` e `onmouseout/onmouseleave` só com `this.style.prop = 'valor'` → `HoverStyle`.
- Esses componentes ficam na posição do script. Se os elementos não existem na página (ex.: marcação comentada), o original falhava com TypeError: nada é aplicado e a decisão é registrada.
- Lazy-load de imagens e menu ativo → atributos aplicados na geração.
- Topo fixo: jQuery com altura de elemento, limiar único ou histerese, `window.scrollY > N` com add/remove e `classList.toggle(c, scrollY > N)` → `Topo`/`ScrollClass`.
- Funções e variáveis sem chamadas no HTML convertido são descartadas e registradas em `decisions`; cópias de um script incluído duas vezes seguem a original.

Fallback para qualquer tecnologia (three.js, plugins, código próprio, `type="module"`, `importmap`, templates `text/x-*`): se a página tem instrução, evento inline ou script externo sem regra React, ela inteira usa `OriginalScripts` — os scripts da origem rodam como no site, na ordem do documento, depois da hidratação; ouvintes de `DOMContentLoaded`/`load` e `window.onload` são chamados ao fim; eventos inline (`onclick`…) e `href="javascript:..."` voltam a ser atributos via `data-evento-*`. Arquivos `.js` locais são publicados em `public/scripts/` (um por conteúdo) e strings `'pagina.php'` de páginas do site viram a rota Next. Só bloqueia `eval`, `new Function`, `document.write` e `setTimeout`/`setInterval` com string. O relatório traz `behaviorMigration` e, por página, `behaviors.migrated`/`behaviors.decisions`. `validate` reprova (`checks.legacyRuntime`) se restar qualquer vestígio do adaptador antigo.

Arquivos com execução de comandos/código e utilitários de exposição de configuração são separados em excludedSources, sem apagar a origem. Includes ausentes não são inventados. Sessões com estado, dados dinâmicos, metadados, aparência e interações podem exigir trabalho adicional.

## Comandos

```powershell
npm start -- "D:\caminho\site-php" --out "D:\caminho\saida-nova"
node bin/ppnet.mjs validate "D:\caminho\saida"
node bin/ppnet.mjs verify-routes "D:\caminho\saida"
npm run check
npm test
```

A saída contém project/ (o site Next), reference/ (HTML de referência usado só pela validação HTTP, fora do projeto), report.json, logs de validação, pendencias/ para páginas parciais e inacabados/ para falhas de geração. O código de saída 2 indica pendências, mesmo se o build passar.

## Revisão de 30/10/2026

Links de navegação absolutos do próprio domínio para páginas convertidas passam a usar rotas locais, inclusive query e fragmento. Canonical, Open Graph e JSON-LD preservam URLs absolutas; páginas de frase-chave excluídas continuam no domínio original.

Handlers React preservam `stopPropagation()` e convertem `classList.toggle(classe, true/false)` para adicionar/remover a classe. A validação ignora node_modules, .next e .git antes de percorrer diretórios, reduzindo o trabalho nas revalidações.

Build aprovado não significa equivalência completa: includes ausentes, variáveis sem valor, conteúdo dinâmico materializado e entrega de email continuam registrados separadamente.

## Código gerado para edição manual

As novas conversões recebem formatação Prettier (2 espaços, largura de referência de 100 colunas), atributos JSX explícitos e nomes como HomePage e ContatoPage. Seções que envolvem o conteúdo completo usam o nome da rota, como ContatoConteudo. JSON-LD é escrito como objetos legíveis, com serialização segura.

O README do projeto lista as rotas e os arquivos para editar. Use npm run format e npm run format:check dentro de project. Recursos copiados em public são preservados. Arquivos de conversões anteriores não são reescritos automaticamente.

## Estrutura sitebasenext

Toda conversão gera src/settings/settings.ts com configurações públicas reconhecidas (nome, contato, endereço e SEO), src/data/pagesData.ts com exports nomeado e padrão, /mapa-site, src/app/sitemap.xml/route.ts, src/app/robots.ts, .env e .env.example. O nome settings.ts segue o template. Valores desconhecidos não são inventados e credenciais não são exportadas do PHP.

Referências exatas reconhecidas a nome, telefone, WhatsApp e email no JSX passam a consumir settings. Textos compostos e código PHP não resolvido ainda precisam de revisão; settings não corrige automaticamente erros de digitação como $emai.

O catálogo contém somente páginas geradas, com route, contratada, title, palavra, description, keywords e indexable. Mapa HTML e sitemap XML usam esse catálogo; sitemap exclui 404 e noindex. As exclusões de dataString continuam sendo respeitadas. Se não existir mapa-site, a ferramenta cria uma página básica. A rota XML não inventa datas de última alteração.

`date()` impresso sem timestamp (ex.: `<?= date('Y') ?>` no copyright) é calculado na requisição por `src/settings/date.ts` (fuso America/Sao_Paulo) e o layout revalida a cada hora; com timestamp (`filemtime`) o valor fixo é o do arquivo. JSON-LD com quebra de linha crua ou vírgula final é reparado; o que não tem reparo seguro é mantido como na origem.

Variáveis PHP: o settings.ts exporta `settings.variaveis` com as variáveis do arquivo de configurações (`conversion.keywordConfig`) que têm o mesmo valor em todas as páginas, com os valores do site no ar e sem credenciais (senha, smtp, token, recaptcha). Textos idênticos a esses valores passam a ler `settings.variaveis`. Variável sem valor na origem não deixa a página parcial: impressa como texto (`<?= $telefone ?>`, concatenação ou interpolação), vira `settings.variaveis.<nome>` com o valor da configuração ou o placeholder `preencher = "ppnet"`, para ser trocado pelo valor real; usada em condição, vale null como no PHP (`$navativa == false` é verdadeiro). A comparação `==` segue as regras do PHP 8. O relatório traz `phpVariables` e, por página, as decisões. `urlencode`, `rawurlencode` e `glob` (somente leitura dentro do site) são suportados.

NEXT_PUBLIC_SITE_URL define o domínio do sitemap e de robots. Configure email/SMTP e reCAPTCHA no .env; esse arquivo é ignorado pelo Git. A verificação HTTP também confere sitemap.xml e robots.txt.

## Cobertura genérica (levantamento de 88 sites)

Regras validadas convertendo todos os sites de `D:Trabalhos-Github	emp` (`node .work/survey-temp.ts <pasta>` converte sem build e agrupa as pendências por causa):

- Domínio: sitemap.xml, `Sitemap:` do robots.txt, canonical/og:url literal ou domínio do email da empresa no arquivo de configurações (ignora Gmail/Hotmail etc.); o `.htaccess` decide o www. A fonte fica em `report.siteUrlSource`.
- Não são páginas: pastas `Disallow: /pasta/` do robots.txt, páginas salvas do navegador (`*_files/`, HTML dentro de assets/css/js/img), pastas internas/backup (`_x`, backup, old, teste) e cópias (`index copy.php`, `(1)`, `-old`, `-backup`). Rotas aceitam acentos e pontos.
- PHP: cerca de 150 funções nativas em `src/conversion/php/builtins.ts` (strings, arrays, regex com `$matches`, ordenação com callback, sprintf, number_format, datas), closures e arrow functions, `list()`, `match`, nowdoc, `print`, `@`, `exit`, `define`/`const`, namespaces, classes declaradas (só falha ao instanciar), short tags `<?`, `return` em include, hoisting de funções, buffers `ob_*`, `readfile`/`file_get_contents` de arquivos de texto. Caminhos relativos resolvem a partir da pasta da página. `eval`/`exec`/`call_user_func` só bloqueiam se forem executados.
- `header('Location: ...')` vira redirecionamento no next.config. Função chamada mas inexistente (ou não carregada) na página e variável sem valor dentro de URL reproduzem o PHP no ar e viram decisão.
- Formulários: sem campos, GET ou com action em outro domínio seguem como na origem; qualquer POST com campos (contato, orçamento, depoimento, trabalhe conosco) envia por email com a marcação original, com anexos (até 3 × 5 MB); login/senha fica visível e sem envio (página parcial).
- JavaScript sem regra React roda pelo `OriginalScripts`, inclusive `document.write` (capturado em execução); só bloqueia payload ofuscado (`eval(atob(...))`) e mineradores.
- Domínio: quando a origem não o revela (email gratuito, sem sitemap/canonical), informe com `--url https://www.dominio.com.br`; domínios-modelo do template (`teste_site_base`, `site_base`, `seudominio`) são ignorados. Pastas `gerador*` (ex.: geradorPython/results) não são páginas.
- Includes PHP buscados por AJAX pelo JavaScript da origem (`url+'/inc-midia/popup-aviso'`, `$.ajax({url:'ajax/x.php', data:{ajax:true}})`) são renderizados na conversão em GET e em POST (`ajax=true`) e servidos por `src/app/fragmentos/[nome]/route.ts` (dados em `src/data/fragmentos.ts`); a string no JS passa a apontar para `/fragmentos/<nome>`.
- Compatibilidade TSX: tags fora do HTML/SVG padrão (custom elements, `<h>` da origem) são declaradas em `src/types/elementos-origem.d.ts`; atributos HTML com nome React (`autoplay` → `autoPlay` etc.), `data-*`/`aria-*` com hífen em SVG, `xmlns:xlink`/`xlink:href`/`xml:space` mapeados e demais `xmlns:*` descartados; rota `/_x` usa a pasta `%5F`x (pasta com _ é privada no App Router); nomes de seção não colidem com as funções de página.
- Resultado no levantamento: dos 84 sites reais de temp, 70 convertem sem pendências e 14 dependem só do domínio (`--url`). Build e HTTP completos aprovados em 12 sites de amostra (incluindo novo-lumalux com 232 páginas) além de hanslaser, mtsz e estandes.
- CMS em subpasta (WordPress, Joomla, Drupal, Magento, OpenCart) depende de banco de dados: fica fora da conversão e links/imagens para ele vão para o domínio original. A index e as páginas da raiz são processadas primeiro.
- Hidratação: meta, title e link (exceto stylesheet) soltos no body vão para o início do pai, porque o React 19 os move para o head e os textos vizinhos quebrariam a hidratação. Arquivo citado no CSS que falta no caminho mas existe com o mesmo nome em outra pasta é copiado para o caminho esperado (`report.restoredAssets`). Link com extensão repetida (`x.php.php`) cai na rota da página.
