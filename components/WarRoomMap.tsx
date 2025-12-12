
import React, { useMemo } from 'react';
import { ProxyGateway, Actor, ActorStatus } from '../types';
import { Network, Cloud } from 'lucide-react';

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

    // Calculate display groups (Real Gateways + Virtual Direct Gateway)
    const renderData = useMemo(() => {
        const groups: Record<string, Actor[]> = {};
        const gatewayIds = new Set(gateways.map(g => g.id));

        // 1. Group Actors
        actors.forEach(actor => {
            // If actor has a valid proxyId in our gateway list, use it. Otherwise 'DIRECT'.
            const targetId = (actor.proxyId && gatewayIds.has(actor.proxyId)) ? actor.proxyId : 'DIRECT';
            
            if (!groups[targetId]) groups[targetId] = [];
            groups[targetId].push(actor);
        });

        // 2. Build Render List
        const list = [...gateways];

        // If we have direct actors, add a virtual gateway for them
        if (groups['DIRECT'] && groups['DIRECT'].length > 0) {
            list.push({
                id: 'DIRECT',
                name: 'CLOUD UPLINK',
                location: 'Direct Connection',
                status: 'ONLINE',
                ip: 'Global',
                version: 'N/A',
                connectedActors: groups['DIRECT'].length,
                lat: 25, // Arbitrary "Ocean" location for visualization
                lng: -40
            } as ProxyGateway);
        }

        return { list, groups };
    }, [gateways, actors]);

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
                    <span className="flex items-center"><span className="w-2 h-2 rounded-full bg-cyan-500 mr-2 shadow-[0_0_8px_rgba(6,182,212,0.8)]"></span> CLOUD DIRECT</span>
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

                    {/* 4. Connectivity Lines & Actors */}
                    {renderData.list.map(gw => {
                        const lat = gw.lat || 0;
                        const lng = gw.lng || 0;
                        const gwPos = project(lat, lng);
                        const gwActors = renderData.groups[gw.id] || [];
                        const hasCompromise = gwActors.some(a => a.status === ActorStatus.COMPROMISED);
                        
                        // Color Logic: Direct = Cyan, Regular = Emerald, Compromised = Red
                        const baseColor = gw.id === 'DIRECT' ? '#06b6d4' : '#10b981'; 
                        const gwColor = hasCompromise ? '#ef4444' : (gw.status === 'ONLINE' ? baseColor : '#64748b');

                        return (
                            <g key={gw.id}>
                                {/* Draw Connections to Satellites (Actors) */}
                                {gwActors.map((actor, idx) => {
                                    // Distribute actors in a circle around the gateway
                                    const count = gwActors.length;
                                    // Expand radius slightly if many actors to avoid clutter
                                    const radius = count > 10 ? 35 : 25; 
                                    const angle = (idx / count) * 2 * Math.PI;
                                    const actorX = gwPos.x + radius * Math.cos(angle);
                                    const actorY = gwPos.y + radius * Math.sin(angle);
                                    const isCompromised = actor.status === 'COMPROMISED';
                                    const actorColor = isCompromised ? '#ef4444' : (gw.id === 'DIRECT' ? '#38bdf8' : '#3b82f6');

                                    return (
                                        <g key={actor.id} className="group/actor">
                                            {/* Link Line */}
                                            <line 
                                                x1={gwPos.x} y1={gwPos.y} 
                                                x2={actorX} y2={actorY} 
                                                stroke={actorColor} 
                                                strokeWidth={0.5} 
                                                opacity={0.3} 
                                            />
                                            
                                            {/* Actor Dot */}
                                            <circle 
                                                cx={actorX} cy={actorY} 
                                                r={isCompromised ? 3 : 1.5} 
                                                fill={actorColor}
                                                className="cursor-pointer transition-all duration-300 hover:r-4"
                                            >
                                                {isCompromised && (
                                                    <animate attributeName="opacity" values="1;0.2;1" dur="1s" repeatCount="indefinite" />
                                                )}
                                            </circle>

                                            {/* Ping Animation for Compromised Nodes */}
                                            {isCompromised && (
                                                <circle cx={actorX} cy={actorY} r="3" fill="none" stroke={actorColor} strokeWidth="0.5">
                                                    <animate attributeName="r" from="3" to="12" dur="1.5s" repeatCount="indefinite" />
                                                    <animate attributeName="opacity" from="0.8" to="0" dur="1.5s" repeatCount="indefinite" />
                                                </circle>
                                            )}

                                            {/* Hover Info for Actor */}
                                            <g className="opacity-0 group-hover/actor:opacity-100 transition-opacity duration-200 pointer-events-none z-50">
                                                <rect x={actorX + 5} y={actorY - 15} width="80" height="24" fill="rgba(0,0,0,0.8)" rx="2" stroke={actorColor} strokeWidth="0.5" />
                                                <text x={actorX + 10} y={actorY - 4} fill="white" fontSize="6" fontWeight="bold" fontFamily="monospace">{actor.name}</text>
                                                <text x={actorX + 10} y={actorY + 4} fill={isCompromised ? "#ef4444" : "#94a3b8"} fontSize="5" fontFamily="monospace">{actor.status}</text>
                                            </g>
                                        </g>
                                    );
                                })}

                                {/* Gateway Marker (Center) */}
                                <g className="cursor-pointer group/gw">
                                    {/* Pulse Ring */}
                                    <circle cx={gwPos.x} cy={gwPos.y} r="4" fill="none" stroke={gwColor} strokeWidth="1">
                                        <animate attributeName="r" from="4" to="15" dur="3s" repeatCount="indefinite" />
                                        <animate attributeName="opacity" from="0.6" to="0" dur="3s" repeatCount="indefinite" />
                                    </circle>
                                    
                                    {/* Core Dot */}
                                    <circle cx={gwPos.x} cy={gwPos.y} r="3" fill={gwColor} stroke="#0f172a" strokeWidth="1" className="hover:r-5 transition-all" />

                                    {/* Icon for Cloud */}
                                    {gw.id === 'DIRECT' && (
                                        <text x={gwPos.x - 3} y={gwPos.y + 2.5} fontSize="8" fill="#000" style={{pointerEvents:'none'}}>C</text>
                                    )}

                                    {/* Tooltip Group for Gateway */}
                                    <g className="opacity-0 group-hover/gw:opacity-100 transition-opacity duration-300 pointer-events-none z-50">
                                        <path d={`M${gwPos.x},${gwPos.y-10} L${gwPos.x+10},${gwPos.y-30} H${gwPos.x+130} v40 H${gwPos.x+10} Z`} fill="rgba(15, 23, 42, 0.9)" stroke={gwColor} strokeWidth="1" />
                                        <text x={gwPos.x + 20} y={gwPos.y - 18} fill="#fff" fontSize="10" fontWeight="bold">{gw.name.toUpperCase()}</text>
                                        <text x={gwPos.x + 20} y={gwPos.y - 6} fill="#94a3b8" fontSize="8" fontFamily="monospace">Nodes: {gwActors.length}</text>
                                        <text x={gwPos.x + 20} y={gwPos.y + 4} fill={hasCompromise ? '#ef4444' : '#10b981'} fontSize="8" fontWeight="bold">
                                            STATUS: {hasCompromise ? 'CRITICAL' : gw.status}
                                        </text>
                                    </g>
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
                    <span className="text-blue-400">NETWORK MESH:</span> {renderData.groups['DIRECT']?.length > 0 ? 'HYBRID (CLOUD+EDGE)' : 'FULLY CONVERGED'}
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
