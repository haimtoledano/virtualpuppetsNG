
import React, { useState, useEffect } from 'react';
import { User, DbConfig, UserRole, SystemConfig, AiConfig, AiProvider, SyslogConfig, Actor, ProxyGateway } from '../types';
import { dbQuery, getSystemConfig, updateSystemConfig, connectToDatabase } from '../services/dbService';
import { createUser, deleteUser, hashPassword, updateUser, resetUserMfa } from '../services/authService';
import { testAiConnection } from '../services/aiService';
import { Settings as SettingsIcon, Database, Users, Shield, Trash2, AlertTriangle, Plus, Lock, Bot, Cloud, Server, Building, Globe, Save, RefreshCw, Edit, ShieldAlert, X, Check, ShieldCheck, FileText, Key, Activity, HardDrive, Download, Upload, Clock, Box } from 'lucide-react';

interface SettingsProps {
  isProduction: boolean;
  onToggleProduction: () => void;
  currentUser: User | null;
  onConfigUpdate?: () => void;
  actors: Actor[];
  gateways: ProxyGateway[];
  onRestore: (data: any) => void;
}

interface Snapshot {
    id: string;
    timestamp: number;
    description: string;
    data: any;
}

const Settings: React.FC<SettingsProps> = ({ isProduction, onToggleProduction, currentUser, onConfigUpdate, actors, gateways, onRestore }) => {
  const [activeTab, setActiveTab] = useState<'GENERAL' | 'SNAPSHOTS' | 'DATABASE' | 'USERS' | 'AI' | 'AUDIT' | 'CORE'>('GENERAL');
  
  const [users, setUsers] = useState<User[]>([]);
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'VIEWER' as UserRole });
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editPassword, setEditPassword] = useState('');
  
  const [sysConfig, setSysConfig] = useState<SystemConfig | null>(null);
  const [targetVersion, setTargetVersion] = useState<string>('2.7.0');
  const [isTestingAi, setIsTestingAi] = useState(false);

  // Snapshot State
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  
  // AI Form State
  const [aiForm, setAiForm] = useState<AiConfig>({
      provider: 'GEMINI',
      modelName: 'gemini-2.5-flash',
      apiKey: '',
      endpoint: 'http://localhost:11434/v1/chat/completions',
      authToken: ''
  });

  // Syslog Form State
  const [syslogForm, setSyslogForm] = useState<SyslogConfig>({
      host: '',
      port: 514,
      enabled: false
  });

  // Core Setup Forms (SuperAdmin)
  const [orgForm, setOrgForm] = useState({ companyName: '', domain: '', logoUrl: '' });
  const [dbForm, setDbForm] = useState({ server: '', database: '', username: '', password: '' });
  const [isSavingCore, setIsSavingCore] = useState(false);

  useEffect(() => {
    const loadData = async () => {
        if (isProduction) {
            // Load Users
            if (activeTab === 'USERS') {
                const data = await dbQuery<User[]>('users');
                setUsers(data);
            }
            // Load System Config for AI & Core
            const cfg = await getSystemConfig();
            if (cfg) {
                setSysConfig(cfg);
                setTargetVersion(cfg.targetAgentVersion || '2.7.0');
                
                if (activeTab === 'AI' || activeTab === 'CORE' || activeTab === 'AUDIT' || activeTab === 'SNAPSHOTS') {
                    // Hydrate all forms to prevent saving empty defaults
                    if (cfg.aiConfig) {
                        setAiForm(cfg.aiConfig);
                    }
                    if (cfg.syslogConfig) {
                        setSyslogForm(cfg.syslogConfig);
                    }
                    // Hydrate Org Form with robust fallbacks for casing
                    setOrgForm({
                        companyName: cfg.companyName || (cfg as any).CompanyName || '',
                        domain: cfg.domain || (cfg as any).Domain || '',
                        logoUrl: cfg.logoUrl || (cfg as any).LogoUrl || ''
                    });
                }
            }
        }
    };
    loadData();
    loadSnapshots();
  }, [isProduction, activeTab]);

  const loadSnapshots = () => {
      try {
          const raw = localStorage.getItem('vpp_snapshots');
          if (raw) {
              setSnapshots(JSON.parse(raw));
          }
      } catch (e) { console.error("Failed to load snapshots", e); }
  };

  const handleAddUser = async () => {
      if (!newUser.username || !newUser.password) return;
      const u: User = {
          id: `usr-${Math.random().toString(36).substr(2,5)}`,
          username: newUser.username,
          passwordHash: hashPassword(newUser.password),
          role: newUser.role,
          mfaEnabled: false
      };
      await createUser(u);
      refreshUsers();
      setNewUser({ username: '', password: '', role: 'VIEWER' });
  };

  const handleUpdateUser = async () => {
      if (!editingUser) return;
      
      const updatedUser: User = { ...editingUser };
      if (editPassword) {
          updatedUser.passwordHash = hashPassword(editPassword);
      }
      
      await updateUser(updatedUser);
      refreshUsers();
      setEditingUser(null);
      setEditPassword('');
  };

  const handleDeleteUser = async (id: string) => {
      if (confirm("Are you sure?")) {
          await deleteUser(id);
          refreshUsers();
      }
  };

  const handleResetMfa = async (id: string) => {
      if (confirm("Reset MFA? The user will be required to re-register 2FA on next login.")) {
          await resetUserMfa(id);
          refreshUsers();
          alert("MFA Reset. User will be prompted to setup 2FA again.");
      }
  };

  const refreshUsers = async () => {
      const data = await dbQuery<User[]>('users');
      setUsers(data);
  };

  const handleSaveAiConfig = async () => {
      if (!sysConfig) return;
      const updatedConfig: SystemConfig = {
          ...sysConfig,
          aiConfig: aiForm
      };
      
      // Save via API
      await fetch('/api/config/system', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(updatedConfig)
      });
      
      // Update local state so subsequent actions use the fresh config
      setSysConfig(updatedConfig);
      onConfigUpdate?.();
      
      alert("AI Configuration Saved. You can now use the Test Connection button.");
  };

  const handleTestAi = async () => {
      setIsTestingAi(true);
      const res = await testAiConnection(aiForm);
      setIsTestingAi(false);
      
      if (res.success) {
          alert("Connection Successful! The AI model responded correctly.");
      } else {
          alert(`Connection Failed: ${res.message || "Unknown error"}`);
      }
  };

  const handleSaveSyslogConfig = async () => {
      if (!sysConfig) return;
      const updatedConfig: SystemConfig = {
          ...sysConfig,
          syslogConfig: syslogForm
      };
      
      await fetch('/api/config/system', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(updatedConfig)
      });
      setSysConfig(updatedConfig);
      onConfigUpdate?.();
      alert("Syslog Configuration Saved. Events will be forwarded.");
  };

  const handleSaveFleetPolicy = async () => {
      if (!sysConfig) return;
      const updatedConfig: SystemConfig = {
          ...sysConfig,
          targetAgentVersion: targetVersion
      };
      await fetch('/api/config/system', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(updatedConfig)
      });
      setSysConfig(updatedConfig);
      onConfigUpdate?.();
      alert(`Fleet Policy Updated. Agents will be checked against v${targetVersion}.`);
  };

  const handleSaveOrgConfig = async () => {
      setIsSavingCore(true);
      try {
          const updated: SystemConfig = {
              companyName: orgForm.companyName,
              domain: orgForm.domain,
              logoUrl: orgForm.logoUrl,
              setupCompletedAt: new Date().toISOString(),
              aiConfig: sysConfig?.aiConfig || aiForm,
              syslogConfig: sysConfig?.syslogConfig || syslogForm,
              targetAgentVersion: targetVersion
          };

          await updateSystemConfig(updated);
          setSysConfig(updated);
          onConfigUpdate?.();
          alert("Organization Details Updated Successfully.");
      } catch (e) {
          alert("Failed to update organization details.");
      }
      setIsSavingCore(false);
  };

  const handleUpdateDbConnection = async () => {
      if(!dbForm.server || !dbForm.database || !dbForm.username || !dbForm.password) {
          alert("All fields are required to re-configure database connection.");
          return;
      }
      
      if(!confirm("WARNING: Changing database connection will reconnect the server. If details are incorrect, the app may become unreachable. Continue?")) return;

      setIsSavingCore(true);
      try {
          const config: DbConfig = {
              server: dbForm.server,
              database: dbForm.database,
              username: dbForm.username,
              passwordEncrypted: dbForm.password,
              isConnected: true
          };
          
          await connectToDatabase(config);
          alert("Database Re-connected Successfully!");
          setDbForm({ server: '', database: '', username: '', password: '' });
      } catch (e: any) {
          alert(`Connection Failed: ${e.message}`);
      }
      setIsSavingCore(false);
  };

  const handleCreateSnapshot = () => {
      const snap: Snapshot = {
          id: `snap-${Date.now()}`,
          timestamp: Date.now(),
          description: `Backup - ${new Date().toLocaleString()}`,
          data: {
              actors,
              gateways,
              systemConfig: sysConfig,
              users: isProduction ? [] : [{id:'mock-admin', role: 'SUPERADMIN'}] // Don't backup prod users here for security
          }
      };
      
      const newSnaps = [snap, ...snapshots];
      setSnapshots(newSnaps);
      localStorage.setItem('vpp_snapshots', JSON.stringify(newSnaps));
  };

  const handleRestoreSnapshot = (snap: Snapshot) => {
      if (confirm(`Restore system state to ${new Date(snap.timestamp).toLocaleString()}? Current unsaved changes will be lost.`)) {
          onRestore(snap.data);
      }
  };

  const handleDeleteSnapshot = (id: string) => {
      const newSnaps = snapshots.filter(s => s.id !== id);
      setSnapshots(newSnaps);
      localStorage.setItem('vpp_snapshots', JSON.stringify(newSnaps));
  };

  const handleDownloadSnapshot = (snap: Snapshot) => {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(snap));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href", dataStr);
      downloadAnchorNode.setAttribute("download", `vpp_backup_${snap.id}.json`);
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
          try {
              const content = e.target?.result as string;
              const parsed = JSON.parse(content);
              
              // Validate minimal structure
              if (parsed.data && parsed.timestamp) {
                  // Add to local snapshots list first
                  const importedSnap = { ...parsed, id: `import-${Date.now()}`, description: `Imported: ${parsed.description || 'Unknown'}` };
                  const newSnaps = [importedSnap, ...snapshots];
                  setSnapshots(newSnaps);
                  localStorage.setItem('vpp_snapshots', JSON.stringify(newSnaps));
                  
                  // Ask to restore immediately
                  if (confirm("Snapshot imported successfully. Do you want to restore it now?")) {
                      onRestore(importedSnap.data);
                  }
              } else {
                  alert("Invalid Snapshot File Format");
              }
          } catch (error) {
              alert("Failed to parse file");
          }
      };
      reader.readAsText(file);
      event.target.value = ''; // Reset
  };

  const canSwitchMode = !isProduction || (currentUser?.role === 'SUPERADMIN');
  const isSuperAdmin = currentUser?.role === 'SUPERADMIN';

  return (
    <div className="p-6 max-w-5xl mx-auto animate-fade-in">
        <h2 className="text-3xl font-bold text-slate-200 mb-6 flex items-center">
            <SettingsIcon className="w-8 h-8 mr-3 text-slate-400" />
            System Configuration
        </h2>

        <div className="flex space-x-2 border-b border-slate-700 mb-6 overflow-x-auto">
            <button 
                onClick={() => setActiveTab('GENERAL')}
                className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${activeTab === 'GENERAL' ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-500 hover:text-white'}`}
            >
                General
            </button>
            <button 
                onClick={() => setActiveTab('SNAPSHOTS')}
                className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${activeTab === 'SNAPSHOTS' ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-slate-500 hover:text-white'}`}
            >
                Restore Points
            </button>
            {isSuperAdmin && (
                <>
                    <button 
                        onClick={() => setActiveTab('AI')}
                        className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${activeTab === 'AI' ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-500 hover:text-white'}`}
                    >
                        AI Integration
                    </button>
                    <button 
                        onClick={() => setActiveTab('AUDIT')}
                        className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${activeTab === 'AUDIT' ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-500 hover:text-white'}`}
                    >
                        Audit & Logs
                    </button>
                </>
            )}
            {isProduction && isSuperAdmin && (
                <>
                    <button 
                        onClick={() => setActiveTab('USERS')}
                        className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${activeTab === 'USERS' ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-500 hover:text-white'}`}
                    >
                        User Management
                    </button>
                    <button 
                        onClick={() => setActiveTab('CORE')}
                        className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${activeTab === 'CORE' ? 'border-red-500 text-red-400' : 'border-transparent text-slate-500 hover:text-white'}`}
                    >
                        Core Setup
                    </button>
                </>
            )}
        </div>

        {activeTab === 'GENERAL' && (
            <div className="space-y-6">
                <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-lg">
                    <div className="flex justify-between items-center">
                        <div>
                            <h3 className="text-xl font-bold text-white mb-2">Operation Mode</h3>
                            <p className="text-slate-400 text-sm max-w-xl">
                                {isProduction 
                                    ? "System is running in PRODUCTION mode (MSSQL Backed)." 
                                    : "System is running in MOCK mode (Simulation)."
                                }
                            </p>
                        </div>
                        <div className="flex items-center">
                             <span className={`mr-3 font-bold text-sm ${isProduction ? 'text-emerald-400' : 'text-slate-500'}`}>
                                 {isProduction ? 'PRODUCTION' : 'MOCK'}
                             </span>
                             
                             {canSwitchMode ? (
                                 <button 
                                    onClick={onToggleProduction}
                                    className={`w-14 h-8 rounded-full p-1 transition-colors duration-300 ${isProduction ? 'bg-emerald-600' : 'bg-slate-600'}`}
                                 >
                                     <div className={`bg-white w-6 h-6 rounded-full shadow-md transform transition-transform duration-300 ${isProduction ? 'translate-x-6' : 'translate-x-0'}`} />
                                 </button>
                             ) : (
                                 <div className="flex items-center text-slate-500 text-xs bg-slate-900 px-3 py-1 rounded border border-slate-700">
                                     <Lock className="w-3 h-3 mr-2" />
                                     Locked by Policy
                                 </div>
                             )}
                        </div>
                    </div>
                </div>

                {/* Fleet Policy Section */}
                <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-lg">
                    <div className="flex items-start mb-4">
                        <Box className="w-10 h-10 text-indigo-500 mr-4" />
                        <div>
                            <h3 className="text-xl font-bold text-white">Fleet Policy</h3>
                            <p className="text-slate-400 text-sm">Define global compliance standards for all enrolled agents.</p>
                        </div>
                    </div>
                    <div className="max-w-xl">
                        <label className="block text-slate-500 text-xs font-bold uppercase mb-2">Target Agent Version</label>
                        <div className="flex gap-4">
                            <input 
                                value={targetVersion}
                                onChange={e => setTargetVersion(e.target.value)}
                                className="flex-1 bg-slate-900 border border-slate-600 rounded p-3 text-white outline-none focus:border-indigo-500 font-mono"
                                placeholder="e.g. 2.7.0"
                            />
                            <button 
                                onClick={handleSaveFleetPolicy}
                                className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2 rounded font-bold transition-colors shadow-lg"
                            >
                                Update Policy
                            </button>
                        </div>
                        <p className="text-xs text-slate-500 mt-2">
                            Agents not matching this version will be flagged as "Outdated". 
                            Running "Update All" will attempt to upgrade them to this version.
                        </p>
                    </div>
                </div>
            </div>
        )}

        {/* Snapshots / Restore Points Tab */}
        {activeTab === 'SNAPSHOTS' && (
            <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-lg space-y-6">
                 <div className="flex items-start mb-6">
                     <HardDrive className="w-10 h-10 text-emerald-500 mr-4" />
                     <div>
                         <h3 className="text-xl font-bold text-white">System Restore Points</h3>
                         <p className="text-slate-400 text-sm">Create backups of your fleet configuration and restore from previous states.</p>
                     </div>
                 </div>

                 <div className="flex gap-4 mb-6">
                     <button 
                        onClick={handleCreateSnapshot}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded font-bold shadow-lg flex items-center"
                     >
                         <Plus className="w-4 h-4 mr-2" /> Create Restore Point
                     </button>
                     <div className="relative">
                         <input type="file" id="uploadSnap" className="hidden" accept=".json" onChange={handleFileUpload} />
                         <label 
                            htmlFor="uploadSnap"
                            className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded font-bold shadow-lg flex items-center cursor-pointer"
                         >
                             <Upload className="w-4 h-4 mr-2" /> Import File
                         </label>
                     </div>
                 </div>

                 <div className="border border-slate-700 rounded-lg overflow-hidden">
                     <table className="w-full text-left text-sm">
                         <thead className="bg-slate-900 text-slate-400 font-bold uppercase text-xs">
                             <tr>
                                 <th className="p-3">Timestamp</th>
                                 <th className="p-3">Description</th>
                                 <th className="p-3">Data Size</th>
                                 <th className="p-3 text-right">Actions</th>
                             </tr>
                         </thead>
                         <tbody className="divide-y divide-slate-700 bg-slate-800/50">
                             {snapshots.length === 0 && (
                                 <tr><td colSpan={4} className="p-8 text-center text-slate-500 italic">No restore points available.</td></tr>
                             )}
                             {snapshots.map(snap => (
                                 <tr key={snap.id} className="hover:bg-slate-700/50">
                                     <td className="p-3 font-mono text-slate-300 flex items-center">
                                         <Clock className="w-3 h-3 mr-2 text-slate-500" />
                                         {new Date(snap.timestamp).toLocaleString()}
                                     </td>
                                     <td className="p-3 text-white">{snap.description}</td>
                                     <td className="p-3 text-slate-500 text-xs">{(JSON.stringify(snap.data).length / 1024).toFixed(1)} KB</td>
                                     <td className="p-3 flex justify-end space-x-2">
                                         <button 
                                            onClick={() => handleRestoreSnapshot(snap)}
                                            className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-bold"
                                            title="Restore this state"
                                         >
                                             Restore
                                         </button>
                                         <button 
                                            onClick={() => handleDownloadSnapshot(snap)}
                                            className="p-1.5 text-slate-400 hover:text-white bg-slate-700 hover:bg-slate-600 rounded"
                                            title="Download JSON"
                                         >
                                             <Download className="w-4 h-4" />
                                         </button>
                                         <button 
                                            onClick={() => handleDeleteSnapshot(snap.id)}
                                            className="p-1.5 text-slate-400 hover:text-red-400 bg-slate-700 hover:bg-slate-600 rounded"
                                            title="Delete Snapshot"
                                         >
                                             <Trash2 className="w-4 h-4" />
                                         </button>
                                     </td>
                                 </tr>
                             ))}
                         </tbody>
                     </table>
                 </div>
            </div>
        )}

        {/* Audit & Syslog Tab */}
        {activeTab === 'AUDIT' && isSuperAdmin && (
            <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-lg space-y-6">
                <div className="flex items-start mb-6">
                     <FileText className="w-10 h-10 text-emerald-500 mr-4" />
                     <div>
                         <h3 className="text-xl font-bold text-white">Audit & Logging Configuration</h3>
                         <p className="text-slate-400 text-sm">Configure external Syslog forwarding for compliance and audit trails.</p>
                     </div>
                </div>

                <div className="max-w-2xl mx-auto space-y-4">
                    <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-700 flex items-center justify-between mb-4">
                        <div>
                            <h4 className="text-white font-bold text-sm">Enable Syslog Forwarding</h4>
                            <p className="text-slate-500 text-xs">Forward all logs (Audit, Security, System) to external collector via UDP.</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" checked={syslogForm.enabled} onChange={(e) => setSyslogForm({...syslogForm, enabled: e.target.checked})} className="sr-only peer" />
                            <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                        </label>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                        <div className="col-span-2">
                             <label className="block text-slate-500 text-xs font-bold uppercase mb-1">Syslog Server IP</label>
                             <input 
                                 value={syslogForm.host}
                                 onChange={e => setSyslogForm({...syslogForm, host: e.target.value})}
                                 className="w-full bg-slate-900 border border-slate-600 rounded p-3 text-white outline-none font-mono" 
                                 placeholder="192.168.1.50"
                                 disabled={!syslogForm.enabled}
                             />
                        </div>
                        <div>
                             <label className="block text-slate-500 text-xs font-bold uppercase mb-1">UDP Port</label>
                             <input 
                                 type="number"
                                 value={syslogForm.port}
                                 onChange={e => setSyslogForm({...syslogForm, port: parseInt(e.target.value)})}
                                 className="w-full bg-slate-900 border border-slate-600 rounded p-3 text-white outline-none font-mono" 
                                 placeholder="514"
                                 disabled={!syslogForm.enabled}
                             />
                        </div>
                    </div>

                    <button 
                        onClick={handleSaveSyslogConfig}
                        disabled={!syslogForm.host && syslogForm.enabled}
                        className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-lg transition-colors mt-4 shadow-lg shadow-emerald-600/20 disabled:opacity-50"
                    >
                        <Save className="w-4 h-4 inline mr-2" /> SAVE LOGGING CONFIG
                    </button>
                </div>
            </div>
        )}

        {/* AI Tab Content */}
        {activeTab === 'AI' && isSuperAdmin && (
             <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-lg space-y-6">
                <div className="flex items-start mb-6">
                     <Bot className="w-10 h-10 text-purple-500 mr-4" />
                     <div>
                         <h3 className="text-xl font-bold text-white">Neural Engine Configuration</h3>
                         <p className="text-slate-400 text-sm">Configure the LLM backend for Log Analysis and Deception generation.</p>
                     </div>
                </div>

                <div className="grid grid-cols-2 gap-4 max-w-lg mx-auto mb-8">
                     <button 
                        onClick={() => setAiForm({...aiForm, provider: 'GEMINI'})}
                        className={`p-4 rounded-xl border flex flex-col items-center justify-center transition-all ${
                            aiForm.provider === 'GEMINI' 
                            ? 'bg-purple-600/20 border-purple-500 text-white' 
                            : 'bg-slate-900 border-slate-700 text-slate-500 hover:bg-slate-800'
                        }`}
                     >
                         <Cloud className="w-8 h-8 mb-2" />
                         <span className="font-bold">Google Cloud (Gemini)</span>
                     </button>
                     <button 
                        onClick={() => setAiForm({...aiForm, provider: 'LOCAL'})}
                        className={`p-4 rounded-xl border flex flex-col items-center justify-center transition-all ${
                            aiForm.provider === 'LOCAL' 
                            ? 'bg-emerald-600/20 border-emerald-500 text-white' 
                            : 'bg-slate-900 border-slate-700 text-slate-500 hover:bg-slate-800'
                        }`}
                     >
                         <Server className="w-8 h-8 mb-2" />
                         <span className="font-bold">Local LLM (Ollama/LM Studio)</span>
                     </button>
                </div>

                <div className="space-y-4 max-w-2xl mx-auto">
                    <div>
                         <label className="block text-slate-500 text-xs font-bold uppercase mb-1">Model Name</label>
                         <input 
                             value={aiForm.modelName}
                             onChange={e => setAiForm({...aiForm, modelName: e.target.value})}
                             className="w-full bg-slate-900 border border-slate-600 rounded p-3 text-white focus:border-purple-500 outline-none" 
                             placeholder={aiForm.provider === 'GEMINI' ? "gemini-2.5-flash" : "llama3"}
                         />
                    </div>

                    {aiForm.provider === 'GEMINI' && (
                        <div>
                             <label className="block text-slate-500 text-xs font-bold uppercase mb-1">Gemini API Key</label>
                             <div className="relative">
                                 <input 
                                     type="password"
                                     value={aiForm.apiKey || ''}
                                     onChange={e => setAiForm({...aiForm, apiKey: e.target.value})}
                                     className="w-full bg-slate-900 border border-slate-600 rounded p-3 text-white focus:border-purple-500 outline-none pr-10" 
                                     placeholder="AIza..."
                                 />
                                 <Lock className="w-4 h-4 text-slate-500 absolute right-3 top-3.5" />
                             </div>
                             <p className="text-[10px] text-slate-500 mt-1">Leave empty to use process.env.API_KEY if available.</p>
                        </div>
                    )}

                    {aiForm.provider === 'LOCAL' && (
                        <>
                             <div>
                                 <label className="block text-slate-500 text-xs font-bold uppercase mb-1">Endpoint URL</label>
                                 <input 
                                     value={aiForm.endpoint}
                                     onChange={e => setAiForm({...aiForm, endpoint: e.target.value})}
                                     className="w-full bg-slate-900 border border-slate-600 rounded p-3 text-white focus:border-emerald-500 outline-none" 
                                     placeholder="http://localhost:11434/v1/chat/completions"
                                 />
                             </div>
                             <div>
                                 <label className="block text-slate-500 text-xs font-bold uppercase mb-1">Auth Token (Optional)</label>
                                 <input 
                                     type="password"
                                     value={aiForm.authToken}
                                     onChange={e => setAiForm({...aiForm, authToken: e.target.value})}
                                     className="w-full bg-slate-900 border border-slate-600 rounded p-3 text-white focus:border-emerald-500 outline-none" 
                                     placeholder="Bearer ..."
                                 />
                             </div>
                        </>
                    )}

                    <div className="flex gap-4 mt-6">
                        <button 
                            onClick={handleTestAi}
                            disabled={isTestingAi}
                            className={`flex-1 bg-slate-700 hover:bg-slate-600 text-white font-bold py-3 rounded-lg transition-colors flex justify-center items-center ${isTestingAi ? 'opacity-50' : ''}`}
                        >
                            {isTestingAi ? <RefreshCw className="animate-spin w-4 h-4 mr-2" /> : <Activity className="w-4 h-4 mr-2" />}
                            Test Connection
                        </button>
                        <button 
                            onClick={handleSaveAiConfig}
                            className="flex-1 bg-purple-600 hover:bg-purple-500 text-white font-bold py-3 rounded-lg transition-colors flex justify-center items-center shadow-lg shadow-purple-600/20"
                        >
                            <Save className="w-4 h-4 mr-2" />
                            Save Configuration
                        </button>
                    </div>
                </div>
             </div>
        )}

        {/* User Management Tab */}
        {activeTab === 'USERS' && isProduction && isSuperAdmin && (
            <div className="space-y-6">
                 {/* Create User Form */}
                 <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-lg">
                    <h3 className="text-lg font-bold text-white mb-4 flex items-center"><Plus className="w-5 h-5 mr-2" /> Add New User</h3>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                        <div>
                            <label className="block text-slate-500 text-xs font-bold uppercase mb-1">Username</label>
                            <input className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white outline-none" value={newUser.username} onChange={e => setNewUser({...newUser, username: e.target.value})} />
                        </div>
                        <div>
                             <label className="block text-slate-500 text-xs font-bold uppercase mb-1">Password</label>
                            <input type="password" className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white outline-none" value={newUser.password} onChange={e => setNewUser({...newUser, password: e.target.value})} />
                        </div>
                        <div>
                             <label className="block text-slate-500 text-xs font-bold uppercase mb-1">Role</label>
                            <select className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white outline-none" value={newUser.role} onChange={e => setNewUser({...newUser, role: e.target.value as UserRole})}>
                                <option value="VIEWER">Viewer</option>
                                <option value="ADMIN">Admin</option>
                                <option value="SUPERADMIN">Super Admin</option>
                            </select>
                        </div>
                        <button onClick={handleAddUser} disabled={!newUser.username || !newUser.password} className="bg-blue-600 hover:bg-blue-500 text-white p-2 rounded font-bold transition-colors disabled:opacity-50">Create User</button>
                    </div>
                 </div>

                 {/* User List */}
                 <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-lg overflow-hidden">
                    <h3 className="text-lg font-bold text-white mb-4 flex items-center"><Users className="w-5 h-5 mr-2" /> Existing Users</h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-slate-900 text-slate-400 uppercase font-bold text-xs">
                                <tr>
                                    <th className="p-3">Username</th>
                                    <th className="p-3">Role</th>
                                    <th className="p-3 text-center">MFA Active</th>
                                    <th className="p-3 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-700">
                                {users.map(u => (
                                    <tr key={u.id} className="hover:bg-slate-700/50">
                                        <td className="p-3 font-mono">{u.username}</td>
                                        <td className="p-3">
                                            <span className={`px-2 py-0.5 rounded text-xs font-bold ${u.role === 'SUPERADMIN' ? 'bg-red-900/30 text-red-400' : u.role === 'ADMIN' ? 'bg-blue-900/30 text-blue-400' : 'bg-slate-700 text-slate-400'}`}>{u.role}</span>
                                        </td>
                                        <td className="p-3 text-center">
                                            {u.mfaEnabled ? <ShieldCheck className="w-4 h-4 text-emerald-500 mx-auto" /> : <span className="text-slate-600">-</span>}
                                        </td>
                                        <td className="p-3 flex justify-end space-x-2">
                                            <button onClick={() => setEditingUser(u)} className="p-1.5 text-slate-400 hover:text-white bg-slate-700 hover:bg-slate-600 rounded"><Edit className="w-4 h-4" /></button>
                                            <button onClick={() => handleResetMfa(u.id)} className="p-1.5 text-slate-400 hover:text-yellow-400 bg-slate-700 hover:bg-slate-600 rounded" title="Reset MFA"><ShieldAlert className="w-4 h-4" /></button>
                                            <button onClick={() => handleDeleteUser(u.id)} className="p-1.5 text-slate-400 hover:text-red-400 bg-slate-700 hover:bg-slate-600 rounded"><Trash2 className="w-4 h-4" /></button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                 </div>

                 {/* Edit User Modal */}
                 {editingUser && (
                     <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
                         <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 max-w-md w-full shadow-2xl">
                             <h3 className="text-lg font-bold text-white mb-4">Edit User: {editingUser.username}</h3>
                             <div className="space-y-4">
                                 <div>
                                     <label className="block text-slate-500 text-xs font-bold uppercase mb-1">New Password (Optional)</label>
                                     <input type="password" className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white outline-none" placeholder="Leave empty to keep current" value={editPassword} onChange={e => setEditPassword(e.target.value)} />
                                 </div>
                                 <div>
                                     <label className="block text-slate-500 text-xs font-bold uppercase mb-1">Role</label>
                                     <select className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white outline-none" value={editingUser.role} onChange={e => setEditingUser({...editingUser, role: e.target.value as UserRole})}>
                                        <option value="VIEWER">Viewer</option>
                                        <option value="ADMIN">Admin</option>
                                        <option value="SUPERADMIN">Super Admin</option>
                                    </select>
                                 </div>
                                 <div className="flex justify-end space-x-3 mt-6">
                                     <button onClick={() => setEditingUser(null)} className="px-4 py-2 text-slate-400 hover:text-white">Cancel</button>
                                     <button onClick={handleUpdateUser} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded font-bold">Save Changes</button>
                                 </div>
                             </div>
                         </div>
                     </div>
                 )}
            </div>
        )}

        {/* Core Setup (SuperAdmin Only) */}
        {activeTab === 'CORE' && isProduction && isSuperAdmin && (
             <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-lg space-y-6">
                 <div className="flex items-start">
                     <Building className="w-10 h-10 text-red-500 mr-4" />
                     <div>
                         <h3 className="text-xl font-bold text-white">Organization & Branding</h3>
                         <p className="text-slate-400 text-sm">Customize the interface identity.</p>
                     </div>
                 </div>
                 <div className="grid grid-cols-2 gap-4 max-w-2xl">
                     <div>
                         <label className="block text-slate-500 text-xs font-bold uppercase mb-1">Company Name</label>
                         <input className="w-full bg-slate-900 border border-slate-600 rounded p-3 text-white outline-none" value={orgForm.companyName} onChange={e => setOrgForm({...orgForm, companyName: e.target.value})} />
                     </div>
                     <div>
                         <label className="block text-slate-500 text-xs font-bold uppercase mb-1">Domain</label>
                         <input className="w-full bg-slate-900 border border-slate-600 rounded p-3 text-white outline-none" value={orgForm.domain} onChange={e => setOrgForm({...orgForm, domain: e.target.value})} />
                     </div>
                     <div className="col-span-2">
                         <label className="block text-slate-500 text-xs font-bold uppercase mb-1">Logo URL (Optional)</label>
                         <input className="w-full bg-slate-900 border border-slate-600 rounded p-3 text-white outline-none" value={orgForm.logoUrl} onChange={e => setOrgForm({...orgForm, logoUrl: e.target.value})} placeholder="https://..." />
                     </div>
                 </div>
                 <button onClick={handleSaveOrgConfig} disabled={isSavingCore} className="bg-red-600 hover:bg-red-500 text-white px-6 py-2 rounded font-bold shadow-lg shadow-red-900/20 disabled:opacity-50">Save Organization Details</button>

                 <div className="border-t border-slate-700 pt-6 mt-6">
                     <div className="flex items-start mb-4">
                         <Database className="w-10 h-10 text-blue-500 mr-4" />
                         <div>
                             <h3 className="text-xl font-bold text-white">Database Re-Configuration</h3>
                             <p className="text-slate-400 text-sm">Update connection string. <span className="text-red-400 font-bold">WARNING: Requires server restart.</span></p>
                         </div>
                     </div>
                     <div className="bg-black/30 p-4 rounded border border-red-900/30 mb-4 text-xs text-red-300 flex items-center">
                         <AlertTriangle className="w-4 h-4 mr-2" />
                         Modifying this will disconnect the current session. Ensure you have the correct credentials.
                     </div>
                     <div className="grid grid-cols-2 gap-4 max-w-2xl">
                        <input className="w-full bg-slate-900 border border-slate-600 rounded p-3 text-white outline-none text-sm" placeholder="Server (e.g. localhost,1433)" value={dbForm.server} onChange={e => setDbForm({...dbForm, server: e.target.value})} />
                        <input className="w-full bg-slate-900 border border-slate-600 rounded p-3 text-white outline-none text-sm" placeholder="Database Name" value={dbForm.database} onChange={e => setDbForm({...dbForm, database: e.target.value})} />
                        <input className="w-full bg-slate-900 border border-slate-600 rounded p-3 text-white outline-none text-sm" placeholder="Username" value={dbForm.username} onChange={e => setDbForm({...dbForm, username: e.target.value})} />
                        <input type="password" className="w-full bg-slate-900 border border-slate-600 rounded p-3 text-white outline-none text-sm" placeholder="Password" value={dbForm.password} onChange={e => setDbForm({...dbForm, password: e.target.value})} />
                     </div>
                     <button onClick={handleUpdateDbConnection} disabled={isSavingCore} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded font-bold shadow-lg shadow-blue-900/20 mt-4 disabled:opacity-50">Update Database Connection</button>
                 </div>
             </div>
        )}
    </div>
  );
};

export default Settings;
