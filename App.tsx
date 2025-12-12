
import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { generateInitialActors, generateRandomLog, generateGateways } from './services/mockService';
import { dbQuery, getSystemConfig, getPendingActors, approvePendingActor, rejectPendingActor, getSystemLogs, sendAuditLog, triggerFleetUpdate } from './services/dbService';
import { saveUserPreferences } from './services/authService';
import { Actor, LogEntry, ProxyGateway, PendingActor, ActorStatus, User, SystemConfig, UserPreferences, LogLevel } from './types';
import { LayoutDashboard, Settings as SettingsIcon, Network, Plus, LogOut, User as UserIcon, FileText, Globe, Router, Radio, Loader, RefreshCw, Zap, Server, ChevronLeft, ChevronRight } from 'lucide-react';

// Lazy Load Components
const Dashboard = React.lazy(() => import('./components/Dashboard'));
const ActorDetail = React.lazy(() => import('./components/ActorDetail'));
const EnrollmentModal = React.lazy(() => import('./components/EnrollmentModal'));
const LoginScreen = React.lazy(() => import('./components/LoginScreen'));
const Settings = React.lazy(() => import('./components/Settings'));
const Reports = React.lazy(() => import('./components/Reports'));
const WarRoomMap = React.lazy(() => import('./components/WarRoomMap'));
const GatewayManager = React.lazy(() => import('./components/GatewayManager'));
const WirelessRecon = React.lazy(() => import('./components/WirelessRecon'));
const LandingPage = React.lazy(() => import('./components/LandingPage'));

const PageLoader = () => (
  <div className="flex flex-col items-center justify-center h-full w-full text-slate-500 min-h-[400px]">
    <Loader className="w-8 h-8 text-blue-500 animate-spin mb-3" />
    <span className="text-xs font-mono tracking-widest opacity-70">LOADING MODULE...</span>
  </div>
);

const NavItem = ({ icon: Icon, label, active, onClick, expanded }: { icon: any, label: string, active: boolean, onClick: () => void, expanded: boolean }) => (
    <button 
        onClick={onClick} 
        className={`w-full flex items-center ${expanded ? 'px-4 py-3 justify-start' : 'p-3 justify-center'} rounded-lg transition-all duration-200 group relative ${active ? 'bg-blue-600/10 text-blue-400 border border-blue-500/20' : 'text-slate-500 hover:text-slate-200 hover:bg-slate-800'}`}
        title={!expanded ? label : ''}
    >
        <Icon className={`w-5 h-5 shrink-0 ${active ? 'text-blue-400' : 'group-hover:text-white'} transition-colors`} />
        {expanded && (
            <span className="ml-3 text-sm font-medium tracking-wide whitespace-nowrap overflow-hidden transition-all duration-300 animate-fade-in">
                {label}
            </span>
        )}
        {!expanded && (
            <div className="absolute left-full ml-4 px-2 py-1 bg-slate-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 whitespace-nowrap border border-slate-700 shadow-xl">
                {label}
            </div>
        )}
    </button>
);

