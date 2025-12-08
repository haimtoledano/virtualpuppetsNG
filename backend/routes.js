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

// ... MFA routes omitted for brevity (they use getDbPool()) ...

// --- AGENT HEARTBEAT & ENROLLMENT ---
router.get('/agent/heartbeat', async (req, res) => {
    const db = getDbPool();
    if (!db) {
        console.warn("[API] Heartbeat rejected: DB Not Connected");
        return res.status(503).json({});
    }

    const { hwid, os, version } = req.query;
    if (!hwid) {
        console.warn("[API] Heartbeat rejected: Missing HWID");
        return res.status(400).json({});
    }
    
    try {
        // Check for existing actor
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
        
        // Check for existing pending
        const pending = await db.request().input('h', sql.NVarChar, hwid).query("SELECT * FROM PendingActors WHERE HwId = @h");
        if (pending.recordset.length === 0) {
             console.log(`[API] New Agent Detected: ${hwid} (${os})`);
             await db.request()
                .input('pid', sql.NVarChar, `temp-${Math.random().toString(36).substr(2,6)}`)
                .input('h', sql.NVarChar, hwid)
                .input('ip', sql.NVarChar, getClientIp(req))
                .input('os', sql.NVarChar, os||'Unknown')
                // Default TargetGatewayId to empty string or handle logic to find default
                .query("INSERT INTO PendingActors (Id, HwId, DetectedIp, DetectedAt, OsVersion, TargetGatewayId) VALUES (@pid, @h, @ip, GETDATE(), @os, '')");
        }
        res.json({ status: 'PENDING' });
    } catch(e) { 
        console.error("[API] Heartbeat Error:", e);
        res.status(500).json({}); 
    }
});

// --- SETUP SCRIPT GEN ROUTE ---
router.get('/setup', (req, res) => {
    const host = req.get('host');
    const protocol = req.protocol;
    // URL construction: ensure no trailing slash/api duplication issues in future
    const serverUrl = `${protocol}://${host}`; 
    const token = req.query.token || 'manual_install';
    
    const script = generateAgentScript(serverUrl, token);
    res.setHeader('Content-Type', 'text/plain');
    res.send(script);
});

// --- Other routes (enroll, reports, etc) also use getDbPool() implicitely via copy-paste or assuming standard usage ---
// Re-exporting critical routes for Enroll/Enrollment for context of previous files:

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

export default router;