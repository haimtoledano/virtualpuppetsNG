



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

// --- JSON SYNTAX ERROR HANDLER ---
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && 'body' in err) {
        console.error('❌ JSON Syntax Error');
        return res.status(400).json({ success: false, error: 'Invalid JSON payload' });
    }
    next();
});

// --- HELPER: GET REAL IP ---
const getClientIp = (req) => {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded ? forwarded.split(',')[0] : req.socket.remoteAddress;
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
echo "   Virtual Puppets Agent Bootstrap v7.1"
echo "--------------------------------------------------"

echo "[*] Checking dependencies..."
if command -v apt-get &> /dev/null; then
    export DEBIAN_FRONTEND=noninteractive
    if ! command -v jq &> /dev/null; then apt-get update -qq && apt-get install -y jq -qq; fi
    if ! command -v curl &> /dev/null; then apt-get install -y curl -qq; fi
    if ! command -v nmcli &> /dev/null; then apt-get install -y network-manager -qq; fi
    if ! command -v hcitool &> /dev/null; then apt-get install -y bluez -qq; fi
    if ! command -v ss &> /dev/null; then apt-get install -y iproute2 -qq; fi
    if ! command -v awk &> /dev/null; then apt-get install -y gawk -qq; fi
    if ! command -v socat &> /dev/null; then apt-get install -y socat -qq; fi
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

# --- INSTALL VPP-AGENT BINARY ---
cat <<'EOF_BIN' > /usr/local/bin/vpp-agent
#!/bin/bash
AGENT_DIR="/opt/vpp-agent"
LOG_FILE="/var/log/vpp-agent.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] \$1" >> \$LOG_FILE; }

if [[ "\$1" == "--set-persona" ]]; then
    echo "Updating system persona..."
    sleep 1
    echo "Persona configuration applied successfully."
    log "Persona changed to: \$2"
elif [[ "\$1" == "--set-sentinel" ]]; then
    if [[ "\$2" == "on" ]]; then
            touch "\$AGENT_DIR/sentinel_active"
            log "SENTINEL MODE ENABLED (Paranoid)"
            echo "Sentinel Mode: ON"
            # Force immediate visual feedback in logs
            echo "SENTINEL MODE ACTIVE" >> \$LOG_FILE
    else
            rm -f "\$AGENT_DIR/sentinel_active"
            log "Sentinel Mode Disabled"
            echo "Sentinel Mode: OFF"
    fi
elif [[ "\$1" == "--factory-reset" ]]; then
    echo "Resetting agent configuration..."
    rm -f "\$AGENT_DIR/sentinel_active"
    log "Factory Reset Triggered"
elif [[ "\$1" == "--update" ]]; then
    log "Agent update triggered"
    echo "Agent updated."
else
    echo "VPP Agent v2.1 - Status OK"
    if [ -f "\$AGENT_DIR/sentinel_active" ]; then echo "Sentinel Mode: ACTIVE"; fi
fi
EOF_BIN
chmod +x /usr/local/bin/vpp-agent

cat <<EOF > $AGENT_DIR/agent.sh
#!/bin/bash
# Ensure standard paths are available
export PATH=\$PATH:/usr/sbin:/sbin:/usr/bin:/bin:/usr/local/bin

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

# vpp-route function stub if needed, though usually just a command wrapper
vpp-route() {
    log "VPP-Route Command: \$*"
    echo "Routing table updated."
    return 0
}
export -f vpp-route

if ! command -v jq &> /dev/null; then
    log "Error: jq is missing."
    exit 1
fi

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

(
    while true; do
        WIFI_JSON="[]"
        if [ "\$HAS_WIFI" = true ]; then
             RAW_WIFI=\$(nmcli -t -f SSID,BSSID,SIGNAL,SECURITY dev wifi list 2>/dev/null)
             if [ ! -z "\$RAW_WIFI" ]; then
                WIFI_JSON=\$(echo "\$RAW_WIFI" | jq -R -s -c 'split("\n")[:-1] | map(split(":")) | map({ssid: .[0], bssid: (.[1]+":"+.[2]+":"+.[3]+":"+.[4]+":"+.[5]+":"+.[6]), signal: .[7], security: .[8]})')
             fi
        fi

        # TELEMETRY COLLECTION
        CPU_USAGE=\$(top -bn1 | grep "Cpu(s)" | sed "s/.*, *\\([0-9.]*\\)%* id.*/\\1/" | awk '{print 100 - \$1}')
        RAM_USAGE=\$(free | grep Mem | awk '{print \$3/\$2 * 100.0}')
        
        if [ -f /sys/class/thermal/thermal_zone0/temp ]; then
             RAW_TEMP=\$(cat /sys/class/thermal/thermal_zone0/temp)
             TEMP=\$(awk "BEGIN {print \$RAW_TEMP/1000}")
        else
             TEMP=0
        fi

        if [ -z "\$CPU_USAGE" ]; then CPU_USAGE=0; fi
        if [ -z "\$RAM_USAGE" ]; then RAM_USAGE=0; fi

        PAYLOAD=\$(jq -n -c \
            --arg aid "\$ACTOR_ID" \
            --argjson wifi "\$WIFI_JSON" \
            --arg cpu "\$CPU_USAGE" \
            --arg ram "\$RAM_USAGE" \
            --arg temp "\$TEMP" \
            '{actorId: \$aid, wifi: \$wifi, bluetooth: [], cpu: \$cpu, ram: \$ram, temp: \$temp}')
        
        curl -s -X POST -H "Content-Type: application/json" -d "\$PAYLOAD" --max-time 15 "\$SERVER/api/agent/scan" > /dev/null
        sleep 30
    done
) &

