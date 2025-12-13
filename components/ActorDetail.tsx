
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Actor, LogEntry, ActorStatus, AiAnalysis, ProxyGateway, HoneyFile, ActiveTunnel, DevicePersona, CommandJob, LogLevel, User, UserPreferences, ForensicSnapshot, ForensicProcess, AttackSession } from '../types';
import { executeRemoteCommand, getAvailableCloudTraps, toggleTunnelMock, AVAILABLE_PERSONAS, generateRandomLog, performForensicScan, getAttackSessions, deleteAttackSession } from '../services/mockService';
import { analyzeLogsWithAi, generateDeceptionContent } from '../services/aiService';
import { updateActorName, queueSystemCommand, getActorCommands, deleteActor, updateActorTunnels, updateActorPersona, resetActorStatus, resetActorToFactory, updateActorHoneyFiles, toggleActorSentinel, generateReport, deleteAttackSession as deleteAttackSessionProd, getAttackSessions as getAttackSessionsProd, toggleActorScanning } from '../services/dbService';
import Terminal from './Terminal';
import { Cpu, Wifi, Shield, Bot, ArrowLeft, BrainCircuit, Router, Network, FileCode, Check, Activity, X, Printer, Camera, Server, Edit2, Trash2, Loader, ShieldCheck, AlertOctagon, Skull, ArrowRight, Terminal as TerminalIcon, Globe, ScanSearch, Power, RefreshCw, History as HistoryIcon, Thermometer, RefreshCcw, Siren, Eye, Fingerprint, Info, Cable, Search, Lock, Zap, FileText, HardDrive, List, Play, Pause, FastForward, Rewind, Film, Database, Monitor, Save, Radio, Bluetooth, Hash, MapPin } from 'lucide-react';

interface ActorDetailProps {
  actor: Actor;
  gateway?: ProxyGateway;
  logs: LogEntry[];
  onBack: () => void;
  isProduction?: boolean;
  currentUser?: User | null;
  onUpdatePreferences?: (prefs: UserPreferences) => void;
  autoRunForensic?: boolean;
}

const DEFAULT_TRAP_PORTS: Record<string, number> = {
    'trap-oracle-01': 1521,
    'trap-win-rdp': 3389,
    'trap-scada-plc': 102,
    'trap-elastic': 9200,
    'trap-redis': 6379,
    'trap-mongo': 27017,
    'trap-ftp': 21,
    'trap-telnet': 23,
    'trap-vnc': 5900,
    'trap-postgres': 5432
};

const SERVER_TRAP_PORTS: Record<string, number> = {
    'trap-ftp': 10021,
    'trap-telnet': 10023,
    'trap-redis': 10079
};

// --- GAUGE COMPONENT ---
const Gauge = ({ value, label, type, unit = '%', icon: Icon }: { value: number, label: string, type: 'CPU' | 'RAM' | 'TEMP', unit?: string, icon?: any }) => {
    const radius = 24; 
    const circumference = 2 * Math.PI * radius;
    const progress = Math.min(Math.max(0, value), 100);
    const strokeDashoffset = circumference - (progress / 100) * circumference;
    
    const gradientId = `grad-${type}`;
    let colors = ['#3b82f6', '#60a5fa']; // Default Blue (RAM)
    
    if (type === 'CPU') {
         if (value < 50) colors = ['#10b981', '#34d399']; // Green
         else if (value < 80) colors = ['#f59e0b', '#fbbf24']; // Yellow
         else colors = ['#ef4444', '#f87171']; // Red
    } else if (type === 'TEMP') {
         if (value < 60) colors = ['#10b981', '#34d399']; // Green
         else if (value < 80) colors = ['#f97316', '#fb923c']; // Orange
         else colors = ['#ef4444', '#b91c1c']; // Red
    }
    
    return (
        <div className="flex flex-col items-center justify-center w-full">
            <div className="relative w-16 h-16 group">
                 {/* Glow Effect for High values */}
                 {(type !== 'RAM' && value > 80) && (
                     <div className="absolute inset-0 bg-red-500/20 blur-xl rounded-full animate-pulse"></div>
                 )}
                 
                 <svg className="w-full h-full transform -rotate-90 relative z-10">
                    <defs>
                        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor={colors[0]} />
                            <stop offset="100%" stopColor={colors[1]} />
                        </linearGradient>
                    </defs>
                    {/* Track */}
                    <circle cx="32" cy="32" r={radius} stroke="#1e293b" strokeWidth="6" fill="transparent" />
                    {/* Progress */}
                    <circle 
                        cx="32" cy="32" r={radius} 
                        stroke={`url(#${gradientId})`} 
                        strokeWidth="6" 
                        fill="transparent" 
                        strokeDasharray={circumference} 
                        strokeDashoffset={strokeDashoffset} 
                        strokeLinecap="round" 
                        className="transition-all duration-1000 ease-out shadow-lg"
                    />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center z-20">
                    {Icon && <Icon className="w-3.5 h-3.5 mb-0.5" style={{ color: colors[0] }} />}
                    <span className="text-[10px] font-bold text-slate-200 font-mono leading-none drop-shadow-md">{Math.round(value)}{unit}</span>
                </div>
            </div>
            <span className="text-[9px] font-bold text-slate-500 mt-2 uppercase tracking-wider group-hover:text-slate-300 transition-colors">{label}</span>
        </div>
    );
};


