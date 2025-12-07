
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
// In a real app, flush this to DB
let recordedSessions = []; 
let trapSessions = {};

// --- MFA CONFIGURATION ---
authenticator.options = { window: [2, 2] };

app.use(cors());

// --- MODIFIED BODY PARSER FOR DEBUGGING ---
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

// --- REAL TCP HONEYPOTS ---

const createSession = (socket, protocol) => {
    const startTime = Date.now();
    const sessionId = `sess-${protocol.toLowerCase()}-${startTime}`;
    const remoteAddress = socket.remoteAddress ? socket.remoteAddress.replace('::ffff:', '') : 'Unknown';
    
    const session = {
        id: sessionId,
        actorId: 'unknown', // We infer this from context or keep generic
        attackerIp: remoteAddress, // In forwarded mode, this is the Actor IP
        protocol: protocol,
        startTime: new Date(startTime),
        durationSeconds: 0,
        frames: []
    };

    recordedSessions.unshift(session);
    // Keep only last 50 sessions
    if (recordedSessions.length > 50) recordedSessions.pop();

    return {
        session,
        record: (type, data) => {
            const frame = {
                time: Date.now() - startTime,
                type: type, // 'INPUT' or 'OUTPUT'
                data: data.toString()
            };
            session.frames.push(frame);
            session.durationSeconds = (Date.now() - startTime) / 1000;
        }
    };
};

// 1. FTP Honeypot (Simulates VSFTPD)
const startFtpServer = () => {
    const server = net.createServer((socket) => {
        const { record } = createSession(socket, 'FTP');
        
        const send = (msg) => {
            socket.write(msg);
            record('OUTPUT', msg);
        };

        // Initial Banner - NO DELAY
        send('220 (vsFTPd 2.3.4)\r\n');

        socket.on('data', (data) => {
            record('INPUT', data);
            const cmd = data.toString().trim();
            
            if (cmd.startsWith('USER')) {
                send('331 Please specify the password.\r\n');
            } else if (cmd.startsWith('PASS')) {
                setTimeout(() => send('530 Login incorrect.\r\n'), 500);
            } else if (cmd.startsWith('QUIT')) {
                send('221 Goodbye.\r\n');
                socket.end();
            } else {
                send('500 Unknown command.\r\n');
            }
        });
    });
    server.on('error', (e) => {
        if (e.code === 'EADDRINUSE') {
            console.log(`[Honeypot] FTP Port ${HONEYPOT_PORTS.FTP} in use, skipping.`);
        } else {
            console.error('[Honeypot] FTP Error:', e);
        }
    });
    server.listen(HONEYPOT_PORTS.FTP, () => console.log(`[Honeypot] FTP listening on ${HONEYPOT_PORTS.FTP}`));
};

// 2. Telnet Honeypot (Simulates Ubuntu Login)
const startTelnetServer = () => {
    const server = net.createServer((socket) => {
        const { record } = createSession(socket, 'TELNET');
        let state = 'LOGIN';

        const send = (msg) => {
            socket.write(msg);
            record('OUTPUT', msg);
        };

        // NO DELAY
        send('\r\nUbuntu 20.04.6 LTS\r\nserver login: ');

        socket.on('data', (data) => {
            record('INPUT', data); // Telnet sends char by char often, but for simplicity
            const input = data.toString().trim();
            
            if (state === 'LOGIN') {
                send('Password: ');
                state = 'PASS';
            } else if (state === 'PASS') {
                setTimeout(() => {
                    send('\r\nLogin incorrect\r\n\r\nserver login: ');
                    state = 'LOGIN';
                }, 800);
            }
        });
    });
    server.on('error', (e) => {
        if (e.code === 'EADDRINUSE') {
            console.log(`[Honeypot] Telnet Port ${HONEYPOT_PORTS.TELNET} in use, skipping.`);
        } else {
            console.error('[Honeypot] Telnet Error:', e);
        }
    });
    server.listen(HONEYPOT_PORTS.TELNET, () => console.log(`[Honeypot] Telnet listening on ${HONEYPOT_PORTS.TELNET}`));
};

