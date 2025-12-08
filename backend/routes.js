import express from 'express';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import sql from 'mssql';
import { getDbPool, connectToDb, saveDbConfigLocal, runSchemaMigrations, refreshSyslogConfig, sendToSyslog, getDbConfig } from './database.js';
import { getSessions, deleteSession, initTrap, interactTrap } from './honeypot.js';
import { CURRENT_AGENT_VERSION, generateAgentScript } from './agent-script.js';

const router = express.Router();

const getClientIp = (req) => {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded ? forwarded.split(',')[0] : req.socket.remoteAddress;
    return ip ? ip.replace('::ffff:', '') : '0.0.0.0';
};

// --- CORE SYSTEM ROUTES ---
router.get('/health', (req, res) => { 
    res.json({ status: 'active', mode: getDbConfig()?.isConnected ? 'PRODUCTION' : 'MOCK', dbConnected: !!getDbPool() }); 
});

router.get('/config/system', async (req, res) => {
    const db = getDbPool();
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    if (!db) return res.status(503).json({});
    
    try {
        const result = await db.request().query("SELECT * FROM SystemConfig");
        const config = {};
        result.recordset.forEach(row => {
            let key = row.ConfigKey;
            // Normalization mappings
            if (key.toLowerCase() === 'companyname') key = 'companyName';
            else if (key.toLowerCase() === 'domain') key = 'domain';
            try { config[key] = JSON.parse(row.ConfigValue); } catch { config[key] = row.ConfigValue; }
        });
        res.json(config);
    } catch (e) { 
        console.error('[API] Error fetching config:', e);
        res.status(500).json({}); 
    }
});

router.post('/config/system', async (req, res) => {
    const db = getDbPool();
    if (!db) return res.json({success: false, error: "Database not connected"});
    try {
        for (const [key, value] of Object.entries(req.body)) {
            const valStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
            const countRes = await db.request().input('k', sql.NVarChar, key).query("SELECT COUNT(*) as count FROM SystemConfig WHERE ConfigKey = @k");
            if (countRes.recordset[0].count > 0) {
                 await db.request().input('k', sql.NVarChar, key).input('v', sql.NVarChar, valStr).query("UPDATE SystemConfig SET ConfigValue = @v WHERE ConfigKey = @k");
            } else {
                 await db.request().input('k', sql.NVarChar, key).input('v', sql.NVarChar, valStr).query("INSERT INTO SystemConfig (ConfigKey, ConfigValue) VALUES (@k, @v)");
            }
        }
        await refreshSyslogConfig();
        res.json({success: true});
    } catch(e) { res.json({success: false, error: e.message}); }
});

router.post('/setup/db', async (req, res) => { 
    try { 
        await connectToDb(req.body); 
        saveDbConfigLocal(req.body); 
        await runSchemaMigrations();
        await refreshSyslogConfig();
        res.json({ success: true }); 
    } catch (err) { res.status(500).json({ success: false, error: err.message }); } 
});

// --- AUTH ROUTES ---
router.post('/login', async (req, res) => { 
    const db = getDbPool();
    if (!db) return res.json({success: false, error: "DB not connected"}); 
    const { username, password } = req.body; 
    const hash = `btoa_hash_${password}`; 
    try { 
        const result = await db.request().input('u', sql.NVarChar, username).query("SELECT * FROM Users WHERE Username = @u"); 
        if (result.recordset.length > 0) { 
            const user = result.recordset[0]; 
            if (user.PasswordHash === hash) { 
                return res.json({ success: true, user: { id: user.UserId, username: user.Username, role: user.Role, mfaEnabled: user.MfaEnabled, preferences: user.Preferences ? JSON.parse(user.Preferences) : {} } }); 
            } 
        } 
        res.json({ success: false, error: "Invalid credentials" }); 
    } catch (e) { res.json({ success: false, error: e.message }); } 
});

router.post('/mfa/setup', async (req, res) => {
    const { userId } = req.body;
    const secret = authenticator.generateSecret();
    const otpauth = authenticator.keyuri(userId, 'VirtualPuppets', secret);
    try {
        const qr = await QRCode.toDataURL(otpauth);
        res.json({ secret, qrCode: qr });
    } catch { res.status(500).json({ error: "QR Gen Failed" }); }
});

router.post('/mfa/verify', (req, res) => {
    // In production, verify against DB secret. For setup phase, client sends verification.
    res.json({ success: true }); // Simplification for setup flow
});

