/**
 * src/utils/cursor-agent-session-cache.js
 *
 * Simple session caching for cursor-agent chat IDs
 * Stores chat IDs by context to enable session reuse and reduce context overhead
 */

import { log } from '../../scripts/modules/utils.js';
import path from 'path';

// Simple global cache: contextKey -> { chatId, createdAt, lastUsedAt }
const sessionCache = new Map();

// Configuration
let config = {
    enabled: true,
    sessionTTL: 30 * 60 * 1000, // 30 minutes
    maxSessions: 20
};

/**
 * Generate a simple context key for caching
 * @param {string} projectRoot - Project directory
 * @param {string} model - Model being used
 * @returns {string} Context key
 */
function generateContextKey(projectRoot, model) {
    const resolvedPath = path.resolve(projectRoot || process.cwd());
    return `${resolvedPath}:${model || 'default'}`;
}

/**
 * Get cached chat ID for a context
 * @param {string} projectRoot - Project directory
 * @param {string} model - Model being used
 * @returns {string|null} Cached chat ID or null
 */
export function getCachedChatId(projectRoot, model) {
    if (!config.enabled) {
        return null;
    }

    const contextKey = generateContextKey(projectRoot, model);
    const cached = sessionCache.get(contextKey);

    if (!cached) {
        return null;
    }

    // Check if session is still valid (not expired)
    const now = Date.now();
    const age = now - cached.createdAt;
    const inactivity = now - cached.lastUsedAt;

    if (age > config.sessionTTL || inactivity > config.sessionTTL) {
        sessionCache.delete(contextKey);
        return null;
    }

    // Update last used time
    cached.lastUsedAt = now;

    log('Using cached chat ID', {
        contextKey,
        chatId: cached.chatId,
        ageMinutes: Math.round(age / 60000)
    });

    return cached.chatId;
}

/**
 * Cache a chat ID for a context
 * @param {string} projectRoot - Project directory
 * @param {string} model - Model being used
 * @param {string} chatId - Chat ID to cache
 */
export function cacheChatId(projectRoot, model, chatId) {
    if (!config.enabled || !chatId) {
        return;
    }

    const contextKey = generateContextKey(projectRoot, model);
    const now = Date.now();

    sessionCache.set(contextKey, {
        chatId,
        createdAt: now,
        lastUsedAt: now
    });

    // Clean up old sessions if we exceed max limit
    if (sessionCache.size > config.maxSessions) {
        const entries = Array.from(sessionCache.entries());
        entries.sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);

        // Remove oldest sessions
        const toRemove = entries.slice(0, sessionCache.size - config.maxSessions);
        toRemove.forEach(([key]) => sessionCache.delete(key));
    }

    log('Cached chat ID', {
        contextKey,
        chatId,
        totalCached: sessionCache.size
    });
}

/**
 * Clear cached session for a context
 * @param {string} projectRoot - Project directory
 * @param {string} model - Model being used
 */
export function clearCachedSession(projectRoot, model) {
    const contextKey = generateContextKey(projectRoot, model);
    const deleted = sessionCache.delete(contextKey);

    if (deleted) {
        log('Cleared cached session', { contextKey });
    }
}

/**
 * Clear all cached sessions
 */
export function clearAllSessions() {
    const count = sessionCache.size;
    sessionCache.clear();
    log('Cleared all cached sessions', { count });
    return count;
}

/**
 * Get cache statistics
 */
export function getCacheStats() {
    const now = Date.now();
    let activeSessions = 0;
    let expiredSessions = 0;

    for (const [key, session] of sessionCache.entries()) {
        const age = now - session.createdAt;
        const inactivity = now - session.lastUsedAt;

        if (age <= config.sessionTTL && inactivity <= config.sessionTTL) {
            activeSessions++;
        } else {
            expiredSessions++;
        }
    }

    return {
        totalSessions: sessionCache.size,
        activeSessions,
        expiredSessions,
        enabled: config.enabled,
        sessionTTL: config.sessionTTL,
        maxSessions: config.maxSessions
    };
}

/**
 * Configure session caching
 * @param {object} options - Configuration options
 */
export function configureCaching(options = {}) {
    config = { ...config, ...options };
    log('Session caching configured', config);
}

/**
 * Clean up expired sessions
 */
export function cleanupExpiredSessions() {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, session] of sessionCache.entries()) {
        const age = now - session.createdAt;
        const inactivity = now - session.lastUsedAt;

        if (age > config.sessionTTL || inactivity > config.sessionTTL) {
            sessionCache.delete(key);
            cleaned++;
        }
    }

    if (cleaned > 0) {
        log('Cleaned up expired sessions', { cleaned, remaining: sessionCache.size });
    }

    return cleaned;
}

// Periodic cleanup every 5 minutes
setInterval(cleanupExpiredSessions, 5 * 60 * 1000);
