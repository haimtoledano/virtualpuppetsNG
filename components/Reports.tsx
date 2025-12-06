
import React, { useState, useEffect } from 'react';
import { Report, SystemConfig, User, LogEntry, Actor } from '../types';
import { getReports, generateReport, getSystemConfig } from '../services/dbService';
import { generateCustomAiReport } from '../services/aiService';
import { FileText, Download, Loader, Eye, X, Printer, ShieldCheck, Plus, AlertTriangle, PenTool, Search, Calendar, Server, Filter, Bot } from 'lucide-react';

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

  const ReportModal = ({ report, onClose }: { report: Report, onClose: () => void }) => {
      if (!report.content) return null;
      return (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-white text-slate-900 w-full max-w-4xl h-[85vh] rounded-lg shadow-2xl flex flex-col overflow-hidden">
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
                  <div className="flex-1 overflow-y-auto bg-slate-500 p-8">
                      <div className="bg-white max-w-3xl mx-auto shadow-xl min-h-[800px] p-12 relative">
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
                              <h2 className="text-2xl font-bold text-slate-800 uppercase underline decoration-4 decoration-blue-500 underline-offset-4">{report.title}</h2>
                              <p className="text-slate-500 mt-2 italic">Generated by Officer: {report.generatedBy}</p>
                          </div>

                          {/* DYNAMIC CONTENT BASED ON REPORT TYPE */}
                          
                          {/* 1. AUTO SNAPSHOT STATS */}
                          {report.type === 'SECURITY_AUDIT' && (
                              <div className="grid grid-cols-3 gap-6 mb-10">
                                  <div className="bg-slate-50 p-4 border border-slate-200 text-center">
                                      <div className="text-3xl font-bold text-blue-600">{report.content.totalEvents?.toLocaleString() || 0}</div>
                                      <div className="text-xs uppercase font-bold text-slate-500 mt-1">Total Log Events</div>
                                  </div>
                                  <div className="bg-slate-50 p-4 border border-slate-200 text-center">
                                      <div className="text-3xl font-bold text-red-500">{report.content.compromisedNodes || 0}</div>
                                      <div className="text-xs uppercase font-bold text-slate-500 mt-1">Active Compromises</div>
                                  </div>
                                  <div className="bg-slate-50 p-4 border border-slate-200 text-center">
                                      <div className="text-3xl font-bold text-emerald-600">{report.content.activeNodes || 0}</div>
                                      <div className="text-xs uppercase font-bold text-slate-500 mt-1">Online Agents</div>
                                  </div>
                              </div>
                          )}

                          {/* 2. DATA DRIVEN INCIDENT DETAILS */}
                          {report.type === 'INCIDENT_LOG' && (
                               <div className="bg-red-50 border border-red-100 p-6 mb-8 rounded">
                                   <h3 className="text-red-700 font-bold uppercase mb-4 flex items-center"><AlertTriangle className="w-5 h-5 mr-2" /> Incident Filters Applied</h3>
                                   <div className="grid grid-cols-2 gap-4">
                                       {report.content.incidentFilters?.attackerIp && (
                                           <div>
                                               <div className="text-xs text-red-400 font-bold uppercase">Source IP</div>
                                               <div className="text-slate-800 font-mono">{report.content.incidentFilters.attackerIp}</div>
                                           </div>
                                       )}
                                       {report.content.incidentFilters?.targetActor && (
                                           <div>
                                               <div className="text-xs text-red-400 font-bold uppercase">Target Actor ID</div>
                                               <div className="text-slate-800 font-mono">{report.content.incidentFilters.targetActor}</div>
                                           </div>
                                       )}
                                       {report.content.incidentFilters?.protocol && (
                                            <div>
                                               <div className="text-xs text-red-400 font-bold uppercase">Protocol</div>
                                               <div className="text-slate-800 font-mono">{report.content.incidentFilters.protocol}</div>
                                           </div>
                                       )}
                                       {report.content.incidentDetails?.eventCount !== undefined && (
                                            <div>
                                               <div className="text-xs text-red-400 font-bold uppercase">Matching Events</div>
                                               <div className="text-slate-800 font-mono text-xl">{report.content.incidentDetails.eventCount}</div>
                                           </div>
                                       )}
                                   </div>
                               </div>
                          )}

                          {/* 3. BODY TEXT (Summary or Custom/AI) */}
                          <div className="mb-8">
                              <h3 className="text-sm font-bold uppercase border-b border-slate-300 mb-2 pb-1">
                                  {report.type === 'CUSTOM' ? 'Analyst Notes' : report.type === 'AI_INSIGHT' ? 'AI Assessment' : 'Executive Summary'}
                              </h3>
                              <div className="text-sm leading-relaxed text-slate-700 text-justify whitespace-pre-wrap font-serif">
                                  {report.content.customBody || report.content.summaryText}
                              </div>
                          </div>

                          {/* 4. TOP ATTACKERS (Only for Audit) */}
                          {report.type === 'SECURITY_AUDIT' && report.content.topAttackers && (
                              <div className="mb-8">
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
                          <div className="absolute bottom-8 left-12 right-12 border-t border-slate-200 pt-4 flex justify-between items-center text-xs text-slate-400">
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
                 <div className="bg-slate-800 border border-slate-600 rounded-xl w-full max-w-xl shadow-2xl p-6 overflow-hidden">
                     <div className="flex justify-between items-center mb-6">
                         <h3 className="text-xl font-bold text-white flex items-center"><PenTool className="w-5 h-5 mr-2 text-blue-400" /> Generate Report</h3>
                         <button onClick={() => setIsCreatorOpen(false)}><X className="w-5 h-5 text-slate-500 hover:text-white"/></button>
                     </div>
                     
                     <div className="space-y-4">
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
                                             value={filters.dateRange} onChange={e => setFilters({...filters, dateRange: e.target.value})}>
                                             <option value="LAST_24H">Last 24 Hours</option>
                                             <option value="LAST_7D">Last 7 Days</option>
                                             <option value="LAST_30D">Last 30 Days</option>
                                         </select>
                                     </div>
                                     <div>
                                         <label className="text-xs text-slate-500 block mb-1">Target Actor (Victim)</label>
                                         <select className="w-full bg-slate-800 border border-slate-600 rounded p-2 text-white text-xs outline-none"
                                              value={filters.targetActorId} onChange={e => setFilters({...filters, targetActorId: e.target.value})}>
                                             <option value="">-- All Actors --</option>
                                             {actors.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                                         </select>
                                     </div>
                                     <div>
                                         <label className="text-xs text-slate-500 block mb-1">Attacker IP</label>
                                         <select className="w-full bg-slate-800 border border-slate-600 rounded p-2 text-white text-xs outline-none"
                                              value={filters.attackerIp} onChange={e => setFilters({...filters, attackerIp: e.target.value})}>
                                             <option value="">-- All IPs --</option>
                                             {availableAttackers.map(ip => <option key={ip} value={ip}>{ip}</option>)}
                                         </select>
                                     </div>
                                     <div>
                                         <label className="text-xs text-slate-500 block mb-1">Protocol / Service</label>
                                         <select className="w-full bg-slate-800 border border-slate-600 rounded p-2 text-white text-xs outline-none"
                                              value={filters.protocol} onChange={e => setFilters({...filters, protocol: e.target.value})}>
                                             <option value="">-- All Protocols --</option>
                                             {availableProtocols.map(p => <option key={p} value={p}>{p}</option>)}
                                         </select>
                                     </div>
                                 </div>
                             </div>
                         )}

                         {reportType === 'AI_INSIGHT' && (
                             <div className="space-y-3">
                                 {!aiResult ? (
                                    <>
                                        <div>
                                            <label className="block text-slate-400 text-xs font-bold uppercase mb-2">Natural Language Prompt</label>
                                            <textarea 
                                                className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-white text-sm h-32 focus:border-purple-500 outline-none placeholder-slate-600"
                                                placeholder="E.g., 'Summarize all SSH brute force attempts from China last week and suggest mitigations.'"
                                                value={aiPrompt}
                                                onChange={e => setAiPrompt(e.target.value)}
                                            />
                                        </div>
                                        <button 
                                            onClick={handleGenerateAi}
                                            disabled={isGenerating || !aiPrompt}
                                            className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-2 rounded flex justify-center items-center"
                                        >
                                            {isGenerating ? <Loader className="animate-spin w-4 h-4 mr-2" /> : <Bot className="w-4 h-4 mr-2" />}
                                            GENERATE INSIGHT
                                        </button>
                                    </>
                                 ) : (
                                     <div className="bg-slate-900 border border-purple-500/50 rounded p-4 max-h-[300px] overflow-y-auto">
                                         <div className="flex justify-between items-center mb-2">
                                            <h4 className="text-purple-400 font-bold text-sm">{aiResult.title}</h4>
                                            <button onClick={() => setAiResult(null)} className="text-xs text-slate-500 hover:text-white">Reset</button>
                                         </div>
                                         <p className="text-slate-300 text-xs whitespace-pre-wrap">{aiResult.body}</p>
                                     </div>
                                 )}
                             </div>
                         )}

                         {reportType === 'CUSTOM' && (
                             <div>
                                 <label className="block text-slate-400 text-xs font-bold uppercase mb-2">Report Content</label>
                                 <textarea 
                                     className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-white text-sm h-40 focus:border-blue-500 outline-none"
                                     placeholder="Type your manual analysis here..."
                                     value={customBody}
                                     onChange={e => setCustomBody(e.target.value)}
                                 />
                             </div>
                         )}

                         <button 
                            onClick={handleSaveReport}
                            disabled={isGenerating || (reportType === 'AI_INSIGHT' && !aiResult)}
                            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-lg flex justify-center items-center mt-4"
                         >
                            {isGenerating ? <Loader className="animate-spin w-5 h-5" /> : 'SAVE REPORT TO ARCHIVE'}
                         </button>
                     </div>
                 </div>
             </div>
        )}

        {/* Reports Table */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden shadow-lg">
             <table className="w-full text-left text-sm">
                <thead className="bg-slate-900 text-slate-400">
                    <tr>
                        <th className="p-4 font-bold uppercase text-xs">Report Name</th>
                        <th className="p-4 font-bold uppercase text-xs">Type</th>
                        <th className="p-4 font-bold uppercase text-xs">Generated By</th>
                        <th className="p-4 font-bold uppercase text-xs">Created</th>
                        <th className="p-4 font-bold uppercase text-xs text-right">Actions</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                    {reports.length === 0 ? (
                        <tr>
                            <td colSpan={5} className="p-8 text-center text-slate-500">No reports generated yet.</td>
                        </tr>
                    ) : (
                        reports.map(report => (
                            <tr key={report.id} className="hover:bg-slate-700/30 transition-colors">
                                <td className="p-4 font-medium text-white flex items-center">
                                    <FileText className="w-4 h-4 mr-2 text-slate-400" />
                                    {report.title}
                                </td>
                                <td className="p-4">
                                    <span className={`px-2 py-1 rounded text-[10px] font-bold ${
                                        report.type === 'SECURITY_AUDIT' ? 'bg-blue-500/20 text-blue-400' :
                                        report.type === 'INCIDENT_LOG' ? 'bg-red-500/20 text-red-400' :
                                        report.type === 'AI_INSIGHT' ? 'bg-purple-500/20 text-purple-400' :
                                        'bg-slate-500/20 text-slate-400'
                                    }`}>
                                        {report.type.replace('_', ' ')}
                                    </span>
                                </td>
                                <td className="p-4 text-slate-300">{report.generatedBy}</td>
                                <td className="p-4 text-slate-500">{new Date(report.createdAt).toLocaleString()}</td>
                                <td className="p-4 text-right">
                                    <button 
                                        onClick={() => setViewReport(report)}
                                        className="text-blue-400 hover:text-white transition-colors flex items-center justify-end w-full"
                                    >
                                        <Eye className="w-4 h-4 mr-1" /> View
                                    </button>
                                </td>
                            </tr>
                        ))
                    )}
                </tbody>
            </table>
        </div>

        {viewReport && <ReportModal report={viewReport} onClose={() => setViewReport(null)} />}
    </div>
  );
};

export default Reports;
