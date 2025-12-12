
import React, { useState, useEffect, useRef } from 'react';
import { Shield, Activity, Globe, Lock, Cpu, ArrowRight, Terminal, BarChart2, Zap, Server, Code, Wifi, Eye, Printer, Camera, Smartphone, Laptop, Database } from 'lucide-react';

interface LandingPageProps {
  onLoginClick: () => void;
}

const PERSONAS = [
    { icon: Laptop, label: "Workstation", id: "WIN-11-ENT", color: "text-blue-400" },
    { icon: Printer, label: "Office Printer", id: "HP-JET-4050", color: "text-emerald-400" },
    { icon: Camera, label: "IP Camera", id: "AXIS-SEC-01", color: "text-red-400" },
    { icon: Smartphone, label: "Android", id: "PIXEL-NODE", color: "text-purple-400" },
    { icon: Database, label: "SQL Server", id: "ORACLE-DB", color: "text-yellow-400" },
    { icon: Server, label: "Domain Controller", id: "DC-01-CORP", color: "text-cyan-400" },
];

const SLOGANS = [
    { pre: "Master the", post: "Digital Chaos" },
    { pre: "Deceive.", post: "Detect. Defend." },
    { pre: "Architect of", post: "False Realities" },
    { pre: "The Art of", post: "Cyber Illusion" },
    { pre: "Your Trap.", post: "Their Nightmare." },
    { pre: "Silent Watchers,", post: "Invisible Nets" },
    { pre: "Chaos is", post: "Your Weapon" },
    { pre: "Puppeteer of the", post: "Dark Web" },
    { pre: "Orchestrate", post: "The Breach" },
    { pre: "Where Hackers", post: "Go to Fail" }
];

// Inline Logo Component
const VpLogo = ({ className = "w-10 h-10" }: { className?: string }) => (
    <svg viewBox="0 0 100 60" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M10 5 L35 55 L60 5" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M60 5 L60 35 H80 C90 35 90 5 80 5 H60" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="22" cy="30" r="3" className="fill-cyan-400 animate-pulse" />
        <circle cx="48" cy="30" r="3" className="fill-cyan-400 animate-pulse" style={{animationDelay: '0.2s'}} />
        <circle cx="70" cy="20" r="3" className="fill-cyan-400 animate-pulse" style={{animationDelay: '0.4s'}} />
        <path d="M22 30 L48 30 L70 20" stroke="#22d3ee" strokeWidth="1.5" strokeOpacity="0.8" />
    </svg>
);