// 3. Redis Honeypot
const startRedisServer = () => {
    const server = net.createServer((socket) => {
        const { record } = createSession(socket, 'REDIS');
        
        const send = (msg) => {
            socket.write(msg);
            record('OUTPUT', msg);
        };

        socket.on('data', (data) => {
            record('INPUT', data);
            const cmd = data.toString().trim().toUpperCase();
            
            if (cmd.includes('CONFIG') || cmd.includes('GET') || cmd.includes('SET')) {
                 send('-NOAUTH Authentication required.\r\n');
            } else if (cmd.includes('AUTH')) {
                 send('-ERR invalid password\r\n');
            } else {
                 send('-ERR unknown command\r\n');
            }
        });
    });
    server.on('error', (e) => {
        if (e.code === 'EADDRINUSE') {
            console.log(`[Honeypot] Redis Port ${HONEYPOT_PORTS.REDIS} in use, skipping.`);
        } else {
            console.error('[Honeypot] Redis Error:', e);
        }
    });
    server.listen(HONEYPOT_PORTS.REDIS, () => console.log(`[Honeypot] Redis listening on ${HONEYPOT_PORTS.REDIS}`));
};

// Start Honeypots
startFtpServer();
startTelnetServer();
startRedisServer();


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

// --- TRAP STATE MACHINE (API BASED) ---
app.post('/api/trap/init', (req, res) => {
    const sid = `trap-${Date.now()}-${Math.random().toString(36).substr(2,5)}`;
    // Store simple state
    trapSessions[sid] = { state: 'INIT', type: 'FTP' }; 
    // Return banner immediately
    res.json({ sessionId: sid, banner: "220 (vsFTPd 2.3.4)\r\n" });
});

app.post('/api/trap/interact', (req, res) => {
    const { sessionId, input } = req.body;
    const session = trapSessions[sessionId];
    
    // Fallback if session lost
    if (!session) return res.json({ response: "421 Service not available.\r\n" });
    
    // Record to Ghost Mode (Mock implementation here, ideally integrate with createSession logic)
    const now = Date.now();
    // Logic: Simple state machine for FTP
    if (input.toUpperCase().startsWith('USER')) {
        return res.json({ response: "331 Please specify the password.\r\n" });
    }
    if (input.toUpperCase().startsWith('PASS')) {
        return res.json({ response: "530 Login incorrect.\r\n" });
    }
    if (input.toUpperCase().startsWith('QUIT')) {
        return res.json({ response: "221 Goodbye.\r\n" });
    }
    
    return res.json({ response: "500 Unknown command.\r\n" });
});

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
CURRENT_VERSION="v2.2.0"

if [ "$EUID" -ne 0 ]; then echo "Please run as root"; exit 1; fi

echo "--------------------------------------------------"
echo "   Virtual Puppets Agent Bootstrap v7.2"
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

# --- PERSISTENCE FOR UPDATES ---
echo "$SERVER_URL" > $AGENT_DIR/.server
echo "$TOKEN" > $AGENT_DIR/.token

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "X-VPP-HWID: $HWID" -H "X-VPP-OS: $OS_NAME" \
    -H "X-VPP-WIFI: $HAS_WIFI" -H "X-VPP-BT: $HAS_BT" \
    "$SERVER_URL/api/enroll/config/$TOKEN")

if [ "$HTTP_CODE" -ne "200" ]; then echo "[!] Registration failed."; exit 1; fi
echo "[+] Registration successful. Waiting for approval..."

# --- TRAP RELAY SCRIPT ---
cat <<'EOF_RELAY' > $AGENT_DIR/trap_relay.sh
#!/bin/bash
SERVER=$(cat /opt/vpp-agent/.server)
SID=$(curl -s -X POST "$SERVER/api/trap/init" | jq -r .sessionId)
# Get Initial Banner
curl -s -X POST "$SERVER/api/trap/init" | jq -r .banner
# Loop Stdin
while read -r LINE; do
  RESP=$(curl -s -X POST -H "Content-Type: application/json" -d "{\"sessionId\":\"$SID\",\"input\":\"$LINE\"}" "$SERVER/api/trap/interact" | jq -r .response)
  echo -ne "$RESP"
done
EOF_RELAY
chmod +x $AGENT_DIR/trap_relay.sh

