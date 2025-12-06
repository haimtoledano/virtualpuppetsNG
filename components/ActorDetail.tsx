
import React, { useState, useEffect, useMemo } from 'react';
import { Actor, LogEntry, ActorStatus, AiAnalysis, ProxyGateway, HoneyFile, ActiveTunnel, DevicePersona, CommandJob, LogLevel } from '../types';
import { executeRemoteCommand, getAvailableCloudTraps, toggleTunnelMock, AVAILABLE_PERSONAS, generateRandomLog } from '../services/mockService';
import { analyzeLogsWithAi, generateDeceptionContent } from '../services/aiService';
import { updateActorName, queueSystemCommand, getActorCommands, deleteActor, updateActorTunnels, updateActorPersona, resetActorStatus } from '../services/dbService';
import Terminal from './Terminal';
import { Cpu, Wifi, Shield, Bot, ArrowLeft, BrainCircuit, Router, Network, FileCode, Check, Activity, X, Printer, Camera, Server, Edit2, Trash2, Loader, ShieldCheck, AlertOctagon, Skull, ArrowRight, Terminal as TerminalIcon, Globe, ScanSearch, Power, RefreshCw, History as HistoryIcon, Thermometer } from 'lucide-react';

interface ActorDetailProps {
  actor: Actor;
  gateway?: ProxyGateway;
  logs: LogEntry[];
  onBack: () => void;
  isProduction?: boolean;
}

const DEFAULT_TRAP_PORTS: Record<string, number> = {
    'trap-oracle-01': 1521,
    'trap-win-rdp': 3389,
    'trap-scada-plc': 102,
    'trap-elastic': 9200
};