(
    log "Threat Monitor: Started"
    COUNTER=0
    DEBUG_MODE=true
    
    while true; do
        if [ -f "\$AGENT_DIR/vpp-id" ]; then
             ACTOR_ID=\$(cat "\$AGENT_DIR/vpp-id")
        fi

        COUNTER=\$((COUNTER+1))
        if [ \$COUNTER -gt 100 ]; then DEBUG_MODE=false; fi

        # CHECK FOR SENTINEL MODE
        SENTINEL_MODE=false
        if [ -f "\$AGENT_DIR/sentinel_active" ]; then SENTINEL_MODE=true; fi

        if [ "\$SENTINEL_MODE" = true ]; then
             # PARANOID MODE: Check for ANY established connection that is NOT loopback
             # Excluding 127.0.0.1, ::1, and our own C2 connection if possible (though generic exclusion is safer)
             # Note: We grep -v for loopback
             RAW_LINES=\$(ss -ntap state established state syn-recv | grep -v "127.0.0.1" | grep -v "::1")
        else
             # NORMAL MODE: Only look for socat traps
             RAW_LINES=\$(ss -ntap | grep "socat")
        fi

        if [ ! -z "\$RAW_LINES" ]; then
             if [ "\$DEBUG_MODE" = true ]; then
                log "DEBUG: Network activity detected: \$RAW_LINES"
             fi
             
             echo "\$RAW_LINES" | while read -r LINE; do
                 if [ -z "\$LINE" ]; then continue; fi
                 
                 # ss -ntap output format usually: State Recv-Q Send-Q Local Address:Port Peer Address:Port
                 PEER=\$(echo "\$LINE" | awk '{print \$5}')
                 LOCAL=\$(echo "\$LINE" | awk '{print \$4}')
                 
                 PEER_IP=\${PEER%:*}
                 PEER_IP=\${PEER_IP#[}
                 PEER_IP=\${PEER_IP%]}
                 
                 # Basic filtering to avoid self-reporting (though loopback grep above handles most)
                 if [[ "\$PEER_IP" != "*" && "\$PEER_IP" != "0.0.0.0" && "\$PEER_IP" != "::" && "\$PEER_IP" != "" ]]; then
                     
                     TIMESTAMP=\$(date '+%Y/%m/%d %H:%M:%S')
                     
                     if [ "\$SENTINEL_MODE" = true ]; then
                        MSG="SENTINEL ALERT: Paranoid Mode detected connection from \$PEER to \$LOCAL"
                     else
                        MSG="TRAFFIC REDIRECTION ALERT: \$TIMESTAMP socat connection from \$PEER to \$LOCAL"
                     fi
                     
                     log "[!] \$MSG"
                     
                     if [ ! -z "\$ACTOR_ID" ]; then
                         PAYLOAD=\$(jq -n -c \
                            --arg ip "\$PEER_IP" \
                            --arg msg "\$MSG" \
                            '{type: "TRAP_TRIGGERED", details: \$msg, sourceIp: \$ip}')
                         
                         CURL_OUT=\$(curl -s -X POST -H "Content-Type: application/json" -d "\$PAYLOAD" --max-time 10 "\$SERVER/api/agent/alert?actorId=\$ACTOR_ID" 2>&1)
                         sleep 2 
                     fi
                 fi
             done
        else
             if [ "\$DEBUG_MODE" = true ] && [ $((COUNTER % 20)) -eq 0 ]; then
                log "DEBUG: No suspicious sockets found."
             fi
        fi
        sleep 0.5
    done
) &

while true; do
    if [ -z "\$ACTOR_ID" ] && [ -f "\$AGENT_DIR/vpp-id" ]; then
         ACTOR_ID=\$(cat "\$AGENT_DIR/vpp-id")
    fi

    if [ ! -z "\$ACTOR_ID" ]; then
        JOB_JSON=\$(curl -s --connect-timeout 10 --max-time 30 "\$SERVER/api/agent/commands?actorId=\$ACTOR_ID")
        
        if [ ! -z "\$JOB_JSON" ] && echo "\$JOB_JSON" | jq -e '.[0].id' > /dev/null 2>&1; then
            JOB_ID=\$(echo "\$JOB_JSON" | jq -r '.[0].id')
            
            if [ "\$JOB_ID" != "null" ]; then
                log "[+] Received Job: \$JOB_ID"
                CMD=\$(echo "\$JOB_JSON" | jq -r '.[0].command')
                
                curl -s -X POST -H "Content-Type: application/json" -d '{"jobId":"'"\$JOB_ID"'","status":"RUNNING","output":"Executing..."}' --max-time 10 "\$SERVER/api/agent/result" > /dev/null
                
                # Execute Job
                printf "#!/bin/bash\n%s\n" "\$CMD" > "\$AGENT_DIR/job.sh"
                chmod +x "\$AGENT_DIR/job.sh"

                # Run with timeout
                OUTPUT=\$(timeout 10s "\$AGENT_DIR/job.sh" 2>&1); EXIT_CODE=\$?
                rm -f "\$AGENT_DIR/job.sh"
                
                if [ \$EXIT_CODE -eq 124 ]; then 
                    STATUS="COMPLETED"
                    OUTPUT="Command executed (Timeout enforced). Background process should be running."
                elif [ \$EXIT_CODE -ne 0 ]; then 
                    STATUS="FAILED"
                else
                    STATUS="COMPLETED"
                fi
                
                PAYLOAD=\$(jq -n -c \
                        --arg jid "\$JOB_ID" \
                        --arg stat "\$STATUS" \
                        --arg out "\$OUTPUT" \
                        '{jobId: \$jid, status: \$stat, output: \$out}')
                curl -s -X POST -H "Content-Type: application/json" -d "\$PAYLOAD" --max-time 10 "\$SERVER/api/agent/result" > /dev/null
                log "[-] Job \$JOB_ID Finished ($STATUS)"
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

