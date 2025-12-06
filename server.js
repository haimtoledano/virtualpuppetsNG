

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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 8080;
const distPath = path.join(__dirname, 'dist');
const CONFIG_FILE = path.join(__dirname, 'db-config.json');

// --- MFA CONFIGURATION ---
authenticator.options = { window: [2, 2] };

app.use(cors());

// --- MODIFIED BODY PARSER FOR DEBUGGING ---
// We use 'verify' to capture the raw body content before JSON parsing fails
app.use(bodyParser.json({
    limit: '10mb',
    verify: (req, res, buf) => {
        req.rawBody = buf.toString();
    }
}));

// --- JSON SYNTAX ERROR HANDLER WITH RAW BODY LOGGING ---
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && 'body' in err) {
        console.error('--------------------------------------------------');
        console.error('❌ JSON Syntax Error Received');
        console.error('Error Message:', err.message);
        console.error('--- OFFENDING PAYLOAD START ---');
        console.error(req.rawBody || 'Raw body not captured');
        console.error('--- OFFENDING PAYLOAD END ---');
        console.error('--------------------------------------------------');
        return res.status(400).json({ success: false, error: 'Invalid JSON payload' });
    }
    next();
});

// --- HELPER: GET REAL IP ---
const getClientIp = (req) => {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded ? forwarded.split(',')[0] : req.socket.remoteAddress;
    // Handle IPv6 mapped to IPv4
    return ip ? ip.replace('::ffff:', '') : '0.0.0.0';
};

// --- SYSLOG FORWARDER ---
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
    } catch (e) { console.error("Syslog config refresh error", e.message); }
};

const sendToSyslog = (level, processName, message) => {
    if (!syslogConfig.enabled || !syslogConfig.host) return;
    const pri = 134; 
    const timestamp = new Date().toISOString();
    const hostname = 'VPP-C2-SERVER';
    const msg = `<${pri}>${timestamp} ${hostname} ${processName}: ${message}`;

    const client = dgram.createSocket('udp4');
    const buffer = Buffer.from(msg);

    client.send(buffer, 0, buffer.length, syslogConfig.port, syslogConfig.host, (err) => {
        if (err) console.error("Syslog send error:", err);
        client.close();
    });
};

