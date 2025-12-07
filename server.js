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
let recordedSessions = []; 
// In-memory storage for active API-based trap sessions
const activeTrapSessions = new Map();

// --- MFA CONFIGURATION ---
authenticator.options = { window: [2, 2] };

app.use(cors());

app.use(bodyParser.json({
    limit: '10mb',
    verify: (req, res, buf) => {
        req.rawBody = buf.toString();
    }
}));

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

// --- SESSION RECORDING HELPER ---
const recordFrame = (session, type, data) => {
    if (!session) return;
    // Don't record empty keep-alives usually, but for raw logs maybe yes.
    // For visual clarity, trim
    if (!data) return;

    const frame = {
        time: Date.now() - session.startTimeMs,
        type: type, // 'INPUT' or 'OUTPUT'
        data: data
    };
    session.frames.push(frame);
    session.durationSeconds = (Date.now() - session.startTimeMs) / 1000;
};

// --- TRAP STATE MACHINE (API BASED) ---
const processTrapLogic = (session, input) => {
    let output = '';
    let closed = false;
    const cmd = input.trim();

    // FTP Logic
    if (session.protocol === 'FTP') {
        if (!session.state) session.state = 'USER';

        if (cmd.toUpperCase().startsWith('USER')) {
            output = '331 Please specify the password.\r\n';
            session.state = 'PASS';
        } else if (cmd.toUpperCase().startsWith('PASS')) {
            output = '530 Login incorrect.\r\n';
            session.state = 'USER';
        } else if (cmd.toUpperCase().startsWith('SYST')) {
            output = '215 UNIX Type: L8\r\n';
        } else if (cmd.toUpperCase().startsWith('QUIT')) {
            output = '221 Goodbye.\r\n';
            closed = true;
        } else {
            output = '500 Unknown command.\r\n';
        }
    }
    // Telnet Logic
    else if (session.protocol === 'TELNET' || session.protocol === 'Telnet') {
        if (!session.state) session.state = 'LOGIN';

        if (session.state === 'LOGIN') {
            output = 'Password: ';
            session.state = 'PASS';
        } else if (session.state === 'PASS') {
            output = '\r\nLogin incorrect\r\n\r\nserver login: ';
            session.state = 'LOGIN';
        }
    }
    // Redis Logic
    else if (session.protocol === 'REDIS' || session.protocol === 'Redis') {
        const up = cmd.toUpperCase();
        if (up.includes('AUTH')) {
            output = '-ERR invalid password\r\n';
        } else if (up.includes('CONFIG') || up.includes('GET') || up.includes('SET')) {
            output = '-NOAUTH Authentication required.\r\n';
        } else if (up === 'QUIT') {
            output = '+OK\r\n';
            closed = true;
        } else {
            output = '-ERR unknown command\r\n';
        }
    }
    // Default Echo
    else {
        output = `Echo: ${input}\r\n`;
    }

    return { output, closed };
};

// --- TRAP API ENDPOINTS ---

app.post('/api/trap/init', (req, res) => {
    const { type, actorId } = req.body; // actorId optional if coming from anonymous
    const ip = getClientIp(req);
    const sessionId = `sess-${type}-${Date.now()}`;
    
    // Initial Banner
    let banner = '';
    if (type === 'FTP' || type.includes('VSFTPD')) {
        banner = '220 (vsFTPd 2.3.4)\r\n';
    } else if (type === 'Telnet' || type === 'TELNET') {
        banner = '\r\nUbuntu 20.04.6 LTS\r\nserver login: ';
    } else if (type === 'Redis' || type === 'REDIS') {
        // Redis is silent on connect usually, or sends nothing until prompted
        banner = ''; 
    }

    const session = {
        id: sessionId,
        actorId: actorId || 'unknown',
        attackerIp: ip,
        protocol: type,
        startTime: new Date(),
        startTimeMs: Date.now(),
        durationSeconds: 0,
        frames: [],
        state: null // For state machine
    };

    if (banner) {
        recordFrame(session, 'OUTPUT', banner);
    }

    activeTrapSessions.set(sessionId, session);
    recordedSessions.unshift(session);
    if (recordedSessions.length > 50) recordedSessions.pop();

    console.log(`[TRAP API] New Session ${sessionId} (${type}) from ${ip}`);
    res.json({ sessionId, output: banner });
});

