import { GoogleGenAI, Type } from "@google/genai";
import { LogEntry, AiAnalysis, HoneyFile, AiConfig, AiProvider } from '../types';

// Default configuration if nothing is set
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const DEFAULT_LOCAL_ENDPOINT = 'http://localhost:11434/v1/chat/completions';

const getAiConfig = async (): Promise<AiConfig> => {
    // In a real app, pass this config from the component or fetch from state manager.
    // For this implementation, we will fetch it from the API to ensure fresh config.
    try {
        const res = await fetch('/api/config/system');
        if (res.ok) {
            const sys = await res.json();
            return sys.aiConfig || { provider: 'GEMINI', modelName: DEFAULT_GEMINI_MODEL };
        }
    } catch (e) {
        console.warn("Failed to fetch AI config, using defaults");
    }
    // Fallback
    return { provider: 'GEMINI', modelName: DEFAULT_GEMINI_MODEL };
};

// --- GEMINI IMPLEMENTATION ---

const callGemini = async (config: AiConfig, prompt: string, responseSchema?: any): Promise<any> => {
    let apiKey;
    
    // 1. Try Environment Variable (Preferred per guidelines)
    try {
        apiKey = process.env.API_KEY;
    } catch (e) {
        // process is likely not defined in this environment
    }

    // 2. Fallback to User Configured Key (if Env is missing)
    if (!apiKey && config.apiKey) {
        apiKey = config.apiKey;
    }

    // 3. Final Safety Check
    if (!apiKey) {
        console.warn("Gemini API Key is missing (Env & Config). AI features are disabled.");
        return null;
    }

    try {
        const ai = new GoogleGenAI({ apiKey });
        const geminiConfig: any = { responseMimeType: "application/json" };
        if (responseSchema) {
            geminiConfig.responseSchema = responseSchema;
        }

        const response = await ai.models.generateContent({
            model: config.modelName || DEFAULT_GEMINI_MODEL,
            contents: prompt,
            config: geminiConfig
        });
        return JSON.parse(response.text);
    } catch (error) {
        console.error("Gemini call failed:", error);
        return null;
    }
};

// --- LOCAL IMPLEMENTATION (OpenAI Compatible) ---

const callLocalLLM = async (config: AiConfig, prompt: string, schemaDescription: string): Promise<any> => {
    const endpoint = config.endpoint || DEFAULT_LOCAL_ENDPOINT;
    const model = config.modelName || 'llama3';
    
    // For local LLMs, we append instructions to force JSON since they might not support native schema constraints
    const fullPrompt = `${prompt}\n\nIMPORTANT: Return ONLY valid JSON matching this structure: ${schemaDescription}. Do not include markdown code blocks.`;

    try {
        const headers: any = { 'Content-Type': 'application/json' };
        if (config.authToken) {
            headers['Authorization'] = `Bearer ${config.authToken}`;
        }

        const res = await fetch(endpoint, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                model: model,
                messages: [{ role: "user", content: fullPrompt }],
                temperature: 0.2,
                stream: false
            })
        });

        if (!res.ok) {
            console.error("Local AI Error:", res.status, res.statusText);
            return null;
        }

        const data = await res.json();
        const content = data.choices?.[0]?.message?.content;
        
        if (!content) return null;

        // Clean markdown if present
        const cleanJson = content.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanJson);

    } catch (error) {
        console.error("Local LLM call failed:", error);
        return null;
    }
};

// --- FALLBACK HEURISTIC ANALYSIS ---
const performHeuristicAnalysis = (logs: LogEntry[]): AiAnalysis => {
    const errorCount = logs.filter(l => l.level === 'ERROR' || l.level === 'CRITICAL').length;
    const warningCount = logs.filter(l => l.level === 'WARNING').length;
    const uniqueIPs = new Set(logs.map(l => l.sourceIp).filter(Boolean)).size;

    let threatLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
    if (errorCount > 0) threatLevel = 'MEDIUM';
    if (errorCount > 5 || uniqueIPs > 3) threatLevel = 'HIGH';

    return {
        summary: `[OFFLINE MODE] AI service unavailable. Local heuristic analysis detected ${errorCount} critical events and ${warningCount} warnings from ${uniqueIPs} unique sources. Configure API Key in Settings for full insights.`,
        threatLevel,
        recommendedActions: [
            "Check firewall logs for repeated connection attempts.",
            "Verify integrity of core system files.",
            "Ensure API Key is configured correctly in Settings > AI Integration."
        ]
    };
};

// --- PUBLIC FACING FUNCTIONS ---

export const testAiConnection = async (config: AiConfig): Promise<{success: boolean, message?: string}> => {
    const prompt = "Reply with a JSON object containing the property 'status' set to 'OK' to verify connectivity.";
    const geminiSchema = {
        type: Type.OBJECT,
        properties: { status: { type: Type.STRING } }
    };
    const localSchemaDesc = "{ status: 'OK' }";

    try {
        let result;
        if (config.provider === 'GEMINI') {
            result = await callGemini(config, prompt, geminiSchema);
        } else {
            result = await callLocalLLM(config, prompt, localSchemaDesc);
        }
        
        if (result && result.status) return { success: true };
        return { success: false, message: "No valid response from model." };
    } catch (e: any) {
        return { success: false, message: e.message || "Connection failed." };
    }
};

