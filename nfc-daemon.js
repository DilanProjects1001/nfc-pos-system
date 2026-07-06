const { spawn } = require('child_process');
const WebSocket = require('ws');

// =======================================================================
// CACAOS - Proxmark3 NFC WebSocket Daemon
// =======================================================================
// Este script sirve de traductor entre el mundo del hardware (Proxmark3) 
// y el navegador web donde corre el POS. En lugar de flashear el PM3,
// usamos su consola original y "leemos" la pantalla de forma automática.
// =======================================================================

const PORT = 3001;
const PING_INTERVAL_MS = 1500; // Pedirá lectura al PM3 cada 1.5s
const COM_PORT = process.argv[2];

console.log('╔══════════════════════════════════════════╗');
console.log('║   CACAOS: Proxmark3 -> NFC Web Daemon    ║');
console.log('╚══════════════════════════════════════════╝');

if (!COM_PORT) {
    console.error(`🔴 ERROR: Debes indicar el puerto COM donde está el Proxmark3.`);
    console.error(`Ejemplo de uso: node nfc-daemon.js COM3`);
    console.log(`\n\n💡 Alternativa de Prueba (Modo Emulador): Si no tienes conectado el lector ahora mismo, puedes escribir códigos de tarjetas directamente en esta consola y presionar ENTER para enviarlos al POS.\n`);
}

// 1. Iniciar Servidor WebSocket
const wss = new WebSocket.Server({ port: PORT });
const clients = new Set();

wss.on('connection', (ws) => {
    console.log('⚡ Cliente conectado (POS Frontend)');
    clients.add(ws);
    ws.on('close', () => {
        console.log('⚡ Cliente desconectado');
        clients.delete(ws);
    });
});

function sendToFrontend(cardUid) {
    const payload = JSON.stringify({ type: 'NFC_SCAN', uid: cardUid });
    let count = 0;
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
            count++;
        }
    });
    console.log(`📡 [WebSocket] UID Enviado a ${count} pantallas interactuando: ${cardUid}`);
}

// Memory block to avoid spamming the frontend if the Skylander stays on top
let lastReadUid = null;
let lastReadTime = 0;

function handleNFCDetected(rawUid) {
    // Normalizar UID a formato Cacaos: Quitar espacios y mayúsculas
    const normalizedUid = 'NFC-PM3-' + rawUid.replace(/\s+/g, '').toUpperCase();
    
    const now = Date.now();
    // Si es exactamente la misma tarjeta, esperar al menos 4 segundos antes de volver a enviarla para no disparar 20 compras
    if (normalizedUid === lastReadUid && (now - lastReadTime) < 4000) {
        return;
    }
    
    lastReadUid = normalizedUid;
    lastReadTime = now;
    
    console.log(`\n=============================================`);
    console.log(`🟢 ¡SKYLANDER/TARJETA DETECTADO! UID: ${normalizedUid}`);
    console.log(`=============================================`);
    
    sendToFrontend(normalizedUid);
}

// 2. Conectar con Proxmark3 (Solo si se envía el COM Port)
let pm3Process = null;
if (COM_PORT) {
    console.log(`Iniciando conexión con Proxmark3 en el puerto ${COM_PORT}...`);
    
    // Asumimos que proxmark3 está en las Formas del sistema (PATH de Windows)
    pm3Process = spawn('proxmark3', [COM_PORT]);

    pm3Process.stdout.on('data', (data) => {
        const text = data.toString();
        // El PM3 escupe algo así: [=]  UID: 04 EA B1 F2 69 5E 80
        // Buscamos con una Expresión Regular
        const match = text.match(/UID[:\s]+([a-fA-F0-9 ]{8,})/i);
        if (match && match[1]) {
            handleNFCDetected(match[1]);
        }
    });

    pm3Process.stderr.on('data', (data) => {
        console.error(`[PM3 ERR]: ${data}`);
    });

    pm3Process.on('close', (code) => {
        console.log(`Proxmark3 desconectado. Código: ${code}`);
        process.exit();
    });

    // Bucle infinito: Cada X segundos, enviarle el comando oculto para que busque tarjetas Mifare (Skylanders)
    setInterval(() => {
        if (pm3Process && !pm3Process.killed) {
            pm3Process.stdin.write('hf 14a reader\n');
        }
    }, PING_INTERVAL_MS);

    console.log(`✅ Proxmark3 conectado. Leyendo tarjetas cada ${PING_INTERVAL_MS/1000}s...`);

} else {
    // Modo Consola (Emulador) si no ponen COM_PORT
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    
    rl.on('line', (line) => {
        const txt = line.trim();
        if (txt) {
            handleNFCDetected(txt);
        }
    });
}
