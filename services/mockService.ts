



import { Actor, ActorStatus, LogEntry, LogLevel, ProxyGateway, CloudTrap, ActiveTunnel, PendingActor, ProvisioningStatus, DevicePersona, WifiNetwork, BluetoothDevice } from '../types';

const LOCATIONS = ['Tel Aviv HQ', 'New York Branch', 'London DC', 'Frankfurt AWS'];
const PROCESSES = ['sshd', 'kernel', 'vpp-agent', 'udp_pot', 'cowrie'];

export const generateGateways = (): ProxyGateway[] => {
  return [
    {
      id: 'gw-tlv-01',
      name: 'TLV-Office-Proxy',
      location: 'Tel Aviv, IL',
      status: 'ONLINE',
      ip: '82.166.x.x',
      version: 'VPP-Proxy-2.1.0',
      connectedActors: 0,
      lat: 32.0853,
      lng: 34.7818
    },
    {
      id: 'gw-nyc-01',
      name: 'NYC-Finance-Proxy',
      location: 'New York, US',
      status: 'ONLINE',
      ip: '142.250.x.x',
      version: 'VPP-Proxy-2.1.0',
      connectedActors: 0,
      lat: 40.7128,
      lng: -74.0060
    },
    {
      id: 'gw-ldn-02',
      name: 'LDN-Cloud-Relay',
      location: 'London, UK',
      status: 'DEGRADED',
      ip: '52.95.x.x',
      version: 'VPP-Proxy-2.0.9',
      connectedActors: 0,
      lat: 51.5074,
      lng: -0.1278
    },
    {
        id: 'gw-sgp-01',
        name: 'SGP-APAC-Hub',
        location: 'Singapore, SG',
        status: 'OFFLINE',
        ip: '13.212.x.x',
        version: 'VPP-Proxy-2.0.0',
        connectedActors: 0,
        lat: 1.3521,
        lng: 103.8198
    }
  ];
};

export const AVAILABLE_PERSONAS: DevicePersona[] = [
    { id: 'pers-linux', name: 'Generic Linux Server', icon: 'SERVER', description: 'Standard Ubuntu 20.04 LTS footprint.', openPorts: [22, 80], banner: 'Ubuntu SSHD 8.2' },
    { id: 'pers-cam', name: 'Axis Security Camera', icon: 'CAMERA', description: 'Emulates an IP Camera web interface.', openPorts: [80, 554], banner: 'Axis Network Camera 2.1' },
    { id: 'pers-printer', name: 'HP Enterprise Printer', icon: 'PRINTER', description: 'Office printer with exposed admin console.', openPorts: [80, 631, 9100], banner: 'HP JetDirect' },
    { id: 'pers-plc', name: 'Siemens S7-1200', icon: 'PLC', description: 'Industrial Controller (ICS/SCADA).', openPorts: [102, 502], banner: 'Siemens S7 Comm' },
    { id: 'pers-router', name: 'Cisco ISR Router', icon: 'ROUTER', description: 'Edge router with telnet enabled.', openPorts: [22, 23, 80], banner: 'Cisco IOS 15.1' }
];

