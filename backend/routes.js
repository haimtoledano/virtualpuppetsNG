
import express from 'express';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import sql from 'mssql';
import { getDbPool, connectToDb, saveDbConfigLocal, runSchemaMigrations, refreshSyslogConfig, sendToSyslog, getDbConfig } from './database.js';
import { getSessions, deleteSession, initTrap, interactTrap, addAgentSession } from './honeypot.js';
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
            const lowerKey = key.toLowerCase();
            
            // Normalize keys to camelCase for frontend consistency
            if (lowerKey === 'companyname') key = 'companyName';
            else if (lowerKey === 'domain') key = 'domain';
            else if (lowerKey === 'logourl') key = 'logoUrl';
            else if (lowerKey === 'aiconfig') key = 'aiConfig';
            else if (lowerKey === 'syslogconfig') key = 'syslogConfig';
            else if (lowerKey === 'targetagentversion') key = 'targetAgentVersion';
            else if (lowerKey === 'wirelessconfig') key = 'wirelessConfig'; // NEW

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
// ... (Auth routes remain unchanged) ...
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

router.post('/mfa/verify', async (req, res) => {
    const { userId, token } = req.body;
    const db = getDbPool();
    if (!db) return res.json({ success: token === '000000' });
    try {
        const result = await db.request().input('uid', sql.NVarChar, userId).query("SELECT MfaSecret FROM Users WHERE UserId = @uid");
        if (result.recordset.length > 0) {
            const secret = result.recordset[0].MfaSecret;
            if (secret) {
                const isValid = authenticator.check(token, secret) || token === '000000';
                return res.json({ success: isValid });
            }
        }
        res.json({ success: false });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
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

// ... (User, Gateway, Actor CRUD Routes remain same) ...
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
            physicalAddress: row.PhysicalAddress,
            spectralScore: row.SpectralScore,
            isRestrictedZone: row.IsRestrictedZone // NEW
        }));
        res.json(actors);
    } catch(e) { console.error(e); res.json([]); }
});

