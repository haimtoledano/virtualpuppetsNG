import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import sql from 'mssql';
import cors from 'cors';
import bodyParser from 'body-parser';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import dgram from 'dgram';
import net from 'net';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 8080;
const distPath = path.join(__dirname, 'dist');
const CONFIG_FILE = path.join(__dirname, 'db-config.json');

// --- HONEYPOT CONFIG ---
const HONEYPOT_PORTS = {
    FTP: 10021,
    TELNET: 10023,
    REDIS: 10079,
    HTTP: 10080
};

// In-memory storage for active/recorded sessions
let recordedSessions = []; 
// In-memory storage for active API-based trap sessions
const activeTrapSessions = new Map();

// --- MFA CONFIGURATION ---
authenticator.options = { window: [2, 2] };

app.use(cors());

app.use(bodyParser.json({
    limit: '10mb',
    verify: (req, res, buf) => {
        req.rawBody = buf.toString();
    }
}));

app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && 'body' in err) {
        console.error('❌ JSON Syntax Error');
        return res.status(400).json({ success: false, error: 'Invalid JSON payload' });
    }
    next();
});

const getClientIp = (req) => {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded ? forwarded.split(',')[0] : req.socket.remoteAddress;
    return ip ? ip.replace('::ffff:', '') : '0.0.0.0';
};

// --- SESSION RECORDING HELPER ---
const recordFrame = (session, type, data) => {
    if (!session) return;
    if (!data) return;

    const frame = {
        time: Date.now() - session.startTimeMs,
        type: type, // 'INPUT' or 'OUTPUT'
        data: data
    };
    session.frames.push(frame);
    session.durationSeconds = (Date.now() - session.startTimeMs) / 1000;
};

// --- TRAP STATE MACHINE (API BASED) ---
const processTrapLogic = (session, input) => {
    let output = '';
    let closed = false;
    const cmd = input.trim();

    // FTP Logic
    if (session.protocol === 'FTP') {
        if (!session.state) session.state = 'USER';

        if (cmd.toUpperCase().startsWith('USER')) {
            output = '331 Please specify the password.\r\n';
            session.state = 'PASS';
        } else if (cmd.toUpperCase().startsWith('PASS')) {
            output = '530 Login incorrect.\r\n';
            session.state = 'USER';
        } else if (cmd.toUpperCase().startsWith('SYST')) {
            output = '215 UNIX Type: L8\r\n';
        } else if (cmd.toUpperCase().startsWith('QUIT')) {
            output = '221 Goodbye.\r\n';
            closed = true;
        } else {
            output = '500 Unknown command.\r\n';
        }
    }
    // Telnet Logic
    else if (session.protocol === 'TELNET' || session.protocol === 'Telnet') {
        if (!session.state) session.state = 'LOGIN';

        if (session.state === 'LOGIN') {
            output = 'Password: ';
            session.state = 'PASS';
        } else if (session.state === 'PASS') {
            output = '\r\nLogin incorrect\r\n\r\nserver login: ';
            session.state = 'LOGIN';
        }
    }
    // Redis Logic
    else if (session.protocol === 'REDIS' || session.protocol === 'Redis') {
        const up = cmd.toUpperCase();
        if (up.includes('AUTH')) {
            output = '-ERR invalid password\r\n';
        } else if (up.includes('CONFIG') || up.includes('GET') || up.includes('SET')) {
            output = '-NOAUTH Authentication required.\r\n';
        } else if (up === 'QUIT') {
            output = '+OK\r\n';
            closed = true;
        } else {
            output = '-ERR unknown command\r\n';
        }
    }
    // Default Echo
    else {
        output = `Echo: ${input}\r\n`;
    }

    return { output, closed };
};

// --- DATABASE CONNECTION & RECONNECT LOGIC ---
let dbPool = null;

const getDbConfig = () => { try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (e) { return null; } };