// --- BOOTSTRAP SCRIPT ---
app.get('/setup', (req, res) => {
    const host = req.get('host');
    const protocol = req.protocol;
    const serverUrl = `${protocol}://${host}`;
    
    const script = `
#!/bin/bash
TOKEN=$1
SERVER_URL="${serverUrl}"
AGENT_DIR="/opt/vpp-agent"
LOG_FILE="/var/log/vpp-agent.log"

if [ "$EUID" -ne 0 ]; then echo "Please run as root"; exit 1; fi

echo "--------------------------------------------------"
echo "   Virtual Puppets Agent Bootstrap v6.1"
echo "--------------------------------------------------"

echo "[*] Checking dependencies..."
if command -v apt-get &> /dev/null; then
    export DEBIAN_FRONTEND=noninteractive
    if ! command -v jq &> /dev/null; then apt-get update -qq && apt-get install -y jq -qq; fi
    if ! command -v curl &> /dev/null; then apt-get install -y curl -qq; fi
    if ! command -v nmcli &> /dev/null; then apt-get install -y network-manager -qq; fi
    if ! command -v hcitool &> /dev/null; then apt-get install -y bluez -qq; fi
    if ! command -v ss &> /dev/null; then apt-get install -y iproute2 -qq; fi
    if ! command -v socat &> /dev/null; then apt-get install -y socat -qq; fi
    if ! command -v netstat &> /dev/null; then apt-get install -y net-tools -qq; fi
    if ! command -v lsof &> /dev/null; then apt-get install -y lsof -qq; fi
fi

HWID=$(cat /sys/class/net/eth0/address 2>/dev/null || cat /sys/class/net/wlan0/address 2>/dev/null || hostname)
OS_NAME="Linux (Unknown)"
if [ -f /etc/os-release ]; then . /etc/os-release; if [ -n "$PRETTY_NAME" ]; then OS_NAME="$PRETTY_NAME"; fi; fi

# Detect Capabilities
HAS_WIFI=false
HAS_BT=false
if command -v nmcli &> /dev/null && nmcli device | grep -q wifi; then HAS_WIFI=true; fi
if command -v hcitool &> /dev/null && hcitool dev | grep -q hci; then HAS_BT=true; fi

echo "[*] Connecting to C2: $SERVER_URL | HWID: $HWID"
if [ -z "$TOKEN" ]; then echo "[!] Error: No token provided."; exit 1; fi

mkdir -p $AGENT_DIR
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "X-VPP-HWID: $HWID" -H "X-VPP-OS: $OS_NAME" \
    -H "X-VPP-WIFI: $HAS_WIFI" -H "X-VPP-BT: $HAS_BT" \
    "$SERVER_URL/api/enroll/config/$TOKEN")

if [ "$HTTP_CODE" -ne "200" ]; then echo "[!] Registration failed."; exit 1; fi
echo "[+] Registration successful. Waiting for approval..."

cat <<EOF > $AGENT_DIR/agent.sh
#!/bin/bash
# Ensure standard paths are available
export PATH=\$PATH:/usr/sbin:/sbin:/usr/bin:/bin

SERVER="$SERVER_URL"
MY_HWID="$HWID"
ACTOR_ID=""
LOGF="$LOG_FILE"
HAS_WIFI=$HAS_WIFI
HAS_BT=$HAS_BT
AGENT_DIR="$AGENT_DIR"
EOF

cat <<'EndAgent' >> $AGENT_DIR/agent.sh
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] \$1" >> \$LOGF; }

log "Agent Started. Initializing..."

# --- MOCK VPP CLI FUNCTIONS ---
vpp-agent() {
    log "VPP-Agent Command: \$*"
    if [[ "\$1" == "--set-persona" ]]; then
        echo "Updating system persona..."
        sleep 1
        echo "Persona configuration applied successfully."
        log "Persona changed to: \$2"
    else
        echo "VPP Agent v2.1 - Status OK"
    fi
    return 0
}
export -f vpp-agent

vpp-route() {
    log "VPP-Route Command: \$*"
    echo "Routing table updated."
    return 0
}
export -f vpp-route
# ------------------------------

if ! command -v jq &> /dev/null; then
    log "Error: jq is missing."
    exit 1
fi

# Enrollment Loop
while [ -z "\$ACTOR_ID" ] || [ "\$ACTOR_ID" == "null" ]; do
    RESPONSE=\$(curl -s --connect-timeout 10 "\$SERVER/api/agent/heartbeat?hwid=\$MY_HWID")
    if echo "\$RESPONSE" | jq empty > /dev/null 2>&1; then
        STATUS=\$(echo "\$RESPONSE" | jq -r '.status')
        if [ "\$STATUS" == "APPROVED" ]; then
            ACTOR_ID=\$(echo "\$RESPONSE" | jq -r '.actorId')
            echo "\$ACTOR_ID" > "\$AGENT_DIR/vpp-id"
            log "[+] Device Approved! Assigned ID: \$ACTOR_ID"
        else
            sleep 5
        fi
    else
        log "Heartbeat failed. Server unreachable?"
        sleep 5
    fi
done

# Wireless Scan Loop
(
    while true; do
        WIFI_JSON="[]"
        if [ "\$HAS_WIFI" = true ]; then
             RAW_WIFI=\$(nmcli -t -f SSID,BSSID,SIGNAL,SECURITY dev wifi list 2>/dev/null)
             if [ ! -z "\$RAW_WIFI" ]; then
                WIFI_JSON=\$(echo "\$RAW_WIFI" | jq -R -s -c 'split("\n")[:-1] | map(split(":")) | map({ssid: .[0], bssid: (.[1]+":"+.[2]+":"+.[3]+":"+.[4]+":"+.[5]+":"+.[6]), signal: .[7], security: .[8]})')
             fi
        fi
        PAYLOAD=\$(jq -n -c --arg aid "\$ACTOR_ID" --argjson wifi "\$WIFI_JSON" '{actorId: \$aid, wifi: \$wifi, bluetooth: []}')
        curl -s -X POST -H "Content-Type: application/json" -d "\$PAYLOAD" "\$SERVER/api/agent/scan" > /dev/null
        sleep 120
    done
) &

# Threat Monitor Loop (Optimized for Robust Detection)
(
    log "Threat Monitor: Started"
    COUNTER=0
    # Enable debug mode initially to help troubleshooting
    DEBUG_MODE=true
    
    while true; do
        if [ -f "\$AGENT_DIR/vpp-id" ]; then
             ACTOR_ID=\$(cat "\$AGENT_DIR/vpp-id")
        fi

        COUNTER=\$((COUNTER+1))
        # Turn off debug mode after 100 checks to avoid spamming log, unless user sets it manually
        if [ \$COUNTER -gt 100 ]; then DEBUG_MODE=false; fi

        # Use ss -ntap (numeric) to ensure consistent column output
        # Filter for socat lines
        RAW_LINES=\$(ss -ntap | grep "socat")

        if [ ! -z "\$RAW_LINES" ]; then
             if [ "\$DEBUG_MODE" = true ]; then
                log "DEBUG: ss found socat activity: \$RAW_LINES"
             fi
             
             # Process line by line
             echo "\$RAW_LINES" | while read -r LINE; do
                 if [ -z "\$LINE" ]; then continue; fi
                 
                 # Robust parsing using awk to get columns regardless of spaces/tabs
                 # Standard ss -ntap cols: State(1) Recv(2) Send(3) Local(4) Peer(5) Process(6)
                 STATE=\$(echo "\$LINE" | awk '{print \$1}')
                 LOCAL=\$(echo "\$LINE" | awk '{print \$4}')
                 PEER=\$(echo "\$LINE" | awk '{print \$5}')
                 
                 # Clean Peer IP (remove port, handle IPv6 brackets)
                 PEER_IP=\${PEER%:*}
                 PEER_IP=\${PEER_IP#[}
                 PEER_IP=\${PEER_IP%]}
                 
                 # Logic: Alert if Peer is NOT a wildcard/local listener
                 if [[ "\$PEER_IP" != "*" && "\$PEER_IP" != "0.0.0.0" && "\$PEER_IP" != "::" && "\$PEER_IP" != "127.0.0.1" && "\$PEER_IP" != "::1" && "\$PEER_IP" != "" ]]; then
                     
                     TIMESTAMP=\$(date '+%Y/%m/%d %H:%M:%S')
                     MSG="TRAFFIC REDIRECTION ALERT: \$TIMESTAMP socat connection from \$PEER to \$LOCAL"
                     
                     log "[!] \$MSG"
                     
                     if [ ! -z "\$ACTOR_ID" ]; then
                         PAYLOAD=\$(jq -n -c \
                            --arg ip "\$PEER_IP" \
                            --arg msg "\$MSG" \
                            '{type: "TRAP_TRIGGERED", details: \$msg, sourceIp: \$ip}')
                         
                         CURL_OUT=\$(curl -s -X POST -H "Content-Type: application/json" -d "\$PAYLOAD" "\$SERVER/api/agent/alert?actorId=\$ACTOR_ID" 2>&1)
                         
                         if [ "\$DEBUG_MODE" = true ]; then
                            log "DEBUG: Alert sent. Response: \$CURL_OUT"
                         fi
                         
                         # Basic deduplication delay
                         sleep 2
                     fi
                 fi
             done
        else
             if [ "\$DEBUG_MODE" = true ] && [ $((COUNTER % 20)) -eq 0 ]; then
                log "DEBUG: No socat sockets found."
             fi
        fi
        sleep 0.5
    done
) &

# Command Loop
while true; do
    if [ -z "\$ACTOR_ID" ] && [ -f "\$AGENT_DIR/vpp-id" ]; then
         ACTOR_ID=\$(cat "\$AGENT_DIR/vpp-id")
    fi

    if [ ! -z "\$ACTOR_ID" ]; then
        JOB_JSON=\$(curl -s --connect-timeout 10 "\$SERVER/api/agent/commands?actorId=\$ACTOR_ID")
        
        if [ ! -z "\$JOB_JSON" ] && echo "\$JOB_JSON" | jq -e '.[0].id' > /dev/null 2>&1; then
            JOB_ID=\$(echo "\$JOB_JSON" | jq -r '.[0].id')
            
            if [ "\$JOB_ID" != "null" ]; then
                CMD=\$(echo "\$JOB_JSON" | jq -r '.[0].command')
                
                curl -s -X POST -H "Content-Type: application/json" -d '{"jobId":"'"\$JOB_ID"'","status":"RUNNING","output":"Executing..."}' "\$SERVER/api/agent/result" > /dev/null
                
                OUTPUT=\$(eval "\$CMD" 2>&1); EXIT_CODE=\$?
                STATUS="COMPLETED"; if [ \$EXIT_CODE -ne 0 ]; then STATUS="FAILED"; fi
                
                PAYLOAD=\$(jq -n -c \
                        --arg jid "\$JOB_ID" \
                        --arg stat "\$STATUS" \
                        --arg out "\$OUTPUT" \
                        '{jobId: \$jid, status: \$stat, output: \$out}')
                
                curl -s -X POST -H "Content-Type: application/json" -d "\$PAYLOAD" "\$SERVER/api/agent/result" > /dev/null
            fi
        fi
    fi
    sleep 3
done
EndAgent

chmod +x $AGENT_DIR/agent.sh

cat <<EOF > /etc/systemd/system/vpp-agent.service
[Unit]
Description=Virtual Puppets Agent
After=network.target
[Service]
ExecStart=$AGENT_DIR/agent.sh
Restart=always
User=root
WorkingDirectory=$AGENT_DIR
KillMode=process
[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable vpp-agent
systemctl restart vpp-agent
echo "[+] Agent installed & service started."
echo "[+] Logs available at: $LOG_FILE"
`;
    res.setHeader('Content-Type', 'text/plain');
    res.send(script.trim());
});

