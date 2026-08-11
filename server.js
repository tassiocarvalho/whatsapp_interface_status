// ─── SILENCIAR LOGS DO BAILEYS ───────────────────────────────
const RUIDO = [
    'Closing session', 'SessionEntry', '_chains', 'registrationId',
    'currentRatchet', 'ephemeralKeyPair', 'lastRemoteEphemeralKey',
    'previousCounter', 'rootKey', 'indexInfo', 'pendingPreKey',
    'signedKeyId', 'baseKey', 'preKeyId', 'remoteIdentityKey',
    'chainKey', 'chainType', 'messageKeys', '<Buffer', 'pubKey',
    'privKey', 'baseKeyType', 'closed:', 'used:', 'created:',
    'Failed to decrypt', 'Session error', 'Bad MAC',
    'verifyMAC', 'doDecryptWhisperMessage', 'decryptWithSessions',
    'session_cipher', 'queue_job', '_asyncQueueExecutor',
    'libsignal', 'crypto.js', 'awaitable', 'at Object.',
    'at SessionCipher', 'at async', 'at async _async'
];
const ehRuido = (s) => RUIDO.some(p => String(s).includes(p));

const _stdout = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...a) => ehRuido(chunk) ? true : _stdout(chunk, ...a);
const _stderr = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...a) => ehRuido(chunk) ? true : _stderr(chunk, ...a);
const _log = console.log.bind(console);
console.log = (...a) => { if (!ehRuido(a.join(' '))) _log(...a); };
const _err = console.error.bind(console);
console.error = (...a) => { if (!ehRuido(a.join(' '))) _err(...a); };

// ─── DEPENDÊNCIAS ─────────────────────────────────────────────
let makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, jidNormalizedUser;

const express = require('express');
const { WebSocketServer } = require('ws');
const multer = require('multer');
const http = require('http');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, execSync, exec } = require('child_process');
const APP_VERSION = require('./package.json').version;

process.on('uncaughtException', (err) => {
    if (err.code === 'ENOENT') return;
    console.error('Erro ignorado:', err.message);
});

const PORT = process.env.PORT || 3000;
const ARQUIVO_LEGENDA = './legenda_status.txt';
const TMP_MIDIA = path.join(os.tmpdir(), 'status_midia_tmp');
const UPLOAD_DIR = path.join(os.tmpdir(), 'statusbot_uploads');
const delay = (ms) => new Promise(r => setTimeout(r, ms));

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(ARQUIVO_LEGENDA)) {
    fs.writeFileSync(ARQUIVO_LEGENDA, 'Escreva sua legenda aqui...', 'utf8');
}

// ─── FFMPEG / FFPROBE ─────────────────────────────────────────
const EH_TERMUX = !!(process.env.PREFIX && process.env.PREFIX.includes('com.termux'));
function ffmpegEnv() {
    const env = { ...process.env };
    if (EH_TERMUX) env.PATH = `/data/data/com.termux/files/usr/bin:${process.env.PATH || ''}`;
    return env;
}
// cache evita rodar execSync (bloqueia o event loop) toda vez que um vídeo
// é convertido/otimizado — o caminho dos binários não muda durante o processo.
const _binCache = {};
function resolverBin(chave, nomes, verFlag = '-version') {
    if (chave in _binCache) return _binCache[chave];
    for (const bin of nomes) {
        try {
            execSync(`"${bin}" ${verFlag}`, { stdio: 'ignore', env: ffmpegEnv() });
            return (_binCache[chave] = bin);
        } catch {}
    }
    return null; // não cacheia falha: se o binário for instalado depois, a próxima chamada já acha
}
const resolverFfmpeg = () => resolverBin('ffmpeg', ['ffmpeg', '/data/data/com.termux/files/usr/bin/ffmpeg', '/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg']);
const resolverFfprobe = () => resolverBin('ffprobe', ['ffprobe', '/data/data/com.termux/files/usr/bin/ffprobe', '/usr/bin/ffprobe', '/usr/local/bin/ffprobe']);
function resolverYtDlp() {
    const nomes = process.platform === 'win32'
        ? ['yt-dlp.exe', 'yt-dlp']
        : ['yt-dlp', '/data/data/com.termux/files/usr/bin/yt-dlp', '/usr/bin/yt-dlp', '/usr/local/bin/yt-dlp'];
    return resolverBin('yt-dlp', nomes, '--version');
}

// yt-dlp NÃO faz busca em PATH pro valor de --ffmpeg-location (diferente do
// resto do código, que usa spawn/execSync com resolução do próprio SO) — se
// receber só "ffmpeg" (nome sem caminho) ele erra "ffprobe and ffmpeg not
// found" mesmo com ffmpeg instalado e funcionando. Precisa do caminho absoluto.
let _ffmpegAbsCache;
function resolverFfmpegAbsoluto() {
    if (_ffmpegAbsCache !== undefined) return _ffmpegAbsCache;
    const bin = resolverFfmpeg();
    if (!bin) return null;
    if (path.isAbsolute(bin)) return (_ffmpegAbsCache = bin);
    try {
        const cmd = process.platform === 'win32' ? `where "${bin}"` : `command -v "${bin}"`;
        const out = execSync(cmd, { encoding: 'utf8', env: ffmpegEnv() }).trim().split('\n')[0].trim();
        return (_ffmpegAbsCache = out || null);
    } catch { return null; }
}

