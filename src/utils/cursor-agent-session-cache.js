/**
 * src/utils/cursor-agent-session-cache.js
 *
 * STATELESS file-based session storage for cursor-agent chat IDs
 * Each project maintains its own .taskmaster/cursor-agent-sessions.json file
 * NO global state, NO timers, NO persistent processes
 */

import { log } from '../../scripts/modules/utils.js';
import path from 'path';
import fs from 'fs';

// Default configuration - can be overridden
let config = {
    enabled: true,
    maxSessions: 50,
    maxResumeAttempts: 3
};

/**
 * Get the sessions file path for a project
 * @param {string} projectRoot - Project directory
 * @returns {string} Path to sessions file
 */
function getSessionsFilePath(projectRoot) {
    const resolvedRoot = path.resolve(projectRoot || process.cwd());
    const taskmasterDir = path.join(resolvedRoot, '.taskmaster');

    // Ensure .taskmaster directory exists
    if (!fs.existsSync(taskmasterDir)) {
        fs.mkdirSync(taskmasterDir, { recursive: true });
    }

    return path.join(taskmasterDir, 'cursor-agent-sessions.json');
}

/**
 * Load sessions from project file
 * @param {string} projectRoot - Project directory
 * @returns {object} Sessions object
 */
function loadSessionsFromFile(projectRoot) {
    const filePath = getSessionsFilePath(projectRoot);

    try {
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        log('warn', `Failed to load sessions from ${filePath}: ${error.message}`);
    }

    return {};
}

/**
 * Save sessions to project file
 * @param {string} projectRoot - Project directory
 * @param {object} sessions - Sessions object to save
 */
function saveSessionsToFile(projectRoot, sessions) {
    const filePath = getSessionsFilePath(projectRoot);

    try {
        fs.writeFileSync(filePath, JSON.stringify(sessions, null, 2), 'utf8');
    } catch (error) {
        log('warn', `Failed to save sessions to ${filePath}: ${error.message}`);
    }
}

/**
 * Generate a context key for session storage
 * @param {string} projectRoot - Project directory
 * @param {string} model - Model being used
 * @returns {string} Context key
 */
function generateContextKey(projectRoot, model) {
    const resolvedPath = path.resolve(projectRoot || process.cwd());
    return `${resolvedPath}:${model || 'default'}`;
}

/**
 * Check if a session should be invalidated due to too many failures
 * @param {object} session - Session object
 * @returns {boolean} True if session should be invalidated
 */
function shouldInvalidateSession(session) {
    if (!session) return true;

    const resumeAttempts = session.resumeAttempts || 0;
    return resumeAttempts >= config.maxResumeAttempts;
}

/**
 * Clean up old sessions when limit is exceeded
 * @param {object} sessions - Sessions object
 * @returns {object} Cleaned sessions object
 */
function cleanupOldSessions(sessions) {
    const sessionEntries = Object.entries(sessions);

    if (sessionEntries.length <= config.maxSessions) {
        return sessions; // No cleanup needed
    }

    // Sort by lastUsedAt (oldest first)
    sessionEntries.sort((a, b) => {
        const aTime = a[1].lastUsedAt || 0;
        const bTime = b[1].lastUsedAt || 0;
        return aTime - bTime;
    });

    // Remove oldest 10% when limit exceeded
    const removeCount = Math.floor(config.maxSessions * 0.1);
    const toKeep = sessionEntries.slice(removeCount);

    const cleanedSessions = {};
    toKeep.forEach(([key, value]) => {
        cleanedSessions[key] = value;
    });

    if (removeCount > 0) {
        log('info', `Cleaned up ${removeCount} old cursor-agent sessions`);
    }

    return cleanedSessions;
}

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

    const sessions = loadSessionsFromFile(projectRoot);
    const contextKey = generateContextKey(projectRoot, model);
    const session = sessions[contextKey];

    if (!session || shouldInvalidateSession(session)) {
        if (session) {
            log('info', `Session invalidated due to failures: ${session.resumeAttempts || 0} attempts`);
            delete sessions[contextKey];
            saveSessionsToFile(projectRoot, sessions);
        }
        return null;
    }

    // Update last used time
    session.lastUsedAt = Date.now();
    saveSessionsToFile(projectRoot, sessions);

    const ageInDays = Math.round((Date.now() - session.createdAt) / (1000 * 60 * 60 * 24));

    log('info', `Using stored cursor-agent session: ${session.chatId} (age: ${ageInDays} days)`);
    return session.chatId;
}

/**
 * Store a chat ID for a context
 * @param {string} projectRoot - Project directory
 * @param {string} model - Model being used
 * @param {string} chatId - Chat ID to store
 * @param {boolean} [isNew=true] - Whether this is a new session
 */