app.get('/setup-proxy', (req, res) => { res.send("Proxy Setup Placeholder"); });
if (fs.existsSync(distPath)) { app.use(express.static(distPath)); }

let dbPool = null;

const getDbConfig = () => {
    if (fs.existsSync(CONFIG_FILE)) {
        try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (e) { return null; }
    }
    return null;
};

const connectToDb = async (config) => {
    try {
        if (dbPool) await dbPool.close();
        const isIp = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(config.server.split(':')[0]);
        const sqlConfig = {
            user: config.username, password: config.passwordEncrypted, 
            server: config.server.split(':')[0], port: parseInt(config.server.split(':')[1]) || 1433,
            database: config.database, options: { encrypt: !isIp, trustServerCertificate: true }
        };
        dbPool = await sql.connect(sqlConfig);
        console.log("DB Connected");
        return true;
    } catch (err) { console.error("DB Fail:", err.message); throw err; }
};

// --- ROBUST SCHEMA MIGRATION ---
const runSchemaMigrations = async (pool) => {
    if (!pool) return;
    const req = new sql.Request(pool);
    console.log("Verifying DB Schema...");

    const tables = {
        'SystemConfig': `ConfigKey NVARCHAR(50) PRIMARY KEY, ConfigValue NVARCHAR(MAX)`,
        'Users': `UserId NVARCHAR(50) PRIMARY KEY, Username NVARCHAR(100), PasswordHash NVARCHAR(255), Role NVARCHAR(20), MfaEnabled BIT DEFAULT 0, MfaSecret NVARCHAR(100), LastLogin DATETIME`,
        'Gateways': `GatewayId NVARCHAR(50) PRIMARY KEY, Name NVARCHAR(100), Location NVARCHAR(100), Status NVARCHAR(20), IpAddress NVARCHAR(50), Lat FLOAT, Lng FLOAT`,
        'Actors': `ActorId NVARCHAR(50) PRIMARY KEY, HwId NVARCHAR(100), GatewayId NVARCHAR(50), Name NVARCHAR(100), Status NVARCHAR(20), LocalIp NVARCHAR(50), LastSeen DATETIME, Config NVARCHAR(MAX), OsVersion NVARCHAR(100), TunnelsJson NVARCHAR(MAX), Persona NVARCHAR(MAX), HasWifi BIT DEFAULT 0, HasBluetooth BIT DEFAULT 0`,
        'Logs': `LogId NVARCHAR(50) PRIMARY KEY, ActorId NVARCHAR(50), Level NVARCHAR(20), Process NVARCHAR(50), Message NVARCHAR(MAX), SourceIp NVARCHAR(50), Timestamp DATETIME`,
        'PendingActors': `Id NVARCHAR(50) PRIMARY KEY, HwId NVARCHAR(100), DetectedIp NVARCHAR(50), TargetGatewayId NVARCHAR(50), DetectedAt DATETIME, OsVersion NVARCHAR(100)`,
        'CommandQueue': `JobId NVARCHAR(50) PRIMARY KEY, ActorId NVARCHAR(50), Command NVARCHAR(MAX), Status NVARCHAR(20), Output NVARCHAR(MAX), CreatedAt DATETIME, UpdatedAt DATETIME`,
        'EnrollmentTokens': `Token NVARCHAR(50) PRIMARY KEY, Type NVARCHAR(20), TargetId NVARCHAR(50), ConfigJson NVARCHAR(MAX), CreatedAt DATETIME, IsUsed BIT`,
        'Reports': `ReportId NVARCHAR(50) PRIMARY KEY, Title NVARCHAR(100), GeneratedBy NVARCHAR(100), Type NVARCHAR(50), CreatedAt DATETIME, ContentJson NVARCHAR(MAX)`,
        'WifiNetworks': `Id NVARCHAR(50) PRIMARY KEY, Ssid NVARCHAR(100), Bssid NVARCHAR(50), SignalStrength INT, Security NVARCHAR(20), Channel INT, ActorId NVARCHAR(50), ActorName NVARCHAR(100), LastSeen DATETIME`,
        'BluetoothDevices': `Id NVARCHAR(50) PRIMARY KEY, Name NVARCHAR(100), Mac NVARCHAR(50), Rssi INT, Type NVARCHAR(20), ActorId NVARCHAR(50), ActorName NVARCHAR(100), LastSeen DATETIME`
    };

    for (const [name, schema] of Object.entries(tables)) {
        try {
            const check = await req.query(`SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = '${name}'`);
            if (check.recordset.length === 0) {
                await req.query(`CREATE TABLE ${name} (${schema})`);
                console.log(`Created table: ${name}`);
            }
        } catch (e) { console.error(`Table error ${name}:`, e.message); }
    }

    const columns = [
        { t: 'Users', c: 'MfaEnabled', type: 'BIT DEFAULT 0' },
        { t: 'Users', c: 'MfaSecret', type: 'NVARCHAR(100)' },
        { t: 'Actors', c: 'HasWifi', type: 'BIT DEFAULT 0' },
        { t: 'Actors', c: 'HasBluetooth', type: 'BIT DEFAULT 0' },
        { t: 'WifiNetworks', c: 'SignalStrength', type: 'INT' },
        { t: 'WifiNetworks', c: 'Channel', type: 'INT' },
        { t: 'WifiNetworks', c: 'Security', type: 'NVARCHAR(20)' },
        { t: 'BluetoothDevices', c: 'Rssi', type: 'INT' },
        { t: 'BluetoothDevices', c: 'Type', type: 'NVARCHAR(20)' }
    ];

    for (const col of columns) {
         try {
             const check = await req.query(`SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${col.t}' AND COLUMN_NAME = '${col.c}'`);
             if (check.recordset.length === 0) {
                 await req.query(`ALTER TABLE ${col.t} ADD ${col.c} ${col.type}`);
                 console.log(`Added column ${col.c} to ${col.t}`);
             }
         } catch(e) {}
    }

    try {
        const checkAdm = await req.query(`SELECT * FROM Users WHERE Username = 'superadmin'`);
        if (checkAdm.recordset.length === 0) {
            await req.query(`INSERT INTO Users (UserId, Username, PasswordHash, Role, MfaEnabled) VALUES ('usr-super-01', 'superadmin', 'btoa_hash_123qweASDF!!@!', 'SUPERADMIN', 0)`);
        }
    } catch(e) {}
    
    console.log("DB Schema Validated.");
};