export const generateInitialActors = (gateways: ProxyGateway[]): Actor[] => {
  const actors: Actor[] = [];
  
  gateways.forEach((gw, idx) => {
    // Generate 40-60 actors per gateway to simulate scale (Total ~150-200)
    const count = 40 + Math.floor(Math.random() * 20);
    for (let i = 0; i < count; i++) {
      const type = Math.random();
      let namePrefix = 'Node';
      let os = 'Ubuntu 22.04 LTS';
      
      if (type > 0.8) {
          namePrefix = 'Pi';
          os = 'Raspbian GNU/Linux 11 (bullseye)';
      } else if (type > 0.5) {
          namePrefix = 'Debian';
          os = 'Debian 11 (bullseye)';
      }

      actors.push({
        id: `puppet-${gw.id}-${i}`,
        proxyId: gw.id,
        name: `${namePrefix}-${gw.location.split(' ')[0].substring(0,3)}-${100 + i}`,
        localIp: `192.168.${10 + idx}.${100 + i}`,
        status: gw.status === 'OFFLINE' ? ActorStatus.UNREACHABLE : (Math.random() > 0.95 ? ActorStatus.COMPROMISED : ActorStatus.ONLINE),
        lastSeen: new Date(),
        osVersion: os,
        cpuLoad: Math.floor(Math.random() * 30) + 5,
        memoryUsage: Math.floor(Math.random() * 40) + 20,
        activeTools: ['vpp-agent', 'tcpdump'],
        protocolVersion: 'VPP-1.2',
        activeTunnels: [],
        deployedHoneyFiles: [],
        persona: AVAILABLE_PERSONAS[0],
        hasWifi: Math.random() > 0.5,
        hasBluetooth: Math.random() > 0.6,
        tcpSentinelEnabled: false
      });
    }
  });
  
  return actors;
};

export const generateRandomLog = (actors: Actor[]): LogEntry => {
  const actor = actors[Math.floor(Math.random() * actors.length)];
  const isAttack = Math.random() > 0.7;
  
  let level = LogLevel.INFO;
  let process = PROCESSES[Math.floor(Math.random() * PROCESSES.length)];
  let message = "VPP Heartbeat ack";
  let sourceIp = undefined;

  // --- NEW: SENTINEL MODE LOGIC ---
  if (actor.tcpSentinelEnabled && Math.random() > 0.5) {
      // If Sentinel enabled, ANY random connection attempt is critical
      level = LogLevel.CRITICAL;
      process = 'kernel'; // or firewall
      sourceIp = `${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
      const dstPort = Math.random() > 0.5 ? 22 : 443;
      message = `[SENTINEL ALERT] Inbound TCP Connection detected from ${sourceIp}:${Math.floor(Math.random()*60000)} -> :${dstPort} [SYN]`;
      
      // Auto-compromise state in simulation for effect
      if (actor.status === 'ONLINE') actor.status = ActorStatus.COMPROMISED;
  }
  else if (isAttack) {
    level = Math.random() > 0.5 ? LogLevel.WARNING : LogLevel.CRITICAL;
    process = 'sshd';
    const attackTypes = [
      "Failed password for invalid user admin",
      "Connection closed by 192.168.x.x port 44332 [preauth]",
      "Did not receive identification string from remote host",
      "Invalid user support from 103.2.x.x"
    ];
    message = attackTypes[Math.floor(Math.random() * attackTypes.length)];
    sourceIp = `${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  } else if (Math.random() > 0.9) {
    level = LogLevel.ERROR;
    message = "VPP-Agent: Proxy connection timeout - retrying";
  }

  // Simulate socat log occasionally
  if (Math.random() > 0.95 && actor.activeTunnels && actor.activeTunnels.length > 0) {
      process = 'socat';
      level = LogLevel.INFO;
      message = `Redirection: Transferred ${Math.floor(Math.random() * 500)} bytes to Cloud Trap`;
  }

  return {
    id: Math.random().toString(36).substring(7),
    timestamp: new Date(),
    actorId: actor.id,
    proxyId: actor.proxyId,
    actorName: actor.name,
    level,
    process,
    message,
    sourceIp
  };
};

export const executeRemoteCommand = async (actorId: string, command: string): Promise<string> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      if (command.startsWith('tcpdump')) {
        resolve(`[${actorId}] tcpdump: listening on eth0, capture size 262144 bytes\nCaptured 0 packets.`);
      } else if (command === 'status') {
        resolve(`[${actorId}] VPP Agent: Connected\nProxy Latency: 12ms\nUptime: 14 days`);
      } else if (command === 'reboot') {
        resolve(`[${actorId}] System is going down for reboot NOW!`);
      } else if (command.startsWith('socat')) {
        resolve(`[${actorId}] socat: Tunnel established successfully.`);
      } else if (command.includes('killall') || command.includes('pkill')) {
        resolve(`[${actorId}] Process terminated.`);
      } else if (command.startsWith('vpp-agent --set-persona')) {
        resolve(`Updating system persona...\nPersona configuration applied successfully.`);
      } else if (command.includes('vpp-agent --factory-reset')) {
        resolve(`
[VPP-AGENT] Initiating Factory Reset...
[INFO] Stopping network services... OK
[INFO] Clearing tunnel configurations... OK
[INFO] Removing deception artifacts... OK
[INFO] Restoring default iptables policies... OK
[VPP-AGENT] Reset Complete. Agent is now in base state.
        `);
      } else if (command.includes('vpp-agent --update')) {
          resolve(`
[VPP-UPDATER] Checking for updates...
[INFO] Found version: v2.0.0-stable
[INFO] Downloading package (4.2MB)... [====================] 100%
[INFO] Verifying signature... OK
[INFO] Stopping vpp-agent service...
[INFO] Installing new binaries...
[INFO] Restarting service...
[VPP-AGENT] Update Successful. Running version v2.0.0.
          `);
      } else if (command.includes('apt-get update')) {
        resolve(`
Hit:1 http://archive.ubuntu.com/ubuntu jammy InRelease
Get:2 http://security.ubuntu.com/ubuntu jammy-security InRelease [110 kB]
Get:3 http://archive.ubuntu.com/ubuntu jammy-updates InRelease [119 kB]
Fetched 229 kB in 2s (115 kB/s)
Reading package lists... Done
[VPP-PROXY] Cached hits: 3, Upstream hits: 2
        `);
      } else if (command.includes('apt-get dist-upgrade')) {
        resolve(`
Reading package lists... Done
Building dependency tree... Done
Reading state information... Done
Calculating upgrade... Done
The following packages will be upgraded:
  libc-bin libc6 locales openssh-client openssh-server openssh-sftp-server
6 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.
Need to get 4,320 kB of archives.
After this operation, 4,096 B of additional disk space will be used.
Get:1 http://archive.ubuntu.com/ubuntu jammy/main libc6 2.31-13 [2,752 kB]
Fetched 4,320 kB in 4s (1,080 kB/s)
[VPP-PROXY] Streamed 4.3 MB from Management Cache
(Reading database ... 45021 files and directories currently installed.)
Preparing to unpack .../libc6_2.31-13.deb ...
Unpacking libc6 ...
Setting up libc6 ...
Processing triggers for man-db ...
[OK] System Upgrade Complete.
        `);
      } else if (command.startsWith('vpp-route')) {
          resolve(`Routing table updated.`);
      } else if (command === 'hostname -I') {
          resolve(`192.168.1.101`);
      } else {
        resolve(`[${actorId}] bash: ${command}: command not found`);
      }
    }, 800 + Math.random() * 1000);
  });
};