const runSchemaMigrations = async (pool) => {
    if (!pool) return;
    const req = new sql.Request(pool);
    const tables = {
        'SystemConfig': `ConfigKey NVARCHAR(50) PRIMARY KEY, ConfigValue NVARCHAR(MAX)`,
        'Users': `UserId NVARCHAR(50) PRIMARY KEY, Username NVARCHAR(100), PasswordHash NVARCHAR(255), Role NVARCHAR(20), MfaEnabled BIT DEFAULT 0, MfaSecret NVARCHAR(100), LastLogin DATETIME`,
        'Gateways': `GatewayId NVARCHAR(50) PRIMARY KEY, Name NVARCHAR(100), Location NVARCHAR(100), Status NVARCHAR(20), IpAddress NVARCHAR(50), Lat FLOAT, Lng FLOAT`,
        'Actors': `ActorId NVARCHAR(50) PRIMARY KEY, HwId NVARCHAR(100), GatewayId NVARCHAR(50), Name NVARCHAR(100), Status NVARCHAR(20), LocalIp NVARCHAR(50), LastSeen DATETIME, Config NVARCHAR(MAX), OsVersion NVARCHAR(100), TunnelsJson NVARCHAR(MAX), Persona NVARCHAR(MAX), HoneyFilesJson NVARCHAR(MAX), HasWifi BIT DEFAULT 0, HasBluetooth BIT DEFAULT 0, CpuLoad FLOAT DEFAULT 0, MemoryUsage FLOAT DEFAULT 0, Temperature FLOAT DEFAULT 0, TcpSentinelEnabled BIT DEFAULT 0`,
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
            } else if (name === 'Actors') {
                // Ensure columns exist if table already exists
                try { await req.query(`ALTER TABLE Actors ADD CpuLoad FLOAT DEFAULT 0`); } catch(e){}
                try { await req.query(`ALTER TABLE Actors ADD MemoryUsage FLOAT DEFAULT 0`); } catch(e){}
                try { await req.query(`ALTER TABLE Actors ADD Temperature FLOAT DEFAULT 0`); } catch(e){}
                try { await req.query(`ALTER TABLE Actors ADD HoneyFilesJson NVARCHAR(MAX)`); } catch(e){}
                try { await req.query(`ALTER TABLE Actors ADD TcpSentinelEnabled BIT DEFAULT 0`); } catch(e){}
            }
        } catch (e) { }
    }
    
    // Create SuperAdmin if not exists
    try {
        const uCheck = await req.query("SELECT * FROM Users WHERE Username = 'superadmin'");
        if (uCheck.recordset.length === 0) {
            await req.query("INSERT INTO Users (UserId, Username, PasswordHash, Role) VALUES ('usr-super-01', 'superadmin', 'btoa_hash_123qweASDF!!@!', 'SUPERADMIN')");
        }
    } catch (e) {}
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
app.post('/api/setup/db', async (req, res) => { try { await connectToDb(req.body); fs.writeFileSync(CONFIG_FILE, JSON.stringify({...req.body, isConnected: true}, null, 2)); await runSchemaMigrations(dbPool); await refreshSyslogConfig(dbPool); res.json({ success: true }); } catch (err) { res.status(500).json({ success: false, error: err.message }); } });
app.post('/api/login', async (req, res) => { if (!dbPool) return res.json({success: false, error: "DB not connected"}); const { username, password } = req.body; const hash = `btoa_hash_${password}`; try { const result = await dbPool.request().input('u', sql.NVarChar, username).query("SELECT * FROM Users WHERE Username = @u"); if (result.recordset.length > 0) { const user = result.recordset[0]; if (user.PasswordHash === hash) { return res.json({ success: true, user: { id: user.UserId, username: user.Username, role: user.Role, mfaEnabled: user.MfaEnabled } }); } } res.json({ success: false, error: "Invalid credentials" }); } catch (e) { res.json({ success: false, error: e.message }); } });