app.post('/api/trap/interact', (req, res) => {
    const { sessionId, input } = req.body;
    const session = activeTrapSessions.get(sessionId);
    
    if (!session) {
        return res.status(404).json({ error: 'Session not found', closed: true });
    }

    // Record Input
    recordFrame(session, 'INPUT', input);

    // Process Logic
    const { output, closed } = processTrapLogic(session, input);

    // Record Output
    if (output) {
        recordFrame(session, 'OUTPUT', output);
    }

    if (closed) {
        activeTrapSessions.delete(sessionId);
    }

    res.json({ output, closed });
});


// --- LEGACY TCP LISTENERS (OPTIONAL DIRECT CONNECT) ---
// Kept for backward compatibility if port forwarding works
const startHoneypotListener = (server, port, name) => {
    server.on('error', (e) => {
        if (e.code === 'EADDRINUSE') {
            console.log(`[Honeypot] ${name} port ${port} is busy.`);
        } else {
            console.error(`[Honeypot] ${name} error:`, e);
        }
    });
    try {
        server.listen(port, () => console.log(`[Honeypot] ${name} listening on ${port}`));
    } catch (e) {}
};
startHoneypotListener(net.createServer(), HONEYPOT_PORTS.FTP, 'FTP (Legacy)');


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
CURRENT_VERSION="v2.2.0"

if [ "$EUID" -ne 0 ]; then echo "Please run as root"; exit 1; fi

echo "--------------------------------------------------"
echo "   Virtual Puppets Agent Bootstrap v7.3"
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

# --- CREATE TRAP RELAY SCRIPT (HTTPS TUNNEL) ---
cat <<'EOF_RELAY' > $AGENT_DIR/trap_relay.sh
#!/bin/bash
TYPE=$1
# Retrieve Server URL safely
if [ -f /opt/vpp-agent/.server ]; then
  SERVER=$(cat /opt/vpp-agent/.server)
else
  exit 1
fi

# 1. Initialize Session via API
# We do not verify SSL in bootstrap for compatibility with self-signed labs (-k)
RESP=$(curl -s -k -X POST -H "Content-Type: application/json" -d "{\"type\":\"$TYPE\"}" "$SERVER/api/trap/init")
SID=$(echo "$RESP" | jq -r .sessionId)
BANNER=$(echo "$RESP" | jq -r .output)

if [ "$SID" == "null" ] || [ -z "$SID" ]; then exit 1; fi

# 2. Output Initial Banner (handling escaped chars if any)
if [ "$BANNER" != "null" ]; then printf "%b" "$BANNER"; fi

# 3. Relay Loop
# Read line by line from stdin (socket) and send to API
while IFS= read -r line || [ -n "$line" ]; do
  # Construct JSON safely using jq to avoid injection
  PAYLOAD=$(jq -n --arg sid "$SID" --arg in "$line" '{sessionId: $sid, input: $in}')
  
  RESP=$(curl -s -k -X POST -H "Content-Type: application/json" -d "$PAYLOAD" "$SERVER/api/trap/interact")
  
  OUT=$(echo "$RESP" | jq -r .output)
  if [ "$OUT" != "null" ]; then printf "%b" "$OUT"; fi
  
  CLOSED=$(echo "$RESP" | jq -r .closed)
  if [ "$CLOSED" == "true" ]; then break; fi
done
EOF_RELAY
chmod +x $AGENT_DIR/trap_relay.sh

# --- INSTALL VPP-AGENT BINARY ---
cat <<'EOF_BIN' > /usr/local/bin/vpp-agent
#!/bin/bash
AGENT_DIR="/opt/vpp-agent"
LOG_FILE="/var/log/vpp-agent.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] \$1" >> \$LOG_FILE; }

if [[ "\$1" == "--set-persona" ]]; then
    echo "Updating system persona..."
    sleep 1
    log "Persona changed to: \$2"