const ActorDetail: React.FC<ActorDetailProps> = ({ actor, gateway, logs: initialLogs, onBack, isProduction }) => {
  const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'TERMINAL' | 'DECEPTION' | 'NETWORK'>('OVERVIEW');
  
  // Local log state for "Live Telemetry" injection
  const [localLogs, setLocalLogs] = useState<LogEntry[]>([]);
  const displayLogs = [...initialLogs, ...localLogs].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // IP State
  const [displayedLocalIp, setDisplayedLocalIp] = useState<string | null>(null);
  const [isScanningIp, setIsScanningIp] = useState(false);

  // Edit Name State
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(actor.name);
  const [isDeleting, setIsDeleting] = useState(false);

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

  // --- MOCK SIMULATION FOR LIVE TELEMETRY ---
  useEffect(() => {
      if (isProduction) return;
      // In mock mode, generate specific logs for THIS actor occasionally so the Live Telemetry isn't empty
      const interval = setInterval(() => {
          if (Math.random() > 0.6) { // 40% chance every 3s
              const mockLog = generateRandomLog([actor]);
              setLocalLogs(prev => [mockLog, ...prev].slice(0, 50));
          }
      }, 3000);
      return () => clearInterval(interval);
  }, [isProduction, actor]);

  // --- AUTO SCAN INTERNAL IP ---
  useEffect(() => {
      // Trigger scan on mount or actor change
      handleFetchIp();
  }, [actor.id]);

  // Polling for command results (including IP scan)
  useEffect(() => {
    // Only poll API in production. In mock mode, we update locally.
    if (!isProduction) return;

    const interval = setInterval(async () => {
        const cmds = await getActorCommands(actor.id);
        setCommandHistory(cmds);
        
        // Check for hostname -I result if we are scanning
        if (isScanningIp) {
            const ipJob = cmds.find(c => c.command === 'hostname -I' && c.status === 'COMPLETED');
            if (ipJob && ipJob.output) {
                // Clean output (remove newlines, take first IP)
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

  const handleFetchIp = async () => {
      // Prevent duplicate scans if one is already pending/running
      let hasPending = false;

      // Check local state first
      if (commandHistory.some(c => c.command === 'hostname -I' && (c.status === 'PENDING' || c.status === 'RUNNING'))) {
          hasPending = true;
      }
      
      // If in production, do a quick check against DB state to be sure
      if (isProduction && !hasPending) {
          const remoteCmds = await getActorCommands(actor.id);
          if (remoteCmds.some(c => c.command === 'hostname -I' && (c.status === 'PENDING' || c.status === 'RUNNING'))) {
              hasPending = true;
              setCommandHistory(remoteCmds); // Sync state while we are at it
          }
      }

      if (hasPending) {
          setIsScanningIp(true); // Ensure UI shows scanning if pending
          return;
      }

      setIsScanningIp(true);
      await handleCommand('hostname -I');
  };

  const handleCommand = async (cmd: string) => {
      if (isProduction) {
          await queueSystemCommand(actor.id, cmd);
      } else {
          // Mock Mode Execution
          const newJob: CommandJob = {
              id: `job-mock-${Date.now()}`,
              actorId: actor.id,
              command: cmd,
              status: 'RUNNING',
              createdAt: new Date(),
              updatedAt: new Date()
          };
          setCommandHistory(prev => [newJob, ...prev]);
          
          // Simulate latency
          executeRemoteCommand(actor.id, cmd).then(output => {
               setCommandHistory(prev => prev.map(job => 
                  job.id === newJob.id 
                  ? { ...job, status: 'COMPLETED', output } 
                  : job
               ));

               // Handle IP Scan mock
               if (cmd === 'hostname -I') {
                   setDisplayedLocalIp(actor.localIp);
                   setIsScanningIp(false);
               }
          });
      }
  };

  const handleSaveName = async () => {
      if (editedName.trim() !== actor.name) {
          await updateActorName(actor.id, editedName);
      }
      setIsEditingName(false);
  };

  const handleDeleteActor = async () => {
      if (confirm(`Are you sure you want to decommission ${actor.name}? This will attempt to uninstall the agent from the device and then remove the record.`)) {
          setIsDeleting(true);
          try {
             await deleteActor(actor.id);
             onBack();
          } catch (e) {
             alert("Delete failed, check console.");
          } finally {
             setIsDeleting(false);
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
      // Optimistic update
      actor.status = ActorStatus.ONLINE;
  };

  const handleDeployDeception = async (type: 'CREDENTIALS' | 'CONFIG') => {
      setIsGeneratingDeception(true);
      const file = await generateDeceptionContent(type);
      if (file) {
          // Force path to /home/ for reliability as per user request
          const targetPath = `/home/${file.filename}`;
          // Update the file object to reflect the actual path
          const updatedFile = { ...file, path: '/home/' };
          
          setHoneyFiles(prev => [...prev, updatedFile]);
          await handleCommand(`echo "${file.contentPreview}" > ${targetPath}`);
      }
      setIsGeneratingDeception(false);
  };

  const handleStopTunnel = async (tunnelId: string) => {
      // Look up the tunnel BEFORE removing from state to get the port
      const tunnelToStop = tunnels.find(t => t.id === tunnelId);
      
      const updatedTunnels = tunnels.filter(t => t.id !== tunnelId);
      setTunnels(updatedTunnels);
      
      // Persist changes
      if (isProduction) await updateActorTunnels(actor.id, updatedTunnels);
      
      if (tunnelToStop) {
        // Correct Kill Command: Kill the process listening on this specific port
        await handleCommand(`pkill -f "TCP-LISTEN:${tunnelToStop.localPort}" || true`);
      } else {
        await handleCommand(`pkill -f "socat" || true`);
      }
  };

  const handleToggleTunnel = async (trapId: string) => {
      setPendingTunnel(trapId);
      
      // Check if already active -> Stop it
      const activeTunnel = tunnels.find(t => t.trap.id === trapId);
      if (activeTunnel) {
          await handleStopTunnel(activeTunnel.id);
          setPendingTunnel(null);
          return;
      }

      // Determine Port
      const port = DEFAULT_TRAP_PORTS[trapId] || (3306 + tunnels.length);

      const newTunnel = await toggleTunnelMock(actor, trapId, port); 
      const updatedTunnels = [...tunnels, newTunnel];
      setTunnels(updatedTunnels);
      
      // Persist
      if (isProduction) await updateActorTunnels(actor.id, updatedTunnels);
      
      // START TUNNEL COMMAND
      // Using a local sink echo server to simulate an open connection without needing a real cloud destination
      // This ensures the connection stays ESTABLISHED for detection logic to work
      await handleCommand(`nohup socat TCP-LISTEN:${port},fork SYSTEM:'echo VPP_TRAP_SINK; cat' >/dev/null 2>&1 & # ${newTunnel.id}`);
      
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
      
      // START CUSTOM TUNNEL COMMAND
      await handleCommand(`nohup socat TCP-LISTEN:${port},fork SYSTEM:'echo VPP_TRAP_SINK; cat' >/dev/null 2>&1 & # ${newTunnel.id}`);
      
      setCustomPort('');
  };

  const handleChangePersona = async (personaId: string) => {
      const p = AVAILABLE_PERSONAS.find(x => x.id === personaId);
      if (!p) return;
      setIsChangingPersona(true);
      
      if (isProduction) await updateActorPersona(actor.id, p);
      await handleCommand(`vpp-agent --set-persona "${p.name}"`); // Notify agent
      
      setTimeout(() => {
          setActivePersona(p);
          setIsChangingPersona(false);
      }, 2000);
  };

  const handleTestLog = () => {
      const mockLog = generateRandomLog([actor]);
      mockLog.message = "[TEST EVENT] Manual verification trigger initiated by admin.";
      mockLog.level = LogLevel.INFO;
      setLocalLogs(prev => [mockLog, ...prev]);
  };

  // --- THREAT TOPOLOGY LOGIC ---
  const threatTopology = useMemo(() => {
      const threats = new Map<string, { ip: string, protocol: string, count: number }>();
      const intercepted: string[] = [];
      const ipRegex = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/;

      displayLogs.forEach(log => {
          let attackerIp = log.sourceIp;

          // If no structured SourceIP, try to extract from message (common in raw syslog/socat)
          if (!attackerIp && (log.level === 'WARNING' || log.level === 'CRITICAL')) {
              const match = log.message.match(ipRegex);
              if (match) {
                  attackerIp = match[0];
                  // Avoid self-flagging if it picks up local IP
                  if (attackerIp === '127.0.0.1' || attackerIp === '0.0.0.0' || attackerIp === actor.localIp || attackerIp === displayedLocalIp) {
                      attackerIp = undefined;
                  }
              }
          }

          if (attackerIp && (log.level === 'WARNING' || log.level === 'CRITICAL')) {
              const existing = threats.get(attackerIp) || { ip: attackerIp, protocol: log.process, count: 0 };
              existing.count++;
              threats.set(attackerIp, existing);
          }
          // Simple heuristic for command interception in logs
          if (log.message.includes('cmd:') || log.message.includes('Executing') || log.message.includes('stdin')) {
              // Extract command part
              const clean = log.message.replace(/.*cmd: /, '').replace(/.*Executing /, '');
              if (!intercepted.includes(clean)) intercepted.push(clean);
          }
      });

      return {
          attackers: Array.from(threats.values()),
          payloads: intercepted.slice(0, 5) // Show top 5
      };
  }, [displayLogs, actor.localIp, displayedLocalIp]);

  const activeThreats = threatTopology.attackers;

  // Formatting helpers
  const getTempColor = (temp?: number) => {
      if (!temp) return 'bg-slate-700';
      if (temp < 60) return 'bg-emerald-500';
      if (temp < 80) return 'bg-yellow-500';
      return 'bg-red-500';
  };

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      
      {/* HEADER */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-xl relative overflow-hidden">
        {/* Background Decorative Gradient */}
        <div className={`absolute top-0 right-0 w-64 h-64 bg-gradient-to-br opacity-10 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none
            ${actor.status === 'COMPROMISED' ? 'from-red-500 to-orange-500' : 'from-blue-500 to-emerald-500'}`} 
        />

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
                                    <input 
                                        className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xl font-bold text-white focus:border-blue-500 outline-none"
                                        value={editedName}
                                        onChange={(e) => setEditedName(e.target.value)}
                                        autoFocus
                                    />
                                    <button onClick={handleSaveName} className="ml-2 bg-green-600 p-1.5 rounded text-white"><Check className="w-4 h-4"/></button>
                                    <button onClick={() => setIsEditingName(false)} className="ml-1 bg-slate-600 p-1.5 rounded text-white"><X className="w-4 h-4"/></button>
                                </div>
                            ) : (
                                <h1 className="text-3xl font-bold text-white tracking-tight flex items-center group">
                                    {actor.name}
                                    <button onClick={() => setIsEditingName(true)} className="ml-3 opacity-0 group-hover:opacity-100 text-slate-500 hover:text-blue-400 transition-all">
                                        <Edit2 className="w-4 h-4" />
                                    </button>
                                </h1>
                            )}
                            <div className={`px-3 py-1 rounded-full text-xs font-bold flex items-center border ${
                                actor.status === 'ONLINE' ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400' :
                                actor.status === 'COMPROMISED' ? 'bg-red-500/10 border-red-500/50 text-red-500 animate-pulse' :
                                'bg-slate-500/10 border-slate-500/50 text-slate-400'
                            }`}>
                                {actor.status === 'COMPROMISED' && <AlertOctagon className="w-3 h-3 mr-1" />}
                                {actor.status}
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-4 mt-2 text-sm text-slate-400 font-mono">
                            <span className="flex items-center"><TerminalIcon className="w-3 h-3 mr-1" /> {actor.id}</span>
                            <span className="flex items-center"><Router className="w-3 h-3 mr-1" /> {gateway?.name || 'Direct Uplink'}</span>
                            <span className="flex items-center"><Cpu className="w-3 h-3 mr-1" /> {actor.osVersion}</span>
                        </div>
                    </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 mt-4 md:mt-0">
                    {actor.status === 'COMPROMISED' && (
                        <button 
                            onClick={handleResetStatus}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg font-bold flex items-center shadow-lg shadow-emerald-600/20"
                        >
                            <ShieldCheck className="w-4 h-4 mr-2" />
                            ACKNOWLEDGE & RESET
                        </button>
                    )}
                    <button 
                        onClick={handleDeleteActor} 
                        disabled={isDeleting}
                        className={`bg-slate-700 hover:bg-red-600 hover:text-slate-300 text-slate-300 px-4 py-2 rounded-lg transition-colors flex items-center font-bold text-xs ${isDeleting ? 'opacity-70 cursor-not-allowed' : ''}`}
                        title="Decommission & Uninstall"
                    >
                        {isDeleting ? (
                            <>
                                <Loader className="w-4 h-4 animate-spin mr-2" />
                                UNINSTALLING...
                            </>
                        ) : (
                            <>
                                <Trash2 className="w-4 h-4 mr-2" />
                                DECOMMISSION
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* Network Stats Bar */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 bg-slate-900/50 rounded-lg p-4 border border-slate-700/50">
                 {/* External IP */}
                <div>
                    <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center">
                        <Globe className="w-3 h-3 mr-1" /> External IP (WAN)
                    </div>
                    <div className="text-slate-200 font-mono text-sm flex items-center">
                        {actor.localIp}
                        {gateway && <span className="ml-2 text-[10px] bg-indigo-900 text-indigo-300 px-1 rounded">PROXY</span>}
                    </div>
                </div>

                {/* Internal IP (Auto-Scanned) */}
                <div>
                     <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center">
                        <Wifi className="w-3 h-3 mr-1" /> Internal IP (LAN)
                    </div>
                    <div className="text-slate-200 font-mono text-sm flex items-center h-5">
                        {isScanningIp ? (
                            <span className="text-blue-400 text-xs flex items-center animate-pulse">
                                <ScanSearch className="w-3 h-3 mr-1" /> Scanning...
                            </span>
                        ) : (
                            <>
                                {displayedLocalIp || <span className="text-slate-600 italic">Unknown</span>}
                                <button 
                                    onClick={handleFetchIp} 
                                    className="ml-2 text-slate-500 hover:text-white transition-colors"
                                    title="Rescan Internal IP"
                                >
                                    <RefreshCw className="w-3 h-3" />
                                </button>
                            </>
                        )}
                    </div>
                </div>

                <div>
                    <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1">CPU Load</div>
                    <div className="w-full bg-slate-700 h-1.5 rounded-full mt-2 overflow-hidden">
                        <div className={`${getTempColor(actor.cpuLoad)} h-1.5 rounded-full transition-all duration-1000`} style={{ width: `${actor.cpuLoad || 0}%` }}></div>
                    </div>
                    <div className="text-right text-[10px] text-slate-400 mt-1">{(actor.cpuLoad || 0).toFixed(1)}%</div>
                </div>
                <div>
                     <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1">RAM Usage</div>
                    <div className="w-full bg-slate-700 h-1.5 rounded-full mt-2 overflow-hidden">
                        <div className="bg-blue-500 h-1.5 rounded-full transition-all duration-1000" style={{ width: `${actor.memoryUsage || 0}%` }}></div>
                    </div>
                     <div className="text-right text-[10px] text-slate-400 mt-1">{(actor.memoryUsage || 0).toFixed(1)}%</div>
                </div>
                <div>
                     <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center"><Thermometer className="w-3 h-3 mr-1" /> Temperature</div>
                     <div className="flex items-center space-x-2 mt-1">
                         <div className={`w-2 h-2 rounded-full ${getTempColor(actor.temperature)}`}></div>
                         <div className="text-slate-200 font-mono text-sm">{actor.temperature ? `${actor.temperature.toFixed(1)}°C` : 'N/A'}</div>
                     </div>
                     <div className="w-full bg-slate-700 h-1.5 rounded-full mt-2 overflow-hidden">
                         <div className={`${getTempColor(actor.temperature)} h-1.5 rounded-full transition-all duration-1000`} style={{ width: `${Math.min(100, (actor.temperature || 0))}%` }}></div>
                     </div>
                </div>
            </div>
        </div>
      </div>

      {/* THREAT VISUALIZATION (Dynamic) */}
      {(actor.status === 'COMPROMISED' || activeThreats.length > 0) && (
          <div className="bg-slate-900 border border-red-500/40 rounded-xl p-0 overflow-hidden shadow-2xl shadow-red-900/10 animate-slide-up">
              <div className="bg-red-900/20 px-6 py-3 border-b border-red-500/30 flex justify-between items-center">
                  <h3 className="text-red-400 font-bold flex items-center text-sm tracking-wider">
                      <Activity className="w-4 h-4 mr-2" /> LIVE THREAT TOPOLOGY
                  </h3>
                  <span className="text-[10px] text-red-300 font-mono uppercase animate-pulse">Attack in Progress</span>
              </div>
              
              <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-8">
                  {/* Left: Attack Sources */}
                  <div className="lg:col-span-2 space-y-4">
                        {activeThreats.length === 0 && (
                             <div className="text-slate-500 text-sm italic p-4 text-center">Analysing traffic logs for attacker IP...</div>
                        )}
                        {activeThreats.map((threat, idx) => (
                            <div key={idx} className="flex items-center justify-between group">
                                {/* Attacker Node */}
                                <div className="bg-slate-800 p-3 rounded-lg border border-slate-600 group-hover:border-red-500 transition-colors w-40 relative">
                                    <div className="absolute -top-2 -left-2 bg-red-600 rounded-full p-1 shadow-lg z-10">
                                        <Skull className="w-3 h-3 text-white" />
                                    </div>
                                    <div className="text-xs text-slate-500 font-bold uppercase mb-1">Attacker</div>
                                    <div className="text-red-400 font-mono font-bold text-sm">{threat.ip}</div>
                                    <div className="text-[10px] text-slate-500 mt-1">{threat.count} Events</div>
                                </div>

                                {/* Connection Line */}
                                <div className="flex-1 mx-4 relative h-8 flex items-center">
                                    {/* Line */}
                                    <div className="w-full h-0.5 bg-slate-700 relative overflow-hidden">
                                        <div className="absolute inset-0 bg-red-500/50 animate-progress"></div>
                                    </div>
                                    {/* Protocol Label */}
                                    <span className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-slate-900 px-2 text-[10px] text-red-300 font-mono border border-red-900 rounded">
                                        {threat.protocol.toUpperCase()}
                                    </span>
                                    {/* Arrow Head */}
                                    <ArrowRight className="absolute right-0 text-slate-700 w-4 h-4" />
                                </div>

                                {/* Target Node (Self) */}
                                <div className="bg-slate-800 p-3 rounded-lg border border-blue-500/30 w-40 relative">
                                     <div className="absolute -top-2 -right-2 bg-blue-600 rounded-full p-1 shadow-lg z-10">
                                        <Shield className="w-3 h-3 text-white" />
                                    </div>
                                    <div className="text-xs text-slate-500 font-bold uppercase mb-2">Target (Self)</div>
                                    
                                    <div className="mb-1">
                                        <span className="text-[10px] text-slate-500 font-mono mr-1">LAN:</span>
                                        <span className="text-white font-mono font-bold text-xs">
                                            {displayedLocalIp || <span className="text-slate-600 italic">---</span>}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-[10px] text-slate-500 font-mono mr-1">WAN:</span>
                                        <span className="text-blue-400 font-mono font-bold text-xs">{actor.localIp}</span>
                                    </div>
                                    
                                    <div className="text-[10px] text-slate-500 mt-2 border-t border-slate-700 pt-1 truncate">{actor.name}</div>
                                </div>
                            </div>
                        ))}
                  </div>

                  {/* Right: Payload Analysis */}
                  <div className="bg-slate-950 rounded border border-slate-800 p-4 font-mono text-xs">
                       <h4 className="text-slate-500 font-bold uppercase mb-3 flex items-center"><TerminalIcon className="w-3 h-3 mr-2"/> Captured Payloads</h4>
                       <div className="space-y-2">
                           {threatTopology.payloads.length === 0 ? <span className="text-slate-600 italic">No payload data intercepted.</span> : 
                             threatTopology.payloads.map((p, i) => (
                                 <div key={i} className="text-green-400 border-b border-slate-800 pb-1 break-all">
                                     &gt; {p}
                                 </div>
                             ))
                           }
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
          <button onClick={() => setActiveTab('NETWORK')} className={`pb-3 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${activeTab === 'NETWORK' ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-slate-500 hover:text-white'}`}>NETWORK & TUNNELS</button>
      </div>

      {/* TABS CONTENT */}
      
      {activeTab === 'OVERVIEW' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* AI Analysis */}
              <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-lg">
                  <div className="flex justify-between items-center mb-4">
                      <h3 className="text-lg font-bold text-white flex items-center"><BrainCircuit className="w-5 h-5 mr-2 text-purple-400" /> AI Threat Analysis</h3>
                      <button 
                        onClick={handleAiAnalyze}
                        disabled={isAnalyzing}
                        className="bg-purple-600 hover:bg-purple-500 text-white px-3 py-1 rounded text-xs font-bold transition-colors disabled:opacity-50 flex items-center"
                      >
                          {isAnalyzing ? <Loader className="w-3 h-3 animate-spin mr-1"/> : <Bot className="w-3 h-3 mr-1"/>}
                          {isAnalyzing ? 'Analyzing...' : 'Analyze Logs'}
                      </button>
                  </div>
                  {aiAnalysis ? (
                      <div className="space-y-4 animate-fade-in">
                          <div className={`p-3 rounded border ${
                              aiAnalysis.threatLevel === 'HIGH' ? 'bg-red-500/10 border-red-500 text-red-400' : 
                              aiAnalysis.threatLevel === 'MEDIUM' ? 'bg-yellow-500/10 border-yellow-500 text-yellow-400' : 
                              'bg-emerald-500/10 border-emerald-500 text-emerald-400'
                          }`}>
                              <div className="font-bold text-xs uppercase mb-1">Threat Level</div>
                              <div className="text-xl font-bold">{aiAnalysis.threatLevel}</div>
                          </div>
                          <div>
                              <div className="font-bold text-slate-400 text-xs uppercase mb-1">Summary</div>
                              <p className="text-slate-300 text-sm leading-relaxed">{aiAnalysis.summary}</p>
                          </div>
                          <div>
                               <div className="font-bold text-slate-400 text-xs uppercase mb-1">Recommended Actions</div>
                               <ul className="list-disc list-inside text-slate-300 text-sm space-y-1">
                                   {aiAnalysis.recommendedActions.map((action, i) => <li key={i}>{action}</li>)}
                               </ul>
                          </div>
                      </div>
                  ) : (
                      <div className="text-center py-10 text-slate-500 text-sm">
                          <Bot className="w-10 h-10 mx-auto mb-3 opacity-20" />
                          <p>Click analyze to process recent log telemetry.</p>
                      </div>
                  )}
              </div>

               {/* Recent Activity */}
               <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-lg flex flex-col">
                   <h3 className="text-lg font-bold text-white mb-4 flex items-center"><Activity className="w-5 h-5 mr-2 text-blue-400" /> Recent Activity</h3>
                   <div className="flex-1 overflow-y-auto max-h-[300px] space-y-2 pr-2 scrollbar-thin scrollbar-thumb-slate-700">
                       {displayLogs.slice(0, 20).map(log => (
                           <div key={log.id} className="text-xs border-b border-slate-700/50 pb-2 mb-2 last:border-0">
                               <div className="flex justify-between text-slate-500 mb-1">
                                   <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                                   <span className={log.level === 'CRITICAL' ? 'text-red-500 font-bold' : log.level === 'WARNING' ? 'text-yellow-500' : 'text-blue-400'}>{log.level}</span>
                               </div>
                               <div className="text-slate-300 font-mono break-all">{log.message}</div>
                           </div>
                       ))}
                   </div>
               </div>
          </div>
      )}

      {activeTab === 'TERMINAL' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-auto lg:h-[600px]">
              
              {/* Terminal Section */}
              <div className="lg:col-span-2 flex flex-col bg-slate-800 rounded-xl border border-slate-700 p-1 overflow-hidden min-h-[400px]">
                   <div className="bg-slate-900 p-2 flex justify-between items-center border-b border-slate-700">
                       <div className="flex items-center text-xs text-slate-400">
                           <TerminalIcon className="w-3 h-3 mr-2" />
                           SSH Session: root@{actor.localIp}
                       </div>
                       <div className="flex space-x-2">
                           <button onClick={handleTestLog} className="text-xs bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded text-white transition-colors">Inject Test Event</button>
                       </div>
                   </div>
                   <div className="flex-1 relative">
                       <Terminal logs={displayLogs} height="h-full" onCommand={handleCommand} isInteractive={true} />
                   </div>
              </div>

              {/* History Section */}
              <div className="bg-slate-800 rounded-xl border border-slate-700 flex flex-col overflow-hidden min-h-[300px]">
                  <div className="bg-slate-900 p-3 border-b border-slate-700 flex justify-between items-center">
                      <div className="flex items-center text-xs font-bold text-slate-300">
                          <HistoryIcon className="w-3 h-3 mr-2 text-blue-400" />
                          COMMAND HISTORY
                      </div>
                      <span className="bg-slate-700 text-slate-300 text-[10px] px-2 py-0.5 rounded-full">{commandHistory.length}</span>
                  </div>
                  <div className="flex-1 overflow-y-auto p-0 scrollbar-thin scrollbar-thumb-slate-700">
                        {commandHistory.length === 0 && (
                            <div className="flex flex-col items-center justify-center h-full text-slate-500 text-xs">
                                <TerminalIcon className="w-8 h-8 mb-2 opacity-20" />
                                <p>No remote commands executed.</p>
                            </div>
                        )}
                        {commandHistory.map(job => (
                            <div key={job.id} className="p-3 border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors group">
                                <div className="flex justify-between items-start mb-1.5">
                                    <code className="text-[11px] text-blue-300 font-mono bg-slate-900 px-1.5 py-0.5 rounded border border-slate-700/50 break-all mr-2">
                                        {job.command}
                                    </code>
                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0 ${
                                        job.status === 'COMPLETED' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                                        job.status === 'FAILED' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                                        'bg-blue-500/10 text-blue-400 border border-blue-500/20 animate-pulse'
                                    }`}>
                                        {job.status}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center text-[10px] text-slate-500 mb-2 font-mono">
                                    <span>{new Date(job.createdAt).toLocaleTimeString()}</span>
                                    <span>JOB: {job.id.split('-').pop()}</span>
                                </div>
                                {job.output && (
                                    <div className="bg-black/50 p-2 rounded text-[10px] font-mono text-slate-400 whitespace-pre-wrap max-h-32 overflow-y-auto border border-slate-800 scrollbar-thin">
                                        <span className="text-slate-600 select-none mr-2">$</span>
                                        {job.output}
                                    </div>
                                )}
                            </div>
                        ))}
                  </div>
              </div>
          </div>
      )}

      {activeTab === 'DECEPTION' && (
          <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Persona Management */}
                  <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-lg">
                       <h3 className="text-lg font-bold text-white mb-4 flex items-center"><Bot className="w-5 h-5 mr-2 text-purple-400" /> Device Persona</h3>
                       <p className="text-slate-400 text-xs mb-4">
                           Configure how this device appears to scanners (nmap/shodan). Changing persona will restart network services.
                       </p>
                       
                       <div className="space-y-3">
                           {AVAILABLE_PERSONAS.map(p => (
                               <div 
                                   key={p.id} 
                                   onClick={() => handleChangePersona(p.id)}
                                   className={`cursor-pointer p-3 rounded border transition-all flex items-center ${activePersona.id === p.id ? 'bg-purple-900/20 border-purple-500' : 'bg-slate-900 border-slate-700 hover:border-slate-500'}`}
                               >
                                   <div className={`p-2 rounded-full mr-3 ${activePersona.id === p.id ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-500'}`}>
                                       {p.icon === 'SERVER' && <Server className="w-4 h-4" />}
                                       {p.icon === 'CAMERA' && <Camera className="w-4 h-4" />}
                                       {p.icon === 'PRINTER' && <Printer className="w-4 h-4" />}
                                       {p.icon === 'PLC' && <Cpu className="w-4 h-4" />}
                                       {p.icon === 'ROUTER' && <Router className="w-4 h-4" />}
                                   </div>
                                   <div className="flex-1">
                                       <div className="font-bold text-sm text-slate-200">{p.name}</div>
                                       <div className="text-xs text-slate-500">{p.description}</div>
                                   </div>
                                   {isChangingPersona && activePersona.id === p.id && <Loader className="w-4 h-4 animate-spin text-purple-500" />}
                                   {activePersona.id === p.id && !isChangingPersona && <Check className="w-4 h-4 text-purple-500" />}
                               </div>
                           ))}
                       </div>
                  </div>

                  {/* Honey Files */}
                  <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-lg">
                      <div className="flex justify-between items-center mb-4">
                          <h3 className="text-lg font-bold text-white flex items-center"><FileCode className="w-5 h-5 mr-2 text-yellow-400" /> Honey Files</h3>
                          <div className="flex space-x-2">
                              <button 
                                onClick={() => handleDeployDeception('CREDENTIALS')} 
                                disabled={isGeneratingDeception}
                                className="bg-yellow-600 hover:bg-yellow-500 text-white px-3 py-1 rounded text-xs font-bold"
                              >
                                  + Creds
                              </button>
                              <button 
                                onClick={() => handleDeployDeception('CONFIG')}
                                disabled={isGeneratingDeception} 
                                className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded text-xs font-bold"
                              >
                                  + Config
                              </button>
                          </div>
                      </div>
                      <p className="text-slate-400 text-xs mb-4">
                           Deploy fake files generated by AI to lure attackers. Accessing these files triggers high-severity alerts.
                      </p>

                      <div className="space-y-3">
                          {isGeneratingDeception && (
                              <div className="text-center py-4 text-slate-500 text-xs animate-pulse">
                                  Generating realistic deception content...
                              </div>
                          )}
                          {honeyFiles.length === 0 && !isGeneratingDeception && <div className="text-center text-slate-600 italic py-4 text-xs">No deception files deployed.</div>}
                          {honeyFiles.map((file, i) => (
                              <div key={i} className="bg-slate-900 border border-slate-700 rounded p-3 group relative overflow-hidden">
                                  <div className="flex justify-between items-start mb-1">
                                      <div className="font-mono text-sm text-yellow-400 font-bold">{file.filename}</div>
                                      <div className="text-[10px] text-slate-500">{new Date(file.createdAt).toLocaleDateString()}</div>
                                  </div>
                                  <div className="text-xs text-slate-500 font-mono mb-2">{file.path}</div>
                                  <div className="bg-black p-2 rounded text-[10px] font-mono text-slate-400 truncate opacity-70 group-hover:opacity-100 transition-opacity">
                                      {file.contentPreview}
                                  </div>
                              </div>
                          ))}
                      </div>
                  </div>
              </div>
          </div>
      )}

      {activeTab === 'NETWORK' && (
          <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Active Tunnels */}
                  <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-lg">
                      <h3 className="text-lg font-bold text-white mb-4 flex items-center"><Network className="w-5 h-5 mr-2 text-emerald-400" /> Active Cloud Tunnels</h3>
                      <div className="space-y-4">
                          {tunnels.length === 0 && <div className="text-center py-8 text-slate-500 text-sm">No active tunnels. Services are local only.</div>}
                          {tunnels.map(t => (
                              <div key={t.id} className="bg-slate-900 border border-emerald-900/50 p-4 rounded-lg flex justify-between items-center">
                                  <div>
                                      <div className="font-bold text-emerald-400 text-sm">{t.trap.serviceType} Trap</div>
                                      <div className="text-xs text-slate-400 font-mono mt-1">
                                          :{t.localPort} &rarr; {t.remoteEndpoint}
                                      </div>
                                      <div className="text-[10px] text-slate-600 mt-1">Uptime: {Math.floor(Math.random()*100)}m • {t.status}</div>
                                  </div>
                                  <button onClick={() => handleStopTunnel(t.id)} className="bg-slate-800 hover:bg-red-900/50 text-slate-400 hover:text-red-400 p-2 rounded transition-colors">
                                      <Power className="w-4 h-4" />
                                  </button>
                              </div>
                          ))}
                      </div>
                  </div>

                  {/* Available Traps */}
                  <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-lg">
                      <h3 className="text-lg font-bold text-white mb-4 flex items-center"><Globe className="w-5 h-5 mr-2 text-blue-400" /> Cloud Services (Forwarding)</h3>
                      <p className="text-slate-400 text-xs mb-4">
                          Open ports on this device that forward traffic to high-interaction cloud honeypots.
                      </p>
                      
                      <div className="space-y-3 mb-6">
                          {getAvailableCloudTraps().map(trap => {
                              const isActive = tunnels.some(t => t.trap.id === trap.id);
                              const isPending = pendingTunnel === trap.id;
                              
                              return (
                                  <button 
                                    key={trap.id}
                                    onClick={() => handleToggleTunnel(trap.id)}
                                    disabled={isPending}
                                    className={`w-full text-left p-3 rounded border flex items-center justify-between transition-all ${
                                        isActive 
                                        ? 'bg-emerald-900/10 border-emerald-500/50' 
                                        : 'bg-slate-900 border-slate-700 hover:border-blue-500'
                                    }`}
                                  >
                                      <div>
                                          <div className={`font-bold text-sm ${isActive ? 'text-emerald-400' : 'text-slate-200'}`}>{trap.name}</div>
                                          <div className="text-xs text-slate-500">{trap.serviceType}</div>
                                      </div>
                                      <div className="flex items-center">
                                          {isPending ? <Loader className="w-4 h-4 animate-spin text-blue-400" /> : (
                                              <div className={`w-8 h-4 rounded-full relative transition-colors ${isActive ? 'bg-emerald-500' : 'bg-slate-700'}`}>
                                                  <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${isActive ? 'left-4.5' : 'left-0.5'}`} style={{ left: isActive ? '18px' : '2px' }} />
                                              </div>
                                          )}
                                      </div>
                                  </button>
                              );
                          })}
                      </div>

                      {/* Custom Port Forwarding */}
                      <div className="border-t border-slate-700 pt-4">
                          <h4 className="text-xs font-bold text-slate-400 uppercase mb-2">Custom Port Forward</h4>
                          <div className="flex gap-2">
                              <input 
                                  placeholder="Port (e.g. 8080)" 
                                  className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-white outline-none w-24"
                                  value={customPort}
                                  onChange={e => setCustomPort(e.target.value)}
                              />
                              <input 
                                  placeholder="Service Name" 
                                  className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-white outline-none flex-1"
                                  value={customService}
                                  onChange={e => setCustomService(e.target.value)}
                              />
                              <button 
                                  onClick={handleStartCustomTunnel}
                                  disabled={!customPort}
                                  className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded text-xs font-bold"
                              >
                                  Open
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
