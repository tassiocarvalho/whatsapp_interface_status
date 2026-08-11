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
const { spawn, execSync } = require('child_process');

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
function resolverBin(nomes) {
    for (const bin of nomes) {
        try {
            execSync(`"${bin}" -version`, { stdio: 'ignore', env: ffmpegEnv() });
            return bin;
        } catch {}
    }
    return null;
}
const resolverFfmpeg = () => resolverBin(['ffmpeg', '/data/data/com.termux/files/usr/bin/ffmpeg', '/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg']);
const resolverFfprobe = () => resolverBin(['ffprobe', '/data/data/com.termux/files/usr/bin/ffprobe', '/usr/bin/ffprobe', '/usr/local/bin/ffprobe']);

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
function cortarAudio(filePath, inicio, fim) {
    const ffmpeg = resolverFfmpeg();
    if (!ffmpeg) return filePath;
    const saida = TMP_MIDIA + '_musica.m4a';
    const duracao = Math.max(0.5, fim - inicio);
    try {
        execSync(
            `"${ffmpeg}" -y -ss ${inicio} -i "${filePath}" -t ${duracao} -vn -c:a aac -b:a 128k "${saida}"`,
            { stdio: 'ignore', env: ffmpegEnv() }
        );
        if (fs.existsSync(saida) && fs.statSync(saida).size > 0) return saida;
    } catch {}
    return filePath;
}

// foto + música → vira um vídeo curto (imagem parada) com a duração do trecho cortado
function fotoComMusica(fotoPath, musicaPath, duracaoSeg) {
    const ffmpeg = resolverFfmpeg();
    if (!ffmpeg) return null;
    const saida = TMP_MIDIA + '_foto_musica.mp4';
    const args = [
        '-y', '-loop', '1', '-i', fotoPath, '-i', musicaPath,
        '-t', String(duracaoSeg), '-vf', 'scale=-2:720', '-r', '30',
        '-c:v', 'libx264', '-profile:v', 'baseline', '-level', '3.1', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', saida
    ];
    return new Promise((resolve) => {
        const proc = spawn(ffmpeg, args, { env: ffmpegEnv(), stdio: 'ignore' });
        proc.on('close', (code) => resolve(code === 0 && fs.existsSync(saida) && fs.statSync(saida).size > 0 ? saida : null));
        proc.on('error', () => resolve(null));
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
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
        '-shortest', '-movflags', '+faststart', saida
    ];
    return new Promise((resolve) => {
        const proc = spawn(ffmpeg, args, { env: ffmpegEnv(), stdio: 'ignore' });
        proc.on('close', (code) => resolve(code === 0 && fs.existsSync(saida) && fs.statSync(saida).size > 0 ? saida : null));
        proc.on('error', () => resolve(null));
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
            if (connection === 'open') latestStatus.registered = true;
            broadcast({ type: 'status', ...latestStatus });
        }
        if (connection === 'open') console.log('🚀 Conectado ao WhatsApp.');
        if (connection === 'close') {
            const reconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (reconnect) setTimeout(startSock, 2000);
            else broadcast({ type: 'status', connection: 'loggedOut', registered: false });
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

// ─── MÚSICA — busca (iTunes Search API) e download da prévia ──
function urlPermitidaItunes(u) {
    try {
        const { hostname, protocol } = new URL(u);
        return protocol === 'https:' && (
            hostname === 'itunes.apple.com' || hostname.endsWith('.mzstatic.com') || hostname.endsWith('.apple.com')
        );
    } catch { return false; }
}

app.get('/itunes-search', async (req, res) => {
    const termo = String(req.query.q || '').trim();
    if (!termo) return res.json({ results: [] });
    try {
        const r = await fetch(`https://itunes.apple.com/search?media=music&limit=15&term=${encodeURIComponent(termo)}`);
        const data = await r.json();
        const results = (data.results || [])
            .filter(t => t.previewUrl)
            .map(t => ({ id: t.trackId, name: t.trackName, artist: t.artistName, artwork: t.artworkUrl100, previewUrl: t.previewUrl }));
        res.json({ results });
    } catch (e) {
        res.status(500).json({ results: [], error: e.message });
    }
});

app.get('/itunes-download', async (req, res) => {
    const url = String(req.query.url || '');
    if (!urlPermitidaItunes(url)) return res.status(400).json({ error: 'URL não permitida.' });
    try {
        const r = await fetch(url);
        if (!r.ok) throw new Error('download da prévia falhou');
        const buf = Buffer.from(await r.arrayBuffer());
        const id = crypto.randomBytes(8).toString('hex');
        const fp = path.join(UPLOAD_DIR, id + '.m4a');
        fs.writeFileSync(fp, buf);
        uploads.set(id, fp);
        res.json({ uploadId: id });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    clients.add(ws);
    send(ws, { type: 'status', ...latestStatus });
    ws.on('close', () => clients.delete(ws));
    ws.on('message', (raw) => {
        let m; try { m = JSON.parse(raw); } catch { return; }
        if (m.type === 'requestPairing') return requestPairing(m.number, ws);
        if (m.type === 'fetchGroups') return fetchGroups(ws);
        if (m.type === 'loadSavedCaption') return loadSavedCaption(ws);
        if (m.type === 'post') return doPost(ws, m);
        if (m.type === 'postText') return doPostText(ws, m);
        if (m.type === 'logout') return doLogout(ws);
    });
});

server.listen(PORT, () => {
    console.log(`\n🌐 Bot de status rodando. Abra no navegador: http://localhost:${PORT}\n`);
});

startSock();