import React, { useState, useEffect } from 'react';
import { PendingActor, ProxyGateway, ProvisioningStatus } from '../types';
import { generateEnrollmentToken as mockGenerateToken, simulateDeviceCallHome } from '../services/mockService';
import { registerGateway, generateEnrollmentToken } from '../services/dbService';
import { Copy, Terminal, Server, CheckCircle, Loader, X, PlusCircle, Router, Bot, RefreshCw, Trash2, Cpu } from 'lucide-react';

interface EnrollmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  gateways: ProxyGateway[];
  pendingActors: PendingActor[];
  setPendingActors: React.Dispatch<React.SetStateAction<PendingActor[]>>;
  onApprove: (pendingId: string, proxyId: string, name: string) => void;
  onReject?: (pendingId: string) => void;
  domain: string;
  isProduction?: boolean;
  onGatewayRegistered?: () => void;
}

// Sub-component for isolated row state
const PendingDeviceRow: React.FC<{
    device: PendingActor;
    gateways: ProxyGateway[];
    onApprove: (id: string, proxyId: string, name: string) => void;
    onReject?: (id: string) => void;
}> = ({ device, gateways, onApprove, onReject }) => {
    const [name, setName] = useState(`Linux-${device.id.split('_')[1] || 'Node'}`);
    const [proxyId, setProxyId] = useState<string>(gateways.length > 0 ? gateways[0].id : 'DIRECT');

    return (
        <div className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start">
                <div className="bg-yellow-500/20 p-2 rounded mr-3">
                    <Terminal className="w-5 h-5 text-yellow-500" />
                </div>
                <div>
                    <div className="flex items-center">
                        <span className="font-mono text-white font-bold mr-2">{device.hwid}</span>
                        <span className="text-[10px] bg-slate-700 text-slate-300 px-1.5 rounded">NEW</span>
                    </div>
                    <div className="text-xs text-slate-500 font-mono mt-1">
                        IP: {device.detectedIp} • Detected: {new Date(device.detectedAt).toLocaleTimeString()}
                    </div>
                    {device.osVersion && (
                        <div className="text-[10px] text-emerald-400 font-bold mt-1 flex items-center">
                            <Cpu className="w-3 h-3 mr-1" />
                            {device.osVersion}
                        </div>
                    )}
                </div>
            </div>

            <div className="flex items-center gap-2 bg-slate-900/50 p-2 rounded border border-slate-700/50">
                <div className="flex flex-col gap-1">
                    <input 
                        type="text" 
                        placeholder="Assign Name"
                        className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-white outline-none w-32"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />
                    <select 
                        className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-white outline-none w-32"
                        value={proxyId}
                        onChange={(e) => setProxyId(e.target.value)}
                    >
                        <option value="DIRECT">Direct (No Proxy)</option>
                        {gateways.map(g => (
                            <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                    </select>
                </div>
                <button 
                    onClick={() => onApprove(device.id, proxyId, name)}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white p-2 rounded h-full flex items-center justify-center transition-colors"
                    title="Adopt Device"
                >
                    <CheckCircle className="w-5 h-5" />
                </button>
                {onReject && (
                    <button 
                        onClick={() => onReject(device.id)}
                        className="bg-red-900/50 hover:bg-red-600 text-red-200 hover:text-white p-2 rounded h-full flex items-center justify-center transition-colors border border-red-800"
                        title="Reject/Delete Device"
                    >
                        <Trash2 className="w-5 h-5" />
                    </button>
                )}
            </div>
        </div>
    );
};

const EnrollmentModal: React.FC<EnrollmentModalProps> = ({ 
    isOpen, onClose, gateways, pendingActors, setPendingActors, onApprove, onReject, domain, isProduction, onGatewayRegistered
}) => {
  const [activeTab, setActiveTab] = useState<'ACTOR' | 'SITE'>('ACTOR');
  
  // Actor Generation State
  const [token, setToken] = useState<string>('');
  const [selectedProxyId, setSelectedProxyId] = useState<string>(gateways[0]?.id || 'DIRECT');
  const [isCopied, setIsCopied] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Site (Gateway) State
  const [newSiteName, setNewSiteName] = useState('');
  const [newSiteLocation, setNewSiteLocation] = useState('');
  const [siteToken, setSiteToken] = useState('');

  // Update token when proxy selection changes
  useEffect(() => {
    if (isOpen) {
        if (!gateways.find(g => g.id === selectedProxyId) && selectedProxyId !== 'DIRECT') {
             if (gateways.length > 0) setSelectedProxyId(gateways[0].id);
             else setSelectedProxyId('DIRECT');
        }

        if (isProduction) {
            handleGenerateToken();
        } else {
            setToken(mockGenerateToken());
        }
    }
  }, [isOpen, selectedProxyId, gateways.length]);

  const handleGenerateToken = async () => {
      setIsGenerating(true);
      const t = await generateEnrollmentToken('ACTOR', selectedProxyId);
      setToken(t);
      setIsGenerating(false);
  };

  const handleCopy = () => {
      // NOTE: Using /api/setup route directly
      const setupUrl = `http://${domain}/api/setup`;
      const cmd = `curl -sL ${setupUrl}?token=${token} | sudo bash`;
      
      if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(cmd);
          setIsCopied(true);
          setTimeout(() => setIsCopied(false), 2000);
      } else {
          alert("Clipboard access not available. Please copy the command manually.");
      }

      if (!isProduction && !isSimulating) {
          setIsSimulating(true);
          simulateDeviceCallHome().then(newDevice => {
              setPendingActors(prev => [...prev, newDevice]);
              setIsSimulating(false);
          });
      }
  };

  const handleRefreshPending = async () => {
      if (onGatewayRegistered && isProduction) {
          setIsRefreshing(true);
          await onGatewayRegistered(); 
          setTimeout(() => setIsRefreshing(false), 800);
      }
  };

  const handleCreateSite = async () => {
      if (!newSiteName || !newSiteLocation) return;
      
      const newGwId = `gw-${Math.random().toString(36).substr(2,6)}`;
      const newGw: ProxyGateway = {
          id: newGwId,
          name: newSiteName,
          location: newSiteLocation,
          status: 'OFFLINE',
          ip: '0.0.0.0',
          version: 'VPP-Proxy-Latest',
          connectedActors: 0
      };

      if (isProduction) {
          await registerGateway(newGw);
          if (onGatewayRegistered) {
              onGatewayRegistered();
          }
          const t = await generateEnrollmentToken('SITE', newGw.id);
          const setupUrl = `http://${domain}/api/setup`;
          const cmd = `curl -sL ${setupUrl}?token=${t} | sudo bash`;
          setSiteToken(cmd);
      } else {
          alert("Site created (Simulation). In production, this would register the gateway in DB.");
          const setupUrl = `http://${domain}/api/setup`;
          setSiteToken(`curl -sL ${setupUrl}?token=${newGw.id} | sudo bash`);
      }
  };

  const handleCopySiteToken = () => {
      if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(siteToken);
          alert("Command copied to clipboard");
      } else {
          alert("Clipboard access not available. Please copy manually.");
      }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
        <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            
            {/* Header */}
            <div className="bg-slate-800 p-4 border-b border-slate-700 flex justify-between items-center">
                <div className="flex items-center">
                    <PlusCircle className="w-5 h-5 text-blue-400 mr-2" />
                    <h2 className="text-lg font-bold text-white">Enrollment Center</h2>
                </div>
                <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
                    <X className="w-5 h-5" />
                </button>
            </div>

            <div className="flex border-b border-slate-700">
                <button 
                    onClick={() => setActiveTab('ACTOR')}
                    className={`flex-1 py-3 text-sm font-bold flex items-center justify-center ${activeTab === 'ACTOR' ? 'bg-slate-800 text-blue-400 border-b-2 border-blue-500' : 'text-slate-500 hover:text-white'}`}
                >
                    <Bot className="w-4 h-4 mr-2" /> Deploy Actor
                </button>
                <button 
                    onClick={() => setActiveTab('SITE')}
                    className={`flex-1 py-3 text-sm font-bold flex items-center justify-center ${activeTab === 'SITE' ? 'bg-slate-800 text-blue-400 border-b-2 border-blue-500' : 'text-slate-500 hover:text-white'}`}
                >
                    <Router className="w-4 h-4 mr-2" /> Deploy Site Gateway
                </button>
            </div>

            <div className="p-6 overflow-y-auto">
                
                {activeTab === 'ACTOR' && (
                    <>
                        {/* Step 1: Configuration */}
                        <div className="mb-6">
                            <label className="block text-slate-400 text-xs font-bold uppercase mb-2">Target Site (Proxy)</label>
                            <select 
                                className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm outline-none focus:border-blue-500"
                                value={selectedProxyId}
                                onChange={(e) => setSelectedProxyId(e.target.value)}
                            >
                                <option value="DIRECT">Direct to Cloud (No Proxy)</option>
                                {gateways.map(gw => (
                                    <option key={gw.id} value={gw.id}>{gw.name} ({gw.location})</option>
                                ))}
                            </select>
                            <p className="text-[10px] text-slate-500 mt-1">
                                Selecting a site ensures the actor is pre-configured to tunnel through the correct local proxy.
                            </p>
                        </div>

                        {/* Step 2: Command */}
                        <div className="mb-8">
                            <h3 className="text-sm uppercase tracking-wider text-slate-400 font-bold mb-3">Run Bootstrap Command</h3>
                            <div className="bg-black rounded-lg border border-slate-700 p-4 flex items-center justify-between group relative">
                                {isGenerating ? (
                                    <div className="text-slate-500 text-sm flex items-center">
                                        <Loader className="w-4 h-4 mr-2 animate-spin" /> Generating Token...
                                    </div>
                                ) : (
                                    <code className="font-mono text-emerald-400 text-xs md:text-sm break-all mr-4">
                                        curl -sL http://{domain}/api/setup?token={token} | sudo bash
                                    </code>
                                )}
                                
                                <button 
                                    onClick={handleCopy}
                                    disabled={isGenerating}
                                    className="bg-slate-800 hover:bg-slate-700 text-white p-2 rounded transition-colors shrink-0 disabled:opacity-50"
                                    title="Copy to Clipboard"
                                >
                                    {isCopied ? <CheckCircle className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                                </button>
                            </div>
                            {isSimulating && (
                                <div className="mt-2 text-xs text-blue-400 flex items-center animate-pulse">
                                    <Loader className="w-3 h-3 mr-1 animate-spin" />
                                    Simulating device connection...
                                </div>
                            )}
                        </div>

                        {/* Step 3: Pending Requests */}
                        <div>
                            <div className="flex justify-between items-end mb-3">
                                <h3 className="text-sm uppercase tracking-wider text-slate-400 font-bold">Pending Approvals</h3>
                                <div className="flex items-center space-x-2">
                                    {isProduction && (
                                        <button 
                                            onClick={handleRefreshPending}
                                            disabled={isRefreshing}
                                            className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800"
                                            title="Check for new devices"
                                        >
                                            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                                        </button>
                                    )}
                                    <span className="bg-blue-900 text-blue-300 text-[10px] px-2 py-0.5 rounded-full">{pendingActors.length} Waiting</span>
                                </div>
                            </div>

                            <div className="bg-slate-800/50 rounded-lg border border-slate-700 min-h-[150px] divide-y divide-slate-700">
                                {pendingActors.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-40 text-slate-500">
                                        <Server className="w-8 h-8 mb-2 opacity-30" />
                                        <p className="text-sm">No new devices detected.</p>
                                        {isProduction && <p className="text-xs mt-1">Click refresh after running script.</p>}
                                    </div>
                                ) : (
                                    pendingActors.map(device => (
                                        <PendingDeviceRow 
                                            key={device.id} 
                                            device={device} 
                                            gateways={gateways} 
                                            onApprove={onApprove} 
                                            onReject={onReject}
                                        />
                                    ))
                                )}
                            </div>
                        </div>
                    </>
                )}

                {activeTab === 'SITE' && (
                    <div className="space-y-6">
                        {!siteToken ? (
                            <>
                                <div>
                                    <label className="block text-slate-400 text-xs font-bold uppercase mb-2">Site Name</label>
                                    <input 
                                        className="w-full bg-slate-950 border border-slate-700 rounded p-3 text-white outline-none focus:border-blue-500"
                                        placeholder="e.g. Frankfurt Data Center"
                                        value={newSiteName}
                                        onChange={e => setNewSiteName(e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="block text-slate-400 text-xs font-bold uppercase mb-2">Location / Region</label>
                                    <input 
                                        className="w-full bg-slate-950 border border-slate-700 rounded p-3 text-white outline-none focus:border-blue-500"
                                        placeholder="e.g. Frankfurt, DE"
                                        value={newSiteLocation}
                                        onChange={e => setNewSiteLocation(e.target.value)}
                                    />
                                </div>
                                <button 
                                    onClick={handleCreateSite}
                                    disabled={!newSiteName || !newSiteLocation}
                                    className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold py-3 rounded-lg"
                                >
                                    CREATE SITE & GENERATE INSTALLER
                                </button>
                            </>
                        ) : (
                            <div className="space-y-4">
                                <div className="bg-emerald-500/10 border border-emerald-500/50 p-4 rounded-lg flex items-center">
                                    <CheckCircle className="w-6 h-6 text-emerald-500 mr-3" />
                                    <div>
                                        <h3 className="text-emerald-400 font-bold">Site Registered Successfully</h3>
                                        <p className="text-slate-400 text-xs">Run this command on the server designated as the Gateway.</p>
                                    </div>
                                </div>
                                <div className="bg-black rounded-lg border border-slate-700 p-4 relative group">
                                     <code className="font-mono text-emerald-400 text-sm break-all">
                                        {siteToken}
                                     </code>
                                     <button 
                                        onClick={handleCopySiteToken}
                                        className="absolute top-2 right-2 bg-slate-800 hover:bg-slate-700 text-white p-2 rounded"
                                    >
                                        <Copy className="w-4 h-4" />
                                    </button>
                                </div>
                                <button 
                                    onClick={() => { setSiteToken(''); setNewSiteName(''); setNewSiteLocation(''); }}
                                    className="text-slate-500 hover:text-white text-xs underline w-full text-center"
                                >
                                    Register Another Site
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>
            
            <div className="bg-slate-800 p-3 border-t border-slate-700 text-center">
                <p className="text-[10px] text-slate-500">Security Note: Only approve devices with HWIDs you recognize.</p>
            </div>
        </div>
    </div>
  );
};

export default EnrollmentModal;