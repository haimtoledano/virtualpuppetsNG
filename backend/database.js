
import sql from 'mssql';
import fs from 'fs';
import path from 'path';
import dgram from 'dgram';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_FILE = path.join(__dirname, '../db-config.json');

export let dbPool = null;
let syslogConfig = { host: '', port: 514, enabled: false };

export const getDbConfig = () => {
    if (fs.existsSync(CONFIG_FILE)) {
        try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return null; }
    }
    return null;
};

// Safe Accessor
export const getDbPool = () => dbPool;

export const connectToDb = async (config) => {
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

export const saveDbConfigLocal = (config) => {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({...config, isConnected: true}, null, 2));
};

export const refreshSyslogConfig = async () => {
    if (!dbPool) return;
    try {
        const res = await dbPool.request().query("SELECT ConfigKey, ConfigValue FROM SystemConfig WHERE ConfigKey IN ('SyslogHost', 'SyslogPort', 'SyslogEnabled')");
        const cfg = {};
        res.recordset.forEach(r => cfg[r.ConfigKey] = r.ConfigValue);
        syslogConfig = { host: cfg['SyslogHost'] || '', port: parseInt(cfg['SyslogPort']) || 514, enabled: cfg['SyslogEnabled'] === 'true' };
    } catch (e) {}
};

export const sendToSyslog = (level, processName, message) => {
    if (!syslogConfig.enabled || !syslogConfig.host) return;
    const client = dgram.createSocket('udp4');
    const msg = `<134>${new Date().toISOString()} VPP-C2 ${processName}: ${message}`;
    client.send(msg, syslogConfig.port, syslogConfig.host, (err) => { client.close(); });
};