// NEW: Cloud Trap Service Logic

export const getAvailableCloudTraps = (): CloudTrap[] => [
    { id: 'trap-oracle-01', name: 'Legacy Oracle DB', serviceType: 'Oracle TNS', description: 'Emulates an unpatched Oracle 11g instance.', riskLevel: 'HIGH' },
    { id: 'trap-win-rdp', name: 'Windows 2019 RDP', serviceType: 'RDP', description: 'High interaction Windows server with weak admin creds.', riskLevel: 'HIGH' },
    { id: 'trap-scada-plc', name: 'Siemens S7 PLC', serviceType: 'Industrial ICS', description: 'Simulated industrial controller for SCADA networks.', riskLevel: 'MEDIUM' },
    { id: 'trap-elastic', name: 'Open ElasticSearch', serviceType: 'ElasticSearch', description: 'Unsecured ES cluster with fake PII data.', riskLevel: 'MEDIUM' }
];

export const toggleTunnelMock = async (actor: Actor, trapId: string, localPort: number): Promise<ActiveTunnel> => {
    return new Promise((resolve) => {
        setTimeout(() => {
            const trap = getAvailableCloudTraps().find(t => t.id === trapId)!;
            resolve({
                id: `tun-${Math.random().toString(36).substr(2,5)}`,
                trap,
                localPort,
                remoteEndpoint: `cloud-trap-vnet.internal:${localPort + 10000}`,
                status: 'ACTIVE',
                bytesTransferred: 0,
                uptimeSeconds: 0
            });
        }, 1500);
    });
};

