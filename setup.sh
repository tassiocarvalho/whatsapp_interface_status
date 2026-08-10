#!/usr/bin/env bash
# Prepara tudo (Termux, Linux ou macOS): instala Node.js + ffmpeg e roda npm install.
# Depois disso, só precisa rodar: npm start
set -e

if [ -n "$PREFIX" ] && [[ "$PREFIX" == *"com.termux"* ]]; then
    echo "📱 Termux detectado — instalando Node.js e ffmpeg..."
    pkg update -y
    pkg install -y nodejs ffmpeg
elif command -v apt >/dev/null 2>&1; then
    echo "🐧 Linux (apt) detectado — instalando Node.js e ffmpeg..."
    sudo apt update
    sudo apt install -y nodejs npm ffmpeg
elif command -v brew >/dev/null 2>&1; then
    echo "🍎 macOS (Homebrew) detectado — instalando Node.js e ffmpeg..."
    brew install node ffmpeg
else
    echo "⚠️  Não reconheci o gerenciador de pacotes deste sistema."
    echo "   Instale manualmente: Node.js 20+ e ffmpeg (opcional)."
    echo "   Depois rode: npm install"
    exit 1
fi

echo ""
echo "📦 Instalando dependências do projeto (npm install)..."
npm install

echo ""
echo "✅ Tudo pronto! Pra iniciar o bot, rode:"
echo "   npm start"
