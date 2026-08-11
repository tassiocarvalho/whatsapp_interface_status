# Prepara tudo no Windows: instala Node.js + ffmpeg (via winget) e roda npm install.
# Depois disso, so precisa rodar: npm start

Write-Host "Verificando Node.js..." -ForegroundColor Cyan
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js nao encontrado. Instalando via winget..." -ForegroundColor Yellow
    winget install -e --id OpenJS.NodeJS.LTS
    Write-Host ""
    Write-Host "Node.js foi instalado. Feche este terminal, abra um novo e rode setup.bat de novo." -ForegroundColor Yellow
    exit 1
}
Write-Host "OK: $(node -v)" -ForegroundColor Green

Write-Host "Verificando ffmpeg..." -ForegroundColor Cyan
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Write-Host "ffmpeg nao encontrado. Instalando via winget..." -ForegroundColor Yellow
    winget install -e --id Gyan.FFmpeg
} else {
    Write-Host "OK: ffmpeg ja instalado" -ForegroundColor Green
}

Write-Host "Verificando yt-dlp..." -ForegroundColor Cyan
if (-not (Get-Command yt-dlp -ErrorAction SilentlyContinue)) {
    Write-Host "yt-dlp nao encontrado. Instalando via winget..." -ForegroundColor Yellow
    winget install -e --id yt-dlp.yt-dlp
} else {
    Write-Host "OK: yt-dlp ja instalado" -ForegroundColor Green
}

Write-Host ""
Write-Host "Instalando dependencias do projeto (npm install)..." -ForegroundColor Cyan
npm install

Write-Host ""
Write-Host "Tudo pronto! Pra iniciar o bot, rode:" -ForegroundColor Green
Write-Host "  npm start"