# --- INSTALL VPP-AGENT BINARY ---
cat <<'EOF_BIN' > /usr/local/bin/vpp-agent
#!/bin/bash
AGENT_DIR="/opt/vpp-agent"
LOG_FILE="/var/log/vpp-agent.log"
SERVER=$(cat "$AGENT_DIR/.server")

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
elif [[ "\$1" == "--forensic" ]]; then
    log "Running forensic snapshot..."
    echo "---PROCESSES---"
    ps -aux --sort=-%cpu | head -20
    echo "---NETWORK---"
    ss -tupn
    echo "---AUTH---"
    if [ -f /var/log/auth.log ]; then tail -n 20 /var/log/auth.log; fi
    if [ -f /var/log/secure ]; then tail -n 20 /var/log/secure; fi
    echo "---OPENFILES---"
    lsof -i -P -n 2>/dev/null | head -50
elif [[ "\$1" == "--scan-wireless" ]]; then
    log "Running Wireless Recon Scan..."
    WIFI_JSON="[]"
    BT_JSON="[]"
    
    # WIFI SCAN
    if command -v nmcli &> /dev/null; then
         # Rescan wifi
         nmcli device wifi rescan 2>/dev/null
         sleep 3
         RAW_WIFI=\$(nmcli -t -f SSID,BSSID,SIGNAL,SECURITY dev wifi list 2>/dev/null)
         if [ ! -z "\$RAW_WIFI" ]; then
            WIFI_JSON=\$(echo "\$RAW_WIFI" | jq -R -s -c 'split("\n")[:-1] | map(split(":")) | map({ssid: .[0], bssid: (.[1]+":"+.[2]+":"+.[3]+":"+.[4]+":"+.[5]+":"+.[6]), signal: .[7], security: .[8]})')
         fi
    fi
    
    # BLUETOOTH SCAN
    if command -v hcitool &> /dev/null; then
         # timeout is important as hcitool scan hangs
         RAW_BT=\$(timeout 5s hcitool scan | tail -n +2)
         # Simple parsing for BT is harder in bash without more logic, sending mock empty for now in this snippet or basic logic
         # Real implementation would parse MAC and Name
    fi
    
    ACTOR_ID=\$(cat "\$AGENT_DIR/vpp-id" 2>/dev/null)
    if [ ! -z "\$ACTOR_ID" ]; then
        PAYLOAD=\$(jq -n -c --arg aid "\$ACTOR_ID" --argjson wifi "\$WIFI_JSON" --argjson bt "\$BT_JSON" '{actorId: \$aid, wifi: \$wifi, bluetooth: \$bt}')
        curl -s -X POST -H "Content-Type: application/json" -d "\$PAYLOAD" "\$SERVER/api/agent/scan-results"
    fi
    echo "Scan Complete."
elif [[ "\$1" == "--factory-reset" ]]; then
    echo "Resetting agent configuration..."
    rm -f "\$AGENT_DIR/sentinel_active"
    log "Factory Reset Triggered"
elif [[ "\$1" == "--update" ]]; then
    if [ -f "\$AGENT_DIR/.server" ] && [ -f "\$AGENT_DIR/.token" ]; then
        SERVER=\$(cat "\$AGENT_DIR/.server")
        TOKEN=\$(cat "\$AGENT_DIR/.token")
        log "Initiating Self-Update from \$SERVER..."
        echo "Fetching latest agent from \$SERVER..."
        curl -sL "\$SERVER/setup" | sudo bash -s "\$TOKEN"
        exit 0
    else
        echo "Error: Update credentials not found. Re-run setup manually."
        exit 1
    fi
else
    echo "VPP Agent v2.2.0 - Status OK"
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
VERSION="$CURRENT_VERSION"
EOF

cat <<'EndAgent' >> $AGENT_DIR/agent.sh
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] \$1" >> \$LOGF; }

log "Agent Started. Initializing..."

OS_NAME="Linux"
if [ -f /etc/os-release ]; then . /etc/os-release; if [ -n "$PRETTY_NAME" ]; then OS_NAME="$PRETTY_NAME"; fi; fi

if ! command -v jq &> /dev/null; then
    log "Error: jq is missing."
    exit 1
fi

while [ -z "\$ACTOR_ID" ] || [ "\$ACTOR_ID" == "null" ]; do
    RESPONSE=\$(curl -s -G --connect-timeout 10 --data-urlencode "hwid=\$MY_HWID" --data-urlencode "os=\$OS_NAME" "\$SERVER/api/agent/heartbeat")
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