function executar(bin, args, { timeout = 120000 } = {}) {
    return new Promise((resolve, reject) => {
        const proc = spawn(bin, args, { env: ffmpegEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '', stderr = '';
        const timer = setTimeout(() => {
            proc.kill();
            reject(new Error('A operação demorou demais. Tente novamente.'));
        }, timeout);
        proc.stdout.on('data', d => { stdout += d; });
        proc.stderr.on('data', d => { stderr += d; });
        proc.on('error', e => { clearTimeout(timer); reject(e); });
        proc.on('close', code => {
            clearTimeout(timer);
            if (code === 0) resolve(stdout.trim());
            else reject(new Error(stderr.trim().split('\n').slice(-3).join(' ') || `yt-dlp terminou com código ${code}`));
        });
    });
}

function duracaoSegundos(ffprobe, filePath, env) {
    if (!ffprobe) return 0;
    try {
        const out = execSync(
            `"${ffprobe}" -v error -show_entries format=duration -of csv=p=0 "${filePath}"`,
            { encoding: 'utf8', env }
        ).trim();
        const d = parseFloat(out);
        return isFinite(d) ? d : 0;
    } catch { return 0; }
}

function temAudio(ffprobe, filePath, env) {
    if (!ffprobe) return true;
    try {
        const out = execSync(
            `${ffprobe} -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 "${filePath}"`,
            { encoding: 'utf8', env }
        ).trim();
        return out.includes('audio');
    } catch { return true; }
}

// ─── DETECÇÃO DE TIPO DE MÍDIA ────────────────────────────────
function detectarTipoMidia(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const fotos = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.heic', '.heif'];
    const videos = ['.mp4', '.3gp', '.mkv', '.mov', '.avi', '.webm', '.ts', '.flv'];
    if (fotos.includes(ext)) return 'imagem';
    if (videos.includes(ext)) return 'video';

    try {
        const buf = Buffer.alloc(12);
        const fd = fs.openSync(filePath, 'r');
        fs.readSync(fd, buf, 0, 12, 0);
        fs.closeSync(fd);
        const hex = buf.toString('hex').toUpperCase();
        if (hex.startsWith('FFD8FF')) return 'imagem';
        if (hex.startsWith('89504E47')) return 'imagem';
        if (hex.startsWith('47494638')) return 'imagem';
        if (hex.startsWith('424D')) return 'imagem';
        if (hex.startsWith('52494646') && buf.slice(8,12).toString('ascii') === 'WEBP') return 'imagem';
        if (['ftyp','moov','mdat','free','wide'].includes(buf.slice(4,8).toString('ascii'))) return 'video';
        if (buf.slice(8,12).toString('ascii').toLowerCase().startsWith('3gp')) return 'video';
        if (hex.startsWith('1A45DFA3')) return 'video';
        if (hex.startsWith('52494646') && buf.slice(8,12).toString('ascii') === 'AVI ') return 'video';
    } catch {}
    return 'imagem';
}

// ─── CONVERSÃO DE VÍDEO ───────────────────────────────────────
async function converterVideoSeNecessario(filePath, emit) {
    const saida = TMP_MIDIA + '_conv.mp4';
    const ffmpeg = resolverFfmpeg();
    if (!ffmpeg) {
        console.log('⚠️  ffmpeg não encontrado.');
        emit && emit({ type: 'stage', text: '⚠️ ffmpeg não encontrado — vídeo pode não reproduzir', warn: true });
        return filePath;
    }

    console.log('🔄 Convertendo vídeo para WhatsApp...');
    const env = ffmpegEnv();
    const ffprobe = resolverFfprobe();
    const comAudio = temAudio(ffprobe, filePath, env);
    const dur = duracaoSegundos(ffprobe, filePath, env);
    if (!comAudio) console.log('🔇 Vídeo sem áudio — adicionando trilha silenciosa.');
    emit && emit({ type: 'stage', text: 'Convertendo vídeo…', percent: 0 });

    const args = ['-y', '-i', filePath];
    if (!comAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
    args.push(
        '-map', '0:v:0',
        ...(comAudio ? ['-map', '0:a:0?'] : ['-map', '1:a:0']),
        '-vf', 'scale=-2:720', '-r', '30',
        '-c:v', 'libx264', '-profile:v', 'baseline', '-level', '3.1',
        '-pix_fmt', 'yuv420p', '-preset', 'fast', '-crf', '28',
        '-bf', '0', '-g', '30',
        '-c:a', 'aac', '-b:a', '96k', '-ar', '44100', '-ac', '2',
        ...(comAudio ? [] : ['-shortest']),
        '-movflags', '+faststart', '-f', 'mp4', saida
    );

    return new Promise((resolve) => {
        const proc = spawn(ffmpeg, args, { env, stdio: ['ignore', 'ignore', 'pipe'] });
        proc.stderr.on('data', (d) => {
            const m = d.toString().match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
            if (m && dur > 0) {
                const t = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
                const pct = Math.max(0, Math.min(99, Math.round(t / dur * 100)));
                emit && emit({ type: 'stage', text: 'Convertendo vídeo…', percent: pct });
            }
        });
        proc.on('close', (code) => {
            if (code === 0 && fs.existsSync(saida)) {
                const kb = Math.round(fs.statSync(saida).size / 1024);
                console.log(`✅ Conversão concluída. Tamanho: ${kb}KB`);
                emit && emit({ type: 'stage', text: 'Convertendo vídeo…', percent: 100 });
                if (kb > 15360) {
                    console.log('⚠️  Arquivo acima de 15MB — WhatsApp pode rejeitar.');
                    emit && emit({ type: 'stage', text: '⚠️ Vídeo grande (>15MB) — pode ser rejeitado', warn: true });
                }
                resolve(saida);
            } else {
                console.log('❌ Conversão ffmpeg falhou. Enviando original...');
                emit && emit({ type: 'stage', text: '⚠️ Conversão falhou — enviando original', warn: true });
                resolve(filePath);
            }
        });
        proc.on('error', (e) => {
            console.log('❌ Erro ffmpeg:', e.message);
            emit && emit({ type: 'stage', text: '⚠️ Erro no ffmpeg — enviando original', warn: true });
            resolve(filePath);
        });
    });
}

// ─── OTIMIZAÇÃO DE IMAGEM ─────────────────────────────────────
const MAX_LADO_IMG = 1600;
async function recomprimirImagem(filePath, emit) {
    const ffmpeg = resolverFfmpeg();
    if (!ffmpeg) {
        console.log('⚠️  ffmpeg não encontrado — enviando imagem original.');
        emit && emit({ type: 'stage', text: '⚠️ ffmpeg não encontrado — imagem original', warn: true });
        return filePath;
    }

    const env = ffmpegEnv();
    const saida = TMP_MIDIA + '_img.jpg';
    const vf = `scale=w='if(gte(iw,ih),min(${MAX_LADO_IMG},iw),-1)':h='if(gte(iw,ih),-1,min(${MAX_LADO_IMG},ih))'`;
    const args = ['-y', '-i', filePath, '-vf', vf, '-q:v', '2', saida];

    console.log('🖼️  Otimizando imagem para envio...');
    return new Promise((resolve) => {
        const proc = spawn(ffmpeg, args, { stdio: 'ignore', env });
        proc.on('close', (code) => {
            if (code === 0 && fs.existsSync(saida) && fs.statSync(saida).size > 0) {
                console.log(`✅ Imagem otimizada: ${Math.round(fs.statSync(saida).size / 1024)}KB (JPEG)`);
                resolve(saida);
            } else { console.log('⚠️  Otimização falhou — enviando original.'); resolve(filePath); }
        });
        proc.on('error', () => { console.log('⚠️  Erro no ffmpeg — enviando original.'); resolve(filePath); });
    });
}

// ─── MIME TYPE ────────────────────────────────────────────────
function getMime(filePath, tipo) {
    const ext = path.extname(filePath).toLowerCase();
    if (tipo === 'imagem') {
        if (ext === '.png') return 'image/png';
        if (ext === '.webp') return 'image/webp';
        if (ext === '.gif') return 'image/gif';
        if (!ext) {
            try {
                const buf = Buffer.alloc(4);
                const fd = fs.openSync(filePath, 'r');
                fs.readSync(fd, buf, 0, 4, 0);
                fs.closeSync(fd);
                const hex = buf.toString('hex').toUpperCase();
                if (hex.startsWith('89504E47')) return 'image/png';
                if (hex.startsWith('47494638')) return 'image/gif';
            } catch {}
        }
        return 'image/jpeg';
    }
    if (tipo === 'video') return ext === '.3gp' ? 'video/3gpp' : 'video/mp4';
    return 'application/octet-stream';
}

// ─── THUMBNAIL DO VÍDEO ───────────────────────────────────────
// Status de vídeo sem miniatura costuma aparecer como "arquivo com erro"
// no outro lado. Extraímos um frame com ffmpeg e enviamos como jpegThumbnail.
function gerarThumbnailVideo(filePath) {
    const ffmpeg = resolverFfmpeg();
    if (!ffmpeg) return undefined;
    const thumb = TMP_MIDIA + '_thumb.jpg';
    try {
        execSync(`"${ffmpeg}" -y -ss 0 -i "${filePath}" -frames:v 1 -vf scale=320:-2 "${thumb}"`,
            { stdio: 'ignore', env: ffmpegEnv() });
        if (fs.existsSync(thumb) && fs.statSync(thumb).size > 0) return fs.readFileSync(thumb);
    } catch {}
    return undefined;
}

// ─── MÚSICA (corte + mistura na foto/vídeo) ────────────────────
// Sample rate/canais forçados em 44.1kHz estéreo — sem isso o WhatsApp
// às vezes aceita o vídeo mas fica mudo (mesmo problema resolvido antes
// em converterVideoSeNecessario).
function cortarAudio(filePath, inicio, fim) {
    const ffmpeg = resolverFfmpeg();
    if (!ffmpeg) return filePath;
    const saida = TMP_MIDIA + '_musica.m4a';
    const duracao = Math.max(0.5, fim - inicio);
    try {
        execSync(
            `"${ffmpeg}" -y -ss ${inicio} -i "${filePath}" -t ${duracao} -vn -c:a aac -b:a 128k -ar 44100 -ac 2 "${saida}"`,
            { stdio: ['ignore', 'ignore', 'pipe'], env: ffmpegEnv() }
        );
        if (fs.existsSync(saida) && fs.statSync(saida).size > 0) return saida;
    } catch (e) {
        console.log('❌ Corte de música falhou:', e.stderr?.toString().slice(-400) || e.message);
    }
    return filePath;
}

// foto + música → vira um vídeo curto (imagem parada) com a duração do trecho cortado
function fotoComMusica(fotoPath, musicaPath, duracaoSeg) {
    const ffmpeg = resolverFfmpeg();
    if (!ffmpeg) return null;
    const saida = TMP_MIDIA + '_foto_musica.mp4';
    const args = [
        '-y', '-loop', '1', '-i', fotoPath, '-i', musicaPath,
        '-map', '0:v:0', '-map', '1:a:0',
        '-t', String(duracaoSeg), '-vf', 'scale=-2:720', '-r', '30',
        '-c:v', 'libx264', '-profile:v', 'baseline', '-level', '3.1', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
        '-shortest', '-movflags', '+faststart', saida
    ];
    return new Promise((resolve) => {
        const proc = spawn(ffmpeg, args, { env: ffmpegEnv(), stdio: ['ignore', 'ignore', 'pipe'] });
        let erro = '';
        proc.stderr.on('data', (d) => { erro += d; });
        proc.on('close', (code) => {
            const ok = code === 0 && fs.existsSync(saida) && fs.statSync(saida).size > 0;
            if (!ok) console.log('❌ Mesclar foto+música falhou:', erro.slice(-400));
            resolve(ok ? saida : null);
        });
        proc.on('error', (e) => { console.log('❌ Erro ffmpeg (foto+música):', e.message); resolve(null); });
    });
}

// vídeo + música → troca o áudio original do vídeo pela música escolhida
function videoComMusica(videoPath, musicaPath) {
    const ffmpeg = resolverFfmpeg();
    if (!ffmpeg) return null;
    const saida = TMP_MIDIA + '_video_musica.mp4';
    const args = [
        '-y', '-i', videoPath, '-i', musicaPath,
        '-map', '0:v:0', '-map', '1:a:0',
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
        '-shortest', '-movflags', '+faststart', saida
    ];
    return new Promise((resolve) => {
        const proc = spawn(ffmpeg, args, { env: ffmpegEnv(), stdio: ['ignore', 'ignore', 'pipe'] });
        let erro = '';
        proc.stderr.on('data', (d) => { erro += d; });
        proc.on('close', (code) => {
            const ok = code === 0 && fs.existsSync(saida) && fs.statSync(saida).size > 0;
            if (!ok) console.log('❌ Trocar áudio do vídeo falhou:', erro.slice(-400));
            resolve(ok ? saida : null);
        });
        proc.on('error', (e) => { console.log('❌ Erro ffmpeg (vídeo+música):', e.message); resolve(null); });
    });
}

// ─── ENVIO COM RETRY ──────────────────────────────────────────
async function enviarComRetry(sock, groupId, conteudo, opts, tentativas, onRetry) {
    for (let t = 1; t <= tentativas; t++) {
        try {
            await sock.sendMessage(groupId, conteudo, opts);
            return true;
        } catch (e) {
            const msg = e?.message || String(e);
            const uploadFalhou = msg.includes('Media upload failed') || e?.output?.statusCode >= 500;
            console.log(`⚠️  Tentativa ${t}/${tentativas} falhou: ${msg}`);
            if (onRetry) onRetry(t, tentativas, msg);
            if (t >= tentativas) throw e;
            await delay((uploadFalhou ? 2500 : 1200) * t);
        }
    }
    return false;
}

// ─── POSTAR STATUS ────────────────────────────────────────────
// conteudo já pronto pro sendMessage (imagem/vídeo/texto); opts carrega
// coisas como backgroundColor (status de texto).
async function postarStatus(sock, groupId, conteudo, opts, vezes, onEvent) {
    for (let i = 0; i < vezes; i++) {
        try {
            await enviarComRetry(sock, groupId, conteudo, opts, 4,
                (t, tot, m) => onEvent && onEvent({ type: 'retry', current: i + 1, total: vezes, attempt: t, attempts: tot, message: m }));
            console.log(`✅ Status ${i + 1}/${vezes} postado!`);
            if (onEvent) onEvent({ type: 'progress', current: i + 1, total: vezes });
        } catch (e) {
            console.log(`❌ Erro ao postar status ${i + 1}/${vezes} (após retries): ${e.message}`);
            if (onEvent) onEvent({ type: 'postItemError', current: i + 1, total: vezes, message: e.message });
        }
        if (vezes > 1 && i < vezes - 1) await delay(800);
    }
}

// ─── BAILEYS ──────────────────────────────────────────────────
let sock = null;
let latestStatus = { connection: 'connecting', registered: false };
let tentativasReconexao = 0;

async function startSock() {
    if (!makeWASocket) {
        const baileys = await import('@neoxr/baileys');
        makeWASocket = baileys.default || baileys.makeWASocket;
        useMultiFileAuthState = baileys.useMultiFileAuthState;
        DisconnectReason = baileys.DisconnectReason;
        fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion;
        jidNormalizedUser = baileys.jidNormalizedUser;
    }

    const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();
    console.log(`📡 Versão WA Web: ${version.join('.')}`);

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        markOnlineOnConnect: true,
    });

    latestStatus.registered = !!state.creds.registered;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection) {
            latestStatus.connection = connection;
            if (connection === 'open') { latestStatus.registered = true; tentativasReconexao = 0; }
            broadcast({ type: 'status', ...latestStatus, version: APP_VERSION });
        }
        if (connection === 'open') console.log('🚀 Conectado ao WhatsApp.');
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const motivo = DisconnectReason[statusCode] || lastDisconnect?.error?.message || statusCode || 'desconhecido';
            console.log(`🔌 Desconectado (${motivo}).`);

            if (statusCode === DisconnectReason.loggedOut) {
                broadcast({ type: 'status', connection: 'loggedOut', registered: false });
                return;
            }
            tentativasReconexao++;
            if (tentativasReconexao > 8) {
                console.log('⚠️  Muitas reconexões seguidas — parei de tentar sozinho pra não ficar em loop infinito. Use "Limpar dados salvos" e pareie de novo.');
                broadcast({ type: 'status', connection: 'stuck', registered: false });
                return;
            }
            setTimeout(startSock, Math.min(2000 * tentativasReconexao, 15000));
        }
    });
}

