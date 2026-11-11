# Instalador do PPNet para Windows (PowerShell)
# Uso:  irm https://raw.githubusercontent.com/ThallysKauan/conversorcli/main/install.ps1 | iex
# Pasta de destino opcional:  $env:PPNET_DIR = "D:\ferramentas\ppnet"; irm ... | iex

$ErrorActionPreference = 'Stop'
$repo = 'https://github.com/ThallysKauan/conversorcli.git'
$dir  = if ($env:PPNET_DIR) { $env:PPNET_DIR } else { Join-Path $HOME 'ppnet' }

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host 'Git nao encontrado. Instale em https://git-scm.com/ e reabra o terminal.' -ForegroundColor Red
  return
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host 'Node.js nao encontrado. Instale a versao 24 ou superior em https://nodejs.org/ e reabra o terminal.' -ForegroundColor Red
  return
}
$major = [int]((node -p "process.versions.node").Split('.')[0])
if ($major -lt 24) {
  Write-Host "PPNet precisa do Node.js 24 ou superior (encontrado: $major). Atualize em https://nodejs.org/." -ForegroundColor Red
  return
}

if (Test-Path (Join-Path $dir '.git')) {
  Write-Host "Atualizando $dir ..."
  git -C $dir pull --ff-only
} else {
  Write-Host "Baixando PPNet em $dir ..."
  git clone $repo $dir
}

Push-Location $dir
try {
  npm install
  Write-Host ''
  Write-Host 'PPNet instalado.' -ForegroundColor Green
  Write-Host "Para usar:  cd `"$dir`"; npm start"
} finally {
  Pop-Location
}
