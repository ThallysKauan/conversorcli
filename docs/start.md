# Conversão do site pelo terminal

No PowerShell:
```powershell
cd D:\ppnet
npm start
```
Informe a pasta de origem e uma pasta NOVA de saída. Também aceita:
```powershell
npm start -- "D:\Trabalhos-Github\estandes"
.\start.cmd "D:\Trabalhos-Github\estandes"
node bin/ppnet.mjs start "D:\Trabalhos-Github\estandes" --out "D:\Trabalhos-Github\estandes-conversao-nova"
```

O comando percorre todas as entradas PHP/HTML, tenta convertê-las com as regras locais e continua após falhas individuais. Não depende do comando init. A saída inclui project/, report.json e inacabados/. Fragmentos sem documento HTML não são publicados como páginas e constam no relatório. O nome automático usa data e hora. Destinos existentes são recusados.

Cada documento convertido mantém html/head/body em root layout próprio. Rotas amigáveis são criadas e URLs originais .php/.html recebem rewrites; regras customizadas .htaccess ainda não são migradas. A pasta da origem não é alterada. Falta de página inicial produz aviso explícito na raiz do projeto, não uma tela que simula conversão concluída.

Esta é uma execução do site inteiro, NÃO garantia de conversão integral: as regras continuam limitadas, Gemini não integrado, formulários e scripts não suportados são reportados. Código de saída 2 indica resultado incompleto. Build e comparação visual não são executados automaticamente.
