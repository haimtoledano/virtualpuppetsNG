import express from 'express';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import sql from 'mssql';
import { dbPool, connectToDb, saveDbConfigLocal, runSchemaMigrations, refreshSyslogConfig, sendToSyslog, getDbConfig } from './database.js';
import { getSessions, deleteSession, initTrap, interactTrap } from './honeypot.js';
import { CURRENT_AGENT_VERSION } from './agent-script.js';

const router = express.Router();

const getClientIp = (req) => {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded ? forwarded.split(',')[0] : req.socket.remoteAddress;
    return ip ? ip.replace('::ffff:', '') : '0.0.0.0';
};

// --- CORE SYSTEM ROUTES ---
router.get('/health', (req, res) => { 
    res.json({ status: 'active', mode: getDbConfig()?.isConnected ? 'PRODUCTION' : 'MOCK', dbConnected: !!dbPool }); 
});

router.get('/config/system', async (req, res) => {
    console.log(`[API] GET /config/system - Request received from ${req.ip}`);
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    if (!dbPool) {
        console.warn('[API] GET /config/system - DB Pool not ready');
        return res.status(503).json({});
    }
    try {
        const result = await dbPool.request().query("SELECT * FROM SystemConfig");
        const config = {};
        result.recordset.forEach(row => {
            let key = row.ConfigKey;
            const lowerKey = key.toLowerCase();
            
            // Robust Normalization: Map known DB keys to Frontend camelCase
            if (lowerKey === 'companyname') key = 'companyName';
            else if (lowerKey === 'domain') key = 'domain';
            else if (lowerKey === 'logourl') key = 'logoUrl';
            else if (lowerKey === 'setupcompletedat') key = 'setupCompletedAt';
            else if (lowerKey === 'aiconfig') key = 'aiConfig';
            else if (lowerKey === 'syslogconfig') key = 'syslogConfig';
            
            try { config[key] = JSON.parse(row.ConfigValue); } catch { config[key] = row.ConfigValue; }
        });
        console.log(`[API] GET /config/system - Returning config:`, JSON.stringify(config));
        res.json(config);
    } catch (e) { 
        console.error('[API] GET /config/system - Error fetching config:', e);
        res.status(500).json({}); 
    }
});

