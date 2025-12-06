
import React, { useState } from 'react';
import { User, AuthState, DbConfig, SystemConfig } from '../types';
import { loginUser, setupMfa, verifyMfaCode, commitMfaSetup } from '../services/authService';
import { connectToDatabase, runProvisioningScript, saveDbConfig, generateProductionSql } from '../services/dbService';
import { Lock, ShieldCheck, Database, Server, Smartphone, Loader, AlertTriangle, Building, Globe, Download, CheckCircle, Copy } from 'lucide-react';

interface LoginScreenProps {
  onLoginSuccess: (user: User) => void;
}

const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
  const [step, setStep] = useState<'LOGIN' | 'MFA_SETUP' | 'MFA_VERIFY' | 'ORG_SETUP' | 'DB_SETUP'>('LOGIN');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  
  // MFA State
  const [mfaSecret, setMfaSecret] = useState('');
  const [mfaQrCode, setMfaQrCode] = useState('');
  const [mfaCode, setMfaCode] = useState('');

  // Org Setup State
  const [sysConfig, setSysConfig] = useState<SystemConfig>({
      companyName: '',
      domain: '',
      logoUrl: '',
      setupCompletedAt: ''
  });

  // DB Setup State
  const [dbConfig, setDbConfig] = useState<DbConfig>({
      server: '', database: '', username: '', passwordEncrypted: '', isConnected: false
  });
  const [provLogs, setProvLogs] = useState<string[]>([]);
  const [generatedSql, setGeneratedSql] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const result = await loginUser(username, password);
    setLoading(false);

    if (result.success && result.user) {
        setCurrentUser(result.user);
        
        if (!result.user.mfaEnabled) {
            try {
                const mfaData = await setupMfa(result.user.id);
                setMfaSecret(mfaData.secret);
                setMfaQrCode(mfaData.qrCode);
                setStep('MFA_SETUP');
            } catch (e) {
                setError("Failed to initialize MFA setup. Check server logs.");
            }
        } else {
            setStep('MFA_VERIFY');
        }
    } else {
        setError(result.error || 'Login failed');
    }
  };

  const handleActivateMfa = async () => {
    if (!currentUser) return;
    setLoading(true);
    setError('');

    try {
        const success = await commitMfaSetup(currentUser, mfaSecret, mfaCode);
        if (success) {
            if (currentUser.id === 'temp-setup') {
                 setStep('ORG_SETUP');
            } else {
                 onLoginSuccess(currentUser);
            }
        } else {
            setError("Invalid Code. Ensure times are synced.");
        }
    } catch (e) {
        setError("Activation failed due to network error.");
    }
    setLoading(false);
  };

  const handleVerifyLogin = async () => {
    if (!currentUser) return;
    setLoading(true);
    setError('');

    try {
        const valid = await verifyMfaCode(currentUser.id, mfaCode);
        if (valid) {
            if (currentUser.id === 'temp-setup') {
                 setStep('ORG_SETUP');
            } else {
                 onLoginSuccess(currentUser);
            }
        } else {
            setError('Invalid Authenticator Code');
        }
    } catch (e) {
        setError("Verification failed.");
    }
    setLoading(false);
  };

  const handleOrgSetup = () => {
      if(!sysConfig.companyName || !sysConfig.domain) {
          setError("Company Name and Domain are required.");
          return;
      }
      setStep('DB_SETUP');
      setError('');
  };

  const handleDbProvision = async () => {
      setLoading(true);
      setProvLogs(prev => [...prev, `Connecting to MSSQL Server: ${dbConfig.server}...`]);
      try {
          await connectToDatabase(dbConfig);
          setProvLogs(prev => [...prev, `Connection Successful.`, `Checking Schema...`]);
          await runProvisioningScript(sysConfig);
          const sql = generateProductionSql(dbConfig, sysConfig);
          setGeneratedSql(sql);
          setProvLogs(prev => [...prev, `Tables Created.`, `Organization Configured.`]);
          saveDbConfig({...dbConfig, isConnected: true});
          setTimeout(() => {
              if (currentUser) onLoginSuccess({...currentUser, id: 'usr-super-01'}); 
          }, 3000);
      } catch (e) { setError("Database Connection Failed. Check server logs."); }
      setLoading(false);
  };

  const handleCopySecret = () => {
      if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(mfaSecret);
      } else {
          alert("Clipboard unavailable. Please copy manually.");
      }
  };

  return (
    <div className="min-h-screen bg-cyber-900 flex items-center justify-center p-4">
        <div className="bg-slate-800 border border-slate-700 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden">
            <div className="bg-slate-900 p-6 text-center border-b border-slate-700">
                <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-600 rounded-lg mb-4 shadow-lg shadow-blue-600/20">
                    <Lock className="w-6 h-6 text-white" />
                </div>
                <h1 className="text-xl font-bold text-white tracking-wider">SECURE ACCESS</h1>
                <p className="text-slate-500 text-sm mt-1">Virtual Puppets Enterprise</p>
            </div>

            <div className="p-8">
                {step === 'LOGIN' && (
                    <form onSubmit={handleLogin} className="space-y-4">
                        {error && <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-3 rounded text-sm text-center">{error}</div>}
                        <div>
                            <label className="block text-slate-400 text-xs font-bold uppercase mb-2">Username</label>
                            <input type="text" className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-white focus:border-blue-500 outline-none" value={username} onChange={(e) => setUsername(e.target.value)} />
                        </div>
                        <div>
                            <label className="block text-slate-400 text-xs font-bold uppercase mb-2">Password</label>
                            <input type="password" className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-white focus:border-blue-500 outline-none" value={password} onChange={(e) => setPassword(e.target.value)} />
                        </div>
                        <button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-lg flex justify-center items-center">
                            {loading ? <Loader className="animate-spin w-5 h-5" /> : 'AUTHENTICATE'}
                        </button>
                    </form>
                )}

                {step === 'MFA_SETUP' && (
                    <div className="text-center space-y-6">
                        <div className="bg-yellow-500/10 border border-yellow-500/20 p-4 rounded-lg">
                            <h3 className="text-yellow-400 font-bold flex items-center justify-center mb-2"><ShieldCheck className="w-5 h-5 mr-2" /> MFA Required</h3>
                            <p className="text-slate-400 text-sm">Scan with Google Authenticator.</p>
                        </div>
                        <div className="flex flex-col items-center">
                            <div className="bg-white p-4 rounded-lg mb-4">
                                {mfaQrCode ? <img src={mfaQrCode} alt="Scan MFA QR" className="w-32 h-32" /> : <Loader className="w-8 h-8 text-slate-500 animate-spin" />}
                            </div>
                            <div className="bg-black p-2 rounded text-xs font-mono text-slate-400 flex items-center space-x-2">
                                <span>{mfaSecret}</span>
                                <Copy className="w-3 h-3 cursor-pointer hover:text-white" onClick={handleCopySecret} />
                            </div>
                            <p className="text-[10px] text-slate-500 mt-1">Manual Entry Code</p>
                        </div>
                        <div className="space-y-2">
                            <input type="text" className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-white text-center tracking-widest text-xl focus:border-yellow-500 outline-none" 
                                value={mfaCode} onChange={(e) => setMfaCode(e.target.value.replace(/\s/g, ''))} placeholder="000000" />
                        </div>
                        {error && <div className="text-red-400 text-xs">{error}</div>}
                        <button onClick={handleActivateMfa} disabled={loading || mfaCode.length < 6} className="w-full bg-yellow-600 hover:bg-yellow-500 text-white font-bold py-3 rounded-lg flex justify-center items-center">
                            {loading ? <Loader className="animate-spin w-5 h-5" /> : 'ACTIVATE MFA'}
                        </button>
                    </div>
                )}

                {step === 'MFA_VERIFY' && (
                    <div className="text-center space-y-6">
                        <div className="flex justify-center mb-4"><Smartphone className="w-16 h-16 text-blue-500" /></div>
                        <h2 className="text-white text-lg font-bold">Two-Factor Authentication</h2>
                        <div className="space-y-2">
                            <input type="text" className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-white text-center tracking-widest text-xl focus:border-blue-500 outline-none" 
                                value={mfaCode} onChange={(e) => setMfaCode(e.target.value.replace(/\s/g, ''))} placeholder="000000" autoFocus />
                        </div>
                        {error && <div className="text-red-400 text-xs">{error}</div>}
                        <button onClick={handleVerifyLogin} disabled={loading || mfaCode.length < 6} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-lg flex justify-center items-center">
                            {loading ? <Loader className="animate-spin w-5 h-5" /> : 'VERIFY'}
                        </button>
                    </div>
                )}

                {/* Organization and DB Setup steps remain identical to previous full implementation but are included via logic flow */}
                {step === 'ORG_SETUP' && (
                    <div className="space-y-4">
                        <div className="bg-blue-500/10 border border-blue-500/20 p-4 rounded-lg flex items-center mb-4">
                            <Building className="w-6 h-6 text-blue-400 mr-3" />
                            <div><h3 className="text-blue-400 font-bold text-sm">Organization Setup</h3></div>
                        </div>
                        <input className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-white" value={sysConfig.companyName} onChange={(e) => setSysConfig({...sysConfig, companyName: e.target.value})} placeholder="Company Name" />
                        <input className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-white" value={sysConfig.domain} onChange={(e) => setSysConfig({...sysConfig, domain: e.target.value})} placeholder="Domain" />
                        <button onClick={handleOrgSetup} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-lg mt-4">CONTINUE</button>
                    </div>
                )}

                {step === 'DB_SETUP' && (
                    <div className="space-y-4">
                         <div className="bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-lg flex items-center mb-4">
                            <Database className="w-6 h-6 text-emerald-400 mr-3" />
                            <div><h3 className="text-emerald-400 font-bold text-sm">Database Provisioning</h3></div>
                        </div>
                        {error && <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-2 rounded text-xs text-center">{error}</div>}
                        <div className="space-y-3">
                            <input placeholder="Server Address" className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-sm text-white" value={dbConfig.server} onChange={(e) => setDbConfig({...dbConfig, server: e.target.value})} />
                            <input placeholder="Database Name" className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-sm text-white" value={dbConfig.database} onChange={(e) => setDbConfig({...dbConfig, database: e.target.value})} />
                            <input placeholder="Username" className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-sm text-white" value={dbConfig.username} onChange={(e) => setDbConfig({...dbConfig, username: e.target.value})} />
                            <input type="password" placeholder="Password" className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-sm text-white" value={dbConfig.passwordEncrypted} onChange={(e) => setDbConfig({...dbConfig, passwordEncrypted: e.target.value})} />
                        </div>
                        <div className="bg-black p-2 rounded h-24 overflow-y-auto text-[10px] font-mono text-emerald-400 border border-slate-800">
                            {provLogs.map((log, i) => <div key={i}>{'> ' + log}</div>)}
                        </div>
                         <button onClick={handleDbProvision} disabled={loading} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-lg flex justify-center items-center">
                            {loading ? <Loader className="animate-spin w-5 h-5" /> : 'PROVISION DATABASE'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    </div>
  );
};
export default LoginScreen;