elif [[ "\$1" == "--set-sentinel" ]]; then
    if [[ "\$2" == "on" ]]; then
            touch "\$AGENT_DIR/sentinel_active"
            log "SENTINEL MODE ENABLED (Paranoid)"
            echo "SENTINEL MODE ACTIVE" >> \$LOG_FILE
    else
            rm -f "\$AGENT_DIR/sentinel_active"
            log "Sentinel Mode Disabled"
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
elif [[ "\$1" == "--factory-reset" ]]; then
    echo "Resetting agent configuration..."
    rm -f "\$AGENT_DIR/sentinel_active"
    log "Factory Reset Triggered"
elif [[ "\$1" == "--update" ]]; then
    if [ -f "\$AGENT_DIR/.server" ]; then
        SERVER=\$(cat "\$AGENT_DIR/.server")
        TOKEN=\$(cat "\$AGENT_DIR/.token")
        curl -sL "\$SERVER/setup" | sudo bash -s "\$TOKEN"
        exit 0
    else
        echo "Error: Update credentials not found."
        exit 1
    fi
else
    echo "VPP Agent v2.2.0 - Status OK"
fi
EOF_BIN
chmod +x /usr/local/bin/vpp-agent

# --- MAIN AGENT SERVICE SCRIPT ---
cat <<EOF > $AGENT_DIR/agent.sh
#!/bin/bash
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
        sleep 5
    fi
done

(
    # Telemetry Loop
    while true; do
        WIFI_JSON="[]"
        if [ "\$HAS_WIFI" = true ]; then
             RAW_WIFI=\$(nmcli -t -f SSID,BSSID,SIGNAL,SECURITY dev wifi list 2>/dev/null)
             if [ ! -z "\$RAW_WIFI" ]; then
                WIFI_JSON=\$(echo "\$RAW_WIFI" | jq -R -s -c 'split("\n")[:-1] | map(split(":")) | map({ssid: .[0], bssid: (.[1]+":"+.[2]+":"+.[3]+":"+.[4]+":"+.[5]+":"+.[6]), signal: .[7], security: .[8]})')
             fi
        fi
        
        CPU_USAGE=\$(top -bn1 | grep "Cpu(s)" | sed "s/.*, *\\([0-9.]*\\)%* id.*/\\1/" | awk '{print 100 - \$1}')
        if [ -z "\$CPU_USAGE" ]; then CPU_USAGE=0; fi
        
        PAYLOAD=\$(jq -n -c \
            --arg aid "\$ACTOR_ID" \
            --argjson wifi "\$WIFI_JSON" \
            --arg cpu "\$CPU_USAGE" \
            --arg ver "\$VERSION" \
            '{actorId: \$aid, wifi: \$wifi, bluetooth: [], cpu: \$cpu, ram: 0, temp: 0, version: \$ver}')
        
        curl -s -X POST -H "Content-Type: application/json" -d "\$PAYLOAD" --max-time 15 "\$SERVER/api/agent/scan" > /dev/null
        sleep 30
    done
) &

