
import React from 'react';
import { Shield, Activity, Globe, Lock, Cpu, ArrowRight, Terminal, BarChart2, Zap } from 'lucide-react';

interface LandingPageProps {
  onLoginClick: () => void;
}

const LandingPage: React.FC<LandingPageProps> = ({ onLoginClick }) => {
  return (
    <div className="min-h-screen bg-cyber-900 text-slate-200 font-sans selection:bg-blue-500/30 overflow-x-hidden">
      
      {/* Background Effects */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-900/20 via-cyber-900 to-black opacity-60"></div>
        <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-blue-500/50 to-transparent opacity-30"></div>
      </div>

      {/* Navigation */}
      <nav className="relative z-50 max-w-7xl mx-auto px-6 py-6 flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Shield className="w-6 h-6 text-white" />
          </div>
          <span className="text-xl font-bold tracking-wider text-white">VIRTUAL PUPPETS</span>
        </div>
        <button 
          onClick={onLoginClick}
          className="group flex items-center space-x-2 bg-slate-800/50 hover:bg-slate-700 border border-slate-700 text-slate-300 px-5 py-2 rounded-full transition-all duration-300 hover:shadow-[0_0_15px_rgba(59,130,246,0.3)] hover:text-white backdrop-blur-sm"
        >
          <span className="text-sm font-bold">ACCESS CONSOLE</span>
          <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
        </button>
      </nav>

      {/* Hero Section */}
      <header className="relative z-10 pt-20 pb-32 text-center px-4">
        <div className="inline-flex items-center space-x-2 bg-blue-900/20 border border-blue-500/30 rounded-full px-4 py-1.5 mb-8 animate-fade-in">
          <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></span>
          <span className="text-xs font-mono text-blue-300 tracking-widest uppercase">System Status: Operational</span>
        </div>
        
        <h1 className="text-5xl md:text-7xl font-bold text-white mb-6 tracking-tight leading-tight">
          Next-Gen <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-emerald-400">Active Defense</span><br />
          Infrastructure
        </h1>
        
        <p className="text-lg md:text-xl text-slate-400 max-w-3xl mx-auto mb-10 leading-relaxed">
          Deploy distributed honeypot actors, deceive adversaries with AI-generated personas, 
          and analyze threat telemetry in real-time. Turn the hunters into the hunted.
        </p>

        <div className="flex flex-col md:flex-row items-center justify-center gap-4">
          <button 
            onClick={onLoginClick}
            className="w-full md:w-auto bg-blue-600 hover:bg-blue-500 text-white px-8 py-4 rounded-lg font-bold text-lg shadow-xl shadow-blue-600/20 transition-all hover:scale-105 flex items-center justify-center"
          >
            <Terminal className="w-5 h-5 mr-2" />
            Initialize C2 Session
          </button>
          <a href="#features" className="w-full md:w-auto px-8 py-4 rounded-lg font-bold text-lg text-slate-300 hover:text-white transition-colors flex items-center justify-center border border-slate-700 hover:border-slate-500 bg-slate-800/30">
            View Capabilities
          </a>
        </div>
      </header>

      {/* Infographic / Features Grid */}
      <section id="features" className="relative z-10 py-20 bg-slate-900/50 border-t border-slate-800 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            
            {/* Feature 1 */}
            <div className="group bg-slate-800/40 border border-slate-700 p-8 rounded-2xl hover:bg-slate-800 transition-all duration-300 hover:-translate-y-1">
              <div className="w-14 h-14 bg-emerald-500/10 rounded-xl flex items-center justify-center mb-6 group-hover:bg-emerald-500/20 transition-colors">
                <Globe className="w-8 h-8 text-emerald-400" />
              </div>
              <h3 className="text-xl font-bold text-white mb-3">Distributed Fleet</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Manage hundreds of lightweight "Puppet" actors distributed across physical locations. 
                Visualize global threat topology on a real-time map.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="group bg-slate-800/40 border border-slate-700 p-8 rounded-2xl hover:bg-slate-800 transition-all duration-300 hover:-translate-y-1">
              <div className="w-14 h-14 bg-purple-500/10 rounded-xl flex items-center justify-center mb-6 group-hover:bg-purple-500/20 transition-colors">
                <Cpu className="w-8 h-8 text-purple-400" />
              </div>
              <h3 className="text-xl font-bold text-white mb-3">AI Persona Engine</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Dynamically shift device identities. Use AI to generate realistic honey-files, 
                credentials, and configuration artifacts to lure attackers deeper.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="group bg-slate-800/40 border border-slate-700 p-8 rounded-2xl hover:bg-slate-800 transition-all duration-300 hover:-translate-y-1">
              <div className="w-14 h-14 bg-red-500/10 rounded-xl flex items-center justify-center mb-6 group-hover:bg-red-500/20 transition-colors">
                <Activity className="w-8 h-8 text-red-400" />
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
      <section className="relative z-10 py-24">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-white mb-4">Operational Workflow</h2>
            <p className="text-slate-400">How Virtual Puppets neutralizes threats</p>
          </div>

          <div className="relative">
            {/* Connecting Line (Desktop) */}
            <div className="hidden md:block absolute top-1/2 left-0 w-full h-0.5 bg-gradient-to-r from-slate-800 via-blue-900 to-slate-800 -translate-y-1/2 z-0"></div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-8 relative z-10">
              
              <div className="flex flex-col items-center text-center">
                <div className="w-16 h-16 bg-slate-900 border-2 border-slate-700 rounded-full flex items-center justify-center mb-4 shadow-lg relative">
                  <Lock className="w-6 h-6 text-slate-400" />
                  <div className="absolute -top-1 -right-1 w-4 h-4 bg-blue-500 rounded-full text-[10px] flex items-center justify-center font-bold">1</div>
                </div>
                <h4 className="font-bold text-white mb-2">Deploy</h4>
                <p className="text-xs text-slate-500">Provision agents & gateways</p>
              </div>

              <div className="flex flex-col items-center text-center">
                <div className="w-16 h-16 bg-slate-900 border-2 border-slate-700 rounded-full flex items-center justify-center mb-4 shadow-lg relative">
                  <Zap className="w-6 h-6 text-yellow-400" />
                  <div className="absolute -top-1 -right-1 w-4 h-4 bg-blue-500 rounded-full text-[10px] flex items-center justify-center font-bold">2</div>
                </div>
                <h4 className="font-bold text-white mb-2">Lure</h4>
                <p className="text-xs text-slate-500">Project traps & personas</p>
              </div>

              <div className="flex flex-col items-center text-center">
                <div className="w-16 h-16 bg-slate-900 border-2 border-slate-700 rounded-full flex items-center justify-center mb-4 shadow-lg relative">
                  <Activity className="w-6 h-6 text-red-400 animate-pulse" />
                  <div className="absolute -top-1 -right-1 w-4 h-4 bg-blue-500 rounded-full text-[10px] flex items-center justify-center font-bold">3</div>
                </div>
                <h4 className="font-bold text-white mb-2">Detect</h4>
                <p className="text-xs text-slate-500">Real-time intrusion alerts</p>
              </div>

              <div className="flex flex-col items-center text-center">
                <div className="w-16 h-16 bg-slate-900 border-2 border-slate-700 rounded-full flex items-center justify-center mb-4 shadow-lg relative">
                  <BarChart2 className="w-6 h-6 text-emerald-400" />
                  <div className="absolute -top-1 -right-1 w-4 h-4 bg-blue-500 rounded-full text-[10px] flex items-center justify-center font-bold">4</div>
                </div>
                <h4 className="font-bold text-white mb-2">Analyze</h4>
                <p className="text-xs text-slate-500">AI insights & reporting</p>
              </div>

            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-slate-950 py-12 relative z-10">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center">
          <div className="mb-4 md:mb-0">
            <span className="font-bold text-slate-300 tracking-wider">VIRTUAL PUPPETS</span>
            <span className="text-slate-600 text-xs ml-2">v2.6.0</span>
          </div>
          <div className="flex space-x-6 text-slate-500 text-sm">
            <span className="cursor-pointer hover:text-white transition-colors">Documentation</span>
            <span className="cursor-pointer hover:text-white transition-colors">API Reference</span>
            <span className="cursor-pointer hover:text-white transition-colors">Privacy Policy</span>
          </div>
          <div className="mt-4 md:mt-0 text-slate-600 text-xs">
            © {new Date().getFullYear()} Cyber Defense Division.
          </div>
        </div>
      </footer>

    </div>
  );
};

export default LandingPage;