// ─── HANDLERS ─────────────────────────────────────────────────
const uploads = new Map();

async function requestPairing(number, ws) {
    const num = String(number).replace(/\D/g, '');
    try {
        if (!sock) await startSock();
        await delay(2000);
        const code = await sock.requestPairingCode(num);
        console.log(`🔑 CODE: ${code}`);
        send(ws, { type: 'pairingCode', code });
    } catch (e) {
        send(ws, { type: 'pairingError', message: e.message });
    }
}

// groupFetchAllParticipating() não pede o bit de "somente admins" no request,
// então announce sempre volta falso ali — precisa do groupMetadata individual
// (query "interactive") pra saber se o grupo é fechado de verdade.
// nosso número segue sendo admin mesmo em grupo "somente admins" — só bloqueia
// quem NÃO é admin, então checamos os dois antes de decidir se avisa o usuário.
function souAdminNoGrupo(participants) {
    const me = sock?.user;
    if (!me) return true; // sem certeza, não bloqueia à toa
    const meuJid = [me.id, me.lid].filter(Boolean).map(jidNormalizedUser);
    return (participants || []).some(p => {
        const pJid = [p.id, p.lid].filter(Boolean).map(jidNormalizedUser);
        return pJid.some(j => meuJid.includes(j)) && (p.admin === 'admin' || p.admin === 'superadmin');
    });
}

