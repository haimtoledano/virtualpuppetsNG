import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { generateInitialActors, generateRandomLog, generateGateways } from './services/mockService';
import { dbQuery, getSystemConfig, getPendingActors, approvePendingActor, rejectPendingActor, getSystemLogs, sendAuditLog, triggerFleetUpdate } from './services/dbService';
import { saveUserPreferences } from './services/authService';
import { Actor, LogEntry, ProxyGateway, PendingActor, ActorStatus, User, SystemConfig, UserPreferences, LogLevel } from './types';
import { LayoutDashboard, Settings as SettingsIcon, Network, Plus, LogOut, User as UserIcon, FileText, Globe, Router, Radio, Loader, RefreshCw, Zap } from 'lucide-react';

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

const PageLoader = () => (
  <div className="flex flex-col items-center justify-center h-full w-full text-slate-500 min-h-[400px]">
    <Loader className="w-8 h-8 text-blue-500 animate-spin mb-3" />
    <span className="text-xs font-mono tracking-widest opacity-70">LOADING MODULE...</span>
  </div>
);

const App: React.FC = () => {
  const [isProduction, setIsProduction] = useState(() => localStorage.getItem('vpp_mode') === 'PRODUCTION');
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
      const savedUser = localStorage.getItem('vpp_user');
      return savedUser ? JSON.parse(savedUser) : null;
  });
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
  }, [isProduction, currentUser, actors]); // Added actors to dependency to ensure mock generation uses latest state

  const handleAdoptDevice = async (pendingId: string, proxyId: string, name: string) => {
      if (!isProduction) {
           const pending = pendingActors.find(p => p.id === pendingId);
           if (!pending) return;
           const newActor: Actor = { id: `real-${Math.random().toString(36).substr(2,6)}`, proxyId: proxyId, name: name, localIp: pending.detectedIp, status: ActorStatus.ONLINE, lastSeen: new Date(), osVersion: 'Raspbian', cpuLoad: 5, memoryUsage: 15, activeTools: ['vpp-agent'], protocolVersion: 'VPP-1.2.1', activeTunnels: [] };
           setActors([...actors, newActor]);
           setPendingActors(prev => prev.filter(p => p.id !== pendingId));
           if (activeTab !== 'dashboard') setActiveTab('actors');
      } else {
           await approvePendingActor(pendingId, proxyId, name);
           loadProductionData();
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
      if (!confirm("This will trigger a remote update for all online actors. They may restart. Continue?")) return;
      
      setIsUpdatingFleet(true);
      if (isProduction) {
          await triggerFleetUpdate(actors);
      } else {
          // Mock delay
          await new Promise(r => setTimeout(r, 2000));
          alert("Mock update command sent to 120 agents.");
      }
      setIsUpdatingFleet(false);
  };
  
  const handleQuickForensic = (actorId: string) => {
      setSelectedActorId(actorId);
      setAutoForensicTarget(actorId);
  };

  if (isProduction && !currentUser) return (
    <Suspense fallback={<div className="min-h-screen bg-cyber-900 flex items-center justify-center text-blue-500 font-mono text-sm tracking-wider">INITIALIZING SECURE ENVIRONMENT...</div>}>
      <LoginScreen onLoginSuccess={handleLoginSuccess} />
    </Suspense>
  );

  const selectedActor = actors.find(a => a.id === selectedActorId);
  const selectedActorGateway = selectedActor ? gateways.find(g => g.id === selectedActor.proxyId) : undefined;

  const renderContent = () => {
    return (
        <Suspense fallback={<PageLoader />}>
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
                    {activeTab === 'settings' && <Settings isProduction={isProduction} onToggleProduction={toggleProductionMode} currentUser={currentUser} onConfigUpdate={loadProductionData} />}
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
                                         {isUpdatingFleet ? 'PUSHING UPDATE...' : 'UPDATE ALL AGENTS (v2.2)'}
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
                                    <span>Latest Stable: <span className="text-white font-mono">v2.2.0</span></span>
                                </div>
                                <div className="flex items-center text-xs text-slate-400">
                                    <span className="mr-3">{actors.filter(a => a.protocolVersion === 'VPP-1.2').length} agents outdated</span>
                                    {actors.length > 0 && <span className="bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded">System Healthy</span>}
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {actors.map(actor => (
                                    <div key={actor.id} onClick={() => setSelectedActorId(actor.id)} className={`cursor-pointer bg-slate-800 p-6 rounded-xl border hover:border-blue-500 transition-all shadow-lg ${actor.status === 'COMPROMISED' ? 'border-red-500 shadow-red-500/20' : 'border-slate-700'}`}>
                                        <div className="flex justify-between items-start mb-2">
                                            <h3 className="text-lg font-bold text-slate-200">{actor.name}</h3>
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${actor.protocolVersion === 'VPP-1.2' ? 'bg-yellow-500/10 text-yellow-500' : 'bg-slate-700 text-slate-400'}`}>
                                                {actor.protocolVersion || 'v1.0'}
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
        </Suspense>
    );
  };

  return (
    <div className="flex h-screen bg-cyber-900 text-slate-200 font-sans">
      <aside className="w-20 md:w-64 bg-slate-900 border-r border-slate-700 flex flex-col hidden md:flex">
        <div className="p-6 flex items-center justify-center md:justify-start border-b border-slate-800">
            <span className="text-lg font-bold tracking-wider hidden md:block truncate uppercase">
                {systemConfig?.companyName || 'VIRTUAL PUPPETS'}
            </span>
        </div>
        <nav className="flex-1 p-4 space-y-2">
            <button onClick={() => setActiveTab('dashboard')} className={`w-full flex items-center p-3 rounded-lg transition-colors ${activeTab === 'dashboard' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}><LayoutDashboard className="w-5 h-5 mr-3" />Dashboard</button>
            <button onClick={() => setActiveTab('map')} className={`w-full flex items-center p-3 rounded-lg transition-colors ${activeTab === 'map' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}><Globe className="w-5 h-5 mr-3" />Threat Map</button>
            <button onClick={() => setActiveTab('actors')} className={`w-full flex items-center p-3 rounded-lg transition-colors ${activeTab === 'actors' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}><Network className="w-5 h-5 mr-3" />Global Fleet</button>
            <button onClick={() => setActiveTab('wireless')} className={`w-full flex items-center p-3 rounded-lg transition-colors ${activeTab === 'wireless' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}><Radio className="w-5 h-5 mr-3" />Wireless Recon</button>
            <button onClick={() => setActiveTab('gateways')} className={`w-full flex items-center p-3 rounded-lg transition-colors ${activeTab === 'gateways' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}><Router className="w-5 h-5 mr-3" />Gateways</button>
            <button onClick={() => setActiveTab('reports')} className={`w-full flex items-center p-3 rounded-lg transition-colors ${activeTab === 'reports' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}><FileText className="w-5 h-5 mr-3" />Reports</button>
            <button onClick={() => setActiveTab('settings')} className={`w-full flex items-center p-3 rounded-lg transition-colors ${activeTab === 'settings' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}><SettingsIcon className="w-5 h-5 mr-3" />Settings</button>
        </nav>
        {isProduction && currentUser && (
            <div className="px-4 pb-2 mb-2">
                <div className="bg-slate-800 p-3 rounded-lg flex items-center justify-between border border-slate-700">
                    <div className="flex items-center overflow-hidden">
                        <UserIcon className="w-4 h-4 text-emerald-400 mr-2 shrink-0" />
                        <span className="text-xs font-bold text-white truncate">{currentUser.username}</span>
                    </div>
                    <button onClick={handleLogout} className="text-slate-500 hover:text-white ml-2"><LogOut className="w-4 h-4" /></button>
                </div>
            </div>
        )}
      </aside>
      <main className="flex-1 overflow-y-auto h-full p-4 md:p-8 bg-gradient-to-br from-cyber-900 to-slate-900">{renderContent()}</main>
      
      {/* Conditionally render Modal to save resources if not open */}
      {isEnrollmentOpen && (
          <Suspense fallback={null}>
            <EnrollmentModal isOpen={isEnrollmentOpen} onClose={() => setIsEnrollmentOpen(false)} gateways={gateways} pendingActors={pendingActors} setPendingActors={setPendingActors} onApprove={handleAdoptDevice} onReject={handleRejectDevice} domain={systemConfig?.domain || 'vpp.io'} isProduction={isProduction} onGatewayRegistered={loadProductionData} />
          </Suspense>
      )}
    </div>
  );
};
export default App;