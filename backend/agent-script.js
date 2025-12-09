
export const CURRENT_AGENT_VERSION = "2.5.1";

export const generateAgentScript = (serverUrl, token) => {
  return `#!/bin/bash
TOKEN="${token}"
SERVER_URL="${serverUrl}"
AGENT_DIR="/opt/vpp-agent"
VERSION="${CURRENT_AGENT_VERSION}"
LOG_FILE="/var/log/vpp-agent.log"

# Redirect stdout and stderr to log file
exec > >(tee -a $LOG_FILE) 2>&1

echo "[$(date)] [INSTALLER] Starting VPP Agent Setup..."
echo "[$(date)] [INSTALLER] Server: $SERVER_URL"

# Root Check
if [ "$EUID" -ne 0 ]; then 
  echo "Error: Please run as root (sudo)."
  exit 1
fi

# Dependencies Installation
if command -v apt-get &> /dev/null; then 
  export DEBIAN_FRONTEND=noninteractive
  if ! command -v jq &> /dev/null || ! command -v socat &> /dev/null; then
      echo "[INSTALLER] Installing dependencies (jq, socat)..."
      apt-get update -qq && apt-get install -y jq curl socat lsof network-manager bluez python3 -qq
  fi
fi

if ! command -v jq &> /dev/null; then
    echo "❌ Error: 'jq' is missing. Please install it manually."
    exit 1
fi

# Setup Directories
mkdir -p $AGENT_DIR
echo "$SERVER_URL" > $AGENT_DIR/.server
echo "$TOKEN" > $AGENT_DIR/.token
echo "$VERSION" > $AGENT_DIR/.version
echo "off" > $AGENT_DIR/.sentinel

# Create Trap Relay Script
cat <<'EOF_TRAP' > $AGENT_DIR/trap_relay.sh
#!/bin/bash
# Socat sets SOCAT_PEERADDR, SOCAT_PEERPORT, SOCAT_SOCKPORT
AGENT_DIR="/opt/vpp-agent"
SERVER=$(cat "$AGENT_DIR/.server")
ACTOR_ID=$(cat "$AGENT_DIR/vpp-id")
LOG_FILE="/var/log/vpp-agent.log"

# Log to local file explicitly
echo "[TRAP] Connection from $SOCAT_PEERADDR:$SOCAT_PEERPORT -> :$SOCAT_SOCKPORT" >> $LOG_FILE

# Send Alert
PAYLOAD=$(jq -n \\
  --arg aid "$ACTOR_ID" \\
  --arg lvl "CRITICAL" \\
  --arg proc "trap_relay" \\
  --arg msg "[TRAP] Connection from $SOCAT_PEERADDR:$SOCAT_PEERPORT -> :$SOCAT_SOCKPORT" \\
  --arg ip "$SOCAT_PEERADDR" \\
  '{actorId: $aid, level: $lvl, process: $proc, message: $msg, sourceIp: $ip}')

curl -s -X POST -H "Content-Type: application/json" -d "$PAYLOAD" "$SERVER/api/agent/log" &

# Mock Interaction (Echo)
echo "Connection Logged. Terminal Locked."
while read line; do
  echo "Access Denied."
done
EOF_TRAP
chmod +x $AGENT_DIR/trap_relay.sh

# Create Python Parser for Robust WiFi Scanning
cat <<'EOF_PY' > $AGENT_DIR/wifi_scan.py
import subprocess, json, sys

try:
    # Run nmcli command
    cmd = ['nmcli', '-t', '-f', 'SSID,BSSID,SIGNAL,SECURITY,CHAN', 'device', 'wifi', 'list']
    output = subprocess.check_output(cmd).decode('utf-8')
    
    data = []
    # Limit to 30 strongest networks to prevent payload bloat
    for line in output.splitlines()[:30]:
        # Robust parsing for escaped colons
        parts = []
        curr = []
        escape = False
        for char in line:
            if escape:
                curr.append(char)
                escape = False
            elif char == '\\':
                escape = True
            elif char == ':':
                parts.append("".join(curr))
                curr = []
            else:
                curr.append(char)
        parts.append("".join(curr))
        
        if len(parts) >= 5:
            ssid = parts[0]
            if not ssid: ssid = "<Hidden>"
            
            try: signal = int(parts[2])
            except: signal = 0
            
            try: chan = int(parts[4])
            except: chan = 0
            
            data.append({
                "ssid": ssid, 
                "bssid": parts[1], 
                "signal": signal, 
                "security": parts[3], 
                "channel": chan
            })
            
    print(json.dumps(data))
except Exception as e:
    # Fallback empty array on error
    sys.stderr.write(str(e))
    print("[]")
EOF_PY

# Create Main Agent Script
cat <<'EOF_SRV' > $AGENT_DIR/agent.sh
#!/bin/bash
export PATH=$PATH:/usr/sbin:/sbin:/usr/bin:/usr/local/bin
AGENT_DIR="/opt/vpp-agent"
SERVER=$(cat "$AGENT_DIR/.server")
LOG_FILE="/var/log/vpp-agent.log"
ACTOR_NAME="Agent"

# Handle CLI arguments
if [ "$1" == "--update" ]; then
    echo "[VPP-AGENT] Triggering Self-Update..."
    curl -sL "$SERVER/api/setup?token=$(cat $AGENT_DIR/.token)" | bash
    exit 0
elif [ "$1" == "--factory-reset" ]; then
    echo "[VPP-AGENT] Factory Reset Initiated..."
    rm -f "$AGENT_DIR/vpp-id"
    echo "off" > "$AGENT_DIR/.sentinel"
    echo "Reset Complete."
    exit 0
elif [ "$1" == "--recon" ]; then
    echo "Manual recon trigger not supported directly. Waiting for loop."
    exit 0
fi

# Function to log messages
log() {
    echo "[$(date)] $1" >> $LOG_FILE
}

get_hwid() {
    local HID=""
    if command -v ip &> /dev/null; then
        HID=$(ip link show | awk '/ether/ {print $2}' | head -n 1)
    fi
    if [ -z "$HID" ]; then
        HID=$(cat /sys/class/net/eth0/address 2>/dev/null || cat /sys/class/net/wlan0/address 2>/dev/null)
    fi
    if [ -z "$HID" ]; then
        HID=$(hostname)
    fi
    echo "$HID"
}

get_os_name() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        if [ ! -z "$PRETTY_NAME" ]; then
            echo "$PRETTY_NAME" | tr -d '"'
            return
        fi
    fi
    uname -sr
}

check_capabilities() {
    local WIFI="false"
    local BT="false"
    if ls /sys/class/net/ | grep -qE '^w|^m'; then WIFI="true"; fi
    if [ -d "/sys/class/bluetooth" ] && [ "$(ls -A /sys/class/bluetooth)" ]; then BT="true"; fi
    echo "$WIFI $BT"
}

get_metrics() {
    CPU=$(top -bn1 | grep "Cpu(s)" | sed "s/.*, *\\([0-9.]*\\)%* id.*/\\1/" | awk '{print 100 - $1}')
    if [ -z "$CPU" ]; then CPU=0; fi
    RAM=$(free -m | awk '/Mem:/ { printf("%.1f", $3/$2 * 100.0) }')
    if [ -z "$RAM" ]; then RAM=0; fi
    TEMP=$(cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null | awk '{print $1/1000}')
    if [ -z "$TEMP" ]; then TEMP=0; fi
    echo "$CPU $RAM $TEMP"
}

perform_recon() {
    local AID="$1"
    log "[RECON] Initiating Wireless Scan..."
    
    if command -v nmcli &> /dev/null; then
        # Use robust Python parser
        WIFIDATA=$(python3 $AGENT_DIR/wifi_scan.py)
        COUNT=$(echo "$WIFIDATA" | grep -o "ssid" | wc -l)
        
        if [ "$COUNT" -gt 0 ]; then
            log "[RECON] WiFi: Found $COUNT networks, constructing payload..."
            
            # Construct payload safely using --argjson
            JSON=$(jq -n --arg aid "$AID" --argjson d "$WIFIDATA" '{actorId: $aid, type: "WIFI", data: $d}')
            
            log "[RECON] Uploading to $SERVER/api/agent/recon ..."
            
            # Upload Synchronously and Capture Status Code
            HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" -d "$JSON" "$SERVER/api/agent/recon")
            
            log "[RECON] Upload Result: HTTP $HTTP_CODE"
        else
            log "[RECON] WiFi: No networks found (Python parser returned empty)."
        fi
    else
        log "[RECON] Error: nmcli not found."
    fi
}

check_sentinel() {
    local AID="$1"
    local MODE=$(cat "$AGENT_DIR/.sentinel" 2>/dev/null)
    if [ "$MODE" == "on" ]; then
        SERVER_HOST=$(echo "$SERVER" | awk -F/ '{print $3}' | cut -d: -f1)
        local CONNS=$(ss -nt state connected | grep -v "$SERVER_HOST" | grep -v "127.0.0.1" | awk '{print $4, $5}')
        if [ ! -z "$CONNS" ]; then
            # Simple check for now
            log "[SENTINEL] Active connection detected."
        fi
    fi
}

# --- INITIALIZATION ---
HWID=$(get_hwid)
OS_NAME=$(get_os_name)
log "Agent Started (v$VERSION). HWID: $HWID"

# Validation & Enrollment
while [ ! -f "$AGENT_DIR/vpp-id" ]; do
    CUR_VER=$(cat "$AGENT_DIR/.version" 2>/dev/null || echo "1.0.0")
    RESP=$(curl -s -G --data-urlencode "hwid=$HWID" --data-urlencode "os=$OS_NAME" --data-urlencode "version=$CUR_VER" "$SERVER/api/agent/heartbeat")
    STATUS=$(echo "$RESP" | jq -r '.status')
    
    if [ "$STATUS" == "APPROVED" ]; then 
        echo "$RESP" | jq -r '.actorId' > "$AGENT_DIR/vpp-id"
        log "Agent Approved! ID: $(cat $AGENT_DIR/vpp-id)"
    else
        log "Waiting for approval..."
        sleep 10
    fi
done

ACTOR_ID=$(cat "$AGENT_DIR/vpp-id")
log "Entering Main Loop for Actor: $ACTOR_ID"

LOOP_COUNT=0

# --- MAIN EVENT LOOP ---
while true; do
    read CPU RAM TEMP <<< $(get_metrics)
    read HAS_WIFI HAS_BT <<< $(check_capabilities)
    
    PAYLOAD=$(jq -n --arg id "$ACTOR_ID" --arg cpu "$CPU" --arg ram "$RAM" --arg temp "$TEMP" --arg wifi "$HAS_WIFI" --arg bt "$HAS_BT" '{actorId: $id, cpu: $cpu, ram: $ram, temp: $temp, hasWifi: $wifi, hasBluetooth: $bt}')
    OUT=$(curl -s -X POST -H "Content-Type: application/json" -d "$PAYLOAD" "$SERVER/api/agent/scan")
    
    if [[ "$OUT" == *"RESET"* ]]; then
        rm -f "$AGENT_DIR/vpp-id"
        exit 0
    fi
    
    SCAN_WIFI=$(echo "$OUT" | jq -r '.wifiScanning')
    
    # Task Polling
    TASKS=$(curl -s -G --data-urlencode "actorId=$ACTOR_ID" "$SERVER/api/agent/tasks")
    echo "$TASKS" | jq -c '.[]' 2>/dev/null | while read -r task; do
        JOB_ID=$(echo "$task" | jq -r '.id')
        CMD=$(echo "$task" | jq -r '.command')
        log "Executing Job $JOB_ID: $CMD"
        
        if [[ "$CMD" == *"vpp-agent --update"* ]]; then
            log "[UPDATE] Update requested from server."
            curl -sL "$SERVER/api/setup?token=$(cat $AGENT_DIR/.token)" | bash
            exit 0
        elif [[ "$CMD" == *"vpp-agent --recon"* ]]; then
             perform_recon "$ACTOR_ID"
             RESULT="Recon Manual Trigger"
        else
             RESULT=$(eval "$CMD" 2>&1)
        fi
        
        REPORT=$(jq -n --arg out "$RESULT" --arg stat "COMPLETED" '{output: $out, status: $stat}')
        curl -s -X POST -H "Content-Type: application/json" -d "$REPORT" "$SERVER/api/agent/tasks/$JOB_ID"
    done

    # Scheduled Recon
    LOOP_COUNT=$((LOOP_COUNT+1))
    if [ $LOOP_COUNT -ge 12 ]; then
        LOOP_COUNT=0
        if [ "$SCAN_WIFI" == "true" ]; then
             perform_recon "$ACTOR_ID"
        fi
    fi

    sleep 5
done
EOF_SRV
chmod +x $AGENT_DIR/agent.sh

# Install Systemd Service
cat <<EOF > /etc/systemd/system/vpp-agent.service
[Unit]
Description=Virtual Puppets C2 Agent
After=network.target

[Service]
ExecStart=$AGENT_DIR/agent.sh
Restart=always
User=root
WorkingDirectory=$AGENT_DIR

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable vpp-agent
systemctl restart vpp-agent

echo "[$(date)] [INSTALLER] Agent Installed and Started successfully."
`;
};