async function infoDoGrupo(id) {
    try {
        const full = await sock.groupMetadata(id);
        console.log(`🔍 ${id} → announce=${full.announce} restrict=${full.restrict}`);
        return { announce: !!full.announce, souAdmin: souAdminNoGrupo(full.participants) };
    } catch (e) {
        console.log(`⚠️  groupMetadata falhou pra ${id}: ${e.message}`);
        return { announce: false, souAdmin: true };
    }
}

async function fotoDoGrupo(id) {
    try { return await sock.profilePictureUrl(id, 'image'); }
    catch { return null; }
}

async function fetchGroups(ws) {
    try {
        const groups = await sock.groupFetchAllParticipating();
        const base = Object.values(groups).filter(g => !g.isCommunity && !g.isCommunityAnnounce);
        const list = [];
        for (const g of base) {
            const [info, picture] = await Promise.all([infoDoGrupo(g.id), fotoDoGrupo(g.id)]);
            list.push({
                id: g.id, subject: g.subject, size: (g.participants || []).length,
                announce: info.announce, souAdmin: info.souAdmin, picture
            });
        }
        send(ws, { type: 'groups', groups: list });
    } catch (e) {
        send(ws, { type: 'groups', groups: [] });
    }
}

function loadSavedCaption(ws) {
    let text = '';
    try { text = fs.readFileSync(ARQUIVO_LEGENDA, 'utf8').trim(); } catch {}
    if (text === 'Escreva sua legenda aqui...') text = '';
    send(ws, { type: 'savedCaption', text });
}