router.post('/config/system', async (req, res) => {
    console.log(`[API] POST /config/system - Received payload:`, JSON.stringify(req.body));
    
    if (!dbPool) return res.json({success: false, error: "Database not connected"});
    try {
        for (const [key, value] of Object.entries(req.body)) {
            const valStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
            
            console.log(`[API] Processing config key: ${key}`);
            
            // Explicit UPSERT to avoid MERGE issues
            const countRes = await dbPool.request()
                .input('k', sql.NVarChar, key)
                .query("SELECT COUNT(*) as count FROM SystemConfig WHERE ConfigKey = @k");
            
            if (countRes.recordset[0].count > 0) {
                 console.log(`[API] Updating existing key: ${key}`);
                 await dbPool.request()
                    .input('k', sql.NVarChar, key)
                    .input('v', sql.NVarChar, valStr)
                    .query("UPDATE SystemConfig SET ConfigValue = @v WHERE ConfigKey = @k");
            } else {
                 console.log(`[API] Inserting new key: ${key}`);
                 await dbPool.request()
                    .input('k', sql.NVarChar, key)
                    .input('v', sql.NVarChar, valStr)
                    .query("INSERT INTO SystemConfig (ConfigKey, ConfigValue) VALUES (@k, @v)");
            }
        }
        await refreshSyslogConfig();
        console.log(`[API] POST /config/system - Save operation completed successfully`);
        res.json({success: true});
    } catch(e) { 
        console.error("[API] POST /config/system - Config Save Error:", e);
        res.json({success: false, error: e.message}); 
    }
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

router.post('/mfa/setup', async (req, res) => {
    const { userId } = req.body;
    const secret = authenticator.generateSecret();
    const otpauth = authenticator.keyuri(userId, 'Virtual Puppets C2', secret);
    const qrCode = await QRCode.toDataURL(otpauth);
    res.json({ secret, qrCode });
});
router.post('/mfa/verify', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    const { userId, token } = req.body;
    try {
        const result = await dbPool.request().input('uid', sql.NVarChar, userId).query("SELECT MfaSecret FROM Users WHERE UserId = @uid");
        if (result.recordset.length === 0) return res.json({success: false});
        const secret = result.recordset[0].MfaSecret;
        if (!secret) return res.json({success: true}); 
        const isValid = authenticator.check(token, secret);
        res.json({success: isValid});
    } catch(e) { res.json({success: false}); }
});
router.post('/mfa/confirm', async (req, res) => {
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
router.get('/users', async (req, res) => {
    if (!dbPool) return res.json([]);
    try { const r = await dbPool.request().query("SELECT UserId as id, Username as username, Role as role, MfaEnabled as mfaEnabled FROM Users"); res.json(r.recordset); } catch(e) { res.json([]); }
});
router.post('/users', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    const { id, username, passwordHash, role } = req.body;
    try { await dbPool.request().input('id', sql.NVarChar, id).input('u', sql.NVarChar, username).input('p', sql.NVarChar, passwordHash).input('r', sql.NVarChar, role).query("INSERT INTO Users (UserId, Username, PasswordHash, Role) VALUES (@id, @u, @p, @r)"); res.json({success: true}); } catch(e) { res.json({success: true}); }
});
router.put('/users/:id', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    const { role, passwordHash } = req.body;
    try { 
        if (passwordHash) await dbPool.request().input('id', sql.NVarChar, req.params.id).input('p', sql.NVarChar, passwordHash).query("UPDATE Users SET PasswordHash = @p WHERE UserId = @id");
        await dbPool.request().input('id', sql.NVarChar, req.params.id).input('r', sql.NVarChar, role).query("UPDATE Users SET Role = @r WHERE UserId = @id");
        res.json({success: true}); 
    } catch(e) { res.json({success: false}); }
});
router.delete('/users/:id', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    try { await dbPool.request().input('id', sql.NVarChar, req.params.id).query("DELETE FROM Users WHERE UserId = @id"); res.json({success: true}); } catch(e) { res.json({success: false}); }
});
router.post('/users/:id/reset-mfa', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    try { await dbPool.request().input('id', sql.NVarChar, req.params.id).query("UPDATE Users SET MfaEnabled = 0, MfaSecret = NULL WHERE UserId = @id"); res.json({success: true}); } catch(e) { res.json({success: true}); }
});
router.put('/users/:id/preferences', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    try { await dbPool.request().input('id', sql.NVarChar, req.params.id).input('pref', sql.NVarChar, JSON.stringify(req.body)).query("UPDATE Users SET Preferences = @pref WHERE UserId = @id"); res.json({success: true}); } catch(e) { res.json({success: false}); }
});

// --- GATEWAYS ---
router.get('/gateways', async (req, res) => {
    if (!dbPool) return res.json([]);
    try { const r = await dbPool.request().query("SELECT * FROM Gateways"); res.json(r.recordset.map(g => ({ id: g.GatewayId, name: g.Name, location: g.Location, status: g.Status, ip: g.IpAddress, lat: g.Lat, lng: g.Lng }))); } catch(e) { res.json([]); }
});
router.post('/gateways', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    const { id, name, location, ip, status } = req.body;
    try { await dbPool.request().input('id', sql.NVarChar, id).input('n', sql.NVarChar, name).input('l', sql.NVarChar, location).input('i', sql.NVarChar, ip).input('s', sql.NVarChar, status).query("INSERT INTO Gateways (GatewayId, Name, Location, Status, IpAddress) VALUES (@id, @n, @l, @s, @i)"); res.json({success: true}); } catch(e) { res.json({success: false}); }
});
router.delete('/gateways/:id', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    try { await dbPool.request().input('id', sql.NVarChar, req.params.id).query("DELETE FROM Gateways WHERE GatewayId = @id"); res.json({success: true}); } catch(e) { res.json({success: false}); }
});

