
import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import sql from 'mssql';
import cors from 'cors';
import bodyParser from 'body-parser';
import { authenticator } from 'otplib';
import dgram from 'dgram';
import net from 'net';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 8080;
const distPath = path.join(__dirname, 'dist');
const CONFIG_FILE = path.join(__dirname, 'db-config.json');

// --- GLOBAL VARIABLES ---
let dbPool = null;
let recordedSessions = []; 
let trapSessions = {};
let syslogConfig = { host: '', port: 514, enabled: false };

// --- HONEYPOT PORTS ---
const HONEYPOT_PORTS = {
    FTP: 10021,
    TELNET: 10023,
    REDIS: 10079,
    HTTP: 10080
};

// --- MIDDLEWARE ---
authenticator.options = { window: [2, 2] };
app.use(cors());
app.use(bodyParser.json({
    limit: '10mb',
    verify: (req, res, buf) => { req.rawBody = buf.toString(); }
}));

// Serve Static Files
if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
}

// JSON Syntax Error Handler
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

// ==========================================
// 1. HONEYPOT SERVICES
// ==========================================

const createSession = (socket, protocol) => {
    const startTime = Date.now();
    const sessionId = `sess-${protocol.toLowerCase()}-${startTime}`;
    const remoteAddress = socket.remoteAddress ? socket.remoteAddress.replace('::ffff:', '') : 'Unknown';
    
    const session = {
        id: sessionId,
        actorId: 'unknown',
        attackerIp: remoteAddress,
        protocol: protocol,
        startTime: new Date(startTime),
        durationSeconds: 0,
        frames: []
    };

    recordedSessions.unshift(session);
    if (recordedSessions.length > 50) recordedSessions.pop();

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

const startFtpServer = () => {
    const server = net.createServer((socket) => {
        const { record } = createSession(socket, 'FTP');
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
    server.on('error', (e) => { if (e.code !== 'EADDRINUSE') console.error('FTP Error:', e.message); });
    server.listen(HONEYPOT_PORTS.FTP);
};

const startTelnetServer = () => {
    const server = net.createServer((socket) => {
        const { record } = createSession(socket, 'TELNET');
        let state = 'LOGIN';
        const send = (msg) => { socket.write(msg); record('OUTPUT', msg); };
        send('\r\nUbuntu 20.04.6 LTS\r\nserver login: ');
        socket.on('data', (data) => {
            record('INPUT', data);
            if (state === 'LOGIN') { send('Password: '); state = 'PASS'; }
            else if (state === 'PASS') { setTimeout(() => { send('\r\nLogin incorrect\r\n\r\nserver login: '); state = 'LOGIN'; }, 800); }
        });
    });
    server.on('error', (e) => { if (e.code !== 'EADDRINUSE') console.error('Telnet Error:', e.message); });
    server.listen(HONEYPOT_PORTS.TELNET);
};

const startRedisServer = () => {
    const server = net.createServer((socket) => {
        const { record } = createSession(socket, 'REDIS');
        const send = (msg) => { socket.write(msg); record('OUTPUT', msg); };
        socket.on('data', (data) => {
            record('INPUT', data);
            const cmd = data.toString().trim().toUpperCase();
            if (cmd.includes('CONFIG') || cmd.includes('GET')) send('-NOAUTH Authentication required.\r\n');
            else if (cmd.includes('AUTH')) send('-ERR invalid password\r\n');
            else send('-ERR unknown command\r\n');
        });
    });
    server.on('error', (e) => { if (e.code !== 'EADDRINUSE') console.error('Redis Error:', e.message); });
    server.listen(HONEYPOT_PORTS.REDIS);
};

startFtpServer();
startTelnetServer();
startRedisServer();

// ==========================================
// 2. DATABASE
// ==========================================

const getDbConfig = () => {
    if (fs.existsSync(CONFIG_FILE)) {
        try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return null; }
    }
    return null;
};

const connectToDb = async (config) => {
    try {
        if(dbPool) await dbPool.close();
        const isIp = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(config.server.split(':')[0]);
        dbPool = await sql.connect({
            user: config.username, password: config.passwordEncrypted, 
            server: config.server.split(':')[0], port: parseInt(config.server.split(':')[1]) || 1433,
            database: config.database, options: { encrypt: !isIp, trustServerCertificate: true }
        });
        console.log("✅ DB Connected");
        return true;
    } catch(e) { console.error("❌ DB Error", e.message); return false; } 
};

const refreshSyslogConfig = async (pool) => {
    if (!pool) return;
    try {
        const res = await pool.request().query("SELECT ConfigKey, ConfigValue FROM SystemConfig WHERE ConfigKey IN ('SyslogHost', 'SyslogPort', 'SyslogEnabled')");
        const cfg = {};
        res.recordset.forEach(r => cfg[r.ConfigKey] = r.ConfigValue);
        syslogConfig = { host: cfg['SyslogHost'] || '', port: parseInt(cfg['SyslogPort']) || 514, enabled: cfg['SyslogEnabled'] === 'true' };
    } catch (e) {}
};

const sendToSyslog = (level, processName, message) => {
    if (!syslogConfig.enabled || !syslogConfig.host) return;
    const client = dgram.createSocket('udp4');
    const msg = `<134>${new Date().toISOString()} VPP-C2 ${processName}: ${message}`;
    client.send(msg, syslogConfig.port, syslogConfig.host, (err) => { client.close(); });
};

const runSchemaMigrations = async (pool) => {
    if (!pool) return;
    const req = new sql.Request(pool);
    try {
        await req.query(`IF OBJECT_ID('SystemConfig','U') IS NULL CREATE TABLE SystemConfig (ConfigKey NVARCHAR(50) PRIMARY KEY, ConfigValue NVARCHAR(MAX))`);
        await req.query(`IF OBJECT_ID('Users','U') IS NULL CREATE TABLE Users (UserId NVARCHAR(50) PRIMARY KEY, Username NVARCHAR(100), PasswordHash NVARCHAR(255), Role NVARCHAR(20), MfaEnabled BIT DEFAULT 0, MfaSecret NVARCHAR(100), LastLogin DATETIME, Preferences NVARCHAR(MAX))`);
        await req.query(`IF OBJECT_ID('Actors','U') IS NULL CREATE TABLE Actors (ActorId NVARCHAR(50) PRIMARY KEY, HwId NVARCHAR(100), GatewayId NVARCHAR(50), Name NVARCHAR(100), Status NVARCHAR(20), LocalIp NVARCHAR(50), LastSeen DATETIME, Config NVARCHAR(MAX), OsVersion NVARCHAR(100), TunnelsJson NVARCHAR(MAX), Persona NVARCHAR(MAX), HoneyFilesJson NVARCHAR(MAX), HasWifi BIT DEFAULT 0, HasBluetooth BIT DEFAULT 0, WifiScanningEnabled BIT DEFAULT 0, BluetoothScanningEnabled BIT DEFAULT 0, CpuLoad FLOAT DEFAULT 0, MemoryUsage FLOAT DEFAULT 0, Temperature FLOAT DEFAULT 0, TcpSentinelEnabled BIT DEFAULT 0, AgentVersion NVARCHAR(50))`);
        await req.query(`IF OBJECT_ID('Gateways','U') IS NULL CREATE TABLE Gateways (GatewayId NVARCHAR(50) PRIMARY KEY, Name NVARCHAR(100), Location NVARCHAR(100), Status NVARCHAR(20), IpAddress NVARCHAR(50), Lat FLOAT, Lng FLOAT)`);
        await req.query(`IF OBJECT_ID('Logs','U') IS NULL CREATE TABLE Logs (LogId NVARCHAR(50) PRIMARY KEY, ActorId NVARCHAR(50), Level NVARCHAR(20), Process NVARCHAR(50), Message NVARCHAR(MAX), SourceIp NVARCHAR(50), Timestamp DATETIME)`);
        await req.query(`IF OBJECT_ID('CommandQueue','U') IS NULL CREATE TABLE CommandQueue (JobId NVARCHAR(50) PRIMARY KEY, ActorId NVARCHAR(50), Command NVARCHAR(MAX), Status NVARCHAR(20), Output NVARCHAR(MAX), CreatedAt DATETIME, UpdatedAt DATETIME)`);
        await req.query(`IF OBJECT_ID('Reports','U') IS NULL CREATE TABLE Reports (ReportId NVARCHAR(50) PRIMARY KEY, Title NVARCHAR(100), GeneratedBy NVARCHAR(100), Type NVARCHAR(50), CreatedAt DATETIME, ContentJson NVARCHAR(MAX))`);
        await req.query(`IF OBJECT_ID('EnrollmentTokens','U') IS NULL CREATE TABLE EnrollmentTokens (Token NVARCHAR(50) PRIMARY KEY, Type NVARCHAR(20), TargetId NVARCHAR(50), ConfigJson NVARCHAR(MAX), CreatedAt DATETIME, IsUsed BIT)`);
        await req.query(`IF OBJECT_ID('PendingActors','U') IS NULL CREATE TABLE PendingActors (Id NVARCHAR(50) PRIMARY KEY, HwId NVARCHAR(100), DetectedIp NVARCHAR(50), TargetGatewayId NVARCHAR(50), DetectedAt DATETIME, OsVersion NVARCHAR(100))`);
        await req.query(`IF OBJECT_ID('WifiNetworks','U') IS NULL CREATE TABLE WifiNetworks (Id NVARCHAR(50) PRIMARY KEY, Ssid NVARCHAR(100), Bssid NVARCHAR(50), SignalStrength INT, Security NVARCHAR(20), Channel INT, ActorId NVARCHAR(50), ActorName NVARCHAR(100), LastSeen DATETIME)`);
        await req.query(`IF OBJECT_ID('BluetoothDevices','U') IS NULL CREATE TABLE BluetoothDevices (Id NVARCHAR(50) PRIMARY KEY, Name NVARCHAR(100), Mac NVARCHAR(50), Rssi INT, Type NVARCHAR(20), ActorId NVARCHAR(50), ActorName NVARCHAR(100), LastSeen DATETIME)`);
        
        const uCheck = await req.query("SELECT * FROM Users WHERE Username = 'superadmin'");
        if (uCheck.recordset.length === 0) {
            await req.query("INSERT INTO Users (UserId, Username, PasswordHash, Role) VALUES ('usr-super-01', 'superadmin', 'btoa_hash_123qweASDF!!@!', 'SUPERADMIN')");
        }
    } catch (e) {}
};

const init = async () => {
    const cfg = getDbConfig();
    if (cfg && cfg.isConnected) {
        await connectToDb(cfg);
        await runSchemaMigrations(dbPool);
        await refreshSyslogConfig(dbPool);
    }
};
init();

// --- SCHEDULER: Wireless Recon (2 mins) ---
setInterval(async () => {
    if (!dbPool) return;
    try {
        const res = await dbPool.request().query("SELECT ActorId FROM Actors WHERE Status = 'ONLINE' AND (WifiScanningEnabled = 1 OR BluetoothScanningEnabled = 1)");
        for (const row of res.recordset) {
            const jobId = `scan-${Date.now()}-${Math.random().toString(36).substr(2,5)}`;
            await dbPool.request()
                .input('jid', sql.NVarChar, jobId)
                .input('aid', sql.NVarChar, row.ActorId)
                .input('cmd', sql.NVarChar, 'vpp-agent --scan-wireless')
                .query("INSERT INTO CommandQueue (JobId, ActorId, Command, Status, CreatedAt, UpdatedAt) VALUES (@jid, @aid, @cmd, 'PENDING', GETDATE(), GETDATE())");
        }
    } catch (e) {}
}, 120000);

// ==========================================
// 3. API ROUTES
// ==========================================

// --- CORE SYSTEM ROUTES ---
app.get('/api/health', (req, res) => { 
    res.json({ status: 'active', mode: getDbConfig()?.isConnected ? 'PRODUCTION' : 'MOCK', dbConnected: !!dbPool }); 
});

app.get('/api/config/system', async (req, res) => {
    if (!dbPool) return res.status(503).json({});
    try {
        const result = await dbPool.request().query("SELECT * FROM SystemConfig");
        const config = {};
        result.recordset.forEach(row => {
            try { config[row.ConfigKey] = JSON.parse(row.ConfigValue); } catch { config[row.ConfigKey] = row.ConfigValue; }
        });
        res.json(config);
    } catch (e) { res.status(500).json({}); }
});

app.post('/api/config/system', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    try {
        for (const [key, value] of Object.entries(req.body)) {
            const valStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
            await dbPool.request().input('k', sql.NVarChar, key).input('v', sql.NVarChar, valStr).query(`MERGE SystemConfig AS target USING (SELECT @k, @v) AS source (Key, Val) ON (target.ConfigKey = source.Key) WHEN MATCHED THEN UPDATE SET ConfigValue = source.Val WHEN NOT MATCHED THEN INSERT (ConfigKey, ConfigValue) VALUES (source.Key, source.Val);`);
        }
        await refreshSyslogConfig(dbPool);
        res.json({success: true});
    } catch(e) { res.json({success: false}); }
});

app.post('/api/setup/db', async (req, res) => { 
    try { 
        await connectToDb(req.body); 
        fs.writeFileSync(CONFIG_FILE, JSON.stringify({...req.body, isConnected: true}, null, 2)); 
        await runSchemaMigrations(dbPool); 
        res.json({ success: true }); 
    } catch (err) { res.status(500).json({ success: false, error: err.message }); } 
});

// --- AUTH ROUTES ---
app.post('/api/login', async (req, res) => { 
    if (!dbPool) return res.json({success: false, error: "DB not connected"}); 
    const { username, password } = req.body; 
    const hash = `btoa_hash_${password}`; 
    try { 
        const result = await dbPool.request().input('u', sql.NVarChar, username).query("SELECT * FROM Users WHERE Username = @u"); 
        if (result.recordset.length > 0) { 
            const user = result.recordset[0]; 
            if (user.PasswordHash === hash) { 
                return res.json({ success: true, user: { id: user.UserId, username: user.Username, role: user.Role, mfaEnabled: user.MfaEnabled, preferences: user.Preferences ? JSON.parse(user.Preferences) : {} } }); 
            } 
        } 
        res.json({ success: false, error: "Invalid credentials" }); 
    } catch (e) { res.json({ success: false, error: e.message }); } 
});

// --- MFA ROUTES ---
app.post('/api/mfa/setup', async (req, res) => {
    const { userId } = req.body;
    const secret = authenticator.generateSecret();
    const otpauth = authenticator.keyuri(userId, 'Virtual Puppets C2', secret);
    const qrCode = await QRCode.toDataURL(otpauth);
    res.json({ secret, qrCode });
});
app.post('/api/mfa/verify', async (req, res) => {
    // This endpoint checks against DB secret
    if (!dbPool) return res.json({success: false});
    const { userId, token } = req.body;
    try {
        const result = await dbPool.request().input('uid', sql.NVarChar, userId).query("SELECT MfaSecret FROM Users WHERE UserId = @uid");
        if (result.recordset.length === 0) return res.json({success: false});
        const secret = result.recordset[0].MfaSecret;
        if (!secret) return res.json({success: true}); // Bypass if not set
        const isValid = authenticator.check(token, secret);
        res.json({success: isValid});
    } catch(e) { res.json({success: false}); }
});
app.post('/api/mfa/confirm', async (req, res) => {
    // This endpoint saves the secret
    if (!dbPool) return res.json({success: false});
    const { userId, secret, token } = req.body;
    if (authenticator.check(token, secret)) {
        await dbPool.request().input('uid', sql.NVarChar, userId).input('sec', sql.NVarChar, secret).query("UPDATE Users SET MfaSecret = @sec, MfaEnabled = 1 WHERE UserId = @uid");
        res.json({success: true});
    } else {
        res.json({success: false});
    }
});

// --- USER MANAGEMENT ---
app.get('/api/users', async (req, res) => {
    if (!dbPool) return res.json([]);
    try { const r = await dbPool.request().query("SELECT UserId as id, Username as username, Role as role, MfaEnabled as mfaEnabled FROM Users"); res.json(r.recordset); } catch(e) { res.json([]); }
});
app.post('/api/users', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    const { id, username, passwordHash, role } = req.body;
    try { await dbPool.request().input('id', sql.NVarChar, id).input('u', sql.NVarChar, username).input('p', sql.NVarChar, passwordHash).input('r', sql.NVarChar, role).query("INSERT INTO Users (UserId, Username, PasswordHash, Role) VALUES (@id, @u, @p, @r)"); res.json({success: true}); } catch(e) { res.json({success: false}); }
});
app.put('/api/users/:id', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    const { role, passwordHash } = req.body;
    try { 
        if (passwordHash) await dbPool.request().input('id', sql.NVarChar, req.params.id).input('p', sql.NVarChar, passwordHash).query("UPDATE Users SET PasswordHash = @p WHERE UserId = @id");
        await dbPool.request().input('id', sql.NVarChar, req.params.id).input('r', sql.NVarChar, role).query("UPDATE Users SET Role = @r WHERE UserId = @id");
        res.json({success: true}); 
    } catch(e) { res.json({success: false}); }
});
app.delete('/api/users/:id', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    try { await dbPool.request().input('id', sql.NVarChar, req.params.id).query("DELETE FROM Users WHERE UserId = @id"); res.json({success: true}); } catch(e) { res.json({success: false}); }
});
app.post('/api/users/:id/reset-mfa', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    try { await dbPool.request().input('id', sql.NVarChar, req.params.id).query("UPDATE Users SET MfaEnabled = 0, MfaSecret = NULL WHERE UserId = @id"); res.json({success: true}); } catch(e) { res.json({success: false}); }
});
app.put('/api/users/:id/preferences', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    try { await dbPool.request().input('id', sql.NVarChar, req.params.id).input('pref', sql.NVarChar, JSON.stringify(req.body)).query("UPDATE Users SET Preferences = @pref WHERE UserId = @id"); res.json({success: true}); } catch(e) { res.json({success: false}); }
});