async function doPost(ws, { uploadId, groupId, caption, times, musicUploadId, musicStart, musicEnd }) {
    const filePath = uploads.get(uploadId);
    if (!filePath || !fs.existsSync(filePath)) {
        send(ws, { type: 'postError', message: 'Arquivo não encontrado no servidor.' });
        return;
    }
    const musicPath = musicUploadId ? uploads.get(musicUploadId) : null;
    try {
        const emit = (obj) => send(ws, obj);
        let tipo = detectarTipoMidia(filePath);
        let arquivoFinal = filePath;
        let thumb;
        if (tipo === 'video') {
            arquivoFinal = await converterVideoSeNecessario(filePath, emit);
            thumb = gerarThumbnailVideo(arquivoFinal);
        } else if (tipo === 'imagem') {
            arquivoFinal = await recomprimirImagem(filePath, emit);
        }

        if (musicPath && fs.existsSync(musicPath)) {
            emit({ type: 'stage', text: 'Cortando o trecho da música…' });
            const inicio = Math.max(0, parseFloat(musicStart) || 0);
            const fim = Math.max(inicio + 0.5, parseFloat(musicEnd) || inicio + 5);
            const trecho = cortarAudio(musicPath, inicio, fim);
            emit({ type: 'stage', text: 'Misturando música na mídia…' });
            if (tipo === 'imagem') {
                const combinado = await fotoComMusica(arquivoFinal, trecho, fim - inicio);
                if (combinado) { arquivoFinal = combinado; tipo = 'video'; thumb = gerarThumbnailVideo(arquivoFinal); }
                else emit({ type: 'stage', text: '⚠️ Não deu pra adicionar música — enviando sem', warn: true });
            } else if (tipo === 'video') {
                const combinado = await videoComMusica(arquivoFinal, trecho);
                if (combinado) arquivoFinal = combinado;
                else emit({ type: 'stage', text: '⚠️ Não deu pra adicionar música — enviando sem', warn: true });
            }
        }

        emit({ type: 'stage', text: 'Enviando para o WhatsApp…' });
        const n = Math.max(1, parseInt(times) || 1);
        const mime = getMime(arquivoFinal, tipo);
        const buffer = fs.readFileSync(arquivoFinal);
        const conteudo = tipo === 'imagem'
            ? { image: buffer, caption: caption || '', mimetype: mime, groupStatus: true }
            : { video: buffer, caption: caption || '', mimetype: 'video/mp4', groupStatus: true, ...(thumb ? { jpegThumbnail: thumb } : {}) };
        await postarStatus(sock, groupId, conteudo, {}, n, emit);
        send(ws, { type: 'postDone', total: n });
    } catch (e) {
        send(ws, { type: 'postError', message: e.message });
    } finally {
        try { fs.unlinkSync(filePath); } catch {}
        uploads.delete(uploadId);
        if (musicUploadId) {
            try { fs.unlinkSync(musicPath); } catch {}
            uploads.delete(musicUploadId);
        }
    }
}

