

export const CURRENT_AGENT_VERSION = "2.3.2";

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
      apt-get update -qq && apt-get install -y jq curl socat lsof network-manager bluez -qq
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
SERVER=\$(cat "\$AGENT_DIR/.server")
ACTOR_ID=\$(cat "\$AGENT_DIR/vpp-id")

# Log to local
echo "[TRAP] Connection from \$SOCAT_PEERADDR:\$SOCAT_PEERPORT -> :\$SOCAT_SOCKPORT" >> /var/log/vpp-agent.log

# Send Alert
PAYLOAD=\$(jq -n \\
  --arg aid "\$ACTOR_ID" \\
  --arg lvl "CRITICAL" \\
  --arg proc "trap_relay" \\
  --arg msg "[TRAP] Connection from \$SOCAT_PEERADDR:\$SOCAT_PEERPORT -> :\$SOCAT_SOCKPORT" \\
  --arg ip "\$SOCAT_PEERADDR" \\
  '{actorId: \$aid, level: \$lvl, process: \$proc, message: \$msg, sourceIp: \$ip}')

curl -s -X POST -H "Content-Type: application/json" -d "\$PAYLOAD" "\$SERVER/api/agent/log" &

# Mock Interaction (Echo)
echo "Connection Logged. Terminal Locked."
while read line; do
  echo "Access Denied."
done
EOF_TRAP
chmod +x $AGENT_DIR/trap_relay.sh

# Create Main Agent Script
cat <<'EOF_SRV' > $AGENT_DIR/agent.sh
#!/bin/bash
export PATH=$PATH:/usr/sbin:/sbin:/usr/bin:/bin:/usr/local/bin
AGENT_DIR="/opt/vpp-agent"
SERVER=\$(cat "\$AGENT_DIR/.server")
LOG_FILE="/var/log/vpp-agent.log"
ACTOR_NAME="Agent"

# Function to log messages
log() {
    echo "[$(date)] \$1" >> \$LOG_FILE
}

get_hwid() {
    # Robust HWID Detection
    local HID=""
    if command -v ip &> /dev/null; then
        HID=\$(ip link show | awk '/ether/ {print \$2}' | head -n 1)
    fi
    if [ -z "\$HID" ]; then
        HID=\$(cat /sys/class/net/eth0/address 2>/dev/null || cat /sys/class/net/wlan0/address 2>/dev/null)
    fi
    if [ -z "\$HID" ]; then
        HID=\$(hostname)
    fi
    echo "\$HID"
}

get_metrics() {
    # CPU Usage (100 - idle)
    # Escaped backslashes for capture group and backreference
    CPU=\$(top -bn1 | grep "Cpu(s)" | sed "s/.*, *\\([0-9.]*\\)%* id.*/\\1/" | awk '{print 100 - \$1}')
    if [ -z "\$CPU" ]; then CPU=0; fi
    
    # RAM Usage %
    RAM=\$(free -m | awk '/Mem:/ { printf("%.1f", \$3/\$2 * 100.0) }')
    if [ -z "\$RAM" ]; then RAM=0; fi

    # Temperature (Standard Thermal Zone)
    TEMP=\$(cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null | awk '{print \$1/1000}')
    if [ -z "\$TEMP" ]; then 
        # Fallback for some Pis
        TEMP=\$(vcgencmd measure_temp 2>/dev/null | egrep -o '[0-9]*\.[0-9]*')
    fi
    if [ -z "\$TEMP" ]; then TEMP=0; fi

    echo "\$CPU \$RAM \$TEMP"
}

# --- SPECIAL CAPABILITIES ---

perform_forensics() {
    echo "---PROCESSES---"
    ps -eo user,pid,%cpu,%mem,comm --sort=-%cpu | head -n 15
    echo "---NETWORK---"
    if command -v ss &> /dev/null; then ss -tupn; else netstat -tupn; fi
    echo "---AUTH---"
    tail -n 10 /var/log/auth.log 2>/dev/null || tail -n 10 /var/log/secure 2>/dev/null
    echo "---OPENFILES---"
    lsof -i -P -n | grep LISTEN | head -n 10
}