// --- SYSTEM CONFIG ---
app.get('/api/config/system', async (req, res) => {
    if (!dbPool) return res.status(503).json({ error: "DB not connected" });
    try {
        const result = await dbPool.request().query("SELECT ConfigKey, ConfigValue FROM SystemConfig");
        const map = {};
        result.recordset.forEach(row => map[row.ConfigKey] = row.ConfigValue);

        const config = {
            companyName: map['CompanyName'] || '',
            domain: map['Domain'] || '',
            logoUrl: map['LogoUrl'] || '',
            setupCompletedAt: map['SetupCompletedAt'] || '',
            aiConfig: {
                provider: map['AiProvider'] || 'GEMINI',
                modelName: map['AiModel'] || 'gemini-2.5-flash',
                apiKey: map['AiApiKey'] || '',
                endpoint: map['AiEndpoint'] || '',
                authToken: map['AiAuthToken'] || ''
            },
            syslogConfig: {
                host: map['SyslogHost'] || '',
                port: parseInt(map['SyslogPort']) || 514,
                enabled: map['SyslogEnabled'] === 'true'
            }
        };
        res.json(config);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/config/system', async (req, res) => {
    if (!dbPool) return res.status(503).json({ error: "DB not connected" });
    const { companyName, domain, logoUrl, setupCompletedAt, aiConfig, syslogConfig } = req.body;
    
    try {
        const upsert = async (key, val) => {
            const valStr = val === undefined || val === null ? '' : String(val);
            await dbPool.request()
                .input('k', sql.NVarChar, key)
                .input('v', sql.NVarChar, valStr)
                .query(`
                    IF EXISTS (SELECT 1 FROM SystemConfig WHERE ConfigKey = @k)
                        UPDATE SystemConfig SET ConfigValue = @v WHERE ConfigKey = @k
                    ELSE
                        INSERT INTO SystemConfig (ConfigKey, ConfigValue) VALUES (@k, @v)
                `);
        };

        if (companyName !== undefined) await upsert('CompanyName', companyName);
        if (domain !== undefined) await upsert('Domain', domain);
        if (logoUrl !== undefined) await upsert('LogoUrl', logoUrl);
        if (setupCompletedAt !== undefined) await upsert('SetupCompletedAt', setupCompletedAt);
        
        if (aiConfig) {
            await upsert('AiProvider', aiConfig.provider);
            await upsert('AiModel', aiConfig.modelName);
            await upsert('AiApiKey', aiConfig.apiKey);
            await upsert('AiEndpoint', aiConfig.endpoint);
            await upsert('AiAuthToken', aiConfig.authToken);
        }

        if (syslogConfig) {
            await upsert('SyslogHost', syslogConfig.host);
            await upsert('SyslogPort', syslogConfig.port);
            await upsert('SyslogEnabled', syslogConfig.enabled);
            await refreshSyslogConfig(dbPool);
        }

        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- MFA ---
app.post('/api/mfa/setup', async (req, res) => { const secret = authenticator.generateSecret(); const otpauth = authenticator.keyuri(req.body.userId === 'temp-setup' ? 'SuperAdmin' : req.body.userId, 'VirtualPuppets', secret); const qr = await QRCode.toDataURL(otpauth); res.json({ secret, qrCode: qr }); });
app.post('/api/mfa/verify', async (req, res) => { res.json({success:true}); });
app.post('/api/mfa/confirm', async (req, res) => { 
    if (!dbPool) return res.json({success: false});
    const { userId, secret } = req.body;
    try {
        if(userId === 'temp-setup') {
            await dbPool.request().input('uid', sql.NVarChar, 'usr-super-01').input('sec', sql.NVarChar, secret).query("UPDATE Users SET MfaEnabled = 1, MfaSecret = @sec WHERE UserId = @uid");
        } else {
             await dbPool.request().input('uid', sql.NVarChar, userId).input('sec', sql.NVarChar, secret).query("UPDATE Users SET MfaEnabled = 1, MfaSecret = @sec WHERE UserId = @uid");
        }
        res.json({success:true});
    } catch(e) { res.json({success:false}); }
});

// --- ENROLLMENT ---
app.get('/api/enroll/pending', async (req, res) => {
    if (!dbPool) return res.json([]);
    try {
        const r = await dbPool.request().query("SELECT * FROM PendingActors");
        res.json(r.recordset.map(row => ({
            id: row.Id, hwid: row.HwId, detectedIp: row.DetectedIp, detectedAt: row.DetectedAt, osVersion: row.OsVersion
        })));
    } catch(e) { res.json([]); }
});

app.post('/api/enroll/approve', async (req, res) => {
    if (!dbPool) return res.json({success:false});
    let { pendingId, proxyId, name } = req.body;

    // Fallbacks
    if (!proxyId) proxyId = 'DIRECT';
    if (!name) name = 'Unknown-Actor';

    try {
        const p = await dbPool.request().input('pid', sql.NVarChar, pendingId).query("SELECT * FROM PendingActors WHERE Id = @pid");
        if (p.recordset.length === 0) return res.json({success:false, error: "Not found"});
        const pending = p.recordset[0];
        const actorId = `real-${Math.random().toString(36).substr(2,6)}`;
        
        await dbPool.request()
            .input('aid', sql.NVarChar, actorId)
            .input('hwid', sql.NVarChar, pending.HwId)
            .input('gw', sql.NVarChar, proxyId)
            .input('name', sql.NVarChar, name)
            .input('ip', sql.NVarChar, pending.DetectedIp)
            .input('os', sql.NVarChar, pending.OsVersion)
            // FIXED: Corrected parameter order to match schema: Status='ONLINE', LocalIp=@ip, LastSeen=GETDATE()
            .query("INSERT INTO Actors (ActorId, HwId, GatewayId, Name, Status, LocalIp, LastSeen, OsVersion) VALUES (@aid, @hwid, @gw, @name, 'ONLINE', @ip, GETDATE(), @os)");
            
        await dbPool.request().input('pid', sql.NVarChar, pendingId).query("DELETE FROM PendingActors WHERE Id = @pid");
        res.json({success: true});
    } catch(e) { 
        console.error("Approve Error:", e);
        res.status(500).json({success:false, error:e.message}); 
    }
});

app.delete('/api/enroll/pending/:id', async (req, res) => {
    if (!dbPool) return res.json({success:false});
    try {
        await dbPool.request().input('id', sql.NVarChar, req.params.id).query("DELETE FROM PendingActors WHERE Id = @id");
        res.json({success:true});
    } catch(e) { res.json({success:false}); }
});

app.post('/api/enroll/generate', async (req, res) => {
     if (!dbPool) return res.json({token: "ERROR"});
     const { type, targetId, config } = req.body;
     const token = `vpp-${Math.random().toString(36).substr(2,10)}`;
     try {
         await dbPool.request()
            .input('t', sql.NVarChar, token)
            .input('tp', sql.NVarChar, type)
            .input('tid', sql.NVarChar, targetId)
            .input('cfg', sql.NVarChar, JSON.stringify(config || {}))
            .query("INSERT INTO EnrollmentTokens (Token, Type, TargetId, ConfigJson, CreatedAt, IsUsed) VALUES (@t, @tp, @tid, @cfg, GETDATE(), 0)");
         res.json({token});
     } catch(e) { res.status(500).json({error: e.message}); }
});

app.get('/api/enroll/config/:token', async (req, res) => {
    if (!dbPool) return res.status(404).send("DB Error");
    try {
        const r = await dbPool.request().input('t', sql.NVarChar, req.params.token).query("SELECT * FROM EnrollmentTokens WHERE Token = @t");
        if (r.recordset.length === 0) return res.status(404).send("Invalid Token");
        res.send("OK");
    } catch(e) { res.status(500).send("Error"); }
});


// --- GATEWAYS ---
app.get('/api/gateways', async (req, res) => {
    if (!dbPool) return res.json([]);
    try {
        const r = await dbPool.request().query("SELECT * FROM Gateways");
        // Count actors per gateway
        const gwCounts = {};
        const countRes = await dbPool.request().query("SELECT GatewayId, COUNT(*) as C FROM Actors GROUP BY GatewayId");
        countRes.recordset.forEach(row => gwCounts[row.GatewayId] = row.C);

        res.json(r.recordset.map(g => ({
            id: g.GatewayId, name: g.Name, location: g.Location, status: g.Status, ip: g.IpAddress, version: 'VPP-Proxy', connectedActors: gwCounts[g.GatewayId] || 0
        })));
    } catch(e) { res.json([]); }
});

app.post('/api/gateways', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    const g = req.body;
    try {
        await dbPool.request()
            .input('gid', sql.NVarChar, g.id)
            .input('name', sql.NVarChar, g.name)
            .input('loc', sql.NVarChar, g.location)
            .input('ip', sql.NVarChar, g.ip)
            .query("INSERT INTO Gateways (GatewayId, Name, Location, Status, IpAddress) VALUES (@gid, @name, @loc, 'OFFLINE', @ip)");
        res.json({success: true});
    } catch(e) { res.json({success:false}); }
});

app.delete('/api/gateways/:id', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    try {
        await dbPool.request().input('gid', sql.NVarChar, req.params.id).query("DELETE FROM Gateways WHERE GatewayId = @gid");
        res.json({success: true});
    } catch(e) { res.json({success:false}); }
});


// --- AGENT ENDPOINTS ---

app.get('/api/agent/heartbeat', async (req, res) => {
    if (!dbPool) return res.status(503).json({});
    const { hwid } = req.query;
    if (!hwid) return res.status(400).json({});
    
    try {
        const actor = await dbPool.request().input('h', sql.NVarChar, hwid).query("SELECT ActorId, Status FROM Actors WHERE HwId = @h");
        if (actor.recordset.length > 0) {
            const a = actor.recordset[0];
            await dbPool.request().input('aid', sql.NVarChar, a.ActorId).query("UPDATE Actors SET LastSeen = GETDATE() WHERE ActorId = @aid");
            return res.json({ status: 'APPROVED', actorId: a.ActorId });
        }
        
        const pending = await dbPool.request().input('h', sql.NVarChar, hwid).query("SELECT * FROM PendingActors WHERE HwId = @h");
        if (pending.recordset.length === 0) {
             const pid = `temp-${Math.random().toString(36).substr(2,6)}`;
             const ip = getClientIp(req);
             await dbPool.request()
                .input('pid', sql.NVarChar, pid)
                .input('h', sql.NVarChar, hwid)
                .input('ip', sql.NVarChar, ip)
                .query("INSERT INTO PendingActors (Id, HwId, DetectedIp, DetectedAt) VALUES (@pid, @h, @ip, GETDATE())");
        }
        res.json({ status: 'PENDING' });
    } catch(e) { res.status(500).json({}); }
});

app.get('/api/agent/commands', async (req, res) => {
    if (!dbPool) return res.json([]);
    const { actorId } = req.query;
    try {
        // Safe parameterized query for Update as well
        await dbPool.request()
            .input('aid', sql.NVarChar, actorId)
            .query("UPDATE Actors SET LastSeen = GETDATE(), Status = CASE WHEN Status = 'COMPROMISED' THEN 'COMPROMISED' ELSE 'ONLINE' END WHERE ActorId = @aid");
            
        const result = await dbPool.request().input('aid', sql.NVarChar, actorId).query("SELECT * FROM CommandQueue WHERE ActorId = @aid AND Status = 'PENDING'");
        res.json(result.recordset.map(r => ({ id: r.JobId, command: r.Command })));
    } catch(e) { res.json([]); }
});

app.post('/api/agent/result', async (req, res) => {
    if (!dbPool) return res.json({});
    const { jobId, status, output } = req.body;
    try {
        await dbPool.request()
            .input('jid', sql.NVarChar, jobId)
            .input('stat', sql.NVarChar, status)
            .input('out', sql.NVarChar, output)
            .query("UPDATE CommandQueue SET Status = @stat, Output = @out, UpdatedAt = GETDATE() WHERE JobId = @jid");
        res.json({success: true});
    } catch(e) { res.json({}); }
});

app.post('/api/agent/scan', async (req, res) => {
    if (!dbPool) return res.json({});
    const { actorId, cpu, ram, temp } = req.body;
    try {
        if (actorId) {
            await dbPool.request()
                .input('aid', sql.NVarChar, actorId)
                .input('c', sql.Float, parseFloat(cpu) || 0)
                .input('r', sql.Float, parseFloat(ram) || 0)
                .input('t', sql.Float, parseFloat(temp) || 0)
                .query("UPDATE Actors SET CpuLoad = @c, MemoryUsage = @r, Temperature = @t, LastSeen = GETDATE() WHERE ActorId = @aid");
        }
        res.json({success:true});
    } catch(e) { console.error("Telemetry update failed", e); res.status(500).json({error:e.message}); }
});

app.post('/api/agent/alert', async (req, res) => { 
    if (!dbPool) return res.json({success: false}); 
    const { actorId } = req.query; 
    const { type, details, sourceIp } = req.body; 
    try { 
        await dbPool.request().input('aid', sql.NVarChar, actorId || 'UNKNOWN').input('lvl', sql.NVarChar, 'CRITICAL').input('proc', sql.NVarChar, 'TRAP_MONITOR').input('msg', sql.NVarChar, details).input('src', sql.NVarChar, sourceIp || 'UNKNOWN').query("INSERT INTO Logs (LogId, ActorId, Level, Process, Message, Timestamp, SourceIp) VALUES (NEWID(), @aid, @lvl, @proc, @msg, GETDATE(), @src)"); 
        if (actorId) { 
            await dbPool.request().input('aid', sql.NVarChar, actorId).query("UPDATE Actors SET Status = 'COMPROMISED' WHERE ActorId = @aid"); 
        } 
        res.json({success: true}); 
    } catch(e) { res.status(500).json({error: e.message}); } 
});

// --- COMMAND MANAGEMENT (UI) ---
app.post('/api/commands/queue', async (req, res) => {
    if (!dbPool) return res.status(503).json({error: 'DB Disconnected'});
    const { actorId, command } = req.body;
    try {
        const jobId = `job-${Math.random().toString(36).substr(2,9)}`;
        await dbPool.request()
            .input('jid', sql.NVarChar, jobId)
            .input('aid', sql.NVarChar, actorId)
            .input('cmd', sql.NVarChar, command)
            .query("INSERT INTO CommandQueue (JobId, ActorId, Command, Status, CreatedAt, UpdatedAt) VALUES (@jid, @aid, @cmd, 'PENDING', GETDATE(), GETDATE())");
        res.json({ jobId });
    } catch(e) { res.status(500).json({error: e.message}); }
});

app.get('/api/commands/:actorId', async (req, res) => {
    if (!dbPool) return res.json([]);
    try {
        const result = await dbPool.request()
            .input('aid', sql.NVarChar, req.params.actorId)
            .query("SELECT * FROM CommandQueue WHERE ActorId = @aid ORDER BY CreatedAt DESC");
        res.json(result.recordset.map(r => ({
            id: r.JobId, actorId: r.ActorId, command: r.Command, status: r.Status, output: r.Output, createdAt: r.CreatedAt, updatedAt: r.UpdatedAt
        })));
    } catch(e) { res.json([]); }
});

// --- ACTOR MGMT ---

app.get('/api/actors', async (req, res) => { if (!dbPool) return res.json([]); try { const result = await dbPool.request().query("SELECT * FROM Actors"); res.json(result.recordset.map(row => ({ id: row.ActorId, proxyId: row.GatewayId, name: row.Name, localIp: row.LocalIp, status: row.Status, lastSeen: row.LastSeen, osVersion: row.OsVersion, activeTunnels: row.TunnelsJson ? JSON.parse(row.TunnelsJson) : [], deployedHoneyFiles: row.HoneyFilesJson ? JSON.parse(row.HoneyFilesJson) : [], persona: row.Persona ? JSON.parse(row.Persona) : undefined, hasWifi: row.HasWifi, hasBluetooth: row.HasBluetooth, cpuLoad: row.CpuLoad, memoryUsage: row.MemoryUsage, temperature: row.Temperature, tcpSentinelEnabled: row.TcpSentinelEnabled }))); } catch (e) { res.status(500).json({error: e.message}); } });

app.put('/api/actors/:id', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    const { name } = req.body;
    try {
        await dbPool.request().input('id', sql.NVarChar, req.params.id).input('name', sql.NVarChar, name).query("UPDATE Actors SET Name = @name WHERE ActorId = @id");
        res.json({success: true});
    } catch(e) { res.status(500).json({error: e.message}); }
});

app.delete('/api/actors/:id', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    try {
        await dbPool.request().input('id', sql.NVarChar, req.params.id).query("DELETE FROM Actors WHERE ActorId = @id");
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
    const tunnels = req.body;
    try {
        await dbPool.request().input('id', sql.NVarChar, req.params.id).input('json', sql.NVarChar, JSON.stringify(tunnels)).query("UPDATE Actors SET TunnelsJson = @json WHERE ActorId = @id");
        res.json({success: true});
    } catch(e) { res.status(500).json({error: e.message}); }
});

app.put('/api/actors/:id/persona', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    const persona = req.body;
    try {
        await dbPool.request().input('id', sql.NVarChar, req.params.id).input('json', sql.NVarChar, JSON.stringify(persona)).query("UPDATE Actors SET Persona = @json WHERE ActorId = @id");
        res.json({success: true});
    } catch(e) { res.status(500).json({error: e.message}); }
});