// --- GATEWAYS ---
app.get('/api/gateways', async (req, res) => {
    if (!dbPool) return res.json([]);
    try { const r = await dbPool.request().query("SELECT * FROM Gateways"); res.json(r.recordset.map(g => ({ id: g.GatewayId, name: g.Name, location: g.Location, status: g.Status, ip: g.IpAddress, lat: g.Lat, lng: g.Lng }))); } catch(e) { res.json([]); }
});
app.post('/api/gateways', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    const { id, name, location, ip, status } = req.body;
    try { await dbPool.request().input('id', sql.NVarChar, id).input('n', sql.NVarChar, name).input('l', sql.NVarChar, location).input('i', sql.NVarChar, ip).input('s', sql.NVarChar, status).query("INSERT INTO Gateways (GatewayId, Name, Location, Status, IpAddress) VALUES (@id, @n, @l, @s, @i)"); res.json({success: true}); } catch(e) { res.json({success: false}); }
});
app.delete('/api/gateways/:id', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    try { await dbPool.request().input('id', sql.NVarChar, req.params.id).query("DELETE FROM Gateways WHERE GatewayId = @id"); res.json({success: true}); } catch(e) { res.json({success: false}); }
});

// --- ACTORS (FLEET) ---
app.get('/api/actors', async (req, res) => { 
    if (!dbPool) return res.json([]); 
    try { 
        const result = await dbPool.request().query("SELECT * FROM Actors"); 
        res.json(result.recordset.map(row => ({ 
            id: row.ActorId, proxyId: row.GatewayId, name: row.Name, localIp: row.LocalIp, status: row.Status, lastSeen: row.LastSeen, osVersion: row.OsVersion, 
            hasWifi: row.HasWifi, hasBluetooth: row.HasBluetooth, wifiScanningEnabled: row.WifiScanningEnabled, bluetoothScanningEnabled: row.BluetoothScanningEnabled, 
            cpuLoad: row.CpuLoad, memoryUsage: row.MemoryUsage, temperature: row.Temperature, tcpSentinelEnabled: row.TcpSentinelEnabled, 
            activeTunnels: row.TunnelsJson ? JSON.parse(row.TunnelsJson) : [], deployedHoneyFiles: row.HoneyFilesJson ? JSON.parse(row.HoneyFilesJson) : [], persona: row.Persona ? JSON.parse(row.Persona) : undefined 
        }))); 
    } catch (e) { res.status(500).json({error: e.message}); } 
});
app.put('/api/actors/:id', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    try { await dbPool.request().input('id', sql.NVarChar, req.params.id).input('n', sql.NVarChar, req.body.name).query("UPDATE Actors SET Name = @n WHERE ActorId = @id"); res.json({success: true}); } catch(e) { res.json({success: false}); }
});
app.delete('/api/actors/:id', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    try { await dbPool.request().input('id', sql.NVarChar, req.params.id).query("DELETE FROM Actors WHERE ActorId = @id"); res.json({success: true}); } catch(e) { res.json({success: false}); }
});
app.put('/api/actors/:id/tunnels', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    try { await dbPool.request().input('id', sql.NVarChar, req.params.id).input('j', sql.NVarChar, JSON.stringify(req.body)).query("UPDATE Actors SET TunnelsJson = @j WHERE ActorId = @id"); res.json({success: true}); } catch(e) { res.json({success: false}); }
});
app.put('/api/actors/:id/honeyfiles', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    try { await dbPool.request().input('id', sql.NVarChar, req.params.id).input('j', sql.NVarChar, JSON.stringify(req.body)).query("UPDATE Actors SET HoneyFilesJson = @j WHERE ActorId = @id"); res.json({success: true}); } catch(e) { res.json({success: false}); }
});
app.put('/api/actors/:id/persona', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    try { await dbPool.request().input('id', sql.NVarChar, req.params.id).input('j', sql.NVarChar, JSON.stringify(req.body)).query("UPDATE Actors SET Persona = @j WHERE ActorId = @id"); res.json({success: true}); } catch(e) { res.json({success: false}); }
});
app.put('/api/actors/:id/sentinel', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    try { await dbPool.request().input('id', sql.NVarChar, req.params.id).input('v', sql.Bit, req.body.enabled).query("UPDATE Actors SET TcpSentinelEnabled = @v WHERE ActorId = @id"); res.json({success: true}); } catch(e) { res.json({success: false}); }
});
app.put('/api/actors/:id/acknowledge', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    try { await dbPool.request().input('id', sql.NVarChar, req.params.id).query("UPDATE Actors SET Status = 'ONLINE' WHERE ActorId = @id"); res.json({success: true}); } catch(e) { res.json({success: false}); }
});
app.put('/api/actors/:id/scanning', async (req, res) => { 
    if (!dbPool) return res.json({success: false}); 
    const { type, enabled } = req.body; 
    try { 
        const col = type === 'WIFI' ? 'WifiScanningEnabled' : 'BluetoothScanningEnabled'; 
        await dbPool.request().input('id', sql.NVarChar, req.params.id).input('val', sql.Bit, enabled ? 1 : 0).query(`UPDATE Actors SET ${col} = @val WHERE ActorId = @id`); 
        res.json({success: true}); 
    } catch(e) { res.status(500).json({error: e.message}); } 
});

