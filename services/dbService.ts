




import { Actor, ProxyGateway, User, DbConfig, LogEntry, SystemConfig, Report, CommandJob, PendingActor, DevicePersona, WifiNetwork, BluetoothDevice } from '../types';

const API_BASE = '/api';

export const connectToDatabase = async (config: DbConfig): Promise<boolean> => {
    const res = await fetch(`${API_BASE}/setup/db`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    return true;
};

export const runProvisioningScript = async (sysConfig?: SystemConfig) => {
    // In the real server implementation, provisioning happens automatically on connect
    // or we can trigger the config save here
    if (sysConfig) {
        await fetch(`${API_BASE}/config/system`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sysConfig)
        });
    }
    return true;
};

export const updateSystemConfig = async (sysConfig: SystemConfig) => {
    const res = await fetch(`${API_BASE}/config/system`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sysConfig)
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    return true;
};

export const getSystemConfig = async (): Promise<SystemConfig | null> => {
    try {
        const res = await fetch(`${API_BASE}/config/system`);
        if (res.status !== 200) return null;
        return await res.json();
    } catch { return null; }
};

export const dbQuery = async <T>(table: string): Promise<T> => {
    try {
        const res = await fetch(`${API_BASE}/${table}`);
        if (!res.ok) return [] as any;
        return await res.json();
    } catch (e) {
        console.error("DB Query Error", e);
        return [] as any;
    }
};

export const dbUpdate = async (table: string, data: any) => {
    await fetch(`${API_BASE}/${table}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
};

// --- NEW: Audit Logging ---
export const sendAuditLog = async (username: string, action: string, details: string) => {
    try {
        // Fire and forget, don't await response to avoid UI blocking
        fetch(`${API_BASE}/audit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, action, details })
        });
    } catch (e) {
        console.error("Failed to send audit log", e);
    }
};

export const updateActorName = async (id: string, name: string) => {
    await fetch(`${API_BASE}/actors/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
    });
};

// --- NEW: Reset Actor Status (Acknowledge Alert) ---
export const resetActorStatus = async (id: string) => {
    await fetch(`${API_BASE}/actors/${id}/acknowledge`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' }
    });
};

// --- NEW: Factory Reset Actor ---
export const resetActorToFactory = async (id: string) => {
    // 1. Reset Status to ONLINE
    await resetActorStatus(id);
    // 2. Clear Tunnels
    await updateActorTunnels(id, []);
    // 3. Clear HoneyFiles
    await updateActorHoneyFiles(id, []);
    // 4. Send Command to Agent to clear local state
    await queueSystemCommand(id, 'vpp-agent --factory-reset');
    
    // Note: Persona is NOT reset automatically to keep the "mask" consistent, 
    // unless explicitly desired. If needed: await updateActorPersona(id, DEFAULT_PERSONA);
};

// --- NEW: Fleet Update ---
export const triggerFleetUpdate = async (actors: Actor[]) => {
    const onlineActors = actors.filter(a => a.status === 'ONLINE' || a.status === 'COMPROMISED');
    
    // Batch queue commands
    const promises = onlineActors.map(actor => {
        return queueSystemCommand(actor.id, 'vpp-agent --update --version=2.0.0');
    });
    
    await Promise.all(promises);
};

// --- NEW: Update Actor Tunnels Persistence ---
export const updateActorTunnels = async (actorId: string, tunnels: any[]) => {
    await fetch(`${API_BASE}/actors/${actorId}/tunnels`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tunnels)
    });
};

// --- NEW: Update Actor HoneyFiles Persistence ---
export const updateActorHoneyFiles = async (actorId: string, files: any[]) => {
    await fetch(`${API_BASE}/actors/${actorId}/honeyfiles`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(files)
    });
};

// --- NEW: Update Actor Persona Persistence ---
export const updateActorPersona = async (actorId: string, persona: DevicePersona) => {
    await fetch(`${API_BASE}/actors/${actorId}/persona`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(persona)
    });
};

export const deleteActor = async (id: string) => {
    await fetch(`${API_BASE}/actors/${id}`, {
        method: 'DELETE'
    });
};

export const registerGateway = async (gateway: ProxyGateway) => {
    await fetch(`${API_BASE}/gateways`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(gateway)
    });
};

// NEW: Delete Gateway
export const deleteGateway = async (id: string) => {
    await fetch(`${API_BASE}/gateways/${id}`, {
        method: 'DELETE'
    });
};

// --- NEW: Enrollment Token Generation via API ---
export const generateEnrollmentToken = async (type: 'ACTOR' | 'SITE', targetId: string, config?: any): Promise<string> => {
    try {
        const res = await fetch(`${API_BASE}/enroll/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, targetId, config })
        });
        const data = await res.json();
        return data.token;
    } catch (e) {
        console.error("Token generation failed", e);
        return "ERROR_TOKEN";
    }
};