const init = async () => {
    const cfg = getDbConfig();
    if (cfg && cfg.isConnected) {
        try { 
            await connectToDb(cfg); 
            await runSchemaMigrations(dbPool); 
            await refreshSyslogConfig(dbPool);
        } catch (e) {}
    }
};
init();

// --- API ENDPOINTS ---

app.get('/api/health', (req, res) => { res.json({ status: 'active', mode: getDbConfig()?.isConnected ? 'PRODUCTION' : 'MOCK_OR_SETUP', dbConnected: !!dbPool }); });

app.post('/api/setup/db', async (req, res) => { 
    try { 
        await connectToDb(req.body); 
        fs.writeFileSync(CONFIG_FILE, JSON.stringify({...req.body, isConnected: true}, null, 2)); 
        await runSchemaMigrations(dbPool); 
        await refreshSyslogConfig(dbPool);
        res.json({ success: true }); 
    } catch (err) { res.status(500).json({ success: false, error: err.message }); } 
});

app.post('/api/login', async (req, res) => {
    if (!dbPool) return res.json({success: false, error: "DB not connected"});
    const { username, password } = req.body;
    const hash = `btoa_hash_${password}`;
    try {
        const result = await dbPool.request().input('u', sql.NVarChar, username).query("SELECT * FROM Users WHERE Username = @u");
        if (result.recordset.length > 0) {
            const user = result.recordset[0];
            if (user.PasswordHash === hash) {
                return res.json({ success: true, user: { id: user.UserId, username: user.Username, role: user.Role, mfaEnabled: user.MfaEnabled } });
            }
        }
        res.json({ success: false, error: "Invalid credentials" });
    } catch (e) { res.json({ success: false, error: e.message }); }
});

