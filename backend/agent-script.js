
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

HWID=\$(get_hwid)
log "Agent Started. HWID: \$HWID"

# --- VALIDATION PHASE ---
# Always check status with server on startup to handle stale IDs
CUR_VER=\$(cat "$AGENT_DIR/.version" 2>/dev/null || echo "1.0.0")
log "Contacting Server at \$SERVER/api/agent/heartbeat..."

INIT_RESP=\$(curl -s -G --data-urlencode "hwid=\$HWID" --data-urlencode "os=$(uname -r)" --data-urlencode "version=\$CUR_VER" "\$SERVER/api/agent/heartbeat")
INIT_STATUS=\$(echo "\$INIT_RESP" | jq -r '.status')

log "Server Response: \$INIT_STATUS"

if [ "\$INIT_STATUS" == "APPROVED" ]; then
    NEW_ID=\$(echo "\$INIT_RESP" | jq -r '.actorId')
    echo "\$NEW_ID" > "$AGENT_DIR/vpp-id"
    log "Device is APPROVED. ID: \$NEW_ID"
elif [ "\$INIT_STATUS" == "PENDING" ]; then
    log "Device is PENDING approval. Clearing any local ID to force enrollment loop."
    rm -f "$AGENT_DIR/vpp-id"
else
    log "Unknown status or connection error: \$INIT_RESP"
fi

# --- ENROLLMENT LOOP ---
while [ ! -f "$AGENT_DIR/vpp-id" ]; do
    HWID=\$(get_hwid)
    CUR_VER=\$(cat "$AGENT_DIR/.version" 2>/dev/null || echo "1.0.0")
    
    RESP=\$(curl -s -G --data-urlencode "hwid=\$HWID" --data-urlencode "os=$(uname -r)" --data-urlencode "version=\$CUR_VER" "\$SERVER/api/agent/heartbeat")
    STATUS=\$(echo "\$RESP" | jq -r '.status')
    
    if [ "\$STATUS" == "APPROVED" ]; then 
        echo "\$RESP" | jq -r '.actorId' > "$AGENT_DIR/vpp-id"
        log "Agent Approved! ID: \$(cat $AGENT_DIR/vpp-id)"
    elif [ "\$STATUS" == "PENDING" ]; then
        log "Waiting for approval..."
    else
        log "Heartbeat failed. Retrying..."
    fi
    sleep 10
done

ACTOR_ID=\$(cat "$AGENT_DIR/vpp-id")
log "Entering Main Loop for Actor: \$ACTOR_ID"

# --- MAIN LOOP ---
while true; do
    # Scan/Heartbeat to C2
    PAYLOAD=\$(jq -n --arg id "\$ACTOR_ID" '{actorId: $id}')
    
    # We use a POST here as a keep-alive
    OUT=\$(curl -s -X POST -H "Content-Type: application/json" -d "\$PAYLOAD" "\$SERVER/api/agent/scan")
    
    # If C2 returns reset, clear ID
    if [[ "\$OUT" == *"RESET"* ]]; then
        log "Received Remote Reset command."
        rm -f "$AGENT_DIR/vpp-id"
        exit 0 # Service restart will trigger re-enrollment logic
    fi

    # Check for commands (Not fully implemented in bash script version yet, usually handled by separate poll)
    # For now, just keep alive
    
    sleep 5
done
EOF_SRV

chmod +x $AGENT_DIR/agent.sh

# Create Service
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
echo "[$(date)] [INSTALLER] Logs available at $LOG_FILE"
`;
};