async function doPostText(ws, { groupId, text, backgroundColor, times }) {
    const texto = (text || '').trim();
    if (!texto) {
        send(ws, { type: 'postError', message: 'Escreva algum texto pro status.' });
        return;
    }
    try {
        const emit = (obj) => send(ws, obj);
        emit({ type: 'stage', text: 'Enviando para o WhatsApp…' });
        const n = Math.max(1, parseInt(times) || 1);
        const conteudo = { text: texto, groupStatus: true };
        const opts = backgroundColor ? { backgroundColor } : {};
        await postarStatus(sock, groupId, conteudo, opts, n, emit);
        send(ws, { type: 'postDone', total: n });
    } catch (e) {
        send(ws, { type: 'postError', message: e.message });
    }
}

// ─── LOGOUT / TROCAR CONTA ────────────────────────────────────
async function apagarAuth() {
    // no Windows o arquivo pode estar travado por um instante após fechar o socket
    for (let t = 0; t < 6; t++) {
        try { fs.rmSync('./auth_info_baileys', { recursive: true, force: true }); return true; }
        catch { await delay(300); }
    }
    return false;
}

async function doLogout(ws) {
    try { await sock?.logout(); } catch {}
    try { sock?.end?.(new Error('logout')); } catch {}
    sock = null;
    await delay(500);

    const ok = await apagarAuth();
    latestStatus = { connection: 'connecting', registered: false };
    broadcast({ type: 'loggedOut' });
    if (!ok) send(ws, { type: 'logoutError', message: 'Sessão desconectada, mas não consegui apagar os arquivos (em uso). Feche o servidor e apague a pasta auth_info_baileys manualmente.' });

    try { await startSock(); } catch {}
}

// ─── ATUALIZAÇÕES (git pull) ───────────────────────────────────
const execAsync = (cmd) => new Promise((resolve, reject) => {
    exec(cmd, { cwd: __dirname }, (err, stdout, stderr) => {
        if (err) reject(new Error((stderr || err.message).trim()));
        else resolve(stdout.trim());
    });
});

