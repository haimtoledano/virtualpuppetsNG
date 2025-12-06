
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
        console.error("Failed to fetch AI config", e);
    }
    // Fallback
    return { provider: 'GEMINI', modelName: DEFAULT_GEMINI_MODEL };
};

// --- GEMINI IMPLEMENTATION ---

const callGemini = async (config: AiConfig, prompt: string, responseSchema?: any): Promise<any> => {
    // PRIORITY: Use Config Key first (Manual Override), then Environment Variable
    // This allows users to input their own key in Settings to override the server env var
    const apiKey = config.apiKey || process.env.API_KEY;
    
    if (!apiKey) {
        console.error("Gemini API Key missing in Settings OR environment variables (process.env.API_KEY)");
        return null;
    }
    const ai = new GoogleGenAI({ apiKey });
    
    try {
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

// --- PUBLIC FACING FUNCTIONS ---

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

    if (!interestingLogs && actorStatus !== 'COMPROMISED') return {
        summary: "No significant threats detected in the current log batch.",
        threatLevel: 'LOW',
        recommendedActions: ["Continue monitoring."]
    };

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

    // Normalize result to ensure array exists (Prevents undefined map crash)
    if (result) {
        return {
            summary: result.summary || "No summary provided by AI.",
            threatLevel: result.threatLevel || 'LOW',
            recommendedActions: Array.isArray(result.recommendedActions) ? result.recommendedActions : []
        };
    }
    return null;
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