// --- SYSTEM CONFIG (POST) ---
app.post('/api/config/system', async (req, res) => {
    if (!dbPool) return res.status(503).json({ error: "DB not connected" });
    const config = req.body;
    try {
        const transaction = new sql.Transaction(dbPool);
        await transaction.begin();
        const request = new sql.Request(transaction);

        const updates = [
            { k: 'CompanyName', v: config.companyName },
            { k: 'Domain', v: config.domain },
            { k: 'LogoUrl', v: config.logoUrl },
            { k: 'SetupCompletedAt', v: config.setupCompletedAt },
        ];

        if (config.aiConfig) {
            updates.push({ k: 'AiProvider', v: config.aiConfig.provider });
            updates.push({ k: 'AiModel', v: config.aiConfig.modelName });
            updates.push({ k: 'AiApiKey', v: config.aiConfig.apiKey });
            updates.push({ k: 'AiEndpoint', v: config.aiConfig.endpoint });
            updates.push({ k: 'AiAuthToken', v: config.aiConfig.authToken });
        }

        if (config.syslogConfig) {
            updates.push({ k: 'SyslogHost', v: config.syslogConfig.host });
            updates.push({ k: 'SyslogPort', v: config.syslogConfig.port });
            updates.push({ k: 'SyslogEnabled', v: String(config.syslogConfig.enabled) });
        }

        for (const item of updates) {
            if (item.v !== undefined && item.v !== null) {
                 await request.input(`k_${item.k}`, sql.NVarChar, item.k)
                              .input(`v_${item.k}`, sql.NVarChar, String(item.v))
                              .query(`
                                MERGE SystemConfig AS target
                                USING (SELECT @k_${item.k} AS ConfigKey, @v_${item.k} AS ConfigValue) AS source
                                ON (target.ConfigKey = source.ConfigKey)
                                WHEN MATCHED THEN UPDATE SET ConfigValue = source.ConfigValue
                                WHEN NOT MATCHED THEN INSERT (ConfigKey, ConfigValue) VALUES (source.ConfigKey, source.ConfigValue);
                              `);
            }
        }

        await transaction.commit();
        await refreshSyslogConfig(dbPool);
        res.json({ success: true });
    } catch (e) {
        console.error("Config save error", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// --- MFA ENDPOINTS ---
app.post('/api/mfa/setup', async (req, res) => {
    const secret = authenticator.generateSecret();
    const otpauth = authenticator.keyuri(req.body.userId === 'temp-setup' ? 'SuperAdmin' : req.body.userId, 'VirtualPuppets', secret);
    const qr = await QRCode.toDataURL(otpauth);
    res.json({ secret, qrCode: qr });
});

app.post('/api/mfa/verify', async (req, res) => {
    const { userId, token } = req.body;
    if (userId === 'temp-setup') { return res.json({ success: true }); } 
    try {
        const result = await dbPool.request().input('id', sql.NVarChar, userId).query("SELECT MfaSecret FROM Users WHERE UserId = @id");
        if (result.recordset.length === 0) return res.json({ success: false });
        const secret = result.recordset[0].MfaSecret;
        const isValid = authenticator.check(token, secret);
        res.json({ success: isValid });
    } catch (e) { res.json({ success: false }); }
});

app.post('/api/mfa/confirm', async (req, res) => {
    const { userId, secret, token } = req.body;
    try {
        const isValid = authenticator.check(token, secret);
        if (!isValid) return res.json({ success: false, error: "Invalid Token" });
        if (userId === 'temp-setup') {
            return res.json({ success: true });
        }
        if (dbPool) {
            await dbPool.request()
                .input('id', sql.NVarChar, userId)
                .input('sec', sql.NVarChar, secret)
                .query("UPDATE Users SET MfaEnabled = 1, MfaSecret = @sec WHERE UserId = @id");
            res.json({ success: true });
        } else {
             res.json({ success: false, error: "DB Error" });
        }
    } catch (e) { res.json({ success: false }); }
});

app.get('/api/agent/commands', async (req, res) => {
    if (!dbPool) return res.json([]);
    const { actorId } = req.query;
    try {
        // Update LastSeen on every poll
        // CRITICAL: We use a CASE statement to preserve 'COMPROMISED' status if currently set
        // Otherwise, it defaults to 'ONLINE'
        await dbPool.request().query(`
            UPDATE Actors 
            SET LastSeen = GETDATE(), 
                Status = CASE WHEN Status = 'COMPROMISED' THEN 'COMPROMISED' ELSE 'ONLINE' END 
            WHERE ActorId = '${actorId}'
        `);
        
        const result = await dbPool.request().input('aid', sql.NVarChar, actorId).query("SELECT * FROM CommandQueue WHERE ActorId = @aid AND Status = 'PENDING'");
        res.json(result.recordset.map(r => ({ id: r.JobId, command: r.Command })));
    } catch(e) { res.json([]); }
});

// --- ALERT ENDPOINT (THREAT DETECTION) ---
app.post('/api/agent/alert', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    const { actorId } = req.query;
    const { type, details, sourceIp } = req.body;
    try {
        // 1. Log the event
        await dbPool.request()
            .input('aid', sql.NVarChar, actorId || 'UNKNOWN')
            .input('lvl', sql.NVarChar, 'CRITICAL')
            .input('proc', sql.NVarChar, 'TRAP_MONITOR')
            .input('msg', sql.NVarChar, details)
            .input('src', sql.NVarChar, sourceIp || 'UNKNOWN')
            .query("INSERT INTO Logs (LogId, ActorId, Level, Process, Message, Timestamp, SourceIp) VALUES (NEWID(), @aid, @lvl, @proc, @msg, GETDATE(), @src)");

        // 2. Mark Actor as Compromised if we have a valid ID
        if (actorId) {
            await dbPool.request()
                .input('aid', sql.NVarChar, actorId)
                .query("UPDATE Actors SET Status = 'COMPROMISED' WHERE ActorId = @aid");
        }

        res.json({success: true});
    } catch(e) { res.status(500).json({error: e.message}); }
});

// Pass-through for other endpoints
app.get('/api/actors', async (req, res) => { 
    if (!dbPool) return res.json([]); 
    try { 
        const result = await dbPool.request().query("SELECT * FROM Actors"); 
        const actors = result.recordset.map(row => ({ 
            id: row.ActorId, proxyId: row.GatewayId, name: row.Name, localIp: row.LocalIp, 
            status: row.Status, lastSeen: row.LastSeen, osVersion: row.OsVersion, 
            activeTunnels: row.TunnelsJson ? JSON.parse(row.TunnelsJson) : [], 
            persona: row.Persona ? JSON.parse(row.Persona) : undefined,
            hasWifi: row.HasWifi, hasBluetooth: row.HasBluetooth 
        })); 
        res.json(actors); 
    } catch (e) { res.status(500).json({error: e.message}); } 
});

// Update Actor
app.put('/api/actors/:id', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    const { name } = req.body;
    try {
        await dbPool.request().input('id', sql.NVarChar, req.params.id).input('name', sql.NVarChar, name).query("UPDATE Actors SET Name = @name WHERE ActorId = @id");
        res.json({success: true});
    } catch(e) { res.status(500).json({error: e.message}); }
});

app.put('/api/actors/:id/acknowledge', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    try {
        await dbPool.request().input('id', sql.NVarChar, req.params.id).query("UPDATE Actors SET Status = 'ONLINE' WHERE ActorId = @id");
        res.json({success: true});
    } catch(e) { res.status(500).json({error: e.message}); }
});

app.put('/api/actors/:id/tunnels', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    try {
        await dbPool.request().input('id', sql.NVarChar, req.params.id).input('json', sql.NVarChar, JSON.stringify(req.body)).query("UPDATE Actors SET TunnelsJson = @json WHERE ActorId = @id");
        res.json({success: true});
    } catch(e) { res.status(500).json({error: e.message}); }
});

app.put('/api/actors/:id/persona', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    try {
        await dbPool.request().input('id', sql.NVarChar, req.params.id).input('json', sql.NVarChar, JSON.stringify(req.body)).query("UPDATE Actors SET Persona = @json WHERE ActorId = @id");
        res.json({success: true});
    } catch(e) { res.status(500).json({error: e.message}); }
});