export const runSchemaMigrations = async () => {
    if (!dbPool) return;
    const req = new sql.Request(dbPool);
    try {
        // Core Tables
        await req.query(`IF OBJECT_ID('SystemConfig','U') IS NULL CREATE TABLE SystemConfig (ConfigKey NVARCHAR(50) PRIMARY KEY, ConfigValue NVARCHAR(MAX))`);
        await req.query(`IF OBJECT_ID('Users','U') IS NULL CREATE TABLE Users (UserId NVARCHAR(50) PRIMARY KEY, Username NVARCHAR(100), PasswordHash NVARCHAR(255), Role NVARCHAR(20), MfaEnabled BIT DEFAULT 0, MfaSecret NVARCHAR(100), LastLogin DATETIME, Preferences NVARCHAR(MAX))`);
        await req.query(`IF OBJECT_ID('Actors','U') IS NULL CREATE TABLE Actors (ActorId NVARCHAR(50) PRIMARY KEY, HwId NVARCHAR(100), GatewayId NVARCHAR(50), Name NVARCHAR(100), Status NVARCHAR(20), LocalIp NVARCHAR(50), LastSeen DATETIME, Config NVARCHAR(MAX), OsVersion NVARCHAR(100), TunnelsJson NVARCHAR(MAX), Persona NVARCHAR(MAX), HoneyFilesJson NVARCHAR(MAX), HasWifi BIT DEFAULT 0, HasBluetooth BIT DEFAULT 0, WifiScanningEnabled BIT DEFAULT 0, BluetoothScanningEnabled BIT DEFAULT 0, CpuLoad FLOAT DEFAULT 0, MemoryUsage FLOAT DEFAULT 0, Temperature FLOAT DEFAULT 0, TcpSentinelEnabled BIT DEFAULT 0, AgentVersion NVARCHAR(50))`);
        await req.query(`IF OBJECT_ID('Gateways','U') IS NULL CREATE TABLE Gateways (GatewayId NVARCHAR(50) PRIMARY KEY, Name NVARCHAR(100), Location NVARCHAR(100), Status NVARCHAR(20), IpAddress NVARCHAR(50), Lat FLOAT, Lng FLOAT)`);
        await req.query(`IF OBJECT_ID('Logs','U') IS NULL CREATE TABLE Logs (LogId NVARCHAR(50) PRIMARY KEY, ActorId NVARCHAR(50), Level NVARCHAR(20), Process NVARCHAR(50), Message NVARCHAR(MAX), SourceIp NVARCHAR(50), Timestamp DATETIME)`);
        await req.query(`IF OBJECT_ID('CommandQueue','U') IS NULL CREATE TABLE CommandQueue (JobId NVARCHAR(50) PRIMARY KEY, ActorId NVARCHAR(50), Command NVARCHAR(MAX), Status NVARCHAR(20), Output NVARCHAR(MAX), CreatedAt DATETIME, UpdatedAt DATETIME)`);
        await req.query(`IF OBJECT_ID('Reports','U') IS NULL CREATE TABLE Reports (ReportId NVARCHAR(50) PRIMARY KEY, Title NVARCHAR(100), GeneratedBy NVARCHAR(100), Type NVARCHAR(50), CreatedAt DATETIME, ContentJson NVARCHAR(MAX))`);
        await req.query(`IF OBJECT_ID('EnrollmentTokens','U') IS NULL CREATE TABLE EnrollmentTokens (Token NVARCHAR(50) PRIMARY KEY, Type NVARCHAR(20), TargetId NVARCHAR(50), ConfigJson NVARCHAR(MAX), CreatedAt DATETIME, IsUsed BIT)`);
        
        // Ensure PendingActors has all columns
        await req.query(`IF OBJECT_ID('PendingActors','U') IS NULL CREATE TABLE PendingActors (Id NVARCHAR(50) PRIMARY KEY, HwId NVARCHAR(100), DetectedIp NVARCHAR(50), TargetGatewayId NVARCHAR(50), DetectedAt DATETIME, OsVersion NVARCHAR(100))`);
        
        await req.query(`IF OBJECT_ID('WifiNetworks','U') IS NULL CREATE TABLE WifiNetworks (Id NVARCHAR(50) PRIMARY KEY, Ssid NVARCHAR(100), Bssid NVARCHAR(50), SignalStrength INT, Security NVARCHAR(20), Channel INT, ActorId NVARCHAR(50), ActorName NVARCHAR(100), LastSeen DATETIME)`);
        await req.query(`IF OBJECT_ID('BluetoothDevices','U') IS NULL CREATE TABLE BluetoothDevices (Id NVARCHAR(50) PRIMARY KEY, Name NVARCHAR(100), Mac NVARCHAR(50), Rssi INT, Type NVARCHAR(20), ActorId NVARCHAR(50), ActorName NVARCHAR(100), LastSeen DATETIME)`);
        
        // Migrations for missing columns if table already existed
        try { await req.query("IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Actors' AND COLUMN_NAME = 'AgentVersion') ALTER TABLE Actors ADD AgentVersion NVARCHAR(50)"); } catch(e) {}
        try { await req.query("IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Actors' AND COLUMN_NAME = 'CpuLoad') ALTER TABLE Actors ADD CpuLoad FLOAT DEFAULT 0"); } catch(e) {}
        try { await req.query("IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Actors' AND COLUMN_NAME = 'TcpSentinelEnabled') ALTER TABLE Actors ADD TcpSentinelEnabled BIT DEFAULT 0"); } catch(e) {}
        try { await req.query("IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'PendingActors' AND COLUMN_NAME = 'OsVersion') ALTER TABLE PendingActors ADD OsVersion NVARCHAR(100)"); } catch(e) {}
        try { await req.query("IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Gateways' AND COLUMN_NAME = 'Lat') ALTER TABLE Gateways ADD Lat FLOAT"); } catch(e) {}
        try { await req.query("IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Gateways' AND COLUMN_NAME = 'Lng') ALTER TABLE Gateways ADD Lng FLOAT"); } catch(e) {}

        // SuperAdmin
        const uCheck = await req.query("SELECT * FROM Users WHERE Username = 'superadmin'");
        if (uCheck.recordset.length === 0) {
            await req.query("INSERT INTO Users (UserId, Username, PasswordHash, Role) VALUES ('usr-super-01', 'superadmin', 'btoa_hash_123qweASDF!!@!', 'SUPERADMIN')");
        }
    } catch (e) {
        console.error("Migration Error:", e);
    }
};

export const initDb = async () => {
    const cfg = getDbConfig();
    if (cfg && cfg.isConnected) {
        await connectToDb(cfg);
        await runSchemaMigrations();
        await refreshSyslogConfig();
    }
};
