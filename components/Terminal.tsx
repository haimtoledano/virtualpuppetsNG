import React, { useEffect, useRef, useState } from 'react';
import { LogEntry, LogLevel } from '../types';
import { Pause, Play, Filter, X } from 'lucide-react';

interface TerminalProps {
  logs: LogEntry[];
  title?: string;
  height?: string;
  onCommand?: (cmd: string) => void;
  isInteractive?: boolean;
}

const Terminal: React.FC<TerminalProps> = ({ logs, title = "GLOBAL EVENT FEED", height = "h-64", onCommand, isInteractive }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  
  // Controls for high volume
  const [isPaused, setIsPaused] = useState(false);
  const [onlyCritical, setOnlyCritical] = useState(false);

  // Filter logs for display
  const displayLogs = logs.filter(log => {
      if (onlyCritical) {
          return log.level === LogLevel.CRITICAL || log.level === LogLevel.WARNING;
      }
      return true;
  });

  // Use scrollTop to prevent main window jumping
  useEffect(() => {
    if (!isPaused && scrollRef.current) {
        const { scrollHeight, clientHeight } = scrollRef.current;
        // Only auto-scroll if we are not manually scrolled up significantly, OR if it's a new burst
        scrollRef.current.scrollTop = scrollHeight - clientHeight;
    }
  }, [logs, isPaused, onlyCritical]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !onCommand) return;
    
    const cmd = input.trim();
    setHistory(prev => [...prev, cmd]);
    setHistoryIndex(-1);

    onCommand(cmd);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length === 0) return;

      const newIndex = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(newIndex);
      setInput(history[newIndex]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex === -1) return;

      const newIndex = historyIndex + 1;
      if (newIndex >= history.length) {
        setHistoryIndex(-1);
        setInput('');
      } else {
        setHistoryIndex(newIndex);
        setInput(history[newIndex]);
      }
    }
  };

  const getLogColor = (level: LogLevel) => {
    switch (level) {
      case LogLevel.CRITICAL: return 'text-cyber-red font-bold animate-pulse';
      case LogLevel.ERROR: return 'text-red-400';
      case LogLevel.WARNING: return 'text-yellow-400';
      default: return 'text-slate-400';
    }
  };

  return (
    <div className={`bg-black border border-slate-700 rounded-lg flex flex-col font-mono text-xs md:text-sm shadow-2xl overflow-hidden ${height} transition-all duration-300`}>
      <div className="bg-slate-800 px-3 py-1 flex justify-between items-center border-b border-slate-700 select-none h-8 min-h-[32px]">
        <div className="flex items-center space-x-2">
            <span className="text-slate-400 font-bold tracking-wider text-[10px] md:text-xs truncate">{title}</span>
        </div>
        
        <div className="flex items-center space-x-2">
            {!isInteractive && (
                <>
                    <button 
                        onClick={() => setOnlyCritical(!onlyCritical)}
                        className={`p-1 rounded hover:bg-slate-700 transition-colors ${onlyCritical ? 'text-red-400 bg-red-900/20' : 'text-slate-500'}`}
                        title="Show Critical Only"
                    >
                        <Filter className="w-3 h-3" />
                    </button>
                    <button 
                        onClick={() => setIsPaused(!isPaused)}
                        className={`p-1 rounded hover:bg-slate-700 transition-colors ${isPaused ? 'text-yellow-400' : 'text-slate-500'}`}
                        title={isPaused ? "Resume Feed" : "Pause Feed"}
                    >
                        {isPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                    </button>
                </>
            )}
             <div className="flex space-x-1.5 ml-2">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500/80"></div>
                <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/80"></div>
                <div className="w-2.5 h-2.5 rounded-full bg-green-500/80"></div>
            </div>
        </div>
      </div>
      
      <div 
        ref={scrollRef}
        className="flex-1 p-2 overflow-y-auto space-y-0.5 bg-opacity-90 bg-cyber-900 scrollbar-thin scrollbar-thumb-slate-700"
      >
        {displayLogs.length === 0 && <div className="text-slate-600 italic p-2">Waiting for events...</div>}
        {displayLogs.map((log) => (
          <div key={log.id} className="break-all hover:bg-white/5 px-1 rounded cursor-default leading-tight">
            <span className="text-slate-600 mr-2 text-[10px]">[{new Date(log.timestamp).toLocaleTimeString().split(' ')[0]}]</span>
            <span className="text-blue-400/80 mr-2 text-[10px] w-16 inline-block truncate" title={log.actorName}>{log.actorName}</span>
            <span className={`mr-2 font-bold text-[10px] w-12 inline-block ${getLogColor(log.level)}`}>{log.level}</span>
            <span className="text-slate-300">{log.message}</span>
            {log.sourceIp && <span className="text-cyber-red ml-2 font-mono text-[10px]">SRC={log.sourceIp}</span>}
          </div>
        ))}
      </div>

      {isInteractive && (
        <form onSubmit={handleSubmit} className="bg-slate-800 p-2 flex border-t border-slate-700 shrink-0">
            <span className="text-cyber-green mr-2">$</span>
            <input 
                type="text" 
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                className="flex-1 bg-transparent border-none outline-none text-slate-200 placeholder-slate-600 h-6"
                placeholder="Execute remote command..."
                autoComplete="off"
                autoFocus
            />
        </form>
      )}
    </div>
  );
};

export default Terminal;