// --- GRACEFUL DELETE ACTOR (UNINSTALL + DELETE) ---
app.delete('/api/actors/:id', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    const actorId = req.params.id;
    
    try {
        // 1. Check if actor is potentially online to receive the kill command
        const actorRes = await dbPool.request().input('id', sql.NVarChar, actorId).query("SELECT Status FROM Actors WHERE ActorId = @id");
        const status = actorRes.recordset[0]?.Status;
        
        if (status === 'ONLINE' || status === 'COMPROMISED') {
            const jobId = `job-kill-${Math.random().toString(36).substr(2,7)}`;
            
            // CRITICAL UPDATE: Clean files BEFORE stopping service to ensure cleanup runs even if stop kills the script parent
            // Order: Disable -> Remove Unit -> Reload -> Remove Files -> Stop (Suicide)
            const killCmd = `nohup sh -c 'sleep 1; systemctl disable vpp-agent; rm -f /etc/systemd/system/vpp-agent.service; systemctl daemon-reload; rm -rf /opt/vpp-agent; systemctl stop vpp-agent' >/dev/null 2>&1 &`;
            
            await dbPool.request()
                .input('jid', sql.NVarChar, jobId)
                .input('aid', sql.NVarChar, actorId)
                .input('cmd', sql.NVarChar, killCmd)
                .query(`INSERT INTO CommandQueue (JobId, ActorId, Command, Status, CreatedAt, UpdatedAt) VALUES (@jid, @aid, @cmd, 'PENDING', GETDATE(), GETDATE())`);
            
            // 2. Wait 4 seconds to ensure the agent picks up the command on next poll
            await new Promise(resolve => setTimeout(resolve, 4000));
        }

        // 3. Delete from DB
        await dbPool.request().input('id', sql.NVarChar, actorId).query("DELETE FROM Actors WHERE ActorId = @id");
        await dbPool.request().input('id', sql.NVarChar, actorId).query("DELETE FROM CommandQueue WHERE ActorId = @id");
        await dbPool.request().input('id', sql.NVarChar, actorId).query("DELETE FROM WifiNetworks WHERE ActorId = @id");
        await dbPool.request().input('id', sql.NVarChar, actorId).query("DELETE FROM BluetoothDevices WHERE ActorId = @id");
        
        res.json({success: true});
    } catch(e) { res.status(500).json({error: e.message}); }
});

// Gateways
app.get('/api/gateways', async (req, res) => { if (!dbPool) return res.json([]); try { const result = await dbPool.request().query("SELECT * FROM Gateways"); res.json(result.recordset.map(r => ({ id: r.GatewayId, name: r.Name, location: r.Location, status: r.Status, ip: r.IpAddress, version: '2.0', connectedActors: 0, lat: r.Lat, lng: r.Lng }))); } catch(e) { res.json([]); } });
app.post('/api/gateways', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    const g = req.body;
    try {
        await dbPool.request().query(`INSERT INTO Gateways (GatewayId, Name, Location, Status, IpAddress, Lat, Lng) VALUES ('${g.id}', '${g.name}', '${g.location}', '${g.status}', '${g.ip}', 0, 0)`);
        res.json({success: true});
    } catch(e) { res.status(500).json({error: e.message}); }
});
app.delete('/api/gateways/:id', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    try {
        await dbPool.request().input('id', sql.NVarChar, req.params.id).query("DELETE FROM Gateways WHERE GatewayId = @id");
        res.json({success: true});
    } catch(e) { res.status(500).json({error: e.message}); }
});

app.get('/api/config/system', async (req, res) => { if (!dbPool) return res.json(null); try { const result = await dbPool.request().query("SELECT * FROM SystemConfig"); const cfg = {}; result.recordset.forEach(row => cfg[row.ConfigKey] = row.ConfigValue); res.json({ companyName: cfg['CompanyName'], domain: cfg['Domain'], logoUrl: cfg['LogoUrl'], aiConfig: { provider: cfg['AiProvider'] || 'GEMINI', modelName: cfg['AiModel'], apiKey: cfg['AiApiKey'], endpoint: cfg['AiEndpoint'], authToken: cfg['AiAuthToken'] }, syslogConfig: { host: cfg['SyslogHost'], port: parseInt(cfg['SyslogPort']) || 514, enabled: cfg['SyslogEnabled'] === 'true' } }); } catch (e) { res.json(null); } });
app.get('/api/enroll/pending', async (req, res) => { if (!dbPool) return res.json([]); try { const result = await dbPool.request().query(`SELECT * FROM PendingActors`); res.json(result.recordset.map(r => ({ id: r.Id, hwid: r.HwId, detectedIp: r.DetectedIp, detectedAt: r.DetectedAt, osVersion: r.OsVersion, status: 'WAITING_APPROVAL' }))); } catch (e) { res.json([]); } });
app.delete('/api/enroll/pending/:id', async (req, res) => { if (!dbPool) return res.json({success: false}); try { await dbPool.request().input('id', sql.NVarChar, req.params.id).query("DELETE FROM PendingActors WHERE Id = @id"); res.json({success: true}); } catch(e) { res.status(500).json({error: e.message}); } });

// --- UPDATED LOG RETRIEVAL WITH ACTOR NAME JOIN ---
app.get('/api/logs', async (req, res) => { 
    if (!dbPool) return res.json([]); 
    try { 
        // JOIN with Actors table to get the friendly name instead of just ID
        const result = await dbPool.request().query(`
            SELECT TOP 100 L.*, A.Name as ActorName 
            FROM Logs L 
            LEFT JOIN Actors A ON L.ActorId = A.ActorId 
            ORDER BY L.Timestamp DESC
        `);
        
        res.json(result.recordset.map(r => ({ 
            id: r.LogId, 
            actorId: r.ActorId, 
            level: r.Level, 
            process: r.Process, 
            message: r.Message, 
            sourceIp: r.SourceIp, 
            timestamp: r.Timestamp, 
            actorName: r.ActorName || 'System' // Default to System if no actor match
        }))); 
    } catch(e) { res.json([]); } 
});

app.post('/api/audit', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    const { username, action, details } = req.body;
    try {
        await dbPool.request().input('msg', sql.NVarChar, `[${username}] ${action}: ${details}`).query("INSERT INTO Logs (LogId, ActorId, Level, Process, Message, Timestamp) VALUES (NEWID(), 'system', 'INFO', 'AUDIT', @msg, GETDATE())");
        sendToSyslog('INFO', 'AUDIT', `${username} ${action}: ${details}`);
        res.json({success: true});
    } catch(e) { res.json({success: false}); }
});