# Main Loop handles telemetry and commands
while true; do
    if [ -z "\$ACTOR_ID" ] && [ -f "\$AGENT_DIR/vpp-id" ]; then
         ACTOR_ID=\$(cat "\$AGENT_DIR/vpp-id")
    fi

    if [ ! -z "\$ACTOR_ID" ]; then
        # Telemetry
        CPU_USAGE=\$(top -bn1 | grep "Cpu(s)" | sed "s/.*, *\\([0-9.]*\\)%* id.*/\\1/" | awk '{print 100 - \$1}')
        RAM_USAGE=\$(free | grep Mem | awk '{print \$3/\$2 * 100.0}')
        TEMP=0
        if [ -f /sys/class/thermal/thermal_zone0/temp ]; then
             RAW_TEMP=\$(cat /sys/class/thermal/thermal_zone0/temp)
             TEMP=\$(awk "BEGIN {print \$RAW_TEMP/1000}")
        fi
        if [ -z "\$CPU_USAGE" ]; then CPU_USAGE=0; fi
        
        PAYLOAD=\$(jq -n -c \
            --arg aid "\$ACTOR_ID" \
            --arg cpu "\$CPU_USAGE" \
            --arg ram "\$RAM_USAGE" \
            --arg temp "\$TEMP" \
            '{actorId: \$aid, cpu: \$cpu, ram: \$ram, temp: \$temp}')
        
        curl -s -X POST -H "Content-Type: application/json" -d "\$PAYLOAD" --max-time 5 "\$SERVER/api/agent/scan" > /dev/null

        # Check Commands
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
                OUTPUT=\$(timeout 60s "\$AGENT_DIR/job.sh" 2>&1); EXIT_CODE=\$?
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
    sleep 5
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
        'Users': `UserId NVARCHAR(50) PRIMARY KEY, Username NVARCHAR(100), PasswordHash NVARCHAR(255), Role NVARCHAR(20), MfaEnabled BIT DEFAULT 0, MfaSecret NVARCHAR(100), LastLogin DATETIME, Preferences NVARCHAR(MAX)`,
        'Gateways': `GatewayId NVARCHAR(50) PRIMARY KEY, Name NVARCHAR(100), Location NVARCHAR(100), Status NVARCHAR(20), IpAddress NVARCHAR(50), Lat FLOAT, Lng FLOAT`,
        'Actors': `ActorId NVARCHAR(50) PRIMARY KEY, HwId NVARCHAR(100), GatewayId NVARCHAR(50), Name NVARCHAR(100), Status NVARCHAR(20), LocalIp NVARCHAR(50), LastSeen DATETIME, Config NVARCHAR(MAX), OsVersion NVARCHAR(100), TunnelsJson NVARCHAR(MAX), Persona NVARCHAR(MAX), HoneyFilesJson NVARCHAR(MAX), HasWifi BIT DEFAULT 0, HasBluetooth BIT DEFAULT 0, WifiScanningEnabled BIT DEFAULT 0, BluetoothScanningEnabled BIT DEFAULT 0, CpuLoad FLOAT DEFAULT 0, MemoryUsage FLOAT DEFAULT 0, Temperature FLOAT DEFAULT 0, TcpSentinelEnabled BIT DEFAULT 0, AgentVersion NVARCHAR(50)`,
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
            } else {
                if (name === 'Actors') {
                    // Ensure columns exist if table already exists
                    try { await req.query(`ALTER TABLE Actors ADD WifiScanningEnabled BIT DEFAULT 0`); } catch(e){}
                    try { await req.query(`ALTER TABLE Actors ADD BluetoothScanningEnabled BIT DEFAULT 0`); } catch(e){}
                    try { await req.query(`ALTER TABLE Actors ADD CpuLoad FLOAT DEFAULT 0`); } catch(e){}
                    try { await req.query(`ALTER TABLE Actors ADD MemoryUsage FLOAT DEFAULT 0`); } catch(e){}
                    try { await req.query(`ALTER TABLE Actors ADD Temperature FLOAT DEFAULT 0`); } catch(e){}
                    try { await req.query(`ALTER TABLE Actors ADD HoneyFilesJson NVARCHAR(MAX)`); } catch(e){}
                    try { await req.query(`ALTER TABLE Actors ADD TcpSentinelEnabled BIT DEFAULT 0`); } catch(e){}
                    try { await req.query(`ALTER TABLE Actors ADD AgentVersion NVARCHAR(50)`); } catch(e){}
                }
                if (name === 'Users') {
                    try { await req.query(`ALTER TABLE Users ADD Preferences NVARCHAR(MAX)`); } catch(e){}
                }
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

// --- SCHEDULER: WIRELESS RECON (Every 2 Minutes) ---
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
    } catch (e) { console.error("Scheduler Error:", e); }
}, 120000); // 2 Minutes

