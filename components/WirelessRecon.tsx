
import React, { useState, useEffect } from 'react';
import { WifiNetwork, BluetoothDevice, Actor } from '../types';
import { getWifiNetworks, getBluetoothDevices } from '../services/dbService';
import { generateMockWifi, generateMockBluetooth } from '../services/mockService';
import { Wifi, Bluetooth, Search, Lock, Monitor, Radio, RefreshCw } from 'lucide-react';

interface WirelessReconProps {
    isProduction: boolean;
    actors: Actor[]; // Used for mock generation source
}

const WirelessRecon: React.FC<WirelessReconProps> = ({ isProduction, actors }) => {
    const [activeTab, setActiveTab] = useState<'WIFI' | 'BLUETOOTH'>('WIFI');
    const [wifiList, setWifiList] = useState<WifiNetwork[]>([]);
    const [btList, setBtList] = useState<BluetoothDevice[]>([]);
    const [search, setSearch] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const loadData = async (force = false) => {
        setIsLoading(true);
        if (isProduction) {
            if (activeTab === 'WIFI') {
                const data = await getWifiNetworks();
                setWifiList(data);
            } else {
                const data = await getBluetoothDevices();
                setBtList(data);
            }
        } else {
            // Mock Mode
            // Only generate if list is empty OR force refresh is requested
            if (activeTab === 'WIFI') {
                if(wifiList.length === 0 || force) {
                    const mockData = generateMockWifi(actors);
                    if (mockData.length > 0) setWifiList(mockData);
                }
            } else {
                if(btList.length === 0 || force) {
                    const mockData = generateMockBluetooth(actors);
                    if (mockData.length > 0) setBtList(mockData);
                }
            }
        }
        setIsLoading(false);
    };

    // Add actors to dependency to ensure we attempt generation once actors are loaded from parent
    useEffect(() => {
        loadData();
        const interval = setInterval(() => loadData(), 15000); // Auto refresh every 15s
        return () => clearInterval(interval);
    }, [activeTab, isProduction, actors]);

    const getSignalColor = (dbm: number) => {
        if (dbm > -50) return 'text-emerald-400';
        if (dbm > -70) return 'text-yellow-400';
        return 'text-red-400';
    };

    const getSignalBars = (dbm: number) => {
        let bars = 1;
        if (dbm > -80) bars = 2;
        if (dbm > -70) bars = 3;
        if (dbm > -50) bars = 4;
        
        return (
            <div className="flex items-end space-x-0.5 h-4">
                <div className={`w-1 rounded-sm ${bars >= 1 ? getSignalColor(dbm) : 'bg-slate-700'} h-1`}></div>
                <div className={`w-1 rounded-sm ${bars >= 2 ? getSignalColor(dbm) : 'bg-slate-700'} h-2`}></div>
                <div className={`w-1 rounded-sm ${bars >= 3 ? getSignalColor(dbm) : 'bg-slate-700'} h-3`}></div>
                <div className={`w-1 rounded-sm ${bars >= 4 ? getSignalColor(dbm) : 'bg-slate-700'} h-4`}></div>
            </div>
        );
    };

    const filteredWifi = wifiList.filter(w => 
        w.ssid.toLowerCase().includes(search.toLowerCase()) || 
        w.bssid.toLowerCase().includes(search.toLowerCase()) ||
        w.actorName.toLowerCase().includes(search.toLowerCase())
    );

    const filteredBt = btList.filter(b => 
        b.name.toLowerCase().includes(search.toLowerCase()) || 
        b.mac.toLowerCase().includes(search.toLowerCase()) ||
        b.actorName.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="space-y-6 animate-fade-in pb-10">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-slate-200 flex items-center">
                        <Radio className="w-6 h-6 mr-3 text-cyan-400" />
                        Wireless Reconnaissance
                    </h2>
                    <p className="text-slate-500 text-sm">
                        Aggregated Signal Intelligence from {actors.filter(a => a.hasWifi || a.hasBluetooth).length} capable field agents.
                    </p>
                </div>
                
                <div className="flex bg-slate-800 rounded-lg p-1 border border-slate-700">
                    <button 
                        onClick={() => setActiveTab('WIFI')}
                        className={`px-4 py-2 rounded text-sm font-bold flex items-center transition-all ${activeTab === 'WIFI' ? 'bg-cyan-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
                    >
                        <Wifi className="w-4 h-4 mr-2" />
                        Wi-Fi Networks
                    </button>
                    <button 
                        onClick={() => setActiveTab('BLUETOOTH')}
                        className={`px-4 py-2 rounded text-sm font-bold flex items-center transition-all ${activeTab === 'BLUETOOTH' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
                    >
                        <Bluetooth className="w-4 h-4 mr-2" />
                        Bluetooth Devices
                    </button>
                </div>
            </div>

            {/* Search & Stats Bar */}
            <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 flex flex-col md:flex-row justify-between items-center gap-4">
                <div className="relative w-full md:w-96">
                    <Search className="absolute left-3 top-3 w-4 h-4 text-slate-500" />
                    <input 
                        type="text" 
                        placeholder={`Search ${activeTab === 'WIFI' ? 'SSID, BSSID' : 'Device Name, MAC'}...`}
                        className="w-full bg-slate-900 border border-slate-600 rounded-lg py-2.5 pl-10 text-sm text-white focus:border-cyan-500 outline-none"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                <div className="flex items-center space-x-6 text-sm text-slate-400">
                    <div className="flex items-center">
                        <span className="text-white font-bold text-lg mr-2">
                            {activeTab === 'WIFI' ? filteredWifi.length : filteredBt.length}
                        </span>
                        Targets Found
                    </div>
                    <button onClick={() => loadData(true)} className="p-2 bg-slate-700 hover:bg-slate-600 rounded-full text-white transition-colors" title="Force Refresh">
                        <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {/* Data Grid */}
            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden shadow-lg">
                <table className="w-full text-left text-sm">
                    <thead className="bg-slate-900 text-slate-400 border-b border-slate-700">
                        <tr>
                            <th className="p-4 font-bold uppercase text-xs">Signal</th>
                            <th className="p-4 font-bold uppercase text-xs">{activeTab === 'WIFI' ? 'SSID / Network Name' : 'Device Name'}</th>
                            <th className="p-4 font-bold uppercase text-xs">{activeTab === 'WIFI' ? 'BSSID (MAC)' : 'MAC Address'}</th>
                            <th className="p-4 font-bold uppercase text-xs">{activeTab === 'WIFI' ? 'Security / Channel' : 'Type'}</th>
                            <th className="p-4 font-bold uppercase text-xs">Detected By</th>
                            <th className="p-4 font-bold uppercase text-xs text-right">Last Seen</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/50">
                        {activeTab === 'WIFI' ? (
                            filteredWifi.length === 0 ? (
                                <tr><td colSpan={6} className="p-8 text-center text-slate-500 italic">No Wi-Fi networks found matching criteria.</td></tr>
                            ) : (
                                filteredWifi.map(net => (
                                    <tr key={net.id} className="hover:bg-slate-700/30 transition-colors group">
                                        <td className="p-4">
                                            <div className="flex items-center space-x-2" title={`${net.signalStrength} dBm`}>
                                                {getSignalBars(net.signalStrength)}
                                                <span className="text-xs font-mono text-slate-500">{net.signalStrength}</span>
                                            </div>
                                        </td>
                                        <td className="p-4 font-bold text-white">
                                            {net.ssid || <span className="text-slate-600 italic">&lt;Hidden SSID&gt;</span>}
                                        </td>
                                        <td className="p-4 font-mono text-slate-400 text-xs">{net.bssid}</td>
                                        <td className="p-4">
                                            <div className="flex flex-col">
                                                <span className={`text-xs font-bold ${net.security === 'OPEN' ? 'text-red-400' : 'text-emerald-400'}`}>
                                                    {net.security === 'OPEN' ? <span className="flex items-center"><Lock className="w-3 h-3 mr-1"/> OPEN</span> : net.security}
                                                </span>
                                                <span className="text--[10px] text-slate-500">Channel {net.channel}</span>
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <div className="flex items-center text-xs text-slate-300">
                                                <Monitor className="w-3 h-3 mr-1.5 text-cyan-500" />
                                                {net.actorName}
                                            </div>
                                        </td>
                                        <td className="p-4 text-right text-xs text-slate-500 font-mono">
                                            {new Date(net.lastSeen).toLocaleTimeString()}
                                        </td>
                                    </tr>
                                ))
                            )
                        ) : (
                            filteredBt.length === 0 ? (
                                <tr><td colSpan={6} className="p-8 text-center text-slate-500 italic">No Bluetooth devices found matching criteria.</td></tr>
                            ) : (
                                filteredBt.map(bt => (
                                    <tr key={bt.id} className="hover:bg-slate-700/30 transition-colors group">
                                        <td className="p-4">
                                            <div className="flex items-center space-x-2" title={`${bt.rssi} dBm`}>
                                                {getSignalBars(bt.rssi)}
                                                <span className="text-xs font-mono text-slate-500">{bt.rssi}</span>
                                            </div>
                                        </td>
                                        <td className="p-4 font-bold text-white">
                                            {bt.name || <span className="text-slate-600 italic">Unknown Device</span>}
                                        </td>
                                        <td className="p-4 font-mono text-slate-400 text-xs">{bt.mac}</td>
                                        <td className="p-4">
                                            <span className="px-2 py-0.5 rounded bg-blue-900/30 text-blue-400 text-[10px] border border-blue-800">
                                                {bt.type}
                                            </span>
                                        </td>
                                        <td className="p-4">
                                            <div className="flex items-center text-xs text-slate-300">
                                                <Monitor className="w-3 h-3 mr-1.5 text-cyan-500" />
                                                {bt.actorName}
                                            </div>
                                        </td>
                                        <td className="p-4 text-right text-xs text-slate-500 font-mono">
                                            {new Date(bt.lastSeen).toLocaleTimeString()}
                                        </td>
                                    </tr>
                                ))
                            )
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default WirelessRecon;
    