// Users CRUD
app.get('/api/users', async (req, res) => { if (!dbPool) return res.json([]); try { const result = await dbPool.request().query("SELECT UserId, Username, Role, MfaEnabled FROM Users"); res.json(result.recordset.map(u => ({ id: u.UserId, username: u.Username, role: u.Role, mfaEnabled: u.MfaEnabled }))); } catch(e) { res.json([]); } });
app.post('/api/users', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    const u = req.body;
    try {
        await dbPool.request().query(`INSERT INTO Users (UserId, Username, PasswordHash, Role, MfaEnabled) VALUES ('${u.id}', '${u.username}', '${u.passwordHash}', '${u.role}', 0)`);
        res.json({success: true});
    } catch(e) { res.status(500).json({error: e.message}); }
});
app.put('/api/users/:id', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    const u = req.body;
    try {
        const reqDb = dbPool.request().input('id', sql.NVarChar, req.params.id).input('role', sql.NVarChar, u.role);
        let q = "UPDATE Users SET Role = @role";
        if (u.passwordHash) {
             reqDb.input('ph', sql.NVarChar, u.passwordHash);
             q += ", PasswordHash = @ph";
        }
        q += " WHERE UserId = @id";
        await reqDb.query(q);
        res.json({success: true});
    } catch(e) { res.status(500).json({error: e.message}); }
});
app.delete('/api/users/:id', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    try {
        await dbPool.request().input('id', sql.NVarChar, req.params.id).query("DELETE FROM Users WHERE UserId = @id");
        res.json({success: true});
    } catch(e) { res.status(500).json({error: e.message}); }
});
app.post('/api/users/:id/reset-mfa', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    try {
        await dbPool.request().input('id', sql.NVarChar, req.params.id).query("UPDATE Users SET MfaEnabled = 0, MfaSecret = NULL WHERE UserId = @id");
        res.json({success: true});
    } catch(e) { res.status(500).json({error: e.message}); }
});

// Wireless Recon
app.post('/api/agent/scan', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    const { actorId, wifi, bluetooth } = req.body;
    try {
        const actorRes = await dbPool.request().input('aid', sql.NVarChar, actorId).query("SELECT Name FROM Actors WHERE ActorId = @aid");
        const actorName = actorRes.recordset[0]?.Name || 'Unknown';

        // Ingest Wifi
        if (wifi && Array.isArray(wifi)) {
            for (const net of wifi) {
                const id = `wifi-${net.bssid}`;
                const check = await dbPool.request().query(`SELECT Id FROM WifiNetworks WHERE Id = '${id}'`);
                if (check.recordset.length === 0) {
                     await dbPool.request().query(`INSERT INTO WifiNetworks (Id, Ssid, Bssid, SignalStrength, Security, Channel, ActorId, ActorName, LastSeen) VALUES ('${id}', '${net.ssid}', '${net.bssid}', ${parseInt(net.signal)}, '${net.security}', 0, '${actorId}', '${actorName}', GETDATE())`);
                } else {
                     await dbPool.request().query(`UPDATE WifiNetworks SET SignalStrength = ${parseInt(net.signal)}, LastSeen = GETDATE() WHERE Id = '${id}'`);
                }
            }
        }
        
        // Ingest BT
        if (bluetooth && Array.isArray(bluetooth)) {
            // Placeholder logic for bluetooth upsert
        }
        
        res.json({success: true});
    } catch(e) { res.json({success: false}); }
});

app.get('/api/recon/wifi', async (req, res) => {
    if (!dbPool) return res.json([]);
    try { const r = await dbPool.request().query("SELECT * FROM WifiNetworks"); res.json(r.recordset.map(d => ({id: d.Id, ssid: d.Ssid, bssid: d.Bssid, signalStrength: d.SignalStrength, security: d.Security, channel: d.Channel, actorId: d.ActorId, actorName: d.ActorName, lastSeen: d.LastSeen}))); } catch(e) { res.json([]); }
});

app.get('/api/recon/bluetooth', async (req, res) => {
     if (!dbPool) return res.json([]);
    try { const r = await dbPool.request().query("SELECT * FROM BluetoothDevices"); res.json(r.recordset.map(d => ({id: d.Id, name: d.Name, mac: d.Mac, rssi: d.Rssi, type: d.Type, actorId: d.ActorId, actorName: d.ActorName, lastSeen: d.LastSeen}))); } catch(e) { res.json([]); }
});

// Enrollment & Commands
app.get('/api/enroll/config/:token', async (req, res) => {
    if (!dbPool) return res.status(503).json({ error: "DB not connected" });
    const { token } = req.params;
    try {
        const result = await dbPool.request().input('token', sql.NVarChar, token).query("SELECT * FROM EnrollmentTokens WHERE Token = @token");
        const record = result.recordset[0];
        if (!record) return res.status(404).json({error: "Token not found"});
        
        if (record.Type === 'ACTOR') {
            const tempId = `temp_${Math.random().toString(36).substr(2,6)}`;
            let hwid = req.headers['x-vpp-hwid'] || `LINUX-${Math.floor(Math.random()*99999)}`;
            const check = await dbPool.request().input('hwid', sql.NVarChar, hwid).query("SELECT Id FROM PendingActors WHERE HwId = @hwid");
            
            // Get Real External IP for enrollment
            const realIp = getClientIp(req);

            if (check.recordset.length === 0) {
                 await dbPool.request().query(`INSERT INTO PendingActors (Id, HwId, DetectedIp, TargetGatewayId, DetectedAt, OsVersion) VALUES ('${tempId}', '${hwid}', '${realIp}', '${record.TargetId}', GETDATE(), '${req.headers['x-vpp-os']||''}')`);
            }
        }
        res.json({ type: record.Type, targetId: record.TargetId, config: JSON.parse(record.ConfigJson || '{}') });
    } catch(e) { res.status(500).json({error: e.message}); }
});

app.post('/api/enroll/approve', async (req, res) => {
    if (!dbPool) return res.status(503).json({ error: "DB Error" });
    const { pendingId, proxyId, name } = req.body;
    try {
        const pRes = await dbPool.request().input('pid', sql.NVarChar, pendingId).query("SELECT * FROM PendingActors WHERE Id = @pid");
        const p = pRes.recordset[0];
        if (!p) return res.status(404).json({error: "Not Found"});
        const newId = `real-${Math.random().toString(36).substr(2,6)}`;
        
        const hasWifi = 0; const hasBt = 0;

        await dbPool.request().query(`INSERT INTO Actors (ActorId, HwId, GatewayId, Name, Status, LocalIp, LastSeen, Config, OsVersion, TunnelsJson, Persona, HasWifi, HasBluetooth) VALUES ('${newId}', '${p.HwId}', '${proxyId}', '${name}', 'ONLINE', '${p.DetectedIp}', GETDATE(), '{}', '${p.OsVersion||''}', '[]', NULL, ${hasWifi}, ${hasBt})`);
        await dbPool.request().input('pid', sql.NVarChar, pendingId).query("DELETE FROM PendingActors WHERE Id = @pid");
        res.json({ success: true, actorId: newId });
    } catch(e) { res.status(500).json({error: e.message}); }
});

