/**
 * src/utils/cursor-agent-session-cache.js
 *
 * Persistent session storage for cursor-agent chat IDs
 * Stores chat IDs by context for long-term session reuse (weeks/months)
 * Sessions are only invalidated when cursor-agent fails to resume them
 */

import { log } from '../../scripts/modules/utils.js';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Simple global storage: contextKey -> { chatId, createdAt, lastUsedAt, resumeAttempts }
const sessionStorage = new Map();

// Configuration
let config = {
    enabled: true,
    maxSessions: 50, // Increased since we're not expiring by time
    maxResumeAttempts: 3, // Max failed resume attempts before invalidation
    persistToDisk: true // Persist sessions across restarts
};

// File path for persistent storage
const STORAGE_FILE = path.join(os.homedir(), '.cursor-agent-sessions.json');

/**
 * Load sessions from persistent storage on startup
 */
function loadSessionsFromDisk() {
    if (!config.persistToDisk) {
        return;
    }

    try {
        if (fs.existsSync(STORAGE_FILE)) {
            const data = fs.readFileSync(STORAGE_FILE, 'utf8');
            const sessions = JSON.parse(data);

            // Convert plain object back to Map
            for (const [key, value] of Object.entries(sessions)) {
                sessionStorage.set(key, value);
            }

            log('Loaded cursor-agent sessions from disk', {
                sessionsLoaded: sessionStorage.size
            });
        }
    } catch (error) {
        log('Failed to load sessions from disk (non-critical)', { error: error.message });
    }
}

/**
 * Save sessions to persistent storage
 */
function saveSessionsToDisk() {
    if (!config.persistToDisk) {
        return;
    }

    try {
        // Convert Map to plain object for JSON serialization
        const sessions = Object.fromEntries(sessionStorage);
        fs.writeFileSync(STORAGE_FILE, JSON.stringify(sessions, null, 2), 'utf8');

        log('Saved cursor-agent sessions to disk', {
            sessionsSaved: sessionStorage.size
        });
    } catch (error) {
        log('Failed to save sessions to disk (non-critical)', { error: error.message });
    }
}

/**
 * Generate a simple context key for session storage
 * @param {string} projectRoot - Project directory
 * @param {string} model - Model being used
 * @returns {string} Context key
 */
function generateContextKey(projectRoot, model) {
    const resolvedPath = path.resolve(projectRoot || process.cwd());
    return `${resolvedPath}:${model || 'default'}`;
}

// Load existing sessions on module initialization
loadSessionsFromDisk();

/**
 * Get stored chat ID for a context
 * @param {string} projectRoot - Project directory
 * @param {string} model - Model being used
 * @returns {string|null} Stored chat ID or null
 */
export function getCachedChatId(projectRoot, model) {
    if (!config.enabled) {
        return null;
    }

    const contextKey = generateContextKey(projectRoot, model);
    const stored = sessionStorage.get(contextKey);

    if (!stored) {
        return null;
    }

    // Check if session has exceeded max resume attempts
    if (stored.resumeAttempts >= config.maxResumeAttempts) {
        log('Session exceeded max resume attempts, removing', {
            contextKey,
            chatId: stored.chatId,
            attempts: stored.resumeAttempts
        });

        sessionStorage.delete(contextKey);
        saveSessionsToDisk();
        return null;
    }

    // Update last used time
    stored.lastUsedAt = Date.now();
    saveSessionsToDisk();

    const ageInDays = Math.round((Date.now() - stored.createdAt) / (1000 * 60 * 60 * 24));

    log('Using stored chat ID', {
        contextKey,
        chatId: stored.chatId,
        ageDays: ageInDays,
        resumeAttempts: stored.resumeAttempts || 0
    });

    return stored.chatId;
}

/**
 * Store a chat ID for a context
 * @param {string} projectRoot - Project directory
 * @param {string} model - Model being used
 * @param {string} chatId - Chat ID to store
 * @param {boolean} [isNew=true] - Whether this is a new session or updating existing
 */
export function cacheChatId(projectRoot, model, chatId, isNew = true) {
    if (!config.enabled || !chatId) {
        return;
    }

    const contextKey = generateContextKey(projectRoot, model);
    const now = Date.now();

    // Get existing session or create new one
    const existing = sessionStorage.get(contextKey);

    const sessionData = {
        chatId,
        createdAt: isNew ? now : (existing?.createdAt || now),
        lastUsedAt: now,
        resumeAttempts: 0 // Reset resume attempts on successful session
    };

    sessionStorage.set(contextKey, sessionData);

    // Clean up old sessions if we exceed max limit (be more conservative)
    if (sessionStorage.size > config.maxSessions) {
        const entries = Array.from(sessionStorage.entries());
        entries.sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);

        // Remove only the oldest 10% when limit is exceeded
        const removeCount = Math.floor(config.maxSessions * 0.1);
        const toRemove = entries.slice(0, removeCount);

        toRemove.forEach(([key]) => sessionStorage.delete(key));

        log('Cleaned up old sessions', {
            removed: removeCount,
            remaining: sessionStorage.size
        });
    }

    // Save to disk
    saveSessionsToDisk();

    log('Stored chat ID', {
        contextKey,
        chatId,
        isNew,
        totalStored: sessionStorage.size
    });
}