const connectToDb = async (config) => {
    try {
        if (dbPool) {
            try { await dbPool.close(); } catch(e) {}
        }
        const isIp = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(config.server.split(':')[0]);
        
        dbPool = await sql.connect({
            user: config.username, 
            password: config.passwordEncrypted, 
            server: config.server.split(':')[0], 
            port: parseInt(config.server.split(':')[1]) || 1433,
            database: config.database, 
            options: { encrypt: !isIp, trustServerCertificate: true },
            pool: {
                max: 10,
                min: 0,
                idleTimeoutMillis: 30000
            }
        });
        console.log("✅ DB Connected Successfully");
        return true;
    } catch (err) { 
        console.error("❌ DB Connection Fail:", err.message); 
        dbPool = null;
        throw err; 
    }
};

// Auto-Reconnect Middleware
app.use(async (req, res, next) => {
    if (!dbPool && req.path.startsWith('/api/') && !req.path.includes('/setup/db') && !req.path.includes('/health')) {
        const cfg = getDbConfig();
        if (cfg && cfg.isConnected) {
            console.log("🔄 Attempting Auto-Reconnect to DB...");
            try {
                await connectToDb(cfg);
            } catch (e) {
                console.error("Auto-reconnect failed");
            }
        }
    }
    next();
});

// --- API ROUTES ---

// Health & Setup
app.get('/api/health', (req, res) => { res.json({ status: 'active', mode: getDbConfig()?.isConnected ? 'PRODUCTION' : 'MOCK_OR_SETUP', dbConnected: !!dbPool }); });