perform_recon() {
    local AID="\$1"
    # WIFI
    if command -v nmcli &> /dev/null; then
        local WIFIDATA=\$(nmcli -t -f SSID,BSSID,SIGNAL,SECURITY,CHAN dev wifi list | head -n 10 | awk -F: '{ printf "{\\"ssid\\":\\"%s\\",\\"bssid\\":\\"%s\\",\\"signal\\":%s,\\"security\\":\\"%s\\",\\"channel\\":%s,\\"actorName\\":\\"'$ACTOR_NAME'\\"},", \$1, \$2, \$3, \$4, \$5 }' | sed 's/,\$//')
        if [ ! -z "\$WIFIDATA" ]; then
            JSON=\$(jq -n --arg aid "\$AID" --argjson d "[\$WIFIDATA]" '{actorId: \$aid, type: "WIFI", data: \$d}')
            curl -s -X POST -H "Content-Type: application/json" -d "\$JSON" "\$SERVER/api/agent/recon"
        fi
    fi
}

check_sentinel() {
    local AID="\$1"
    local MODE=\$(cat "\$AGENT_DIR/.sentinel" 2>/dev/null)
    
    if [ "\$MODE" == "on" ]; then
        # Check for ESTABLISHED connections from non-local IPs
        local SUSPECTS=""
        if command -v ss &> /dev/null; then
            SUSPECTS=\$(ss -ntu state established | grep -v "127.0.0.1" | grep -v "::1" | grep -v "\$SERVER_URL" | awk '{print \$5}' | cut -d: -f1)
        else
            SUSPECTS=\$(netstat -nt | grep ESTABLISHED | grep -v "127.0.0.1" | awk '{print \$5}' | cut -d: -f1)
        fi

        if [ ! -z "\$SUSPECTS" ]; then
            for IP in \$SUSPECTS; do
                # Ignore self/server IP if possible (simple filter)
                if [[ "\$IP" != "0.0.0.0" && "\$IP" != "" ]]; then
                   PAYLOAD=\$(jq -n \\
                      --arg aid "\$AID" \\
                      --arg lvl "CRITICAL" \\
                      --arg proc "sentinel" \\
                      --arg msg "Unauthorized connection detected from \$IP" \\
                      --arg ip "\$IP" \\
                      '{actorId: \$aid, level: \$lvl, process: \$proc, message: \$msg, sourceIp: \$ip}')
                   curl -s -X POST -H "Content-Type: application/json" -d "\$PAYLOAD" "\$SERVER/api/agent/log"
                fi
            done
        fi
    fi
}

# --- INITIALIZATION ---
HWID=\$(get_hwid)
log "Agent Started. HWID: \$HWID"

# Validation
CUR_VER=\$(cat "$AGENT_DIR/.version" 2>/dev/null || echo "1.0.0")
INIT_RESP=\$(curl -s -G --data-urlencode "hwid=\$HWID" --data-urlencode "os=$(uname -r)" --data-urlencode "version=\$CUR_VER" "\$SERVER/api/agent/heartbeat")
INIT_STATUS=\$(echo "\$INIT_RESP" | jq -r '.status')

log "Server Response: \$INIT_STATUS"

if [ "\$INIT_STATUS" == "APPROVED" ]; then
    NEW_ID=\$(echo "\$INIT_RESP" | jq -r '.actorId')
    echo "\$NEW_ID" > "$AGENT_DIR/vpp-id"
    log "Device is APPROVED. ID: \$NEW_ID"
elif [ "\$INIT_STATUS" == "PENDING" ]; then
    rm -f "$AGENT_DIR/vpp-id"
fi

# Enrollment Loop
while [ ! -f "$AGENT_DIR/vpp-id" ]; do
    HWID=\$(get_hwid)
    RESP=\$(curl -s -G --data-urlencode "hwid=\$HWID" --data-urlencode "os=$(uname -r)" --data-urlencode "version=\$CUR_VER" "\$SERVER/api/agent/heartbeat")
    STATUS=\$(echo "\$RESP" | jq -r '.status')
    
    if [ "\$STATUS" == "APPROVED" ]; then 
        echo "\$RESP" | jq -r '.actorId' > "$AGENT_DIR/vpp-id"
        log "Agent Approved! ID: \$(cat $AGENT_DIR/vpp-id)"
    elif [ "\$STATUS" == "PENDING" ]; then
        log "Waiting for approval..."
    fi
    sleep 10
