
import React, { useState, useEffect, useRef } from 'react';
import { Report, SystemConfig, User, LogEntry, Actor } from '../types';
import { getReports, generateReport, getSystemConfig, deleteReport } from '../services/dbService';
import { generateCustomAiReport } from '../services/aiService';
import { FileText, Download, Loader, Eye, X, Printer, ShieldCheck, Plus, AlertTriangle, PenTool, Search, Calendar, Server, Filter, Bot, BarChart2, Trash2, Cpu, Network, Key, Save, AlertOctagon, Target, Hash, Activity } from 'lucide-react';
import mermaid from 'mermaid';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';

interface ReportsProps {
    currentUser?: User | null;
    logs?: LogEntry[]; // Pass logs for context in AI generation
    actors?: Actor[]; // Pass actors for dropdowns (mock mode)
}

const Reports: React.FC<ReportsProps> = ({ currentUser, logs = [], actors = [] }) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [reports, setReports] = useState<Report[]>([]);
  const [viewReport, setViewReport] = useState<Report | null>(null);
  const [sysConfig, setSysConfig] = useState<SystemConfig | null>(null);

  // New Report Modal State
  const [isCreatorOpen, setIsCreatorOpen] = useState(false);
  const [reportType, setReportType] = useState<'SECURITY_AUDIT' | 'INCIDENT_LOG' | 'CUSTOM' | 'AI_INSIGHT'>('SECURITY_AUDIT');
  
  // Custom & AI Fields
  const [customBody, setCustomBody] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiResult, setAiResult] = useState<{title: string, body: string} | null>(null);

  // Data Driven Incident Fields
  const [filters, setFilters] = useState({
      attackerIp: '',
      targetActorId: '',
      protocol: '',
      dateRange: 'LAST_24H'
  });
  
  // Dropdown Data Sources
  const [availableAttackers, setAvailableAttackers] = useState<string[]>([]);
  const [availableProtocols, setAvailableProtocols] = useState<string[]>([]);

  useEffect(() => {
      loadReports();
      loadConfig();
      populateFilters();
      // Initialize mermaid
      mermaid.initialize({ startOnLoad: false, theme: 'neutral' });
  }, [logs]);

  const loadReports = async () => {
      const data = await getReports();
      setReports(data);
  };

  const loadConfig = async () => {
      const cfg = await getSystemConfig();
      setSysConfig(cfg);
  };

  const populateFilters = async () => {
      // In production, we should fetch these from the API to get full history
      // For now, we mix props (mock/recent) with an API call check
      try {
          const res = await fetch('/api/reports/filters');
          if (res.ok) {
              const data = await res.json();
              setAvailableAttackers(data.attackers || []);
              setAvailableProtocols(data.protocols || []);
              return;
          }
      } catch (e) {}

      // Fallback to local logs if API fails or in Mock mode
      const attackers = Array.from(new Set(logs.map(l => l.sourceIp).filter(Boolean))) as string[];
      const protocols = Array.from(new Set(logs.map(l => l.process))) as string[];
      setAvailableAttackers(attackers);
      setAvailableProtocols(protocols);
  };

  const handleGenerateAi = async () => {
      if (!aiPrompt.trim()) return;
      setIsGenerating(true);
      
      const result = await generateCustomAiReport(aiPrompt, logs);
      if (result) {
          setAiResult({
              title: result.reportTitle,
              body: result.reportBody
          });
      } else {
          alert("AI Generation failed. Check API configuration.");
      }
      setIsGenerating(false);
  };

  const handleSaveReport = async () => {
      if (!currentUser) return;
      setIsGenerating(true);
      
      const payload: any = { type: reportType, generatedBy: currentUser.username };
      
      if (reportType === 'CUSTOM') {
          payload.customBody = customBody;
      } 
      else if (reportType === 'AI_INSIGHT') {
          if (!aiResult) return;
          payload.incidentDetails = { title: aiResult.title }; // Reuse Incident details for title storage hack or just pass customBody
          payload.customBody = aiResult.body;
      }
      else if (reportType === 'INCIDENT_LOG') {
          // Pass the filters so backend can generate the specific stats
          payload.incidentFilters = {
              targetActor: filters.targetActorId,
              attackerIp: filters.attackerIp,
              protocol: filters.protocol,
              dateRange: filters.dateRange
          };
      }

      const success = await generateReport(payload);
      
      if (success) {
          await loadReports();
          setIsCreatorOpen(false);
          // Reset Form
          setReportType('SECURITY_AUDIT');
          setCustomBody('');
          setAiResult(null);
          setAiPrompt('');
          setFilters({ attackerIp: '', targetActorId: '', protocol: '', dateRange: 'LAST_24H' });
      } else {
          alert("Failed to generate report");
      }
      setIsGenerating(false);
  };

  const handleDeleteReport = async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (window.confirm("Are you sure you want to permanently delete this report?")) {
          await deleteReport(id);
          loadReports();
      }
  };

  const ReportModal = ({ report, onClose }: { report: Report, onClose: () => void }) => {
      // Mermaid Rendering Hook
      useEffect(() => {
          if (report.type === 'AI_INSIGHT' || report.content?.customBody) {
              const renderMermaid = async () => {
                   try {
                       await mermaid.run({
                           querySelector: '.mermaid'
                       });
                   } catch (e) { console.error("Mermaid Render Error", e); }
              };
              // Delay slightly to ensure DOM is ready
              setTimeout(renderMermaid, 500);
          }
      }, [report]);

      if (!report.content) return null;

      // Helper to process markdown and extract mermaid blocks
      const renderBodyWithMermaid = (text: string) => {
          const parts = text.split(/(```mermaid[\s\S]*?```)/g);
          return parts.map((part, index) => {
              if (part.startsWith('```mermaid')) {
                  const code = part.replace('```mermaid', '').replace('```', '').trim();
                  return (
                      <div key={index} className="my-6 flex justify-center bg-slate-100 p-4 rounded border border-slate-200 print:border-0 print:bg-transparent">
                          <pre className="mermaid">
                              {code}
                          </pre>
                      </div>
                  );
              }
              // Basic newline to break conversion for text
              return <div key={index} className="whitespace-pre-wrap">{part}</div>;
          });
      };

      const renderIncidentCharts = (content: any) => {
          const timeline = content.incidentDetails?.timeline || [];
          const protocols = content.incidentDetails?.protocolDistribution || [];
          const pieColors = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];

          // Fix date rendering for short chart
          const formattedTimeline = timeline.map((t: any) => ({
              ...t,
              time: t.timeSlice ? t.timeSlice.split(' ')[1].substr(0, 5) : '00:00'
          }));

          return (
              <div className="space-y-8 my-8 print:break-inside-avoid">
                  {/* Timeline Chart */}
                  {timeline.length > 0 && (
                      <div className="bg-slate-50 border border-slate-200 p-4 rounded-lg print:break-inside-avoid">
                          <h4 className="text-xs font-bold text-slate-500 uppercase mb-4 flex items-center">
                              <Activity className="w-4 h-4 mr-2" /> Threat Velocity (Events/Hour)
                          </h4>
                          <div className="h-48 w-full">
                              <ResponsiveContainer width="100%" height="100%">
                                  <AreaChart data={formattedTimeline}>
                                      <defs>
                                          <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                                              <stop offset="5%" stopColor="#ef4444" stopOpacity={0.8}/>
                                              <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                                          </linearGradient>
                                      </defs>
                                      <XAxis dataKey="time" stroke="#94a3b8" fontSize={10} tickLine={false} />
                                      <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} />
                                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                                      <RechartsTooltip contentStyle={{ backgroundColor: '#fff', borderColor: '#e2e8f0', fontSize: '12px' }} />
                                      <Area type="monotone" dataKey="count" stroke="#ef4444" fillOpacity={1} fill="url(#colorCount)" />
                                  </AreaChart>
                              </ResponsiveContainer>
                          </div>
                      </div>
                  )}

                  {/* Protocol Distribution */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 print:block print:space-y-6">
                      {protocols.length > 0 && (
                          <div className="bg-slate-50 border border-slate-200 p-4 rounded-lg print:break-inside-avoid">
                              <h4 className="text-xs font-bold text-slate-500 uppercase mb-4 flex items-center">
                                  <Target className="w-4 h-4 mr-2" /> Attack Surface (By Protocol)
                              </h4>
                              <div className="h-48 w-full">
                                  <ResponsiveContainer width="100%" height="100%">
                                      <PieChart>
                                          <Pie data={protocols} cx="50%" cy="50%" innerRadius={40} outerRadius={70} fill="#8884d8" paddingAngle={5} dataKey="value">
                                              {protocols.map((entry: any, index: number) => (
                                                  <Cell key={`cell-${index}`} fill={pieColors[index % pieColors.length]} />
                                              ))}
                                          </Pie>
                                          <Legend verticalAlign="middle" align="right" layout="vertical" iconSize={8} wrapperStyle={{ fontSize: '10px' }} />
                                          <RechartsTooltip />
                                      </PieChart>
                                  </ResponsiveContainer>
                              </div>
                          </div>
                      )}

                      {/* Top Attackers List */}
                      {content.incidentDetails?.topSources && (
                          <div className="bg-slate-50 border border-slate-200 p-4 rounded-lg flex flex-col print:break-inside-avoid">
                              <h4 className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center">
                                  <AlertOctagon className="w-4 h-4 mr-2" /> Top Threat Sources
                              </h4>
                              <div className="flex-1 overflow-auto">
                                  <table className="w-full text-xs text-left">
                                      <thead className="bg-slate-200 text-slate-600">
                                          <tr><th className="p-2">IP Address</th><th className="p-2 text-right">Volume</th></tr>
                                      </thead>
                                      <tbody>
                                          {content.incidentDetails.topSources.map((src: any, i: number) => (
                                              <tr key={i} className="border-b border-slate-200 last:border-0">
                                                  <td className="p-2 font-mono">{src.SourceIp}</td>
                                                  <td className="p-2 text-right font-bold text-red-600">{src.count}</td>
                                              </tr>
                                          ))}
                                          {content.incidentDetails.topSources.length === 0 && (
                                              <tr><td colSpan={2} className="p-4 text-center text-slate-400 italic">No IP data available</td></tr>
                                          )}
                                      </tbody>
                                  </table>
                              </div>
                          </div>
                      )}
                  </div>
              </div>
          );
      };

      return (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 print:p-0 print:bg-white print:fixed print:inset-0 print:z-[10000] print:block print:h-auto print:overflow-visible">
              <div className="bg-white text-slate-900 w-full max-w-4xl h-[85vh] rounded-lg shadow-2xl flex flex-col overflow-hidden print:shadow-none print:w-full print:max-w-none print:h-auto print:max-h-none print:rounded-none print:overflow-visible">
                  {/* Toolbar */}
                  <div className="bg-slate-100 border-b border-slate-200 p-3 flex justify-between items-center print:hidden">
                      <h3 className="font-bold text-slate-600">Document Viewer</h3>
                      <div className="flex space-x-2">
                          <button onClick={() => window.print()} className="flex items-center text-slate-600 hover:text-blue-600 px-3 py-1 rounded hover:bg-slate-200">
                              <Printer className="w-4 h-4 mr-2" /> Print
                          </button>
                          <button onClick={onClose} className="text-slate-500 hover:text-red-500 px-2">
                              <X className="w-5 h-5" />
                          </button>
                      </div>
                  </div>
                  
                  {/* Document Page */}
                  <div className="flex-1 overflow-y-auto bg-slate-500 p-8 print:p-0 print:bg-white print:overflow-visible print:h-auto">
                      <div className="bg-white max-w-3xl mx-auto shadow-xl min-h-[1000px] p-12 relative print:shadow-none print:w-full print:max-w-none print:p-8 print:min-h-0 print:h-auto">
                          {/* Header */}
                          <div className="flex justify-between items-start border-b-2 border-slate-800 pb-6 mb-8">
                              <div>
                                  <h1 className="text-3xl font-bold uppercase tracking-wider text-slate-900">{sysConfig?.companyName || 'VIRTUAL PUPPETS'}</h1>
                                  <p className="text-sm text-slate-500 mt-1">Cyber Intelligence Division</p>
                              </div>
                              <div className="text-right">
                                  <div className="text-xs text-slate-400 uppercase font-bold">Report ID</div>
                                  <div className="font-mono text-sm">{report.id}</div>
                                  <div className="text-xs text-slate-400 uppercase font-bold mt-2">Date</div>
                                  <div>{new Date(report.createdAt).toLocaleDateString()}</div>
                              </div>
                          </div>

                          {/* Title */}
                          <div className="text-center mb-10">
                              <div className="inline-block bg-slate-100 px-4 py-1 rounded-full text-xs font-bold uppercase tracking-widest text-slate-500 mb-4 print:border print:border-slate-200">{report.type.replace('_', ' ')}</div>
                              <h2 className="text-2xl font-bold text-slate-800 uppercase underline decoration-4 decoration-blue-500 underline-offset-4">{report.title}</h2>
                              <p className="text-slate-500 mt-2 italic">Generated by Officer: {report.generatedBy}</p>
                          </div>

                          {/* DYNAMIC CONTENT BASED ON REPORT TYPE */}
                          
                          {/* 1. AUTO SNAPSHOT STATS */}
                          {report.type === 'SECURITY_AUDIT' && (
                              <div className="grid grid-cols-3 gap-6 mb-10 print:mb-6">
                                  <div className="bg-slate-50 p-4 border border-slate-200 text-center print:break-inside-avoid">
                                      <div className="text-3xl font-bold text-blue-600">{report.content.totalEvents?.toLocaleString() || 0}</div>
                                      <div className="text-xs uppercase font-bold text-slate-500 mt-1">Total Log Events</div>
                                  </div>
                                  <div className="bg-slate-50 p-4 border border-slate-200 text-center print:break-inside-avoid">
                                      <div className="text-3xl font-bold text-red-500">{report.content.compromisedNodes || 0}</div>
                                      <div className="text-xs uppercase font-bold text-slate-500 mt-1">Active Compromises</div>
                                  </div>
                                  <div className="bg-slate-50 p-4 border border-slate-200 text-center print:break-inside-avoid">
                                      <div className="text-3xl font-bold text-emerald-600">{report.content.activeNodes || 0}</div>
                                      <div className="text-xs uppercase font-bold text-slate-500 mt-1">Online Agents</div>
                                  </div>
                              </div>
                          )}

                          {/* 2. INCIDENT LOG - PROFESSIONAL VISUALIZATION */}
                          {report.type === 'INCIDENT_LOG' && (
                               <div className="mb-8">
                                   {/* Executive Summary Box */}
                                   <div className="bg-slate-50 border border-l-4 border-l-red-500 p-6 mb-8 shadow-sm print:break-inside-avoid">
                                       <h3 className="text-slate-700 font-bold uppercase mb-4 flex items-center"><AlertTriangle className="w-5 h-5 mr-2 text-red-500" /> Executive Summary</h3>
                                       <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                           <div><div className="text-[10px] text-slate-400 font-bold uppercase">Scope</div><div className="font-bold">{report.content.incidentFilters?.dateRange}</div></div>
                                           <div><div className="text-[10px] text-slate-400 font-bold uppercase">Total Events</div><div className="font-bold text-red-600">{report.content.incidentDetails?.eventCount?.toLocaleString() || 0}</div></div>
                                           <div><div className="text-[10px] text-slate-400 font-bold uppercase">Target</div><div className="font-mono text-xs">{report.content.incidentFilters?.targetActor || 'All Nodes'}</div></div>
                                           <div><div className="text-[10px] text-slate-400 font-bold uppercase">Attacker</div><div className="font-mono text-xs">{report.content.incidentFilters?.attackerIp || 'Any'}</div></div>
                                       </div>
                                   </div>

                                   {/* Charts */}
                                   {renderIncidentCharts(report.content)}

                                   {/* Forensic Evidence Log Table */}
                                   {report.content.incidentDetails?.evidenceLogs && report.content.incidentDetails.evidenceLogs.length > 0 && (
                                       <div className="mt-8 print:break-before-auto">
                                           <h3 className="text-sm font-bold uppercase border-b border-slate-300 mb-4 pb-1 flex items-center"><Hash className="w-4 h-4 mr-2"/> Forensic Evidence (Sample)</h3>
                                           <table className="w-full text-xs text-left border-collapse">
                                               <thead className="bg-slate-100 text-slate-600">
                                                   <tr>
                                                       <th className="p-2 border border-slate-200">Timestamp</th>
                                                       <th className="p-2 border border-slate-200">Level</th>
                                                       <th className="p-2 border border-slate-200">Process</th>
                                                       <th className="p-2 border border-slate-200">Message</th>
                                                   </tr>
                                               </thead>
                                               <tbody>
                                                   {report.content.incidentDetails.evidenceLogs.map((log: any, i: number) => (
                                                       <tr key={i} className="print:break-inside-avoid">
                                                           <td className="p-2 border border-slate-200 font-mono whitespace-nowrap">{new Date(log.Timestamp).toLocaleString()}</td>
                                                           <td className={`p-2 border border-slate-200 font-bold ${log.Level === 'CRITICAL' ? 'text-red-600' : 'text-slate-600'}`}>{log.Level}</td>
                                                           <td className="p-2 border border-slate-200 font-mono">{log.Process}</td>
                                                           <td className="p-2 border border-slate-200 font-mono break-all">{log.Message}</td>
                                                       </tr>
                                                   ))}
                                               </tbody>
                                           </table>
                                       </div>
                                   )}
                               </div>
                          )}
                          
                          {/* 3. FORENSIC SNAPSHOT DISPLAY */}
                          {report.type === 'FORENSIC_SNAPSHOT' && report.content.snapshotData && (
                              <div className="space-y-6 mb-8">
                                  <div className="grid grid-cols-2 gap-4 print:block print:space-y-4">
                                       <div className="border p-4 bg-slate-50 rounded print:break-inside-avoid">
                                            <h4 className="font-bold text-xs uppercase mb-2 flex items-center"><Cpu className="w-3 h-3 mr-1"/> Top Processes</h4>
                                            <table className="w-full text-xs">
                                                <thead><tr className="border-b border-slate-300"><th className="text-left">PID</th><th>CMD</th><th className="text-right">CPU</th></tr></thead>
                                                <tbody>
                                                    {report.content.snapshotData.processes.slice(0,5).map((p,i) => (
                                                        <tr key={i} className="border-b border-slate-200">
                                                            <td className="font-mono">{p.pid}</td>
                                                            <td className="truncate max-w-[100px]">{p.command}</td>
                                                            <td className="text-right">{p.cpu}%</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                       </div>
                                       <div className="border p-4 bg-slate-50 rounded print:break-inside-avoid">
                                            <h4 className="font-bold text-xs uppercase mb-2 flex items-center"><Network className="w-3 h-3 mr-1"/> Network</h4>
                                            <div className="text-[10px] font-mono whitespace-pre-wrap overflow-hidden h-32 print:h-auto">
                                                {report.content.snapshotData.connections.slice(0,5).join('\n')}
                                            </div>
                                       </div>
                                  </div>
                                  <div className="border p-4 bg-slate-50 rounded print:break-inside-avoid">
                                       <h4 className="font-bold text-xs uppercase mb-2 flex items-center"><Key className="w-3 h-3 mr-1"/> Auth Log Snippet</h4>
                                       <div className="text-[10px] font-mono whitespace-pre-wrap bg-white border p-2 rounded print:border-none print:p-0">
                                            {report.content.snapshotData.authLogs.slice(0,5).join('\n')}
                                       </div>
                                  </div>
                              </div>
                          )}

                          {/* 4. BODY TEXT (Summary or Custom/AI with Mermaid) */}
                          {report.type !== 'INCIDENT_LOG' && (
                              <div className="mb-8 print:break-inside-avoid">
                                  <h3 className="text-sm font-bold uppercase border-b border-slate-300 mb-4 pb-1">
                                      {report.type === 'CUSTOM' ? 'Analyst Notes' : report.type === 'AI_INSIGHT' ? 'AI Assessment & Visualization' : report.type === 'FORENSIC_SNAPSHOT' ? 'Artifact Summary' : 'Executive Summary'}
                                  </h3>
                                  <div className="text-sm leading-relaxed text-slate-700 text-justify font-serif">
                                      {renderBodyWithMermaid(report.content.customBody || report.content.summaryText || '')}
                                  </div>
                              </div>
                          )}

                          {/* 5. TOP ATTACKERS (Only for Audit) */}
                          {report.type === 'SECURITY_AUDIT' && report.content.topAttackers && (
                              <div className="mb-8 print:break-inside-avoid">
                                  <h3 className="text-sm font-bold uppercase border-b border-slate-300 mb-2 pb-1">Top Threat Sources</h3>
                                  <table className="w-full text-sm text-left">
                                      <thead className="bg-slate-100">
                                          <tr>
                                              <th className="p-2">Source IP</th>
                                              <th className="p-2 text-right">Event Count</th>
                                              <th className="p-2">Threat Intelligence</th>
                                          </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-200">
                                          {report.content.topAttackers.map((att, i) => (
                                              <tr key={i}>
                                                  <td className="p-2 font-mono">{att.ip}</td>
                                                  <td className="p-2 text-right font-bold">{att.count}</td>
                                                  <td className="p-2 text-xs text-red-600 font-bold">MALICIOUS</td>
                                              </tr>
                                          ))}
                                      </tbody>
                                  </table>
                              </div>
                          )}

                          {/* Footer */}
                          <div className="absolute bottom-8 left-12 right-12 border-t border-slate-200 pt-4 flex justify-between items-center text-xs text-slate-400 print:static print:mt-12 print:text-black">
                              <span>CONFIDENTIAL // INTERNAL USE ONLY</span>
                              <span className="flex items-center"><ShieldCheck className="w-3 h-3 mr-1" /> VPP-SECURE-DOC</span>
                          </div>
                      </div>
                  </div>
              </div>
          </div>
      );
  };

  return (
    <div className="space-y-6 animate-fade-in pb-10">
        <div className="flex justify-between items-center">
             <div>
                <h2 className="text-2xl font-bold text-slate-200">System Reports</h2>
                <p className="text-slate-500 text-sm">Access generated compliance documents, data-driven attack logs, and AI insights.</p>
             </div>
             <button 
                onClick={() => setIsCreatorOpen(true)}
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg flex items-center font-bold text-sm shadow-lg shadow-emerald-600/20 transition-all"
             >
                <Plus className="w-4 h-4 mr-2" />
                Create New Report
             </button>
        </div>

        {/* Creator Modal */}
        {isCreatorOpen && (
             <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-40 flex items-center justify-center p-4">
                 <div className="bg-slate-800 border border-slate-600 rounded-xl w-full max-w-xl shadow-2xl p-6 overflow-hidden max-h-[90vh] flex flex-col">
                     <div className="flex justify-between items-center mb-6 shrink-0">
                         <h3 className="text-xl font-bold text-white flex items-center"><PenTool className="w-5 h-5 mr-2 text-blue-400" /> Generate Report</h3>
                         <button onClick={() => setIsCreatorOpen(false)}><X className="w-5 h-5 text-slate-500 hover:text-white"/></button>
                     </div>
                     
                     <div className="space-y-4 overflow-y-auto flex-1 pr-2">
                         {/* Report Type Select */}
                         <div>
                             <label className="block text-slate-400 text-xs font-bold uppercase mb-2">Report Type</label>
                             <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                 <button onClick={() => setReportType('SECURITY_AUDIT')} className={`p-2 rounded border text-[10px] font-bold transition-all ${reportType === 'SECURITY_AUDIT' ? 'bg-blue-600 border-blue-400 text-white' : 'bg-slate-900 border-slate-700 text-slate-400'}`}>
                                     Audit Snapshot
                                 </button>
                                 <button onClick={() => setReportType('INCIDENT_LOG')} className={`p-2 rounded border text-[10px] font-bold transition-all ${reportType === 'INCIDENT_LOG' ? 'bg-red-600 border-red-400 text-white' : 'bg-slate-900 border-slate-700 text-slate-400'}`}>
                                     Incident (Data)
                                 </button>
                                 <button onClick={() => setReportType('AI_INSIGHT')} className={`p-2 rounded border text-[10px] font-bold transition-all ${reportType === 'AI_INSIGHT' ? 'bg-purple-600 border-purple-400 text-white' : 'bg-slate-900 border-slate-700 text-slate-400'}`}>
                                     AI Insight
                                 </button>
                                 <button onClick={() => setReportType('CUSTOM')} className={`p-2 rounded border text-[10px] font-bold transition-all ${reportType === 'CUSTOM' ? 'bg-slate-600 border-slate-400 text-white' : 'bg-slate-900 border-slate-700 text-slate-400'}`}>
                                     Manual Note
                                 </button>
                             </div>
                         </div>

                         {/* CONTENT AREA BASED ON TYPE */}

                         {reportType === 'SECURITY_AUDIT' && (
                             <div className="bg-blue-900/20 border border-blue-500/30 p-3 rounded text-sm text-blue-200">
                                 <p>Automatically aggregates current fleet status, compromised nodes count, and top attacker IPs from the last 24 hours.</p>
                             </div>
                         )}

                         {reportType === 'INCIDENT_LOG' && (
                             <div className="space-y-3 bg-slate-900 p-4 rounded border border-slate-700">
                                 <h4 className="text-red-400 text-xs font-bold uppercase mb-2 flex items-center"><Filter className="w-3 h-3 mr-2"/> Select Data Filters</h4>
                                 
                                 <div className="grid grid-cols-2 gap-3">
                                     <div>
                                         <label className="text-xs text-slate-500 block mb-1">Date Range</label>
                                         <select className="w-full bg-slate-800 border border-slate-600 rounded p-2 text-white text-xs outline-none" 
                                             value={filters.dateRange} 
                                             onChange={(e) => setFilters({...filters, dateRange: e.target.value})}
                                         >
                                             <option value="LAST_24H">Last 24 Hours</option>
                                             <option value="LAST_7D">Last 7 Days</option>
                                             <option value="LAST_30D">Last 30 Days</option>
                                             <option value="ALL">All Time</option>
                                         </select>
                                     </div>
                                     <div>
                                         <label className="text-xs text-slate-500 block mb-1">Protocol / Service</label>
                                         <select className="w-full bg-slate-800 border border-slate-600 rounded p-2 text-white text-xs outline-none" 
                                             value={filters.protocol} 
                                             onChange={(e) => setFilters({...filters, protocol: e.target.value})}
                                         >
                                             <option value="">Any Protocol</option>
                                             {availableProtocols.map(p => <option key={p} value={p}>{p}</option>)}
                                         </select>
                                     </div>
                                     <div>
                                         <label className="text-xs text-slate-500 block mb-1">Source IP</label>
                                         <select className="w-full bg-slate-800 border border-slate-600 rounded p-2 text-white text-xs outline-none" 
                                             value={filters.attackerIp} 
                                             onChange={(e) => setFilters({...filters, attackerIp: e.target.value})}
                                         >
                                             <option value="">Any IP</option>
                                             {availableAttackers.map(ip => <option key={ip} value={ip}>{ip}</option>)}
                                         </select>
                                     </div>
                                      <div>
                                         <label className="text-xs text-slate-500 block mb-1">Target Actor</label>
                                         <select className="w-full bg-slate-800 border border-slate-600 rounded p-2 text-white text-xs outline-none" 
                                             value={filters.targetActorId} 
                                             onChange={(e) => setFilters({...filters, targetActorId: e.target.value})}
                                         >
                                             <option value="">Any Node</option>
                                             {actors.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                                         </select>
                                     </div>
                                 </div>
                             </div>
                         )}

                         {reportType === 'AI_INSIGHT' && (
                             <div className="space-y-4">
                                 <div className="bg-purple-900/20 border border-purple-500/30 p-3 rounded text-sm text-purple-200">
                                     <p>Describe what you want to investigate. The AI will analyze relevant logs and generate a report with visualizations.</p>
                                 </div>
                                 <textarea 
                                    className="w-full bg-slate-900 border border-slate-600 rounded p-3 text-white text-sm outline-none h-24 focus:border-purple-500"
                                    placeholder="e.g. Analyze SSH login attempts from Russian IP addresses in the last 24 hours and visualize the timeline."
                                    value={aiPrompt}
                                    onChange={(e) => setAiPrompt(e.target.value)}
                                 />
                                 <button 
                                    onClick={handleGenerateAi}
                                    disabled={isGenerating || !aiPrompt}
                                    className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-2 rounded flex justify-center items-center disabled:opacity-50"
                                 >
                                     {isGenerating ? <Loader className="w-4 h-4 animate-spin mr-2" /> : <Bot className="w-4 h-4 mr-2" />}
                                     {isGenerating ? 'AI Processing...' : 'Generate Analysis'}
                                 </button>
                                 
                                 {aiResult && (
                                     <div className="bg-slate-900 p-3 rounded border border-purple-500/50">
                                         <div className="text-xs font-bold text-purple-400 uppercase mb-1">AI Preview: {aiResult.title}</div>
                                         <div className="text-xs text-slate-400 line-clamp-3">{aiResult.body}</div>
                                     </div>
                                 )}
                             </div>
                         )}

                         {reportType === 'CUSTOM' && (
                             <div>
                                 <label className="block text-slate-400 text-xs font-bold uppercase mb-2">Report Content (Markdown)</label>
                                 <textarea 
                                    className="w-full bg-slate-900 border border-slate-600 rounded p-3 text-white text-sm outline-none h-48 focus:border-slate-500 font-mono"
                                    placeholder="Enter report details..."
                                    value={customBody}
                                    onChange={(e) => setCustomBody(e.target.value)}
                                 />
                             </div>
                         )}
                     </div>

                     <div className="mt-6 pt-4 border-t border-slate-700 flex justify-end">
                         <button 
                            onClick={handleSaveReport}
                            disabled={isGenerating || (reportType === 'AI_INSIGHT' && !aiResult)}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-2 rounded font-bold shadow-lg flex items-center disabled:opacity-50 disabled:cursor-not-allowed"
                         >
                            {isGenerating ? <Loader className="w-4 h-4 animate-spin mr-2"/> : <Save className="w-4 h-4 mr-2"/>}
                            Save to Archive
                         </button>
                     </div>
                 </div>
             </div>
        )}

        {/* Reports Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {reports.map(report => (
                <div key={report.id} onClick={() => setViewReport(report)} className="bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-lg hover:border-blue-500 transition-all cursor-pointer group relative">
                    <div className="flex justify-between items-start mb-4">
                        <div className={`p-3 rounded-lg ${report.type === 'SECURITY_AUDIT' ? 'bg-blue-900/30 text-blue-400' : report.type === 'INCIDENT_LOG' ? 'bg-red-900/30 text-red-400' : report.type === 'AI_INSIGHT' ? 'bg-purple-900/30 text-purple-400' : 'bg-slate-700 text-slate-400'}`}>
                            {report.type === 'SECURITY_AUDIT' ? <ShieldCheck className="w-6 h-6"/> : report.type === 'INCIDENT_LOG' ? <AlertTriangle className="w-6 h-6"/> : report.type === 'AI_INSIGHT' ? <Bot className="w-6 h-6"/> : <FileText className="w-6 h-6"/>}
                        </div>
                        <span className="text-[10px] text-slate-500 font-mono">{new Date(report.createdAt).toLocaleDateString()}</span>
                    </div>
                    <h3 className="text-lg font-bold text-white mb-2 line-clamp-1">{report.title}</h3>
                    <div className="text-xs text-slate-400 mb-4">Generated by <span className="text-slate-300">{report.generatedBy}</span></div>
                    <div className="flex justify-between items-center text-xs text-blue-400 font-bold opacity-0 group-hover:opacity-100 transition-opacity">
                         <span className="flex items-center"><Eye className="w-3 h-3 mr-1"/> View Document</span>
                    </div>
                    
                    <button 
                        onClick={(e) => handleDeleteReport(report.id, e)}
                        className="absolute top-4 right-4 text-slate-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-2"
                        title="Delete Report"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            ))}
            
            {reports.length === 0 && (
                <div className="col-span-full flex flex-col items-center justify-center p-12 bg-slate-800/50 rounded-xl border border-slate-700 border-dashed text-slate-500">
                    <FileText className="w-12 h-12 mb-4 opacity-50" />
                    <p>No reports generated yet.</p>
                </div>
            )}
        </div>

        {/* View Modal */}
        {viewReport && (
            <ReportModal report={viewReport} onClose={() => setViewReport(null)} />
        )}
    </div>
  );
};

export default Reports;