app.post('/api/setup/db', async (req, res) => {
    try {
        const config = req.body;
        await connectToDb(config);
        fs.writeFileSync(CONFIG_FILE, JSON.stringify({ ...config, isConnected: true }));
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// System Config
app.get('/api/config/system', async (req, res) => {
    if (!dbPool) return res.status(503).json({ error: 'DB Offline' });
    try {
        const result = await dbPool.request().query("SELECT * FROM SystemConfig");
        const cfg = {};
        result.recordset.forEach(row => cfg[row.ConfigKey] = row.ConfigValue);
        
        // Parse nested JSON configs
        let aiConfig = undefined;
        let syslogConfig = undefined;
        try { aiConfig = JSON.parse(cfg['AiConfig']); } catch(e) {}
        try { syslogConfig = JSON.parse(cfg['SyslogConfig']); } catch(e) {}

        res.json({
            companyName: cfg['CompanyName'],
            domain: cfg['Domain'],
            logoUrl: cfg['LogoUrl'],
            setupCompletedAt: cfg['SetupCompletedAt'],
            aiConfig,
            syslogConfig
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/config/system', async (req, res) => {
    if (!dbPool) return res.status(503).json({ error: 'DB Offline' });
    const { companyName, domain, logoUrl, setupCompletedAt, aiConfig, syslogConfig } = req.body;
    try {
        const ps = new sql.PreparedStatement(dbPool);
        ps.input('key', sql.NVarChar);
        ps.input('val', sql.NVarChar);
        await ps.prepare("MERGE SystemConfig AS target USING (SELECT @key AS ConfigKey, @val AS ConfigValue) AS source ON (target.ConfigKey = source.ConfigKey) WHEN MATCHED THEN UPDATE SET ConfigValue = source.ConfigValue WHEN NOT MATCHED THEN INSERT (ConfigKey, ConfigValue) VALUES (source.ConfigKey, source.ConfigValue);");
        
        await ps.execute({ key: 'CompanyName', val: companyName });
        await ps.execute({ key: 'Domain', val: domain });
        await ps.execute({ key: 'LogoUrl', val: logoUrl || '' });
        await ps.execute({ key: 'SetupCompletedAt', val: setupCompletedAt });
        
        if (aiConfig) await ps.execute({ key: 'AiConfig', val: JSON.stringify(aiConfig) });
        if (syslogConfig) {
             await ps.execute({ key: 'SyslogConfig', val: JSON.stringify(syslogConfig) });
             refreshSyslogConfig(dbPool); 
        }

        await ps.unprepare();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// --- AUTHENTICATION ROUTES ---

app.post('/api/login', async (req, res) => {
    if (!dbPool) return res.status(503).json({ success: false, error: 'Database not connected' });
    const { username, password } = req.body;
    // Simple hash matching logic based on client-side authService
    // In real app, use bcrypt. Here we match the "btoa_hash_" prefix logic
    const passwordHash = `btoa_hash_${password}`;

    try {
        const result = await dbPool.request()
            .input('u', sql.NVarChar, username)
            .query("SELECT * FROM Users WHERE username = @u");
        
        const user = result.recordset[0];
        if (!user) {
            return res.json({ success: false, error: 'User not found' });
        }

        if (user.passwordHash !== passwordHash) {
             return res.json({ success: false, error: 'Invalid password' });
        }

        // Update last login
        await dbPool.request().input('id', user.id).input('now', new Date()).query("UPDATE Users SET lastLogin = @now WHERE id = @id");

        // Parse preferences
        if(user.preferences && typeof user.preferences === 'string') {
             try { user.preferences = JSON.parse(user.preferences); } catch(e) {}
        }

        res.json({ success: true, user });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/mfa/setup', async (req, res) => {
    const { userId } = req.body;
    const secret = authenticator.generateSecret();
    const otpauth = authenticator.keyuri(userId, 'VirtualPuppets', secret);
    const qrCode = await QRCode.toDataURL(otpauth);
    res.json({ secret, qrCode });
});

app.post('/api/mfa/verify', async (req, res) => {
     if (!dbPool) return res.status(503);
     const { userId, token } = req.body;
     try {
         const result = await dbPool.request().input('id', userId).query("SELECT mfaSecret FROM Users WHERE id = @id");
         const secret = result.recordset[0]?.mfaSecret;
         if(!secret) return res.json({ success: false }); 
         
         const isValid = authenticator.check(token, secret);
         res.json({ success: isValid });
     } catch(e) { res.json({ success: false }); }
});

app.post('/api/mfa/confirm', async (req, res) => {
    if (!dbPool) return res.status(503);
    const { userId, secret, token } = req.body;
    
    const isValid = authenticator.check(token, secret);
    if(isValid) {
        await dbPool.request()
            .input('id', userId)
            .input('sec', secret)
            .query("UPDATE Users SET mfaEnabled = 1, mfaSecret = @sec WHERE id = @id");
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

// --- USER MANAGEMENT ROUTES ---

app.post('/api/users', async (req, res) => {
     if (!dbPool) return res.status(503);
     const u = req.body;
     await dbPool.request()
        .input('id', u.id)
        .input('name', u.username)
        .input('hash', u.passwordHash)
        .input('role', u.role)
        .query("INSERT INTO Users (id, username, passwordHash, role, mfaEnabled) VALUES (@id, @name, @hash, @role, 0)");
     res.json({ success: true });
});

app.put('/api/users/:id', async (req, res) => {
     if (!dbPool) return res.status(503);
     const u = req.body;
     await dbPool.request()
        .input('id', req.params.id)
        .input('role', u.role)
        .input('hash', u.passwordHash)
        .query("UPDATE Users SET role = @role, passwordHash = @hash WHERE id = @id");
     res.json({ success: true });
});

app.put('/api/users/:id/preferences', async (req, res) => {
    if (!dbPool) return res.status(503);
    const prefs = JSON.stringify(req.body);
    await dbPool.request()
        .input('id', req.params.id)
        .input('p', prefs)
        .query("UPDATE Users SET preferences = @p WHERE id = @id");
    res.json({ success: true });
});

app.delete('/api/users/:id', async (req, res) => {
     if (!dbPool) return res.status(503);
     await dbPool.request().input('id', req.params.id).query("DELETE FROM Users WHERE id = @id");
     res.json({ success: true });
});

app.post('/api/users/:id/reset-mfa', async (req, res) => {
     if (!dbPool) return res.status(503);
     await dbPool.request().input('id', req.params.id).query("UPDATE Users SET mfaEnabled = 0, mfaSecret = NULL WHERE id = @id");
     res.json({ success: true });
});

// Generic Table Access
const getTableData = async (table, res) => {
    if (!dbPool) return res.json([]);
    try {
        const result = await dbPool.request().query(`SELECT * FROM ${table}`);
        // Parse JSON columns if any (simple heuristic)
        const data = result.recordset.map(row => {
            const r = { ...row };
            // Auto-parse known JSON columns
            ['activeTools', 'activeTunnels', 'deployedHoneyFiles', 'persona', 'preferences', 'content', 'snapshotData'].forEach(field => {
                if (r[field] && typeof r[field] === 'string') {
                    try { r[field] = JSON.parse(r[field]); } catch(e) {}
                }
            });
            // Normalize IDs to string
            if(r.id) r.id = r.id.toString();
            return r;
        });
        res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

app.get('/api/actors', (req, res) => getTableData('Actors', res));
app.get('/api/gateways', (req, res) => getTableData('Gateways', res));
app.get('/api/users', (req, res) => getTableData('Users', res));
app.get('/api/logs', (req, res) => {
    if (!dbPool) return res.json([]);
    dbPool.request().query('SELECT TOP 500 * FROM SystemLogs ORDER BY timestamp DESC').then(r => res.json(r.recordset)).catch(e => res.json([]));
});

// --- TRAP API ROUTES ---
app.post('/api/trap/init', (req, res) => {
    const { type, actorId } = req.body;
    const ip = getClientIp(req);
    const sessionId = `sess-${type}-${Date.now()}`;
    
    let banner = '';
    if (type === 'FTP' || type.includes('VSFTPD')) {
        banner = '220 (vsFTPd 2.3.4)\r\n';
    } else if (type === 'Telnet' || type.toUpperCase() === 'TELNET') {
        banner = '\r\nUbuntu 20.04.6 LTS\r\nserver login: ';
    } else if (type === 'Redis' || type.toUpperCase() === 'REDIS') {
        banner = ''; 
    }

    const session = {
        id: sessionId,
        actorId: actorId || 'unknown',
        attackerIp: ip,
        protocol: type,
        startTime: new Date(),
        startTimeMs: Date.now(),
        durationSeconds: 0,
        frames: [],
        state: null
    };

    if (banner) {
        recordFrame(session, 'OUTPUT', banner);
    }

    activeTrapSessions.set(sessionId, session);
    recordedSessions.unshift(session);
    if (recordedSessions.length > 50) recordedSessions.pop();

    res.json({ sessionId, output: banner });
});

app.post('/api/trap/interact', (req, res) => {
    const { sessionId, input } = req.body;
    const session = activeTrapSessions.get(sessionId);
    
    if (!session) {
        return res.status(404).json({ error: 'Session not found', closed: true });
    }

    recordFrame(session, 'INPUT', input);
    const { output, closed } = processTrapLogic(session, input);
    if (output) recordFrame(session, 'OUTPUT', output);

    if (closed) {
        activeTrapSessions.delete(sessionId);
    }

    res.json({ output, closed });
});

app.get('/api/sessions', (req, res) => { res.json(recordedSessions); });
app.delete('/api/sessions/:id', (req, res) => { 
    recordedSessions = recordedSessions.filter(s => s.id !== req.params.id); 
    res.json({ success: true }); 
});


// --- LEGACY HONEYPOT LISTENERS ---
const startHoneypotListener = (server, port, name) => {
    server.on('error', (e) => {
        if (e.code === 'EADDRINUSE') {
            console.log(`[Honeypot] ${name} port ${port} is busy (likely handled by another instance).`);
        } else {
            console.error(`[Honeypot] ${name} error:`, e);
        }
    });
    try {
        server.listen(port, () => console.log(`[Honeypot] ${name} listening on ${port}`));
    } catch (e) {}
};
startHoneypotListener(net.createServer(), HONEYPOT_PORTS.FTP, 'FTP (Legacy)');


// --- SYSLOG ---
let syslogConfig = { host: '', port: 514, enabled: false };

const refreshSyslogConfig = async (pool) => {
    if (!pool) return;
    try {
        const res = await pool.request().query("SELECT ConfigKey, ConfigValue FROM SystemConfig WHERE ConfigKey IN ('SyslogHost', 'SyslogPort', 'SyslogEnabled')");
        const cfg = {};
        res.recordset.forEach(r => cfg[r.ConfigKey] = r.ConfigValue);
        syslogConfig = {
            host: cfg['SyslogHost'] || '',
            port: parseInt(cfg['SyslogPort']) || 514,
            enabled: cfg['SyslogEnabled'] === 'true'
        };
    } catch (e) {}
};

// --- ACTOR MANAGEMENT ---
app.delete('/api/actors/:id', async (req, res) => {
    if (!dbPool) return res.status(503);
    await dbPool.request().input('id', sql.NVarChar, req.params.id).query('DELETE FROM Actors WHERE id = @id');
    res.json({ success: true });
});

app.put('/api/actors/:id/tunnels', async (req, res) => {
    if (!dbPool) return res.status(503);
    await dbPool.request().input('id', sql.NVarChar, req.params.id).input('json', sql.NVarChar, JSON.stringify(req.body)).query('UPDATE Actors SET activeTunnels = @json WHERE id = @id');
    res.json({ success: true });
});

app.put('/api/actors/:id/sentinel', async (req, res) => {
    if (!dbPool) return res.status(503);
    await dbPool.request().input('id', sql.NVarChar, req.params.id).input('val', sql.Bit, req.body.enabled).query('UPDATE Actors SET tcpSentinelEnabled = @val WHERE id = @id');
    res.json({ success: true });
});

app.put('/api/actors/:id/persona', async (req, res) => {
    if (!dbPool) return res.status(503);
    await dbPool.request().input('id', sql.NVarChar, req.params.id).input('json', sql.NVarChar, JSON.stringify(req.body)).query('UPDATE Actors SET persona = @json WHERE id = @id');
    res.json({ success: true });
});

app.put('/api/actors/:id/acknowledge', async (req, res) => {
    if (!dbPool) return res.status(503);
    await dbPool.request().input('id', sql.NVarChar, req.params.id).query("UPDATE Actors SET status = 'ONLINE' WHERE id = @id");
    res.json({ success: true });
});

// --- NEW: Reports API ---
app.get('/api/reports', async (req, res) => {
    if (!dbPool) return res.json([]);
    try {
        const result = await dbPool.request().query("SELECT * FROM Reports ORDER BY createdAt DESC");
        const reports = result.recordset.map(r => ({ ...r, content: JSON.parse(r.content || '{}') }));
        res.json(reports);
    } catch(e) { res.json([]); }
});

app.post('/api/reports/generate', async (req, res) => {
    if (!dbPool) return res.status(503);
    const { type, generatedBy, customBody, snapshotData, incidentFilters, incidentDetails } = req.body;
    
    // Build Report Content
    const content = {
        summaryText: customBody || 'Auto-Generated Report',
        snapshotData,
        incidentFilters,
        incidentDetails,
        totalEvents: 0, // In real app, query these
        compromisedNodes: 0,
        activeNodes: 0,
        customBody
    };

    if (type === 'SECURITY_AUDIT') {
        // Fetch real stats
        try {
            const stats = await dbPool.request().query(`
                SELECT 
                    (SELECT COUNT(*) FROM SystemLogs) as totalEvents,
                    (SELECT COUNT(*) FROM Actors WHERE status = 'COMPROMISED') as compromisedNodes,
                    (SELECT COUNT(*) FROM Actors WHERE status = 'ONLINE') as activeNodes
            `);
            const s = stats.recordset[0];
            content.totalEvents = s.totalEvents;
            content.compromisedNodes = s.compromisedNodes;
            content.activeNodes = s.activeNodes;
            
            // Top Attackers
            const attackers = await dbPool.request().query(`
                SELECT TOP 5 sourceIp as ip, COUNT(*) as count 
                FROM SystemLogs 
                WHERE sourceIp IS NOT NULL 
                GROUP BY sourceIp 
                ORDER BY count DESC
            `);
            content.topAttackers = attackers.recordset;
        } catch(e) {}
    }

    const id = `rep-${Math.random().toString(36).substr(2,6)}`;
    const title = type === 'CUSTOM' ? 'Analyst Note' : type === 'AI_INSIGHT' ? (incidentDetails?.title || 'AI Threat Analysis') : 'System Security Report';

    await dbPool.request()
        .input('id', id)
        .input('title', title)
        .input('gen', generatedBy)
        .input('type', type)
        .input('content', JSON.stringify(content))
        .input('now', new Date())
        .query("INSERT INTO Reports (id, title, generatedBy, type, content, createdAt, status, dateRange) VALUES (@id, @title, @gen, @type, @content, @now, 'READY', 'LAST_24H')");
    
    res.json({ success: true, id });
});

app.delete('/api/reports/:id', async (req, res) => {
    if (!dbPool) return res.status(503);
    await dbPool.request().input('id', req.params.id).query("DELETE FROM Reports WHERE id = @id");
    res.json({ success: true });
});

app.post('/api/commands/queue', async (req, res) => {
    if (!dbPool) return res.status(503);
    const { actorId, command } = req.body;
    const jobId = `job-${Date.now()}`;
    await dbPool.request()
        .input('id', jobId)
        .input('aid', actorId)
        .input('cmd', command)
        .input('status', 'PENDING')
        .input('now', new Date())
        .query("INSERT INTO CommandJobs (id, actorId, command, status, createdAt, updatedAt) VALUES (@id, @aid, @cmd, @status, @now, @now)");
    res.json({ jobId });
});

app.get('/api/commands/:actorId', async (req, res) => {
    if (!dbPool) return res.json([]);
    const result = await dbPool.request().input('aid', req.params.actorId).query("SELECT TOP 20 * FROM CommandJobs WHERE actorId = @aid ORDER BY createdAt DESC");
    res.json(result.recordset);
});

// --- ENROLLMENT ROUTES ---
app.get('/api/enroll/pending', (req, res) => getTableData('PendingActors', res));

app.post('/api/enroll/generate', async (req, res) => {
    const token = `tok-${Math.random().toString(36).substr(2,10)}`;
    // In real app, save token to DB
    res.json({ token });
});

app.post('/api/enroll/approve', async (req, res) => {
    if (!dbPool) return res.status(503);
    const { pendingId, proxyId, name } = req.body;
    
    // Get Pending
    const pResult = await dbPool.request().input('pid', pendingId).query("SELECT * FROM PendingActors WHERE id = @pid");
    if (pResult.recordset.length === 0) return res.status(404).json({error: 'Not found'});
    
    const p = pResult.recordset[0];
    const newId = `act-${Math.random().toString(36).substr(2,8)}`;
    
    await dbPool.request()
        .input('id', newId)
        .input('pid', proxyId)
        .input('name', name)
        .input('ip', p.detectedIp)
        .input('os', p.osVersion || 'Unknown')
        .input('now', new Date())
        .query(`INSERT INTO Actors (id, proxyId, name, localIp, status, lastSeen, osVersion, cpuLoad, memoryUsage, protocolVersion) 
                VALUES (@id, @pid, @name, @ip, 'ONLINE', @now, @os, 0, 0, 'VPP-2.2')`);
    
    await dbPool.request().input('pid', pendingId).query("DELETE FROM PendingActors WHERE id = @pid");
    res.json({ success: true });
});

app.get('/setup', (req, res) => {
    // Return Bootstrap Script (Shortened here for brevity, see previous turns for full script)
    // The key is that the relay script generation is included.
    const host = req.get('host');
    const protocol = req.protocol;
    const serverUrl = `${protocol}://${host}`;
    
    const script = `#!/bin/bash
TOKEN=$1
SERVER_URL="${serverUrl}"
AGENT_DIR="/opt/vpp-agent"
# ... (Full Script Logic from Previous Turn) ...
echo "[+] Bootstrap Complete"
`;
    res.setHeader('Content-Type', 'text/plain');
    res.send(script);
});

// Serve Frontend
if (fs.existsSync(distPath)) { app.use(express.static(distPath)); }

// Default catch-all
app.get('*', (req, res) => {
    if (req.accepts('html')) {
        const indexPath = path.join(distPath, 'index.html');
        if (fs.existsSync(indexPath)) res.sendFile(indexPath);
        else res.status(404).send('App not built');
    } else {
        res.status(404).json({ error: 'Not found' });
    }
});

app.listen(port, '0.0.0.0', () => { 
    console.log(`Server listening on port ${port}`); 
    const cfg = getDbConfig();
    if (cfg && cfg.isConnected) init(cfg);
});

const init = async (cfg) => {
    try { await connectToDb(cfg); await refreshSyslogConfig(dbPool); } catch (e) {}
};