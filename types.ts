
export enum ActorStatus {
  ONLINE = 'ONLINE',
  OFFLINE = 'OFFLINE',
  COMPROMISED = 'COMPROMISED', // Active attack detected
  MAINTENANCE = 'MAINTENANCE',
  UNREACHABLE = 'UNREACHABLE' // Proxy is down
}

export interface ProxyGateway {
  id: string;
  name: string;
  location: string;
  status: 'ONLINE' | 'OFFLINE' | 'DEGRADED';
  ip: string; // Public IP talking to Cloud
  version: string;
  connectedActors: number;
  lat?: number; // Latitude for Map
  lng?: number; // Longitude for Map
}

export interface DevicePersona {
  id: string;
  name: string;
  icon: 'CAMERA' | 'PRINTER' | 'SERVER' | 'PLC' | 'ROUTER';
  description: string;
  openPorts: number[];
  banner: string; // Service banner (e.g., "Apache/2.4.41")
  macVendor?: string; // New: The hardware vendor to spoof (e.g., "Cisco Systems")
}

export interface HoneyFile {
  filename: string;
  path: string;
  type: 'CREDENTIALS' | 'CONFIG' | 'DOCUMENT';
  contentPreview: string;
  createdAt: Date;
}

export interface CloudTrap {
  id: string;
  name: string;
  description: string;
  serviceType: string; // e.g. 'Oracle DB', 'RDP', 'Industrial PLC'
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface ActiveTunnel {
  id: string;
  trap: CloudTrap;
  localPort: number; // The port opened on the Raspberry Pi
  remoteEndpoint: string; // The simulated cloud address
  status: 'STARTING' | 'ACTIVE' | 'STOPPING';
  bytesTransferred: number;
  uptimeSeconds: number;
}

export interface Actor {
  id: string;
  proxyId: string;
  name: string;
  localIp: string; // Internal Network IP
  status: ActorStatus;
  lastSeen: Date;
  osVersion: string;
  cpuLoad: number;
  memoryUsage: number;
  temperature?: number; // New field for real device temp
  activeTools: string[]; // e.g., 'tcpdump', 'cowrie'
  agentVersion: string; // Renamed from protocolVersion to match backend
  deployedHoneyFiles?: HoneyFile[]; // New field for deception
  activeTunnels?: ActiveTunnel[]; // Socat tunnels to cloud
  persona?: DevicePersona; // The active "mask"
  // Wireless Capabilities
  hasWifi?: boolean;
  hasBluetooth?: boolean;
  wifiScanningEnabled?: boolean;
  bluetoothScanningEnabled?: boolean;
  // Security Features
  tcpSentinelEnabled?: boolean; // If true, alerts on ANY connection
  physicalAddress?: string; // New field for physical location
}

export enum LogLevel {
  INFO = 'INFO',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
  CRITICAL = 'CRITICAL' // Security Event
}

export interface LogEntry {
  id: string;
  timestamp: Date;
  actorId: string;
  proxyId: string;
  actorName: string;
  level: LogLevel;
  process: string; // e.g., 'sshd', 'kernel', 'udp_pot'
  message: string;
  sourceIp?: string; // The attacker's IP
}

export interface AiAnalysis {
  summary: string;
  threatLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  recommendedActions: string[];
}

// Enrollment Types

export enum ProvisioningStatus {
  WAITING_APPROVAL = 'WAITING_APPROVAL',
  PROVISIONING = 'PROVISIONING',
  READY = 'READY'
}

export interface PendingActor {
  id: string; // Temporary ID
  hwid: string; // Hardware ID / MAC
  detectedIp: string;
  detectedAt: Date;
  status: ProvisioningStatus;
  osVersion?: string; // New field for detected OS
  hostname?: string; // New field for detected hostname
}

// --- NEW: Security & Database Types ---

export type UserRole = 'SUPERADMIN' | 'ADMIN' | 'VIEWER';

export interface UserPreferences {
  topologyDismissed?: Record<string, number>; // actorId -> timestamp
}

export interface User {
  id: string;
  username: string;
  passwordHash: string; // In real app this is bcrypt
  role: UserRole;
  mfaEnabled: boolean;
  mfaSecret?: string;
  lastLogin?: Date;
  preferences?: UserPreferences;
}

export interface DbConfig {
  server: string;
  database: string;
  username: string;
  passwordEncrypted: string;
  isConnected: boolean;
}

// --- AI CONFIGURATION TYPES ---
export type AiProvider = 'GEMINI' | 'LOCAL';

export interface AiConfig {
  provider: AiProvider;
  modelName: string; // e.g. 'gemini-2.0-flash' or 'llama3'
  // Gemini Specific
  apiKey?: string;
  // Local Specific
  endpoint?: string; // e.g. 'http://localhost:11434/v1/chat/completions'
  authToken?: string; // Optional Bearer token
}

// --- SYSLOG CONFIGURATION TYPES ---
export interface SyslogConfig {
    host: string;
    port: number;
    enabled: boolean;
}

export interface SystemConfig {
  companyName: string;
  domain: string;
  logoUrl?: string;
  setupCompletedAt: string;
  aiConfig?: AiConfig; 
  syslogConfig?: SyslogConfig; // New field for Syslog
  targetAgentVersion?: string; // New field for dynamic version control
}

export interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
  isMfaVerified: boolean;
  requiresMfaSetup: boolean;
}