// pega só o bloco mais recente do CHANGELOG.md que tá no origin/main —
// não precisa dar pull pra ler, "git show" lê o arquivo remoto direto.
async function obterNotasVersao() {
    try {
        const conteudo = await execAsync('git show origin/main:CHANGELOG.md');
        const bloco = conteudo.split(/\n(?=## )/).find(b => b.startsWith('## '));
        if (!bloco) return null;
        const linhas = bloco.split('\n');
        const versao = linhas[0].replace(/^##\s*/, '').trim();
        const notas = linhas.slice(1).filter(l => l.trim().startsWith('-')).map(l => l.replace(/^-\s*/, '').trim());
        return notas.length ? { versao, notas } : null;
    } catch {
        return null;
    }
}

async function obterInfoAtualizacao() {
    await execAsync('git fetch --quiet origin main');
    const atual = await execAsync('git rev-parse HEAD');
    const remoto = await execAsync('git rev-parse origin/main');
    if (atual === remoto) return { upToDate: true, commits: 0, log: [] };
    const log = (await execAsync('git log --oneline HEAD..origin/main')).split('\n').filter(Boolean);
    const release = await obterNotasVersao();
    return { upToDate: false, commits: log.length, log: log.slice(0, 8), release };
}

async function checkUpdate(ws) {
    try {
        const info = await obterInfoAtualizacao();
        updateCache = { ...info, checkedAt: Date.now() };
        send(ws, { type: 'updateStatus', ...info });
    } catch (e) {
        send(ws, { type: 'updateStatus', error: e.message });
    }
}

// checagem em segundo plano — evita bater no GitHub a cada tela aberta:
// roda uma vez ao iniciar e depois só de X em X horas. Só avisa quem já
// está conectado quando o status muda de "atualizado" pra "tem novidade".
let updateCache = { upToDate: true, commits: 0, log: [], checkedAt: 0 };
async function verificarAtualizacaoEmBackground() {
    try {
        const eraAtualizado = updateCache.upToDate;
        const info = await obterInfoAtualizacao();
        updateCache = { ...info, checkedAt: Date.now() };
        if (!info.upToDate && eraAtualizado) {
            broadcast({ type: 'updateAvailable', commits: info.commits, log: info.log, release: info.release });
        }
    } catch { /* checagem silenciosa — não incomoda o usuário se falhar */ }
}
const INTERVALO_CHECAGEM = 6 * 60 * 60 * 1000; // 6h

// arquivos que o próprio app/instalação regeneram sozinhos (não são código
// editado por quem mantém o bot) — se só eles estiverem sujos, descarta antes
// de atualizar em vez de travar o "git pull" pra todo mundo que os tocou.
// legenda_status.txt: o README manda o usuário editar pra usar "legenda salva".
// package-lock.json: muda sozinho a cada "npm install" (hash/deps por SO).
const ARQUIVOS_REGENERAVEIS = ['legenda_status.txt', 'package-lock.json'];

async function arquivosModificadosLocalmente() {
    // não usa execAsync (dá .trim() na saída inteira): o "--porcelain" depende do
    // espaço à esquerda de cada linha (" M arquivo") pra indicar status — um trim
    // geral come esse espaço só na 1ª linha e corrompe o nome do 1º arquivo listado.
    const saida = await new Promise((resolve, reject) => {
        exec('git status --porcelain', { cwd: __dirname }, (err, stdout, stderr) => {
            if (err) reject(new Error((stderr || err.message).trim()));
            else resolve(stdout.replace(/\s+$/, ''));
        });
    });
    return saida.split('\n').filter(Boolean)
        .filter(l => !l.startsWith('??')) // não rastreado não trava o "git pull"
        .map(l => l.slice(3).trim());
}

async function doUpdate(ws) {
    try {
        send(ws, { type: 'updateStage', text: 'Baixando atualização (git pull)…' });
        const sujos = await arquivosModificadosLocalmente();
        const bloqueantes = sujos.filter(f => !ARQUIVOS_REGENERAVEIS.includes(f));
        if (bloqueantes.length) {
            throw new Error(`Arquivos modificados localmente impedem a atualização: ${bloqueantes.join(', ')}. Salve ou descarte essas mudanças antes de atualizar.`);
        }
        if (sujos.length) await execAsync('git checkout -- ' + sujos.map(f => `"${f}"`).join(' '));

        const saida = await execAsync('git pull --ff-only origin main');
        let npmRan = false;
        if (/package(-lock)?\.json/.test(saida)) {
            send(ws, { type: 'updateStage', text: 'Instalando novas dependências…' });
            await execAsync('npm install');
            npmRan = true;
        }
        send(ws, { type: 'updateDone', npmRan });
    } catch (e) {
        send(ws, { type: 'updateError', message: e.message });
    }
}

// ─── SERVIDOR ─────────────────────────────────────────────────
const clients = new Set();
const send = (ws, obj) => { try { ws.send(JSON.stringify(obj)); } catch {} };
const broadcast = (obj) => { for (const c of clients) send(c, obj); };

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    const candidatos = [
        path.join(__dirname, 'public', 'index.html'),
        path.join(__dirname, 'index.html'),
    ];
    const found = candidatos.find(fs.existsSync);
    if (found) return res.sendFile(found);
    res.status(404).send('index.html não encontrado (coloque em public/).');
});

const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 64 * 1024 * 1024 } });
app.post('/upload', upload.single('media'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo.' });
    let fp = req.file.path;
    const ext = path.extname(req.file.originalname || '').toLowerCase();
    if (ext) { const nfp = fp + ext; fs.renameSync(fp, nfp); fp = nfp; }
    const id = crypto.randomBytes(8).toString('hex');
    uploads.set(id, fp);
    res.json({ uploadId: id });
});