// --- COMMANDS ---
app.post('/api/commands/queue', async (req, res) => {
    if (!dbPool) return res.json({ jobId: null });
    const { actorId, command } = req.body;
    const jobId = `job-${Date.now()}`;
    try { await dbPool.request().input('jid', sql.NVarChar, jobId).input('aid', sql.NVarChar, actorId).input('cmd', sql.NVarChar, command).query("INSERT INTO CommandQueue (JobId, ActorId, Command, Status, CreatedAt, UpdatedAt) VALUES (@jid, @aid, @cmd, 'PENDING', GETDATE(), GETDATE())"); res.json({ jobId }); } catch(e) { res.json({ jobId: null }); }
});
app.get('/api/commands/:actorId', async (req, res) => {
    if (!dbPool) return res.json([]);
    try { const r = await dbPool.request().input('aid', sql.NVarChar, req.params.actorId).query("SELECT JobId as id, Command as command, Status as status, Output as output, CreatedAt as createdAt FROM CommandQueue WHERE ActorId = @aid ORDER BY CreatedAt DESC"); res.json(r.recordset); } catch(e) { res.json([]); }
});

// --- LOGS & AUDIT ---
app.get('/api/logs', async (req, res) => {
    if (!dbPool) return res.json([]);
    try { const r = await dbPool.request().query("SELECT TOP 200 LogId as id, ActorId as actorId, Level as level, Process as process, Message as message, SourceIp as sourceIp, Timestamp as timestamp FROM Logs ORDER BY Timestamp DESC"); res.json(r.recordset); } catch(e) { res.json([]); }
});
app.post('/api/audit', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    const { username, action, details } = req.body;
    try { 
        await dbPool.request().input('u', sql.NVarChar, username).input('a', sql.NVarChar, action).input('d', sql.NVarChar, details).query("INSERT INTO Logs (LogId, ActorId, Level, Process, Message, Timestamp) VALUES (NEWID(), 'SYSTEM', 'INFO', 'AUDIT', @u + ' ' + @a + ': ' + @d, GETDATE())"); 
        sendToSyslog('INFO', 'AUDIT', `${username} ${action}: ${details}`);
        res.json({success: true}); 
    } catch(e) { res.json({success: false}); }
});

