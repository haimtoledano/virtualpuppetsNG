
import net from 'net';
import { findActorByIp, insertLog } from './database.js';

let recordedSessions = [];
let trapSessions = {};

const HONEYPOT_PORTS = {
    FTP: 10021,
    TELNET: 10023,
    REDIS: 10079,
    HTTP: 10080
};

const createSession = async (socket, protocol) => {
    const startTime = Date.now();
    const sessionId = `sess-${protocol.toLowerCase()}-${startTime}`;
    // When forwarded via socat, remoteAddress is the AGENT's IP.
    const remoteAddress = socket.remoteAddress ? socket.remoteAddress.replace('::ffff:', '') : 'Unknown';
    
    // Resolve Actor
    let actorId = 'unknown';
    let attackerIp = remoteAddress;
    
    const actor = await findActorByIp(remoteAddress);
    if (actor) {
        actorId = actor.ActorId;
        // Since we don't have proxy protocol, the "Attacker IP" is effectively the Agent relaying it.
        // We denote this in the UI usually, but here we store the IP we see.
    }

    const session = {
        id: sessionId,
        actorId: actorId,
        attackerIp: attackerIp,
        protocol: protocol,
        startTime: new Date(startTime),
        durationSeconds: 0,
        frames: []
    };

    recordedSessions.unshift(session);
    if (recordedSessions.length > 50) recordedSessions.pop();

    // Log the event to DB so Topology lights up
    insertLog({
        actorId: actorId,
        level: 'CRITICAL',
        process: `honey_${protocol.toLowerCase()}`,
        message: `[GHOST] Active High-Interaction Session: ${protocol} connection captured via tunnel.`,
        sourceIp: attackerIp
    });

    return {
        session,
        record: (type, data) => {
            session.frames.push({
                time: Date.now() - startTime,
                type: type,
                data: data.toString()
            });
            session.durationSeconds = (Date.now() - startTime) / 1000;
        }
    };
};

export const startHoneypots = () => {
    // FTP
    const ftpServer = net.createServer(async (socket) => {
        const { record } = await createSession(socket, 'FTP');
        const send = (msg) => { socket.write(msg); record('OUTPUT', msg); };
        send('220 (vsFTPd 2.3.4)\r\n');
        socket.on('data', (data) => {
            record('INPUT', data);
            const cmd = data.toString().trim();
            if (cmd.startsWith('USER')) send('331 Please specify the password.\r\n');
            else if (cmd.startsWith('PASS')) setTimeout(() => send('530 Login incorrect.\r\n'), 500);
            else if (cmd.startsWith('QUIT')) { send('221 Goodbye.\r\n'); socket.end(); }
            else send('500 Unknown command.\r\n');
        });
    });
    ftpServer.on('error', (e) => { if (e.code !== 'EADDRINUSE') console.error('FTP Error:', e.message); });
    ftpServer.listen(HONEYPOT_PORTS.FTP);

    // Telnet
    const telnetServer = net.createServer(async (socket) => {
        const { record } = await createSession(socket, 'TELNET');
        let state = 'LOGIN';
        const send = (msg) => { socket.write(msg); record('OUTPUT', msg); };
        send('\r\nUbuntu 20.04.6 LTS\r\nserver login: ');
        socket.on('data', (data) => {
            record('INPUT', data);
            if (state === 'LOGIN') { send('Password: '); state = 'PASS'; }
            else if (state === 'PASS') { setTimeout(() => { send('\r\nLogin incorrect\r\n\r\nserver login: '); state = 'LOGIN'; }, 800); }
        });
    });
    telnetServer.on('error', (e) => { if (e.code !== 'EADDRINUSE') console.error('Telnet Error:', e.message); });
    telnetServer.listen(HONEYPOT_PORTS.TELNET);

    // Redis
    const redisServer = net.createServer(async (socket) => {
        const { record } = await createSession(socket, 'REDIS');
        const send = (msg) => { socket.write(msg); record('OUTPUT', msg); };
        socket.on('data', (data) => {
            record('INPUT', data);
            const cmd = data.toString().trim().toUpperCase();
            if (cmd.includes('CONFIG') || cmd.includes('GET')) send('-NOAUTH Authentication required.\r\n');
            else if (cmd.includes('AUTH')) send('-ERR invalid password\r\n');
            else send('-ERR unknown command\r\n');
        });
    });
    redisServer.on('error', (e) => { if (e.code !== 'EADDRINUSE') console.error('Redis Error:', e.message); });
    redisServer.listen(HONEYPOT_PORTS.REDIS);
    
    console.log("✅ Honeypot Services Started");
};

export const getSessions = () => recordedSessions;
export const deleteSession = (id) => {
    recordedSessions = recordedSessions.filter(s => s.id !== id);
};

export const initTrap = (sid) => {
    trapSessions[sid] = { state: 'INIT' };
    return { sessionId: sid, banner: "220 (vsFTPd 2.3.4)\r\n" };
};

export const interactTrap = (input) => {
    if (input && input.toUpperCase().startsWith('USER')) return { response: "331 Please specify the password.\r\n" };
    if (input && input.toUpperCase().startsWith('PASS')) return { response: "530 Login incorrect.\r\n" };
    return { response: "500 Unknown command.\r\n" };
};

// --- NEW: Add Agent Recorded Session ---
export const addAgentSession = (sessionData) => {
    try {
        const session = {
            id: `sess-agent-${Date.now()}-${Math.random().toString(36).substr(2,4)}`,
            actorId: sessionData.actorId || 'unknown',
            attackerIp: sessionData.attackerIp || 'unknown',
            protocol: sessionData.protocol || 'TCP',
            startTime: new Date(sessionData.startTime),
            durationSeconds: sessionData.durationSeconds || 0,
            frames: sessionData.frames || []
        };
        recordedSessions.unshift(session);
        if (recordedSessions.length > 50) recordedSessions.pop();
        console.log(`[SESSION] Added ${session.protocol} session from ${session.actorId}`);
        return true;
    } catch (e) {
        console.error("Error adding agent session:", e);
        return false;
    }
};
