
export const CURRENT_AGENT_VERSION = "2.3.1";

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

# Create Main Agent Script
cat <<'EOF_SRV' > $AGENT_DIR/agent.sh
#!/bin/bash
export PATH=$PATH:/usr/sbin:/sbin:/usr/bin:/bin:/usr/local/bin
AGENT_DIR="/opt/vpp-agent"
SERVER=$(cat "$AGENT_DIR/.server")
LOG_FILE="/var/log/vpp-agent.log"
ACTOR_NAME="Agent"

# Function to log messages
log() {
    echo "[$(date)] $1" >> $LOG_FILE
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
    # 1. Heartbeat
    PAYLOAD=\$(jq -n --arg id "\$ACTOR_ID" '{actorId: $id}')
    OUT=\$(curl -s -X POST -H "Content-Type: application/json" -d "\$PAYLOAD" "\$SERVER/api/agent/scan")
    
    if [[ "\$OUT" == *"RESET"* ]]; then
        rm -f "$AGENT_DIR/vpp-id"
        exit 0
    fi

    # 2. Check Tasks
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

    # 3. Randomized Recon (every ~5 mins)
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