app.put('/api/actors/:id/honeyfiles', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    const files = req.body;
    try {
        await dbPool.request().input('id', sql.NVarChar, req.params.id).input('json', sql.NVarChar, JSON.stringify(files)).query("UPDATE Actors SET HoneyFilesJson = @json WHERE ActorId = @id");
        res.json({success: true});
    } catch(e) { res.status(500).json({error: e.message}); }
});

app.put('/api/actors/:id/sentinel', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    const { enabled } = req.body;
    try {
        await dbPool.request()
            .input('id', sql.NVarChar, req.params.id)
            .input('en', sql.Bit, enabled ? 1 : 0)
            .query("UPDATE Actors SET TcpSentinelEnabled = @en WHERE ActorId = @id");
        res.json({success: true});
    } catch(e) { res.status(500).json({error: e.message}); }
});

// --- REPORTS ---

app.post('/api/reports/generate', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    const { type, generatedBy, customBody, incidentDetails, incidentFilters } = req.body;
    
    try {
        const r1 = await dbPool.request().query("SELECT COUNT(*) as C FROM Logs");
        const r2 = await dbPool.request().query("SELECT COUNT(*) as C FROM Actors WHERE Status = 'ONLINE'");
        const r3 = await dbPool.request().query("SELECT COUNT(*) as C FROM Actors WHERE Status = 'COMPROMISED'");
        
        const content = {
            totalEvents: r1.recordset[0].C,
            activeNodes: r2.recordset[0].C,
            compromisedNodes: r3.recordset[0].C,
            summaryText: "Report Generated.",
            customBody: customBody || '', // AI Text or Manual Text
            incidentDetails: incidentDetails,
            incidentFilters: incidentFilters
        };
        
        let title = `Report - ${new Date().toLocaleDateString()}`;

        if (type === 'SECURITY_AUDIT') {
             title = `Security Audit - ${new Date().toLocaleDateString()}`;
             content.summaryText = "Automated audit of system telemetry and fleet status.";
             // Add top attackers
             const atk = await dbPool.request().query("SELECT TOP 5 SourceIp, COUNT(*) as C FROM Logs WHERE SourceIp IS NOT NULL GROUP BY SourceIp ORDER BY C DESC");
             content.topAttackers = atk.recordset.map(r => ({ ip: r.SourceIp, count: r.C }));
        }
        else if (type === 'AI_INSIGHT') {
             // For AI Reports, we use the customBody provided by frontend AI service
             // But we can also set the title if provided
             title = incidentDetails?.title || `AI Threat Analysis`;
             content.summaryText = "AI-Generated analysis based on natural language query.";
        }
        else if (type === 'INCIDENT_LOG') {
             title = `Incident Response Log`;
             if (incidentFilters) {
                 // Calculate stats based on filters
                 let whereClause = "WHERE 1=1";
                 if(incidentFilters.attackerIp) whereClause += ` AND SourceIp = '${incidentFilters.attackerIp}'`;
                 if(incidentFilters.targetActor) whereClause += ` AND ActorId = '${incidentFilters.targetActor}'`;
                 if(incidentFilters.protocol) whereClause += ` AND Process = '${incidentFilters.protocol}'`;
                 
                 const countRes = await dbPool.request().query(`SELECT COUNT(*) as C FROM Logs ${whereClause}`);
                 content.incidentDetails = {
                     ...content.incidentDetails,
                     eventCount: countRes.recordset[0].C,
                     vector: `Filtered Analysis: ${JSON.stringify(incidentFilters)}`
                 };
             }
        }
        else if (type === 'CUSTOM') {
            title = 'Analyst Note';
        }
        
        const rid = `rep-${Math.random().toString(36).substr(2,6)}`;
        
        // --- SECURE PARAMETERIZED INSERT ---
        await dbPool.request()
            .input('rid', sql.NVarChar, rid)
            .input('title', sql.NVarChar, title)
            .input('by', sql.NVarChar, generatedBy)
            .input('type', sql.NVarChar, type)
            .input('json', sql.NVarChar, JSON.stringify(content))
            .query(`INSERT INTO Reports (ReportId, Title, GeneratedBy, Type, CreatedAt, ContentJson) VALUES (@rid, @title, @by, @type, GETDATE(), @json)`);
        
        res.json({success: true});
    } catch(e) { console.error("Report Generation Error", e); res.status(500).json({error: e.message}); }
});