// --- ACTORS (FLEET) ---
router.get('/actors', async (req, res) => { 
    if (!dbPool) return res.json([]); 
    try { 
        const result = await dbPool.request().query("SELECT * FROM Actors"); 
        res.json(result.recordset.map(row => ({ 
            id: row.ActorId, proxyId: row.GatewayId, name: row.Name, localIp: row.LocalIp, status: row.Status, lastSeen: row.LastSeen, osVersion: row.OsVersion, 
            hasWifi: row.HasWifi, hasBluetooth: row.HasBluetooth, wifiScanningEnabled: row.WifiScanningEnabled, bluetoothScanningEnabled: row.BluetoothScanningEnabled, 
            cpuLoad: row.CpuLoad, memoryUsage: row.MemoryUsage, temperature: row.Temperature, tcpSentinelEnabled: row.TcpSentinelEnabled, 
            activeTunnels: row.TunnelsJson ? JSON.parse(row.TunnelsJson) : [], deployedHoneyFiles: row.HoneyFilesJson ? JSON.parse(row.HoneyFilesJson) : [], persona: row.Persona ? JSON.parse(row.Persona) : undefined,
            protocolVersion: row.AgentVersion || 'v1.0' // Map AgentVersion to frontend protocolVersion
        }))); 
    } catch (e) { res.status(500).json({error: e.message}); } 
});
router.put('/actors/:id', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    try { await dbPool.request().input('id', sql.NVarChar, req.params.id).input('n', sql.NVarChar, req.body.name).query("UPDATE Actors SET Name = @n WHERE ActorId = @id"); res.json({success: true}); } catch(e) { res.json({success: false}); }
});
router.delete('/actors/:id', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    try { await dbPool.request().input('id', sql.NVarChar, req.params.id).query("DELETE FROM Actors WHERE ActorId = @id"); res.json({success: true}); } catch(e) { res.json({success: false}); }
});
router.put('/actors/:id/tunnels', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    try { await dbPool.request().input('id', sql.NVarChar, req.params.id).input('j', sql.NVarChar, JSON.stringify(req.body)).query("UPDATE Actors SET TunnelsJson = @j WHERE ActorId = @id"); res.json({success: true}); } catch(e) { res.json({success: false}); }
});
router.put('/actors/:id/honeyfiles', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    try { await dbPool.request().input('id', sql.NVarChar, req.params.id).input('j', sql.NVarChar, JSON.stringify(req.body)).query("UPDATE Actors SET HoneyFilesJson = @j WHERE ActorId = @id"); res.json({success: true}); } catch(e) { res.json({success: false}); }
});
router.put('/actors/:id/persona', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    try { await dbPool.request().input('id', sql.NVarChar, req.params.id).input('j', sql.NVarChar, JSON.stringify(req.body)).query("UPDATE Actors SET Persona = @j WHERE ActorId = @id"); res.json({success: true}); } catch(e) { res.json({success: false}); }
});
router.put('/actors/:id/sentinel', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    try { await dbPool.request().input('id', sql.NVarChar, req.params.id).input('v', sql.Bit, req.body.enabled).query("UPDATE Actors SET TcpSentinelEnabled = @v WHERE ActorId = @id"); res.json({success: true}); } catch(e) { res.json({success: false}); }
});
router.put('/actors/:id/acknowledge', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    try { await dbPool.request().input('id', sql.NVarChar, req.params.id).query("UPDATE Actors SET Status = 'ONLINE' WHERE ActorId = @id"); res.json({success: true}); } catch(e) { res.json({success: false}); }
});
router.put('/actors/:id/scanning', async (req, res) => { 
    if (!dbPool) return res.json({success: false}); 
    const { type, enabled } = req.body; 
    try { 
        const col = type === 'WIFI' ? 'WifiScanningEnabled' : 'BluetoothScanningEnabled'; 
        await dbPool.request().input('id', sql.NVarChar, req.params.id).input('val', sql.Bit, enabled ? 1 : 0).query(`UPDATE Actors SET ${col} = @val WHERE ActorId = @id`); 
        res.json({success: true}); 
    } catch(e) { res.status(500).json({error: e.message}); } 
});

