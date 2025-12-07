
import React, { useState } from 'react';
import { ProxyGateway } from '../types';
import { generateEnrollmentToken, registerGateway, deleteGateway } from '../services/dbService';
import { Router, Plus, Trash2, MapPin, Globe, Copy, CheckCircle, Server, Loader } from 'lucide-react';

interface GatewayManagerProps {
  gateways: ProxyGateway[];
  onRefresh: () => void;
  domain: string;
  isProduction: boolean;
}

const GatewayManager: React.FC<GatewayManagerProps> = ({ gateways, onRefresh, domain, isProduction }) => {
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [installToken, setInstallToken] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleCreate = async () => {
      if (!newName || !newLocation) return;
      
      const newGw: ProxyGateway = {
          id: `gw-${Math.random().toString(36).substr(2,6)}`,
          name: newName,
          location: newLocation,
          status: 'OFFLINE',
          ip: '0.0.0.0',
          version: 'VPP-Proxy-Latest',
          connectedActors: 0,
          lat: 0,
          lng: 0
      };

      if (isProduction) {
          await registerGateway(newGw);
          const token = await generateEnrollmentToken('SITE', newGw.id);
          setInstallToken(`curl -sL http://${domain}/api/setup | sudo bash -s ${token}`);
          onRefresh();
      } else {
          // Mock
          setInstallToken(`curl -sL http://${domain}/api/setup | sudo bash -s ${newGw.id}`);
          // Note: In mock mode, we can't easily persist the gateway to the main list without lifting state up significantly, 
          // but checking "isProduction" usually covers the use case.
      }
      setIsCreating(false);
  };

  const handleDelete = async (id: string) => {
      if (confirm('Are you sure you want to remove this Gateway? Connected actors may become orphaned.')) {
          setDeletingId(id);
          await deleteGateway(id);
          setDeletingId(null);
          onRefresh();
      }
  };

  const copyToken = () => {
      if (installToken) {
          if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(installToken);
              setIsCopied(true);
              setTimeout(() => setIsCopied(false), 2000);
          } else {
              alert("Clipboard access not available. Please copy manually.");
          }
      }
  };

  return (
    <div className="space-y-6 animate-fade-in pb-10">
        <div className="flex justify-between items-center">
            <div>
                <h2 className="text-2xl font-bold text-slate-200">Network Infrastructure</h2>
                <p className="text-slate-500 text-sm">Manage proxy gateways and site concentrators.</p>
            </div>
            <button 
                onClick={() => { setIsCreating(true); setInstallToken(null); setNewName(''); setNewLocation(''); }}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg flex items-center font-bold text-sm shadow-lg"
            >
                <Plus className="w-4 h-4 mr-2" /> Deploy Gateway
            </button>
        </div>

        {isCreating && !installToken && (
            <div className="bg-slate-800 p-6 rounded-xl border border-indigo-500/50 shadow-lg animate-fade-in">
                <h3 className="text-lg font-bold text-white mb-4">New Site Configuration</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                        <label className="block text-slate-400 text-xs font-bold uppercase mb-2">Site Name</label>
                        <input 
                            className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-white outline-none focus:border-indigo-500"
                            placeholder="e.g. London Branch Office"
                            value={newName}
                            onChange={e => setNewName(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="block text-slate-400 text-xs font-bold uppercase mb-2">Location</label>
                        <input 
                            className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-white outline-none focus:border-indigo-500"
                            placeholder="e.g. London, UK"
                            value={newLocation}
                            onChange={e => setNewLocation(e.target.value)}
                        />
                    </div>
                </div>
                <div className="flex justify-end space-x-3">
                    <button onClick={() => setIsCreating(false)} className="px-4 py-2 text-slate-400 hover:text-white">Cancel</button>
                    <button onClick={handleCreate} disabled={!newName || !newLocation} className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2 rounded font-bold">Create & Get Installer</button>
                </div>
            </div>
        )}

        {installToken && (
             <div className="bg-slate-800 p-6 rounded-xl border border-emerald-500/50 shadow-lg animate-fade-in">
                 <div className="flex items-center mb-4 text-emerald-400">
                     <CheckCircle className="w-6 h-6 mr-2" />
                     <h3 className="text-lg font-bold">Gateway Registered</h3>
                 </div>
                 <p className="text-slate-400 text-sm mb-4">Run this command on your Ubuntu/Debian server to install the proxy agent:</p>
                 <div className="bg-black p-4 rounded-lg border border-slate-700 flex justify-between items-center group relative">
                     <code className="text-emerald-400 font-mono text-sm break-all mr-4">{installToken}</code>
                     <button onClick={copyToken} className="bg-slate-800 p-2 rounded hover:bg-slate-700 text-white shrink-0">
                         {isCopied ? <CheckCircle className="w-4 h-4 text-emerald-500"/> : <Copy className="w-4 h-4"/>}
                     </button>
                 </div>
                 <div className="mt-4 text-right">
                     <button onClick={() => setInstallToken(null)} className="text-slate-500 hover:text-white text-sm">Close</button>
                 </div>
             </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {gateways.map(gw => (
                <div key={gw.id} className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden hover:border-indigo-500/50 transition-all shadow-lg group">
                    <div className="p-6">
                        <div className="flex justify-between items-start mb-4">
                            <div className="bg-indigo-900/30 p-3 rounded-lg">
                                <Router className="w-6 h-6 text-indigo-400" />
                            </div>
                            <div className={`px-2 py-1 rounded text-[10px] font-bold ${gw.status === 'ONLINE' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-400'}`}>
                                {gw.status}
                            </div>
                        </div>
                        <h3 className="text-lg font-bold text-white mb-1">{gw.name}</h3>
                        <div className="flex items-center text-slate-500 text-sm mb-4">
                            <MapPin className="w-3 h-3 mr-1" /> {gw.location}
                        </div>
                        
                        <div className="space-y-2 border-t border-slate-700 pt-4">
                            <div className="flex justify-between text-xs">
                                <span className="text-slate-500 flex items-center"><Globe className="w-3 h-3 mr-1"/> Public IP</span>
                                <span className="text-slate-300 font-mono">{gw.ip}</span>
                            </div>
                            <div className="flex justify-between text-xs">
                                <span className="text-slate-500 flex items-center"><Server className="w-3 h-3 mr-1"/> Version</span>
                                <span className="text-slate-300">{gw.version}</span>
                            </div>
                             <div className="flex justify-between text-xs">
                                <span className="text-slate-500">Nodes Connected</span>
                                <span className="text-indigo-400 font-bold">{gw.connectedActors}</span>
                            </div>
                        </div>
                    </div>
                    <div className="bg-slate-900/50 p-3 border-t border-slate-700 flex justify-end">
                        <button 
                            onClick={() => handleDelete(gw.id)} 
                            disabled={deletingId === gw.id}
                            className="text-slate-500 hover:text-red-400 text-xs flex items-center px-2 py-1 hover:bg-slate-800 rounded transition-colors"
                        >
                            {deletingId === gw.id ? <Loader className="w-3 h-3 mr-1 animate-spin" /> : <Trash2 className="w-3 h-3 mr-1" />}
                            Delete Gateway
                        </button>
                    </div>
                </div>
            ))}
        </div>
    </div>
  );
};

export default GatewayManager;
