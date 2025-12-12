
import React, { useMemo, useState } from 'react';
import { Actor, ActorStatus, LogEntry, LogLevel, ProxyGateway, DevicePersona } from '../types';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line } from 'recharts';
import { ShieldAlert, Server, Activity, Terminal as TerminalIcon, AlertTriangle, Network, Router, Cpu, Info, Globe, Skull, Cloud, Zap, Camera, Printer, Box, Eye, Lock, MapPin, Wifi } from 'lucide-react';
import Terminal from './Terminal';

interface DashboardProps {
  gateways: ProxyGateway[];
  actors: Actor[];
  logs: LogEntry[];
  onActorSelect?: (id: string) => void;
  onQuickForensic?: (id: string) => void;
}

const Dashboard: React.FC<DashboardProps> = ({ gateways, actors, logs, onActorSelect, onQuickForensic }) => {
  const [tooltipState, setTooltipState] = useState<{ actor: Actor, rect: DOMRect } | null>(null);
  
  const stats = useMemo(() => {
    return {
      totalProxies: gateways.length,
      onlineProxies: gateways.filter(g => g.status === 'ONLINE').length,
      totalActors: actors.length,
      compromisedActors: actors.filter(a => a.status === ActorStatus.COMPROMISED).length,
      totalAlerts: logs.filter(l => l.level === LogLevel.CRITICAL || l.level === LogLevel.WARNING).length
    };
  }, [gateways, actors, logs]);

  const compromisedNodes = useMemo(() => actors.filter(a => a.status === ActorStatus.COMPROMISED), [actors]);

  const chartData = useMemo(() => {
    // Group logs by hour (mocked as last 10 minutes for demo)
    const data: any[] = [];
    const now = new Date();
    for(let i=10; i>=0; i--) {
        const time = new Date(now.getTime() - i * 60000);
        const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const count = logs.filter(l => 
            l.timestamp.getMinutes() === time.getMinutes() && 
            l.timestamp.getHours() === time.getHours()
        ).length;
        data.push({ name: timeStr, events: count });
    }
    return data;
  }, [logs]);

  // Calculate Top Attackers based on source IP in logs
  const topAttackers = useMemo(() => {
      const counts: Record<string, number> = {};
      logs.forEach(l => {
          if (l.sourceIp) {
              counts[l.sourceIp] = (counts[l.sourceIp] || 0) + 1;
          }
      });
      return Object.entries(counts)
          .sort(([,a], [,b]) => b - a)
          .slice(0, 5)
          .map(([ip, count]) => ({ ip, count }));
  }, [logs]);

  // We only show last 50 logs in the dashboard terminal to keep performance high
  const recentLogs = logs.slice(-50);

  const getPersonaIcon = (p: DevicePersona | undefined) => {
    switch(p?.icon) {
        case 'CAMERA': return Camera;
        case 'PRINTER': return Printer;
        case 'ROUTER': return Router;
        case 'PLC': return Zap;
        case 'SERVER': return Server;
        default: return Box; 
    }
  };

  // Helper to generate consistent internal IP
  const getInternalIp = (id: string) => {
      const hash = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      return `10.0.${hash % 10}.${hash % 250 + 1}`;
  };

  // Helper for rendering actor squares
  const renderActorSquare = (actor: Actor) => {
    const PersonaIcon = getPersonaIcon(actor.persona);
    const hasTunnels = actor.activeTunnels && actor.activeTunnels.length > 0;
    const isSentinel = actor.tcpSentinelEnabled;
    const isCompromised = actor.status === ActorStatus.COMPROMISED;
    const isOnline = actor.status === ActorStatus.ONLINE;

    return (
        <div 
            key={actor.id} 
            onClick={() => onActorSelect && onActorSelect(actor.id)}
            onMouseEnter={(e) => setTooltipState({ actor, rect: e.currentTarget.getBoundingClientRect() })}
            onMouseLeave={() => setTooltipState(null)}
            className={`
                group relative h-10 w-full rounded-md cursor-pointer transition-all duration-200 
                hover:scale-110 hover:z-20 border flex items-center justify-center overflow-hidden
                ${isOnline ? 'bg-slate-800/80 border-slate-700 hover:border-emerald-500/50' : 
                  isCompromised ? 'bg-red-950/40 border-red-500 hover:bg-red-900/60 shadow-[0_0_10px_rgba(239,68,68,0.2)]' : 
                  'bg-slate-900 border-slate-800 opacity-50'}
            `}
        >
            {/* Background Status Tint */}
            {isOnline && <div className="absolute inset-0 bg-emerald-500/5 pointer-events-none"></div>}
            
            {/* Persona Icon (Centered) */}
            <PersonaIcon className={`w-5 h-5 transition-colors duration-300 ${isCompromised ? 'text-red-400' : 'text-slate-600 group-hover:text-slate-300'}`} />

            {/* Status Dot (Top Left) */}
            <div className={`absolute top-1 left-1 w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-500' : isCompromised ? 'bg-red-500 animate-ping' : 'bg-slate-600'}`}></div>
            {isCompromised && <div className="absolute top-1 left-1 w-1.5 h-1.5 rounded-full bg-red-500"></div>}

            {/* Sentinel Indicator (Top Right) */}
            {isSentinel && (
                <div className="absolute top-1 right-1" title="Sentinel Mode Active">
                    <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse shadow-[0_0_4px_#ef4444]"></div>
                </div>
            )}

            {/* Tunnel Indicator (Bottom Right) */}
            {hasTunnels && (
                <div className="absolute bottom-1 right-1" title={`${actor.activeTunnels?.length} Active Tunnels`}>
                    <Network className="w-2.5 h-2.5 text-cyan-400 drop-shadow-[0_0_2px_rgba(34,211,238,0.8)]" />
                </div>
            )}
        </div>
    );
  };

  return (
    <div className="flex flex-col h-[calc(100vh-100px)] space-y-4 animate-fade-in pb-2 overflow-hidden relative">
        
      {/* Alert Banner for Compromised Nodes */}
      {compromisedNodes.length > 0 && (
          <div className="bg-red-500/10 border border-red-500 rounded-lg p-2 flex flex-col md:flex-row items-center justify-between animate-pulse shadow-lg shadow-red-900/20 shrink-0">
              <div className="flex items-center mb-1 md:mb-0">
                  <AlertTriangle className="text-red-500 w-5 h-5 mr-3" />
                  <div>
                      <h3 className="text-red-400 font-bold text-sm tracking-wide">ACTIVE THREAT DETECTED</h3>
                      <p className="text-red-300 text-xs">
                          {compromisedNodes.length} node(s) flagged: <span className="font-mono">{compromisedNodes.slice(0, 3).map(n => n.name).join(', ')}{compromisedNodes.length > 3 ? '...' : ''}</span>
                      </p>
                  </div>
              </div>
              <div className="flex space-x-2">
                 {onQuickForensic && (
                      <button 
                        onClick={() => onQuickForensic(compromisedNodes[0].id)}
                        className="bg-red-900/50 hover:bg-red-800 text-white border border-red-500 px-4 py-1.5 rounded text-xs font-bold transition-colors shadow-lg flex items-center"
                        title="Run immediate forensic analysis"
                      >
                          <Zap className="w-3 h-3 mr-2" />
                          SNAPSHOT
                      </button>
                  )}
                  {onActorSelect && (
                      <button 
                        onClick={() => onActorSelect(compromisedNodes[0].id)}
                        className="bg-red-600 hover:bg-red-500 text-white px-4 py-1.5 rounded text-xs font-bold transition-colors shadow-lg shadow-red-600/20 flex items-center"
                      >
                          <ShieldAlert className="w-3 h-3 mr-2" />
                          INVESTIGATE
                      </button>
                  )}
              </div>
          </div>
      )}

      {/* Top Stats Cards - Compact */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 shrink-0">
        <div className="bg-slate-800 p-3 rounded-lg border border-slate-700 flex items-center shadow-lg">
            <div className="p-2 bg-indigo-500/20 rounded-full mr-3">
                <Network className="text-indigo-400 w-5 h-5" />
            </div>
            <div>
                <p className="text-slate-500 text-[10px] uppercase font-bold">Gateways</p>
                <h3 className="text-xl font-bold text-white leading-none">{stats.onlineProxies} <span className="text-slate-600 text-xs">/ {stats.totalProxies}</span></h3>
            </div>
        </div>

        <div className="bg-slate-800 p-3 rounded-lg border border-slate-700 flex items-center shadow-lg">
            <div className="p-2 bg-blue-500/20 rounded-full mr-3">
                <Server className="text-blue-400 w-5 h-5" />
            </div>
            <div>
                <p className="text-slate-500 text-[10px] uppercase font-bold">Total Puppets</p>
                <h3 className="text-xl font-bold text-white leading-none">{stats.totalActors}</h3>
            </div>
        </div>

        <div className={`p-3 rounded-lg border flex items-center shadow-lg transition-colors ${stats.compromisedActors > 0 ? 'bg-red-900/20 border-red-500' : 'bg-slate-800 border-slate-700'}`}>
            <div className="p-2 bg-red-500/20 rounded-full mr-3">
                <ShieldAlert className="text-red-400 w-5 h-5" />
            </div>
            <div>
                <p className="text-slate-500 text-[10px] uppercase font-bold">Compromised</p>
                <h3 className={`text-xl font-bold leading-none ${stats.compromisedActors > 0 ? 'text-red-400' : 'text-white'}`}>{stats.compromisedActors}</h3>
            </div>
        </div>

        <div className="bg-slate-800 p-3 rounded-lg border border-slate-700 flex items-center shadow-lg">
            <div className="p-2 bg-emerald-500/20 rounded-full mr-3">
                <Activity className="text-emerald-400 w-5 h-5" />
            </div>
            <div>
                <p className="text-slate-500 text-[10px] uppercase font-bold">Events (1h)</p>
                <h3 className="text-xl font-bold text-white leading-none">{stats.totalAlerts}</h3>
            </div>
        </div>
      </div>

      {/* Main Content Split - Use flex-1 to fill remaining height */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1 min-h-0">
        
        {/* Left Col: Charts & Fleet Matrix (7 cols) */}
        <div className="lg:col-span-7 flex flex-col space-y-4 h-full min-h-0">
            
            <div className="flex space-x-4 h-1/3 min-h-[180px] shrink-0">
                {/* Traffic Chart */}
                <div className="bg-slate-800 rounded-lg border border-slate-700 p-3 shadow-lg flex-1">
                    <h3 className="text-xs font-semibold text-slate-400 mb-2 flex items-center">
                        <Activity className="w-3 h-3 mr-2 text-cyber-accent" />
                        VPP TRAFFIC VELOCITY
                    </h3>
                    <div className="h-[calc(100%-24px)] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                                <XAxis dataKey="name" stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} />
                                <YAxis stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} />
                                <Tooltip 
                                    contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#f8fafc', fontSize: '12px' }} 
                                    itemStyle={{ color: '#3b82f6' }}
                                />
                                <Line type="monotone" dataKey="events" stroke="#3b82f6" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                 {/* Top Attackers Panel */}
                 <div className="bg-slate-800 rounded-lg border border-slate-700 p-3 shadow-lg w-1/3 overflow-hidden flex flex-col">
                    <h3 className="text-xs font-semibold text-slate-400 mb-2 flex items-center shrink-0">
                        <Skull className="w-3 h-3 mr-2 text-red-400" />
                        TOP THREATS
                    </h3>
                    {/* Internal Scroll Here */}
                    <div className="flex-1 overflow-y-auto space-y-2 scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-slate-800 pr-1">
                        {topAttackers.length === 0 ? (
                            <div className="text-slate-600 text-xs text-center mt-4">No active threats</div>
                        ) : (
                            topAttackers.map((att, i) => (
                                <div key={i} className="flex justify-between items-center text-xs border-b border-slate-700/50 pb-1 last:border-0">
                                    <div className="flex items-center">
                                        <Globe className="w-3 h-3 text-slate-500 mr-2" />
                                        <span className="text-red-300 font-mono">{att.ip}</span>
                                    </div>
                                    <span className="bg-red-900/40 text-red-400 px-1.5 rounded font-bold">{att.count}</span>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* Fleet Matrix - Remaining Height */}
            <div className="bg-slate-800 rounded-lg border border-slate-700 p-4 shadow-lg flex-1 flex flex-col min-h-0 overflow-hidden">
                <h3 className="text-xs font-semibold text-slate-400 mb-3 flex justify-between items-center shrink-0">
                    <span>FLEET MATRIX ({stats.totalActors} NODES)</span>
                    <div className="flex items-center space-x-3 text-[10px] font-normal">
                        <span className="flex items-center"><span className="w-1.5 h-1.5 bg-emerald-500 rounded-full mr-1"></span> ONLINE</span>
                        <span className="flex items-center"><span className="w-1.5 h-1.5 bg-red-500 rounded-full mr-1 animate-ping"></span> COMPROMISED</span>
                        <span className="flex items-center"><Eye className="w-3 h-3 mr-1 text-red-500"/> SENTINEL</span>
                        <span className="flex items-center"><Network className="w-3 h-3 mr-1 text-cyan-400"/> TUNNEL</span>
                    </div>
                </h3>
                
                {/* Internal Scroll Here */}
                <div className="flex-1 overflow-y-auto pr-2 space-y-4 scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-slate-800">
                    {/* Assigned Gateways */}
                    {gateways.map(gw => {
                        const gwActors = actors.filter(a => a.proxyId === gw.id);
                        return (
                            <div key={gw.id} className="bg-slate-900/50 rounded border border-slate-700/50 p-2">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center text-slate-300">
                                        <Router className={`w-3 h-3 mr-2 ${gw.status === 'ONLINE' ? 'text-indigo-400' : 'text-red-400'}`} />
                                        <span className="text-xs font-bold mr-2">{gw.name}</span>
                                        <span className="text-[10px] text-slate-500">({gw.location})</span>
                                    </div>
                                    <span className="text-[10px] text-slate-500 font-mono">{gwActors.length} Nodes</span>
                                </div>
                                
                                <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2">
                                    {gwActors.map(renderActorSquare)}
                                </div>
                            </div>
                        );
                    })}

                    {/* Unassigned / Direct Actors */}
                    {(() => {
                        const assignedIds = new Set(gateways.map(g => g.id));
                        const unassigned = actors.filter(a => !assignedIds.has(a.proxyId) && a.proxyId !== undefined);
                        
                        if (unassigned.length === 0) return null;

                        return (
                             <div className="bg-slate-900/50 rounded border border-slate-700/50 p-2 mt-2">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center text-slate-300">
                                        <div className="w-3 h-3 mr-2 rounded-full bg-slate-700 flex items-center justify-center">
                                            <Cloud className="w-2 h-2 text-slate-400" />
                                        </div>
                                        <span className="text-xs font-bold mr-2">Direct / Unmanaged</span>
                                        <span className="text-[10px] text-slate-500">(Cloud Direct)</span>
                                    </div>
                                    <span className="text-[10px] text-slate-500 font-mono">{unassigned.length} Nodes</span>
                                </div>
                                <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2">
                                    {unassigned.map(renderActorSquare)}
                                </div>
                             </div>
                        );
                    })()}
                </div>
            </div>
        </div>

        {/* Right Col: Terminal (5 cols) - Full Height */}
        <div className="lg:col-span-5 h-full min-h-0 flex flex-col">
            <Terminal logs={recentLogs} height="h-full" />
        </div>

      </div>

      {/* Floating Tooltip Portal */}
      {tooltipState && (() => {
          const { actor, rect } = tooltipState;
          const PersonaIcon = getPersonaIcon(actor.persona);
          const hasTunnels = actor.activeTunnels && actor.activeTunnels.length > 0;
          const isSentinel = actor.tcpSentinelEnabled;
          const isCompromised = actor.status === ActorStatus.COMPROMISED;
          const gateway = gateways.find(g => g.id === actor.proxyId);
          const location = actor.physicalAddress || gateway?.location || 'Cloud / Direct';
          const lanIp = getInternalIp(actor.id);

          // Fixed styling to float above everything using fixed positioning from captured rect
          return (
            <div 
                className="fixed z-[100] pointer-events-none bg-slate-900 text-slate-200 text-xs p-3 rounded-xl border border-slate-600 whitespace-nowrap shadow-2xl min-w-[180px] backdrop-blur-md animate-fade-in"
                style={{ 
                    top: rect.top - 12, 
                    left: rect.left + rect.width / 2,
                    transform: 'translate(-50%, -100%)' 
                }}
            >
                <div className="flex items-center justify-between font-bold text-white mb-2 border-b border-slate-700 pb-2">
                    <span className="flex items-center"><TerminalIcon className="w-3 h-3 mr-2 text-blue-400"/> {actor.name}</span>
                    {isSentinel && <Eye className="w-3 h-3 text-red-500 animate-pulse" />}
                </div>
                <div className="space-y-1.5 mb-2">
                    <div className="flex items-center justify-between text-[10px]">
                        <span className="text-slate-500 flex items-center"><Globe className="w-3 h-3 mr-1.5"/> WAN IP</span>
                        <span className="font-mono text-emerald-400">{actor.localIp}</span>
                    </div>
                    <div className="flex items-center justify-between text-[10px]">
                        <span className="text-slate-500 flex items-center"><Wifi className="w-3 h-3 mr-1.5"/> LAN IP</span>
                        <span className="font-mono text-slate-300">{lanIp}</span>
                    </div>
                    <div className="flex items-center justify-between text-[10px]">
                        <span className="text-slate-500 flex items-center"><MapPin className="w-3 h-3 mr-1.5"/> Location</span>
                        <span className="text-slate-300 max-w-[100px] truncate ml-2 text-right">{location}</span>
                    </div>
                    <div className="flex items-center justify-between text-[10px]">
                        <span className="text-slate-500 flex items-center"><PersonaIcon className="w-3 h-3 mr-1.5"/> Persona</span>
                        <span className="text-blue-300">{actor.persona?.name || 'Generic'}</span>
                    </div>
                </div>
                
                <div className="pt-2 border-t border-slate-700 flex justify-between items-center">
                     <span className={`text-[9px] font-bold uppercase tracking-wider ${isCompromised ? 'text-red-400' : 'text-emerald-500'}`}>
                        {actor.status}
                    </span>
                    {hasTunnels && <span className="text-[9px] text-cyan-400 flex items-center"><Network className="w-2 h-2 mr-1"/> TUNNEL ACTIVE</span>}
                </div>
                
                {/* Pointer Arrow */}
                <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-8 border-transparent border-t-slate-600"></div>
            </div>
          );
      })()}

    </div>
  );
};

export default Dashboard;
