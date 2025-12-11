
import React, { useState, useEffect, useRef } from 'react';
import { Shield, Activity, Globe, Lock, Cpu, ArrowRight, Terminal, BarChart2, Zap, Server, Code, Wifi, Eye } from 'lucide-react';

interface LandingPageProps {
  onLoginClick: () => void;
}

const LandingPage: React.FC<LandingPageProps> = ({ onLoginClick }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

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
    const particleCount = Math.min(100, Math.floor((width * height) / 15000)); // Responsive count

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
      
      // Update & Draw Particles
      particles.forEach((p, i) => {
        p.x += p.vx;
        p.y += p.vy;

        // Bounce off walls
        if (p.x < 0 || p.x > width) p.vx *= -1;
        if (p.y < 0 || p.y > height) p.vy *= -1;

        // Draw Dot
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(59, 130, 246, 0.5)'; // Blue-500
        ctx.fill();

        // Connect to Mouse (The "Puppet Strings" Effect)
        const dxMouse = mousePos.x - p.x;
        const dyMouse = mousePos.y - p.y;
        const distMouse = Math.sqrt(dxMouse * dxMouse + dyMouse * dyMouse);
        const connectRange = 250;

        if (distMouse < connectRange) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(mousePos.x, mousePos.y);
            // Opacity based on distance
            const alpha = 1 - distMouse / connectRange;
            ctx.strokeStyle = `rgba(96, 165, 250, ${alpha * 0.6})`; // Light Blue Line
            ctx.lineWidth = 1;
            ctx.stroke();
            
            // "Active" node effect
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * 1.5, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(96, 165, 250, ${alpha})`; 
            ctx.fill();
        }

        // Connect to nearby particles (The "Network" Effect)
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
                ctx.strokeStyle = `rgba(59, 130, 246, ${alpha * 0.2})`; // Faint connection
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
  }, [mousePos]); // Re-bind not strictly necessary for mousePos if using ref, but safe for React

  // Track mouse for canvas interaction
  useEffect(() => {
      const handleMouseMove = (e: MouseEvent) => {
          // Adjust for scroll if necessary, though fixed canvas handles this usually
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
          <div className="relative w-9 h-9 bg-gradient-to-tr from-blue-600 to-cyan-500 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Shield className="w-5 h-5 text-white" />
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

      {/* Hero Section */}
      <header className="relative z-10 pt-20 pb-32 px-6 max-w-7xl mx-auto flex flex-col lg:flex-row items-center gap-16">
        
        {/* Left: Text Content */}
        <div className="flex-1 text-center lg:text-left z-10 space-y-8">
            
            <div className="inline-block">
                <div className="inline-flex items-center space-x-2 bg-blue-950/30 border border-blue-500/20 rounded-full px-3 py-1 backdrop-blur-md">
                    <span className="text-[10px] font-mono text-blue-300 uppercase tracking-widest">v2.6.0 Stable Release</span>
                </div>
            </div>
            
            <h1 className="text-5xl md:text-7xl font-bold text-white tracking-tight leading-none">
              Master the <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-cyan-400 to-emerald-400 relative">
                Digital Chaos
                <span className="absolute -bottom-2 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-transparent opacity-50"></span>
              </span>
            </h1>
            
            <p className="text-lg text-slate-400 max-w-2xl mx-auto lg:mx-0 leading-relaxed font-light">
              Advanced honeypot orchestration. Deceive adversaries with <span className="text-slate-200 font-medium">dynamic personas</span>, 
              capture <span className="text-slate-200 font-medium">forensic snapshots</span>, and visualize threats in real-time.
              You pull the strings.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4 pt-4">
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

        {/* Right: 3D Wireframe Cube (CSS) */}
        <div className="flex-1 flex justify-center items-center relative h-[400px] w-full perspective-container">
            {/* The Cube Container */}
            <div className="cube-wrapper">
                <div className="cube animate-spin-3d">
                    {/* Outer Cube Faces */}
                    <div className="face front"></div>
                    <div className="face back"></div>
                    <div className="face right"></div>
                    <div className="face left"></div>
                    <div className="face top"></div>
                    <div className="face bottom"></div>
                    
                    {/* Inner Core (The Trap) */}
                    <div className="inner-core">
                        <div className="core-face front"></div>
                        <div className="core-face back"></div>
                        <div className="core-face right"></div>
                        <div className="core-face left"></div>
                        <div className="core-face top"></div>
                        <div className="core-face bottom"></div>
                    </div>
                </div>
                
                {/* Floating Labels attached to the graphic */}
                <div className="absolute top-0 right-0 bg-slate-900/80 border border-slate-700 px-3 py-1 rounded text-[10px] font-mono text-blue-300 animate-float-delayed backdrop-blur-md">
                    Port 22: OPEN
                </div>
                <div className="absolute bottom-10 left-0 bg-slate-900/80 border border-slate-700 px-3 py-1 rounded text-[10px] font-mono text-red-400 animate-float backdrop-blur-md flex items-center">
                    <div className="w-2 h-2 bg-red-500 rounded-full mr-2 animate-ping"></div>
                    Intrusion Detected
                </div>
            </div>
            
            {/* Floor Reflection/Shadow */}
            <div className="absolute bottom-0 w-40 h-40 bg-blue-500/20 blur-3xl rounded-full transform rotateX(90deg) translate-y-20"></div>
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

      {/* --- CSS ANIMATIONS FOR 3D CUBE --- */}
      <style>{`
        .perspective-container {
            perspective: 1000px;
        }
        .cube-wrapper {
            position: relative;
            transform-style: preserve-3d;
            transform: rotateX(-15deg) rotateY(15deg);
        }
        .cube {
            width: 150px;
            height: 150px;
            position: relative;
            transform-style: preserve-3d;
            animation: spin 10s infinite linear;
        }
        
        /* Outer Cube Wireframe */
        .face {
            position: absolute;
            width: 150px;
            height: 150px;
            border: 1px solid rgba(59, 130, 246, 0.5);
            background: rgba(59, 130, 246, 0.05);
            box-shadow: 0 0 20px rgba(59, 130, 246, 0.1) inset;
        }
        .face.front  { transform: translateZ(75px); }
        .face.back   { transform: rotateY(180deg) translateZ(75px); }
        .face.right  { transform: rotateY(90deg) translateZ(75px); }
        .face.left   { transform: rotateY(-90deg) translateZ(75px); }
        .face.top    { transform: rotateX(90deg) translateZ(75px); }
        .face.bottom { transform: rotateX(-90deg) translateZ(75px); }

        /* Inner Core (The "Trap") */
        .inner-core {
            position: absolute;
            top: 50px;
            left: 50px;
            width: 50px;
            height: 50px;
            transform-style: preserve-3d;
            animation: spin-reverse 5s infinite linear;
        }
        .core-face {
            position: absolute;
            width: 50px;
            height: 50px;
            background: rgba(239, 68, 68, 0.3); /* Red */
            border: 1px solid rgba(239, 68, 68, 0.6);
        }
        .core-face.front  { transform: translateZ(25px); }
        .core-face.back   { transform: rotateY(180deg) translateZ(25px); }
        .core-face.right  { transform: rotateY(90deg) translateZ(25px); }
        .core-face.left   { transform: rotateY(-90deg) translateZ(25px); }
        .core-face.top    { transform: rotateX(90deg) translateZ(25px); }
        .core-face.bottom { transform: rotateX(-90deg) translateZ(25px); }

        @keyframes spin {
            from { transform: rotateX(0deg) rotateY(0deg); }
            to { transform: rotateX(360deg) rotateY(360deg); }
        }
        @keyframes spin-reverse {
            from { transform: rotateX(360deg) rotateY(360deg); }
            to { transform: rotateX(0deg) rotateY(0deg); }
        }
        @keyframes float {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-10px); }
        }
        .animate-float { animation: float 4s ease-in-out infinite; }
        .animate-float-delayed { animation: float 4s ease-in-out 2s infinite; }
      `}</style>

    </div>
  );
};

export default LandingPage;
