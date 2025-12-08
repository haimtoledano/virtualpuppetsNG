export const CURRENT_AGENT_VERSION = "2.3.1";

export const generateAgentScript = (serverUrl, token) => {
  return `#!/bin/bash
TOKEN="${token}"
SERVER_URL="${serverUrl}"
AGENT_DIR="/opt/vpp-agent"
VERSION="${CURRENT_AGENT_VERSION}"

echo "[VPP] Installer Starting..."
echo "[VPP] Server: $SERVER_URL"

# Root Check
if [ "$EUID" -ne 0 ]; then 
  echo "Please run as root (sudo)."
  exit 1
fi

# Dependencies Installation
if command -v apt-get &> /dev/null; then 
  export DEBIAN_FRONTEND=noninteractive
  if ! command -v jq &> /dev/null || ! command -v socat &> /dev/null; then
      echo "[VPP] Installing dependencies (jq, socat)..."
      apt-get update -qq && apt-get install -y jq curl socat lsof network-manager bluez -qq
  fi
fi

if ! command -v jq &> /dev/null; then
    echo "❌ Error: 'jq' is missing. Please install it manually."
    exit 1
fi

# Robust HWID Detection
HWID=""
# Try finding first non-loopback interface mac address
if command -v ip &> /dev/null; then
    HWID=$(ip link show | awk '/ether/ {print $2}' | head -n 1)
fi
# Fallback to sysfs
if [ -z "$HWID" ]; then
    HWID=$(cat /sys/class/net/eth0/address 2>/dev/null || cat /sys/class/net/wlan0/address 2>/dev/null)
fi
# Fallback to hostname
if [ -z "$HWID" ]; then
    HWID=$(hostname)
fi

echo "[VPP] Detected HWID: $HWID"

# OS Detection
OS_NAME="Linux"
if [ -f /etc/os-release ]; then 
  . /etc/os-release
  if [ -n "$PRETTY_NAME" ]; then OS_NAME="$PRETTY_NAME"; fi
fi

# Setup Directories
mkdir -p $AGENT_DIR
echo "$SERVER_URL" > $AGENT_DIR/.server
echo "$TOKEN" > $AGENT_DIR/.token
echo "$VERSION" > $AGENT_DIR/.version

# Connectivity Check
echo "[VPP] Validating connection to C2..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$SERVER_URL/api/health")
if [ "$HTTP_CODE" != "200" ]; then
    echo "⚠️  Warning: C2 Server health check returned $HTTP_CODE (Expected 200)."
    echo "    URL: $SERVER_URL/api/health"
else
    echo "✅ C2 Connection Verified."
fi

# Create Main Agent Script
cat <<'EOF_SRV' > $AGENT_DIR/agent.sh
#!/bin/bash
export PATH=$PATH:/usr/sbin:/sbin:/usr/bin:/bin:/usr/local/bin
AGENT_DIR="/opt/vpp-agent"
SERVER=$(cat "$AGENT_DIR/.server")
TOKEN=$(cat "$AGENT_DIR/.token")

# Enrollment Loop
while [ ! -f "$AGENT_DIR/vpp-id" ]; do
    HWID=$(ip link show | awk '/ether/ {print $2}' | head -n 1)
    if [ -z "$HWID" ]; then HWID=$(hostname); fi
    
    CUR_VER=$(cat "$AGENT_DIR/.version" 2>/dev/null || echo "1.0.0")
    
    # Heartbeat
    RESP=$(curl -s -G --data-urlencode "hwid=$HWID" --data-urlencode "version=$CUR_VER" "$SERVER/api/agent/heartbeat")
    
    # Check Status
    STATUS=$(echo "$RESP" | jq -r '.status')
    
    if [ "$STATUS" == "APPROVED" ]; then 
        echo "$RESP" | jq -r '.actorId' > "$AGENT_DIR/vpp-id"
        echo "[VPP] Agent Approved! ID: $(cat $AGENT_DIR/vpp-id)"
    elif [ "$STATUS" == "PENDING" ]; then
        echo "[VPP] Agent Pending Approval... ($HWID)"
    else
        echo "[VPP] Connection/Protocol Error. Retrying..."
    fi
    sleep 10
done

ACTOR_ID=$(cat "$AGENT_DIR/vpp-id")

# Main Loop
while true; do
    # Scan/Heartbeat to C2
    # Use jq to construct valid JSON safely to prevent syntax errors on server
    PAYLOAD=$(jq -n --arg id "$ACTOR_ID" '{actorId: $id}')
    curl -s -X POST -H "Content-Type: application/json" -d "$PAYLOAD" "$SERVER/api/agent/scan" >/dev/null
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

echo "✅ VPP Agent Service Installed & Started."
echo "   Go to the Dashboard to approve this device."
`;
};