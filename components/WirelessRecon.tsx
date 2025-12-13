
import React, { useState, useEffect, useMemo } from 'react';
import { WifiNetwork, BluetoothDevice, Actor, WirelessThreatConfig, SystemConfig, WatchlistTarget } from '../types';
import { getWifiNetworks, getBluetoothDevices, getSystemConfig, updateSystemConfig } from '../services/dbService';
import { generateMockWifi, generateMockBluetooth } from '../services/mockService';
import { Wifi, Bluetooth, Search, Lock, Monitor, Radio, RefreshCw, AlertTriangle, ChevronLeft, ChevronRight, Layers, ArrowUp, ArrowDown, GripVertical, Factory, Ruler, Signal, Tag, Shield, Activity, Save, Settings, Info, Siren, Plus, Trash2, Crosshair, Users, VolumeX } from 'lucide-react';

interface WirelessReconProps {
    isProduction: boolean;
    actors: Actor[];
}

const ITEMS_PER_PAGE = 10;

// Enriched Columns Definition
const DEFAULT_WIFI_COLUMNS = [
    { id: 'signal', label: 'Signal / Dist' },
    { id: 'name', label: 'SSID' },
    { id: 'mac', label: 'BSSID' },
    { id: 'vendor', label: 'Manufacturer' },
    { id: 'channel', label: 'Band / Channel' },
    { id: 'security', label: 'Security' },
    { id: 'actor', label: 'Detected By' },
    { id: 'time', label: 'Last Seen' }
];

const DEFAULT_BT_COLUMNS = [
    { id: 'signal', label: 'Signal / Dist' },
    { id: 'name', label: 'Device Name' },
    { id: 'mac', label: 'MAC Address' },
    { id: 'vendor', label: 'Manufacturer' },
    { id: 'type', label: 'Type' },
    { id: 'actor', label: 'Detected By' },
    { id: 'time', label: 'Last Seen' }
];

// OUI Database for Vendor Lookup
const OUI_DB: Record<string, string> = {
    'B8:27:EB': 'Raspberry Pi',
    'DC:A6:32': 'Raspberry Pi',
    'E4:5F:01': 'Raspberry Pi',
    'D8:3C:69': 'Apple Inc.',
    'F0:18:98': 'Apple Inc.',
    '7C:D1:C3': 'Apple Inc.',
    '00:1A:11': 'Google',
    '3C:5A:B4': 'Google',
    '00:0C:29': 'VMware',
    '00:50:56': 'VMware',
    '98:01:A7': 'Intel Corp',
    '00:14:BF': 'Cisco-Linksys',
    '00:24:1D': 'GIANT ELECTRIC',
    '00:09:5B': 'Netgear',
    'AC:84:C6': 'TP-Link',
    '00:11:32': 'Synology',
    '44:38:39': 'Cumulus',
    '48:2C:6A': 'Hewlett Packard',
    '00:E0:4C': 'Realtek'
};

// --- Helpers ---

const resolveVendor = (mac: string) => {
    if (!mac) return 'Unknown';
    const cleanMac = mac.toUpperCase().replace(/-/g, ':');
    const prefix = cleanMac.substring(0, 8);
    if (OUI_DB[prefix]) return OUI_DB[prefix];
    const firstByte = parseInt(cleanMac.substring(0, 2), 16);
    if (!isNaN(firstByte) && (firstByte & 0b10)) {
        return 'Randomized / Private';
    }
    return 'Generic / Unknown';
};

const estimateDistance = (rssi: number) => {
    if (rssi === 0 || rssi < -100) return 'Unknown';
    const txPower = -40;
    const n = 2.5; 
    const ratio = (txPower - rssi) / (10 * n);
    const dist = Math.pow(10, ratio);
    if (dist < 1.0) return '< 1m';
    if (dist > 50) return '> 50m';
    return `~${dist.toFixed(1)}m`;
};

const getBand = (channel: number) => {
    if (channel >= 1 && channel <= 14) return '2.4 GHz';
    if (channel >= 36 && channel <= 177) return '5 GHz';
    if (channel > 177) return '6 GHz';
    return 'Unknown';
};