// --- COMMANDS ---
router.post('/commands/queue', async (req, res) => {
    if (!dbPool) return res.json({ jobId: null });
    const { actorId, command } = req.body;
    const jobId = `job-${Date.now()}`;
    try { await dbPool.request().input('jid', sql.NVarChar, jobId).input('aid', sql.NVarChar, actorId).input('cmd', sql.NVarChar, command).query("INSERT INTO CommandQueue (JobId, ActorId, Command, Status, CreatedAt, UpdatedAt) VALUES (@jid, @aid, @cmd, 'PENDING', GETDATE(), GETDATE())"); res.json({ jobId }); } catch(e) { res.json({ jobId: null }); }
});
router.get('/commands/:actorId', async (req, res) => {
    if (!dbPool) return res.json([]);
    try { const r = await dbPool.request().input('aid', sql.NVarChar, req.params.actorId).query("SELECT JobId as id, Command as command, Status as status, Output as output, CreatedAt as createdAt FROM CommandQueue WHERE ActorId = @aid ORDER BY CreatedAt DESC"); res.json(r.recordset); } catch(e) { res.json([]); }
});

router.post('/agent/result', async (req, res) => {
    if (!dbPool) return res.json({});
    const { jobId, status, output } = req.body;
    try { await dbPool.request().input('jid', sql.NVarChar, jobId).input('stat', sql.NVarChar, status).input('out', sql.NVarChar, output).query("UPDATE CommandQueue SET Status = @stat, Output = @out, UpdatedAt = GETDATE() WHERE JobId = @jid"); res.json({success: true}); } catch(e) { res.json({}); }
});

router.post('/agent/scan', async (req, res) => {
    if (!dbPool) return res.json({});
    const { actorId, cpu, ram, temp } = req.body;
    try { if (actorId) await dbPool.request().input('aid', sql.NVarChar, actorId).input('c', sql.Float, parseFloat(cpu)||0).input('r', sql.Float, parseFloat(ram)||0).input('t', sql.Float, parseFloat(temp)||0).query("UPDATE Actors SET CpuLoad = @c, MemoryUsage = @r, Temperature = @t, LastSeen = GETDATE() WHERE ActorId = @aid"); res.json({success:true}); } catch(e) { res.status(500).json({}); }
});