// --- ENROLLMENT ---
app.post('/api/enroll/generate', async (req, res) => {
    if (!dbPool) return res.json({ token: 'OFFLINE_TOKEN' });
    const { type, targetId, config } = req.body;
    try {
        const token = `vpp_${Math.random().toString(36).substr(2, 9)}_${Date.now()}`;
        await dbPool.request().input('tok', sql.NVarChar, token).input('type', sql.NVarChar, type).input('tid', sql.NVarChar, targetId).input('cfg', sql.NVarChar, JSON.stringify(config || {})).query("INSERT INTO EnrollmentTokens (Token, Type, TargetId, ConfigJson, CreatedAt, IsUsed) VALUES (@tok, @type, @tid, @cfg, GETDATE(), 0)");
        res.json({ token });
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/enroll/config/:token', async (req, res) => {
    if (!dbPool) return res.status(500).send();
    try {
        const r = await dbPool.request().input('t', sql.NVarChar, req.params.token).query("SELECT * FROM EnrollmentTokens WHERE Token = @t");
        if (r.recordset.length === 0) return res.status(404).send();
        res.send("OK");
    } catch(e) { res.status(500).send(); }
});
app.get('/api/enroll/pending', async (req, res) => {
    if (!dbPool) return res.json([]);
    try {
        const result = await dbPool.request().query("SELECT * FROM PendingActors ORDER BY DetectedAt DESC");
        res.json(result.recordset.map(r => ({ id: r.Id, hwid: r.HwId, detectedIp: r.DetectedIp, detectedAt: r.DetectedAt, osVersion: r.OsVersion })));
    } catch(e) { res.status(500).json({error: e.message}); }
});
app.post('/api/enroll/approve', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    const { pendingId, proxyId, name } = req.body;
    try {
        const pending = await dbPool.request().input('pid', sql.NVarChar, pendingId).query("SELECT * FROM PendingActors WHERE Id = @pid");
        if (pending.recordset.length === 0) return res.json({success: false});
        const p = pending.recordset[0];
        const newId = `actor-${Math.random().toString(36).substr(2,6)}`;
        await dbPool.request().input('aid', sql.NVarChar, newId).input('hid', sql.NVarChar, p.HwId).input('gid', sql.NVarChar, proxyId==='DIRECT'?null:proxyId).input('name', sql.NVarChar, name).input('ip', sql.NVarChar, p.DetectedIp).input('os', sql.NVarChar, p.OsVersion).query(`INSERT INTO Actors (ActorId, HwId, GatewayId, Name, Status, LocalIp, LastSeen, OsVersion) VALUES (@aid, @hid, @gid, @name, 'ONLINE', @ip, GETDATE(), @os)`);
        await dbPool.request().input('pid', sql.NVarChar, pendingId).query("DELETE FROM PendingActors WHERE Id = @pid");
        res.json({success: true});
    } catch(e) { res.status(500).json({error: e.message}); }
});
app.delete('/api/enroll/pending/:id', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    try { await dbPool.request().input('pid', sql.NVarChar, req.params.id).query("DELETE FROM PendingActors WHERE Id = @pid"); res.json({success: true}); } catch(e) { res.status(500).json({error: e.message}); }
});