// NEW: Enrollment Mock Logic

export const generateEnrollmentToken = () => {
    return `vpp_${Math.random().toString(36).substr(2, 9)}_${Date.now()}`;
};

export const simulateDeviceCallHome = async (): Promise<PendingActor> => {
    return new Promise((resolve) => {
        setTimeout(() => {
            const hex = '0123456789ABCDEF';
            let mac = '';
            for (let i = 0; i < 6; i++) {
                mac += hex.charAt(Math.floor(Math.random() * 16));
                mac += hex.charAt(Math.floor(Math.random() * 16));
                if (i < 5) mac += ':';
            }
            
            resolve({
                id: `temp_${Math.random().toString(36).substr(2, 6)}`,
                hwid: mac,
                detectedIp: `10.0.${Math.floor(Math.random() * 20)}.${Math.floor(Math.random() * 255)}`,
                detectedAt: new Date(),
                status: ProvisioningStatus.WAITING_APPROVAL
            });
        }, 3000); // Takes 3 seconds to "boot" and connect
    });
};

// NEW: Wireless Recon Mock Data

export const generateMockWifi = (actors: Actor[]): WifiNetwork[] => {
    const networks: WifiNetwork[] = [];
    const ssids = ['Corp-Guest', 'Starbucks_Free_WiFi', 'iPhone (13)', 'HP-Print-35', 'Unknown Network', 'D-Link_2.4', 'xfinitywifi'];
    
    // Safety check in case actors is undefined or empty
    const availableActors = actors.filter(a => a.status === 'ONLINE');
    if (availableActors.length === 0) return [];

    availableActors.forEach(actor => {
        const count = Math.floor(Math.random() * 5);
        for(let i=0; i<count; i++) {
            networks.push({
                id: `wifi-${Math.random().toString(36).substr(2,6)}`,
                ssid: ssids[Math.floor(Math.random() * ssids.length)],
                bssid: `XX:XX:XX:${Math.floor(Math.random()*99)}:${Math.floor(Math.random()*99)}`,
                signalStrength: -40 - Math.floor(Math.random() * 50),
                security: Math.random() > 0.8 ? 'OPEN' : 'WPA2',
                channel: Math.floor(Math.random() * 11) + 1,
                actorId: actor.id,
                actorName: actor.name,
                lastSeen: new Date()
            });
        }
    });
    return networks;
};

export const generateMockBluetooth = (actors: Actor[]): BluetoothDevice[] => {
     const devices: BluetoothDevice[] = [];
     const names = ['JBL Flip 5', 'AirPods Pro', 'Fitbit Charge 5', 'Unknown', 'Samsung TV', 'Tile Tracker'];
     
     const availableActors = actors.filter(a => a.status === 'ONLINE');
     if (availableActors.length === 0) return [];

     availableActors.forEach(actor => {
        const count = Math.floor(Math.random() * 4);
        for(let i=0; i<count; i++) {
            devices.push({
                id: `bt-${Math.random().toString(36).substr(2,6)}`,
                name: names[Math.floor(Math.random() * names.length)],
                mac: `AA:BB:CC:${Math.floor(Math.random()*99)}:${Math.floor(Math.random()*99)}`,
                rssi: -50 - Math.floor(Math.random() * 40),
                type: Math.random() > 0.5 ? 'BLE' : 'CLASSIC',
                actorId: actor.id,
                actorName: actor.name,
                lastSeen: new Date()
            });
        }
    });
    return devices;
};