(
    # Threat Monitor Loop
    declare -A ALERT_THROTTLE
    while true; do
        if [ -f "\$AGENT_DIR/sentinel_active" ]; then
             RAW_LINES=\$(ss -H -ntap state established state syn-recv | grep -v "127.0.0.1")
        else
             RAW_LINES=\$(ss -ntap | grep "socat")
        fi

        if [ ! -z "\$RAW_LINES" ]; then
             while read -r LINE; do
                 if [ -z "\$LINE" ]; then continue; fi
                 PEER=\$(echo "\$LINE" | awk '{print \$5}')
                 LOCAL=\$(echo "\$LINE" | awk '{print \$4}')
                 PEER_IP=\${PEER%:*}
                 LOCAL_PORT=\${LOCAL##*:}
                 
                 if [[ "\$PEER_IP" != "*" && "\$PEER_IP" != "0.0.0.0" && "\$PEER_IP" != "" ]]; then
                     THROTTLE_KEY="\${PEER_IP}-\${LOCAL_PORT}"
                     NOW_SEC=\$(date +%s)
                     LAST_ALERT_TIME=\${ALERT_THROTTLE[\$THROTTLE_KEY]}
                     
                     if [ ! -z "\$LAST_ALERT_TIME" ] && [ \$((NOW_SEC - LAST_ALERT_TIME)) -lt 60 ]; then
                        continue
                     fi
                     
                     ALERT_THROTTLE[\$THROTTLE_KEY]=\$NOW_SEC
                     MSG="ALERT: Connection from \$PEER to \$LOCAL"
                     
                     if [ ! -z "\$ACTOR_ID" ]; then
                         PAYLOAD=\$(jq -n -c --arg ip "\$PEER_IP" --arg msg "\$MSG" '{type: "TRAP_TRIGGERED", details: \$msg, sourceIp: \$ip}')
                         curl -s -X POST -H "Content-Type: application/json" -d "\$PAYLOAD" "\$SERVER/api/agent/alert?actorId=\$ACTOR_ID" > /dev/null
                     fi
                 fi
             done <<< "\$RAW_LINES"
        fi
        sleep 1
    done
) &

while true; do
    if [ ! -z "\$ACTOR_ID" ]; then
        JOB_JSON=\$(curl -s --connect-timeout 10 "\$SERVER/api/agent/commands?actorId=\$ACTOR_ID")
        if [ ! -z "\$JOB_JSON" ] && echo "\$JOB_JSON" | jq -e '.[0].id' > /dev/null 2>&1; then
            JOB_ID=\$(echo "\$JOB_JSON" | jq -r '.[0].id')
            CMD=\$(echo "\$JOB_JSON" | jq -r '.[0].command')
            
            curl -s -X POST -H "Content-Type: application/json" -d '{"jobId":"'"\$JOB_ID"'","status":"RUNNING","output":"Executing..."}' "\$SERVER/api/agent/result" > /dev/null
            
            printf "#!/bin/bash\n%s\n" "\$CMD" > "\$AGENT_DIR/job.sh"
            chmod +x "\$AGENT_DIR/job.sh"
            OUTPUT=\$(timeout 10s "\$AGENT_DIR/job.sh" 2>&1)
            
            PAYLOAD=\$(jq -n -c --arg jid "\$JOB_ID" --arg out "\$OUTPUT" '{jobId: \$jid, status: "COMPLETED", output: \$out}')
            curl -s -X POST -H "Content-Type: application/json" -d "\$PAYLOAD" "\$SERVER/api/agent/result" > /dev/null
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
`;
    res.setHeader('Content-Type', 'text/plain');
    res.send(script.trim());
});

if (fs.existsSync(distPath)) { app.use(express.static(distPath)); }

let dbPool = null;
const getDbConfig = () => { try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (e) { return null; } };
const connectToDb = async (config) => {
    try {
        const isIp = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(config.server.split(':')[0]);
        dbPool = await sql.connect({
            user: config.username, password: config.passwordEncrypted, 
            server: config.server.split(':')[0], port: parseInt(config.server.split(':')[1]) || 1433,
            database: config.database, options: { encrypt: !isIp, trustServerCertificate: true }
        });
        console.log("DB Connected");
        return true;
    } catch (err) { console.error("DB Fail:", err.message); throw err; }
};

const init = async () => {
    const cfg = getDbConfig();
    if (cfg && cfg.isConnected) { try { await connectToDb(cfg); await refreshSyslogConfig(dbPool); } catch (e) {} }
};
init();

// --- GENERIC API ROUTES (Shortened for brevity as they remain largely same) ---
app.get('/api/health', (req, res) => { res.json({ status: 'active', mode: getDbConfig()?.isConnected ? 'PRODUCTION' : 'MOCK_OR_SETUP', dbConnected: !!dbPool }); });
app.get('/api/sessions', (req, res) => { res.json(recordedSessions); });
app.delete('/api/sessions/:id', (req, res) => { recordedSessions = recordedSessions.filter(s => s.id !== req.params.id); res.json({ success: true }); });

// Default catch-all
app.get('*', (req, res) => {
    if (req.accepts('html')) {
        const indexPath = path.join(distPath, 'index.html');
        if (fs.existsSync(indexPath)) res.sendFile(indexPath);
        else res.status(404).send('App not built');
    } else {
        res.status(404).json({ error: 'Not found' });
    }
});

app.listen(port, '0.0.0.0', () => { console.log(`Server listening on port ${port}`); });