// Fetch Pending Actors (Production Mode)
export const getPendingActors = async (): Promise<PendingActor[]> => {
    try {
        const res = await fetch(`${API_BASE}/enroll/pending`);
        if (!res.ok) return [];
        const data = await res.json();
        // Convert string dates to Date objects
        return data.map((d: any) => ({
            ...d,
            detectedAt: new Date(d.detectedAt)
        }));
    } catch (e) {
        console.error("Failed to fetch pending actors", e);
        return [];
    }
};

// --- NEW: Approve Pending Actor ---
export const approvePendingActor = async (pendingId: string, proxyId: string, name: string): Promise<boolean> => {
    try {
        const res = await fetch(`${API_BASE}/enroll/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pendingId, proxyId, name })
        });
        const data = await res.json();
        return data.success;
    } catch (e) {
        console.error("Approval failed", e);
        return false;
    }
};

// --- NEW: Reject Pending Actor ---
export const rejectPendingActor = async (pendingId: string): Promise<boolean> => {
    try {
        const res = await fetch(`${API_BASE}/enroll/pending/${pendingId}`, {
            method: 'DELETE'
        });
        const data = await res.json();
        return data.success;
    } catch (e) {
        console.error("Rejection failed", e);
        return false;
    }
};

export const checkDbExists = async (): Promise<boolean> => {
    try {
        const res = await fetch(`${API_BASE}/health`);
        const data = await res.json();
        return data.dbConnected;
    } catch { return false; }
};

export const saveDbConfig = (config: DbConfig) => {
    // Only used for UI state in this version, actual config saved on server via API
};

export const getDbConfig = (): DbConfig | null => {
    // Placeholder - real config is on server
    return null;
}

export const generateProductionSql = (dbConfig: DbConfig, sysConfig: SystemConfig) => {
    return `-- SQL Generation handled by Server Side Migration`;
};

// REPORTS

export const getReports = async (): Promise<Report[]> => {
    try {
        const res = await fetch(`${API_BASE}/reports`);
        if(!res.ok) return [];
        return await res.json();
    } catch { return []; }
};

// Updated signature to handle custom data
export const generateReport = async (payload: any): Promise<boolean> => {
    try {
        await fetch(`${API_BASE}/reports/generate`, {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify(payload)
        });
        return true;
    } catch { return false; }
}

export const deleteReport = async (id: string): Promise<boolean> => {
    try {
        await fetch(`${API_BASE}/reports/${id}`, { method: 'DELETE' });
        return true;
    } catch { return false; }
};

// --- Remote Commands ---

export const queueSystemCommand = async (actorId: string, command: string): Promise<string | null> => {
    try {
        const res = await fetch(`${API_BASE}/commands/queue`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actorId, command })
        });
        const data = await res.json();
        return data.jobId;
    } catch (e) {
        console.error("Failed to queue command", e);
        return null;
    }
};

export const getActorCommands = async (actorId: string): Promise<CommandJob[]> => {
    try {
        const res = await fetch(`${API_BASE}/commands/${actorId}`);
        if (!res.ok) return [];
        return await res.json();
    } catch { return []; }
};

// --- NEW: FETCH SYSTEM LOGS ---
export const getSystemLogs = async (): Promise<LogEntry[]> => {
    try {
        const res = await fetch(`${API_BASE}/logs`);
        if (!res.ok) return [];
        const logs = await res.json();
        // Normalize
        return logs.map((l: any) => ({
            id: l.id,
            timestamp: new Date(l.timestamp),
            actorId: l.actorId,
            actorName: l.actorName,
            level: l.level,
            process: l.process,
            message: l.message,
            sourceIp: l.sourceIp,
            proxyId: '' // Not always available in logs
        }));
    } catch (e) {
        console.error("Failed to fetch system logs", e);
        return [];
    }
}

// --- NEW: Wireless Recon API ---

export const getWifiNetworks = async (): Promise<WifiNetwork[]> => {
    try {
        const res = await fetch(`${API_BASE}/recon/wifi`);
        if (!res.ok) return [];
        const data = await res.json();
        return data.map((d: any) => ({
            ...d,
            lastSeen: new Date(d.lastSeen)
        }));
    } catch { return []; }
};

export const getBluetoothDevices = async (): Promise<BluetoothDevice[]> => {
     try {
        const res = await fetch(`${API_BASE}/recon/bluetooth`);
        if (!res.ok) return [];
        const data = await res.json();
        return data.map((d: any) => ({
            ...d,
            lastSeen: new Date(d.lastSeen)
        }));
    } catch { return []; }
};
