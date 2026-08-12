# Status Bot — versão web

Bot de status de grupo do WhatsApp com interface web (estilo WhatsApp).
O servidor Node segura a conexão do Baileys viva; o navegador é só a tela.

Siga os passos abaixo em ordem — funciona no Termux (Android), Windows,
Linux e macOS.

## Passo 1 — Instalar o Git

O Git é o programa que baixa (e depois atualiza) o projeto.

- **Windows**: baixe em [git-scm.com](https://git-scm.com/download/win) e
  instale (pode deixar tudo no padrão).
- **Termux (Android)**:
  ```bash
  pkg update && pkg install git
  ```
- **Linux (Debian/Ubuntu)**:
  ```bash
  sudo apt update && sudo apt install git
  ```
- **macOS**:
  ```bash
  brew install git
  ```

Confira se instalou certo:

```bash
git --version
```

## Passo 2 — Baixar o projeto

Abra o terminal (no Windows, o "Git Bash" que acabou de instalar; no Termux,
o próprio app) numa pasta onde quer guardar o projeto, e rode:

```bash
git clone https://github.com/tassiocarvalho/whatsapp_interface_status.git
cd whatsapp_interface_status
```

Isso cria a pasta `whatsapp_interface_status` com todo o código. **Todos os
comandos dos próximos passos são rodados de dentro dela.**

## Passo 3 — Instalar as dependências

Tem um script que resolve tudo sozinho: instala Node.js e ffmpeg (se
faltarem) e baixa as dependências do projeto (`npm install`).

- **Termux / Linux / macOS**:
  ```bash
  bash setup.sh
  ```
- **Windows**: dê **duplo clique em `setup.bat`** (dentro da pasta do
  projeto), ou pelo terminal:
  ```powershell
  .\setup.bat
  ```
  Se o Windows bloquear de primeira, clique em "Mais informações" →
  "Executar assim mesmo" (o script só chama `winget` e `npm`, nada externo).
  Se ele instalar o Node.js agora, feche o terminal, abra um novo e rode
  `setup.bat` de novo — só assim o `PATH` atualiza.

Espere terminar com a mensagem **"Tudo pronto!"**.

<details>
<summary>Prefere instalar na mão? (clique pra expandir)</summary>

```bash
# Node.js 20+: https://nodejs.org (baixe o instalador LTS)
# ffmpeg e yt-dlp (necessários para música do YouTube):
#   Termux   → pkg install nodejs ffmpeg python && python -m pip install -U yt-dlp
#   Windows  → winget install Gyan.FFmpeg && winget install yt-dlp.yt-dlp
#   Linux    → sudo apt install ffmpeg python3-pip && python3 -m pip install --user -U yt-dlp
#   macOS    → brew install ffmpeg yt-dlp

npm install
```

Um único `npm install` já baixa todas as dependências do `package.json`
(`express`, `ws`, `multer`, `pino`, `@neoxr/baileys`) de uma vez.
</details>

## Passo 4 — Rodar

```bash
npm start
```

Depois abra no navegador (do próprio celular, se for usar no Termux):

```
http://localhost:3000
```

Nas próximas vezes, só repete este passo — não precisa rodar o `setup`
de novo, a menos que apague a pasta `node_modules`.

## Passo 5 — Parear com o WhatsApp

Na tela: digitar número → gerar código → no celular, abrir WhatsApp em
**Aparelhos conectados › Conectar com número** e digitar o código → escolher
grupo → mídia → legenda → quantas vezes → postar.

Depois de parear uma vez, a sessão fica salva em `auth_info_baileys/` e o
bot reconecta sozinho — a tela já abre direto na lista de grupos.

## Atualizar (quando sair uma versão nova)

**Pelo app**: menu (⋮, na tela de grupos) → **Verificar atualizações**. Se
tiver algo novo, mostra a lista de mudanças e um botão pra baixar
(`git pull`, e `npm install` se precisar) sem precisar abrir terminal.

**Pelo terminal**, na pasta do projeto (`whatsapp_interface_status`):

```bash
git pull
npm install
```

Nos dois casos, depois reinicie o servidor pra aplicar: `Ctrl+C` no
terminal pra parar o que já tava rodando e `npm start` de novo (o app não
reinicia sozinho — evita deixar o servidor num estado quebrado no meio do
processo). Mudança só em `public/index.html` já aparece se recarregar a
página, sem precisar reiniciar.

- **Não precisa parear de novo**: a sessão do WhatsApp (`auth_info_baileys/`)
  não é controlada pelo Git, então atualizar nunca mexe nela.

### Deu erro "Falha ao atualizar" / "local changes... would be overwritten by merge"

Só acontece em instalações baixadas antes de 12/08/2026. Rode uma vez no
terminal, na pasta do projeto:

```bash
git checkout -- package-lock.json
git pull
npm install
```

Depois disso o problema não volta mais — daí em diante o próprio botão
"Verificar atualizações" resolve esse tipo de conflito sozinho.

---

## Estrutura

```
whatsapp_interface_status/
├── server.js             → backend (Baileys + Express + WebSocket + upload)
├── package.json
├── setup.sh               → instala tudo no Termux/Linux/macOS
├── setup.bat / setup.ps1  → instala tudo no Windows
├── public/
│   └── index.html        → front-end (a interface)
├── legenda_status.txt    → criado sozinho; edite pra usar "legenda salva"
└── auth_info_baileys/    → criado sozinho após parear (sessão do WhatsApp)
```

## Requisitos

- **Node.js 20 ou superior** (o Baileys exige `>=20.0.0`) — confira com `node -v`.
- **npm** (já vem junto com o Node).
- **ffmpeg** — necessário para música; sem ele o restante ainda funciona, mas
  envia a mídia original sem converter (vídeo pode não reproduzir no status,
  imagem vai sem otimização).
- **yt-dlp** — necessário para buscar no YouTube e preparar o áudio. O script
  de instalação instala automaticamente. Use apenas conteúdo que você tenha
  direito de baixar e reutilizar.
- Conta de WhatsApp pra parear (número com DDI + DDD).

## Deixar com "cara de app" (opcional)

- **Termux:Widget**: cria um atalho na tela inicial que roda `npm start` e
  abre o navegador. Um toque e tá no ar, sem digitar comando.
- **Adicionar à tela inicial** (no navegador, menu ⋮): o site vira ícone e
  abre em tela cheia, sem barra do navegador.

## Notas

- O tipo (imagem/vídeo) mostrado na tela vem do navegador, mas quem decide de
  verdade é o servidor (detecção por magic bytes) na hora de enviar.
- Reenvio automático: "Media upload failed on all hosts" é retentado até 4x
  com espera crescente; as tentativas aparecem na tela de progresso.
- Porta: defina `PORT` no ambiente pra trocar a 3000 (ex.: `PORT=8080 npm start`).
- A lista só mostra grupos de verdade (comunidades e o grupo de avisos delas
  ficam de fora). Cada grupo mostra foto, e um cadeado indica se é "somente
  admins podem enviar mensagens"; clicar num grupo fechado onde a conta não é
  admin mostra um aviso em vez de deixar tentar postar.
