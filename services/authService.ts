import { User, UserPreferences } from '../types';
import { checkDbExists } from './dbService';

const API_BASE = '/api';

export const hashPassword = (pass: string) => `btoa_hash_${pass}`;

export const loginUser = async (username: string, password: string): Promise<{ success: boolean; user?: User; error?: string }> => {
  try {
      const isDbReady = await checkDbExists();
      if (!isDbReady) {
          // Allow bootstrapping if DB is not connected/provisioned
          if (username === 'superadmin' && password === '123qweASDF!!@!') {
              return {
                  success: true,
                  user: { id: 'temp-setup', username: 'superadmin', role: 'SUPERADMIN', mfaEnabled: false, passwordHash: '' }
              };
          }
          return { success: false, error: "System Offline. Login via local console to configure." };
      }

      const res = await fetch(`${API_BASE}/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
      });

      const data = await res.json();
      if (!data.success) {
          return { success: false, error: data.error || "Login Failed" };
      }
      return { success: true, user: data.user };

  } catch (e) {
      return { success: false, error: "Network Error" };
  }
};

export const saveUserPreferences = async (userId: string, preferences: UserPreferences): Promise<boolean> => {
    try {
        const res = await fetch(`${API_BASE}/users/${userId}/preferences`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(preferences)
        });
        const data = await res.json();
        return data.success;
    } catch (e) {
        return false;
    }
};

export const setupMfa = async (userId: string): Promise<{ secret: string; qrCode: string }> => {
    try {
        const res = await fetch(`${API_BASE}/mfa/setup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId })
        });
        if (!res.ok) throw new Error("API Error");
        const data = await res.json();
        return { secret: data.secret, qrCode: data.qrCode };
    } catch (e) {
        console.warn("MFA API unreachable. Using Mock MFA.");
        // Fallback Mock Data
        return { 
            secret: 'MOCKSECRET12345', 
            qrCode: 'https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=otpauth://totp/VirtualPuppets:mockuser?secret=MOCKSECRET12345&issuer=VirtualPuppets' 
        };
    }
};

export const verifyMfaCode = async (userId: string, code: string): Promise<boolean> => {
    try {
        const res = await fetch(`${API_BASE}/mfa/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, token: code })
        });
        
        if (!res.ok) throw new Error("API Error");

        const data = await res.json();
        return data.success;
    } catch (e) {
        // Mock fallback for "000000"
        return code === '000000';
    }
};

export const commitMfaSetup = async (user: User, secret: string, token: string): Promise<boolean> => {
    try {
        const res = await fetch(`${API_BASE}/mfa/confirm`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: user.id, secret, token })
        });
        
        if (!res.ok) throw new Error("API Error");
        
        const data = await res.json();
        return data.success;
    } catch (e) {
        // Mock fallback for "000000"
        return token === '000000';
    }
};

export const createUser = async (newUser: User) => {
    await fetch(`${API_BASE}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newUser)
    });
};

export const updateUser = async (user: User) => {
    await fetch(`${API_BASE}/users/${user.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(user)
    });
};

export const deleteUser = async (userId: string) => {
    await fetch(`${API_BASE}/users/${userId}`, { method: 'DELETE' });
};

export const resetUserMfa = async (userId: string) => {
    await fetch(`${API_BASE}/users/${userId}/reset-mfa`, { method: 'POST' });
};