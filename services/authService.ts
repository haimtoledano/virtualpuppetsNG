import { User } from '../types';
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

export const setupMfa = async (userId: string): Promise<{ secret: string; qrCode: string }> => {
    const res = await fetch(`${API_BASE}/mfa/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
    });
    const data = await res.json();
    return { secret: data.secret, qrCode: data.qrCode };
};

export const verifyMfaCode = async (userId: string, code: string): Promise<boolean> => {
    const res = await fetch(`${API_BASE}/mfa/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, token: code })
    });
    
    if (!res.ok) return false;

    const data = await res.json();
    return data.success;
};

export const commitMfaSetup = async (user: User, secret: string, token: string): Promise<boolean> => {
    // Note: We now pass the Token (code) to the confirm endpoint to verify before saving
    // This MUST go to /mfa/confirm, NOT /mfa/verify
    try {
        const res = await fetch(`${API_BASE}/mfa/confirm`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: user.id, secret, token })
        });
        
        if (!res.ok) return false;
        
        const data = await res.json();
        return data.success;
    } catch (e) {
        return false;
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