export const analyzeLogsWithAi = async (logs: LogEntry[], actorStatus?: string): Promise<AiAnalysis | null> => {
    const config = await getAiConfig();

    // Filter logs - Include INFO logs (often command output) and take the MOST RECENT 50
    const interestingLogs = logs
        .slice(-50) // Take last 50 logs to be relevant (most recent)
        .map(l => `[${new Date(l.timestamp).toLocaleTimeString()}] [${l.level}] ${l.process}: ${l.message} ${l.sourceIp ? `(Source: ${l.sourceIp})` : ''}`)
        .join('\n');

    let prompt = `
      Act as a Cyber Security Analyst. Analyze these honeypot logs from a Linux endpoint:
      ${interestingLogs}
      
      Provide a JSON response summarizing threats. Look for patterns in command output, failed logins, or traffic redirection.
    `;

    // CRITICAL UPDATE: Modified to allow for verification instead of forced bias
    if (actorStatus === 'COMPROMISED') {
        prompt += `\n\nCONTEXT: This node is currently flagged as COMPROMISED by the internal IDS.
        Please analyze the logs to independently VERIFY this claim.
        - If you see malicious activity (brute force, tunnels, unauthorized commands), confirm the HIGH threat level.
        - If the logs appear benign or empty of threats, treat the IDS flag as a potential FALSE POSITIVE and rate the threat level accordingly (LOW or MEDIUM).`;
    }

    if (!interestingLogs && actorStatus !== 'COMPROMISED') {
         // Even if logs are empty, return a low threat structure rather than null to update UI
         return {
            summary: "No significant threats detected in the current log batch.",
            threatLevel: 'LOW',
            recommendedActions: ["Continue monitoring."]
        };
    }

    // Gemini Schema
    const geminiSchema = {
        type: Type.OBJECT,
        properties: {
            summary: { type: Type.STRING },
            threatLevel: { type: Type.STRING, enum: ['LOW', 'MEDIUM', 'HIGH'] },
            recommendedActions: { type: Type.ARRAY, items: { type: Type.STRING } }
        }
    };
    // Local Schema Description
    const localSchemaDesc = "{ summary: string, threatLevel: 'LOW'|'MEDIUM'|'HIGH', recommendedActions: string[] }";

    let result;
    if (config.provider === 'GEMINI') {
        result = await callGemini(config, prompt, geminiSchema);
    } else {
        result = await callLocalLLM(config, prompt, localSchemaDesc);
    }

    if (result) {
        return {
            summary: result.summary || "No summary provided by AI.",
            threatLevel: result.threatLevel || 'LOW',
            recommendedActions: Array.isArray(result.recommendedActions) ? result.recommendedActions : []
        };
    }

    // FALLBACK: If AI fails (e.g. No API Key or 404), return Heuristic Analysis
    console.warn("AI Analysis failed. Using heuristic fallback.");
    return performHeuristicAnalysis(logs);
};

// NEW: Generate Report based on User Free Text
export const generateCustomAiReport = async (userPrompt: string, logs: LogEntry[]): Promise<{ reportTitle: string, reportBody: string } | null> => {
    const config = await getAiConfig();

    // Prepare context
    const logContext = logs.slice(0, 100).map(l => 
        `${new Date(l.timestamp).toISOString()} | ${l.actorName} | ${l.sourceIp || 'N/A'} | ${l.process}: ${l.message}`
    ).join('\n');

    const prompt = `
        You are an advanced Cyber Security Reporting Engine. 
        
        USER REQUEST: "${userPrompt}"

        AVAILABLE SYSTEM LOG DATA:
        ${logContext}

        INSTRUCTIONS:
        1. Analyze the logs based specifically on the User Request.
        2. Generate a professional report title.
        3. Generate a detailed report body.
        4. Cite specific log entries if relevant.
        5. INFOGRAPHICS REQUEST: Please include a MERMAID.JS diagram syntax code block in the 'reportBody' to visualize the data.
           - If it is a timeline, use a sequence diagram.
           - If it is stats, use a pie chart.
           - Example:
             \`\`\`mermaid
             pie title Attack Source Distribution
             "China" : 40
             "Russia" : 20
             "US" : 40
             \`\`\`
        
        Return JSON format.
    `;

    const geminiSchema = {
        type: Type.OBJECT,
        properties: {
            reportTitle: { type: Type.STRING },
            reportBody: { type: Type.STRING }
        }
    };
    const localSchemaDesc = "{ reportTitle: string, reportBody: string }";

    let result;
    if (config.provider === 'GEMINI') {
        result = await callGemini(config, prompt, geminiSchema);
    } else {
        result = await callLocalLLM(config, prompt, localSchemaDesc);
    }

    // Fallback if AI fails for Reports
    if (!result) {
        return {
             reportTitle: "AI Service Unavailable",
             reportBody: "Unable to generate AI report. Please check API Key configuration in Settings."
        };
    }

    return result;
};

export const generateDeceptionContent = async (type: 'CREDENTIALS' | 'CONFIG'): Promise<HoneyFile | null> => {
    const config = await getAiConfig();

    const prompt = type === 'CREDENTIALS' 
      ? "Generate a realistic 'users.csv' or '.env' file content with fake usernames/passwords."
      : "Generate a realistic 'nginx.conf' or 'config.json' file with a fake vulnerability.";

    const geminiSchema = {
        type: Type.OBJECT,
        properties: {
            filename: { type: Type.STRING },
            path: { type: Type.STRING },
            content: { type: Type.STRING }
        }
    };
    const localSchemaDesc = "{ filename: string, path: string, content: string }";

    let result;
    if (config.provider === 'GEMINI') {
        result = await callGemini(config, prompt, geminiSchema);
    } else {
        result = await callLocalLLM(config, prompt, localSchemaDesc);
    }

    if (result) {
        return {
            filename: result.filename,
            path: result.path,
            type: type,
            contentPreview: result.content,
            createdAt: new Date()
        };
    }
    
    // Fallback
    return {
        filename: 'secret_fallback.sql',
        path: '/tmp/',
        type: type,
        contentPreview: 'admin=root123',
        createdAt: new Date()
    };
};