const LandingPage: React.FC<LandingPageProps> = ({ onLoginClick }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [headline, setHeadline] = useState(SLOGANS[0]);

  // --- SYNCHRONIZED PUPPET STATE ---
  const [globalIndex, setGlobalIndex] = useState(0);
  const [isGlobalGlitching, setIsGlobalGlitching] = useState(false);

  // Set random slogan on mount
  useEffect(() => {
      const randomSlogan = SLOGANS[Math.floor(Math.random() * SLOGANS.length)];
      setHeadline(randomSlogan);
  }, []);

  // --- GLOBAL TIMER (5 Seconds) ---
  useEffect(() => {
      const interval = setInterval(() => {
          // 1. Start Glitch
          setIsGlobalGlitching(true);

          // 2. Change Data halfway through glitch
          setTimeout(() => {
              setGlobalIndex(prev => (prev + 1) % PERSONAS.length);
              
              // 3. Stop Glitch
              setTimeout(() => {
                  setIsGlobalGlitching(false);
              }, 300);
          }, 300);

      }, 5000); // Exactly 5 seconds

      return () => clearInterval(interval);
  }, []);

  // --- SUB-COMPONENT FOR PUPPET ---
  const VirtualPuppet = ({ 
    offsetIndex = 0, 
    scale = 1, 
    opacity = 1, 
    zIndex = 10,
    left = "50%", 
    top = "0px",
    blur = false
  }: { offsetIndex?: number, scale?: number, opacity?: number, zIndex?: number, left?: string, top?: string, blur?: boolean }) => {
    
    // Determine local persona based on global index + fixed offset
    // This ensures they all change at once, but show different things
    const localIndex = (globalIndex + offsetIndex) % PERSONAS.length;
    const Persona = PERSONAS[localIndex];
    const Icon = Persona.icon;
    
    return (
        <div 
            className="absolute origin-top"
            style={{
                left: left,
                top: top,
                transform: `translateX(-50%) scale(${scale})`, 
                zIndex: zIndex,
                opacity: opacity,
                filter: blur ? 'blur(2px)' : 'none',
            }}
        >
             {/* Strings */}
             <svg className="absolute -top-[600px] left-1/2 -translate-x-1/2 w-64 h-[800px] pointer-events-none overflow-visible" viewBox="0 0 256 800">
                <defs>
                    <linearGradient id={`stringGrad-${offsetIndex}`} x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.0" />
                        <stop offset="50%" stopColor="#60a5fa" stopOpacity="0.3" />
                        <stop offset="100%" stopColor="#93c5fd" stopOpacity={1.0 * opacity} />
                    </linearGradient>
                </defs>
                <line x1="96" y1="0" x2="128" y2="200" stroke={`url(#stringGrad-${offsetIndex})`} strokeWidth="1" strokeDasharray="4,4" opacity="0.6" />
                <line x1="160" y1="0" x2="128" y2="200" stroke={`url(#stringGrad-${offsetIndex})`} strokeWidth="1" strokeDasharray="4,4" opacity="0.6" />
                <line x1="112" y1="0" x2="128" y2="200" stroke={`url(#stringGrad-${offsetIndex})`} strokeWidth="1.5" />
                <line x1="144" y1="0" x2="128" y2="200" stroke={`url(#stringGrad-${offsetIndex})`} strokeWidth="1.5" />
            </svg>

            {/* Body Container - Glitch applies here based on GLOBAL state */}
            <div className={`relative mt-[200px] transition-all duration-200 ${isGlobalGlitching ? 'animate-glitch' : 'animate-float'}`}>
                 {/* Holographic Circle */}
                 <div className="relative w-32 h-32 flex items-center justify-center">
                    <div className="absolute inset-0 border-2 border-dashed border-blue-500/30 rounded-full animate-[spin_10s_linear_infinite]"></div>
                    <div className="absolute inset-2 border border-blue-400/20 rounded-full animate-[spin_8s_linear_infinite_reverse]"></div>
                    <div className={`absolute inset-0 bg-gradient-to-b from-slate-900 to-black rounded-full opacity-90 border border-slate-700 shadow-[0_0_30px_rgba(59,130,246,${0.15 * opacity})]`}></div>
                    
                    <div className="absolute inset-0 rounded-full overflow-hidden opacity-30">
                        <div className="w-full h-1/2 bg-gradient-to-b from-transparent via-blue-400 to-transparent animate-scan-fast absolute top-0 -translate-y-full"></div>
                    </div>

                    <div className="relative z-10 flex flex-col items-center justify-center">
                        <Icon className={`w-12 h-12 mb-2 ${Persona.color} drop-shadow-[0_0_8px_rgba(255,255,255,0.2)] transition-colors duration-300`} />
                        <div className="bg-black/60 px-2 py-0.5 rounded border border-slate-800 backdrop-blur-sm">
                            <span className={`text-[10px] font-mono font-bold tracking-wider ${Persona.color} transition-colors duration-300`}>{Persona.id}</span>
                        </div>
                    </div>
                 </div>
                 
                 {/* Label */}
                 <div className="mt-6 flex flex-col items-center">
                    <div className="h-4 w-0.5 bg-slate-700 mb-1"></div>
                    <div className={`px-3 py-1 rounded-full border bg-slate-900/80 backdrop-blur text-xs font-bold tracking-wide uppercase shadow-lg transition-all duration-300 ${isGlobalGlitching ? 'border-red-500 text-red-400 scale-110' : 'border-blue-500/50 text-blue-300'}`}>
                        {isGlobalGlitching ? 'MORPHING...' : Persona.label}
                    </div>
                 </div>
            </div>
        </div>
    );
  };

  // --- INTERACTIVE NEURAL NETWORK BACKGROUND (CANVAS) ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = window.innerWidth;
    let height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;

    const particles: { x: number; y: number; vx: number; vy: number; size: number }[] = [];
    const particleCount = Math.min(100, Math.floor((width * height) / 15000)); 

    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        size: Math.random() * 2 + 1,
      });
    }

    let animationFrameId: number;

    const render = () => {
      ctx.clearRect(0, 0, width, height);
      particles.forEach((p, i) => {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > width) p.vx *= -1;
        if (p.y < 0 || p.y > height) p.vy *= -1;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(59, 130, 246, 0.5)';
        ctx.fill();

        const dxMouse = mousePos.x - p.x;
        const dyMouse = mousePos.y - p.y;
        const distMouse = Math.sqrt(dxMouse * dxMouse + dyMouse * dyMouse);
        const connectRange = 250;

        if (distMouse < connectRange) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(mousePos.x, mousePos.y);
            const alpha = 1 - distMouse / connectRange;
            ctx.strokeStyle = `rgba(96, 165, 250, ${alpha * 0.6})`;
            ctx.lineWidth = 1;
            ctx.stroke();
            
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * 1.5, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(96, 165, 250, ${alpha})`; 
            ctx.fill();
        }

        for (let j = i + 1; j < particles.length; j++) {
            const p2 = particles[j];
            const dx = p.x - p2.x;
            const dy = p.y - p2.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            
            if (dist < 100) {
                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(p2.x, p2.y);
                const alpha = 1 - dist / 100;
                ctx.strokeStyle = `rgba(59, 130, 246, ${alpha * 0.2})`;
                ctx.lineWidth = 0.5;
                ctx.stroke();
            }
        }
      });
      animationFrameId = requestAnimationFrame(render);
    };

    render();

    const handleResize = () => {
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = width;
        canvas.height = height;
    };

    window.addEventListener('resize', handleResize);
    return () => {
        window.removeEventListener('resize', handleResize);
        cancelAnimationFrame(animationFrameId);
    };
  }, [mousePos]); 

  useEffect(() => {
      const handleMouseMove = (e: MouseEvent) => {
          setMousePos({ x: e.clientX, y: e.clientY });
      };
      window.addEventListener('mousemove', handleMouseMove);
      return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);


  return (
    <div className="relative h-screen w-full bg-[#020408] text-slate-200 font-sans selection:bg-blue-500/30 overflow-y-auto overflow-x-hidden scroll-smooth">
      
      {/* 1. CANVAS BACKGROUND LAYER */}
      <canvas 
        ref={canvasRef} 
        className="fixed inset-0 z-0 pointer-events-none opacity-60"
      />
      
      {/* 2. GRADIENT OVERLAY (Vignette) */}
      <div className="fixed inset-0 z-0 bg-[radial-gradient(circle_at_center,transparent_0%,#020408_90%)] pointer-events-none"></div>

      {/* Navigation */}
      <nav className="relative z-50 max-w-7xl mx-auto px-6 py-6 flex justify-between items-center backdrop-blur-sm">
        <div className="flex items-center space-x-3 group cursor-default">
          <div className="relative h-10 w-auto flex items-center justify-center">
             {/* Using SVG Component instead of Image */}
             <VpLogo className="h-10 w-auto text-white filter drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]" />
          </div>
          <div className="flex flex-col">
            <span className="text-lg font-bold tracking-widest text-white">VIRTUAL PUPPETS</span>
            <div className="flex items-center">
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full mr-1.5 animate-pulse"></span>
                <span className="text-[9px] text-slate-400 font-mono tracking-wider uppercase">System Secure</span>
            </div>
          </div>
        </div>
        <button 
          onClick={onLoginClick}
          className="relative group flex items-center space-x-2 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-blue-500/50 text-slate-300 px-5 py-2 rounded-full transition-all duration-300 backdrop-blur-md"
        >
          <span className="text-xs font-bold tracking-wider group-hover:text-white transition-colors">CONSOLE LOGIN</span>
          <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform text-blue-400" />
        </button>
      </nav>

      {/* Hero Section - Reduced top padding from pt-20 to pt-8 */}
      <header className="relative z-10 pt-8 pb-32 px-6 max-w-7xl mx-auto flex flex-col lg:flex-row items-center gap-16">
        
        {/* Left: Text Content */}
        <div className="flex-1 text-center lg:text-left z-10 space-y-8 relative">
            
            {/* Background Logo Watermark for Hero */}
            <div className="absolute -top-20 -left-20 w-96 h-96 opacity-5 z-0 pointer-events-none">
                <VpLogo className="w-full h-full text-white" />
            </div>

            <div className="inline-block relative z-10">
                <div className="inline-flex items-center space-x-2 bg-blue-950/30 border border-blue-500/20 rounded-full px-3 py-1 backdrop-blur-md">
                    <span className="text-[10px] font-mono text-blue-300 uppercase tracking-widest">v2.6.0 Stable Release</span>
                </div>
            </div>
            
            <h1 className="relative z-10 text-5xl md:text-7xl font-bold text-white tracking-tight leading-none">
              {headline.pre} <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-cyan-400 to-emerald-400 relative">
                {headline.post}
                <span className="absolute -bottom-2 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-transparent opacity-50"></span>
              </span>
            </h1>
            
            <p className="relative z-10 text-lg text-slate-400 max-w-2xl mx-auto lg:mx-0 leading-relaxed font-light">
              Advanced honeypot orchestration. Deceive adversaries with <span className="text-slate-200 font-medium">dynamic personas</span>, 
              capture <span className="text-slate-200 font-medium">forensic snapshots</span>, and visualize threats in real-time.
              You pull the strings.
            </p>

            <div className="relative z-10 flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4 pt-4">
                <button 
                    onClick={onLoginClick}
                    className="w-full sm:w-auto bg-blue-600 hover:bg-blue-500 text-white px-8 py-4 rounded-lg font-bold text-sm tracking-widest shadow-[0_0_20px_rgba(37,99,235,0.3)] hover:shadow-[0_0_30px_rgba(37,99,235,0.5)] transition-all hover:-translate-y-1 flex items-center justify-center uppercase"
                >
                    <Terminal className="w-4 h-4 mr-2" />
                    Initialize C2
                </button>
                <a href="#features" className="w-full sm:w-auto px-8 py-4 rounded-lg font-bold text-sm tracking-widest text-slate-300 hover:text-white border border-slate-700 hover:border-slate-500 hover:bg-slate-800 transition-all flex items-center justify-center uppercase">
                    Architecture
                </a>
            </div>
        </div>

        {/* Right: The Virtual Puppet Visualizer (FLEET) - Fixed Layout */}
        <div className="flex-1 relative h-[600px] w-full overflow-visible">
            
            {/* 1. Left Puppet (Higher & Smaller) */}
            <VirtualPuppet 
                offsetIndex={2} 
                scale={0.75} 
                opacity={0.8} 
                zIndex={10} 
                left="20%"
                top="0px" 
                blur={false}
            />

            {/* 2. Middle Puppet (Lower & Larger) - The V-Tip */}
            <VirtualPuppet 
                offsetIndex={0} 
                scale={1.2} 
                opacity={1} 
                zIndex={20} 
                left="50%" 
                top="120px" 
                blur={false}
            />

            {/* 3. Right Puppet (Higher & Smaller) */}
            <VirtualPuppet 
                offsetIndex={4} 
                scale={0.75} 
                opacity={0.8} 
                zIndex={10} 
                left="80%" 
                top="0px" 
                blur={false}
            />
            
            {/* Floor Shadow (Shared) - Widened */}
            <div className="absolute bottom-20 left-1/2 -translate-x-1/2 w-4/5 h-8 bg-blue-500/10 blur-xl rounded-full animate-shadow-pulse transform scale-x-125"></div>
        </div>

      </header>

      {/* Stats Strip */}
      <div className="relative z-10 border-y border-white/5 bg-white/[0.02] backdrop-blur-sm">
          <div className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-2 md:grid-cols-4 gap-8">
              {[
                  { label: "Active Nodes", val: "1,240+", icon: Server, color: "text-blue-400" },
                  { label: "Threats Jailed", val: "85k", icon: Lock, color: "text-emerald-400" },
                  { label: "Uptime", val: "99.9%", icon: Activity, color: "text-purple-400" },
                  { label: "Global Reach", val: "14 Regions", icon: Globe, color: "text-cyan-400" },
              ].map((stat, i) => (
                  <div key={i} className="flex flex-col items-center md:items-start group">
                      <div className="flex items-center mb-2">
                          <stat.icon className={`w-4 h-4 mr-2 ${stat.color} opacity-70 group-hover:opacity-100 transition-opacity`} />
                          <span className="text-xs font-mono text-slate-500 uppercase tracking-wider">{stat.label}</span>
                      </div>
                      <span className="text-2xl font-bold text-white">{stat.val}</span>
                  </div>
              ))}
          </div>
      </div>

      {/* Feature Cards */}
      <section id="features" className="relative z-10 py-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* Card 1 */}
            <div className="group bg-slate-900/40 border border-slate-800 p-8 rounded-2xl hover:bg-slate-800/60 hover:border-blue-500/30 transition-all duration-300">
                <div className="w-12 h-12 bg-blue-900/30 rounded-lg flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                    <Wifi className="w-6 h-6 text-blue-400" />
                </div>
                <h3 className="text-xl font-bold text-white mb-3">Wireless Recon</h3>
                <p className="text-slate-400 text-sm leading-relaxed">
                    Passive sniffing of Wi-Fi and Bluetooth signatures in the physical vicinity of your actors. Map the unseen landscape.
                </p>
            </div>

            {/* Card 2 */}
            <div className="group bg-slate-900/40 border border-slate-800 p-8 rounded-2xl hover:bg-slate-800/60 hover:border-purple-500/30 transition-all duration-300">
                <div className="w-12 h-12 bg-purple-900/30 rounded-lg flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                    <Eye className="w-6 h-6 text-purple-400" />
                </div>
                <h3 className="text-xl font-bold text-white mb-3">Ghost Mode</h3>
                <p className="text-slate-400 text-sm leading-relaxed">
                    Record every keystroke and command of the attacker. Replay attack sessions like a movie to understand TTPs.
                </p>
            </div>

            {/* Card 3 */}
            <div className="group bg-slate-900/40 border border-slate-800 p-8 rounded-2xl hover:bg-slate-800/60 hover:border-emerald-500/30 transition-all duration-300">
                <div className="w-12 h-12 bg-emerald-900/30 rounded-lg flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                    <Code className="w-6 h-6 text-emerald-400" />
                </div>
                <h3 className="text-xl font-bold text-white mb-3">Trap Injection</h3>
                <p className="text-slate-400 text-sm leading-relaxed">
                    Project fake high-value targets (Oracle DB, RDP, PLCs) from the cloud to your edge devices instantly.
                </p>
            </div>

          </div>
        </div>
      </section>

      <footer className="border-t border-slate-800/50 bg-[#020408] py-8 relative z-10 text-center text-slate-600 text-xs font-mono">
          <p>&copy; {new Date().getFullYear()} VIRTUAL PUPPETS // CYBER DEFENSE DIVISION</p>
      </footer>

      {/* --- CSS ANIMATIONS --- */}
      <style>{`
        .perspective-container {
            perspective: 1000px;
        }
        
        /* REFINED GLITCH: Subtler movement, added opacity flicker */
        @keyframes glitch {
            0% { transform: translateX(-50%) translate(0); opacity: 1; }
            25% { transform: translateX(-50%) translate(-1px, 1px); opacity: 0.9; }
            50% { transform: translateX(-50%) translate(0); opacity: 1; }
            75% { transform: translateX(-50%) translate(1px, -1px); opacity: 0.9; }
            100% { transform: translateX(-50%) translate(0); opacity: 1; }
        }
        .animate-glitch {
            animation: glitch 0.2s linear infinite;
        }

        @keyframes dash-flow {
            to { stroke-dashoffset: -20; }
        }
        .animate-dash-flow {
            animation: dash-flow 1s linear infinite;
        }
        .animate-dash-flow-reverse {
            animation: dash-flow 1s linear infinite reverse;
        }

        @keyframes scan-fast {
            0% { top: -100%; opacity: 0; }
            50% { opacity: 0.5; }
            100% { top: 200%; opacity: 0; }
        }
        .animate-scan-fast {
            animation: scan-fast 2s linear infinite;
        }

        @keyframes shadow-pulse {
            0%, 100% { transform: translateX(-50%) scale(1); opacity: 0.5; }
            50% { transform: translateX(-50%) scale(1.2); opacity: 0.2; }
        }
        .animate-shadow-pulse {
            animation: shadow-pulse 6s ease-in-out infinite;
        }
      `}</style>

    </div>
  );
};

export default LandingPage;