const ActorDetail: React.FC<ActorDetailProps> = ({ actor, gateway, logs: initialLogs, onBack, isProduction, currentUser, onUpdatePreferences, autoRunForensic }) => {
  const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'TERMINAL' | 'DECEPTION' | 'NETWORK' | 'FORENSICS'>('OVERVIEW');
  
  // Local log state for "Live Telemetry" injection
  const [localLogs, setLocalLogs] = useState<LogEntry[]>([]);
  const displayLogs = [...initialLogs, ...localLogs].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // IP State
  const [displayedLocalIp, setDisplayedLocalIp] = useState<string | null>(null);
  const [isScanningIp, setIsScanningIp] = useState(false);

  // Edit Name & Address State
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(actor.name);
  const [isEditingAddress, setIsEditingAddress] = useState(false);
  const [editedAddress, setEditedAddress] = useState(actor.physicalAddress || '');

  const [isDeleting, setIsDeleting] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  // Command & Terminal State
  const [commandHistory, setCommandHistory] = useState<CommandJob[]>([]);
  
  // AI Analysis State
  const [aiAnalysis, setAiAnalysis] = useState<AiAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  // Deception State
  const [honeyFiles, setHoneyFiles] = useState<HoneyFile[]>(actor.deployedHoneyFiles || []);
  const [isGeneratingDeception, setIsGeneratingDeception] = useState(false);

  // Tunnels State
  const [tunnels, setTunnels] = useState<ActiveTunnel[]>(actor.activeTunnels || []);
  const [pendingTunnel, setPendingTunnel] = useState<string | null>(null);
  
  // Custom Tunnel State
  const [customPort, setCustomPort] = useState('');
  const [customService, setCustomService] = useState('Custom App');

  // Persona State
  const [activePersona, setActivePersona] = useState<DevicePersona>(actor.persona || AVAILABLE_PERSONAS[0]);
  const [isChangingPersona, setIsChangingPersona] = useState(false);

  // Sentinel State
  const [isSentinelEnabled, setIsSentinelEnabled] = useState(actor.tcpSentinelEnabled || false);

  // Topology Reset State
  const [topologyDismissedTime, setTopologyDismissedTime] = useState<number>(0);

  // Port Scan State
  const [scannedPorts, setScannedPorts] = useState<{system: any[], application: any[]} | null>(null);
  const [isScanningPorts, setIsScanningPorts] = useState(false);

  // Scanning State
  const [wifiEnabled, setWifiEnabled] = useState(actor.wifiScanningEnabled || false);
  const [btEnabled, setBtEnabled] = useState(actor.bluetoothScanningEnabled || false);

  // FORENSICS STATE
  const [isGatheringForensics, setIsGatheringForensics] = useState(false);
  const [forensicData, setForensicData] = useState<ForensicSnapshot | null>(null);
  const [forensicView, setForensicView] = useState<'SNAPSHOT' | 'SESSIONS'>('SNAPSHOT');
  const [isSavingReport, setIsSavingReport] = useState(false);
  const hasAutoRunRef = useRef(false);
  
  // GHOST MODE / REPLAY STATE
  const [recordedSessions, setRecordedSessions] = useState<AttackSession[]>([]);
  const [activeSession, setActiveSession] = useState<AttackSession | null>(null);
  const [replayTime, setReplayTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [replayContent, setReplayContent] = useState('');
  const [isRefreshingSessions, setIsRefreshingSessions] = useState(false);
  const replayTimerRef = useRef<number | null>(null);

  // --- PERSISTENCE FOR TOPOLOGY VIEW ---
  useEffect(() => {
      if (currentUser?.preferences?.topologyDismissed?.[actor.id]) {
          setTopologyDismissedTime(currentUser.preferences.topologyDismissed[actor.id]);
      } else if (!isProduction) {
          // Fallback for Mock Mode
          const saved = localStorage.getItem(`vpp_topology_dismissed_mock_${actor.id}`);
          setTopologyDismissedTime(saved ? parseInt(saved, 10) : 0);
      } else {
          setTopologyDismissedTime(0);
      }
  }, [actor.id, currentUser, isProduction]);

  const handleClearTopology = () => {
      const now = Date.now();
      setTopologyDismissedTime(now);

      if (currentUser && onUpdatePreferences) {
          onUpdatePreferences({
              topologyDismissed: {
                  ...(currentUser.preferences?.topologyDismissed || {}),
                  [actor.id]: now
              }
          });
      } else if (!isProduction) {
          localStorage.setItem(`vpp_topology_dismissed_mock_${actor.id}`, now.toString());
      }
  };

  // --- MOCK SIMULATION FOR LIVE TELEMETRY ---
  useEffect(() => {
      if (isProduction) return;
      const interval = setInterval(() => {
          if (Math.random() > 0.6) {
              const mockLog = generateRandomLog([{...actor, tcpSentinelEnabled: isSentinelEnabled}]);
              setLocalLogs(prev => [mockLog, ...prev].slice(0, 50));
          }
      }, 3000);
      return () => clearInterval(interval);
  }, [isProduction, actor, isSentinelEnabled]);

  // --- AUTO SCAN INTERNAL IP ---
  useEffect(() => {
      handleFetchIp();
  }, [actor.id]);

  // Polling for command results
  useEffect(() => {
    if (!isProduction) return;

    const interval = setInterval(async () => {
        const cmds = await getActorCommands(actor.id);
        setCommandHistory(cmds);
        
        if (isScanningIp) {
            const ipJob = cmds.find(c => c.command === 'hostname -I' && c.status === 'COMPLETED');
            if (ipJob && ipJob.output) {
                const rawIp = ipJob.output.trim().split(' ')[0];
                if (rawIp && rawIp.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)) {
                     setDisplayedLocalIp(rawIp);
                     setIsScanningIp(false);
                }
            }
        }
    }, 2000);
    return () => clearInterval(interval);
  }, [actor.id, isScanningIp, isProduction]);

  // --- POLL FOR PORT SCAN RESULTS ---
  useEffect(() => {
      if (!isScanningPorts) return;
      
      const scanJob = commandHistory.find(c => c.command === 'ss -lntup' && c.status === 'COMPLETED');
      if (scanJob && scanJob.output) {
          parsePortScan(scanJob.output);
          setIsScanningPorts(false);
      }
  }, [commandHistory, isScanningPorts]);

  // --- LOAD SESSIONS WHEN TAB CHANGES ---
  const handleLoadSessions = async () => {
      setIsRefreshingSessions(true);
      
      if (isProduction) {
          // Use real API in production
          const sessions = await getAttackSessionsProd();
          setRecordedSessions(sessions);
      } else {
          // Mock mode
          const currentActorState = { 
              ...actor, 
              activeTunnels: tunnels, 
              persona: activePersona,
              status: (tunnels.length > 0 || isSentinelEnabled) ? ActorStatus.COMPROMISED : actor.status 
          };
          const sessions = await getAttackSessions(actor.id, currentActorState);
          setRecordedSessions(sessions);
      }
      setIsRefreshingSessions(false);
  };

  useEffect(() => {
      if (activeTab === 'FORENSICS' && forensicView === 'SESSIONS') {
          handleLoadSessions();
      }
  }, [activeTab, forensicView, actor.id, actor, tunnels, activePersona, isSentinelEnabled, isProduction]);

  // --- REPLAY LOGIC ---
  useEffect(() => {
      if (isPlaying && activeSession) {
          replayTimerRef.current = window.setInterval(() => {
              setReplayTime(prev => {
                  const nextTime = prev + (50 * replaySpeed); // 50ms steps * speed
                  if (nextTime >= (activeSession.durationSeconds * 1000)) {
                      setIsPlaying(false);
                      return activeSession.durationSeconds * 1000;
                  }
                  return nextTime;
              });
          }, 50);
      } else {
          if (replayTimerRef.current) clearInterval(replayTimerRef.current);
      }
      return () => { if (replayTimerRef.current) clearInterval(replayTimerRef.current); };
  }, [isPlaying, replaySpeed, activeSession]);

  useEffect(() => {
      if (activeSession) {
          // Reconstruct content based on time
          let content = '';
          const framesToRender = activeSession.frames.filter(f => f.time <= replayTime);
          framesToRender.forEach(f => {
              if (f.data === '\n') {
                  content += '\n';
              } else if (f.type === 'INPUT') {
                  content += f.data;
              } else {
                  content += f.data;
              }
          });
          setReplayContent(content);
      }
  }, [replayTime, activeSession]);

  // --- AUTO RUN FORENSIC LOGIC ---
  useEffect(() => {
      if (autoRunForensic && !hasAutoRunRef.current) {
          hasAutoRunRef.current = true;
          setActiveTab('FORENSICS');
          setForensicView('SNAPSHOT');
          // Add small delay to allow tab switch rendering
          setTimeout(() => handleForensicScan(), 100);
      }
  }, [autoRunForensic]);

  const handleFetchIp = async () => {
      let hasPending = false;
      if (commandHistory.some(c => c.command === 'hostname -I' && (c.status === 'PENDING' || c.status === 'RUNNING'))) {
          hasPending = true;
      }
      
      if (isProduction && !hasPending) {
          const remoteCmds = await getActorCommands(actor.id);
          if (remoteCmds.some(c => c.command === 'hostname -I' && (c.status === 'PENDING' || c.status === 'RUNNING'))) {
              hasPending = true;
              setCommandHistory(remoteCmds);
          }
      }

      if (hasPending) {
          setIsScanningIp(true);
          return;
      }

      setIsScanningIp(true);
      await handleCommand('hostname -I');
  };

  const handleCommand = async (cmd: string): Promise<string> => {
      let jobId = '';
      if (isProduction) {
          const id = await queueSystemCommand(actor.id, cmd);
          jobId = id || '';
      } else {
          jobId = `job-mock-${Date.now()}`;
          const newJob: CommandJob = {
              id: jobId,
              actorId: actor.id,
              command: cmd,
              status: 'RUNNING',
              createdAt: new Date(),
              updatedAt: new Date()
          };
          setCommandHistory(prev => [newJob, ...prev]);
          
          executeRemoteCommand(actor.id, cmd, actor).then(output => {
               setCommandHistory(prev => prev.map(job => 
                  job.id === newJob.id 
                  ? { ...job, status: 'COMPLETED', output } 
                  : job
               ));
               if (cmd === 'hostname -I') {
                   setDisplayedLocalIp(actor.localIp);
                   setIsScanningIp(false);
               }
          });
      }
      return jobId;
  };

  const handleScanPorts = async () => {
      setIsScanningPorts(true);
      setScannedPorts(null);
      await handleCommand('ss -lntup');
  };

  const parsePortScan = (output: string) => {
      const lines = output.split('\n');
      const systemMap = new Map<number, any>();
      const applicationMap = new Map<number, any>();

      const getServiceName = (p: number) => {
          if (p === 21) return 'FTP';
          if (p === 22) return 'SSH';
          if (p === 23) return 'Telnet';
          if (p === 53) return 'DNS';
          if (p === 80) return 'HTTP';
          if (p === 443) return 'HTTPS';
          if (p === 3000) return 'Grafana/Dev';
          if (p === 3306) return 'MySQL';
          if (p === 5432) return 'PostgreSQL';
          if (p === 6379) return 'Redis';
          if (p === 8080) return 'HTTP-Alt';
          return 'Unknown';
      };

      lines.forEach(line => {
          // Robust regex to capture protocol, bindIP, port, and process name (quoted or unquoted)
          const match = line.match(/^(udp|tcp)\s+\w+\s+\d+\s+\d+\s+([^\s:]+|\[.*?\]|.*?):(\d+)\s+.*users:\(\("?([^",]+)"?/);
          
          if (match) {
              const proto = match[1].toUpperCase();
              let bindIp = match[2];
              const port = parseInt(match[3]);
              let process = match[4];
              
              bindIp = bindIp.replace('[', '').replace(']', '');
              
              // Clean process name if regex caught trailing quote
              if (process.endsWith('"')) process = process.slice(0, -1);

              if (bindIp.startsWith('127.') || bindIp === '::1') return;

              const isApp = process.includes('socat') || process.includes('vpp-agent') || process.includes('python');
              const targetMap = isApp ? applicationMap : systemMap;

              // Service Name Logic
              let service = getServiceName(port);
              if (isApp) {
                   service = process.includes('socat') ? 'Tunnel' : 'Persona';
              } else if (service === 'Unknown') {
                   service = 'TCP/UDP Service';
              }

              let source = process;
              if (isApp) {
                   source = process.includes('socat') ? 'Tunnel' : 'Persona';
              }

              // Deduplication & Merging Logic
              if (targetMap.has(port)) {
                  const existing = targetMap.get(port);
                  // Merge Protocol if different (e.g. TCP + UDP -> TCP/UDP)
                  if (!existing.proto.includes(proto)) {
                      existing.proto += `/${proto}`;
                  }
              } else {
                  targetMap.set(port, { port, proto, service, source });
              }
          }
      });

      setScannedPorts({ 
          system: Array.from(systemMap.values()).sort((a,b) => a.port - b.port), 
          application: Array.from(applicationMap.values()).sort((a,b) => a.port - b.port) 
      });
  };

  const handleSaveName = async () => {
      if (editedName.trim() !== actor.name) {
          await updateActorName(actor.id, editedName);
          // In real implementation we'd refresh from parent, but simplified here:
          actor.name = editedName;
      }
      setIsEditingName(false);
  };

  const handleSaveAddress = async () => {
      // Create a specific update for address since updateActorName typically just does name
      // We will leverage a slightly more generic call structure or overload updateActorName if backend supports it
      // In this codebase, updateActorName calls `PUT /actors/:id` with `{name}`. 
      // We'll assume the backend route was updated to handle `{physicalAddress}` as well.
      
      try {
          await fetch(`/api/actors/${actor.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ physicalAddress: editedAddress })
          });
          actor.physicalAddress = editedAddress;
      } catch (e) {
          alert('Failed to save address');
      }
      setIsEditingAddress(false);
  };

  const handleDeleteActor = async () => {
      if (confirm(`Are you sure you want to decommission ${actor.name}? This will attempt to uninstall the agent from the device and then remove the record.`)) {
          setIsDeleting(true);
          try {
             if (actor.status === 'ONLINE' || actor.status === 'COMPROMISED') {
                 const uninstallCmd = `nohup bash -c "sleep 5; systemctl stop vpp-agent; systemctl disable vpp-agent; rm -f /etc/systemd/system/vpp-agent.service; systemctl daemon-reload; rm -rf /opt/vpp-agent" >/dev/null 2>&1 &`;
                 if (isProduction) {
                     await queueSystemCommand(actor.id, uninstallCmd);
                     await new Promise(resolve => setTimeout(resolve, 4000));
                 }
             }
             await deleteActor(actor.id);
             onBack();
          } catch (e) {
             alert("Delete failed, check console.");
          } finally {
             setIsDeleting(false);
          }
      }
  };

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    if (confirm("Permanently delete this recorded session?")) {
        // Optimistically remove from UI
        setRecordedSessions(prev => prev.filter(s => s.id !== sessionId));
        if (activeSession?.id === sessionId) setActiveSession(null);
        
        // Call service
        if (isProduction) {
            await deleteAttackSessionProd(sessionId);
        } else {
            await deleteAttackSession(sessionId);
        }
    }
  };

  const handleAiAnalyze = async () => {
      setIsAnalyzing(true);
      const result = await analyzeLogsWithAi(displayLogs, actor.status);
      setAiAnalysis(result);
      setIsAnalyzing(false);
  };

  const handleResetStatus = async () => {
      await resetActorStatus(actor.id);
      actor.status = ActorStatus.ONLINE;
  };

  const handleFactoryReset = async () => {
      if (!confirm(`Warning: This will clear all tunnels, deception files, and reset the agent state for ${actor.name}. Continue?`)) return;
      
      setIsResetting(true);
      if (isProduction) {
          await resetActorToFactory(actor.id);
      } else {
          await handleCommand('vpp-agent --factory-reset');
      }
      
      setTunnels([]);
      setHoneyFiles([]);
      actor.status = ActorStatus.ONLINE;
      setIsSentinelEnabled(false);
      handleClearTopology();
      
      setTimeout(() => setIsResetting(false), 2000);
  };

  const handleDeployDeception = async (type: 'CREDENTIALS' | 'CONFIG') => {
      setIsGeneratingDeception(true);
      const file = await generateDeceptionContent(type);
      if (file) {
          const targetPath = `/home/${file.filename}`;
          const updatedFile = { ...file, path: '/home/' };
          const newFilesList = [...honeyFiles, updatedFile];
          setHoneyFiles(newFilesList);
          
          if (isProduction) await updateActorHoneyFiles(actor.id, newFilesList);
          await handleCommand(`echo "${file.contentPreview}" > ${targetPath}`);
      }
      setIsGeneratingDeception(false);
  };

  const handleStopTunnel = async (tunnelId: string) => {
      const tunnelToStop = tunnels.find(t => t.id === tunnelId);
      const updatedTunnels = tunnels.filter(t => t.id !== tunnelId);
      setTunnels(updatedTunnels);
      if (isProduction) await updateActorTunnels(actor.id, updatedTunnels);
      
      if (tunnelToStop) {
        await handleCommand(`pkill -f "TCP-LISTEN:${tunnelToStop.localPort}" || true`);
      } else {
        await handleCommand(`pkill -f "socat" || true`);
      }
  };

  const handleToggleTunnel = async (trapId: string) => {
      setPendingTunnel(trapId);
      const activeTunnel = tunnels.find(t => t.trap.id === trapId);
      if (activeTunnel) {
          await handleStopTunnel(activeTunnel.id);
          setPendingTunnel(null);
          return;
      }
      const port = DEFAULT_TRAP_PORTS[trapId] || (3306 + tunnels.length);
      const newTunnel = await toggleTunnelMock(actor, trapId, port); 
      const updatedTunnels = [...tunnels, newTunnel];
      setTunnels(updatedTunnels);
      if (isProduction) await updateActorTunnels(actor.id, updatedTunnels);
      
      // Determine server IP (assume browser can resolve it, agent likely can too if DNS is setup, otherwise default to window.location.hostname for simple setups)
      const serverIp = window.location.hostname;
      const remotePort = SERVER_TRAP_PORTS[trapId];

      if (isProduction && remotePort) {
           // Tunnel to REAL Honeypot on Server
           await handleCommand(`nohup socat TCP-LISTEN:${port},fork EXEC:/opt/vpp-agent/trap_relay.sh >/dev/null 2>&1 & # ${newTunnel.id}`);
      } else {
           // Local Echo or Mock
           await handleCommand(`nohup socat TCP-LISTEN:${port},fork EXEC:/opt/vpp-agent/trap_relay.sh >/dev/null 2>&1 & # ${newTunnel.id}`);
      }
      
      setPendingTunnel(null);
  };

  const handleStartCustomTunnel = async () => {
      if (!customPort) return;
      const port = parseInt(customPort);
      if (isNaN(port)) return;
      const newTunnel: ActiveTunnel = {
          id: `tun-custom-${Date.now()}`,
          localPort: port,
          remoteEndpoint: `cloud-trap-custom:${port}`,
          status: 'ACTIVE',
          bytesTransferred: 0,
          uptimeSeconds: 0,
          trap: {
              id: `custom-${Date.now()}`,
              name: customService || 'Custom Service',
              description: 'User-defined port forwarding',
              serviceType: 'TCP Raw',
              riskLevel: 'MEDIUM'
          }
      };
      const updatedTunnels = [...tunnels, newTunnel];
      setTunnels(updatedTunnels);
      if (isProduction) await updateActorTunnels(actor.id, updatedTunnels);
      await handleCommand(`nohup socat TCP-LISTEN:${port},fork SYSTEM:'echo VPP_TRAP_SINK; cat' >/dev/null 2>&1 & # ${newTunnel.id}`);
      setCustomPort('');
  };

  const handleChangePersona = async (personaId: string) => {
      const p = AVAILABLE_PERSONAS.find(x => x.id === personaId);
      if (!p) return;
      setIsChangingPersona(true);
      if (isProduction) await updateActorPersona(actor.id, p);
      await handleCommand(`vpp-agent --set-persona "${p.name}"`); 
      setTimeout(() => {
          setActivePersona(p);
          setIsChangingPersona(false);
      }, 2000);
  };

  const handleToggleSentinel = async () => {
      const newState = !isSentinelEnabled;
      setIsSentinelEnabled(newState);
      if (isProduction) await toggleActorSentinel(actor.id, newState);
      await handleCommand(`vpp-agent --set-sentinel ${newState ? 'on' : 'off'}`);
      if (isProduction) {
          setTimeout(() => { getActorCommands(actor.id).then(setCommandHistory); }, 1500);
      }
  };

  // --- WIRELESS TOGGLE HANDLERS ---
  const handleToggleWifi = async () => {
      if (!actor.hasWifi) return;
      const newVal = !wifiEnabled;
      setWifiEnabled(newVal);
      if (isProduction) {
          await toggleActorScanning(actor.id, 'WIFI', newVal);
      }
  };

  const handleToggleBluetooth = async () => {
      if (!actor.hasBluetooth) return;
      const newVal = !btEnabled;
      setBtEnabled(newVal);
      if (isProduction) {
          await toggleActorScanning(actor.id, 'BLUETOOTH', newVal);
      }
  };

  const handleTestLog = () => {
      const mockLog = generateRandomLog([{...actor, tcpSentinelEnabled: isSentinelEnabled}]);
      mockLog.message = "[TEST EVENT] Manual verification trigger initiated by admin.";
      mockLog.level = LogLevel.INFO;
      setLocalLogs(prev => [mockLog, ...prev]);
  };

  // --- FORENSIC SCAN HANDLER ---
  const handleForensicScan = async () => {
      setIsGatheringForensics(true);
      setForensicView('SNAPSHOT'); // Ensure we are on snapshot view
      setForensicData(null); // Reset previous data

      if (isProduction) {
          // Send the clean, native forensic command that was added to the agent script
          const oneClickCmd = `vpp-agent --forensic`;
          await handleCommand(oneClickCmd);
          
          // Use polling to actively wait for the result
          const pollInterval = setInterval(async () => {
               const cmds = await getActorCommands(actor.id);
               // Find the completed job
               const job = cmds.find(c => c.command === oneClickCmd && c.status === 'COMPLETED');
               
               if (job && job.output) {
                   clearInterval(pollInterval);
                   
                   // Robust Parsing Logic (Line-by-Line State Machine)
                   const lines = job.output.split('\n');
                   let currentSection = '';
                   const extracted: any = {
                       PROCESSES: [],
                       NETWORK: [],
                       AUTH: [],
                       OPENFILES: []
                   };

                   lines.forEach(line => {
                       const t = line.trim();
                       if (t === '---PROCESSES---') { currentSection = 'PROCESSES'; return; }
                       if (t === '---NETWORK---') { currentSection = 'NETWORK'; return; }
                       if (t === '---AUTH---') { currentSection = 'AUTH'; return; }
                       if (t === '---OPENFILES---') { currentSection = 'OPENFILES'; return; }
                       
                       if (currentSection) extracted[currentSection].push(line);
                   });
                   
                   // Parse Process Table (Skip Header)
                   const processes = extracted.PROCESSES.slice(1).map((line: string) => {
                       const cols = line.trim().split(/\s+/);
                       // Basic validation to ensure line is a process record
                       if(cols.length < 4) return null;
                       return {
                           user: cols[0], pid: cols[1], cpu: cols[2], mem: cols[3], command: cols.slice(10).join(' '), risk: 'LOW' as 'LOW'
                       };
                   }).filter((p: any) => p && p.pid);

                   setForensicData({
                       timestamp: new Date(),
                       processes: processes,
                       connections: extracted.NETWORK,
                       authLogs: extracted.AUTH,
                       openFiles: extracted.OPENFILES
                   });
                   setIsGatheringForensics(false);
               }
          }, 1000); // Check every second

          // Safety Timeout
          setTimeout(() => {
              clearInterval(pollInterval);
              if (isGatheringForensics) {
                  setIsGatheringForensics(false);
                  // Optional: Show error
              }
          }, 15000);

      } else {
          // MOCK MODE: Pass actor context for dynamic forensic generation
          const data = await performForensicScan(actor.id, actor);
          setForensicData(data);
          setIsGatheringForensics(false);
      }
  };
  
  const handleSaveForensicReport = async () => {
      if (!forensicData || !currentUser) return;
      setIsSavingReport(true);
      
      const payload = {
          type: 'FORENSIC_SNAPSHOT',
          generatedBy: currentUser.username,
          snapshotData: forensicData
      };
      
      const success = await generateReport(payload);
      if (success) {
          alert("Snapshot saved successfully to System Reports.");
      } else {
          alert("Failed to save report.");
      }
      setIsSavingReport(false);
  };

  // --- THREAT TOPOLOGY LOGIC ---
  const threatTopology = useMemo(() => {
      const threats = new Map<string, { ip: string, protocol: string, count: number, port?: string }>();
      const intercepted: string[] = [];
      const ipRegex = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/;

      displayLogs.forEach(log => {
          if (new Date(log.timestamp).getTime() <= topologyDismissedTime) return;
          if (log.sourceIp === 'Address' || log.message.includes('Address:Port')) return;

          let attackerIp = log.sourceIp;
          let destPort = undefined;

          // 0. Sentinel Specific Match (High Priority)
          // Match 1: Mock format "detected from IP:PORT -> :PORT"
          const sentinelMockMatch = log.message.match(/detected from\s+.*?:(\d+)\s+->\s+:(\d+)/i);
          // Match 2: Real Kernel format "DPT=5566"
          const kernelMatch = log.message.match(/DPT=(\d+)/);

          if (sentinelMockMatch) {
              destPort = sentinelMockMatch[2];
          } else if (kernelMatch) {
              destPort = kernelMatch[1];
          } 

          // 1. Generic Complex Match (Existing)
          const complexMatch = log.message.match(/from\s+(?:[0-9a-f.:]+|\[.*?\]):(\d+)\s+(?:to|->)\s+(?:[0-9a-f.:]+|\[.*?\])?:(\d+)/i);
          
          // 2. Specific Trap Match (New robust format)
          const trapMatch = log.message.match(/->\s+:(\d+)/); 

          if (!destPort) {
              if (complexMatch) {
                  const p1 = parseInt(complexMatch[1]);
                  const p2 = parseInt(complexMatch[2]);
                  if (p2 > 30000 && p1 < 30000) {
                      destPort = p1.toString();
                  } else {
                      destPort = p2.toString();
                  }
              } else if (trapMatch) {
                  destPort = trapMatch[1];
              } else {
                  const portMatch = log.message.match(/to\s+(?:[0-9.]+|\[.*?\]):(\d+)/);
                  if (portMatch) destPort = portMatch[1];
              }
          }

          if (!attackerIp && (log.level === 'WARNING' || log.level === 'CRITICAL')) {
              const match = log.message.match(ipRegex);
              if (match) {
                  attackerIp = match[0];
                  if (attackerIp === '127.0.0.1' || attackerIp === '0.0.0.0' || attackerIp === actor.localIp || attackerIp === displayedLocalIp) {
                      attackerIp = undefined;
                  }
              }
          }

          if (attackerIp && (log.level === 'WARNING' || log.level === 'CRITICAL')) {
              let existing = threats.get(attackerIp);
              if (!existing) {
                   existing = { ip: attackerIp, protocol: log.process, count: 0, port: destPort };
                   threats.set(attackerIp, existing);
              } else {
                   existing.count++;
                   if (!existing.port && destPort) existing.port = destPort;
              }
          }
          if (log.message.includes('cmd:') || log.message.includes('Executing') || log.message.includes('stdin')) {
              const clean = log.message.replace(/.*cmd: /, '').replace(/.*Executing /, '');
              if (!intercepted.includes(clean)) intercepted.push(clean);
          }
      });

      return { attackers: Array.from(threats.values()), payloads: intercepted.slice(0, 5) };
  }, [displayLogs, actor.localIp, displayedLocalIp, topologyDismissedTime]);

  const portExposure = useMemo(() => {
      if (scannedPorts) { return scannedPorts; }
      const getServiceName = (p: number) => {
          if (p === 21) return 'FTP'; if (p === 22) return 'SSH'; if (p === 80) return 'HTTP'; if (p === 443) return 'HTTPS'; if (p === 3306) return 'MySQL'; return 'TCP-Service';
      };
      const system = [{ port: 22, proto: 'TCP', service: 'SSH (Mgmt)', source: 'Host OS' }];
      const application: any[] = [];
      if (activePersona && activePersona.openPorts) {
          activePersona.openPorts.forEach(p => {
              if (!application.some(a => a.port === p)) {
                  application.push({ port: p, proto: 'TCP', service: getServiceName(p), source: `Persona: ${activePersona.name}` });
              }
          });
      }
      tunnels.forEach(t => {
          const existingIdx = application.findIndex(a => a.port === t.localPort);
          if (existingIdx >= 0) {
              application[existingIdx].source = 'Cloud Tunnel (Override)';
              application[existingIdx].service = t.trap.serviceType;
          } else {
              application.push({ port: t.localPort, proto: 'TCP', service: t.trap.serviceType, source: 'Cloud Tunnel' });
          }
      });
      return { system, application: application.sort((a,b) => a.port - b.port) };
  }, [activePersona, tunnels, scannedPorts]);

  const activeThreats = threatTopology.attackers;
  const blockedByTunnels = tunnels.map(t => t.localPort);
  const blockedByPersona = activePersona.openPorts || [];
  const systemPorts = [22];
  const getPersonaConflicts = (persona: DevicePersona) => persona.openPorts.filter(p => [...systemPorts, ...blockedByTunnels].includes(p));
  const getTunnelConflicts = (trapId: string) => {
      const defaultPort = DEFAULT_TRAP_PORTS[trapId];
      if (!defaultPort) return [];
      return [...systemPorts, ...blockedByTunnels, ...blockedByPersona].includes(defaultPort) ? [defaultPort] : [];
  };

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* HEADER */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-xl relative overflow-hidden">
        <div className={`absolute top-0 right-0 w-64 h-64 bg-gradient-to-br opacity-10 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none ${actor.status === 'COMPROMISED' ? 'from-red-500 to-orange-500' : 'from-blue-500 to-emerald-500'}`} />
        <div className="relative z-10">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6">
                <div className="flex items-center">
                    <button onClick={onBack} className="mr-4 p-2 hover:bg-slate-700 rounded-full text-slate-400 hover:text-white transition-colors">
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                    <div>
                        <div className="flex items-center gap-3">
                            {isEditingName ? (
                                <div className="flex items-center">
                                    <input className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xl font-bold text-white focus:border-blue-500 outline-none" value={editedName} onChange={(e) => setEditedName(e.target.value)} autoFocus />
                                    <button onClick={handleSaveName} className="ml-2 bg-green-600 p-1.5 rounded text-white"><Check className="w-4 h-4"/></button>
                                    <button onClick={() => setIsEditingName(false)} className="ml-1 bg-slate-600 p-1.5 rounded text-white"><X className="w-4 h-4"/></button>
                                </div>
                            ) : (
                                <h1 className="text-3xl font-bold text-white tracking-tight flex items-center group">
                                    {actor.name}
                                    <button onClick={() => setIsEditingName(true)} className="ml-3 opacity-0 group-hover:opacity-100 text-slate-500 hover:text-blue-400 transition-all"><Edit2 className="w-4 h-4" /></button>
                                </h1>
                            )}
                            <div className={`px-3 py-1 rounded-full text-xs font-bold flex items-center border ${actor.status === 'ONLINE' ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400' : actor.status === 'COMPROMISED' ? 'bg-red-500/10 border-red-500/50 text-red-500 animate-pulse' : 'bg-slate-500/10 border-slate-500/50 text-slate-400'}`}>
                                {actor.status === 'COMPROMISED' && <AlertOctagon className="w-3 h-3 mr-1" />}
                                {actor.status}
                            </div>
                            {isSentinelEnabled && <div className="px-3 py-1 rounded-full text-xs font-bold flex items-center border bg-red-600 text-white border-red-500 shadow-lg shadow-red-500/20 animate-pulse"><Eye className="w-3 h-3 mr-1" /> SENTINEL ACTIVE</div>}
                        </div>
                        
                        {/* Physical Address Field */}
                        <div className="flex items-center mt-1 text-sm text-slate-400 group">
                            <MapPin className="w-3.5 h-3.5 mr-1.5 text-slate-500" />
                            {isEditingAddress ? (
                                <div className="flex items-center">
                                    <input className="bg-slate-900 border border-slate-600 rounded px-2 py-0.5 text-xs text-white focus:border-blue-500 outline-none w-48" value={editedAddress} onChange={(e) => setEditedAddress(e.target.value)} autoFocus />
                                    <button onClick={handleSaveAddress} className="ml-2 bg-green-600 p-1 rounded text-white"><Check className="w-3 h-3"/></button>
                                    <button onClick={() => setIsEditingAddress(false)} className="ml-1 bg-slate-600 p-1 rounded text-white"><X className="w-3 h-3"/></button>
                                </div>
                            ) : (
                                <span className="flex items-center cursor-pointer hover:text-white transition-colors" onClick={() => setIsEditingAddress(true)}>
                                    {actor.physicalAddress || "Set Physical Location..."}
                                    <Edit2 className="w-3 h-3 ml-2 opacity-0 group-hover:opacity-100 text-slate-600" />
                                </span>
                            )}
                        </div>

                        <div className="flex flex-wrap gap-4 mt-2 text-sm text-slate-400 font-mono">
                            <span className="flex items-center"><TerminalIcon className="w-3 h-3 mr-1" /> {actor.id}</span>
                            <span className="flex items-center"><Router className="w-3 h-3 mr-1" /> {gateway?.name || 'Direct Uplink'}</span>
                            <span className="flex items-center"><Cpu className="w-3 h-3 mr-1" /> {actor.osVersion || "Unknown OS"}</span>
                            <span className="flex items-center text-blue-300"><Hash className="w-3 h-3 mr-1" /> v{actor.agentVersion || "1.0.0"}</span>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2 mt-4 md:mt-0">
                    {actor.status === 'COMPROMISED' && (
                        <button onClick={handleResetStatus} className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg font-bold flex items-center shadow-lg shadow-emerald-600/20"><ShieldCheck className="w-4 h-4 mr-2" /> ACKNOWLEDGE ALERT</button>
                    )}
                    <button onClick={handleFactoryReset} disabled={isResetting} className={`bg-orange-700/80 hover:bg-orange-600 text-white px-4 py-2 rounded-lg font-bold flex items-center shadow-lg transition-colors ${isResetting ? 'opacity-70' : ''}`} title="Reset to Base State">
                        {isResetting ? <Loader className="w-4 h-4 animate-spin mr-2" /> : <RefreshCcw className="w-4 h-4 mr-2" />}
                        {isResetting ? 'RESETTING...' : 'FACTORY RESET'}
                    </button>
                    <button onClick={handleDeleteActor} disabled={isDeleting} className={`bg-slate-700 hover:bg-red-600 hover:text-slate-300 text-slate-300 px-4 py-2 rounded-lg transition-colors flex items-center font-bold text-xs ${isDeleting ? 'opacity-70 cursor-not-allowed' : ''}`} title="Decommission & Uninstall">
                        {isDeleting ? <><Loader className="w-4 h-4 animate-spin mr-2" /> UNINSTALLING...</> : <><Trash2 className="w-4 h-4 mr-2" /> DECOMMISSION</>}
                    </button>
                </div>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 bg-slate-900/50 rounded-lg p-4 border border-slate-700/50 items-center">
                <div className="h-full flex flex-col justify-center">
                    <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center"><Globe className="w-3 h-3 mr-1" /> External IP (WAN)</div>
                    <div className="text-slate-200 font-mono text-sm flex items-center">{actor.localIp} {gateway && <span className="ml-2 text-[10px] bg-indigo-900 text-indigo-300 px-1 rounded">PROXY</span>}</div>
                </div>
                <div className="h-full flex flex-col justify-center">
                     <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center"><Wifi className="w-3 h-3 mr-1" /> Internal IP (LAN)</div>
                    <div className="text-slate-200 font-mono text-sm flex items-center h-5">
                        {isScanningIp ? <span className="text-blue-400 text-xs flex items-center animate-pulse"><ScanSearch className="w-3 h-3 mr-1" /> Scanning...</span> : <>{displayedLocalIp || <span className="text-slate-600 italic">Unknown</span>}<button onClick={handleFetchIp} className="ml-2 text-slate-500 hover:text-white transition-colors" title="Rescan Internal IP"><RefreshCw className="w-3 h-3" /></button></>}
                    </div>
                </div>
                <div className="flex justify-center border-l border-slate-700/50"><Gauge value={actor.cpuLoad || 0} label="CPU Load" type="CPU" icon={Cpu} /></div>
                <div className="flex justify-center border-l border-slate-700/50"><Gauge value={actor.memoryUsage || 0} label="RAM Usage" type="RAM" icon={Activity} /></div>
                <div className="flex justify-center border-l border-slate-700/50"><Gauge value={actor.temperature || 0} label="Thermals" type="TEMP" unit="°C" icon={Thermometer} /></div>
            </div>
        </div>
      </div>

      {(actor.status === 'COMPROMISED' || activeThreats.length > 0) && (
          <div className="bg-slate-900 border border-red-500/40 rounded-xl p-0 overflow-hidden shadow-2xl shadow-red-900/10 animate-slide-up">
              <div className="bg-red-900/20 px-6 py-3 border-b border-red-500/30 flex justify-between items-center">
                  <h3 className="text-red-400 font-bold flex items-center text-sm tracking-wider"><Activity className="w-4 h-4 mr-2" /> LIVE THREAT TOPOLOGY</h3>
                  <div className="flex items-center space-x-3">
                      <span className="text-[10px] text-red-300 font-mono uppercase animate-pulse">Attack in Progress</span>
                      <button onClick={handleClearTopology} className="flex items-center space-x-1 bg-red-950 hover:bg-red-900 text-red-300 px-2 py-1 rounded text-[10px] font-bold border border-red-800 transition-colors" title="Clear visualization until new attack events detected"><X className="w-3 h-3" /><span>CLEAR VIEW</span></button>
                  </div>
              </div>
              <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-8">
                  <div className="lg:col-span-2 space-y-4">
                        {activeThreats.length === 0 && <div className="text-slate-500 text-sm italic p-4 text-center">Analysing traffic logs for attacker IP...</div>}
                        {activeThreats.map((threat, idx) => (
                            <div key={idx} className="flex items-center justify-between group">
                                <div className="bg-slate-800 p-3 rounded-lg border border-slate-600 group-hover:border-red-500 transition-colors w-40 relative">
                                    <div className="absolute -top-2 -left-2 bg-red-600 rounded-full p-1 shadow-lg z-10"><Skull className="w-3 h-3 text-white" /></div>
                                    <div className="text-xs text-slate-500 font-bold uppercase mb-1">Attacker</div>
                                    <div className="text-red-400 font-mono font-bold text-sm">{threat.ip}</div>
                                    <div className="text-[10px] text-slate-500 mt-1">{threat.count} Events</div>
                                </div>
                                <div className="flex-1 mx-4 relative h-8 flex items-center">
                                    <div className="w-full h-0.5 bg-slate-700 relative overflow-hidden"><div className="absolute inset-0 bg-red-500/50 animate-progress"></div></div>
                                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                                        <span className="bg-slate-900 px-2 text-[10px] text-red-300 font-mono border border-red-900 rounded z-10 shadow-sm">{threat.protocol.toUpperCase()}</span>
                                        {threat.port && (
                                            <div className="text-[9px] text-red-400 font-bold bg-slate-900/90 px-1.5 py-0.5 rounded-b border-x border-b border-red-900/50 z-0 -mt-1 pt-1.5 shadow-sm">
                                                :{threat.port}
                                            </div>
                                        )}
                                    </div>
                                    <ArrowRight className="absolute right-0 text-slate-700 w-4 h-4" />
                                </div>
                                <div className="bg-slate-800 p-3 rounded-lg border border-blue-500/30 w-40 relative">
                                     <div className="absolute -top-2 -right-2 bg-blue-600 rounded-full p-1 shadow-lg z-10"><Shield className="w-3 h-3 text-white" /></div>
                                    <div className="text-xs text-slate-500 font-bold uppercase mb-2">Target (Self)</div>
                                    <div className="mb-1"><span className="text-[10px] text-slate-500 font-mono mr-1">LAN:</span><span className="text-white font-mono font-bold text-xs">{displayedLocalIp || <span className="text-slate-600 italic">---</span>}</span></div>
                                    <div><span className="text-[10px] text-slate-500 font-mono mr-1">WAN:</span><span className="text-blue-400 font-mono font-bold text-xs">{actor.localIp}</span></div>
                                    <div className="text-[10px] text-slate-500 mt-2 border-t border-slate-700 pt-1 truncate">{actor.name}</div>
                                </div>
                            </div>
                        ))}
                  </div>
                  <div className="bg-slate-950 rounded border border-slate-800 p-4 font-mono text-xs">
                       <h4 className="text-slate-500 font-bold uppercase mb-3 flex items-center"><TerminalIcon className="w-3 h-3 mr-2"/> Captured Payloads</h4>
                       <div className="space-y-2">
                           {threatTopology.payloads.length === 0 ? <span className="text-slate-600 italic">No payload data intercepted.</span> : threatTopology.payloads.map((p, i) => (<div key={i} className="text-green-400 border-b border-slate-800 pb-1 break-all">&gt; {p}</div>))}
                       </div>
                  </div>
              </div>
          </div>
      )}

      {/* Tabs Navigation */}
      <div className="border-b border-slate-700 flex space-x-6 overflow-x-auto">
          <button onClick={() => setActiveTab('OVERVIEW')} className={`pb-3 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${activeTab === 'OVERVIEW' ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-500 hover:text-white'}`}>OVERVIEW</button>
          <button onClick={() => setActiveTab('TERMINAL')} className={`pb-3 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${activeTab === 'TERMINAL' ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-500 hover:text-white'}`}>LIVE TERMINAL</button>
          <button onClick={() => setActiveTab('DECEPTION')} className={`pb-3 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${activeTab === 'DECEPTION' ? 'border-purple-500 text-purple-400' : 'border-transparent text-slate-500 hover:text-white'}`}>DECEPTION & PERSONA</button>
          <button onClick={() => setActiveTab('NETWORK')} className={`pb-3 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${activeTab === 'NETWORK' ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-slate-500 hover:text-white'}`}>TRAP PROJECTOR</button>
          <button onClick={() => setActiveTab('FORENSICS')} className={`pb-3 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${activeTab === 'FORENSICS' ? 'border-red-500 text-red-400' : 'border-transparent text-slate-500 hover:text-white'}`}>FORENSICS</button>
      </div>

      {activeTab === 'OVERVIEW' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-lg h-full">
                  <div className="flex justify-between items-center mb-4">
                      <h3 className="text-lg font-bold text-white flex items-center"><BrainCircuit className="w-5 h-5 mr-2 text-purple-400" /> AI Threat Analysis</h3>
                      <button onClick={handleAiAnalyze} disabled={isAnalyzing} className="bg-purple-600 hover:bg-purple-500 text-white px-3 py-1 rounded text-xs font-bold transition-colors disabled:opacity-50 flex items-center">
                          {isAnalyzing ? <Loader className="w-3 h-3 animate-spin mr-1"/> : <Bot className="w-3 h-3 mr-1"/>}
                          {isAnalyzing ? 'Analyzing...' : 'Analyze Logs'}
                      </button>
                  </div>
                  {aiAnalysis ? (
                      <div className="space-y-4 animate-fade-in">
                          <div className={`p-3 rounded border ${aiAnalysis.threatLevel === 'HIGH' ? 'bg-red-500/10 border-red-500 text-red-400' : aiAnalysis.threatLevel === 'MEDIUM' ? 'bg-yellow-500/10 border-yellow-500 text-yellow-400' : 'bg-emerald-500/10 border-emerald-500 text-emerald-400'}`}>
                              <div className="font-bold text-xs uppercase mb-1">Threat Level</div>
                              <div className="text-xl font-bold">{aiAnalysis.threatLevel}</div>
                          </div>
                          <div><div className="font-bold text-slate-400 text-xs uppercase mb-1">Summary</div><p className="text-slate-300 text-sm leading-relaxed">{aiAnalysis.summary}</p></div>
                          <div><div className="font-bold text-slate-400 text-xs uppercase mb-1">Recommended Actions</div><ul className="list-disc list-inside text-slate-300 text-sm space-y-1">{aiAnalysis.recommendedActions.map((action, i) => <li key={i}>{action}</li>)}</ul></div>
                      </div>
                  ) : (
                      <div className="text-center py-10 text-slate-500 text-sm"><Bot className="w-10 h-10 mx-auto mb-3 opacity-20" /><p>Click analyze to process recent log telemetry.</p></div>
                  )}
              </div>
               <div className="flex flex-col space-y-6">
                   <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-lg">
                       <div className="flex justify-between items-center mb-4">
                           <h3 className="text-lg font-bold text-white flex items-center"><Cable className="w-5 h-5 mr-2 text-indigo-400" /> Port Exposure Analysis</h3>
                           <button onClick={handleScanPorts} disabled={isScanningPorts} className="bg-indigo-900 hover:bg-indigo-800 text-indigo-300 px-3 py-1.5 rounded text-xs font-bold transition-colors flex items-center border border-indigo-700 disabled:opacity-50"><Search className={`w-3 h-3 mr-2 ${isScanningPorts ? 'animate-spin' : ''}`} />{isScanningPorts ? 'SCANNING...' : 'LIVE SCAN'}</button>
                       </div>
                       {!scannedPorts && <div className="bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 text-[10px] p-2 rounded mb-3 flex items-center"><Info className="w-3 h-3 mr-2" /> Showing estimated configuration. Run Live Scan to map active sockets.</div>}
                       <div className="grid grid-cols-2 gap-6">
                           <div>
                               <div className="text-xs font-bold text-slate-500 uppercase mb-2 flex items-center border-b border-slate-700 pb-1"><Server className="w-3 h-3 mr-1.5" /> Native / OS Level</div>
                               <div className="space-y-2">{portExposure.system.length === 0 ? <div className="text-[10px] text-slate-600 italic py-1">No system ports detected.</div> : portExposure.system.map((p, idx) => (<div key={idx} className="flex justify-between items-center bg-slate-900/50 p-2 rounded border border-slate-700/50"><div className="flex items-center"><span className="text-sm font-mono font-bold text-slate-300 mr-2">{p.port}/{p.proto}</span></div><div className="flex flex-col items-end"><span className="text-[10px] text-slate-500">{p.service}</span><span className="text-[9px] text-slate-600 font-mono truncate max-w-[60px]" title={p.source}>{p.source}</span></div></div>))}</div>
                           </div>
                           <div>
                               <div className="text-xs font-bold text-slate-500 uppercase mb-2 flex items-center border-b border-slate-700 pb-1"><Globe className="w-3 h-3 mr-1.5" /> VPP Application Level</div>
                               <div className="space-y-2">{portExposure.application.length === 0 ? <div className="text-[10px] text-slate-600 italic py-1">No application ports exposed.</div> : portExposure.application.map((p, idx) => (<div key={idx} className="flex justify-between items-center bg-indigo-900/20 p-2 rounded border border-indigo-500/30"><div className="flex items-center"><span className="text-sm font-mono font-bold text-indigo-300 mr-2">{p.port}/{p.proto}</span></div><div className="flex flex-col items-end"><span className="text-[10px] text-indigo-200/70 truncate w-20 text-right">{p.service}</span><span className="text-[9px] text-indigo-400/50 font-mono truncate w-20 text-right" title={p.source}>{p.source}</span></div></div>))}</div>
                           </div>
                       </div>
                   </div>
                   
                   {/* Wireless Automation Card */}
                   <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-lg">
                       <h3 className="text-lg font-bold text-white mb-4 flex items-center"><Radio className="w-5 h-5 mr-2 text-cyan-400" /> Wireless Automation</h3>
                       <div className="grid grid-cols-2 gap-4">
                           <div className={`p-4 rounded border flex flex-col items-center justify-center transition-all ${actor.hasWifi ? 'bg-slate-900 border-slate-600' : 'bg-slate-900/50 border-slate-800 opacity-50'}`}>
                               <Wifi className={`w-6 h-6 mb-2 ${wifiEnabled ? 'text-emerald-400 animate-pulse' : 'text-slate-500'}`} />
                               <span className="text-xs font-bold text-slate-300 mb-2">Auto WiFi Scan</span>
                               <label className="relative inline-flex items-center cursor-pointer">
                                  <input type="checkbox" checked={wifiEnabled} onChange={handleToggleWifi} disabled={!actor.hasWifi} className="sr-only peer" />
                                  <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"></div>
                                </label>
                               {!actor.hasWifi && <span className="text-[9px] text-red-400 mt-1">Hardware Missing</span>}
                           </div>
                           <div className={`p-4 rounded border flex flex-col items-center justify-center transition-all ${actor.hasBluetooth ? 'bg-slate-900 border-slate-600' : 'bg-slate-900/50 border-slate-800 opacity-50'}`}>
                               <Bluetooth className={`w-6 h-6 mb-2 ${btEnabled ? 'text-blue-400 animate-pulse' : 'text-slate-500'}`} />
                               <span className="text-xs font-bold text-slate-300 mb-2">Auto Bluetooth</span>
                               <label className="relative inline-flex items-center cursor-pointer">
                                  <input type="checkbox" checked={btEnabled} onChange={handleToggleBluetooth} disabled={!actor.hasBluetooth} className="sr-only peer" />
                                  <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                                </label>
                               {!actor.hasBluetooth && <span className="text-[9px] text-red-400 mt-1">Hardware Missing</span>}
                           </div>
                       </div>
                       <p className="text-[10px] text-slate-500 mt-3 text-center">When enabled, scans run automatically every 2 minutes.</p>
                   </div>

                   <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-lg flex-1 flex flex-col">
                       <h3 className="text-lg font-bold text-white mb-4 flex items-center"><Activity className="w-5 h-5 mr-2 text-blue-400" /> Recent Activity</h3>
                       <div className="flex-1 overflow-y-auto max-h-[200px] space-y-2 pr-2 scrollbar-thin scrollbar-thumb-slate-700">
                           {displayLogs.slice(0, 20).map(log => (
                               <div key={log.id} className="text-xs border-b border-slate-700/50 pb-2 mb-2 last:border-0">
                                   <div className="flex justify-between text-slate-500 mb-1"><span>{new Date(log.timestamp).toLocaleTimeString()}</span><span className={log.level === 'CRITICAL' ? 'text-red-500 font-bold' : log.level === 'WARNING' ? 'text-yellow-500' : 'text-blue-400'}>{log.level}</span></div>
                                   <div className="text-slate-300 font-mono break-all">{log.message}</div>
                               </div>
                           ))}
                       </div>
                   </div>
               </div>
          </div>
      )}

      {/* FORENSICS TAB */}
      {activeTab === 'FORENSICS' && (
           <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden shadow-lg flex flex-col h-full min-h-[600px]">
                <div className="bg-slate-900 p-4 border-b border-slate-700 flex justify-between items-center">
                    <div className="flex items-center">
                        <Zap className="w-5 h-5 text-red-500 mr-3 animate-pulse" />
                        <div>
                            <h3 className="text-lg font-bold text-white">LIVE FORENSIC SNAPSHOT</h3>
                            <p className="text-xs text-slate-500">Volatile Memory Analysis & Artifact Collection</p>
                        </div>
                    </div>
                    <div className="flex space-x-2">
                        <button 
                            onClick={() => setForensicView('SNAPSHOT')}
                            className={`px-3 py-1.5 text-xs font-bold rounded flex items-center ${forensicView === 'SNAPSHOT' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-white'}`}
                        >
                            <Camera className="w-3 h-3 mr-1" /> SNAPSHOT
                        </button>
                        <button 
                            onClick={() => setForensicView('SESSIONS')}
                            className={`px-3 py-1.5 text-xs font-bold rounded flex items-center ${forensicView === 'SESSIONS' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-white'}`}
                        >
                            <Film className="w-3 h-3 mr-1" /> GHOST MODE (REPLAY)
                        </button>
                    </div>
                </div>

                {/* Content Area */}
                <div className="p-6 flex-1 overflow-y-auto">
                    
                    {/* --- SNAPSHOT VIEW --- */}
                    {forensicView === 'SNAPSHOT' && (
                        <>
                            <div className="flex justify-end mb-4 space-x-3">
                                {forensicData && (
                                    <button
                                        onClick={handleSaveForensicReport}
                                        disabled={isSavingReport}
                                        className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded font-bold text-sm flex items-center transition-colors"
                                    >
                                        {isSavingReport ? <Loader className="w-4 h-4 mr-2 animate-spin"/> : <Save className="w-4 h-4 mr-2"/>}
                                        SAVE AS REPORT
                                    </button>
                                )}
                                <button 
                                    onClick={handleForensicScan}
                                    disabled={isGatheringForensics}
                                    className={`px-4 py-2 rounded font-bold text-sm flex items-center transition-all ${
                                        isGatheringForensics 
                                        ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                                        : 'bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/20 hover:scale-105'
                                    }`}
                                >
                                    {isGatheringForensics ? <Loader className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
                                    {isGatheringForensics ? 'GATHERING EVIDENCE...' : '⚡ RUN FORENSIC SCAN'}
                                </button>
                            </div>

                            {!forensicData && !isGatheringForensics && (
                                <div className="flex flex-col items-center justify-center h-full text-slate-500 opacity-50 py-20">
                                    <Search className="w-16 h-16 mb-4" />
                                    <p className="text-lg">No forensic data available.</p>
                                    <p className="text-sm">Click "RUN FORENSIC SCAN" to gather current system state.</p>
                                </div>
                            )}

                            {isGatheringForensics && (
                                <div className="flex flex-col items-center justify-center h-full py-20">
                                    <Loader className="w-12 h-12 text-blue-500 animate-spin mb-4" />
                                    <div className="text-blue-400 font-mono text-sm animate-pulse">Establishing secure channel...</div>
                                    <div className="text-slate-500 text-xs mt-2">Dumping process table...</div>
                                    <div className="text-slate-500 text-xs">Tracing network sockets...</div>
                                </div>
                            )}

                            {forensicData && !isGatheringForensics && (
                                <div className="space-y-6 animate-fade-in">
                                    <div className="text-right text-xs text-slate-500 font-mono mb-2">Snapshot Timestamp: {new Date(forensicData.timestamp).toLocaleString()}</div>
                                    
                                    {/* 1. Process List */}
                                    <div className="border border-slate-700 rounded-lg overflow-hidden">
                                        <div className="bg-slate-900/50 p-3 border-b border-slate-700 flex items-center font-bold text-slate-300 text-sm">
                                            <Activity className="w-4 h-4 mr-2 text-blue-400" /> Process Tree Analysis (Top CPU/Mem)
                                        </div>
                                        <table className="w-full text-left text-xs">
                                            <thead className="bg-slate-900 text-slate-500">
                                                <tr>
                                                    <th className="p-2">PID</th>
                                                    <th className="p-2">USER</th>
                                                    <th className="p-2">CPU%</th>
                                                    <th className="p-2">MEM%</th>
                                                    <th className="p-2">COMMAND</th>
                                                    <th className="p-2 text-right">RISK</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-700 bg-slate-800">
                                                {forensicData.processes.map((proc, i) => (
                                                    <tr key={i} className={`hover:bg-slate-700/50 ${proc.risk === 'HIGH' ? 'bg-red-900/10' : proc.risk === 'MEDIUM' ? 'bg-yellow-900/10' : ''}`}>
                                                        <td className="p-2 font-mono text-slate-400">{proc.pid}</td>
                                                        <td className="p-2 text-white">{proc.user}</td>
                                                        <td className="p-2 text-slate-300">{proc.cpu}</td>
                                                        <td className="p-2 text-slate-300">{proc.mem}</td>
                                                        <td className="p-2 font-mono text-yellow-500 break-all">{proc.command}</td>
                                                        <td className="p-2 text-right">
                                                            {proc.risk === 'HIGH' 
                                                                ? <span className="bg-red-600 text-white px-1.5 py-0.5 rounded text-[10px] font-bold">HIGH</span>
                                                                : proc.risk === 'MEDIUM' 
                                                                    ? <span className="bg-yellow-600 text-white px-1.5 py-0.5 rounded text-[10px] font-bold">MED</span>
                                                                    : <span className="text-slate-600 text-[10px]">LOW</span>
                                                            }
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>

                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                        {/* 2. Network Connections */}
                                        <div className="border border-slate-700 rounded-lg overflow-hidden flex flex-col">
                                            <div className="bg-slate-900/50 p-3 border-b border-slate-700 flex items-center font-bold text-slate-300 text-sm">
                                                <Network className="w-4 h-4 mr-2 text-emerald-400" /> Network Artifacts (Netstat/SS)
                                            </div>
                                            <div className="bg-black p-3 font-mono text-xs text-emerald-500 overflow-x-auto whitespace-pre h-64">
                                                {forensicData.connections.length > 0 
                                                    ? forensicData.connections.join('\n') 
                                                    : <span className="text-slate-600 italic">No active connections found.</span>
                                                }
                                            </div>
                                        </div>

                                        {/* 3. Auth Logs */}
                                        <div className="border border-slate-700 rounded-lg overflow-hidden flex flex-col">
                                            <div className="bg-slate-900/50 p-3 border-b border-slate-700 flex items-center font-bold text-slate-300 text-sm">
                                                <FileText className="w-4 h-4 mr-2 text-yellow-400" /> Recent Auth Journal
                                            </div>
                                            <div className="bg-black p-3 font-mono text-xs text-slate-400 overflow-x-auto whitespace-pre h-64">
                                                {forensicData.authLogs.length > 0 
                                                    ? forensicData.authLogs.map((l, i) => (
                                                        <div key={i} className="border-b border-slate-800 pb-1 mb-1 last:border-0">{l}</div>
                                                    ))
                                                    : <span className="text-slate-600 italic">No auth logs retrieved.</span>
                                                }
                                            </div>
                                        </div>
                                    </div>
                                    
                                    {/* 4. Open Files (Mock Only usually) */}
                                    {forensicData.openFiles.length > 0 && (
                                        <div className="border border-slate-700 rounded-lg overflow-hidden">
                                            <div className="bg-slate-900/50 p-3 border-b border-slate-700 flex items-center font-bold text-slate-300 text-sm">
                                                <HardDrive className="w-4 h-4 mr-2 text-purple-400" /> Suspicious Open File Handles
                                            </div>
                                            <div className="bg-slate-800 p-0">
                                                {forensicData.openFiles.map((line, i) => (
                                                    <div key={i} className="p-2 border-b border-slate-700 text-xs font-mono text-purple-300 hover:bg-slate-700">{line}</div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                </div>
                            )}
                        </>
                    )}

                    {/* --- GHOST MODE (SESSION REPLAY) VIEW --- */}
                    {forensicView === 'SESSIONS' && (
                        <div className="h-full flex flex-col lg:flex-row gap-6">
                            {/* Session List */}
                            <div className="w-full lg:w-1/3 bg-slate-900 rounded border border-slate-700 overflow-hidden flex flex-col">
                                <div className="p-3 bg-slate-800 border-b border-slate-700 text-sm font-bold text-slate-300 flex justify-between items-center">
                                     <span>Recorded Sessions</span>
                                     <button 
                                        onClick={handleLoadSessions} 
                                        disabled={isRefreshingSessions} 
                                        className="text-slate-500 hover:text-white p-1 rounded hover:bg-slate-700 transition-colors"
                                        title="Refresh Session List"
                                     >
                                         <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingSessions ? 'animate-spin' : ''}`} />
                                     </button>
                                </div>
                                <div className="flex-1 overflow-y-auto">
                                    {recordedSessions.length === 0 ? (
                                        <div className="p-8 text-center text-slate-500 text-xs italic flex flex-col items-center">
                                            <Film className="w-8 h-8 mb-2 opacity-20" />
                                            No recorded attack sessions found.
                                            <br/>Enable a Trap to capture interactions.
                                        </div>
                                    ) : (
                                        recordedSessions.map(session => (
                                            <div 
                                                key={session.id} 
                                                onClick={() => { setActiveSession(session); setReplayTime(0); setIsPlaying(false); }}
                                                className={`p-3 border-b border-slate-800 cursor-pointer hover:bg-slate-800 transition-colors group relative ${activeSession?.id === session.id ? 'bg-blue-900/20 border-l-4 border-l-blue-500' : ''}`}
                                            >
                                                <div className="flex justify-between items-start mb-1 pr-6">
                                                    <span className="text-xs font-bold text-white">{new Date(session.startTime).toLocaleString()}</span>
                                                    <span className="text-[10px] bg-red-900/50 text-red-300 px-1.5 rounded border border-red-800">{session.protocol}</span>
                                                </div>
                                                <div className="text-xs text-slate-400 font-mono mb-1">{session.attackerIp}</div>
                                                <div className="text-[10px] text-slate-600">{session.durationSeconds.toFixed(1)}s Duration • {session.frames.length} Events</div>
                                                
                                                <button 
                                                    onClick={(e) => handleDeleteSession(e, session.id)}
                                                    className="absolute top-3 right-2 text-slate-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-1.5"
                                                    title="Delete Recording"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>

                            {/* Player */}
                            <div className="flex-1 bg-black rounded border border-slate-700 flex flex-col overflow-hidden relative">
                                {!activeSession ? (
                                    <div className="flex items-center justify-center h-full text-slate-600 flex-col">
                                        <Film className="w-12 h-12 mb-4 opacity-20" />
                                        <p>Select a session to replay</p>
                                    </div>
                                ) : (
                                    <>
                                        {/* Terminal Screen */}
                                        <div className="flex-1 p-4 font-mono text-xs md:text-sm overflow-y-auto whitespace-pre-wrap text-green-500 bg-black">
                                            {replayContent}
                                            <span className="animate-pulse inline-block w-2 h-4 bg-green-500 ml-1 align-middle"></span>
                                        </div>

                                        {/* Controls */}
                                        <div className="bg-slate-800 p-3 border-t border-slate-700">
                                            <div className="flex items-center justify-between mb-2 text-[10px] text-slate-400 font-mono">
                                                <span>{(replayTime/1000).toFixed(1)}s</span>
                                                <span>{activeSession.durationSeconds.toFixed(1)}s</span>
                                            </div>
                                            {/* Scrubber */}
                                            <div className="relative h-2 bg-slate-700 rounded-full mb-4 cursor-pointer group" onClick={(e) => {
                                                const rect = e.currentTarget.getBoundingClientRect();
                                                const x = e.clientX - rect.left;
                                                const pct = x / rect.width;
                                                setReplayTime(pct * activeSession.durationSeconds * 1000);
                                            }}>
                                                <div 
                                                    className="absolute top-0 left-0 h-full bg-blue-500 rounded-full pointer-events-none" 
                                                    style={{ width: `${(replayTime / (activeSession.durationSeconds * 1000)) * 100}%` }}
                                                ></div>
                                                <div 
                                                    className="absolute top-1/2 -mt-1.5 w-3 h-3 bg-white rounded-full shadow cursor-grab group-hover:scale-125 transition-transform"
                                                    style={{ left: `calc(${(replayTime / (activeSession.durationSeconds * 1000)) * 100}% - 6px)` }}
                                                ></div>
                                            </div>

                                            <div className="flex justify-center items-center space-x-6">
                                                <button onClick={() => setReplaySpeed(s => s === 1 ? 2 : s === 2 ? 4 : 1)} className="text-xs font-bold text-slate-500 w-12 text-center hover:text-white">
                                                    {replaySpeed}x
                                                </button>
                                                <button onClick={() => { setReplayTime(Math.max(0, replayTime - 5000)); }} className="text-slate-400 hover:text-white"><Rewind className="w-5 h-5" /></button>
                                                <button 
                                                    onClick={() => setIsPlaying(!isPlaying)} 
                                                    className="bg-blue-600 hover:bg-blue-500 text-white p-3 rounded-full shadow-lg transition-transform hover:scale-105"
                                                >
                                                    {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-1" />}
                                                </button>
                                                <button onClick={() => { setReplayTime(Math.min(activeSession.durationSeconds * 1000, replayTime + 5000)); }} className="text-slate-400 hover:text-white"><FastForward className="w-5 h-5" /></button>
                                                <div className="w-12"></div> {/* Spacer */}
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    )}

                </div>
           </div>
      )}

      {activeTab === 'TERMINAL' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-auto lg:h-[600px]">
              <div className="lg:col-span-2 flex flex-col bg-slate-800 rounded-xl border border-slate-700 p-1 overflow-hidden min-h-[400px]">
                   <div className="bg-slate-900 p-2 flex justify-between items-center border-b border-slate-700">
                       <div className="flex items-center text-xs text-slate-400"><TerminalIcon className="w-3 h-3 mr-2" /> SSH Session: root@{actor.localIp}</div>
                       <div className="flex space-x-2"><button onClick={handleTestLog} className="text-xs bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded text-white transition-colors">Inject Test Event</button></div>
                   </div>
                   <div className="flex-1 relative"><Terminal logs={displayLogs} height="h-full" onCommand={handleCommand} isInteractive={true} /></div>
              </div>
              <div className="bg-slate-800 rounded-xl border border-slate-700 flex flex-col overflow-hidden min-h-[300px]">
                  <div className="bg-slate-900 p-3 border-b border-slate-700 flex justify-between items-center">
                      <div className="flex items-center text-xs font-bold text-slate-300"><HistoryIcon className="w-3 h-3 mr-2 text-blue-400" /> COMMAND HISTORY</div>
                      <span className="bg-slate-700 text-slate-300 text-[10px] px-2 py-0.5 rounded-full">{commandHistory.length}</span>
                  </div>
                  <div className="flex-1 overflow-y-auto p-0 scrollbar-thin scrollbar-thumb-slate-700">
                        {commandHistory.length === 0 && <div className="flex flex-col items-center justify-center h-full text-slate-500 text-xs"><TerminalIcon className="w-8 h-8 mb-2 opacity-20" /><p>No remote commands executed.</p></div>}
                        {commandHistory.map(job => (
                            <div key={job.id} className="p-3 border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors group">
                                <div className="flex justify-between items-start mb-1.5">
                                    <code className="text-[11px] text-blue-300 font-mono bg-slate-900 px-1.5 py-0.5 rounded border border-slate-700/50 break-all mr-2">{job.command}</code>
                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0 ${job.status === 'COMPLETED' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : job.status === 'FAILED' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-blue-500/10 text-blue-400 border border-blue-500/20 animate-pulse'}`}>{job.status}</span>
                                </div>
                                <div className="flex justify-between items-center text-[10px] text-slate-500 mb-2 font-mono"><span>{new Date(job.createdAt).toLocaleTimeString()}</span><span>JOB: {job.id.split('-').pop()}</span></div>
                                {job.output && <div className="bg-black/50 p-2 rounded text-[10px] font-mono text-slate-400 whitespace-pre-wrap max-h-32 overflow-y-auto border border-slate-800 scrollbar-thin"><span className="text-slate-600 select-none mr-2">$</span>{job.output}</div>}
                            </div>
                        ))}
                  </div>
              </div>
          </div>
      )}

      {activeTab === 'DECEPTION' && (
          <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-lg">
                       <h3 className="text-lg font-bold text-white mb-4 flex items-center"><Bot className="w-5 h-5 mr-2 text-purple-400" /> Device Persona</h3>
                       <div className="bg-blue-900/20 border border-blue-500/30 rounded p-3 mb-4 flex items-start"><Info className="w-4 h-4 text-blue-400 mr-2 shrink-0 mt-0.5" /><p className="text-xs text-blue-200">Deploying a persona will temporarily restart networking services on the actor. The agent will spoof the MAC Address Vendor, open dummy ports, and update service banners to deceive scanners.</p></div>
                       <div className="space-y-3">
                           {AVAILABLE_PERSONAS.map(p => {
                               const isActive = activePersona.id === p.id;
                               const conflictingPorts = getPersonaConflicts(p);
                               const hasConflict = conflictingPorts.length > 0 && !isActive;
                               return (
                                   <div key={p.id} onClick={() => !hasConflict && handleChangePersona(p.id)} className={`rounded-lg border transition-all overflow-hidden relative ${isActive ? 'bg-purple-900/10 border-purple-500' : hasConflict ? 'bg-slate-900/40 border-slate-800 opacity-60 cursor-not-allowed grayscale' : 'bg-slate-900 border-slate-700 hover:border-slate-500 cursor-pointer'}`}>
                                       <div className="p-3 flex items-center border-b border-slate-700/50">
                                            <div className={`p-2 rounded-full mr-3 ${isActive ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-500'}`}>
                                                {p.icon === 'SERVER' && <Server className="w-4 h-4" />}
                                                {p.icon === 'CAMERA' && <Camera className="w-4 h-4" />}
                                                {p.icon === 'PRINTER' && <Printer className="w-4 h-4" />}
                                                {p.icon === 'PLC' && <Cpu className="w-4 h-4" />}
                                                {p.icon === 'ROUTER' && <Router className="w-4 h-4" />}
                                            </div>
                                            <div className="flex-1">
                                                <div className={`font-bold text-sm ${isActive ? 'text-white' : 'text-slate-300'}`}>{p.name}{hasConflict && <span className="text-[10px] text-red-400 ml-2 font-normal">(Ports Blocked)</span>}</div>
                                                <div className="text-[10px] text-slate-500">{p.description}</div>
                                            </div>
                                            {isChangingPersona && isActive && <Loader className="w-4 h-4 animate-spin text-purple-500" />}
                                            {isActive && !isChangingPersona && <Check className="w-4 h-4 text-purple-500" />}
                                       </div>
                                       <div className="bg-black/20 p-2 text-xs font-mono grid gap-1.5">
                                            <div className="flex items-center"><span className="text-slate-600 font-bold w-16 text-[10px] uppercase">Open Ports</span><div className="flex gap-1 flex-wrap">{p.openPorts.map(port => { const isBlocked = conflictingPorts.includes(port); return (<span key={port} className={`px-1.5 rounded text-[10px] border ${isBlocked && !isActive ? 'bg-red-900/30 text-red-400 border-red-900' : 'bg-slate-800 text-slate-400 border-slate-700'}`} title={isBlocked ? "Port is currently in use by a Tunnel" : ""}>{port}/tcp</span>); })}</div></div>
                                            <div className="flex items-center"><span className="text-slate-600 font-bold w-16 text-[10px] uppercase">MAC OUI</span><span className="text-slate-400 flex items-center text-[10px]"><Fingerprint className="w-3 h-3 mr-1 text-emerald-500" />{p.macVendor || 'Generic'}</span></div>
                                            <div className="flex items-start mt-1"><span className="text-slate-600 font-bold w-16 text-[10px] uppercase pt-0.5">Banner</span><code className="text-[10px] text-yellow-600/80 break-all bg-slate-950 px-1 rounded flex-1">{p.banner}</code></div>
                                       </div>
                                       {hasConflict && <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity backdrop-blur-[1px]"><div className="bg-red-900/90 text-red-200 text-xs px-2 py-1 rounded shadow-lg border border-red-500/50">Conflict: Port {conflictingPorts.join(', ')} in use</div></div>}
                                   </div>
                               );
                           })}
                       </div>
                  </div>
                  <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-lg">
                      <div className="flex justify-between items-center mb-4">
                          <h3 className="text-lg font-bold text-white flex items-center"><FileCode className="w-5 h-5 mr-2 text-yellow-400" /> Honey Files</h3>
                          <div className="flex space-x-2">
                              <button onClick={() => handleDeployDeception('CREDENTIALS')} disabled={isGeneratingDeception} className="bg-yellow-600 hover:bg-yellow-500 text-white px-3 py-1 rounded text-xs font-bold">+ Creds</button>
                              <button onClick={() => handleDeployDeception('CONFIG')} disabled={isGeneratingDeception} className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded text-xs font-bold">+ Config</button>
                          </div>
                      </div>
                      <p className="text-slate-400 text-xs mb-4">Deploy fake files generated by AI to lure attackers. Accessing these files triggers high-severity alerts.</p>
                      <div className="space-y-3">
                          {isGeneratingDeception && <div className="text-center py-4 text-slate-500 text-xs animate-pulse">Generating realistic deception content...</div>}
                          {honeyFiles.length === 0 && !isGeneratingDeception && <div className="text-center text-slate-600 italic py-4 text-xs">No deception files deployed.</div>}
                          {honeyFiles.map((file, i) => (
                              <div key={i} className="bg-slate-900 border border-slate-700 rounded p-3 group relative overflow-hidden">
                                  <div className="flex justify-between items-start mb-1"><div className="font-mono text-sm text-yellow-400 font-bold">{file.filename}</div><div className="text-[10px] text-slate-500">{new Date(file.createdAt).toLocaleDateString()}</div></div>
                                  <div className="text-xs text-slate-500 font-mono mb-2">{file.path}</div>
                                  <div className="bg-black p-2 rounded text-[10px] font-mono text-slate-400 truncate opacity-70 group-hover:opacity-100 transition-opacity">{file.contentPreview}</div>
                              </div>
                          ))}
                      </div>
                  </div>
              </div>
          </div>
      )}

      {activeTab === 'NETWORK' && (
          <div className="space-y-6">
              {/* SENTINEL MODE BANNER */}
              <div className={`rounded-xl border p-6 shadow-lg transition-all ${isSentinelEnabled ? 'bg-red-900/10 border-red-500/50 shadow-red-900/20' : 'bg-slate-800 border-slate-700'}`}>
                  <div className="flex justify-between items-start">
                      <div className="flex items-start">
                          <div className={`p-3 rounded-full mr-4 ${isSentinelEnabled ? 'bg-red-600 text-white animate-pulse' : 'bg-slate-700 text-slate-400'}`}><Siren className="w-6 h-6" /></div>
                          <div>
                              <h3 className={`text-lg font-bold ${isSentinelEnabled ? 'text-red-400' : 'text-white'}`}>TCP Sentinel (Paranoid Mode)</h3>
                              <p className="text-slate-400 text-sm mt-1 max-w-md">When enabled, <span className="font-bold text-white">ANY</span> inbound connection attempt (SYN packet) to this actor will trigger a <span className="font-bold text-red-400">CRITICAL</span> alert. Use during active lockdowns.</p>
                          </div>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer mt-1">
                          <input type="checkbox" checked={isSentinelEnabled} onChange={handleToggleSentinel} className="sr-only peer" />
                          <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-red-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-600"></div>
                      </label>
                  </div>
              </div>

              {/* TRAP PROJECTOR UI */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-[500px]">
                  
                  {/* LEFT: Active Tunnels Dashboard */}
                  <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-lg flex flex-col">
                      <h3 className="text-lg font-bold text-white mb-2 flex items-center"><Network className="w-5 h-5 mr-2 text-emerald-400" /> Active Cloud Tunnels</h3>
                      <p className="text-slate-400 text-xs mb-4">Live connections forwarded to the central server honeypots.</p>
                      
                      <div className="flex-1 space-y-4 overflow-y-auto pr-2">
                          {tunnels.length === 0 && (
                              <div className="h-full flex flex-col items-center justify-center text-slate-500 opacity-50 border-2 border-dashed border-slate-700 rounded-lg">
                                  <Monitor className="w-12 h-12 mb-3" />
                                  <p className="text-sm font-bold">No Active Projections</p>
                                  <p className="text-xs">Select a trap from the catalog to project.</p>
                              </div>
                          )}
                          {tunnels.map(t => (
                              <div key={t.id} className="bg-slate-900 border border-emerald-900/50 p-4 rounded-lg relative overflow-hidden group">
                                  {/* Animated Activity Line */}
                                  <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-transparent via-emerald-500 to-transparent opacity-50 animate-shimmer"></div>
                                  
                                  <div className="flex justify-between items-start">
                                      <div>
                                          <div className="flex items-center">
                                              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse mr-2"></span>
                                              <div className="font-bold text-emerald-400 text-sm">{t.trap.name}</div>
                                          </div>
                                          <div className="text-xs text-slate-400 font-mono mt-1 ml-4">
                                              Local Port: <span className="text-white font-bold">{t.localPort}</span> &rarr; Cloud
                                          </div>
                                          <div className="text-[10px] text-slate-600 mt-2 ml-4 flex items-center">
                                              <Activity className="w-3 h-3 mr-1" /> Uptime: {Math.floor(Math.random()*100)}m
                                          </div>
                                      </div>
                                      <button onClick={() => handleStopTunnel(t.id)} className="bg-slate-800 hover:bg-red-900/50 text-slate-400 hover:text-red-400 p-2 rounded transition-colors border border-slate-700 hover:border-red-500">
                                          <Power className="w-4 h-4" />
                                      </button>
                                  </div>
                              </div>
                          ))}
                      </div>
                  </div>

                  {/* RIGHT: Trap Catalog */}
                  <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-lg flex flex-col">
                      <h3 className="text-lg font-bold text-white mb-2 flex items-center"><Database className="w-5 h-5 mr-2 text-blue-400" /> Trap Catalog</h3>
                      <p className="text-slate-400 text-xs mb-4">Project high-interaction vulnerabilities from the server to this device.</p>
                      
                      <div className="flex-1 space-y-2 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-slate-700">
                          {getAvailableCloudTraps().map(trap => {
                              const isActive = tunnels.some(t => t.trap.id === trap.id);
                              const isPending = pendingTunnel === trap.id;
                              const conflictingPorts = getTunnelConflicts(trap.id);
                              const hasConflict = conflictingPorts.length > 0 && !isActive;
                              
                              return (
                                  <div key={trap.id} className="relative group">
                                      <button 
                                        onClick={() => !hasConflict && handleToggleTunnel(trap.id)} 
                                        disabled={isPending || (hasConflict && !isActive)} 
                                        className={`w-full text-left p-3 rounded border flex items-center justify-between transition-all ${
                                            isActive 
                                            ? 'bg-emerald-900/10 border-emerald-500/50' 
                                            : hasConflict 
                                                ? 'bg-slate-900/40 border-slate-800 cursor-not-allowed grayscale opacity-60' 
                                                : 'bg-slate-900 border-slate-700 hover:border-blue-500 hover:bg-slate-800'
                                        }`}
                                      >
                                          <div className="flex items-center">
                                              <div className={`p-2 rounded mr-3 ${isActive ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-500'}`}>
                                                  <Server className="w-4 h-4" />
                                              </div>
                                              <div>
                                                  <div className={`font-bold text-sm ${isActive ? 'text-emerald-400' : 'text-slate-200'}`}>{trap.name}</div>
                                                  <div className="text-xs text-slate-500">{trap.serviceType} <span className="opacity-50">({DEFAULT_TRAP_PORTS[trap.id] || 'Dynamic'})</span></div>
                                              </div>
                                          </div>
                                          
                                          <div className="flex items-center">
                                              {isPending ? (
                                                  <Loader className="w-4 h-4 animate-spin text-blue-400" />
                                              ) : (
                                                  <div className={`w-8 h-4 rounded-full relative transition-colors ${isActive ? 'bg-emerald-500' : 'bg-slate-700'}`}>
                                                      <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${isActive ? 'left-[18px]' : 'left-0.5'}`} />
                                                  </div>
                                              )}
                                          </div>
                                      </button>
                                      
                                      {hasConflict && (
                                          <div className="absolute inset-0 hidden group-hover:flex items-center justify-center pointer-events-none z-10">
                                              <div className="bg-red-900/90 text-red-200 text-xs px-2 py-1 rounded shadow-lg border border-red-500/50 backdrop-blur-[1px]">
                                                  Port {conflictingPorts.join(', ')} occupied
                                              </div>
                                          </div>
                                      )}
                                  </div>
                              );
                          })}
                      </div>

                      {/* Custom Forwarding */}
                      <div className="border-t border-slate-700 pt-4 mt-2">
                          <h4 className="text-xs font-bold text-slate-400 uppercase mb-2">Custom Projection</h4>
                          <div className="flex gap-2">
                              <input 
                                placeholder="Port (e.g. 8080)" 
                                className="bg-slate-900 border border-slate-600 rounded px-2 py-2 text-xs text-white outline-none w-24 focus:border-blue-500" 
                                value={customPort} 
                                onChange={e => setCustomPort(e.target.value)} 
                              />
                              <input 
                                placeholder="Service Name" 
                                className="bg-slate-900 border border-slate-600 rounded px-2 py-2 text-xs text-white outline-none flex-1 focus:border-blue-500" 
                                value={customService} 
                                onChange={e => setCustomService(e.target.value)} 
                              />
                              <button 
                                onClick={handleStartCustomTunnel} 
                                disabled={!customPort} 
                                className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded text-xs font-bold disabled:opacity-50"
                              >
                                OPEN
                              </button>
                          </div>
                      </div>
                  </div>
              </div>
          </div>
      )}

    </div>
  );
};

export default ActorDetail;