// --- REPORTS ---
app.get('/api/reports', async (req, res) => {
    if (!dbPool) return res.json([]);
    try { const r = await dbPool.request().query("SELECT * FROM Reports ORDER BY CreatedAt DESC"); res.json(r.recordset.map(x => ({ id: x.ReportId, title: x.Title, generatedBy: x.GeneratedBy, type: x.Type, createdAt: x.CreatedAt, content: JSON.parse(x.ContentJson) }))); } catch(e) { res.json([]); }
});
app.post('/api/reports/generate', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    const { type, generatedBy, content } = req.body; // Simplified for brevity
    // In real implementation, this would generate content based on logs
    try { 
        const title = `Report ${new Date().toLocaleDateString()}`;
        await dbPool.request().input('id', sql.NVarChar, `rep-${Date.now()}`).input('t', sql.NVarChar, title).input('g', sql.NVarChar, generatedBy).input('type', sql.NVarChar, type).input('c', sql.NVarChar, JSON.stringify(req.body)).query("INSERT INTO Reports (ReportId, Title, GeneratedBy, Type, CreatedAt, ContentJson) VALUES (@id, @t, @g, @type, GETDATE(), @c)");
        res.json({success: true}); 
    } catch(e) { res.json({success: false}); }
});
app.delete('/api/reports/:id', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    try { await dbPool.request().input('id', sql.NVarChar, req.params.id).query("DELETE FROM Reports WHERE ReportId = @id"); res.json({success: true}); } catch(e) { res.json({success: false}); }
});

