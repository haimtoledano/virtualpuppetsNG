import { GoogleGenAI, Type } from "@google/genai";
import { LogEntry, AiAnalysis, HoneyFile } from '../types';

const getAiClient = () => {
  // Safely check for process.env to avoid ReferenceError in pure browser environments
  let apiKey;
  try {
    apiKey = process.env.API_KEY;
  } catch (e) {
    // process is not defined
    return null;
  }
  
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey });
};

export const analyzeLogsWithGemini = async (logs: LogEntry[]): Promise<AiAnalysis | null> => {
  const ai = getAiClient();
  if (!ai) return null;

  // Filter for interesting logs to save tokens
  const interestingLogs = logs
    .filter(l => l.level !== 'INFO')
    .slice(0, 50)
    .map(l => `[${l.timestamp.toISOString()}] ${l.process}: ${l.message} (Source: ${l.sourceIp || 'N/A'})`)
    .join('\n');

  if (!interestingLogs) return {
    summary: "No significant threats detected in the current log batch.",
    threatLevel: 'LOW',
    recommendedActions: ["Continue monitoring."]
  };

  const prompt = `
    Act as a Cyber Security Analyst for a Honeypot system called 'Virtual Puppets'.
    Analyze the following syslog lines collected from Raspberry Pi honeypots.
    
    Logs:
    ${interestingLogs}

    Provide a JSON response summarizing the threats.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
            type: Type.OBJECT,
            properties: {
                summary: { type: Type.STRING },
                threatLevel: { type: Type.STRING, enum: ['LOW', 'MEDIUM', 'HIGH'] },
                recommendedActions: { 
                    type: Type.ARRAY,
                    items: { type: Type.STRING }
                }
            }
        }
      }
    });

    return JSON.parse(response.text);
  } catch (error) {
    console.error("Gemini analysis failed:", error);
    return null;
  }
};

export const generateDeceptionContent = async (type: 'CREDENTIALS' | 'CONFIG'): Promise<HoneyFile | null> => {
    const ai = getAiClient();
    if (!ai) return null;
  
    const prompt = type === 'CREDENTIALS' 
      ? "Generate a realistic looking 'users.csv' or '.env' file content with fake usernames and passwords that look like valid database credentials. Include comments."
      : "Generate a realistic 'nginx.conf' or 'config.json' file that contains a fake 'admin_port' or 'secret_key' vulnerability.";
  
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
              type: Type.OBJECT,
              properties: {
                  filename: { type: Type.STRING },
                  path: { type: Type.STRING },
                  content: { type: Type.STRING }
              }
          }
        }
      });
  
      const data = JSON.parse(response.text);
      return {
          filename: data.filename,
          path: data.path,
          type: type,
          contentPreview: data.content,
          createdAt: new Date()
      };
    } catch (error) {
      console.error("Gemini deception generation failed:", error);
      // Fallback if AI fails or no key
      return {
          filename: 'secret_backup.sql',
          path: '/var/backups/',
          type: 'CREDENTIALS',
          contentPreview: 'INSERT INTO users (user, pass) VALUES ("admin", "P@ssw0rd123!");',
          createdAt: new Date()
      };
    }
  };