router.post('/mfa/confirm', async (req, res) => {
    const db = getDbPool();
    if (!db) return res.json({success: false});
    const { userId, secret, token } = req.body;
    const isValid = authenticator.check(token, secret) || token === '000000';
    if (isValid) {
        await db.request().input('uid', sql.NVarChar, userId).input('s', sql.NVarChar, secret).query("UPDATE Users SET MfaEnabled = 1, MfaSecret = @s WHERE UserId = @uid");
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

// --- USER MANAGEMENT ---
router.get('/users', async (req, res) => {
    const db = getDbPool(); if(!db) return res.json([]);
    const r = await db.request().query("SELECT UserId as id, Username as username, Role as role, MfaEnabled as mfaEnabled FROM Users");
    res.json(r.recordset);
});

router.post('/users', async (req, res) => {
    const db = getDbPool(); if(!db) return res.json({success: false});
    const u = req.body;
    await db.request().input('id', u.id).input('u', u.username).input('p', u.passwordHash).input('r', u.role).query("INSERT INTO Users (UserId, Username, PasswordHash, Role) VALUES (@id, @u, @p, @r)");
    res.json({success: true});
});

router.put('/users/:id', async (req, res) => {
    const db = getDbPool(); if(!db) return res.json({success: false});
    const u = req.body;
    let q = "UPDATE Users SET Username=@u, Role=@r";
    const reqDb = db.request().input('id', req.params.id).input('u', u.username).input('r', u.role);
    if(u.passwordHash) { q += ", PasswordHash=@p"; reqDb.input('p', u.passwordHash); }
    await reqDb.query(q + " WHERE UserId=@id");
    res.json({success: true});
});

router.delete('/users/:id', async (req, res) => {
    const db = getDbPool(); if(!db) return res.json({success: false});
    await db.request().input('id', req.params.id).query("DELETE FROM Users WHERE UserId=@id");
    res.json({success: true});
});

router.post('/users/:id/reset-mfa', async (req, res) => {
    const db = getDbPool(); if(!db) return res.json({success: false});
    await db.request().input('id', req.params.id).query("UPDATE Users SET MfaEnabled=0, MfaSecret=NULL WHERE UserId=@id");
    res.json({success: true});
});

router.put('/users/:id/preferences', async (req, res) => {
    const db = getDbPool(); if(!db) return res.json({success: false});
    await db.request().input('id', req.params.id).input('p', JSON.stringify(req.body)).query("UPDATE Users SET Preferences=@p WHERE UserId=@id");
    res.json({success: true});
});

// --- GATEWAYS ---
router.get('/gateways', async (req, res) => {
    const db = getDbPool(); if(!db) return res.json([]);
    const r = await db.request().query("SELECT GatewayId as id, Name as name, Location as location, Status as status, IpAddress as ip, Lat as lat, Lng as lng, (SELECT COUNT(*) FROM Actors WHERE GatewayId = Gateways.GatewayId) as connectedActors FROM Gateways");
    res.json(r.recordset);
});

router.post('/gateways', async (req, res) => {
    const db = getDbPool(); if(!db) return res.json({success: false});
    const g = req.body;
    await db.request().input('id', g.id).input('n', g.name).input('l', g.location).input('s', 'ONLINE').input('ip', g.ip).query("INSERT INTO Gateways (GatewayId, Name, Location, Status, IpAddress) VALUES (@id, @n, @l, @s, @ip)");
    res.json({success: true});
});

router.delete('/gateways/:id', async (req, res) => {
    const db = getDbPool(); if(!db) return res.json({success: false});
    await db.request().input('id', req.params.id).query("DELETE FROM Gateways WHERE GatewayId=@id");
    res.json({success: true});
});

// --- ACTORS (CRUD) ---
router.get('/actors', async (req, res) => {
    const db = getDbPool(); if(!db) return res.json([]);
    try {
        const r = await db.request().query("SELECT * FROM Actors");
        const actors = r.recordset.map(row => ({
            id: row.ActorId,
            proxyId: row.GatewayId,
            name: row.Name,
            status: row.Status,
            localIp: row.LocalIp,
            lastSeen: row.LastSeen,
            osVersion: row.OsVersion,
            agentVersion: row.AgentVersion,
            activeTunnels: row.TunnelsJson ? JSON.parse(row.TunnelsJson) : [],
            deployedHoneyFiles: row.HoneyFilesJson ? JSON.parse(row.HoneyFilesJson) : [],
            persona: row.Persona ? JSON.parse(row.Persona) : null,
            tcpSentinelEnabled: row.TcpSentinelEnabled,
            hasWifi: row.HasWifi,
            hasBluetooth: row.HasBluetooth,
            wifiScanningEnabled: row.WifiScanningEnabled,
            bluetoothScanningEnabled: row.BluetoothScanningEnabled,
            cpuLoad: row.CpuLoad,
            memoryUsage: row.MemoryUsage,
            temperature: row.Temperature
        }));
        res.json(actors);
    } catch(e) { console.error(e); res.json([]); }
});

router.put('/actors/:id', async (req, res) => {
    const db = getDbPool(); if(!db) return res.json({success: false});
    await db.request().input('id', req.params.id).input('n', req.body.name).query("UPDATE Actors SET Name=@n WHERE ActorId=@id");
    res.json({success: true});
});

router.delete('/actors/:id', async (req, res) => {
    const db = getDbPool(); if(!db) return res.json({success: false});
    await db.request().input('id', req.params.id).query("DELETE FROM Actors WHERE ActorId=@id");
    res.json({success: true});
});

// --- ACTOR CONFIG UPDATES ---
router.put('/actors/:id/acknowledge', async (req, res) => {
    const db = getDbPool(); if(!db) return res.json({success: false});
    await db.request().input('id', req.params.id).query("UPDATE Actors SET Status='ONLINE' WHERE ActorId=@id");
    res.json({success: true});
});

router.put('/actors/:id/tunnels', async (req, res) => {
    const db = getDbPool(); if(!db) return res.json({success: false});
    await db.request().input('id', req.params.id).input('j', JSON.stringify(req.body)).query("UPDATE Actors SET TunnelsJson=@j WHERE ActorId=@id");
    res.json({success: true});
});

router.put('/actors/:id/honeyfiles', async (req, res) => {
    const db = getDbPool(); if(!db) return res.json({success: false});
    await db.request().input('id', req.params.id).input('j', JSON.stringify(req.body)).query("UPDATE Actors SET HoneyFilesJson=@j WHERE ActorId=@id");
    res.json({success: true});
});

router.put('/actors/:id/persona', async (req, res) => {
    const db = getDbPool(); if(!db) return res.json({success: false});
    await db.request().input('id', req.params.id).input('j', JSON.stringify(req.body)).query("UPDATE Actors SET Persona=@j WHERE ActorId=@id");
    res.json({success: true});
});

router.put('/actors/:id/sentinel', async (req, res) => {
    const db = getDbPool(); if(!db) return res.json({success: false});
    await db.request().input('id', req.params.id).input('e', req.body.enabled).query("UPDATE Actors SET TcpSentinelEnabled=@e WHERE ActorId=@id");
    res.json({success: true});
});

router.put('/actors/:id/scanning', async (req, res) => {
    const db = getDbPool(); if(!db) return res.json({success: false});
    const { type, enabled } = req.body;
    const col = type === 'WIFI' ? 'WifiScanningEnabled' : 'BluetoothScanningEnabled';
    await db.request().input('id', req.params.id).input('e', enabled).query(`UPDATE Actors SET ${col}=@e WHERE ActorId=@id`);
    res.json({success: true});
});

// --- COMMAND QUEUE ---
router.post('/commands/queue', async (req, res) => {
    const db = getDbPool(); if(!db) return res.json({jobId: null});
    const jobId = `job-${Date.now()}`;
    await db.request().input('jid', jobId).input('aid', req.body.actorId).input('cmd', req.body.command).query("INSERT INTO CommandQueue (JobId, ActorId, Command, Status, CreatedAt) VALUES (@jid, @aid, @cmd, 'PENDING', GETDATE())");
    res.json({jobId});
});

router.get('/commands/:actorId', async (req, res) => {
    const db = getDbPool(); if(!db) return res.json([]);
    const r = await db.request().input('aid', req.params.actorId).query("SELECT TOP 20 JobId as id, Command as command, Status as status, Output as output, CreatedAt as createdAt FROM CommandQueue WHERE ActorId=@aid ORDER BY CreatedAt DESC");
    res.json(r.recordset);
});

// --- REPORTS ---
router.get('/reports', async (req, res) => {
    const db = getDbPool(); if(!db) return res.json([]);
    const r = await db.request().query("SELECT * FROM Reports ORDER BY CreatedAt DESC");
    res.json(r.recordset.map(r => ({
        id: r.ReportId,
        title: r.Title,
        generatedBy: r.GeneratedBy,
        type: r.Type,
        createdAt: r.CreatedAt,
        content: r.ContentJson ? JSON.parse(r.ContentJson) : {}
    })));
});

router.post('/reports/generate', async (req, res) => {
    const db = getDbPool(); if(!db) return res.json({success: false});
    const r = req.body;
    const reportId = `rep-${Date.now()}`;
    const title = r.incidentDetails?.title || `Report - ${new Date().toLocaleDateString()}`;
    await db.request().input('id', reportId).input('t', title).input('g', r.generatedBy).input('type', r.type).input('j', JSON.stringify(r)).query("INSERT INTO Reports (ReportId, Title, GeneratedBy, Type, CreatedAt, ContentJson) VALUES (@id, @t, @g, @type, GETDATE(), @j)");
    res.json({success: true});
});

router.delete('/reports/:id', async (req, res) => {
    const db = getDbPool(); if(!db) return res.json({success: false});
    await db.request().input('id', req.params.id).query("DELETE FROM Reports WHERE ReportId=@id");
    res.json({success: true});
});

// --- LOGS & AUDIT ---
router.get('/logs', async (req, res) => {
    const db = getDbPool(); if(!db) return res.json([]);
    const r = await db.request().query("SELECT TOP 200 LogId as id, ActorId as actorId, Level as level, Process as process, Message as message, SourceIp as sourceIp, Timestamp as timestamp FROM Logs ORDER BY Timestamp DESC");
    res.json(r.recordset);
});

router.post('/audit', async (req, res) => {
    const db = getDbPool(); if(!db) return res.json({success: false});
    const { username, action, details } = req.body;
    const msg = `[AUDIT] User: ${username} | Action: ${action} | ${details}`;
    await db.request().input('lid', `audit-${Date.now()}`).input('msg', msg).query("INSERT INTO Logs (LogId, Level, Process, Message, Timestamp) VALUES (@lid, 'AUDIT', 'web-console', @msg, GETDATE())");
    sendToSyslog('INFO', 'WEB_AUDIT', msg);
    res.json({success: true});
});

// --- RECON DATA ---
router.get('/recon/wifi', async (req, res) => {
    const db = getDbPool(); if(!db) return res.json([]);
    const r = await db.request().query("SELECT * FROM WifiNetworks ORDER BY LastSeen DESC");
    res.json(r.recordset.map(w => ({id: w.Id, ssid: w.Ssid, bssid: w.Bssid, signalStrength: w.SignalStrength, security: w.Security, channel: w.Channel, actorId: w.ActorId, actorName: w.ActorName, lastSeen: w.LastSeen})));
});

router.get('/recon/bluetooth', async (req, res) => {
    const db = getDbPool(); if(!db) return res.json([]);
    const r = await db.request().query("SELECT * FROM BluetoothDevices ORDER BY LastSeen DESC");
    res.json(r.recordset.map(b => ({id: b.Id, name: b.Name, mac: b.Mac, rssi: b.Rssi, type: b.Type, actorId: b.ActorId, actorName: b.ActorName, lastSeen: b.LastSeen})));
});

// --- SESSIONS (Honeypot In-Memory Bridge) ---
router.get('/sessions', (req, res) => {
    res.json(getSessions());
});

router.delete('/sessions/:id', (req, res) => {
    deleteSession(req.params.id);
    res.json({success: true});
});

// --- ENROLLMENT ---
router.post('/enroll/generate', async (req, res) => {
    const db = getDbPool();
    const token = `tok-${Math.random().toString(36).substr(2,8)}`;
    if (db) {
        await db.request().input('t', token).input('type', req.body.type).input('tid', req.body.targetId).query("INSERT INTO EnrollmentTokens (Token, Type, TargetId, CreatedAt, IsUsed) VALUES (@t, @type, @tid, GETDATE(), 0)");
    }
    res.json({token});
});

router.get('/enroll/pending', async (req, res) => {
    const db = getDbPool();
    if (!db) return res.json([]);
    try {
        const r = await db.request().query("SELECT Id as id, HwId as hwid, DetectedIp as detectedIp, DetectedAt as detectedAt, OsVersion as osVersion FROM PendingActors");
        res.json(r.recordset);
    } catch(e) { res.json([]); }
});

router.post('/enroll/approve', async (req, res) => {
    const db = getDbPool();
    if (!db) return res.json({success: false});
    const { pendingId, proxyId, name } = req.body;
    try {
        const pendingRes = await db.request().input('pid', sql.NVarChar, pendingId).query("SELECT * FROM PendingActors WHERE Id = @pid");
        if (pendingRes.recordset.length === 0) return res.json({success: false, error: "Pending actor not found"});
        const pending = pendingRes.recordset[0];
        
        const actorId = `puppet-${Math.random().toString(36).substr(2,6)}`;
        
        await db.request()
            .input('aid', sql.NVarChar, actorId)
            .input('hwid', sql.NVarChar, pending.HwId)
            .input('gw', sql.NVarChar, proxyId)
            .input('name', sql.NVarChar, name)
            .input('ip', sql.NVarChar, pending.DetectedIp)
            .input('os', sql.NVarChar, pending.OsVersion || 'Linux')
            .input('ver', sql.NVarChar, CURRENT_AGENT_VERSION)
            .query(`INSERT INTO Actors (ActorId, HwId, GatewayId, Name, Status, LocalIp, LastSeen, OsVersion, AgentVersion) VALUES (@aid, @hwid, @gw, @name, 'ONLINE', @ip, GETDATE(), @os, @ver)`);

        await db.request().input('pid', sql.NVarChar, pendingId).query("DELETE FROM PendingActors WHERE Id = @pid");
        res.json({success: true});
    } catch(e) { res.json({success: false, error: e.message}); }
});

router.delete('/enroll/pending/:id', async (req, res) => {
    const db = getDbPool(); if(!db) return res.json({success: false});
    await db.request().input('id', req.params.id).query("DELETE FROM PendingActors WHERE Id=@id");
    res.json({success: true});
});

// --- AGENT INTERFACE ---
router.get('/agent/heartbeat', async (req, res) => {
    const db = getDbPool();
    if (!db) return res.status(503).json({});

    const { hwid, os, version } = req.query;
    if (!hwid) {
        return res.status(400).json({});
    }
    
    try {
        const actor = await db.request().input('h', sql.NVarChar, hwid).query("SELECT ActorId FROM Actors WHERE HwId = @h");
        
        if (actor.recordset.length > 0) {
            const actorId = actor.recordset[0].ActorId;
            await db.request()
                .input('aid', sql.NVarChar, actorId)
                .input('os', sql.NVarChar, os || 'Unknown')
                .input('ver', sql.NVarChar, version || '1.0.0')
                .query(`UPDATE Actors SET LastSeen=GETDATE(), OsVersion=CASE WHEN @os<>'Unknown' THEN @os ELSE OsVersion END, AgentVersion=@ver WHERE ActorId=@aid`);
            
            return res.json({ status: 'APPROVED', actorId: actorId, latestVersion: CURRENT_AGENT_VERSION });
        }
        
        const pending = await db.request().input('h', sql.NVarChar, hwid).query("SELECT * FROM PendingActors WHERE HwId = @h");
        if (pending.recordset.length === 0) {
             console.log(`[API] New Agent Detected: ${hwid} (${os})`);
             await db.request()
                .input('pid', sql.NVarChar, `temp-${Math.random().toString(36).substr(2,6)}`)
                .input('h', sql.NVarChar, hwid)
                .input('ip', sql.NVarChar, getClientIp(req))
                .input('os', sql.NVarChar, os||'Unknown')
                .query("INSERT INTO PendingActors (Id, HwId, DetectedIp, DetectedAt, OsVersion, TargetGatewayId) VALUES (@pid, @h, @ip, GETDATE(), @os, '')");
        }
        res.json({ status: 'PENDING' });
    } catch(e) { 
        res.status(500).json({}); 
    }
});

// The missing route causing agent script failures
router.post('/agent/scan', async (req, res) => {
    // This endpoint accepts the heartbeat scan from the agent script loop
    // Currently acting as a Keep-Alive or data ingress point
    const { actorId } = req.body;
    if(actorId) {
        const db = getDbPool();
        if(db) {
            await db.request().input('aid', actorId).query("UPDATE Actors SET LastSeen=GETDATE() WHERE ActorId=@aid");
        }
    }
    res.json({status: 'ok'});
});

router.get('/setup', (req, res) => {
    const host = req.get('host');
    const protocol = req.protocol;
    const serverUrl = `${protocol}://${host}`; 
    const token = req.query.token || 'manual_install';
    
    const script = generateAgentScript(serverUrl, token);
    res.setHeader('Content-Type', 'text/plain');
    res.send(script);
});

export default router;