// --- WIRELESS RECON ---
app.get('/api/recon/wifi', async (req, res) => { if (!dbPool) return res.json([]); try { const r = await dbPool.request().query("SELECT * FROM WifiNetworks ORDER BY LastSeen DESC"); res.json(r.recordset); } catch(e) { res.json([]); } });
app.get('/api/recon/bluetooth', async (req, res) => { if (!dbPool) return res.json([]); try { const r = await dbPool.request().query("SELECT * FROM BluetoothDevices ORDER BY LastSeen DESC"); res.json(r.recordset); } catch(e) { res.json([]); } });

// --- TRAP / GHOST MODE API ---
app.post('/api/trap/init', (req, res) => {
    const sid = `trap-${Date.now()}`;
    trapSessions[sid] = { state: 'INIT' };
    res.json({ sessionId: sid, banner: "220 (vsFTPd 2.3.4)\r\n" });
});
app.post('/api/trap/interact', (req, res) => {
    const { sessionId, input } = req.body;
    if (input && input.toUpperCase().startsWith('USER')) return res.json({ response: "331 Please specify the password.\r\n" });
    if (input && input.toUpperCase().startsWith('PASS')) return res.json({ response: "530 Login incorrect.\r\n" });
    return res.json({ response: "500 Unknown command.\r\n" });
});
app.get('/api/sessions', (req, res) => res.json(recordedSessions));
app.delete('/api/sessions/:id', (req, res) => { recordedSessions = recordedSessions.filter(s => s.id !== req.params.id); res.json({ success: true }); });

