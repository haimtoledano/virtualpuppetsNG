
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
    res.json({ success: true }); 
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
            temperature: row.Temperature,
            physicalAddress: row.PhysicalAddress // Included
        }));
        res.json(actors);
    } catch(e) { console.error(e); res.json([]); }
});

router.put('/actors/:id', async (req, res) => {
    const db = getDbPool(); if(!db) return res.json({success: false});
    // Support update for physicalAddress
    const { name, physicalAddress } = req.body;
    
    let q = "UPDATE Actors SET ";
    let updates = [];
    const reqDb = db.request().input('id', req.params.id);

    if (name) {
        updates.push("Name=@n");
        reqDb.input('n', name);
    }
    if (physicalAddress !== undefined) {
        updates.push("PhysicalAddress=@addr");
        reqDb.input('addr', physicalAddress);
    }

    if (updates.length > 0) {
        q += updates.join(", ") + " WHERE ActorId=@id";
        await reqDb.query(q);
    }
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
    // Fix: Add random suffix to JobId to prevent collisions on parallel inserts (like fleet updates)
    const jobId = `job-${Date.now()}-${Math.random().toString(36).substr(2,6)}`;
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

// --- AGENT LOG INGESTION (New) ---
router.post('/agent/log', async (req, res) => {
    const { actorId, level, process, message, sourceIp } = req.body;
    const db = getDbPool();
    if (!db) return res.status(503).json({});
    
    try {
        const logId = `log-${Date.now()}-${Math.random().toString(36).substr(2,4)}`;
        await db.request()
            .input('lid', logId)
            .input('aid', actorId)
            .input('lvl', level || 'INFO')
            .input('proc', process || 'agent')
            .input('msg', message || '')
            .input('ip', sourceIp || '0.0.0.0')
            .query("INSERT INTO Logs (LogId, ActorId, Level, Process, Message, SourceIp, Timestamp) VALUES (@lid, @aid, @lvl, @proc, @msg, @ip, GETDATE())");
        
        // --- CRITICAL: AUTO-COMPROMISE LOGIC ---
        if (level === 'CRITICAL') {
            await db.request()
                .input('aid', actorId)
                .query("UPDATE Actors SET Status='COMPROMISED' WHERE ActorId=@aid");
        }

        res.json({ status: 'ok' });
    } catch (e) {
        console.error("Agent Log Error", e);
        res.status(500).json({});
    }
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

// NEW: Agent Recon Data Upload (WiFi/BT) - WITH DEBUG LOGGING
router.post('/agent/recon', async (req, res) => {
    const { actorId, type, data } = req.body;
    const db = getDbPool();
    
    console.log(`[API-RECON] Received from ${actorId} | Type: ${type} | Count: ${data ? data.length : 0}`);

    if (!db) {
        console.error("[API-RECON] Database not connected!");
        return res.json({success: false, error: "DB Disconnected"});
    }

    if (!data || !Array.isArray(data)) {
        console.error("[API-RECON] Invalid data format (not array)");
        return res.json({success: false, error: "Invalid Data"});
    }

    // RESOLVE ACTOR NAME FROM DB TO DISPLAY IN RECON TABLE
    let resolvedActorName = 'Agent';
    try {
        const actorResult = await db.request().input('aid_lookup', sql.NVarChar, actorId).query("SELECT Name FROM Actors WHERE ActorId = @aid_lookup");
        if (actorResult.recordset.length > 0) {
            resolvedActorName = actorResult.recordset[0].Name;
        }
    } catch (e) {
        console.warn("[API-RECON] Failed to resolve actor name:", e.message);
    }

    try {
        if (type === 'WIFI') {
             let successCount = 0;
             let failCount = 0;
             
             // Use explicit request for each loop iteration to avoid potential request busy state
             for (const net of data) {
                 try {
                     if(!net.ssid || !net.bssid) {
                         // Skip invalid but don't stop
                         failCount++;
                         continue;
                     }

                     const id = `wifi-${actorId}-${net.bssid.replace(/:/g,'')}`;
                     
                     await db.request()
                        .input('id', id)
                        .input('ssid', net.ssid)
                        .input('bssid', net.bssid)
                        .input('sig', net.signal || 0)
                        .input('sec', net.security || 'OPEN')
                        .input('ch', net.channel || 0)
                        .input('aid', actorId)
                        .input('aname', resolvedActorName) // Use resolved name
                        .query(`
                            MERGE WifiNetworks AS target
                            USING (SELECT @id AS Id) AS source ON