// ─── MÚSICA — busca e extração de áudio do YouTube via yt-dlp ──
const MAX_DURACAO_YOUTUBE = 12 * 60;
const youtubeUrl = id => `https://www.youtube.com/watch?v=${id}`;
const idYoutubeValido = id => /^[a-zA-Z0-9_-]{11}$/.test(String(id || ''));

app.get('/youtube-search', async (req, res) => {
    const termo = String(req.query.q || '').trim();
    if (!termo) return res.json({ results: [] });
    if (termo.length > 100) return res.status(400).json({ results: [], error: 'Busca muito longa.' });
    try {
        const ytDlp = resolverYtDlp();
        if (!ytDlp) throw new Error('yt-dlp não encontrado. Rode o script de instalação novamente.');
        const raw = await executar(ytDlp, [
            '--dump-single-json', '--flat-playlist', '--playlist-end', '15',
            '--no-warnings', `ytsearch15:${termo}`
        ]);
        const data = JSON.parse(raw);
        const results = (data.entries || []).filter(v => idYoutubeValido(v.id)).map(v => ({
            id: v.id,
            name: v.title || 'Sem título',
            artist: v.channel || v.uploader || 'YouTube',
            artwork: v.thumbnail || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
            duration: Number(v.duration) || 0,
            tooLong: Number(v.duration) > MAX_DURACAO_YOUTUBE
        }));
        res.json({ results });
    } catch (e) {
        res.status(500).json({ results: [], error: e.message });
    }
});

app.get('/youtube-download', async (req, res) => {
    const videoId = String(req.query.id || '');
    if (!idYoutubeValido(videoId)) return res.status(400).json({ error: 'Vídeo inválido.' });
    try {
        const ytDlp = resolverYtDlp();
        if (!ytDlp) throw new Error('yt-dlp não encontrado. Rode o script de instalação novamente.');
        const url = youtubeUrl(videoId);
        // --print evita baixar o --dump-single-json inteiro (formatos, storyboards
        // etc — dezenas de KB) só pra ler a duração.
        const rawDuration = await executar(ytDlp, ['--no-playlist', '--no-warnings', '--print', '%(duration)s', url]);
        const duration = Number(rawDuration) || 0;
        if (!duration) throw new Error('Não consegui identificar a duração desse vídeo.');
        if (duration > MAX_DURACAO_YOUTUBE) throw new Error('Escolha um vídeo de até 12 minutos.');
        const id = crypto.randomBytes(8).toString('hex');
        const base = path.join(UPLOAD_DIR, id);
        const ffmpegAbs = resolverFfmpegAbsoluto();
        await executar(ytDlp, [
            '--no-playlist', '--no-warnings', '-x', '--audio-format', 'mp3',
            '--audio-quality', '5',
            ...(ffmpegAbs ? ['--ffmpeg-location', ffmpegAbs] : []),
            '-o', `${base}.%(ext)s`, url
        ], { timeout: 180000 });
        const fp = `${base}.mp3`;
        if (!fs.existsSync(fp)) throw new Error('O áudio não foi gerado.');
        uploads.set(id, fp);
        res.json({ uploadId: id, duration, audioUrl: `/youtube-audio/${id}` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/youtube-audio/:id', (req, res) => {
    const id = String(req.params.id || '');
    const fp = uploads.get(id);
    if (!idYoutubeValido(id) && !/^[a-f0-9]{16}$/.test(id)) return res.sendStatus(400);
    if (!fp || !fs.existsSync(fp) || path.extname(fp).toLowerCase() !== '.mp3') return res.sendStatus(404);
    res.type('audio/mpeg').sendFile(fp);
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    clients.add(ws);
    send(ws, { type: 'status', ...latestStatus, version: APP_VERSION });
    if (!updateCache.upToDate) send(ws, { type: 'updateAvailable', commits: updateCache.commits, log: updateCache.log, release: updateCache.release });
    ws.on('close', () => clients.delete(ws));
    ws.on('message', (raw) => {
        let m; try { m = JSON.parse(raw); } catch { return; }
        if (m.type === 'requestPairing') return requestPairing(m.number, ws);
        if (m.type === 'fetchGroups') return fetchGroups(ws);
        if (m.type === 'loadSavedCaption') return loadSavedCaption(ws);
        if (m.type === 'post') return doPost(ws, m);
        if (m.type === 'postText') return doPostText(ws, m);
        if (m.type === 'logout') return doLogout(ws);
        if (m.type === 'checkUpdate') return checkUpdate(ws);
        if (m.type === 'doUpdate') return doUpdate(ws);
    });
});

server.listen(PORT, () => {
    console.log(`\n🌐 Bot de status rodando. Abra no navegador: http://localhost:${PORT}\n`);
});

startSock();
verificarAtualizacaoEmBackground();
setInterval(verificarAtualizacaoEmBackground, INTERVALO_CHECAGEM);