done

ACTOR_ID=\$(cat "$AGENT_DIR/vpp-id")
log "Entering Main Loop for Actor: \$ACTOR_ID"

# --- MAIN EVENT LOOP ---
while true; do
    # 1. Gather Metrics
    read CPU RAM TEMP <<< \$(get_metrics)
    
    # 2. Heartbeat with Metrics
    PAYLOAD=\$(jq -n \
        --arg id "\$ACTOR_ID" \
        --arg cpu "\$CPU" \
        --arg ram "\$RAM" \
        --arg temp "\$TEMP" \
        '{actorId: $id, cpu: $cpu, ram: $ram, temp: $temp}')
        
    OUT=\$(curl -s -X POST -H "Content-Type: application/json" -d "\$PAYLOAD" "\$SERVER/api/agent/scan")
    
    if [[ "\$OUT" == *"RESET"* ]]; then
        rm -f "$AGENT_DIR/vpp-id"
        exit 0
    fi

    # 3. Check Tasks
    TASKS=\$(curl -s -G --data-urlencode "actorId=\$ACTOR_ID" "\$SERVER/api/agent/tasks")
    
    # Process tasks if array is not empty
    echo "\$TASKS" | jq -c '.[]' 2>/dev/null | while read -r task; do
        JOB_ID=\$(echo "\$task" | jq -r '.id')
        CMD=\$(echo "\$task" | jq -r '.command')
        
        log "Executing Job \$JOB_ID: \$CMD"
        
        # SPECIAL COMMANDS
        RESULT=""
        STATUS="COMPLETED"
        
        if [[ "\$CMD" == "vpp-agent --forensic" ]]; then
            RESULT=\$(perform_forensics)
        elif [[ "\$CMD" == "vpp-agent --recon" ]]; then
            perform_recon "\$ACTOR_ID"
            RESULT="Recon data uploaded."
        elif [[ "\$CMD" == *"vpp-agent --set-sentinel"* ]]; then
            if [[ "\$CMD" == *"on"* ]]; then
                echo "on" > "\$AGENT_DIR/.sentinel"
                RESULT="Sentinel Mode ENABLED."
            else
                echo "off" > "\$AGENT_DIR/.sentinel"
                RESULT="Sentinel Mode DISABLED."
            fi
        else
            # Standard Shell Execution
            RESULT=\$(eval "\$CMD" 2>&1)
            EXIT_CODE=\$?
            if [ \$EXIT_CODE -ne 0 ]; then STATUS="FAILED"; fi
        fi
        
        # Report Result safely using jq to encode JSON
        REPORT=\$(jq -n --arg out "\$RESULT" --arg stat "\$STATUS" '{output: \$out, status: \$stat}')
        curl -s -X POST -H "Content-Type: application/json" -d "\$REPORT" "\$SERVER/api/agent/tasks/\$JOB_ID"
    done

    # 4. Security Checks
    check_sentinel "\$ACTOR_ID"

    # 5. Randomized Recon (every ~5 mins)
    if [ \$((RANDOM % 60)) -eq 0 ]; then
        perform_recon "\$ACTOR_ID"
    fi

    sleep 5
done
EOF_SRV

chmod +x $AGENT_DIR/agent.sh

cat <<EOF_SVC > /etc/systemd/system/vpp-agent.service
[Unit]
Description=VPP Agent
After=network.target

[Service]
ExecStart=$AGENT_DIR/agent.sh
Restart=always
User=root

[Install]
WantedBy=multi-user.target
EOF_SVC

systemctl daemon-reload
systemctl enable vpp-agent
systemctl restart vpp-agent

echo "[$(date)] [INSTALLER] Service Installed & Started."
`;
};
