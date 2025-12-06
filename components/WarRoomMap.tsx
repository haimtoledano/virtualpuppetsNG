
import React from 'react';
import { ProxyGateway, Actor, ActorStatus } from '../types';
import { Network } from 'lucide-react';

interface WarRoomMapProps {
    gateways: ProxyGateway[];
    actors: Actor[];
}

const WarRoomMap: React.FC<WarRoomMapProps> = ({ gateways, actors }) => {
    
    // Accurate Mercator Projection
    // Width: 800, Height: 400
    // Lat: -90 to 90, Lng: -180 to 180
    const project = (lat: number, lng: number) => {
        // Longitude map to X (0-800)
        const x = (lng + 180) * (800 / 360);

        // Latitude map to Y (0-400) using Mercator
        // Clamp lat to avoid Infinity at poles
        const latRad = Math.max(-85, Math.min(85, lat)) * Math.PI / 180;
        const mercN = Math.log(Math.tan((Math.PI / 4) + (latRad / 2)));
        const y = (400 / 2) - (800 * mercN / (2 * Math.PI));
        
        return { x, y };
    };

    return (
        <div className="bg-black rounded-xl border border-slate-700 shadow-2xl relative overflow-hidden h-[600px] animate-fade-in flex flex-col">
            {/* Header / HUD */}
            <div className="absolute top-4 left-4 z-10 bg-slate-900/80 backdrop-blur border border-slate-700 p-4 rounded-lg pointer-events-none">
                <h2 className="text-xl font-bold text-white tracking-widest flex items-center">
                    <Network className="w-5 h-5 mr-2 text-cyber-accent animate-pulse" />
                    GLOBAL THREAT MAP
                </h2>
                <div className="flex items-center space-x-4 mt-2 text-xs font-mono text-slate-400">
                    <span className="flex items-center"><span className="w-2 h-2 rounded-full bg-emerald-500 mr-2 shadow-[0_0_8px_rgba(16,185,129,0.8)]"></span> GATEWAY ONLINE</span>
                    <span className="flex items-center"><span className="w-2 h-2 rounded-full bg-red-500 mr-2 animate-ping"></span> THREAT DETECTED</span>
                </div>
            </div>

            {/* Map Container */}
            <div className="flex-1 bg-[#050b14] relative">
                <svg viewBox="0 0 800 400" className="w-full h-full object-contain">
                    
                    {/* 1. Map Grid Background */}
                    <defs>
                        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1e293b" strokeWidth="0.5"/>
                        </pattern>
                        <radialGradient id="scanGradient" cx="50%" cy="50%" r="50%">
                            <stop offset="0%" stopColor="rgba(59, 130, 246, 0.1)" />
                            <stop offset="100%" stopColor="rgba(59, 130, 246, 0)" />
                        </radialGradient>
                    </defs>
                    <rect width="800" height="400" fill="url(#grid)" />

                    {/* 2. World Map Silhouette (Dot Matrix Style or Outline) */}
                    <g fill="#1e293b" stroke="#334155" strokeWidth="0.5">
                        {/* North America */}
                        <path d="M50,70 L120,60 L230,50 L280,130 L200,160 L140,200 L100,150 L60,100 Z" opacity="0.6" /> 
                        {/* South America */}
                        <path d="M220,210 L280,210 L300,280 L260,360 L240,300 Z" opacity="0.6" />
                        {/* Europe & Asia */}
                        <path d="M350,70 L450,60 L600,60 L750,80 L720,180 L650,230 L580,200 L500,160 L450,150 L420,100 L350,90 Z" opacity="0.6" />
                        {/* Africa */}
                        <path d="M400,170 L480,170 L500,250 L450,320 L420,250 L380,200 Z" opacity="0.6" />
                        {/* Australia */}
                        <path d="M620,280 L720,280 L710,340 L630,330 Z" opacity="0.6" />
                        {/* Dots for detail effect */}
                        <circle cx="150" cy="100" r="1" fill="#475569" />
                        <circle cx="160" cy="110" r="1" fill="#475569" />
                        <circle cx="450" cy="120" r="1" fill="#475569" />
                        <circle cx="650" cy="150" r="1" fill="#475569" />
                    </g>

                    {/* 3. Scanning Radar Line */}
                    <line x1="400" y1="0" x2="400" y2="400" stroke="rgba(59, 130, 246, 0.3)" strokeWidth="2">
                        <animate attributeName="x1" from="0" to="800" dur="4s" repeatCount="indefinite" />
                        <animate attributeName="x2" from="0" to="800" dur="4s" repeatCount="indefinite" />
                    </line>
                    <rect x="0" y="0" width="40" height="400" fill="url(#scanGradient)" opacity="0.3">
                         <animate attributeName="x" from="-40" to="760" dur="4s" repeatCount="indefinite" />
                    </rect>

                    {/* 4. Gateways Markers */}
                    {gateways.map(gw => {
                        // Use default lat/lng if missing (e.g. 0,0)
                        const lat = gw.lat || 0;
                        const lng = gw.lng || 0;
                        const pos = project(lat, lng);
                        const gwActors = actors.filter(a => a.proxyId === gw.id);
                        const hasCompromise = gwActors.some(a => a.status === ActorStatus.COMPROMISED);
                        const color = hasCompromise ? '#ef4444' : (gw.status === 'ONLINE' ? '#10b981' : '#64748b');

                        return (
                            <g key={gw.id} className="cursor-pointer group">
                                {/* Ripple Effect */}
                                <circle cx={pos.x} cy={pos.y} r="4" fill="none" stroke={color} strokeWidth="1">
                                    <animate attributeName="r" from="4" to="20" dur="2s" repeatCount="indefinite" />
                                    <animate attributeName="opacity" from="1" to="0" dur="2s" repeatCount="indefinite" />
                                </circle>
                                
                                {/* Core Dot */}
                                <circle cx={pos.x} cy={pos.y} r="3" fill={color} stroke="#0f172a" strokeWidth="1" className="hover:r-5 transition-all" />

                                {/* Connector Line to 'Ground' (Visual flair) */}
                                <line x1={pos.x} y1={pos.y} x2={pos.x} y2={pos.y + 10} stroke={color} strokeWidth="1" opacity="0.5" />

                                {/* Tooltip Group */}
                                <g className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
                                    <path d={`M${pos.x},${pos.y-10} L${pos.x+10},${pos.y-30} H${pos.x+130} v40 H${pos.x+10} Z`} fill="rgba(15, 23, 42, 0.9)" stroke={color} strokeWidth="1" />
                                    <text x={pos.x + 20} y={pos.y - 18} fill="#fff" fontSize="10" fontWeight="bold">{gw.name.toUpperCase()}</text>
                                    <text x={pos.x + 20} y={pos.y - 6} fill="#94a3b8" fontSize="8" fontFamily="monospace">IP: {gw.ip}</text>
                                    <text x={pos.x + 20} y={pos.y + 4} fill={hasCompromise ? '#ef4444' : '#10b981'} fontSize="8" fontWeight="bold">
                                        STATUS: {hasCompromise ? 'CRITICAL' : gw.status}
                                    </text>
                                </g>
                            </g>
                        );
                    })}
                </svg>
            </div>

            {/* Bottom Overlay Info */}
            <div className="bg-slate-900 border-t border-slate-700 p-4 flex justify-between items-center text-xs font-mono">
                <div className="text-slate-500">
                    <span className="text-blue-400">COORDINATES:</span> 32.0853° N, 34.7818° E (HQ)<br/>
                    <span className="text-blue-400">NETWORK MESH:</span> FULLY CONVERGED
                </div>
                <div className="flex space-x-6">
                    <div>
                        <div className="text-slate-500 mb-1">TOTAL NODES</div>
                        <div className="text-white text-lg font-bold">{actors.length}</div>
                    </div>
                    <div>
                         <div className="text-slate-500 mb-1">ACTIVE THREATS</div>
                        <div className="text-red-500 text-lg font-bold animate-pulse">{actors.filter(a => a.status === 'COMPROMISED').length}</div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default WarRoomMap;
