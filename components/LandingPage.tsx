
import React, { useState, useEffect, useRef } from 'react';
import { Shield, Activity, Globe, Lock, Cpu, ArrowRight, Terminal, BarChart2, Zap, Server, Smartphone, Laptop, Radio } from 'lucide-react';

interface LandingPageProps {
  onLoginClick: () => void;
}

const LandingPage: React.FC<LandingPageProps> = ({ onLoginClick }) => {
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setMousePos({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top
        });
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // --- MOCK DASHBOARD COMPONENT (Background) ---
  const MockDashboardBg = () => (
    <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none flex items-center justify-center opacity-20 blur-[1px]">
        <div 
            className="w-[90%] h-[80%] bg-slate-900/80 border border-slate-700 rounded-xl p-4 grid grid-cols-[200px_1fr] gap-4 shadow-2xl"
            style={{ transform: 'perspective(2000px) rotateX(20deg) rotateY(0deg) scale(0.9) translateY(50px)' }}
        >
            {/* Sidebar Mock */}
            <div className="bg-slate-800 rounded-lg flex flex-col gap-3 p-3 border border-slate-700/50">
                <div className="h-8 w-8 bg-blue-600 rounded-md mb-4"></div>
                {[1,2,3,4,5,6].map(i => <div key={i} className="h-8 w-full bg-slate-700/50 rounded-md"></div>)}
            </div>
            
            {/* Main Content Mock */}
            <div className="flex flex-col gap-4">
                {/* Top Stats */}
                <div className="grid grid-cols-4 gap-4 h-24">
                    {[1,2,3,4].map(i => (
                        <div key={i} className="bg-slate-800 rounded-lg border border-slate-700/50 p-4 relative overflow-hidden">
                            <div className="h-2 w-12 bg-slate-600 rounded mb-2"></div>
                            <div className="h-6 w-20 bg-slate-500 rounded"></div>
                            <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50 animate-pulse"></div>
                        </div>
                    ))}
                </div>
                {/* Charts Area */}
                <div className="grid grid-cols-3 gap-4 h-64">
                    <div className="col-span-2 bg-slate-800 rounded-lg border border-slate-700/50 p-4 relative">
                         {/* Fake Chart Line */}
                         <svg className="w-full h-full opacity-30" viewBox="0 0 100 20" preserveAspectRatio="none">
                             <path d="M0,10 Q20,15 40,5 T80,10 T100,5" fill="none" stroke="#3b82f6" strokeWidth="0.5" />
                         </svg>
                    </div>
                    <div className="bg-slate-800 rounded-lg border border-slate-700/50 flex flex-col gap-2 p-2">
                        {[1,2,3,4,5].map(i => <div key={i} className="h-8 w-full bg-slate-700/30 rounded flex items-center px-2"><div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div></div>)}
                    </div>
                </div>
                {/* Bottom Grid */}
                <div className="flex-1 bg-slate-800 rounded-lg border border-slate-700/50 grid grid-cols-6 gap-2 p-4">
                    {Array.from({length: 24}).map((_, i) => (
                        <div key={i} className={`rounded h-full w-full ${Math.random() > 0.9 ? 'bg-red-500/20 animate-pulse' : 'bg-slate-700/30'}`}></div>
                    ))}
                </div>
            </div>
        </div>
    </div>
  );

  return (
    <div ref={containerRef} className="relative h-screen w-full bg-[#050b14] text-slate-200 font-sans selection:bg-blue-500/30 overflow-y-auto overflow-x-hidden scroll-smooth group/landing">
      
      {/* --- BACKGROUND LAYERS --- */}
      
      {/* 1. Base Grid */}
      <div className="fixed inset-0 pointer-events-none z-0" 
           style={{ 
             backgroundImage: 'linear-gradient(rgba(59, 130, 246, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(59, 130, 246, 0.05) 1px, transparent 1px)', 
             backgroundSize: '40px 40px',
             opacity: 0.3
           }}>
      </div>

      {/* 2. MOCK DASHBOARD LAYER */}
      <MockDashboardBg />

      {/* 3. Mouse Spotlight */}
      <div 
        className="fixed inset-0 pointer-events-none z-0 transition-opacity duration-300 mix-blend-overlay"
        style={{
          background: `radial-gradient(600px circle at ${mousePos.x}px ${mousePos.y}px, rgba(59, 130, 246, 0.1), transparent 60%)`,
        }}
      ></div>

      {/* Navigation */}
      <nav className="relative z-50 max-w-7xl mx-auto px-6 py-6 flex justify-between items-center">
        <div className="flex items-center space-x-3 group cursor-default">
          <div className="relative w-10 h-10 bg-blue-600/20 rounded-lg flex items-center justify-center border border-blue-500/50 group-hover:bg-blue-600 transition-colors duration-500">
            <Shield className="w-6 h-6 text-blue-400 group-hover:text-white transition-colors z-10" />
            <div className="absolute inset-0 bg-blue-500/40 blur-lg rounded-full opacity-0 group-hover:opacity-100 transition-opacity"></div>
          </div>
          <div className="flex flex-col">
            <span className="text-xl font-bold tracking-wider text-white shadow-black drop-shadow-md">VIRTUAL PUPPETS</span>
            <span className="text-[10px] text-blue-400 font-mono tracking-widest opacity-80">ACTIVE DEFENSE SYS</span>
          </div>
        </div>
        <button 
          onClick={onLoginClick}
          className="relative group flex items-center space-x-2 bg-slate-900/80 hover:bg-blue-900/90 border border-slate-700 hover:border-blue-500 text-slate-300 px-5 py-2 rounded-full transition-all duration-300 hover:shadow-[0_0_20px_rgba(59,130,246,0.6)] hover:text-white backdrop-blur-md overflow-hidden"
        >
          <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-blue-500/10 to-transparent -translate-x-full group-hover:animate-shimmer"></div>
          <span className="text-sm font-bold relative z-10">ACCESS CONSOLE</span>
          <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform relative z-10" />
        </button>
      </nav>

      {/* Hero Section */}
      <header className="relative z-10 pt-16 pb-32 px-4 max-w-7xl mx-auto flex flex-col lg:flex-row items-center gap-12">
        
        {/* Left: Text Content */}
        <div className="flex-1 text-center lg:text-left z-10">
            <div className="inline-flex items-center space-x-2 bg-blue-900/40 border border-blue-500/30 rounded-full px-4 py-1.5 mb-8 animate-fade-in backdrop-blur-md shadow-lg">
            <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="text-xs font-mono text-blue-200 tracking-widest uppercase font-bold">System Operational</span>
            </div>
            
            <h1 className="text-5xl md:text-7xl font-bold text-white mb-6 tracking-tight leading-tight drop-shadow-2xl">
            Next-Gen <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-cyan-400 to-emerald-400 animate-pulse-slow">Active Defense</span><br />
            Infrastructure
            </h1>
            
            <p className="text-lg md:text-xl text-slate-300 max-w-2xl mx-auto lg:mx-0 mb-10 leading-relaxed drop-shadow-md">
            Deploy distributed honeypot actors, deceive adversaries with AI-generated personas, 
            and analyze threat telemetry in real-time. Turn the hunters into the hunted.
            </p>

            <div className="flex flex-col md:flex-row items-center justify-center lg:justify-start gap-4">
            <button 
                onClick={onLoginClick}
                className="w-full md:w-auto bg-blue-600 hover:bg-blue-500 text-white px-8 py-4 rounded-lg font-bold text-lg shadow-[0_0_30px_rgba(37,99,235,0.4)] hover:shadow-[0_0_50px_rgba(37,99,235,0.6)] transition-all hover:-translate-y-1 flex items-center justify-center relative overflow-hidden group"
            >
                <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20"></div>
                <Terminal className="w-5 h-5 mr-2 relative z-10 group-hover:rotate-12 transition-transform" />
                <span className="relative z-10">Initialize C2 Session</span>
            </button>
            <a href="#features" className="w-full md:w-auto px-8 py-4 rounded-lg font-bold text-lg text-slate-300 hover:text-white transition-all flex items-center justify-center border border-slate-700 hover:border-slate-500 bg-slate-900/80 hover:bg-slate-800 backdrop-blur-md group shadow-lg">
                <span className="mr-2">View Capabilities</span>
                <ArrowRight className="w-4 h-4 group-hover:rotate-90 transition-transform" />
            </a>
            </div>
        </div>

        {/* Right: Telemetry Visualizer */}
        <div className="flex-1 flex justify-center lg:justify-end relative h-[400px] w-full max-w-[500px]">
            {/* Central Node (C2) */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 flex flex-col items-center">
                <div className="w-24 h-24 bg-slate-900/90 border-2 border-blue-500 rounded-full flex items-center justify-center shadow-[0_0_50px_rgba(59,130,246,0.4)] relative group">
                    <div className="absolute inset-0 border border-blue-400 rounded-full animate-ping opacity-20"></div>
                    <div className="absolute -inset-4 border border-dashed border-slate-600 rounded-full animate-spin-slow opacity-50"></div>
                    <Server className="w-10 h-10 text-white drop-shadow-[0_0_10px_rgba(59,130,246,0.8)]" />
                    <div className="absolute -bottom-8 bg-slate-900 px-2 py-1 rounded text-[10px] font-mono text-blue-400 border border-slate-700">C2 SERVER</div>
                </div>
            </div>

            {/* Orbiting Actors */}
            {[
                { Icon: Laptop, color: 'text-emerald-400', label: 'Linux-Node-01', delay: '0s', pos: 'top-0 left-10' },
                { Icon: Smartphone, color: 'text-purple-400', label: 'Mobile-Gateway', delay: '1s', pos: 'bottom-10 right-0' },
                { Icon: Radio, color: 'text-yellow-400', label: 'IoT-Sensor-Alpha', delay: '2s', pos: 'bottom-0 left-0' },
                { Icon: Cpu, color: 'text-red-400', label: 'Indus-PLC-04', delay: '1.5s', pos: 'top-10 right-10' },
            ].map((node, i) => (
                <div key={i} className={`absolute ${node.pos} z-20 flex flex-col items-center animate-float`} style={{ animationDelay: node.delay }}>
                    <div className="w-14 h-14 bg-slate-800/90 border border-slate-600 rounded-xl flex items-center justify-center shadow-lg relative group hover:border-white transition-colors cursor-default">
                        <node.Icon className={`w-6 h-6 ${node.color}`} />
                        {/* Data Packet Animation */}
                        <div className="absolute top-1/2 left-1/2 w-2 h-2 bg-white rounded-full opacity-0 animate-transmit pointer-events-none shadow-[0_0_10px_white]"></div>
                    </div>
                    <div className="mt-2 bg-slate-900/80 px-2 py-0.5 rounded text-[9px] font-mono text-slate-400 border border-slate-700">{node.label}</div>
                </div>
            ))}

            {/* Connection Lines (Visual only) */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-30 z-10">
                <line x1="20%" y1="20%" x2="50%" y2="50%" stroke="#475569" strokeWidth="1" strokeDasharray="5,5" />
                <line x1="80%" y1="80%" x2="50%" y2="50%" stroke="#475569" strokeWidth="1" strokeDasharray="5,5" />
                <line x1="20%" y1="80%" x2="50%" y2="50%" stroke="#475569" strokeWidth="1" strokeDasharray="5,5" />
                <line x1="80%" y1="20%" x2="50%" y2="50%" stroke="#475569" strokeWidth="1" strokeDasharray="5,5" />
            </svg>
        </div>

      </header>

      {/* Features Grid */}
      <section id="features" className="relative z-10 py-20 bg-slate-900/30 border-t border-slate-800 backdrop-blur-sm shadow-2xl">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            
            {/* Feature 1 */}
            <div className="group relative bg-slate-800/60 border border-slate-700 p-8 rounded-2xl hover:bg-slate-800/80 transition-all duration-500 hover:-translate-y-2 hover:shadow-[0_10px_40px_-10px_rgba(16,185,129,0.2)] overflow-hidden backdrop-blur-sm">
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <div className="w-14 h-14 bg-emerald-500/10 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-500 relative">
                <Globe className="w-8 h-8 text-emerald-400 relative z-10" />
                <div className="absolute inset-0 bg-emerald-500/20 blur-lg rounded-full opacity-0 group-hover:opacity-100 animate-pulse"></div>
              </div>
              <h3 className="text-xl font-bold text-white mb-3">Distributed Fleet</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Manage hundreds of lightweight "Puppet" actors distributed across physical locations. 
                Visualize global threat topology on a real-time map.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="group relative bg-slate-800/60 border border-slate-700 p-8 rounded-2xl hover:bg-slate-800/80 transition-all duration-500 hover:-translate-y-2 hover:shadow-[0_10px_40px_-10px_rgba(168,85,247,0.2)] overflow-hidden backdrop-blur-sm">
              <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <div className="w-14 h-14 bg-purple-500/10 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-500 relative">
                <Cpu className="w-8 h-8 text-purple-400 relative z-10 group-hover:animate-spin-slow" />
                <div className="absolute inset-0 bg-purple-500/20 blur-lg rounded-full opacity-0 group-hover:opacity-100 animate-pulse"></div>
              </div>
              <h3 className="text-xl font-bold text-white mb-3">AI Persona Engine</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Dynamically shift device identities. Use AI to generate realistic honey-files, 
                credentials, and configuration artifacts to lure attackers deeper.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="group relative bg-slate-800/60 border border-slate-700 p-8 rounded-2xl hover:bg-slate-800/80 transition-all duration-500 hover:-translate-y-2 hover:shadow-[0_10px_40px_-10px_rgba(239,68,68,0.2)] overflow-hidden backdrop-blur-sm">
              <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <div className="w-14 h-14 bg-red-500/10 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-500 relative">
                <Activity className="w-8 h-8 text-red-400 relative z-10" />
                <div className="absolute inset-0 bg-red-500/20 blur-lg rounded-full opacity-0 group-hover:opacity-100 animate-pulse"></div>
              </div>
              <h3 className="text-xl font-bold text-white mb-3">Forensic Snapshots</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Capture volatile memory, network states, and process trees instantly upon 
                detecting compromise. Replay attack sessions with "Ghost Mode".
              </p>
            </div>

          </div>
        </div>
      </section>

      {/* Workflow Diagram */}
      <section className="relative z-10 py-24 bg-gradient-to-b from-[#050b14] to-[#020617]">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-white mb-4">Operational Workflow</h2>
            <p className="text-slate-400">How Virtual Puppets neutralizes threats</p>
          </div>

          <div className="relative">
            {/* Connecting Line (Desktop) with Data Pulse Animation */}
            <div className="hidden md:block absolute top-1/2 left-0 w-full h-0.5 bg-slate-800 -translate-y-1/2 z-0 overflow-hidden rounded-full">
                <div className="absolute top-0 left-0 w-1/2 h-full bg-gradient-to-r from-transparent via-blue-500 to-transparent animate-data-stream"></div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-8 relative z-10">
              
              {/* Step 1 */}
              <div className="flex flex-col items-center text-center group">
                <div className="w-16 h-16 bg-slate-900 border-2 border-slate-700 group-hover:border-blue-500 rounded-full flex items-center justify-center mb-4 shadow-lg relative transition-all duration-500 group-hover:scale-110 z-10">
                  <Lock className="w-6 h-6 text-slate-400 group-hover:text-blue-400 transition-colors" />
                  <div className="absolute -top-1 -right-1 w-6 h-6 bg-blue-600 rounded-full text-[10px] flex items-center justify-center font-bold border-2 border-slate-900">1</div>
                </div>
                <h4 className="font-bold text-white mb-2 group-hover:text-blue-400 transition-colors">Deploy</h4>
                <p className="text-xs text-slate-500">Provision agents & gateways</p>
              </div>

              {/* Step 2 */}
              <div className="flex flex-col items-center text-center group">
                <div className="w-16 h-16 bg-slate-900 border-2 border-slate-700 group-hover:border-yellow-500 rounded-full flex items-center justify-center mb-4 shadow-lg relative transition-all duration-500 group-hover:scale-110 z-10">
                  <Zap className="w-6 h-6 text-slate-400 group-hover:text-yellow-400 transition-colors" />
                  <div className="absolute -top-1 -right-1 w-6 h-6 bg-slate-700 group-hover:bg-yellow-600 rounded-full text-[10px] flex items-center justify-center font-bold border-2 border-slate-900 transition-colors">2</div>
                </div>
                <h4 className="font-bold text-white mb-2 group-hover:text-yellow-400 transition-colors">Lure</h4>
                <p className="text-xs text-slate-500">Project traps & personas</p>
              </div>

              {/* Step 3 */}
              <div className="flex flex-col items-center text-center group">
                <div className="w-16 h-16 bg-slate-900 border-2 border-slate-700 group-hover:border-red-500 rounded-full flex items-center justify-center mb-4 shadow-lg relative transition-all duration-500 group-hover:scale-110 z-10">
                  <Activity className="w-6 h-6 text-slate-400 group-hover:text-red-400 group-hover:animate-pulse transition-colors" />
                  <div className="absolute -top-1 -right-1 w-6 h-6 bg-slate-700 group-hover:bg-red-600 rounded-full text-[10px] flex items-center justify-center font-bold border-2 border-slate-900 transition-colors">3</div>
                </div>
                <h4 className="font-bold text-white mb-2 group-hover:text-red-400 transition-colors">Detect</h4>
                <p className="text-xs text-slate-500">Real-time intrusion alerts</p>
              </div>

              {/* Step 4 */}
              <div className="flex flex-col items-center text-center group">
                <div className="w-16 h-16 bg-slate-900 border-2 border-slate-700 group-hover:border-emerald-500 rounded-full flex items-center justify-center mb-4 shadow-lg relative transition-all duration-500 group-hover:scale-110 z-10">
                  <BarChart2 className="w-6 h-6 text-slate-400 group-hover:text-emerald-400 transition-colors" />
                  <div className="absolute -top-1 -right-1 w-6 h-6 bg-slate-700 group-hover:bg-emerald-600 rounded-full text-[10px] flex items-center justify-center font-bold border-2 border-slate-900 transition-colors">4</div>
                </div>
                <h4 className="font-bold text-white mb-2 group-hover:text-emerald-400 transition-colors">Analyze</h4>
                <p className="text-xs text-slate-500">AI insights & reporting</p>
              </div>

            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-[#020617] py-12 relative z-10">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center">
          <div className="mb-4 md:mb-0 flex items-center">
            <Shield className="w-5 h-5 text-slate-600 mr-2" />
            <span className="font-bold text-slate-300 tracking-wider">VIRTUAL PUPPETS</span>
            <span className="text-slate-600 text-xs ml-2">v2.6.0</span>
          </div>
          <div className="flex space-x-6 text-slate-500 text-sm">
            <span className="cursor-pointer hover:text-blue-400 transition-colors">Documentation</span>
            <span className="cursor-pointer hover:text-blue-400 transition-colors">API Reference</span>
            <span className="cursor-pointer hover:text-blue-400 transition-colors">Privacy Policy</span>
          </div>
          <div className="mt-4 md:mt-0 text-slate-600 text-xs font-mono">
            © {new Date().getFullYear()} Cyber Defense Division.
          </div>
        </div>
      </footer>

      {/* --- CUSTOM CSS ANIMATIONS INJECTED --- */}
      <style>{`
        @keyframes scan-slow {
          0% { top: -100%; opacity: 0; }
          50% { opacity: 0.5; }
          100% { top: 100%; opacity: 0; }
        }
        .animate-scan-slow {
          animation: scan-slow 8s linear infinite;
        }
        @keyframes data-stream {
          0% { left: -50%; opacity: 0; }
          50% { opacity: 1; }
          100% { left: 100%; opacity: 0; }
        }
        .animate-data-stream {
          animation: data-stream 3s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }
        @keyframes shimmer {
          100% { transform: translateX(100%); }
        }
        .animate-shimmer {
          animation: shimmer 2s infinite;
        }
        @keyframes pulse-slow {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
        .animate-pulse-slow {
          animation: pulse-slow 4s ease-in-out infinite;
        }
        @keyframes spin-slow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .group:hover .group-hover\\:animate-spin-slow {
          animation: spin-slow 10s linear infinite;
        }
        /* New Animations */
        @keyframes float {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-10px); }
        }
        .animate-float {
            animation: float 4s ease-in-out infinite;
        }
        @keyframes transmit {
            0% { transform: scale(0); opacity: 1; top: 50%; left: 50%; }
            80% { opacity: 1; }
            100% { transform: translate(var(--tx, 100px), var(--ty, 50px)); opacity: 0; }
        }
        .animate-transmit {
            /* This is a visual approximation using keyframes that would need specific offsets for each node, 
               but for this demo we use ping/fade effects in the DOM structure for simplicity */
            animation: ping 1s cubic-bezier(0, 0, 0.2, 1) infinite; 
        }
      `}</style>

    </div>
  );
};

export default LandingPage;