export default function App() {
  const [isProduction, setIsProduction] = useState(() => localStorage.getItem('vpp_mode') === 'PRODUCTION');
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
      const savedUser = localStorage.getItem('vpp_user');
      return savedUser ? JSON.parse(savedUser) : null;
  });
  const [showLogin, setShowLogin] = useState(false); // New state to control Landing vs Login
  const [systemConfig, setSystemConfig] = useState<SystemConfig | null>(null);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'map' | 'actors' | 'wireless' | 'gateways' | 'reports' | 'settings'>('dashboard');
  const [gateways, setGateways] = useState<ProxyGateway[]>([]);
  const [actors, setActors] = useState<Actor[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [selectedActorId, setSelectedActorId] = useState<string | null>(null);
  const [pendingActors, setPendingActors] = useState<PendingActor[]>([]);
  const [isEnrollmentOpen, setIsEnrollmentOpen] = useState(false);
  const [isUpdatingFleet, setIsUpdatingFleet] = useState(false);
  const [autoForensicTarget, setAutoForensicTarget] = useState<string | null>(null);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);

  // Derived target version (default 2.7.0 if not set)
  const targetVersion = systemConfig?.targetAgentVersion || '2.7.0';

  useEffect(() => {
      if (!currentUser || !isProduction) return;
      const handleGlobalClick = (e: MouseEvent) => {
          const target = e.target as HTMLElement;
          const clickable = target.closest('button, a, input[type="submit"], input[type="checkbox"], select');
          if (clickable) {
              const text = clickable.textContent?.trim().substring(0, 50) || (clickable as HTMLInputElement).value || clickable.getAttribute('aria-label') || 'Unknown Element';
              sendAuditLog(currentUser.username, 'CLICK', `User clicked <${clickable.tagName.toLowerCase()}>: "${text}"`);
          }
      };
      window.addEventListener('click', handleGlobalClick);
      return () => window.removeEventListener('click', handleGlobalClick);
  }, [currentUser, isProduction]);

  useEffect(() => {
      const checkServerStatus = async () => {
          try {
              const res = await fetch('/api/health');
              if (res.ok) {
                  const data = await res.json();
                  if (data.mode === 'PRODUCTION' && !isProduction) {
                      setIsProduction(true);
                      localStorage.setItem('vpp_mode', 'PRODUCTION');
                  }
              }
          } catch (e) {}
      };
      checkServerStatus();
  }, []);

  const loadProductionData = useCallback(async () => {
      if (isProduction && currentUser) {
          const dbActors = await dbQuery<Actor[]>('actors');
          const dbGateways = await dbQuery<ProxyGateway[]>('gateways');
          const sysCfg = await getSystemConfig();
          const pending = await getPendingActors();
          
          setActors(dbActors || []);
          setSystemConfig(sysCfg);
          setPendingActors(pending || []);
          if (dbGateways && dbGateways.length > 0) setGateways(dbGateways);
          else setGateways([]); 
      } else if (!isProduction) {
          if (actors.length > 0) return;
          const initialGateways = generateGateways();
          setGateways(initialGateways);
          setActors(generateInitialActors(initialGateways));
          setSystemConfig({ companyName: 'Virtual Puppets', domain: 'demo.vpp.io', setupCompletedAt: '' });
      }
  }, [isProduction, currentUser, actors.length]);

  useEffect(() => { loadProductionData(); }, [loadProductionData, activeTab]);

  useEffect(() => {
    if (isProduction && currentUser) {
        const interval = setInterval(async () => {
             const pending = await getPendingActors();
             if (pending) setPendingActors(pending);
             const dbActors = await dbQuery<Actor[]>('actors');
             if (dbActors) setActors(dbActors);
        }, 5000); // Slower polling to be safe
        return () => clearInterval(interval);
    }
  }, [isProduction, currentUser]);

  // --- STABLE WATCHDOG ---
  useEffect(() => {
      const interval = setInterval(() => {
          setActors(prevActors => {
              return prevActors.map(actor => {
                  const lastSeenTime = new Date(actor.lastSeen).getTime();
                  const timeDiff = Date.now() - lastSeenTime;
                  // 10 minute offline threshold
                  if (timeDiff > 600000 && actor.status === 'ONLINE') {
                      return { ...actor, status: ActorStatus.OFFLINE };
                  }
                  return actor;
              });
          });
      }, 5000); 
      return () => clearInterval(interval);
  }, []);

  // --- LOG GENERATION & ALERT TRIGGER ---
  useEffect(() => {
    // MOCK MODE LOGIC
    if (!isProduction && actors.length > 0) {
        const interval = setInterval(() => {
          const newLog = generateRandomLog(actors);
          
          setLogs(prev => {
            const updated = [...prev, newLog];
            return updated.length > 200 ? updated.slice(updated.length - 200) : updated;
          });

          // CRITICAL: Sync the "Event" to the Actor State to trigger alerts
          if (newLog.level === LogLevel.CRITICAL) {
              setActors(prevActors => prevActors.map(a => {
                  if (a.id === newLog.actorId && a.status === ActorStatus.ONLINE) {
                      return { ...a, status: ActorStatus.COMPROMISED };
                  }
                  return a;
              }));
          }

        }, 2000);
        return () => clearInterval(interval);
    } 
    
    // PRODUCTION MODE LOGIC
    if (isProduction && currentUser) {
        const interval = setInterval(async () => {
             const realLogs = await getSystemLogs();
             if (realLogs && realLogs.length > 0) setLogs(realLogs); 
        }, 3000); // 3s polling
        return () => clearInterval(interval);
    }
  }, [isProduction, currentUser, actors]);

  const handleAdoptDevice = async (pendingId: string, proxyId: string, name: string) => {
      if (!isProduction) {
           const pending = pendingActors.find(p => p.id === pendingId);
           if (!pending) return;
           const newActor: Actor = { id: `real-${Math.random().toString(36).substr(2,6)}`, proxyId: proxyId, name: name, localIp: pending.detectedIp, status: ActorStatus.ONLINE, lastSeen: new Date(), osVersion: 'Raspbian', cpuLoad: 5, memoryUsage: 15, activeTools: ['vpp-agent'], agentVersion: targetVersion, activeTunnels: [] };
           setActors([...actors, newActor]);
           setPendingActors(prev => prev.filter(p => p.id !== pendingId));
           if (activeTab !== 'dashboard') setActiveTab('actors');
      } else {
           const success = await approvePendingActor(pendingId, proxyId, name);
           if (success) {
               loadProductionData();
           } else {
               alert("Enrollment Failed. Please check the server console logs for database errors.");
           }
      }
  };

  const handleRejectDevice = async (pendingId: string) => {
      if (!isProduction) setPendingActors(prev => prev.filter(p => p.id !== pendingId));
      else { await rejectPendingActor(pendingId); loadProductionData(); }
  };

  const toggleProductionMode = () => {
      if (confirm(`Switching to ${!isProduction ? "PRODUCTION" : "MOCK"} mode. Continue?`)) {
          const newMode = !isProduction;
          setIsProduction(newMode);
          localStorage.setItem('vpp_mode', newMode ? 'PRODUCTION' : 'MOCK');
          setCurrentUser(null);
          localStorage.removeItem('vpp_user');
          setActors([]); 
      }
  };

  const handleLoginSuccess = (user: User) => {
      setCurrentUser(user);
      localStorage.setItem('vpp_user', JSON.stringify(user));
  };

  const handleLogout = () => {
      if (currentUser && isProduction) sendAuditLog(currentUser.username, 'LOGOUT', 'User logged out');
      setCurrentUser(null);
      localStorage.removeItem('vpp_user');
      setShowLogin(false); // Return to landing page on logout
  };

  const handleUpdateUserPreferences = async (newPrefs: UserPreferences) => {
      if (!currentUser) return;
      
      const updatedUser = {
          ...currentUser,
          preferences: {
              ...currentUser.preferences,
              ...newPrefs
          }
      };
      
      setCurrentUser(updatedUser);
      localStorage.setItem('vpp_user', JSON.stringify(updatedUser));
      
      if (isProduction) {
          await saveUserPreferences(currentUser.id, updatedUser.preferences || {});
      }
  };
  
  const handleFleetUpdate = async () => {
      if (!confirm(`This will trigger a remote update for all online actors to version ${targetVersion}. They may restart. Continue?`)) return;
      
      setIsUpdatingFleet(true);
      if (isProduction) {
          await triggerFleetUpdate(actors, targetVersion);
      } else {
          // Mock delay
          await new Promise(r => setTimeout(r, 2000));
          alert(`Mock update command sent to 120 agents (Target: ${targetVersion}).`);
      }
      setIsUpdatingFleet(false);
  };

  const handleRestoreState = (snapshot: any) => {
      if (snapshot.actors && Array.isArray(snapshot.actors)) setActors(snapshot.actors);
      if (snapshot.gateways && Array.isArray(snapshot.gateways)) setGateways(snapshot.gateways);
      if (snapshot.systemConfig) setSystemConfig(snapshot.systemConfig);
      if (snapshot.logs && Array.isArray(snapshot.logs)) setLogs(snapshot.logs);

      if (isProduction) {
          alert("State loaded into Dashboard view. \n\nNOTE: In Production mode, this only affects your current session view. Persistent database state requires manual re-seeding or will be overwritten by the next polling cycle.");
      } else {
          alert("System Restore Completed Successfully.");
      }
  };
  
  const handleQuickForensic = (actorId: string) => {
      setSelectedActorId(actorId);
      setAutoForensicTarget(actorId);
  };

  // 1. Landing Page (Default if not logged in and not explicitly asking for login)
  if (!currentUser && !showLogin) {
      return (
          <Suspense fallback={<PageLoader />}>
              <LandingPage onLoginClick={() => setShowLogin(true)} />
          </Suspense>
      );
  }

  // 2. Login Screen (If not logged in but requested)
  if (!currentUser && showLogin) return (
    <Suspense fallback={<div className="min-h-screen bg-cyber-900 flex items-center justify-center text-blue-500 font-mono text-sm tracking-wider">INITIALIZING SECURE ENVIRONMENT...</div>}>
      <LoginScreen onLoginSuccess={handleLoginSuccess} />
    </Suspense>
  );

  // 3. Main Application (Logged In)
  const selectedActor = actors.find(a => a.id === selectedActorId);
  const selectedActorGateway = selectedActor ? gateways.find(g => g.id === selectedActor.proxyId) : undefined;

  return (
        <Suspense fallback={<PageLoader />}>
            <div className="min-h-screen bg-cyber-900 text-slate-200 font-sans selection:bg-blue-500/30 flex overflow-hidden">
                
                {/* Sidebar Navigation */}
                <div className={`fixed left-0 top-0 bottom-0 ${isSidebarExpanded ? 'w-64' : 'w-20'} bg-slate-950 border-r border-slate-800 flex flex-col z-50 transition-all duration-300 ease-in-out ${currentUser ? 'translate-x-0' : '-translate-x-full'} shadow-2xl`}>
                    
                    {/* Header */}
                    <div className="h-20 flex items-center justify-center border-b border-slate-800/50 relative shrink-0">
                        <div className={`flex items-center transition-all duration-300 ${isSidebarExpanded ? 'w-full px-6' : 'justify-center'}`}>
                            <div className="bg-blue-600 rounded-lg p-1.5 shadow-lg shadow-blue-500/20 shrink-0">
                                <Zap className="w-5 h-5 text-white" />
                            </div>
                            {isSidebarExpanded && (
                                <div className="ml-3 overflow-hidden animate-fade-in">
                                    <h1 className="font-bold text-white text-base tracking-wider whitespace-nowrap">PUPPETS</h1>
                                    <p className="text-[10px] text-blue-400 font-mono tracking-widest">COMMAND NODE</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Toggle Button */}
                    <button 
                        onClick={() => setIsSidebarExpanded(!isSidebarExpanded)}
                        className="absolute -right-3 top-24 bg-slate-800 border border-slate-700 text-slate-400 hover:text-white hover:border-blue-500 p-1 rounded-full shadow-xl transition-all z-50 hover:scale-110"
                        title={isSidebarExpanded ? "Collapse Menu" : "Expand Menu"}
                    >
                        {isSidebarExpanded ? <ChevronLeft className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    </button>
                    
                    {/* Menu Items */}
                    <div className="flex-1 py-6 px-3 space-y-2 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800 overflow-x-hidden">
                        <NavItem icon={LayoutDashboard} label="Dashboard" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} expanded={isSidebarExpanded} />
                        <NavItem icon={Globe} label="War Room Map" active={activeTab === 'map'} onClick={() => setActiveTab('map')} expanded={isSidebarExpanded} />
                        <NavItem icon={Server} label="Fleet Matrix" active={activeTab === 'actors'} onClick={() => setActiveTab('actors')} expanded={isSidebarExpanded} />
                        <NavItem icon={Network} label="Gateway Infra" active={activeTab === 'gateways'} onClick={() => setActiveTab('gateways')} expanded={isSidebarExpanded} />
                        <NavItem icon={Radio} label="Wireless Recon" active={activeTab === 'wireless'} onClick={() => setActiveTab('wireless')} expanded={isSidebarExpanded} />
                        <NavItem icon={FileText} label="Intel Reports" active={activeTab === 'reports'} onClick={() => setActiveTab('reports')} expanded={isSidebarExpanded} />
                    </div>

                    {/* Footer Actions */}
                    <div className="p-3 border-t border-slate-800/50 space-y-2 mb-2 bg-slate-950/50 shrink-0">
                        <NavItem icon={SettingsIcon} label="System Settings" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} expanded={isSidebarExpanded} />
                        <button 
                            onClick={handleLogout} 
                            className={`w-full flex items-center ${isSidebarExpanded ? 'px-4 py-3 justify-start' : 'p-3 justify-center'} rounded-lg transition-all duration-200 text-slate-500 hover:text-red-400 hover:bg-red-950/30 group`}
                            title={!isSidebarExpanded ? "Logout" : ""}
                        >
                            <LogOut className="w-5 h-5 shrink-0 group-hover:scale-110 transition-transform" />
                            {isSidebarExpanded && <span className="ml-3 text-sm font-medium whitespace-nowrap animate-fade-in">Terminate Session</span>}
                        </button>
                    </div>
                </div>

                {/* Main Content Area - Dynamic Margin */}
                <div className={`flex-1 flex flex-col transition-all duration-300 ease-in-out ${currentUser ? (isSidebarExpanded ? 'ml-64' : 'ml-20') : ''} h-screen overflow-hidden bg-slate-900/95`}>
                    <div className="flex-1 overflow-y-auto p-6 scroll-smooth">
                        {selectedActor ? (
                            <ActorDetail 
                                actor={selectedActor} 
                                gateway={selectedActorGateway} 
                                logs={logs.filter(l => l.actorId === selectedActorId)} 
                                onBack={() => { setSelectedActorId(null); setAutoForensicTarget(null); }} 
                                isProduction={isProduction}
                                currentUser={currentUser}
                                onUpdatePreferences={handleUpdateUserPreferences}
                                autoRunForensic={autoForensicTarget === selectedActor.id}
                            />
                        ) : (
                            <>
                                {activeTab === 'dashboard' && <Dashboard gateways={gateways} actors={actors} logs={logs} onActorSelect={setSelectedActorId} onQuickForensic={handleQuickForensic} />}
                                {activeTab === 'map' && <WarRoomMap gateways={gateways} actors={actors} />}
                                {activeTab === 'reports' && <Reports currentUser={currentUser} logs={logs} actors={actors} />}
                                {activeTab === 'gateways' && <GatewayManager gateways={gateways} onRefresh={loadProductionData} domain={systemConfig?.domain || 'vpp.io'} isProduction={isProduction} />}
                                {activeTab === 'wireless' && <WirelessRecon isProduction={isProduction} actors={actors} />}
                                {activeTab === 'settings' && (
                                    <Settings 
                                        isProduction={isProduction} 
                                        onToggleProduction={toggleProductionMode} 
                                        currentUser={currentUser} 
                                        onConfigUpdate={loadProductionData}
                                        actors={actors}
                                        gateways={gateways}
                                        onRestore={handleRestoreState}
                                    />
                                )}
                                {activeTab === 'actors' && (
                                    <div className="space-y-6 animate-fade-in pb-10">
                                        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                                            <h2 className="text-2xl font-bold text-slate-200">Global Fleet</h2>
                                            <div className="flex space-x-2">
                                                <button 
                                                    onClick={handleFleetUpdate}
                                                    disabled={isUpdatingFleet}
                                                    className="bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white px-4 py-2 rounded-lg flex items-center font-bold text-xs border border-slate-700 transition-all disabled:opacity-50"
                                                >
                                                    <RefreshCw className={`w-3 h-3 mr-2 ${isUpdatingFleet ? 'animate-spin' : ''}`} />
                                                    {isUpdatingFleet ? 'PUSHING UPDATE...' : `UPDATE ALL AGENTS (v${targetVersion})`}
                                                </button>
                                                <button 
                                                    onClick={() => setIsEnrollmentOpen(true)} 
                                                    className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg flex items-center font-bold text-sm shadow-lg shadow-blue-900/20"
                                                >
                                                    <Plus className="w-4 h-4 mr-2" />Enroll New Device
                                                </button>
                                            </div>
                                        </div>

                                        {/* Software Version Banner */}
                                        <div className="bg-gradient-to-r from-blue-900/20 to-slate-800 border border-blue-500/30 rounded-lg p-3 flex justify-between items-center text-sm">
                                            <div className="flex items-center text-blue-300">
                                                <Zap className="w-4 h-4 mr-2" />
                                                <span className="font-bold mr-2">Agent Versioning:</span>
                                                <span>Latest Stable: <span className="text-white font-mono">v{targetVersion}</span></span>
                                            </div>
                                            <div className="flex items-center text-xs text-slate-400">
                                                <span className="mr-3">{actors.filter(a => a.agentVersion !== targetVersion).length} agents outdated</span>
                                                {actors.length > 0 && <span className="bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded">System Healthy</span>}
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                            {actors.map(actor => (
                                                <div key={actor.id} onClick={() => setSelectedActorId(actor.id)} className={`cursor-pointer bg-slate-800 p-6 rounded-xl border hover:border-blue-500 transition-all shadow-lg ${actor.status === 'COMPROMISED' ? 'border-red-500 shadow-red-500/20' : 'border-slate-700'}`}>
                                                    <div className="flex justify-between items-start mb-2">
                                                        <h3 className="text-lg font-bold text-slate-200">{actor.name}</h3>
                                                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${actor.agentVersion !== targetVersion ? 'bg-yellow-500/10 text-yellow-500' : 'bg-slate-700 text-slate-400'}`}>
                                                            v{actor.agentVersion || '1.0.0'}
                                                        </span>
                                                    </div>
                                                    <p className="text-sm text-slate-500 font-mono mb-4">{actor.localIp}</p>
                                                    <div className="flex justify-between text-xs text-slate-400">
                                                        <span>Status: <span className={actor.status === 'ONLINE' ? 'text-emerald-400' : actor.status === 'COMPROMISED' ? 'text-red-500 font-bold animate-pulse' : 'text-red-400'}>{actor.status}</span></span>
                                                        <span className="text-slate-500">{gateways.find(g => g.id === actor.proxyId)?.name || 'Direct'}</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            
                <EnrollmentModal 
                    isOpen={isEnrollmentOpen} 
                    onClose={() => setIsEnrollmentOpen(false)}
                    gateways={gateways}
                    pendingActors={pendingActors}
                    setPendingActors={setPendingActors}
                    onApprove={handleAdoptDevice}
                    onReject={handleRejectDevice}
                    domain={systemConfig?.domain || 'vpp.io'}
                    isProduction={isProduction}
                    onGatewayRegistered={loadProductionData}
                />
            </div>
        </Suspense>
    );
}