app.get('/api/reports', async (req, res) => { if (!dbPool) return res.json([]); try { const result = await dbPool.request().query("SELECT * FROM Reports ORDER BY CreatedAt DESC"); res.json(result.recordset.map(r => ({ id: r.ReportId, title: r.Title, generatedBy: r.GeneratedBy, type: r.Type, createdAt: r.CreatedAt, content: JSON.parse(r.ContentJson || '{}') }))); } catch(e) { res.json([]); } });
app.delete('/api/reports/:id', async (req, res) => { if (!dbPool) return res.status(503).json({success: false, error: 'DB Disconnected'}); try { await dbPool.request().input('rid', sql.NVarChar, req.params.id).query("DELETE FROM Reports WHERE ReportId = @rid"); res.json({success: true}); } catch(e) { res.status(500).json({success: false, error: e.message}); } });
app.get('/api/logs', async (req, res) => { if (!dbPool) return res.json([]); try { const result = await dbPool.request().query(`SELECT TOP 100 L.*, A.Name as ActorName FROM Logs L LEFT JOIN Actors A ON L.ActorId = A.ActorId ORDER BY L.Timestamp DESC`); res.json(result.recordset.map(r => ({ id: r.LogId, actorId: r.ActorId, level: r.Level, process: r.Process, message: r.Message, sourceIp: r.SourceIp, timestamp: r.Timestamp, actorName: r.ActorName || 'System' }))); } catch(e) { res.json([]); } });

