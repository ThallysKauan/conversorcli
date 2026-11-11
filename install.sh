#!/usr/bin/env sh
# Instalador do PPNet para macOS/Linux
# Uso:  curl -fsSL https://raw.githubusercontent.com/ThallysKauan/conversorcli/main/install.sh | sh
# Pasta de destino opcional:  PPNET_DIR=~/ferramentas/ppnet sh install.sh
set -e
REPO="https://github.com/ThallysKauan/conversorcli.git"
DIR="${PPNET_DIR:-$HOME/ppnet}"

command -v git >/dev/null 2>&1 || { echo "Git nao encontrado. Instale em https://git-scm.com/"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Node.js nao encontrado. Instale a versao 24+ em https://nodejs.org/"; exit 1; }
MAJOR=$(node -p "process.versions.node.split('.')[0]")
[ "$MAJOR" -ge 24 ] || { echo "PPNet precisa do Node.js 24+ (encontrado: $MAJOR)."; exit 1; }

if [ -d "$DIR/.git" ]; then
  echo "Atualizando $DIR ..."
  git -C "$DIR" pull --ff-only
else
  echo "Baixando PPNet em $DIR ..."
  git clone "$REPO" "$DIR"
fi

cd "$DIR"
npm install
echo ""
echo "PPNet instalado. Para usar:  cd \"$DIR\" && npm start"
