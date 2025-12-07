export const generateAgentScript = (serverUrl, token) => {
  return `#!/bin/bash
TOKEN="${token}"
SERVER_URL="${serverUrl}"
AGENT_DIR="/opt/vpp-agent"

# Root Check
if [ "$EUID" -ne 0 ]; then 
  echo "Please run as root (sudo)."
  exit 1
fi

# Dependencies Installation
echo "Checking dependencies..."
if command -v apt-get &> /dev/null; then 
  export DEBIAN_FRONTEND=noninteractive
  # Always try to update and install to ensure versions are correct
  if ! command -v jq &> /dev/null || ! command -v socat &> /dev/null; then
      echo "Installing jq and socat..."
      apt-get update -qq && apt-get install -y jq curl socat lsof network-manager bluez -qq
  fi
fi

# Fallback: Check if jq actually exists now
if ! command -v jq &> /dev/null; then
    echo "❌ Error: 'jq' could not be installed. Agent requires jq to parse JSON."
    exit 1
fi

# HWID Detection
HWID=$(cat /sys/class/net/eth0/address 2>/dev/null || cat /sys/class/net/wlan0/address 2>/dev/null || hostname)
OS_NAME="Linux"
if [ -f /etc/os-release ]; then 
  . /etc/os-release
  if [ -n "$PRETTY_NAME" ]; then OS_NAME="$PRETTY_NAME"; fi
fi

# Wireless Cap Check
HAS_WIFI=false
HAS_BT=false
if command -v nmcli &> /dev/null && nmcli device | grep -q wifi; then HAS_WIFI=true; fi
if command -v hcitool &> /dev/null && hcitool dev | grep -q hci; then HAS_BT=true; fi

# Setup Directories
mkdir -p $AGENT_DIR
echo "$SERVER_URL" > $AGENT_DIR/.server
echo "$TOKEN" > $AGENT_DIR/.token

# Notify Server
curl -s -o /dev/null -H "X-VPP-HWID: $HWID" -H "X-VPP-OS: $OS_NAME" -H "X-VPP-WIFI: $HAS_WIFI" -H "X-VPP-BT: $HAS_BT" "$SERVER_URL/api/enroll/config/$TOKEN"

# Create Trap Relay Script
cat <<'EOF_RELAY' > $AGENT_DIR/trap_relay.sh
#!/bin/bash
SERVER=$(cat /opt/vpp-agent/.server)
AGENT_DIR="/opt/vpp-agent"
ACTOR_ID=$(cat "$AGENT_DIR/vpp-id" 2>/dev/null || echo "unknown")

# Init Session
SID_JSON=$(curl -s -X POST "$SERVER/api/trap/init")
SID=$(echo "$SID_JSON" | jq -r .sessionId)
BANNER=$(echo "$SID_JSON" | jq -r .banner)

if [ "$SID" == "null" ] || [ -z "$SID" ]; then
    SID="offline-$(date +%s)"
    BANNER="220 Service Ready"
fi

echo -ne "$BANNER"

# Loop to read input lines and forward to server
while IFS= read -r LINE || [ -n "$LINE" ]; do 
  # Safe JSON construction using jq to handle escaping
  PAYLOAD=$(jq -n --arg sid "$SID" --arg input "$LINE" --arg aid "$ACTOR_ID" '{sessionId: $sid, input: $input, actorId: $aid}')
  
  # Send to server only if payload is generated
  if [ ! -z "$PAYLOAD" ]; then
      RESP_JSON=$(curl -s -X POST -H "Content-Type: application/json" -d "$PAYLOAD" "$SERVER/api/trap/interact")
      RESP=$(echo "$RESP_JSON" | jq -r .response)
      
      if [ "$RESP" == "null" ] || [ -z "$RESP" ]; then
          echo -ne "500 Internal Error\r\n"
      else
          echo -ne "$RESP"
      fi
  fi
done
EOF_RELAY

chmod +x $AGENT_DIR/trap_relay.sh

# Create Main Agent Binary
cat <<'EOF_BIN' > /usr/local/bin/vpp-agent
#!/bin/bash
AGENT_DIR="/opt/vpp-agent"
SERVER=$(cat "$AGENT_DIR/.server")

if [[ "$1" == "--scan-wireless" ]]; then
    WIFI_JSON="[]"
    BT_JSON="[]"
    if command -v nmcli &> /dev/null; then
         nmcli device wifi rescan 2>/dev/null
         sleep 3
         RAW_WIFI=$(nmcli -t -f SSID,BSSID,SIGNAL,SECURITY dev wifi list 2>/dev/null)
         if [ ! -z "$RAW_WIFI" ]; then 
            WIFI_JSON=$(echo "$RAW_WIFI" | jq -R -s -c 'split("\\n")[:-1] | map(split(":")) | map({ssid: .[0], bssid: (.[1]+":"+.[2]+":"+.[3]+":"+.[4]+":"+.[5]+":"+.[6]), signal: .[7], security: .[8]})')
         fi
    fi
    ACTOR_ID=$(cat "$AGENT_DIR/vpp-id" 2>/dev/null)
    if [ ! -z "$ACTOR_ID" ]; then
        PAYLOAD=$(jq -n -c --arg aid "$ACTOR_ID" --argjson wifi "$WIFI_JSON" --argjson bt "$BT_JSON" '{actorId: $aid, wifi: $wifi, bluetooth: $bt}')
        curl -s -X POST -H "Content-Type: application/json" -d "$PAYLOAD" "$SERVER/api/agent/scan-results"
    fi
elif [[ "$1" == "--forensic" ]]; then
    echo "---PROCESSES---"
    ps -aux --sort=-%cpu | head -20
    echo "---NETWORK---"
    ss -tupn
    echo "---AUTH---"
    if [ -f /var/log/auth.log ]; then tail -n 20 /var/log/auth.log; fi
    echo "---OPENFILES---"
    lsof -i -P -n 2>/dev/null | head -50
elif [[ "$1" == "--set-sentinel" ]]; then
    if [ "$2" == "on" ]; then
        touch "$AGENT_DIR/.sentinel"
        echo "[VPP] Sentinel Mode ENABLED"
    else
        rm -f "$AGENT_DIR/.sentinel"
        echo "[VPP] Sentinel Mode DISABLED"
    fi
elif [[ "$1" == "--update" ]]; then
    echo "[VPP] Mock Update Triggered."
else 
    echo "VPP Agent OK"
fi
EOF_BIN

chmod +x /usr/local/bin/vpp-agent

# Create Service Script
cat <<'EOF_SRV' > $AGENT_DIR/agent.sh
#!/bin/bash
export PATH=$PATH:/usr/sbin:/sbin:/usr/bin:/bin:/usr/local/bin
SERVER=$(cat /opt/vpp-agent/.server)
AGENT_DIR="/opt/vpp-agent"

# Enrollment Loop
while [ ! -f "$AGENT_DIR/vpp-id" ]; do
    HWID=$(cat /sys/class/net/eth0/address 2>/dev/null || hostname)
    RESP=$(curl -s -G --data-urlencode "hwid=$HWID" "$SERVER/api/agent/heartbeat")
    STATUS=$(echo "$RESP" | jq -r '.status')
    if [ "$STATUS" == "APPROVED" ]; then 
        echo "$RESP" | jq -r '.actorId' > "$AGENT_DIR/vpp-id"
    fi
    sleep 10
done

ACTOR_ID=$(cat "$AGENT_DIR/vpp-id")

# Sentinel Monitor Logic (Background)
# Monitors logs for inbound connections when in paranoid mode
(
    tail -F /var/log/syslog /var/log/kern.log /var/log/messages 2>/dev/null | while read LOGLINE; do
        if [ -f "$AGENT_DIR/.sentinel" ]; then
            # Look for Connection Attempts (UFW, IPTables logs usually contain SRC= and PROTO=TCP)
            if echo "$LOGLINE" | grep -q "SRC="; then
                # Extract Source IP (simple grep)
                SRC_IP=$(echo "$LOGLINE" | grep -oE 'SRC=[0-9.]+' | cut -d= -f2)
                if [ ! -z "$SRC_IP" ]; then
                    PAYLOAD=$(jq -n --arg sid "SENTINEL" --arg input "SYN_DETECTED_FROM_$SRC_IP" --arg aid "$ACTOR_ID" '{sessionId: $sid, input: $input, actorId: $aid}')
                    curl -s -X POST -H "Content-Type: application/json" -d "$PAYLOAD" "$SERVER/api/trap/interact" >/dev/null
                fi
            fi
        fi
    done
) &

# Main Loop
while true; do
    CPU=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d. -f1)
    RAM=$(free | grep Mem | awk '{print $3/$2 * 100.0}')
    
    PAYLOAD=$(jq -n -c --arg aid "$ACTOR_ID" --arg cpu "$CPU" --arg ram "$RAM" '{actorId: $aid, cpu: $cpu, ram: $ram, temp: 0}')
    curl -s -X POST -H "Content-Type: application/json" -d "$PAYLOAD" "$SERVER/api/agent/scan" >/dev/null
    
    JOB_JSON=$(curl -s "$SERVER/api/agent/commands?actorId=$ACTOR_ID")
    JOB_ID=$(echo "$JOB_JSON" | jq -r '.[0].id // empty')
    
    if [ ! -z "$JOB_ID" ]; then
        CMD=$(echo "$JOB_JSON" | jq -r '.[0].command')
        # Ack start - USE JQ TO PREVENT SYNTAX ERROR
        jq -n -c --arg jid "$JOB_ID" --arg stat "RUNNING" '{jobId: $jid, status: $stat}' | \
        curl -s -X POST -H "Content-Type: application/json" -d @- "$SERVER/api/agent/result"
        
        OUTPUT=$(eval "$CMD" 2>&1)
        
        # Send result
        jq -n -c --arg jid "$JOB_ID" --arg out "$OUTPUT" '{jobId: $jid, status: "COMPLETED", output: $out}' | \
        curl -s -X POST -H "Content-Type: application/json" -d @- "$SERVER/api/agent/result"
    fi
    sleep 5
done
EOF_SRV

chmod +x $AGENT_DIR/agent.sh

# Create Systemd Service
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

# Start Service
systemctl daemon-reload
systemctl enable vpp-agent
systemctl restart vpp-agent

echo "VPP Agent Installed Successfully."
`;
};