// --- Report Types ---

export interface ReportContent {
  totalEvents?: number;
  criticalEvents?: number;
  activeNodes?: number;
  compromisedNodes?: number;
  topAttackers?: { ip: string; count: number }[];
  summaryText: string;
  
  // For Manual/Filtered Reports
  customBody?: string;
  
  // Data Driven Incident Fields
  incidentFilters?: {
      targetActor?: string;
      attackerIp?: string;
      protocol?: string;
      dateRange?: string;
  };
  
  incidentDetails?: {
      incidentTime: string;
      vector: string;
      mitigation: string;
      // Derived from filters
      affectedSystems?: string[];
      eventCount?: number;
  };
  
  // New: Forensic Snapshot Data
  snapshotData?: ForensicSnapshot;
}

export interface Report {
  id: string;
  title: string;
  generatedBy: string;
  dateRange: string;
  createdAt: Date;
  type: 'SECURITY_AUDIT' | 'INCIDENT_LOG' | 'CUSTOM' | 'AI_INSIGHT' | 'FORENSIC_SNAPSHOT';
  status: 'READY' | 'GENERATING';
  content?: ReportContent; // JSON data for the report
}

export interface CommandJob {
  id: string;
  actorId: string;
  command: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  output?: string;
  createdAt: Date;
  updatedAt: Date;
}

// --- Wireless Recon Types ---

export interface WifiNetwork {
  id: string;
  ssid: string;
  bssid: string;
  signalStrength: number; // dBm
  security: 'OPEN' | 'WPA2' | 'WPA3' | 'WEP';
  channel: number;
  actorId: string;
  actorName: string;
  lastSeen: Date;
}

export interface BluetoothDevice {
  id: string;
  name: string;
  mac: string;
  rssi: number; // dBm
  type: 'BLE' | 'CLASSIC' | 'AUDIO';
  actorId: string;
  actorName: string;
  lastSeen: Date;
}

// --- NEW: Forensic Types ---
export interface ForensicProcess {
    pid: string;
    user: string;
    cpu: string;
    mem: string;
    command: string;
    risk: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface ForensicSnapshot {
    timestamp: Date;
    processes: ForensicProcess[];
    connections: string[]; // Raw netstat output lines
    authLogs: string[]; // Last 10 lines of auth.log
    openFiles: string[]; // lsof output for suspicious processes
}

// --- NEW: Ghost Mode / Session Replay ---

export interface SessionFrame {
    time: number; // Milliseconds from start
    type: 'INPUT' | 'OUTPUT';
    data: string;
}

export interface AttackSession {
    id: string;
    actorId: string;
    attackerIp: string;
    protocol: 'SSH' | 'TELNET' | 'FTP' | 'REDIS' | 'HTTP' | 'VNC';
    startTime: Date;
    durationSeconds: number;
    frames: SessionFrame[];
}