export function cacheChatId(projectRoot, model, chatId, isNew = true) {
    if (!config.enabled || !chatId) {
        return;
    }

    const sessions = loadSessionsFromFile(projectRoot);
    const contextKey = generateContextKey(projectRoot, model);
    const now = Date.now();

    // Get existing session or create new one
    const existing = sessions[contextKey];

    const sessionData = {
        chatId,
        createdAt: isNew ? now : (existing?.createdAt || now),
        lastUsedAt: now,
        resumeAttempts: 0 // Reset resume attempts on successful session
    };

    sessions[contextKey] = sessionData;

    // Clean up old sessions if needed
    const cleanedSessions = cleanupOldSessions(sessions);

    saveSessionsToFile(projectRoot, cleanedSessions);

    log('info', `Stored cursor-agent session: ${chatId} (total: ${Object.keys(cleanedSessions).length})`);
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

    const sessions = loadSessionsFromFile(projectRoot);
    const contextKey = generateContextKey(projectRoot, model);
    const session = sessions[contextKey];

    if (!session || session.chatId !== failedChatId) {
        return false; // Session not found or chat ID doesn't match
    }

    session.resumeAttempts = (session.resumeAttempts || 0) + 1;
    session.lastUsedAt = Date.now();

    log('warn', `Cursor-agent resume failure: ${failedChatId} (attempt ${session.resumeAttempts}/${config.maxResumeAttempts})`);

    // Remove session if it exceeded max attempts
    if (session.resumeAttempts >= config.maxResumeAttempts) {
        delete sessions[contextKey];
        log('info', `Removed cursor-agent session after max failures: ${failedChatId}`);
    } else {
        sessions[contextKey] = session;
    }

    saveSessionsToFile(projectRoot, sessions);
    return true;
}

/**
 * Clear stored session for a context
 * @param {string} projectRoot - Project directory
 * @param {string} model - Model being used
 */
export function clearCachedSession(projectRoot, model) {
    const sessions = loadSessionsFromFile(projectRoot);
    const contextKey = generateContextKey(projectRoot, model);

    if (sessions[contextKey]) {
        delete sessions[contextKey];
        saveSessionsToFile(projectRoot, sessions);
        log('info', `Cleared cursor-agent session for context: ${contextKey}`);
    }
}

/**
 * Clear all stored sessions for a project
 * @param {string} projectRoot - Project directory
 */
export function clearAllSessions(projectRoot) {
    const filePath = getSessionsFilePath(projectRoot);

    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            log('info', 'Cleared all cursor-agent sessions');
        }
    } catch (error) {
        log('warn', `Failed to clear sessions file: ${error.message}`);
    }
}

/**
 * Get storage statistics for a project
 * @param {string} projectRoot - Project directory
 * @returns {object} Statistics object
 */
export function getCacheStats(projectRoot) {
    const sessions = loadSessionsFromFile(projectRoot);
    const sessionEntries = Object.entries(sessions);
    const now = Date.now();

    let activeSessions = 0;
    let failedSessions = 0;
    let oldestSession = null;
    let newestSession = null;

    sessionEntries.forEach(([key, session]) => {
        const resumeAttempts = session.resumeAttempts || 0;

        if (resumeAttempts < config.maxResumeAttempts) {
            activeSessions++;
        } else {
            failedSessions++;
        }

        if (!oldestSession || session.createdAt < oldestSession) {
            oldestSession = session.createdAt;
        }
        if (!newestSession || session.createdAt > newestSession) {
            newestSession = session.createdAt;
        }
    });

    const stats = {
        totalSessions: sessionEntries.length,
        activeSessions,
        failedSessions,
        enabled: config.enabled,
        maxSessions: config.maxSessions,
        maxResumeAttempts: config.maxResumeAttempts
    };

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
    log('info', 'Cursor-agent session storage configured', config);
}

/**
 * Clean up failed sessions that have exceeded max resume attempts
 * This is called lazily when accessing sessions, not on a timer
 * @param {string} projectRoot - Project directory
 * @returns {number} Number of sessions cleaned up
 */
export function cleanupFailedSessions(projectRoot) {
    const sessions = loadSessionsFromFile(projectRoot);
    const sessionEntries = Object.entries(sessions);
    let cleaned = 0;

    sessionEntries.forEach(([key, session]) => {
        const resumeAttempts = session.resumeAttempts || 0;
        if (resumeAttempts >= config.maxResumeAttempts) {
            delete sessions[key];
            cleaned++;
        }
    });

    if (cleaned > 0) {
        saveSessionsToFile(projectRoot, sessions);
        log('info', `Cleaned up ${cleaned} failed cursor-agent sessions`);
    }

    return cleaned;
}