import React, { useState, useEffect } from 'react';
import { User, DbConfig, UserRole, SystemConfig, AiConfig, AiProvider, SyslogConfig } from '../types';
import { dbQuery, getSystemConfig, updateSystemConfig, connectToDatabase } from '../services/dbService';
import { createUser, deleteUser, hashPassword, updateUser, resetUserMfa } from '../services/authService';
import { testAiConnection } from '../services/aiService';
import { Settings as SettingsIcon, Database, Users, Shield, Trash2, AlertTriangle, Plus, Lock, Bot, Cloud, Server, Building, Globe, Save, RefreshCw, Edit, ShieldAlert, X, Check, ShieldCheck, FileText, Key, Activity } from 'lucide-react';

interface SettingsProps {
  isProduction: boolean;
  onToggleProduction: () => void;
  currentUser: User | null;
  onConfigUpdate?: () => void;
}

const Settings: React.FC<SettingsProps> = ({ isProduction, onToggleProduction, currentUser, onConfigUpdate }) => {
  const [activeTab, setActiveTab] = useState<'GENERAL' | 'DATABASE' | 'USERS' | 'AI' | 'AUDIT' | 'CORE'>('GENERAL');
  
  const [users, setUsers] = useState<User[]>([]);
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'VIEWER' as UserRole });
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editPassword, setEditPassword] = useState('');
  
  const [sysConfig, setSysConfig] = useState<SystemConfig | null>(null);
  const [isTestingAi, setIsTestingAi] = useState(false);
  
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
            if (activeTab === 'AI' || activeTab === 'CORE' || activeTab === 'AUDIT') {
                const cfg = await getSystemConfig();
                if (cfg) {
                    setSysConfig(cfg);
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
  }, [isProduction, activeTab]);

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

  const handleSaveOrgConfig = async () => {
      setIsSavingCore(true);
      try {
          const updated: SystemConfig = {
              companyName: orgForm.companyName,
              domain: orgForm.domain,
              logoUrl: orgForm.logoUrl,
              setupCompletedAt: new Date().toISOString(),
              aiConfig: sysConfig?.aiConfig || aiForm,
              syslogConfig: sysConfig?.syslogConfig || syslogForm
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
                                <Key className="absolute top-3 left-3 w-4 h-4 text-slate-500" />
                                <input
                                    type="password"
                                    value={aiForm.apiKey || ''}
                                    onChange={e => setAiForm({...aiForm, apiKey: e.target.value})}
                                    className="w-full bg-slate-900 border border-slate-600 rounded p-3 pl-10 text-white focus:border-purple-500 outline-none"
                                    placeholder="Enter API Key (Optional - Overrides System Env)"
                                />
                            </div>
                             <p className="text-[10px] text-slate-500 mt-1">
                                If left empty, the application will use the pre-configured <code>process.env.API_KEY</code>.
                            </p>
                        </div>
                    )}

                    {aiForm.provider === 'LOCAL' && (
                        <>
                            <div>
                                <label className="block text-slate-500 text-xs font-bold uppercase mb-1">Endpoint URL (OpenAI Compatible)</label>
                                <input 
                                    value={aiForm.endpoint}
                                    onChange={e => setAiForm({...aiForm, endpoint: e.target.value})}
                                    className="w-full bg-slate-900 border border-slate-600 rounded p-3 text-white focus:border-emerald-500 outline-none font-mono text-sm" 
                                    placeholder="http://localhost:11434/v1/chat/completions"
                                />
                            </div>
                            <div>
                                <label className="block text-slate-500 text-xs font-bold uppercase mb-1">Authorization Token (Optional)</label>
                                <input 
                                    type="password"
                                    value={aiForm.authToken}
                                    onChange={e => setAiForm({...aiForm, authToken: e.target.value})}
                                    className="w-full bg-slate-900 border border-slate-600 rounded p-3 text-white focus:border-emerald-500 outline-none" 
                                    placeholder="Bearer sk-..."
                                />
                            </div>
                        </>
                    )}

                    <div className="flex gap-4 mt-4">
                        <button 
                            onClick={handleTestAi}
                            disabled={isTestingAi}
                            className={`flex-1 flex justify-center items-center py-3 rounded-lg font-bold transition-colors ${isTestingAi ? 'bg-slate-700 text-slate-400' : 'bg-slate-700 hover:bg-slate-600 text-white'}`}
                        >
                            {isTestingAi ? <RefreshCw className="w-4 h-4 animate-spin mr-2"/> : <Activity className="w-4 h-4 mr-2" />}
                            Test Connection
                        </button>

                        <button 
                            onClick={handleSaveAiConfig}
                            className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-lg transition-colors shadow-lg shadow-blue-600/20"
                        >
                            SAVE CONFIGURATION
                        </button>
                    </div>
                </div>
             </div>
        )}

        {activeTab === 'USERS' && (
            <div className="space-y-6">
                {/* Create New User */}
                <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-lg">
                    <h3 className="text-lg font-bold text-white mb-4 flex items-center">
                        <Plus className="w-5 h-5 mr-2 text-blue-400" />
                        Provision New User
                    </h3>
                    <div className="flex gap-4 items-end">
                        <div className="flex-1">
                            <label className="block text-slate-500 text-xs font-bold uppercase mb-1">Username</label>
                            <input 
                                value={newUser.username}
                                onChange={e => setNewUser({...newUser, username: e.target.value})}
                                className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white" 
                            />
                        </div>
                        <div className="flex-1">
                            <label className="block text-slate-500 text-xs font-bold uppercase mb-1">Password</label>
                            <input 
                                type="password"
                                value={newUser.password}
                                onChange={e => setNewUser({...newUser, password: e.target.value})}
                                className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white" 
                            />
                        </div>
                        <div className="w-32">
                            <label className="block text-slate-500 text-xs font-bold uppercase mb-1">Role</label>
                            <select 
                                value={newUser.role}
                                onChange={e => setNewUser({...newUser, role: e.target.value as UserRole})}
                                className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white"
                            >
                                <option value="VIEWER">Viewer</option>
                                <option value="ADMIN">Admin</option>
                                <option value="SUPERADMIN">SuperAdmin</option>
                            </select>
                        </div>
                        <button 
                            onClick={handleAddUser}
                            className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded font-bold transition-colors"
                        >
                            Create
                        </button>
                    </div>
                </div>

                {/* Edit Modal / Inline Edit */}
                {editingUser && (
                    <div className="bg-slate-800 rounded-xl border border-blue-500 p-6 shadow-lg relative">
                        <h3 className="text-lg font-bold text-white mb-4 flex items-center">
                            <Edit className="w-5 h-5 mr-2 text-blue-400" />
                            Edit User: {editingUser.username}
                        </h3>
                        <div className="grid grid-cols-2 gap-4 mb-4">
                            <div>
                                <label className="block text-slate-500 text-xs font-bold uppercase mb-1">Role</label>
                                <select 
                                    value={editingUser.role}
                                    onChange={e => setEditingUser({...editingUser, role: e.target.value as UserRole})}
                                    className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white"
                                >
                                    <option value="VIEWER">Viewer</option>
                                    <option value="ADMIN">Admin</option>
                                    <option value="SUPERADMIN">SuperAdmin</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-slate-500 text-xs font-bold uppercase mb-1">New Password (Optional)</label>
                                <input 
                                    type="password"
                                    value={editPassword}
                                    onChange={e => setEditPassword(e.target.value)}
                                    placeholder="Leave blank to keep current"
                                    className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white" 
                                />
                            </div>
                        </div>
                        <div className="flex justify-end space-x-2">
                            <button onClick={() => setEditingUser(null)} className="px-3 py-1 text-slate-400 hover:text-white">Cancel</button>
                            <button onClick={handleUpdateUser} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-1 rounded flex items-center">
                                <Save className="w-4 h-4 mr-2" /> Save Changes
                            </button>
                        </div>
                    </div>
                )}

                {/* User List */}
                <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-slate-900 text-slate-400">
                            <tr>
                                <th className="p-4 font-bold uppercase text-xs">Username</th>
                                <th className="p-4 font-bold uppercase text-xs">Role</th>
                                <th className="p-4 font-bold uppercase text-xs">Security</th>
                                <th className="p-4 font-bold uppercase text-xs text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-700">
                            {users.map(u => (
                                <tr key={u.id} className="hover:bg-slate-700/30">
                                    <td className="p-4 font-bold text-white">{u.username}</td>
                                    <td className="p-4">
                                        <span className={`px-2 py-1 rounded text-xs font-bold ${
                                            u.role === 'SUPERADMIN' ? 'bg-purple-500/20 text-purple-400' :
                                            u.role === 'ADMIN' ? 'bg-blue-500/20 text-blue-400' :
                                            'bg-slate-500/20 text-slate-400'
                                        }`}>
                                            {u.role}
                                        </span>
                                    </td>
                                    <td className="p-4">
                                        {u.mfaEnabled ? (
                                            <span className="flex items-center text-emerald-400 text-xs">
                                                <ShieldCheck className="w-3 h-3 mr-1" /> MFA Active
                                            </span>
                                        ) : (
                                            <span className="flex items-center text-yellow-500 text-xs">
                                                <AlertTriangle className="w-3 h-3 mr-1" /> No MFA
                                            </span>
                                        )}
                                    </td>
                                    <td className="p-4 text-right">
                                        <div className="flex items-center justify-end space-x-2">
                                            <button 
                                                onClick={() => handleResetMfa(u.id)}
                                                className="bg-slate-700 hover:bg-yellow-600/20 text-slate-400 hover:text-yellow-500 p-2 rounded transition-colors"
                                                title="Reset MFA (Force Re-enrollment)"
                                            >
                                                <ShieldAlert className="w-4 h-4" />
                                            </button>
                                            <button 
                                                onClick={() => setEditingUser(u)}
                                                className="bg-slate-700 hover:bg-blue-600/20 text-slate-400 hover:text-blue-400 p-2 rounded transition-colors"
                                                title="Edit User"
                                            >
                                                <Edit className="w-4 h-4" />
                                            </button>
                                            <button 
                                                onClick={() => handleDeleteUser(u.id)}
                                                className="bg-slate-700 hover:bg-red-600/20 text-slate-400 hover:text-red-400 p-2 rounded transition-colors"
                                                title="Delete User"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        )}

        {/* Core & Branding Tab */}
        {activeTab === 'CORE' && isSuperAdmin && (
             <div className="space-y-6">
                <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-lg">
                    <div className="flex items-start mb-4">
                         <div className="bg-blue-900/30 p-3 rounded-full mr-4">
                            <Building className="w-6 h-6 text-blue-400" />
                         </div>
                         <div>
                             <h3 className="text-lg font-bold text-white">Organization Branding</h3>
                             <p className="text-slate-400 text-sm">Update company identity details used in reports and headers.</p>
                         </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl ml-16">
                         <div>
                            <label className="block text-slate-500 text-xs font-bold uppercase mb-1">Company Name</label>
                            <input 
                                value={orgForm.companyName}
                                onChange={e => setOrgForm({...orgForm, companyName: e.target.value})}
                                className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white outline-none" 
                            />
                        </div>
                        <div>
                            <label className="block text-slate-500 text-xs font-bold uppercase mb-1">Domain FQDN</label>
                             <div className="relative">
                                <Globe className="absolute left-2 top-2 w-4 h-4 text-slate-500" />
                                <input 
                                    value={orgForm.domain}
                                    onChange={e => setOrgForm({...orgForm, domain: e.target.value})}
                                    className="w-full bg-slate-900 border border-slate-600 rounded p-2 pl-8 text-white outline-none" 
                                />
                            </div>
                        </div>
                        <div className="col-span-2">
                            <label className="block text-slate-500 text-xs font-bold uppercase mb-1">Logo URL</label>
                            <input 
                                value={orgForm.logoUrl}
                                onChange={e => setOrgForm({...orgForm, logoUrl: e.target.value})}
                                className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white outline-none" 
                                placeholder="https://..."
                            />
                        </div>
                    </div>
                    <div className="flex justify-end mt-4">
                        <button 
                            onClick={handleSaveOrgConfig}
                            disabled={isSavingCore}
                            className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded font-bold flex items-center disabled:opacity-50"
                        >
                            <Save className="w-4 h-4 mr-2" /> Save Branding
                        </button>
                    </div>
                </div>

                <div className="bg-slate-800 rounded-xl border border-red-500/30 p-6 shadow-lg">
                    <div className="flex items-start mb-4">
                         <div className="bg-red-900/20 p-3 rounded-full mr-4">
                            <Database className="w-6 h-6 text-red-400" />
                         </div>
                         <div>
                             <h3 className="text-lg font-bold text-white">Database Connection</h3>
                             <p className="text-slate-400 text-sm">
                                 <span className="text-red-400 font-bold mr-1">DANGER ZONE:</span> 
                                 Updating these details will force a reconnection.
                             </p>
                         </div>
                    </div>
                    
                    <div className="grid grid-cols-1 gap-4 max-w-xl ml-16">
                         <input 
                                placeholder="Server Address (e.g. sql.internal:1433)"
                                className="bg-slate-900 border border-slate-600 rounded p-2 text-sm text-white"
                                value={dbForm.server}
                                onChange={(e) => setDbForm({...dbForm, server: e.target.value})}
                            />
                            <input 
                                placeholder="Database Name"
                                className="bg-slate-900 border border-slate-600 rounded p-2 text-sm text-white"
                                value={dbForm.database}
                                onChange={(e) => setDbForm({...dbForm, database: e.target.value})}
                            />
                            <input 
                                placeholder="SA Username"
                                className="bg-slate-900 border border-slate-600 rounded p-2 text-sm text-white"
                                value={dbForm.username}
                                onChange={(e) => setDbForm({...dbForm, username: e.target.value})}
                            />
                            <input 
                                type="password"
                                placeholder="New Password"
                                className="bg-slate-900 border border-slate-600 rounded p-2 text-sm text-white"
                                value={dbForm.password}
                                onChange={(e) => setDbForm({...dbForm, password: e.target.value})}
                            />
                    </div>
                    <div className="flex justify-end mt-4">
                        <button 
                            onClick={handleUpdateDbConnection}
                            disabled={isSavingCore}
                            className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded font-bold flex items-center disabled:opacity-50"
                        >
                            <RefreshCw className="w-4 h-4 mr-2" /> Update & Reconnect
                        </button>
                    </div>
                </div>
             </div>
        )}
    </div>
  );
};

export default Settings;