const WirelessRecon: React.FC<WirelessReconProps> = ({ isProduction, actors }) => {
    const [activeTab, setActiveTab] = useState<'WIFI' | 'BLUETOOTH' | 'ANALYSIS'>('WIFI');
    const [wifiList, setWifiList] = useState<WifiNetwork[]>([]);
    const [btList, setBtList] = useState<BluetoothDevice[]>([]);
    const [search, setSearch] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' }>({ key: 'signal', direction: 'desc' });
    const [wifiColumns, setWifiColumns] = useState(DEFAULT_WIFI_COLUMNS);
    const [btColumns, setBtColumns] = useState(DEFAULT_BT_COLUMNS);
    const [draggedColumnIndex, setDraggedColumnIndex] = useState<number | null>(null);

    // Analysis Config State
    const [threatConfig, setThreatConfig] = useState<WirelessThreatConfig>({
        corpSsid: '',
        allowedBssids: [],
        shadowKeywords: ['printer', 'hp', 'canon', 'direct', 'iphone', 'android'],
        minRssiForAlert: -75,
        watchlist: []
    });
    const [isSavingConfig, setIsSavingConfig] = useState(false);
    const [sysConfig, setSysConfig] = useState<SystemConfig | null>(null);
    
    // Watchlist State
    const [newTargetName, setNewTargetName] = useState('');
    const [newTargetMac, setNewTargetMac] = useState('');
    const [newTargetType, setNewTargetType] = useState<'WIFI' | 'BT'>('WIFI');

    const activeColumns = activeTab === 'WIFI' ? wifiColumns : btColumns;
    const setActiveColumns = activeTab === 'WIFI' ? setWifiColumns : setBtColumns;

    const loadData = async (force = false) => {
        setIsLoading(true);
        try {
            if (isProduction) {
                // Load Threat Config on refresh
                const cfg = await getSystemConfig();
                if (cfg) {
                    setSysConfig(cfg);
                    if (cfg.wirelessConfig) setThreatConfig(cfg.wirelessConfig);
                }

                if (activeTab === 'WIFI' || activeTab === 'ANALYSIS') {
                    const data = await getWifiNetworks();
                    setWifiList(data);
                }
                if (activeTab === 'BLUETOOTH') {
                    const data = await getBluetoothDevices();
                    setBtList(data);
                }
            } else {
                // Mock Mode
                if (activeTab === 'WIFI' || activeTab === 'ANALYSIS') {
                    if (wifiList.length === 0 || force) {
                        const mockData = generateMockWifi(actors);
                        if (mockData.length > 0) setWifiList(mockData);
                    }
                }
                if (activeTab === 'BLUETOOTH') {
                    if (btList.length === 0 || force) {
                        const mockData = generateMockBluetooth(actors);
                        if (mockData.length > 0) setBtList(mockData);
                    }
                }
            }
        } catch (e) {
            console.error("Fetch failed", e);
        }
        setIsLoading(false);
    };

    useEffect(() => {
        loadData();
        const interval = setInterval(() => loadData(), 15000);
        return () => clearInterval(interval);
    }, [activeTab, isProduction]);

    useEffect(() => {
        setCurrentPage(1);
        setSortConfig({ key: 'signal', direction: 'desc' });
    }, [activeTab, search]);

    const handleSaveThreatConfig = async () => {
        if (!sysConfig) return;
        setIsSavingConfig(true);
        const updatedConfig = { ...sysConfig, wirelessConfig: threatConfig };
        if (isProduction) {
            await updateSystemConfig(updatedConfig);
        }
        setSysConfig(updatedConfig);
        setIsSavingConfig(false);
        alert("Threat Detection Policies Updated.");
    };

    const handleAddToWatchlist = () => {
        if (!newTargetMac || !newTargetName) return;
        const newTarget: WatchlistTarget = { mac: newTargetMac, name: newTargetName, type: newTargetType };
        setThreatConfig(prev => ({
            ...prev,
            watchlist: [...(prev.watchlist || []), newTarget]
        }));
        setNewTargetMac('');
        setNewTargetName('');
    };

    const handleRemoveFromWatchlist = (mac: string) => {
        setThreatConfig(prev => ({
            ...prev,
            watchlist: (prev.watchlist || []).filter(t => t.mac !== mac)
        }));
    };

    const handleToggleRestricted = async (actor: Actor) => {
        if (isProduction) {
            try {
                await fetch(`/api/actors/${actor.id}/restricted`, {
                    method: 'PUT',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ enabled: !actor.isRestrictedZone })
                });
                // Optimistic UI Update or Refresh
                actor.isRestrictedZone = !actor.isRestrictedZone; 
                // Force refresh to sync state
                loadData(true);
            } catch (e) { alert("Failed to toggle restricted mode"); }
        } else {
            actor.isRestrictedZone = !actor.isRestrictedZone;
            alert(`SCIF Mode for ${actor.name} is now ${actor.isRestrictedZone ? 'ENABLED' : 'DISABLED'}`);
        }
    };

    const handleSort = (key: string) => {
        setSortConfig(current => {
            if (current.key === key) {
                return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
            }
            return { key, direction: 'asc' };
        });
    };

    // --- Drag and Drop Handlers ---
    const handleDragStart = (e: React.DragEvent, index: number) => {
        setDraggedColumnIndex(index);
        e.dataTransfer.effectAllowed = "move";
    };

    const handleDragOver = (e: React.DragEvent, index: number) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
    };

    const handleDrop = (e: React.DragEvent, dropIndex: number) => {
        e.preventDefault();
        if (draggedColumnIndex === null || draggedColumnIndex === dropIndex) return;
        const newColumns = [...activeColumns];
        const [movedColumn] = newColumns.splice(draggedColumnIndex, 1);
        newColumns.splice(dropIndex, 0, movedColumn);
        setActiveColumns(newColumns);
        setDraggedColumnIndex(null);
    };

    // --- Analysis Logic ---
    const analysisResults = useMemo(() => {
        const evilTwins = wifiList.filter(n => threatConfig.corpSsid && n.ssid === threatConfig.corpSsid && !threatConfig.allowedBssids.includes(n.bssid));
        const shadowIT = wifiList.filter(n => threatConfig.shadowKeywords.some(k => n.ssid?.toLowerCase().includes(k.toLowerCase())) && n.signalStrength > threatConfig.minRssiForAlert);
        
        // Watchlist Matches
        const watchlistHits = [...wifiList, ...btList].filter(dev => {
            const mac = 'bssid' in dev ? dev.bssid : (dev as BluetoothDevice).mac;
            return threatConfig.watchlist?.some(w => w.mac.toUpperCase() === mac.toUpperCase());
        });

        return { evilTwins, shadowIT, watchlistHits };
    }, [wifiList, btList, threatConfig]);

    const totalThreats = analysisResults.evilTwins.length + analysisResults.shadowIT.length + analysisResults.watchlistHits.length;

    const processData = useMemo(() => {
        let rawList: any[] = activeTab === 'WIFI' ? wifiList : btList;
        const uniqueMap = new Map<string, any>();

        rawList.forEach(item => {
            let key = '';
            if (activeTab === 'WIFI') {
                const w = item as WifiNetwork;
                key = `WIFI_${w.ssid}_${w.bssid}`;
            } else {
                const b = item as BluetoothDevice;
                key = `BT_${b.mac}`;
            }

            if (!uniqueMap.has(key)) {
                uniqueMap.set(key, item);
            } else {
                const existing = uniqueMap.get(key);
                if (new Date(item.lastSeen) > new Date(existing.lastSeen)) {
                    uniqueMap.set(key, item);
                }
            }
        });

        const uniqueList = Array.from(uniqueMap.values());
        const filtered = uniqueList.filter(item => {
            const s = search.toLowerCase();
            if (activeTab === 'WIFI') {
                const w = item as WifiNetwork;
                return (w.ssid || '').toLowerCase().includes(s) || (w.bssid || '').toLowerCase().includes(s) || (w.actorName || '').toLowerCase().includes(s);
            } else {
                const b = item as BluetoothDevice;
                return (b.name || '').toLowerCase().includes(s) || (b.mac || '').toLowerCase().includes(s) || (b.actorName || '').toLowerCase().includes(s);
            }
        });

        return filtered.sort((a, b) => {
            const dir = sortConfig.direction === 'asc' ? 1 : -1;
            let valA: any = '', valB: any = '';
            if (activeTab === 'WIFI') {
                const wA = a as WifiNetwork, wB = b as WifiNetwork;
                switch (sortConfig.key) {
                    case 'signal': valA = wA.signalStrength; valB = wB.signalStrength; break;
                    case 'name': valA = wA.ssid || ''; valB = wB.ssid || ''; break;
                    case 'mac': valA = wA.bssid; valB = wB.bssid; break;
                    case 'vendor': valA = resolveVendor(wA.bssid); valB = resolveVendor(wB.bssid); break;
                    case 'channel': valA = wA.channel; valB = wB.channel; break;
                    case 'security': valA = wA.security; valB = wB.security; break;
                    case 'actor': valA = wA.actorName; valB = wB.actorName; break;
                    case 'time': valA = new Date(wA.lastSeen).getTime(); valB = new Date(wB.lastSeen).getTime(); break;
                    default: return 0;
                }
            } else {
                const bA = a as BluetoothDevice, bB = b as BluetoothDevice;
                switch (sortConfig.key) {
                    case 'signal': valA = bA.rssi; valB = bB.rssi; break;
                    case 'name': valA = bA.name || ''; valB = bB.name || ''; break;
                    case 'mac': valA = bA.mac; valB = bB.mac; break;
                    case 'vendor': valA = resolveVendor(bA.mac); valB = resolveVendor(bB.mac); break;
                    case 'type': valA = bA.type; valB = bB.type; break;
                    case 'actor': valA = bA.actorName; valB = bB.actorName; break;
                    case 'time': valA = new Date(bA.lastSeen).getTime(); valB = new Date(bB.lastSeen).getTime(); break;
                    default: return 0;
                }
            }
            if (valA < valB) return -1 * dir;
            if (valA > valB) return 1 * dir;
            return 0;
        });
    }, [wifiList, btList, activeTab, search, sortConfig]);

    const totalPages = Math.ceil(processData.length / ITEMS_PER_PAGE);
    const paginatedData = processData.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

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

    const renderCell = (item: any, columnId: string) => {
        if (activeTab === 'WIFI') {
            const net = item as WifiNetwork;
            switch (columnId) {
                case 'signal': return (<div className="flex flex-col" title={`${net.signalStrength} dBm`}><div className="flex items-center space-x-2">{getSignalBars(net.signalStrength)}<span className="text-xs font-mono text-slate-500">{net.signalStrength}</span></div><div className="flex items-center text-[10px] text-slate-500 mt-0.5"><Ruler className="w-2.5 h-2.5 mr-1" /> {estimateDistance(net.signalStrength)}</div></div>);
                case 'name': return (<span className="font-bold text-white">{net.ssid || <span className="text-slate-600 italic">&lt;Hidden SSID&gt;</span>}</span>);
                case 'mac': return <span className="font-mono text-slate-400 text-xs bg-slate-900 px-1 rounded">{net.bssid}</span>;
                case 'vendor': const vendor = resolveVendor(net.bssid); return (<div className="flex items-center text-xs text-slate-300"><Factory className={`w-3 h-3 mr-1.5 ${vendor.includes('Unknown') ? 'text-slate-600' : 'text-purple-400'}`} />{vendor}</div>);
                case 'channel': const band = getBand(net.channel); return (<div><div className="flex items-center text-xs font-bold text-white"><Signal className="w-3 h-3 mr-1 text-slate-500"/> {band}</div><span className="text-[10px] text-slate-500 ml-4">Channel {net.channel}</span></div>);
                case 'security': return (<span className={`text-xs font-bold px-2 py-0.5 rounded border ${net.security === 'OPEN' ? 'text-red-400 border-red-900/50 bg-red-900/20' : 'text-emerald-400 border-emerald-900/50 bg-emerald-900/20'}`}>{net.security === 'OPEN' ? <span className="flex items-center"><Lock className="w-3 h-3 mr-1"/> OPEN</span> : net.security}</span>);
                case 'actor': return (<div className="flex items-center text-xs text-slate-300"><Monitor className="w-3 h-3 mr-1.5 text-cyan-500" />{net.actorName}</div>);
                case 'time': return <span className="text-right text-xs text-slate-500 font-mono">{new Date(net.lastSeen).toLocaleTimeString()}</span>;
                default: return null;
            }
        } else {
            const bt = item as BluetoothDevice;
            switch (columnId) {
                case 'signal': return (<div className="flex flex-col" title={`${bt.rssi} dBm`}><div className="flex items-center space-x-2">{getSignalBars(bt.rssi)}<span className="text-xs font-mono text-slate-500">{bt.rssi}</span></div><div className="flex items-center text-[10px] text-slate-500 mt-0.5"><Ruler className="w-2.5 h-2.5 mr-1" /> {estimateDistance(bt.rssi)}</div></div>);
                case 'name': return (<span className="font-bold text-white">{bt.name || <span className="text-slate-600 italic">Unknown Device</span>}</span>);
                case 'mac': return <span className="font-mono text-slate-400 text-xs bg-slate-900 px-1 rounded">{bt.mac}</span>;
                case 'vendor': const vendor = resolveVendor(bt.mac); return (<div className="flex items-center text-xs text-slate-300"><Factory className={`w-3 h-3 mr-1.5 ${vendor.includes('Unknown') ? 'text-slate-600' : 'text-purple-400'}`} />{vendor}</div>);
                case 'type': return (<span className="px-2 py-0.5 rounded bg-blue-900/30 text-blue-400 text-[10px] border border-blue-800 flex items-center w-fit"><Tag className="w-3 h-3 mr-1" />{bt.type}</span>);
                case 'actor': return (<div className="flex items-center text-xs text-slate-300"><Monitor className="w-3 h-3 mr-1.5 text-cyan-500" />{bt.actorName}</div>);
                case 'time': return <span className="text-right text-xs text-slate-500 font-mono">{new Date(bt.lastSeen).toLocaleTimeString()}</span>;
                default: return null;
            }
        }
    };

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
                    <button onClick={() => setActiveTab('WIFI')} className={`px-4 py-2 rounded text-sm font-bold flex items-center transition-all ${activeTab === 'WIFI' ? 'bg-cyan-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}><Wifi className="w-4 h-4 mr-2" /> Wi-Fi Networks</button>
                    <button onClick={() => setActiveTab('BLUETOOTH')} className={`px-4 py-2 rounded text-sm font-bold flex items-center transition-all ${activeTab === 'BLUETOOTH' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}><Bluetooth className="w-4 h-4 mr-2" /> Bluetooth Devices</button>
                    <button onClick={() => setActiveTab('ANALYSIS')} className={`px-4 py-2 rounded text-sm font-bold flex items-center transition-all ${activeTab === 'ANALYSIS' ? 'bg-red-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}>
                        <Activity className="w-4 h-4 mr-2" /> Spectral Analysis
                        {totalThreats > 0 && (
                            <span className="ml-2 bg-white text-red-600 px-1.5 py-0.5 rounded-full text-[9px] font-bold shadow-sm animate-pulse">{totalThreats}</span>
                        )}
                    </button>
                </div>
            </div>

            {/* SPECTRAL ANALYSIS DASHBOARD */}
            {activeTab === 'ANALYSIS' && (
                <div className="space-y-6">
                    {/* 1. Scoreboard */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                        <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-lg flex flex-col justify-center">
                            <h3 className="text-slate-400 font-bold uppercase text-xs mb-4 flex items-center"><Shield className="w-4 h-4 mr-2"/> Fleet Hygiene Score</h3>
                            <div className="flex items-center space-x-4">
                                <div className="text-4xl font-bold text-white">
                                    {Math.round(actors.reduce((acc, a) => acc + (a.spectralScore || 100), 0) / (actors.length || 1))}
                                    <span className="text-sm text-slate-500 ml-1">/ 100</span>
                                </div>
                                <div className="h-2 flex-1 bg-slate-700 rounded-full overflow-hidden">
                                    <div className="h-full bg-gradient-to-r from-red-500 via-yellow-500 to-emerald-500" style={{ width: `${Math.round(actors.reduce((acc, a) => acc + (a.spectralScore || 100), 0) / (actors.length || 1))}%` }}></div>
                                </div>
                            </div>
                        </div>
                        <div className={`rounded-xl border p-6 shadow-lg flex flex-col justify-center ${analysisResults.evilTwins.length > 0 ? 'bg-red-900/20 border-red-500' : 'bg-slate-800 border-slate-700'}`}>
                            <h3 className={`font-bold uppercase text-xs mb-2 flex items-center ${analysisResults.evilTwins.length > 0 ? 'text-red-400' : 'text-slate-400'}`}><Siren className="w-4 h-4 mr-2"/> Evil Twin Detection</h3>
                            <div className="text-3xl font-bold text-white">{analysisResults.evilTwins.length} <span className="text-sm font-normal text-slate-400">Threats</span></div>
                            <p className="text-xs text-slate-500 mt-1">Rogue APs mimicking "{threatConfig.corpSsid}"</p>
                        </div>
                        <div className={`rounded-xl border p-6 shadow-lg flex flex-col justify-center ${analysisResults.shadowIT.length > 0 ? 'bg-yellow-900/20 border-yellow-500' : 'bg-slate-800 border-slate-700'}`}>
                            <h3 className={`font-bold uppercase text-xs mb-2 flex items-center ${analysisResults.shadowIT.length > 0 ? 'text-yellow-400' : 'text-slate-400'}`}><AlertTriangle className="w-4 h-4 mr-2"/> Shadow IT Indicators</h3>
                            <div className="text-3xl font-bold text-white">{analysisResults.shadowIT.length} <span className="text-sm font-normal text-slate-400">Matches</span></div>
                            <p className="text-xs text-slate-500 mt-1">Unauthorized hotspots or peripherals</p>
                        </div>
                        <div className={`rounded-xl border p-6 shadow-lg flex flex-col justify-center ${analysisResults.watchlistHits.length > 0 ? 'bg-blue-900/20 border-blue-500' : 'bg-slate-800 border-slate-700'}`}>
                            <h3 className={`font-bold uppercase text-xs mb-2 flex items-center ${analysisResults.watchlistHits.length > 0 ? 'text-blue-400' : 'text-slate-400'}`}><Crosshair className="w-4 h-4 mr-2"/> Asset Watchlist</h3>
                            <div className="text-3xl font-bold text-white">{analysisResults.watchlistHits.length} <span className="text-sm font-normal text-slate-400">Targets</span></div>
                            <p className="text-xs text-slate-500 mt-1">Known devices currently active</p>
                        </div>
                    </div>

                    {/* 2. Detected Threats Table */}
                    {(analysisResults.evilTwins.length > 0 || analysisResults.shadowIT.length > 0 || analysisResults.watchlistHits.length > 0) && (
                        <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
                            <div className="bg-red-900/20 p-3 border-b border-slate-700 flex items-center text-red-300 font-bold text-sm">
                                <AlertTriangle className="w-4 h-4 mr-2" /> Live Threats Detected
                            </div>
                            <table className="w-full text-left text-xs">
                                <thead className="bg-slate-900 text-slate-500"><tr><th className="p-3">Type</th><th className="p-3">SSID/Name</th><th className="p-3">BSSID/MAC</th><th className="p-3">Signal</th><th className="p-3">Detected By</th></tr></thead>
                                <tbody className="divide-y divide-slate-800 bg-slate-800/50">
                                    {analysisResults.evilTwins.map((net, i) => (
                                        <tr key={i} className="hover:bg-red-900/10">
                                            <td className="p-3 font-bold text-red-500">EVIL TWIN</td>
                                            <td className="p-3 text-white">{net.ssid}</td>
                                            <td className="p-3 font-mono text-slate-400">{net.bssid}</td>
                                            <td className="p-3 text-red-400 font-bold">{net.signalStrength} dBm</td>
                                            <td className="p-3 text-blue-300">{net.actorName}</td>
                                        </tr>
                                    ))}
                                    {analysisResults.shadowIT.map((net, i) => (
                                        <tr key={i} className="hover:bg-yellow-900/10">
                                            <td className="p-3 font-bold text-yellow-500">SHADOW IT</td>
                                            <td className="p-3 text-white">{net.ssid}</td>
                                            <td className="p-3 font-mono text-slate-400">{net.bssid}</td>
                                            <td className="p-3 text-yellow-400">{net.signalStrength} dBm</td>
                                            <td className="p-3 text-blue-300">{net.actorName}</td>
                                        </tr>
                                    ))}
                                    {analysisResults.watchlistHits.map((dev: any, i) => (
                                        <tr key={i} className="hover:bg-blue-900/10">
                                            <td className="p-3 font-bold text-blue-400">WATCHLIST TARGET</td>
                                            <td className="p-3 text-white">{dev.ssid || dev.name}</td>
                                            <td className="p-3 font-mono text-slate-400">{dev.bssid || dev.mac}</td>
                                            <td className="p-3 text-blue-400">{dev.signalStrength || dev.rssi} dBm</td>
                                            <td className="p-3 text-blue-300">{dev.actorName}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* 3. Configuration & Tools Panel */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Policy Config */}
                        <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-lg">
                            <h3 className="text-lg font-bold text-white mb-4 flex items-center"><Settings className="w-5 h-5 mr-2 text-slate-400"/> Threat Policy Configuration</h3>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-slate-500 text-xs font-bold uppercase mb-1">Corporate SSID</label>
                                    <input className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white outline-none text-sm" placeholder="e.g. Corp-Wifi-Secure" value={threatConfig.corpSsid} onChange={e => setThreatConfig({...threatConfig, corpSsid: e.target.value})} />
                                </div>
                                <div>
                                    <label className="block text-slate-500 text-xs font-bold uppercase mb-1">Shadow IT Keywords (Comma Separated)</label>
                                    <input className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white outline-none text-sm" placeholder="e.g. printer, iphone, direct" value={threatConfig.shadowKeywords.join(', ')} onChange={e => setThreatConfig({...threatConfig, shadowKeywords: e.target.value.split(',').map(s => s.trim())})} />
                                </div>
                                <div>
                                    <label className="block text-slate-500 text-xs font-bold uppercase mb-1">Whitelisted BSSIDs (Comma Separated)</label>
                                    <textarea className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white outline-none text-xs font-mono h-24" placeholder="00:11:22:33:44:55, AA:BB:CC..." value={threatConfig.allowedBssids.join(', ')} onChange={e => setThreatConfig({...threatConfig, allowedBssids: e.target.value.split(',').map(s => s.trim())})} />
                                </div>
                                <div className="flex justify-end pt-2">
                                    <button onClick={handleSaveThreatConfig} disabled={isSavingConfig} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded font-bold text-sm flex items-center shadow-lg transition-colors">
                                        {isSavingConfig ? <RefreshCw className="w-4 h-4 mr-2 animate-spin"/> : <Save className="w-4 h-4 mr-2"/>}
                                        Save Policy
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Watchlist & SCIF Control */}
                        <div className="space-y-6">
                            {/* Watchlist Manager */}
                            <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-lg">
                                <h3 className="text-lg font-bold text-white mb-4 flex items-center"><Crosshair className="w-5 h-5 mr-2 text-slate-400"/> Asset Watchlist (VIP Tracking)</h3>
                                <div className="flex gap-2 mb-4">
                                    <input className="bg-slate-900 border border-slate-600 rounded p-2 text-xs text-white outline-none w-1/3" placeholder="MAC Address" value={newTargetMac} onChange={e => setNewTargetMac(e.target.value)} />
                                    <input className="bg-slate-900 border border-slate-600 rounded p-2 text-xs text-white outline-none flex-1" placeholder="Friendly Name (e.g. CEO Phone)" value={newTargetName} onChange={e => setNewTargetName(e.target.value)} />
                                    <select className="bg-slate-900 border border-slate-600 rounded p-2 text-xs text-white outline-none" value={newTargetType} onChange={(e) => setNewTargetType(e.target.value as 'WIFI' | 'BT')}>
                                        <option value="WIFI">WiFi</option>
                                        <option value="BT">BT</option>
                                    </select>
                                    <button onClick={handleAddToWatchlist} className="bg-emerald-600 hover:bg-emerald-500 text-white p-2 rounded"><Plus className="w-4 h-4" /></button>
                                </div>
                                <div className="max-h-40 overflow-y-auto space-y-2">
                                    {threatConfig.watchlist?.map((t, i) => (
                                        <div key={i} className="flex justify-between items-center bg-slate-900 p-2 rounded border border-slate-700/50 text-xs">
                                            <div className="flex items-center">
                                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold mr-2 ${t.type === 'WIFI' ? 'bg-blue-900 text-blue-300' : 'bg-indigo-900 text-indigo-300'}`}>{t.type}</span>
                                                <span className="text-white font-bold mr-2">{t.name}</span>
                                                <span className="text-slate-500 font-mono">{t.mac}</span>
                                            </div>
                                            <button onClick={() => handleRemoveFromWatchlist(t.mac)} className="text-slate-500 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
                                        </div>
                                    ))}
                                    {(!threatConfig.watchlist || threatConfig.watchlist.length === 0) && <div className="text-center text-slate-500 text-xs italic">No targets defined.</div>}
                                </div>
                            </div>

                            {/* SCIF Mode Control */}
                            <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-lg">
                                <h3 className="text-lg font-bold text-white mb-2 flex items-center"><VolumeX className="w-5 h-5 mr-2 text-red-400"/> Restricted Zone Control (SCIF)</h3>
                                <p className="text-slate-400 text-xs mb-4">Designate actors as "Zone Sentinels". ANY detected signal will trigger a CRITICAL breach alert.</p>
                                <div className="max-h-40 overflow-y-auto space-y-2 pr-2">
                                    {actors.filter(a => a.hasWifi || a.hasBluetooth).map(a => (
                                        <div key={a.id} className={`flex justify-between items-center p-2 rounded border transition-colors ${a.isRestrictedZone ? 'bg-red-900/20 border-red-500/50' : 'bg-slate-900 border-slate-700'}`}>
                                            <div className="flex items-center">
                                                <div className={`w-2 h-2 rounded-full mr-2 ${a.status === 'ONLINE' ? 'bg-emerald-500' : 'bg-slate-500'}`}></div>
                                                <span className="text-xs font-bold text-white mr-2">{a.name}</span>
                                                <span className="text-[10px] text-slate-500">({a.localIp})</span>
                                            </div>
                                            <label className="relative inline-flex items-center cursor-pointer">
                                                <input type="checkbox" checked={!!a.isRestrictedZone} onChange={() => handleToggleRestricted(a)} className="sr-only peer" />
                                                <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-red-600"></div>
                                            </label>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Standard Search Bar (Only for WIFI/BT tabs) */}
            {activeTab !== 'ANALYSIS' && (
                <>
                    <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 flex flex-col md:flex-row justify-between items-center gap-4">
                        <div className="relative w-full md:w-96">
                            <Search className="absolute left-3 top-3 w-4 h-4 text-slate-500" />
                            <input type="text" placeholder={`Search ${activeTab === 'WIFI' ? 'SSID, BSSID' : 'Device Name, MAC'}...`} className="w-full bg-slate-900 border border-slate-600 rounded-lg py-2.5 pl-10 text-sm text-white focus:border-cyan-500 outline-none" value={search} onChange={(e) => setSearch(e.target.value)} />
                        </div>
                        <div className="flex items-center space-x-6 text-sm text-slate-400">
                            <div className="flex items-center"><span className="text-white font-bold text-lg mr-2">{processData.length}</span> Unique Targets</div>
                            <button onClick={() => loadData(true)} className="p-2 bg-slate-700 hover:bg-slate-600 rounded-full text-white transition-colors" title="Force Refresh"><RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} /></button>
                        </div>
                    </div>

                    {isProduction && (wifiList.length === 0 && btList.length === 0) && (
                        <div className="bg-yellow-500/10 border border-yellow-500/30 p-4 rounded-lg flex items-center text-yellow-200 text-sm">
                            <AlertTriangle className="w-5 h-5 mr-3 text-yellow-500" />
                            <div><span className="font-bold">No Data Available.</span> If scanning is enabled, ensure Agents are online and VPP-Server is reachable.</div>
                        </div>
                    )}

                    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden shadow-lg flex flex-col min-h-[400px]">
                        <div className="flex-1 overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-slate-900 text-slate-400 border-b border-slate-700 select-none">
                                    <tr>
                                        {activeColumns.map((col, index) => (
                                            <th key={col.id} draggable onDragStart={(e) => handleDragStart(e, index)} onDragOver={(e) => handleDragOver(e, index)} onDrop={(e) => handleDrop(e, index)} onClick={() => handleSort(col.id)} className={`p-4 font-bold uppercase text-xs cursor-pointer hover:bg-slate-800 hover:text-white transition-colors group ${draggedColumnIndex === index ? 'opacity-50 bg-slate-800' : ''}`}>
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center"><GripVertical className="w-3 h-3 mr-2 text-slate-600 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity" />{col.label}</div>
                                                    {sortConfig.key === col.id && (sortConfig.direction === 'asc' ? <ArrowUp className="w-3 h-3 text-cyan-400" /> : <ArrowDown className="w-3 h-3 text-cyan-400" />)}
                                                </div>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-700/50">
                                    {paginatedData.length === 0 ? (
                                        <tr><td colSpan={activeColumns.length} className="p-12 text-center text-slate-500 italic"><Layers className="w-10 h-10 mx-auto mb-2 opacity-20" />No unique {activeTab === 'WIFI' ? 'Wi-Fi networks' : 'Bluetooth devices'} found.</td></tr>
                                    ) : (
                                        paginatedData.map((item, idx) => (
                                            <tr key={`${(item as any).id}-${idx}`} className="hover:bg-slate-700/30 transition-colors group">
                                                {activeColumns.map(col => <td key={col.id} className="p-4">{renderCell(item, col.id)}</td>)}
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                        {processData.length > 0 && (
                            <div className="bg-slate-900/50 p-3 border-t border-slate-700 flex justify-between items-center text-xs">
                                <div className="text-slate-400">Showing <span className="text-white font-bold">{(currentPage - 1) * ITEMS_PER_PAGE + 1}</span> to <span className="text-white font-bold">{Math.min(currentPage * ITEMS_PER_PAGE, processData.length)}</span> of <span className="text-white font-bold">{processData.length}</span> unique results</div>
                                <div className="flex items-center space-x-2">
                                    <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="p-1 rounded bg-slate-800 border border-slate-600 text-slate-300 hover:text-white hover:border-cyan-500 disabled:opacity-50 disabled:hover:border-slate-600 transition-colors"><ChevronLeft className="w-4 h-4" /></button>
                                    <span className="text-slate-400 font-mono">Page {currentPage} / {totalPages}</span>
                                    <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="p-1 rounded bg-slate-800 border border-slate-600 text-slate-300 hover:text-white hover:border-cyan-500 disabled:opacity-50 disabled:hover:border-slate-600 transition-colors"><ChevronRight className="w-4 h-4" /></button>
                                </div>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

export default WirelessRecon;