/**
 * Mark a resume failure for a session
 * @param {string} projectRoot - Project directory
 * @param {string} model - Model being used
 * @param {string} failedChatId - The chat ID that failed to resume
 * @returns {boolean} True if session was marked as failed
 */
export function markResumeFailure(projectRoot, model, failedChatId) {
    if (!config.enabled) {
        return false;
    }

    const contextKey = generateContextKey(projectRoot, model);
    const stored = sessionStorage.get(contextKey);

    if (!stored || stored.chatId !== failedChatId) {
        // Session not found or chat ID doesn't match - might have been updated already
        return false;
    }

    stored.resumeAttempts = (stored.resumeAttempts || 0) + 1;
    stored.lastUsedAt = Date.now();

    sessionStorage.set(contextKey, stored);
    saveSessionsToDisk();

    log('Marked resume failure', {
        contextKey,
        chatId: failedChatId,
        attempts: stored.resumeAttempts,
        maxAttempts: config.maxResumeAttempts
    });

    // Check if we should remove the session now
    if (stored.resumeAttempts >= config.maxResumeAttempts) {
        sessionStorage.delete(contextKey);
        saveSessionsToDisk();

        log('Session removed after max resume failures', {
            contextKey,
            chatId: failedChatId,
            totalAttempts: stored.resumeAttempts
        });
    }

    return true;
}

/**
 * Clear stored session for a context
 * @param {string} projectRoot - Project directory
 * @param {string} model - Model being used
 */
export function clearCachedSession(projectRoot, model) {
    const contextKey = generateContextKey(projectRoot, model);
    const deleted = sessionStorage.delete(contextKey);

    if (deleted) {
        saveSessionsToDisk();
        log('Cleared stored session', { contextKey });
    }
}

/**
 * Clear all stored sessions
 */
export function clearAllSessions() {
    const count = sessionStorage.size;
    sessionStorage.clear();

    // Clear persistent storage
    saveSessionsToDisk();

    log('Cleared all stored sessions', { count });
    return count;
}

/**
 * Get storage statistics
 */
export function getCacheStats() {
    const now = Date.now();
    let activeSessions = 0;
    let failedSessions = 0;
    let oldestSession = null;
    let newestSession = null;

    for (const [key, session] of sessionStorage.entries()) {
        const resumeAttempts = session.resumeAttempts || 0;

        if (resumeAttempts < config.maxResumeAttempts) {
            activeSessions++;
        } else {
            failedSessions++;
        }

        // Track age ranges
        if (!oldestSession || session.createdAt < oldestSession) {
            oldestSession = session.createdAt;
        }
        if (!newestSession || session.createdAt > newestSession) {
            newestSession = session.createdAt;
        }
    }

    const stats = {
        totalSessions: sessionStorage.size,
        activeSessions,
        failedSessions,
        enabled: config.enabled,
        maxSessions: config.maxSessions,
        maxResumeAttempts: config.maxResumeAttempts,
        persistToDisk: config.persistToDisk
    };

    // Add age information if we have sessions
    if (oldestSession) {
        stats.oldestSessionDays = Math.round((now - oldestSession) / (1000 * 60 * 60 * 24));
        stats.newestSessionDays = Math.round((now - newestSession) / (1000 * 60 * 60 * 24));
    }

    return stats;
}

/**
 * Configure session storage
 * @param {object} options - Configuration options
 */
export function configureCaching(options = {}) {
    config = { ...config, ...options };

    // If disk persistence settings changed, handle it
    if ('persistToDisk' in options) {
        if (options.persistToDisk) {
            saveSessionsToDisk();
        }
    }

    log('Session storage configured', config);
}

/**
 * Clean up failed sessions that have exceeded max resume attempts
 */
export function cleanupFailedSessions() {
    let cleaned = 0;

    for (const [key, session] of sessionStorage.entries()) {
        const resumeAttempts = session.resumeAttempts || 0;

        if (resumeAttempts >= config.maxResumeAttempts) {
            sessionStorage.delete(key);
            cleaned++;
        }
    }

    if (cleaned > 0) {
        saveSessionsToDisk();
        log('Cleaned up failed sessions', { cleaned, remaining: sessionStorage.size });
    }

    return cleaned;
}

// Clean up failed sessions less frequently - once per hour
setInterval(cleanupFailedSessions, 60 * 60 * 1000);