// --- API ENDPOINTS ---

app.get('/api/health', (req, res) => { res.json({ status: 'active', mode: getDbConfig()?.isConnected ? 'PRODUCTION' : 'MOCK_OR_SETUP', dbConnected: !!dbPool }); });
app.post('/api/setup/db', async (req, res) => { try { await connectToDb(req.body); fs.writeFileSync(CONFIG_FILE, JSON.stringify({...req.body, isConnected: true}, null, 2)); await runSchemaMigrations(dbPool); await refreshSyslogConfig(dbPool); res.json({ success: true }); } catch (err) { res.status(500).json({ success: false, error: err.message }); } });
app.post('/api/login', async (req, res) => { 
    if (!dbPool) return res.json({success: false, error: "DB not connected"}); 
    const { username, password } = req.body; 
    const hash = `btoa_hash_${password}`; 
    try { 
        const result = await dbPool.request().input('u', sql.NVarChar, username).query("SELECT * FROM Users WHERE Username = @u"); 
        if (result.recordset.length > 0) { 
            const user = result.recordset[0]; 
            if (user.PasswordHash === hash) { 
                return res.json({ success: true, user: { 
                    id: user.UserId, 
                    username: user.Username, 
                    role: user.Role, 
                    mfaEnabled: user.MfaEnabled,
                    preferences: user.Preferences ? JSON.parse(user.Preferences) : {}
                } }); 
            } 
        } 
        res.json({ success: false, error: "Invalid credentials" }); 
    } catch (e) { res.json({ success: false, error: e.message }); } 
});

// ... (Other standard routes: users, gateways, etc.)

// --- AGENT ENDPOINTS ---

// NEW: Toggle Scanning Preference
app.put('/api/actors/:id/scanning', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    const { type, enabled } = req.body; // type: 'WIFI' | 'BLUETOOTH'
    try {
        const col = type === 'WIFI' ? 'WifiScanningEnabled' : 'BluetoothScanningEnabled';
        await dbPool.request()
            .input('id', sql.NVarChar, req.params.id)
            .input('val', sql.Bit, enabled ? 1 : 0)
            .query(`UPDATE Actors SET ${col} = @val WHERE ActorId = @id`);
        res.json({success: true});
    } catch(e) { res.status(500).json({error: e.message}); }
});

// NEW: Receive Scan Results
app.post('/api/agent/scan-results', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    const { actorId, wifi, bluetooth } = req.body;
    try {
        // Get Actor Name
        const actorRes = await dbPool.request().input('aid', sql.NVarChar, actorId).query("SELECT Name FROM Actors WHERE ActorId = @aid");
        const actorName = actorRes.recordset[0]?.Name || 'Unknown';

        // Insert WiFi
        if (wifi && Array.isArray(wifi)) {
            for (const net of wifi) {
                // Upsert logic (simplistic delete/insert or merge)
                const netId = `wifi-${actorId}-${net.bssid}`;
                await dbPool.request()
                    .input('nid', sql.NVarChar, netId)
                    .input('ssid', sql.NVarChar, net.ssid || '')
                    .input('bssid', sql.NVarChar, net.bssid || '')
                    .input('sig', sql.Int, parseInt(net.signal) || -100)
                    .input('sec', sql.NVarChar, net.security || 'OPEN')
                    .input('aid', sql.NVarChar, actorId)
                    .input('aname', sql.NVarChar, actorName)
                    .query(`
                        IF EXISTS (SELECT 1 FROM WifiNetworks WHERE Id = @nid)
                            UPDATE WifiNetworks SET SignalStrength = @sig, LastSeen = GETDATE() WHERE Id = @nid
                        ELSE
                            INSERT INTO WifiNetworks (Id, Ssid, Bssid, SignalStrength, Security, Channel, ActorId, ActorName, LastSeen)
                            VALUES (@nid, @ssid, @bssid, @sig, @sec, 0, @aid, @aname, GETDATE())
                    `);
            }
        }
        res.json({success: true});
    } catch(e) { console.error("Scan Save Error", e); res.json({success: false}); }
});