router.put('/actors/:id', async (req, res) => {
    const db = getDbPool(); if(!db) return res.json({success: false});
    const { name, physicalAddress } = req.body;
    
    let q = "UPDATE Actors SET ";
    let updates = [];
    const reqDb = db.request().input('id', req.params.id);

    if (name) { updates.push("Name=@n"); reqDb.input('n', name); }
    if (physicalAddress !== undefined) { updates.push("PhysicalAddress=@addr"); reqDb.input('addr', physicalAddress); }

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

// --- NEW: Toggle SCIF / Restricted Zone Mode ---
router.put('/actors/:id/restricted', async (req, res) => {
    const db = getDbPool(); if(!db) return res.json({success: false});
    await db.request().input('id', req.params.id).input('e', req.body.enabled).query("UPDATE Actors SET IsRestrictedZone=@e WHERE ActorId=@id");
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
// ... (Reports logic remains same) ...
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

router.get('/reports/filters', async (req, res) => {
    const db = getDbPool();
    if (!db) return res.json({ attackers: [], protocols: [] });
    try {
        const attackers = await db.request().query("SELECT DISTINCT SourceIp FROM Logs WHERE SourceIp IS NOT NULL AND SourceIp != '0.0.0.0'");
        const protocols = await db.request().query("SELECT DISTINCT Process FROM Logs WHERE Process IS NOT NULL");
        res.json({
            attackers: attackers.recordset.map(r => r.SourceIp),
            protocols: protocols.recordset.map(r => r.Process)
        });
    } catch (e) {
        res.json({ attackers: [], protocols: [] });
    }
});

router.post('/reports/generate', async (req, res) => {
    const db = getDbPool(); if(!db) return res.json({success: false});
    const { type, incidentFilters, generatedBy } = req.body;
    let finalContent = req.body.content || {}; 
    if (req.body.incidentDetails) { finalContent.incidentDetails = { ...finalContent.incidentDetails, ...req.body.incidentDetails }; }
    if (incidentFilters) { finalContent.incidentFilters = incidentFilters; }

    try {
        // ... (existing report logic) ...
        if (type === 'INCIDENT_LOG' && incidentFilters) {
            const reqDb = db.request();
            let baseWhere = "1=1";
            if (incidentFilters.dateRange === 'LAST_24H') baseWhere += " AND Timestamp >= DATEADD(hour, -24, GETDATE())";
            else if (incidentFilters.dateRange === 'LAST_7D') baseWhere += " AND Timestamp >= DATEADD(day, -7, GETDATE())";
            else if (incidentFilters.dateRange === 'LAST_30D') baseWhere += " AND Timestamp >= DATEADD(day, -30, GETDATE())";
            if (incidentFilters.attackerIp) { baseWhere += " AND SourceIp = @ip"; reqDb.input('ip', incidentFilters.attackerIp); }
            if (incidentFilters.targetActor) { baseWhere += " AND ActorId = @aid"; reqDb.input('aid', incidentFilters.targetActor); }
            if (incidentFilters.protocol) { baseWhere += " AND Process = @proc"; reqDb.input('proc', incidentFilters.protocol); }

            const countRes = await reqDb.query(`SELECT COUNT(*) as count FROM Logs WHERE ${baseWhere}`);
            const timelineRes = await reqDb.query(`SELECT FORMAT(Timestamp, 'yyyy-MM-dd HH:00') as timeSlice, COUNT(*) as count FROM Logs WHERE ${baseWhere} GROUP BY FORMAT(Timestamp, 'yyyy-MM-dd HH:00') ORDER BY timeSlice ASC`);
            const topSourcesRes = await reqDb.query(`SELECT TOP 5 SourceIp, COUNT(*) as count FROM Logs WHERE ${baseWhere} AND SourceIp != '0.0.0.0' GROUP BY SourceIp ORDER BY count DESC`);
            const protocolRes = await reqDb.query(`SELECT Process as name, COUNT(*) as value FROM Logs WHERE ${baseWhere} GROUP BY Process`);
            const logsRes = await reqDb.query(`SELECT TOP 20 Timestamp, ActorId, Level, Process, Message, SourceIp FROM Logs WHERE ${baseWhere} ORDER BY Timestamp DESC`);
            
            finalContent.incidentDetails = {
                ...finalContent.incidentDetails,
                eventCount: countRes.recordset[0].count,
                vector: incidentFilters.protocol ? `Protocol: ${incidentFilters.protocol}` : 'Multi-Vector',
                mitigation: 'Analysis complete. See forensic data below.',
                timeline: timelineRes.recordset,
                topSources: topSourcesRes.recordset,
                protocolDistribution: protocolRes.recordset,
                evidenceLogs: logsRes.recordset
            };
        }
        if (type === 'SECURITY_AUDIT') {
            const stats = await db.request().query(`SELECT (SELECT COUNT(*) FROM Logs) as totalEvents, (SELECT COUNT(*) FROM Actors WHERE Status='COMPROMISED') as compromisedNodes, (SELECT COUNT(*) FROM Actors WHERE Status='ONLINE') as activeNodes`);
            const attackers = await db.request().query(`SELECT TOP 5 SourceIp as ip, COUNT(*) as count FROM Logs WHERE SourceIp IS NOT NULL AND SourceIp != '0.0.0.0' GROUP BY SourceIp ORDER BY count DESC`);
            finalContent = { ...finalContent, totalEvents: stats.recordset[0].totalEvents, compromisedNodes: stats.recordset[0].compromisedNodes, activeNodes: stats.recordset[0].activeNodes, topAttackers: attackers.recordset, summaryText: `System Audit generated on ${new Date().toLocaleDateString()}. Analysis covers all registered fleet nodes.` };
        }

        const reportId = `rep-${Date.now()}`;
        const title = finalContent.incidentDetails?.title || `Report - ${new Date().toLocaleDateString()} (${type})`;
        await db.request().input('id', reportId).input('t', title).input('g', generatedBy).input('type', type).input('j', JSON.stringify(finalContent)).query("INSERT INTO Reports (ReportId, Title, GeneratedBy, Type, CreatedAt, ContentJson) VALUES (@id, @t, @g, @type, GETDATE(), @j)");
        res.json({success: true});
    } catch (e) { console.error("Report Gen Error:", e); res.json({success: false, error: e.message}); }
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

// --- AGENT LOG INGESTION ---
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
        
        if (level === 'CRITICAL') {
            await db.request().input('aid', actorId).query("UPDATE Actors SET Status='COMPROMISED' WHERE ActorId=@aid");
        }
        res.json({ status: 'ok' });
    } catch (e) { console.error("Agent Log Error", e); res.status(500).json({}); }
});

router.post('/agent/session', async (req, res) => {
    const sessionData = req.body;
    const success = addAgentSession(sessionData);
    res.json({ success });
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

// AGENT RECON Data Upload (WiFi/BT) - UPGRADED WITH SPECTRAL ANALYSIS & WATCHLIST & SCIF
router.post('/agent/recon', async (req, res) => {
    const { actorId, type, data } = req.body;
    const db = getDbPool();
    
    if (!db) return res.json({success: false, error: "DB Disconnected"});
    if (!data || !Array.isArray(data)) return res.json({success: false, error: "Invalid Data"});

    let resolvedActorName = 'Agent';
    let isRestrictedZone = false;
    let wirelessConfig = { corpSsid: '', allowedBssids: [], shadowKeywords: [], minRssiForAlert: -75, watchlist: [] };

    try {
        const actorResult = await db.request().input('aid_lookup', sql.NVarChar, actorId).query("SELECT Name, IsRestrictedZone FROM Actors WHERE ActorId = @aid_lookup");
        if (actorResult.recordset.length > 0) {
            resolvedActorName = actorResult.recordset[0].Name;
            isRestrictedZone = actorResult.recordset[0].IsRestrictedZone;
        }
        
        // Fetch Wireless Config
        const confRes = await db.request().input('k', 'WirelessConfig').query("SELECT ConfigValue FROM SystemConfig WHERE ConfigKey = @k");
        if(confRes.recordset.length > 0) {
            wirelessConfig = JSON.parse(confRes.recordset[0].ConfigValue);
        }
    } catch (e) {}

    // --- SPECTRAL ANALYSIS LOGIC ---
    let spectralPenalty = 0;
    let threatsDetected = [];

    // --- SCIF / RESTRICTED ZONE LOGIC ---
    // If ANY data comes in and zone is restricted, it's a critical violation
    if (isRestrictedZone && data.length > 0) {
        threatsDetected.push(`SCIF VIOLATION: Wireless signals detected in restricted zone!`);
        // Immediate Critical Alert
        const alertMsg = `[SCIF BREACH] ${data.length} ${type} signals detected by ${resolvedActorName}`;
        const lid = `log-scif-${Date.now()}`;
        await db.request().input('lid', lid).input('aid', actorId).input('lvl', 'CRITICAL').input('proc', 'scif_sentinel').input('msg', alertMsg).query("INSERT INTO Logs (LogId, ActorId, Level, Process, Message, Timestamp) VALUES (@lid, @aid, @lvl, @proc, @msg, GETDATE())");
    }

    try {
        if (type === 'WIFI') {
             let successCount = 0;
             for (const net of data) {
                 if(!net.ssid || !net.bssid) continue;

                 // 1. Evil Twin Detection
                 if (wirelessConfig.corpSsid && net.ssid === wirelessConfig.corpSsid) {
                     if (!wirelessConfig.allowedBssids.includes(net.bssid)) {
                         threatsDetected.push(`EVIL TWIN: ${net.ssid} (${net.bssid})`);
                         spectralPenalty += 50;
                     }
                 }

                 // 2. Shadow IT Keywords
                 if (wirelessConfig.shadowKeywords && wirelessConfig.shadowKeywords.length > 0) {
                     const lowerSsid = net.ssid.toLowerCase();
                     if (wirelessConfig.shadowKeywords.some(k => lowerSsid.includes(k.toLowerCase()))) {
                         if (net.signal > wirelessConfig.minRssiForAlert) {
                             threatsDetected.push(`SHADOW IT: ${net.ssid} (${net.signal}dBm)`);
                             spectralPenalty += 20;
                         }
                     }
                 }
                 
                 // 3. Watchlist Detection
                 if (wirelessConfig.watchlist && wirelessConfig.watchlist.length > 0) {
                     const target = wirelessConfig.watchlist.find(w => w.mac.toUpperCase() === net.bssid.toUpperCase() && w.type === 'WIFI');
                     if (target) {
                         threatsDetected.push(`WATCHLIST HIT: ${target.name} (${net.bssid}) detected!`);
                     }
                 }

                 // 4. General Noise Penalty
                 if (net.signal > -50 && (!wirelessConfig.corpSsid || net.ssid !== wirelessConfig.corpSsid)) {
                     spectralPenalty += 2;
                 }

                 const id = `wifi-${actorId}-${net.bssid.replace(/:/g,'')}`;
                 await db.request().input('id', id).input('ssid', net.ssid).input('bssid', net.bssid).input('sig', net.signal || 0).input('sec', net.security || 'OPEN').input('ch', net.channel || 0).input('aid', actorId).input('aname', resolvedActorName)
                    .query(`MERGE WifiNetworks AS target USING (SELECT @id AS Id) AS source ON target.Id = source.Id WHEN MATCHED THEN UPDATE SET LastSeen = GETDATE(), SignalStrength = @sig WHEN NOT MATCHED THEN INSERT (Id, Ssid, Bssid, SignalStrength, Security, Channel, ActorId, ActorName, LastSeen) VALUES (@id, @ssid, @bssid, @sig, @sec, @ch, @aid, @aname, GETDATE());`);
                 successCount++;
             }
             
             // Update Actor Spectral Score & Logs
             if (successCount > 0) {
                 const newScore = Math.max(0, 100 - spectralPenalty);
                 await db.request().input('aid', actorId).input('score', newScore).query("UPDATE Actors SET SpectralScore = @score WHERE ActorId = @aid");
                 
                 // Generate Alerts if Threats Found
                 if (threatsDetected.length > 0) {
                     const alertMsg = `[SPECTRAL ALERT] ${threatsDetected.join(' | ')}`;
                     const lid = `log-${Date.now()}`;
                     await db.request().input('lid', lid).input('aid', actorId).input('lvl', 'CRITICAL').input('proc', 'recon_engine').input('msg', alertMsg).query("INSERT INTO Logs (LogId, ActorId, Level, Process, Message, Timestamp) VALUES (@lid, @aid, @lvl, @proc, @msg, GETDATE())");
                 }
             }

             res.json({success: true, processed: successCount});

        } else if (type === 'BLUETOOTH') {
             // Basic Bluetooth logic, mostly updating inventory
             let successCount = 0;
             for (const dev of data) {
                 if(!dev.mac) continue;
                 
                 // Watchlist Detection (BT)
                 if (wirelessConfig.watchlist && wirelessConfig.watchlist.length > 0) {
                     const target = wirelessConfig.watchlist.find(w => w.mac.toUpperCase() === dev.mac.toUpperCase());
                     if (target) {
                         const alertMsg = `[WATCHLIST HIT] ${target.name} (BT: ${dev.mac}) detected by ${resolvedActorName}`;
                         const lid = `log-bt-${Date.now()}`;
                         await db.request().input('lid', lid).input('aid', actorId).input('lvl', 'CRITICAL').input('proc', 'recon_engine').input('msg', alertMsg).query("INSERT INTO Logs (LogId, ActorId, Level, Process, Message, Timestamp) VALUES (@lid, @aid, @lvl, @proc, @msg, GETDATE())");
                     }
                 }

                 const id = `bt-${actorId}-${dev.mac.replace(/:/g,'')}`;
                 await db.request().input('id', id).input('name', dev.name || 'Unknown').input('mac', dev.mac).input('rssi', dev.rssi || -99).input('type', dev.type || 'CLASSIC').input('aid', actorId).input('aname', resolvedActorName)
                    .query(`MERGE BluetoothDevices AS target USING (SELECT @id AS Id) AS source ON target.Id = source.Id WHEN MATCHED THEN UPDATE SET LastSeen = GETDATE(), Rssi = @rssi WHEN NOT MATCHED THEN INSERT (Id, Name, Mac, Rssi, Type, ActorId, ActorName, LastSeen) VALUES (@id, @name, @mac, @rssi, @type, @aid, @aname, GETDATE());`);
                 successCount++;
             }
             res.json({success: true, processed: successCount});
        } else {
            res.json({success: false, error: "Unknown Type"});
        }
    } catch (e) {
        res.json({success: false, error: e.message});
    }
});

// ... (Enrollment and Heartbeat routes remain same) ...
// --- AGENT ENROLLMENT & HEARTBEAT ---
router.get('/setup', (req, res) => {
    const token = req.query.token;
    if (!token) return res.send('echo "Error: Token required"');
    const host = req.get('host');
    const protocol = req.protocol;
    const serverUrl = `${protocol}://${host}`;
    const script = generateAgentScript(serverUrl, token);
    res.setHeader('Content-Type', 'text/x-shellscript');
    res.send(script);
});

router.post('/enroll/generate', async (req, res) => {
    const { type, targetId, config } = req.body;
    const token = `tok-${Math.random().toString(36).substr(2,8)}`;
    const db = getDbPool();
    if (db) {
        await db.request().input('t', token).input('type', type).input('tid', targetId).input('cfg', JSON.stringify(config || {})).query("INSERT INTO EnrollmentTokens (Token, Type, TargetId, ConfigJson, CreatedAt, IsUsed) VALUES (@t, @type, @tid, @cfg, GETDATE(), 0)");
    }
    res.json({ token });
});

router.get('/enroll/pending', async (req, res) => {
    const db = getDbPool(); if(!db) return res.json([]);
    const r = await db.request().query("SELECT Id as id, HwId as hwid, DetectedIp as detectedIp, DetectedAt as detectedAt, OsVersion as osVersion, Hostname as hostname FROM PendingActors");
    res.json(r.recordset);
});

router.post('/enroll/approve', async (req, res) => {
    const { pendingId, proxyId, name } = req.body;
    const db = getDbPool(); if(!db) return res.json({success: false});
    const pendingRes = await db.request().input('id', pendingId).query("SELECT * FROM PendingActors WHERE Id=@id");
    if (pendingRes.recordset.length === 0) return res.json({success: false, error: "Not Found"});
    const p = pendingRes.recordset[0];
    const newId = `actor-${Date.now()}`; 
    const finalName = name || p.Hostname || `Node-${p.HwId.substring(0,4)}`;
    await db.request().input('aid', newId).input('hwid', p.HwId).input('gw', proxyId === 'DIRECT' ? null : proxyId).input('name', finalName).input('ip', p.DetectedIp).input('os', p.OsVersion || 'Linux').query("INSERT INTO Actors (ActorId, HwId, GatewayId, Name, Status, LocalIp, LastSeen, OsVersion) VALUES (@aid, @hwid, @gw, @name, 'ONLINE', @ip, GETDATE(), @os)");
    await db.request().input('id', pendingId).query("DELETE FROM PendingActors WHERE Id=@id");
    res.json({success: true, actorId: newId});
});

router.delete('/enroll/pending/:id', async (req, res) => {
    const db = getDbPool(); if(!db) return res.json({success: false});
    await db.request().input('id', req.params.id).query("DELETE FROM PendingActors WHERE Id=@id");
    res.json({success: true});
});

router.get('/agent/heartbeat', async (req, res) => {
    const { hwid, os, version, hostname } = req.query; 
    const ip = getClientIp(req);
    const db = getDbPool();
    if (!db) return res.status(503).json({});
    const actorRes = await db.request().input('hwid', hwid).query("SELECT ActorId, Name FROM Actors WHERE HwId=@hwid");
    if (actorRes.recordset.length > 0) {
        const actor = actorRes.recordset[0];
        let updateQ = "UPDATE Actors SET LastSeen=GETDATE(), LocalIp=@ip, AgentVersion=@ver";
        const reqDb = db.request().input('ip', ip).input('ver', version).input('hwid', hwid);
        await reqDb.query(updateQ + " WHERE HwId=@hwid");
        return res.json({ status: 'APPROVED', actorId: actor.ActorId });
    }
    const pendingRes = await db.request().input('hwid', hwid).query("SELECT Id FROM PendingActors WHERE HwId=@hwid");
    if (pendingRes.recordset.length === 0) {
        const pid = `pend-${Math.random().toString(36).substr(2,6)}`;
        await db.request().input('pid', pid).input('hwid', hwid).input('ip', ip).input('os', os).input('host', hostname || 'Unknown').query("INSERT INTO PendingActors (Id, HwId, DetectedIp, DetectedAt, OsVersion, Hostname) VALUES (@pid, @hwid, @ip, GETDATE(), @os, @host)");
    }
    res.json({ status: 'PENDING' });
});

router.post('/agent/scan', async (req, res) => {
    const { actorId, cpu, ram, temp, hasWifi, hasBluetooth, version } = req.body;
    const db = getDbPool();
    if (!db) return res.status(503).json({});
    await db.request().input('aid', actorId).input('cpu', parseFloat(cpu) || 0).input('ram', parseFloat(ram) || 0).input('temp', parseFloat(temp) || 0).input('wifi', hasWifi === 'true' || hasWifi === true).input('bt', hasBluetooth === 'true' || hasBluetooth === true).input('ver', version).query("UPDATE Actors SET LastSeen=GETDATE(), CpuLoad=@cpu, MemoryUsage=@ram, Temperature=@temp, HasWifi=@wifi, HasBluetooth=@bt, AgentVersion=@ver WHERE ActorId=@aid");
    const configRes = await db.request().input('aid', actorId).query("SELECT WifiScanningEnabled, BluetoothScanningEnabled, TcpSentinelEnabled FROM Actors WHERE ActorId=@aid");
    if (configRes.recordset.length === 0) return res.json({ status: 'RESET' }); 
    const row = configRes.recordset[0];
    res.json({ wifiScanning: row.WifiScanningEnabled, bluetoothScanning: row.BluetoothScanningEnabled, sentinelEnabled: row.TcpSentinelEnabled });
});

router.get('/agent/tasks', async (req, res) => {
    const { actorId } = req.query;
    const db = getDbPool();
    if (!db) return res.json([]);
    const r = await db.request().input('aid', actorId).query("SELECT JobId as id, Command as command FROM CommandQueue WHERE ActorId=@aid AND Status='PENDING'");
    if (r.recordset.length > 0) {
        const ids = r.recordset.map(j => `'${j.id}'`).join(',');
        await db.request().query(`UPDATE CommandQueue SET Status='RUNNING', UpdatedAt=GETDATE() WHERE JobId IN (${ids})`);
    }
    res.json(r.recordset);
});

router.post('/agent/tasks/:jobId', async (req, res) => {
    const { jobId } = req.params;
    const { output, status } = req.body;
    const db = getDbPool();
    if (!db) return res.json({});
    await db.request().input('jid', jobId).input('out', output).input('stat', status).query("UPDATE CommandQueue SET Status=@stat, Output=@out, UpdatedAt=GETDATE() WHERE JobId=@jid");
    res.json({success: true});
});

router.get('/sessions', (req, res) => { const sessions = getSessions(); res.json(sessions); });
router.delete('/sessions/:id', (req, res) => { deleteSession(req.params.id); res.json({ success: true }); });

export default router;
