
import React, { useMemo } from 'react';
import { ProxyGateway, Actor, ActorStatus } from '../types';
import { Network, Server, Router, AlertTriangle } from 'lucide-react';

interface WarRoomMapProps {
    gateways: ProxyGateway[];
    actors: Actor[];
}

const WarRoomMap: React.FC<WarRoomMapProps> = ({ gateways, actors }) => {
    
    // Simple Mercator Projection for SVG
    const project = (lat: number, lng: number) => {
        const x = (lng + 180) * (800 / 360);
        const latRad = lat * Math.PI / 180;
        const mercN = Math.log(Math.tan((Math.PI / 4) + (latRad / 2)));
        const y = (400 / 2) - (800 * mercN / (2 * Math.PI));
        return { x, y: Math.max(0, Math.min(400, y)) };
    };

    return (
        <div className="bg-black rounded-xl border border-slate-700 shadow-2xl relative overflow-hidden h-[600px] animate-fade-in">
            {/* Header / HUD */}
            <div className="absolute top-4 left-4 z-10 bg-slate-900/80 backdrop-blur border border-slate-700 p-4 rounded-lg">
                <h2 className="text-xl font-bold text-white tracking-widest flex items-center">
                    <Network className="w-5 h-5 mr-2 text-cyber-accent" />
                    GLOBAL THREAT MAP
                </h2>
                <div className="flex items-center space-x-4 mt-2 text-xs font-mono text-slate-400">
                    <span className="flex items-center"><span className="w-2 h-2 rounded-full bg-emerald-500 mr-2"></span> GATEWAY ONLINE</span>
                    <span className="flex items-center"><span className="w-2 h-2 rounded-full bg-red-500 mr-2 animate-pulse"></span> THREAT DETECTED</span>
                </div>
            </div>

            {/* Map Container */}
            <svg viewBox="0 0 800 400" className="w-full h-full bg-slate-900">
                {/* World Map Silhouette (Simplified) */}
                <path 
                    d="M100,50 Q200,30 300,50 T600,80 T750,50 L780,150 L700,300 L600,350 L500,300 L400,380 L300,300 L200,320 L100,250 Z" 
                    fill="#1e293b" 
                    stroke="#334155" 
                    strokeWidth="1"
                    className="opacity-50"
                />
                <rect width="800" height="400" fill="url(#grid)" className="opacity-20" />
                
                <defs>
                    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#3b82f6" strokeWidth="0.5"/>
                    </pattern>
                </defs>

                {/* Connection Lines (Gateway to 'Cloud' Center) */}
                {gateways.map(gw => {
                    if (!gw.lat || !gw.lng) return null;
                    const pos = project(gw.lat, gw.lng);
                    const cloudPos = { x: 400, y: 50 }; // Arbitrary cloud center
                    return (
                        <line 
                            key={`line-${gw.id}`}
                            x1={pos.x} y1={pos.y}
                            x2={cloudPos.x} y2={cloudPos.y}
                            stroke={gw.status === 'ONLINE' ? '#10b981' : '#ef4444'}
                            strokeWidth="1"
                            strokeOpacity="0.3"
                            strokeDasharray="4"
                        >
                            <animate attributeName="stroke-dashoffset" from="100" to="0" dur="2s" repeatCount="indefinite" />
                        </line>
                    )
                })}

                {/* Gateways Markers */}
                {gateways.map(gw => {
                    if (!gw.lat || !gw.lng) return null;
                    const pos = project(gw.lat, gw.lng);
                    const gwActors = actors.filter(a => a.proxyId === gw.id);
                    const hasCompromise = gwActors.some(a => a.status === ActorStatus.COMPROMISED);
                    const color = hasCompromise ? '#ef4444' : (gw.status === 'ONLINE' ? '#10b981' : '#64748b');

                    return (
                        <g key={gw.id} className="cursor-pointer group">
                            {/* Pulsing Effect */}
                            <circle cx={pos.x} cy={pos.y} r="8" fill={color} fillOpacity="0.3">
                                <animate attributeName="r" from="4" to="12" dur="1.5s" repeatCount="indefinite" />
                                <animate attributeName="opacity" from="0.6" to="0" dur="1.5s" repeatCount="indefinite" />
                            </circle>
                            {/* Solid Core */}
                            <circle cx={pos.x} cy={pos.y} r="4" fill={color} stroke="#0f172a" strokeWidth="1" />
                            
                            {/* Label on Hover */}
                            <g className="opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                                <rect x={pos.x + 10} y={pos.y - 30} width="120" height="60" rx="4" fill="#0f172a" stroke={color} strokeWidth="1" />
                                <text x={pos.x + 20} y={pos.y - 15} fill="#fff" fontSize="10" fontWeight="bold">{gw.name}</text>
                                <text x={pos.x + 20} y={pos.y} fill="#94a3b8" fontSize="8">IP: {gw.ip}</text>
                                <text x={pos.x + 20} y={pos.y + 12} fill="#94a3b8" fontSize="8">Nodes: {gwActors.length}</text>
                            </g>
                        </g>
                    );
                })}

                {/* Center 'Cloud' Icon */}
                <circle cx="400" cy="50" r="20" fill="#3b82f6" fillOpacity="0.1" />
                <text x="400" y="55" textAnchor="middle" fill="#3b82f6" fontSize="24" className="pointer-events-none">☁</text>
            </svg>

            {/* Bottom Overlay Info */}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black to-transparent p-6 pointer-events-none">
                <div className="flex justify-between items-end">
                    <div className="text-slate-500 font-mono text-xs">
                        SYSTEM STATUS: <span className="text-emerald-500">NOMINAL</span><br/>
                        UPLINK LATENCY: 24ms<br/>
                        ACTIVE NODES: {actors.length}
                    </div>
                    <div className="text-right">
                         <div className="inline-block px-3 py-1 bg-slate-800 border border-slate-600 rounded text-xs text-slate-300">
                             LIVE TELEMETRY
                         </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default WarRoomMap;