// --- AUDIT ---
app.post('/api/audit', async (req, res) => { if (!dbPool) return res.json({success: false}); const { username, action, details } = req.body; try { await dbPool.request().input('msg', sql.NVarChar, `[${username}] ${action}: ${details}`).query("INSERT INTO Logs (LogId, ActorId, Level, Process, Message, Timestamp) VALUES (NEWID(), 'system', 'INFO', 'AUDIT', @msg, GETDATE())"); sendToSyslog('INFO', 'AUDIT', `${username} ${action}: ${details}`); res.json({success: true}); } catch(e) { res.json({success: false}); } });

// --- WIRELESS RECON ---
app.get('/api/recon/wifi', async (req, res) => {
    if (!dbPool) return res.json([]);
    try { const r = await dbPool.request().query("SELECT * FROM WifiNetworks ORDER BY LastSeen DESC"); res.json(r.recordset); } catch(e) { res.json([]); }
});
app.get('/api/recon/bluetooth', async (req, res) => {
    if (!dbPool) return res.json([]);
    try { const r = await dbPool.request().query("SELECT * FROM BluetoothDevices ORDER BY LastSeen DESC"); res.json(r.recordset); } catch(e) { res.json([]); }
});

// --- USER CRUD ---
app.get('/api/users', async (req, res) => { if (!dbPool) return res.json([]); try { const r = await dbPool.request().query("SELECT UserId, Username, Role, MfaEnabled FROM Users"); res.json(r.recordset.map(u => ({ id: u.UserId, username: u.Username, role: u.Role, mfaEnabled: u.MfaEnabled }))); } catch(e) { res.json([]); } });
app.post('/api/users', async (req, res) => { if (!dbPool) return res.json({success:false}); const u = req.body; try { await dbPool.request().input('id', sql.NVarChar, u.id).input('name', sql.NVarChar, u.username).input('hash', sql.NVarChar, u.passwordHash).input('role', sql.NVarChar, u.role).query("INSERT INTO Users (UserId, Username, PasswordHash, Role) VALUES (@id, @name, @hash, @role)"); res.json({success:true}); } catch(e) { res.json({success:false}); } });
app.put('/api/users/:id', async (req, res) => { if (!dbPool) return res.json({success:false}); const u = req.body; try { await dbPool.request().input('id', sql.NVarChar, req.params.id).input('role', sql.NVarChar, u.role).query("UPDATE Users SET Role = @role WHERE UserId = @id"); if(u.passwordHash) await dbPool.request().input('id', sql.NVarChar, req.params.id).input('hash', sql.NVarChar, u.passwordHash).query("UPDATE Users SET PasswordHash = @hash WHERE UserId = @id"); res.json({success:true}); } catch(e) { res.json({success:false}); } });
app.delete('/api/users/:id', async (req, res) => { if (!dbPool) return res.json({success:false}); try { await dbPool.request().input('id', sql.NVarChar, req.params.id).query("DELETE FROM Users WHERE UserId = @id"); res.json({success:true}); } catch(e) { res.json({success:false}); } });
app.post('/api/users/:id/reset-mfa', async (req, res) => { if (!dbPool) return res.json({success:false}); try { await dbPool.request().input('id', sql.NVarChar, req.params.id).query("UPDATE Users SET MfaEnabled = 0, MfaSecret = NULL WHERE UserId = @id"); res.json({success:true}); } catch(e) { res.json({success:false}); } });

// --- SPA Fallback ---
app.get('*', (req, res) => {
    // If request accepts html, allow client-side routing.
    // Otherwise 404.
    if (req.accepts('html')) {
        const indexPath = path.join(distPath, 'index.html');
        if (fs.existsSync(indexPath)) {
            res.sendFile(indexPath);
        } else {
            res.status(404).send('App not built');
        }
    } else {
        res.status(404).json({ error: 'Not found' });
    }
});

app.listen(port, '0.0.0.0', () => { console.log(`Server listening on port ${port}`); });