router.post('/agent/scan-results', async (req, res) => {
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

// --- AUDIT ---
router.post('/audit', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    const { username, action, details } = req.body;
    try {
        await dbPool.request()
            .input('aid', sql.NVarChar, 'SYSTEM')
            .input('lvl', sql.NVarChar, 'AUDIT')
            .input('proc', sql.NVarChar, 'USER_ACTION')
            .input('msg', sql.NVarChar, `[${username}] ${action}: ${details}`)
            .query("INSERT INTO Logs (LogId, ActorId, Level, Process, Message, Timestamp) VALUES (NEWID(), @aid, @lvl, @proc, @msg, GETDATE())");
        res.json({success: true});
    } catch(e) { res.json({success: false}); }
});

// --- LOGS ---
router.get('/logs', async (req, res) => {
    if (!dbPool) return res.json([]);
    try {
        const r = await dbPool.request().query(`
            SELECT TOP 200 l.LogId as id, l.ActorId as actorId, a.Name as actorName, l.Level as level, l.Process as process, l.Message as message, l.SourceIp as sourceIp, l.Timestamp as timestamp 
            FROM Logs l 
            LEFT JOIN Actors a ON l.ActorId = a.ActorId 
            ORDER BY l.Timestamp DESC
        `);
        res.json(r.recordset);
    } catch(e) { res.json([]); }
});

// --- ENROLLMENT ---
router.get('/enroll/pending', async (req, res) => {
    if (!dbPool) return res.json([]);
    try {
        const r = await dbPool.request().query("SELECT Id as id, HwId as hwid, DetectedIp as detectedIp, DetectedAt as detectedAt, OsVersion as osVersion FROM PendingActors");
        res.json(r.recordset);
    } catch(e) { res.json([]); }
});

router.post('/enroll/approve', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    const { pendingId, proxyId, name } = req.body;
    try {
        const pendingRes = await dbPool.request().input('pid', sql.NVarChar, pendingId).query("SELECT * FROM PendingActors WHERE Id = @pid");
        if (pendingRes.recordset.length === 0) return res.json({success: false, error: "Pending actor not found"});
        const pending = pendingRes.recordset[0];
        
        const actorId = `puppet-${Math.random().toString(36).substr(2,6)}`;
        await dbPool.request()
            .input('aid', sql.NVarChar, actorId)
            .input('hwid', sql.NVarChar, pending.HwId)
            .input('gw', sql.NVarChar, proxyId)
            .input('name', sql.NVarChar, name)
            .input('ip', sql.NVarChar, pending.DetectedIp)
            .input('os', sql.NVarChar, pending.OsVersion || 'Linux')
            .query(`
                INSERT INTO Actors (ActorId, HwId, GatewayId, Name, Status, LocalIp, LastSeen, OsVersion, AgentVersion)
                VALUES (@aid, @hwid, @gw, @name, 'ONLINE', GETDATE(), @ip, @os, '2.3.0')
            `);

        await dbPool.request().input('pid', sql.NVarChar, pendingId).query("DELETE FROM PendingActors WHERE Id = @pid");
        res.json({success: true});
    } catch(e) { res.json({success: false}); }
});

router.delete('/enroll/pending/:id', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    try {
        await dbPool.request().input('pid', sql.NVarChar, req.params.id).query("DELETE FROM PendingActors WHERE Id = @pid");
        res.json({success: true});
    } catch(e) { res.json({success: false}); }
});

router.post('/enroll/generate', async (req, res) => {
    if (!dbPool) return res.json({token: null});
    const { type, targetId, config } = req.body;
    const token = `tok-${Math.random().toString(36).substr(2,8)}`;
    try {
        await dbPool.request()
            .input('t', sql.NVarChar, token)
            .input('type', sql.NVarChar, type)
            .input('tid', sql.NVarChar, targetId || '')
            .input('cfg', sql.NVarChar, config ? JSON.stringify(config) : null)
            .query("INSERT INTO EnrollmentTokens (Token, Type, TargetId, ConfigJson, CreatedAt, IsUsed) VALUES (@t, @type, @tid, @cfg, GETDATE(), 0)");
        res.json({token});
    } catch(e) { res.json({token: null}); }
});

router.get('/enroll/config/:token', async (req, res) => {
    if (!dbPool) return res.status(404).json({});
    try {
        const r = await dbPool.request().input('t', sql.NVarChar, req.params.token).query("SELECT * FROM EnrollmentTokens WHERE Token = @t");
        if (r.recordset.length > 0) {
            res.json({ valid: true });
        } else {
            res.status(404).json({});
        }
    } catch(e) { res.status(500).json({}); }
});

// --- REPORTS ---
router.get('/reports', async (req, res) => {
    if (!dbPool) return res.json([]);
    try {
        const r = await dbPool.request().query("SELECT ReportId as id, Title as title, GeneratedBy as generatedBy, Type as type, CreatedAt as createdAt, ContentJson as content FROM Reports ORDER BY CreatedAt DESC");
        const reports = r.recordset.map(row => ({
            ...row,
            content: row.content ? JSON.parse(row.content) : {}
        }));
        res.json(reports);
    } catch(e) { res.json([]); }
});

