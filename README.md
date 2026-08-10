# Status Bot — versão web

Bot de status de grupo do WhatsApp com interface web (estilo WhatsApp).
O servidor Node segura a conexão do Baileys viva; o navegador é só a tela.

## Estrutura

```
status-bot-web/
├── server.js            → backend (Baileys + Express + WebSocket + upload)
├── package.json
├── setup.sh              → instala tudo no Termux/Linux/macOS
├── setup.bat / setup.ps1 → instala tudo no Windows
├── public/
│   └── index.html       → front-end (a interface)
├── legenda_status.txt   → criado sozinho; edite pra usar "legenda salva"
└── auth_info_baileys/   → criado sozinho após parear (sessão do WhatsApp)
```

## Requisitos

- **Node.js 20 ou superior** (o Baileys exige `>=20.0.0`) — confira com `node -v`.
- **npm** (já vem junto com o Node).
- **ffmpeg** (opcional, mas recomendado) — sem ele o bot ainda funciona, mas
  envia a mídia original sem converter (vídeo pode não reproduzir no status,
  imagem vai sem otimização).
- Conta de WhatsApp pra parear (número com DDI + DDD).

O repositório **não** inclui `node_modules/` nem a sessão do WhatsApp — por
isso o `npm install` abaixo é obrigatório antes do primeiro `npm start`.

## Instalar (uma vez)

Tem um script que resolve tudo sozinho — instala Node/ffmpeg que faltar e
já roda o `npm install`. Depois disso é só `npm start` pra sempre.

### Termux (Android) / Linux / macOS

De preferência instale o Termux pela F-Droid, não pela Play Store.

```bash
cd status-bot-web
bash setup.sh
```

### Windows

Dê **duplo clique em `setup.bat`** (na pasta do projeto), ou pelo terminal:

```powershell
cd status-bot-web
.\setup.bat
```

Se o Windows bloquear o `.bat` de primeira, clique em "Mais informações" →
"Executar assim mesmo" (é só o script chamando winget e npm, nada externo).

Se o script instalar o Node.js agora (máquina sem Node), feche o terminal,
abra um novo e rode `setup.bat` de novo — só assim o `PATH` atualiza.

### Manual (sem os scripts)

```bash
# Node.js 20+: https://nodejs.org (baixe o instalador LTS)
# ffmpeg (opcional):
#   Termux   → pkg install nodejs ffmpeg
#   Windows  → winget install Gyan.FFmpeg
#   Linux    → sudo apt install ffmpeg  (ou o gerenciador da sua distro)
#   macOS    → brew install ffmpeg

cd status-bot-web
npm install
```

Um único `npm install` já baixa todas as dependências de uma vez (lê o
`package.json`): `express`, `ws`, `multer`, `pino` e `@neoxr/baileys` (o
Baileys, que fala com o WhatsApp) — nenhuma precisa ser instalada à parte.

## Rodar

```bash
npm start
```

Depois abra no navegador do próprio celular:

```
http://localhost:3000
```

Fluxo na tela: digitar número → gerar código → parear no WhatsApp
(Aparelhos conectados › Conectar com número) → escolher grupo → mídia →
legenda → quantas vezes → postar.

Depois de parear uma vez, a sessão fica salva em `auth_info_baileys/` e
reconecta sozinho — a tela já abre direto na lista de grupos.

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