app.get('/api/agent/heartbeat', async (req, res) => {
    if (!dbPool) return res.status(503).json({});
    const { hwid, os } = req.query;
    if (!hwid) return res.status(400).json({});
    
    try {
        const actor = await dbPool.request().input('h', sql.NVarChar, hwid).query("SELECT ActorId, Status FROM Actors WHERE HwId = @h");
        if (actor.recordset.length > 0) {
            const a = actor.recordset[0];
            await dbPool.request()
                .input('aid', sql.NVarChar, a.ActorId)
                .input('os', sql.NVarChar, os || 'Unknown')
                .query("UPDATE Actors SET LastSeen = GETDATE(), OsVersion = CASE WHEN @os <> 'Unknown' THEN @os ELSE OsVersion END WHERE ActorId = @aid");
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
                .input('os', sql.NVarChar, os || 'Unknown')
                .query("INSERT INTO PendingActors (Id, HwId, DetectedIp, DetectedAt, OsVersion) VALUES (@pid, @h, @ip, GETDATE(), @os)");
        }
        res.json({ status: 'PENDING' });
    } catch(e) { res.status(500).json({}); }
});

app.get('/api/agent/commands', async (req, res) => {
    if (!dbPool) return res.json([]);
    const { actorId } = req.query;
    try {
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
    const { actorId, cpu, ram, temp, version } = req.body;
    try {
        if (actorId) {
            await dbPool.request()
                .input('aid', sql.NVarChar, actorId)
                .input('c', sql.Float, parseFloat(cpu) || 0)
                .input('r', sql.Float, parseFloat(ram) || 0)
                .input('t', sql.Float, parseFloat(temp) || 0)
                .input('v', sql.NVarChar, version || 'v1.0')
                .query("UPDATE Actors SET CpuLoad = @c, MemoryUsage = @r, Temperature = @t, AgentVersion = @v, LastSeen = GETDATE() WHERE ActorId = @aid");
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

// --- SESSION RECORDINGS API ---
app.get('/api/sessions', (req, res) => {
    res.json(recordedSessions);
});

app.delete('/api/sessions/:id', (req, res) => {
    recordedSessions = recordedSessions.filter(s => s.id !== req.params.id);
    res.json({ success: true });
});


// --- ACTOR MGMT ---

app.get('/api/actors', async (req, res) => { if (!dbPool) return res.json([]); try { const result = await dbPool.request().query("SELECT * FROM Actors"); res.json(result.recordset.map(row => ({ id: row.ActorId, proxyId: row.GatewayId, name: row.Name, localIp: row.LocalIp, status: row.Status, lastSeen: row.LastSeen, osVersion: row.OsVersion, activeTunnels: row.TunnelsJson ? JSON.parse(row.TunnelsJson) : [], deployedHoneyFiles: row.HoneyFilesJson ? JSON.parse(row.HoneyFilesJson) : [], persona: row.Persona ? JSON.parse(row.Persona) : undefined, hasWifi: row.HasWifi, hasBluetooth: row.HasBluetooth, wifiScanningEnabled: row.WifiScanningEnabled, bluetoothScanningEnabled: row.BluetoothScanningEnabled, cpuLoad: row.CpuLoad, memoryUsage: row.MemoryUsage, temperature: row.Temperature, tcpSentinelEnabled: row.TcpSentinelEnabled, protocolVersion: row.AgentVersion || 'v1.0' }))); } catch (e) { res.status(500).json({error: e.message}); } });

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
            .input('id', sql.NVarChar, req.params.id).input('en', sql.Bit, enabled ? 1 : 0).query("UPDATE Actors SET TcpSentinelEnabled = @en WHERE ActorId = @id");
        res.json({success: true});
    } catch(e) { res.status(500).json({error: e.message}); }
});

// --- REPORTS ---

app.post('/api/reports/generate', async (req, res) => {
    if (!dbPool) return res.json({success: false});
    const { type, generatedBy, customBody, incidentDetails, incidentFilters, snapshotData } = req.body;
    
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
            incidentFilters: incidentFilters,
            snapshotData: snapshotData // NEW: Pass forensic snapshot data to report
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
        else if (type === 'FORENSIC_SNAPSHOT') {
             title = `Forensic Snapshot - ${new Date().toLocaleTimeString()}`;
             content.summaryText = "Volatile system state capture for incident analysis.";
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