// --- AGENT ROUTES ---
app.get('/api/agent/heartbeat', async (req, res) => {
    if (!dbPool) return res.status(503).json({});
    const { hwid, os } = req.query;
    if (!hwid) return res.status(400).json({});
    try {
        const actor = await dbPool.request().input('h', sql.NVarChar, hwid).query("SELECT ActorId FROM Actors WHERE HwId = @h");
        if (actor.recordset.length > 0) {
            await dbPool.request().input('aid', sql.NVarChar, actor.recordset[0].ActorId).input('os', sql.NVarChar, os||'Unknown').query("UPDATE Actors SET LastSeen=GETDATE(), OsVersion = CASE WHEN @os <> 'Unknown' THEN @os ELSE OsVersion END WHERE ActorId = @aid");
            return res.json({ status: 'APPROVED', actorId: actor.recordset[0].ActorId });
        }
        const pending = await dbPool.request().input('h', sql.NVarChar, hwid).query("SELECT * FROM PendingActors WHERE HwId = @h");
        if (pending.recordset.length === 0) {
             await dbPool.request().input('pid', sql.NVarChar, `temp-${Math.random().toString(36).substr(2,6)}`).input('h', sql.NVarChar, hwid).input('ip', sql.NVarChar, getClientIp(req)).input('os', sql.NVarChar, os||'Unknown').query("INSERT INTO PendingActors (Id, HwId, DetectedIp, DetectedAt, OsVersion) VALUES (@pid, @h, @ip, GETDATE(), @os)");
        }
        res.json({ status: 'PENDING' });
    } catch(e) { res.status(500).json({}); }
});
app.get('/api/agent/commands', async (req, res) => {
    if (!dbPool) return res.json([]);
    const { actorId } = req.query;
    try {
        await dbPool.request().input('aid', sql.NVarChar, actorId).query("UPDATE Actors SET LastSeen = GETDATE() WHERE ActorId = @aid");
        const result = await dbPool.request().input('aid', sql.NVarChar, actorId).query("SELECT * FROM CommandQueue WHERE ActorId = @aid AND Status = 'PENDING'");
        res.json(result.recordset.map(r => ({ id: r.JobId, command: r.Command })));
    } catch(e) { res.json([]); }
});
app.post('/api/agent/result', async (req, res) => {
    if (!dbPool) return res.json({});
    const { jobId, status, output } = req.body;
    try { await dbPool.request().input('jid', sql.NVarChar, jobId).input('stat', sql.NVarChar, status).input('out', sql.NVarChar, output).query("UPDATE CommandQueue SET Status = @stat, Output = @out, UpdatedAt = GETDATE() WHERE JobId = @jid"); res.json({success: true}); } catch(e) { res.json({}); }
});
app.post('/api/agent/scan', async (req, res) => {
    if (!dbPool) return res.json({});
    const { actorId, cpu, ram, temp } = req.body;
    try { if (actorId) await dbPool.request().input('aid', sql.NVarChar, actorId).input('c', sql.Float, parseFloat(cpu)||0).input('r', sql.Float, parseFloat(ram)||0).input('t', sql.Float, parseFloat(temp)||0).query("UPDATE Actors SET CpuLoad = @c, MemoryUsage = @r, Temperature = @t, LastSeen = GETDATE() WHERE ActorId = @aid"); res.json({success:true}); } catch(e) { res.status(500).json({}); }
});
app.post('/api/agent/scan-results', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    const { actorId, wifi, bluetooth } = req.body;
    try {
        const actorRes = await dbPool.request().input('aid', sql.NVarChar, actorId).query("SELECT Name FROM Actors WHERE ActorId = @aid");
        const actorName = actorRes.recordset[0]?.Name || 'Unknown';
        if (wifi && Array.isArray(wifi)) {
            for (const net of wifi) {
                await dbPool.request().input('nid', sql.NVarChar, `wifi-${actorId}-${net.bssid}`).input('ssid', sql.NVarChar, net.ssid||'').input('bssid', sql.NVarChar, net.bssid||'').input('sig', sql.Int, parseInt(net.signal)||-100).input('sec', sql.NVarChar, net.security||'OPEN').input('aid', sql.NVarChar, actorId).input('aname', sql.NVarChar, actorName).query(`IF EXISTS (SELECT 1 FROM WifiNetworks WHERE Id = @nid) UPDATE WifiNetworks SET SignalStrength = @sig, LastSeen = GETDATE() WHERE Id = @nid ELSE INSERT INTO WifiNetworks (Id, Ssid, Bssid, SignalStrength, Security, Channel, ActorId, ActorName, LastSeen) VALUES (@nid, @ssid, @bssid, @sig, @sec, 0, @aid, @aname, GETDATE())`);
            }
        }
        res.json({success: true});
    } catch(e) { res.json({success: false}); }
});