router.post('/reports/generate', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    const payload = req.body;
    const id = `rep-${Date.now()}`;
    const title = payload.incidentDetails?.title || `Report ${new Date().toLocaleDateString()}`;
    
    let content = { ...payload };
    delete content.type;
    delete content.generatedBy;
    
    if (payload.type === 'SECURITY_AUDIT') {
        try {
            const actorStats = await dbPool.request().query("SELECT COUNT(*) as total, SUM(CASE WHEN Status='COMPROMISED' THEN 1 ELSE 0 END) as compromised, SUM(CASE WHEN Status='ONLINE' THEN 1 ELSE 0 END) as online FROM Actors");
            const logStats = await dbPool.request().query("SELECT COUNT(*) as total FROM Logs");
            const stats = actorStats.recordset[0];
            content.totalEvents = logStats.recordset[0].total;
            content.compromisedNodes = stats.compromised;
            content.activeNodes = stats.online;
            
            const topAtt = await dbPool.request().query("SELECT TOP 5 SourceIp as ip, COUNT(*) as count FROM Logs WHERE SourceIp IS NOT NULL GROUP BY SourceIp ORDER BY count DESC");
            content.topAttackers = topAtt.recordset;
        } catch (e) { console.error("Report Stat Error", e); }
    }

    try {
        await dbPool.request()
            .input('id', sql.NVarChar, id)
            .input('title', sql.NVarChar, title)
            .input('gen', sql.NVarChar, payload.generatedBy)
            .input('type', sql.NVarChar, payload.type)
            .input('content', sql.NVarChar, JSON.stringify(content))
            .query("INSERT INTO Reports (ReportId, Title, GeneratedBy, Type, CreatedAt, ContentJson) VALUES (@id, @title, @gen, @type, GETDATE(), @content)");
        res.json({success: true});
    } catch(e) { res.json({success: false}); }
});

router.delete('/reports/:id', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    try {
        await dbPool.request().input('id', sql.NVarChar, req.params.id).query("DELETE FROM Reports WHERE ReportId = @id");
        res.json({success: true});
    } catch(e) { res.json({success: false}); }
});

// --- WIRELESS RECON ---
router.get('/recon/wifi', async (req, res) => {
    if (!dbPool) return res.json([]);
    try {
        const r = await dbPool.request().query("SELECT Id as id, Ssid as ssid, Bssid as bssid, SignalStrength as signalStrength, Security as security, Channel as channel, ActorId as actorId, ActorName as actorName, LastSeen as lastSeen FROM WifiNetworks ORDER BY LastSeen DESC");
        res.json(r.recordset);
    } catch(e) { res.json([]); }
});

router.get('/recon/bluetooth', async (req, res) => {
    if (!dbPool) return res.json([]);
    try {
        const r = await dbPool.request().query("SELECT Id as id, Name as name, Mac as mac, Rssi as rssi, Type as type, ActorId as actorId, ActorName as actorName, LastSeen as lastSeen FROM BluetoothDevices ORDER BY LastSeen DESC");
        res.json(r.recordset);
    } catch(e) { res.json([]); }
});

// --- TRAP / GHOST MODE API ---
router.post('/trap/init', async (req, res) => {
    const sid = `trap-${Date.now()}`;
    const { actorId } = req.body;
    const data = initTrap(sid);
    // Log init
    if (dbPool && actorId && actorId !== 'unknown') {
        try {
            await dbPool.request()
                .input('aid', sql.NVarChar, actorId)
                .input('lvl', sql.NVarChar, 'INFO')
                .input('proc', sql.NVarChar, 'trap-relay')
                .input('msg', sql.NVarChar, `[TRAP INIT] New session ${sid}`)
                .query("INSERT INTO Logs (LogId, ActorId, Level, Process, Message, Timestamp) VALUES (NEWID(), @aid, @lvl, @proc, @msg, GETDATE())");
        } catch(e) {}
    }
    res.json(data);
});

