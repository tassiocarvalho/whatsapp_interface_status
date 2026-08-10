# Status Bot — versão web

Bot de status de grupo do WhatsApp com interface web (estilo WhatsApp).
O servidor Node segura a conexão do Baileys viva; o navegador é só a tela.

## Estrutura

```
status-bot-web/
├── server.js            → backend (Baileys + Express + WebSocket + upload)
├── package.json
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

### Termux (Android)

De preferência instale o Termux pela F-Droid, não pela Play Store:

```bash
pkg update && pkg install nodejs ffmpeg
cd status-bot-web
npm install
```

### Windows / Linux / macOS

```bash
# Node.js 20+: https://nodejs.org (baixe o instalador LTS)
# ffmpeg (opcional):
#   Windows → winget install Gyan.FFmpeg
#   Linux   → sudo apt install ffmpeg  (ou o gerenciador da sua distro)
#   macOS   → brew install ffmpeg

cd status-bot-web
npm install
```

Depois de clonar o repositório com `git clone`, rode `npm install` antes de
qualquer coisa — sem isso o `npm start` não encontra as dependências. Um
único `npm install` já baixa todas elas de uma vez (lê o `package.json`):
`express`, `ws`, `multer`, `pino` e `@neoxr/baileys` (o Baileys, que fala
com o WhatsApp) — nenhuma precisa ser instalada à parte.

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
