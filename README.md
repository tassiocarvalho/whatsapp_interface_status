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

## Instalar (uma vez)

No Termux (de preferência instalado pelo F-Droid, não pela Play Store):

```bash
pkg update && pkg install nodejs ffmpeg
cd status-bot-web
npm install
```

`ffmpeg` é usado pra converter vídeo e otimizar imagem. Sem ele o bot ainda
funciona, mas envia a mídia original (vídeo pode não reproduzir no status).

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