// --- AGENT SCRIPT ---
app.get('/setup', (req, res) => {
    const host = req.get('host');
    const protocol = req.protocol;
    const serverUrl = `${protocol}://${host}`;
    const script = `
#!/bin/bash
TOKEN=$1
SERVER_URL="${serverUrl}"
AGENT_DIR="/opt/vpp-agent"
if [ "$EUID" -ne 0 ]; then echo "Root required"; exit 1; fi
if command -v apt-get &> /dev/null; then export DEBIAN_FRONTEND=noninteractive; if ! command -v jq &> /dev/null; then apt-get update -qq && apt-get install -y jq curl socat lsof network-manager bluez -qq; fi; fi
HWID=$(cat /sys/class/net/eth0/address 2>/dev/null || cat /sys/class/net/wlan0/address 2>/dev/null || hostname)
OS_NAME="Linux"; if [ -f /etc/os-release ]; then . /etc/os-release; if [ -n "$PRETTY_NAME" ]; then OS_NAME="$PRETTY_NAME"; fi; fi
HAS_WIFI=false; HAS_BT=false
if command -v nmcli &> /dev/null && nmcli device | grep -q wifi; then HAS_WIFI=true; fi
if command -v hcitool &> /dev/null && hcitool dev | grep -q hci; then HAS_BT=true; fi
mkdir -p $AGENT_DIR
echo "$SERVER_URL" > $AGENT_DIR/.server
echo "$TOKEN" > $AGENT_DIR/.token
curl -s -o /dev/null -H "X-VPP-HWID: $HWID" -H "X-VPP-OS: $OS_NAME" -H "X-VPP-WIFI: $HAS_WIFI" -H "X-VPP-BT: $HAS_BT" "$SERVER_URL/api/enroll/config/$TOKEN"
cat <<'EOF_RELAY' > $AGENT_DIR/trap_relay.sh
#!/bin/bash
SERVER=$(cat /opt/vpp-agent/.server)
SID=$(curl -s -X POST "$SERVER/api/trap/init" | jq -r .sessionId)
curl -s -X POST "$SERVER/api/trap/init" | jq -r .banner
while read -r LINE; do RESP=$(curl -s -X POST -H "Content-Type: application/json" -d "{\"sessionId\":\"$SID\",\"input\":\"$LINE\"}" "$SERVER/api/trap/interact" | jq -r .response); echo -ne "$RESP"; done
EOF_RELAY
chmod +x $AGENT_DIR/trap_relay.sh
cat <<'EOF_BIN' > /usr/local/bin/vpp-agent
#!/bin/bash
AGENT_DIR="/opt/vpp-agent"; SERVER=$(cat "$AGENT_DIR/.server")
if [[ "\$1" == "--scan-wireless" ]]; then
    WIFI_JSON="[]"; BT_JSON="[]"
    if command -v nmcli &> /dev/null; then
         nmcli device wifi rescan 2>/dev/null; sleep 3
         RAW_WIFI=\$(nmcli -t -f SSID,BSSID,SIGNAL,SECURITY dev wifi list 2>/dev/null)
         if [ ! -z "\$RAW_WIFI" ]; then WIFI_JSON=\$(echo "\$RAW_WIFI" | jq -R -s -c 'split("\n")[:-1] | map(split(":")) | map({ssid: .[0], bssid: (.[1]+":"+.[2]+":"+.[3]+":"+.[4]+":"+.[5]+":"+.[6]), signal: .[7], security: .[8]})'); fi
    fi
    ACTOR_ID=\$(cat "\$AGENT_DIR/vpp-id" 2>/dev/null)
    if [ ! -z "\$ACTOR_ID" ]; then
        PAYLOAD=\$(jq -n -c --arg aid "\$ACTOR_ID" --argjson wifi "\$WIFI_JSON" --argjson bt "\$BT_JSON" '{actorId: \$aid, wifi: \$wifi, bluetooth: \$bt}')
        curl -s -X POST -H "Content-Type: application/json" -d "\$PAYLOAD" "\$SERVER/api/agent/scan-results"
    fi
elif [[ "\$1" == "--forensic" ]]; then
    echo "---PROCESSES---"; ps -aux --sort=-%cpu | head -20
    echo "---NETWORK---"; ss -tupn
    echo "---AUTH---"; if [ -f /var/log/auth.log ]; then tail -n 20 /var/log/auth.log; fi
    echo "---OPENFILES---"; lsof -i -P -n 2>/dev/null | head -50
else echo "VPP Agent OK"; fi
EOF_BIN
chmod +x /usr/local/bin/vpp-agent
cat <<'EOF_SRV' > $AGENT_DIR/agent.sh
#!/bin/bash
export PATH=$PATH:/usr/sbin:/sbin:/usr/bin:/bin:/usr/local/bin
SERVER=$(cat /opt/vpp-agent/.server); AGENT_DIR="/opt/vpp-agent"
while [ ! -f "$AGENT_DIR/vpp-id" ]; do
    HWID=$(cat /sys/class/net/eth0/address 2>/dev/null || hostname)
    RESP=$(curl -s -G --data-urlencode "hwid=$HWID" "$SERVER/api/agent/heartbeat")
    STATUS=$(echo "$RESP" | jq -r '.status')
    if [ "$STATUS" == "APPROVED" ]; then echo "$RESP" | jq -r '.actorId' > "$AGENT_DIR/vpp-id"; fi
    sleep 10
done
ACTOR_ID=$(cat "$AGENT_DIR/vpp-id")
while true; do
    CPU=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d. -f1); RAM=$(free | grep Mem | awk '{print $3/$2 * 100.0}')
    PAYLOAD=$(jq -n -c --arg aid "$ACTOR_ID" --arg cpu "$CPU" --arg ram "$RAM" '{actorId: $aid, cpu: $cpu, ram: $ram, temp: 0}')
    curl -s -X POST -H "Content-Type: application/json" -d "$PAYLOAD" "$SERVER/api/agent/scan" >/dev/null
    JOB_JSON=$(curl -s "$SERVER/api/agent/commands?actorId=$ACTOR_ID")
    JOB_ID=$(echo "$JOB_JSON" | jq -r '.[0].id // empty')
    if [ ! -z "$JOB_ID" ]; then
        CMD=$(echo "$JOB_JSON" | jq -r '.[0].command')
        curl -s -X POST -H "Content-Type: application/json" -d "{\"jobId\":\"$JOB_ID\",\"status\":\"RUNNING\"}" "$SERVER/api/agent/result"
        OUTPUT=$(eval "$CMD" 2>&1)
        jq -n -c --arg jid "$JOB_ID" --arg out "$OUTPUT" '{jobId: $jid, status: "COMPLETED", output: $out}' | curl -s -X POST -H "Content-Type: application/json" -d @- "$SERVER/api/agent/result"
    fi
    sleep 5
done
EOF_SRV
chmod +x $AGENT_DIR/agent.sh
cat <<EOF_SVC > /etc/systemd/system/vpp-agent.service
[Unit]
Description=VPP Agent
After=network.target
[Service]
ExecStart=$AGENT_DIR/agent.sh
Restart=always
User=root
[Install]
WantedBy=multi-user.target
EOF_SVC
systemctl daemon-reload; systemctl enable vpp-agent; systemctl restart vpp-agent
`;
    res.setHeader('Content-Type', 'text/plain');
    res.send(script.trim());
});

// Explicit API 404 Handler (Prevents HTML response and SyntaxError)
app.all('/api/*', (req, res) => {
    res.status(404).json({ error: 'API Endpoint not found' });
});

// SPA Fallback (Catch-all must be LAST)
app.get('*', (req, res) => {
    if (req.accepts('html')) {
        const indexPath = path.join(distPath, 'index.html');
        if (fs.existsSync(indexPath)) res.sendFile(indexPath);
        else res.status(404).send('App not built');
    } else {
        res.status(404).json({ error: 'Not found' });
    }
});

app.listen(port, '0.0.0.0', () => console.log(`Server running on ${port}`));