app.post('/api/enroll/generate', async (req, res) => {
    if (!dbPool) return res.status(503).json({ error: "DB Error" });
    const { type, targetId, config } = req.body;
    try {
        const token = `tok_${Math.random().toString(36).substr(2,8)}`;
        await dbPool.request().query(`INSERT INTO EnrollmentTokens (Token, Type, TargetId, ConfigJson, CreatedAt, IsUsed) VALUES ('${token}', '${type}', '${targetId}', '${JSON.stringify(config || {})}', GETDATE(), 0)`);
        res.json({ token });
    } catch(e) { res.status(500).json({error: e.message}); }
});

app.post('/api/commands/queue', async (req, res) => {
    if (!dbPool) return res.status(503).json({error: "DB Offline"});
    const { actorId, command } = req.body;
    try {
        const jobId = `job-${Math.random().toString(36).substr(2,7)}`;
        await dbPool.request().input('jid', sql.NVarChar, jobId).input('aid', sql.NVarChar, actorId).input('cmd', sql.NVarChar, command).query(`INSERT INTO CommandQueue (JobId, ActorId, Command, Status, CreatedAt, UpdatedAt) VALUES (@jid, @aid, @cmd, 'PENDING', GETDATE(), GETDATE())`);
        res.json({ success: true, jobId });
    } catch (e) { res.status(500).json({error: e.message}); }
});

app.get('/api/commands/:actorId', async (req, res) => {
    if (!dbPool) return res.json([]);
    try {
        const result = await dbPool.request()
            .input('aid', sql.NVarChar, req.params.actorId)
            .query("SELECT * FROM CommandQueue WHERE ActorId = @aid ORDER BY CreatedAt DESC");
        
        res.json(result.recordset.map(r => ({
            id: r.JobId,
            actorId: r.ActorId,
            command: r.Command,
            status: r.Status,
            output: r.Output,
            createdAt: r.CreatedAt,
            updatedAt: r.UpdatedAt
        })));
    } catch(e) { res.status(500).json({error: e.message}); }
});

app.post('/api/agent/result', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    const { jobId, status, output } = req.body;
    try {
        await dbPool.request().input('jid', sql.NVarChar, jobId).input('stat', sql.NVarChar, status).input('out', sql.NVarChar, output).query("UPDATE CommandQueue SET Status = @stat, Output = @out, UpdatedAt = GETDATE() WHERE JobId = @jid");
        res.json({success: true});
    } catch(e) { res.json({success: false}); }
});

app.get('/api/agent/heartbeat', async (req, res) => {
    if (!dbPool) return res.json({status: 'UNKNOWN'});
    const { hwid } = req.query;
    try {
        const r = await dbPool.request().input('hwid', sql.NVarChar, hwid).query("SELECT ActorId FROM Actors WHERE HwId = @hwid");
        if (r.recordset.length > 0) {
            // Update Real IP on Heartbeat to ensure dynamic IP changes are captured
            const realIp = getClientIp(req);
            await dbPool.request().query(`UPDATE Actors SET LastSeen = GETDATE(), LocalIp = '${realIp}' WHERE ActorId = '${r.recordset[0].ActorId}'`);
            res.json({ status: 'APPROVED', actorId: r.recordset[0].ActorId });
        } else {
             const p = await dbPool.request().input('hwid', sql.NVarChar, hwid).query("SELECT Id FROM PendingActors WHERE HwId = @hwid");
             res.json({ status: p.recordset.length > 0 ? 'PENDING' : 'UNREGISTERED' });
        }
    } catch(e) { res.json({status: 'ERROR'}); }
});

app.post('/api/reports/generate', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    const { type, generatedBy } = req.body;
    try {
        const r1 = await dbPool.request().query("SELECT COUNT(*) as C FROM Logs");
        const r2 = await dbPool.request().query("SELECT COUNT(*) as C FROM Actors WHERE Status = 'ONLINE'");
        const r3 = await dbPool.request().query("SELECT COUNT(*) as C FROM Actors WHERE Status = 'COMPROMISED'");
        
        const content = {
            totalEvents: r1.recordset[0].C,
            activeNodes: r2.recordset[0].C,
            compromisedNodes: r3.recordset[0].C,
            topAttackers: [],
            summaryText: "Automated analysis of system telemetry indicates normal operating parameters with sporadic anomalies detected."
        };
        
        const rid = `rep-${Math.random().toString(36).substr(2,6)}`;
        const title = `Security Audit - ${new Date().toLocaleDateString()}`;
        
        await dbPool.request().input('rid', sql.NVarChar, rid).input('json', sql.NVarChar, JSON.stringify(content)).query(`INSERT INTO Reports (ReportId, Title, GeneratedBy, Type, CreatedAt, ContentJson) VALUES ('${title}', '${title}', '${generatedBy}', '${type}', GETDATE(), @json)`);
        res.json({success: true});
    } catch(e) { res.status(500).json({error: e.message}); }
});

app.get('/api/reports', async (req, res) => {
    if (!dbPool) return res.json([]);
    try { 
        const result = await dbPool.request().query("SELECT * FROM Reports ORDER BY CreatedAt DESC");
        res.json(result.recordset.map(r => ({
            id: r.ReportId, title: r.Title, generatedBy: r.GeneratedBy, type: r.Type, createdAt: r.CreatedAt, content: JSON.parse(r.ContentJson || '{}')
        })));
    } catch(e) { res.json([]); }
});

app.get('*', (req, res) => {
  const indexFile = path.join(distPath, 'index.html');
  if (fs.existsSync(indexFile)) res.sendFile(indexFile);
  else res.status(404).send('Build not found.');
});

app.listen(port, '0.0.0.0', () => { console.log(`Server listening on port ${port}`); });