router.post('/trap/interact', async (req, res) => {
    const { sessionId, input, actorId, attackerIp } = req.body;
    const response = interactTrap(input);
    
    // Log interaction and trigger alert if connected
    if (dbPool && actorId && actorId !== 'unknown') {
        try {
            const cleanInput = (input || '').trim().substring(0, 50);
            
            // Critical Check:
            // 1. Regex for sensitive keywords
            // 2. Explicit Sentinel Check
            let level = 'WARNING';
            const isSensitive = /USER|PASS|AUTH|SELECT|DROP|UNION/i.test(cleanInput);
            if (isSensitive) level = 'CRITICAL';
            if (sessionId === 'SENTINEL') level = 'CRITICAL';
            
            // 1. Insert Log with SourceIp (Attacker)
            await dbPool.request()
                .input('aid', sql.NVarChar, actorId)
                .input('lvl', sql.NVarChar, level)
                .input('proc', sql.NVarChar, sessionId === 'SENTINEL' ? 'sentinel' : 'trap-relay')
                .input('msg', sql.NVarChar, `[TRAP ALERT] Input: ${cleanInput}`)
                .input('ip', sql.NVarChar, attackerIp || null)
                .query("INSERT INTO Logs (LogId, ActorId, Level, Process, Message, Timestamp, SourceIp) VALUES (NEWID(), @aid, @lvl, @proc, @msg, GETDATE(), @ip)");
            
            // 2. Update Status to COMPROMISED
            await dbPool.request()
                .input('aid', sql.NVarChar, actorId)
                .query("UPDATE Actors SET Status = 'COMPROMISED' WHERE ActorId = @aid");
                
        } catch (e) {
            console.error("Failed to log trap interaction", e);
        }
    }
    
    res.json(response);
});

router.get('/sessions', (req, res) => res.json(getSessions()));
router.delete('/sessions/:id', (req, res) => { deleteSession(req.params.id); res.json({ success: true }); });

// --- AGENT HEARTBEAT & AUTO-UPDATE ---
router.get('/agent/heartbeat', async (req, res) => {
    if (!dbPool) return res.status(503).json({});
    const { hwid, os, version } = req.query; // version is now passed
    if (!hwid) return res.status(400).json({});
    
    try {
        const actor = await dbPool.request().input('h', sql.NVarChar, hwid).query("SELECT ActorId FROM Actors WHERE HwId = @h");
        
        if (actor.recordset.length > 0) {
            const actorId = actor.recordset[0].ActorId;
            
            // Update LastSeen, OS, and AgentVersion
            await dbPool.request()
                .input('aid', sql.NVarChar, actorId)
                .input('os', sql.NVarChar, os || 'Unknown')
                .input('ver', sql.NVarChar, version || '1.0.0')
                .query(`UPDATE Actors SET LastSeen=GETDATE(), 
                        OsVersion = CASE WHEN @os <> 'Unknown' THEN @os ELSE OsVersion END,
                        AgentVersion = @ver
                        WHERE ActorId = @aid`);
            
            return res.json({ 
                status: 'APPROVED', 
                actorId: actorId,
                latestVersion: CURRENT_AGENT_VERSION // Trigger auto-update if mismatch
            });
        }
        
        const pending = await dbPool.request().input('h', sql.NVarChar, hwid).query("SELECT * FROM PendingActors WHERE HwId = @h");
        if (pending.recordset.length === 0) {
             await dbPool.request().input('pid', sql.NVarChar, `temp-${Math.random().toString(36).substr(2,6)}`).input('h', sql.NVarChar, hwid).input('ip', sql.NVarChar, getClientIp(req)).input('os', sql.NVarChar, os||'Unknown').query("INSERT INTO PendingActors (Id, HwId, DetectedIp, DetectedAt, OsVersion) VALUES (@pid, @h, @ip, GETDATE(), @os)");
        }
        res.json({ status: 'PENDING' });
    } catch(e) { res.status(500).json({}); }
});

export default router;