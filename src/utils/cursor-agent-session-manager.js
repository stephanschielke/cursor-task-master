/**
 * src/utils/cursor-agent-session-manager.js
 *
 * Session tracking and cleanup manager for cursor-agent operations
 * Provides session leak detection, orphaned process monitoring, and enhanced cleanup
 */

import { log } from '../../scripts/modules/utils.js';
import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

export class CursorAgentSessionManager {
    constructor() {
        this.activeSessions = new Map(); // sessionId -> SessionInfo
        this.cleanupInterval = null;
        this.cleanupIntervalMs = 30000; // Check every 30 seconds
        this.maxSessionAge = 600000; // Max 10 minutes for any session
        this.orphanCheckInterval = 60000; // Check for orphans every minute

        // Start background monitoring
        this.startBackgroundMonitoring();

        // Cleanup on process exit
        process.on('exit', () => this.emergencyCleanupAll());
        process.on('SIGINT', () => this.emergencyCleanupAll());
        process.on('SIGTERM', () => this.emergencyCleanupAll());
    }

    /**
     * Register a new active session
     * @param {string} sessionId - Unique session identifier
     * @param {object} processInfo - Process information
     * @param {object} options - Session options
     */
    registerSession(sessionId, processInfo, options = {}) {
        const sessionInfo = {
            sessionId,
            pid: processInfo.pid,
            childProcess: processInfo.childProcess,
            tmpFile: processInfo.tmpFile,
            startTime: Date.now(),
            lastActivity: Date.now(),
            operationType: options.operationType || 'unknown',
            projectRoot: options.projectRoot || process.cwd(),
            timeoutMs: options.timeoutMs || 120000,
            isResearch: options.isResearch || false
        };

        this.activeSessions.set(sessionId, sessionInfo);

        log('SessionManager: Registered new session', {
            sessionId,
            pid: sessionInfo.pid,
            operationType: sessionInfo.operationType,
            timeoutMs: sessionInfo.timeoutMs
        });

        return sessionInfo;
    }

    /**
     * Update session activity timestamp
     * @param {string} sessionId - Session to update
     */
    updateSessionActivity(sessionId) {
        const session = this.activeSessions.get(sessionId);
        if (session) {
            session.lastActivity = Date.now();
            log('SessionManager: Updated activity for session', { sessionId });
        }
    }

    /**
     * Unregister a completed session
     * @param {string} sessionId - Session to remove
     * @param {string} reason - Reason for removal
     */
    unregisterSession(sessionId, reason = 'completed') {
        const session = this.activeSessions.get(sessionId);
        if (session) {
            const duration = Date.now() - session.startTime;
            log('SessionManager: Unregistered session', {
                sessionId,
                reason,
                duration: `${duration}ms`,
                operationType: session.operationType
            });

            this.activeSessions.delete(sessionId);
            return true;
        }
        return false;
    }

    /**
     * Enhanced cleanup for a specific session with comprehensive verification
     * @param {string} sessionId - Session to clean up
     * @param {boolean} force - Force cleanup even if session seems active
     */
    async cleanupSession(sessionId, force = false) {
        const session = this.activeSessions.get(sessionId);
        if (!session) {
            log('SessionManager: Session not found for cleanup', { sessionId });
            return false;
        }

        log('SessionManager: Starting enhanced cleanup', {
            sessionId,
            pid: session.pid,
            force,
            operationType: session.operationType
        });

        try {
            // 1. Clean up child process with enhanced verification
            if (session.childProcess && !session.childProcess.killed) {
                log('SessionManager: Terminating child process', {
                    sessionId,
                    pid: session.pid
                });

                // Remove all listeners first to prevent hanging
                session.childProcess.removeAllListeners();

                // Try graceful termination first
                session.childProcess.kill('SIGTERM');

                // Wait a moment then verify termination
                await new Promise(resolve => setTimeout(resolve, 2000));

                // Force kill if still running
                if (!session.childProcess.killed) {
                    log('SessionManager: Process still running, force killing', {
                        sessionId,
                        pid: session.pid
                    });
                    session.childProcess.kill('SIGKILL');
                }
            }

            // 2. Clean up temporary files
            if (session.tmpFile) {
                try {
                    if (fs.existsSync(session.tmpFile)) {
                        fs.unlinkSync(session.tmpFile);
                        log('SessionManager: Cleaned up temp file', {
                            sessionId,
                            tmpFile: session.tmpFile
                        });
                    }
                } catch (fileError) {
                    log('SessionManager: Warning - failed to cleanup temp file', {
                        sessionId,
                        tmpFile: session.tmpFile,
                        error: fileError.message
                    });
                }
            }

            // 3. Check for orphaned processes
            await this.cleanupOrphanedCursorAgentProcesses(session.projectRoot);

            // 4. Unregister the session
            this.unregisterSession(sessionId, force ? 'forced_cleanup' : 'normal_cleanup');

            return true;
        } catch (error) {
            log('SessionManager: Error during session cleanup', {
                sessionId,
                error: error.message
            });
            return false;
        }
    }

    /**
     * Start background monitoring for session leaks and orphaned processes
     */
    startBackgroundMonitoring() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }

        this.cleanupInterval = setInterval(() => {
            this.performMaintenanceCleanup();
        }, this.cleanupIntervalMs);

        log('SessionManager: Started background monitoring', {
            cleanupInterval: this.cleanupIntervalMs,
            orphanCheckInterval: this.orphanCheckInterval
        });
    }

    /**
     * Perform routine maintenance cleanup
     */
    async performMaintenanceCleanup() {
        const currentTime = Date.now();
        const sessionsToCleanup = [];

        // Check for stale sessions
        for (const [sessionId, session] of this.activeSessions) {
            const age = currentTime - session.startTime;
            const inactivity = currentTime - session.lastActivity;

            // Session is too old or inactive
            if (age > this.maxSessionAge || inactivity > (session.timeoutMs + 30000)) {
                sessionsToCleanup.push({
                    sessionId,
                    reason: age > this.maxSessionAge ? 'max_age_exceeded' : 'timeout_exceeded',
                    age,
                    inactivity
                });
            }

            // Check if child process is actually dead
            if (session.childProcess && session.childProcess.killed) {
                sessionsToCleanup.push({
                    sessionId,
                    reason: 'process_already_dead',
                    age,
                    inactivity
                });
            }
        }

        // Cleanup identified sessions
        if (sessionsToCleanup.length > 0) {
            log('SessionManager: Performing maintenance cleanup', {
                sessionsToCleanup: sessionsToCleanup.length,
                reasons: sessionsToCleanup.map(s => s.reason)
            });

            for (const { sessionId, reason } of sessionsToCleanup) {
                await this.cleanupSession(sessionId, true);
                log('SessionManager: Cleaned up stale session', { sessionId, reason });
            }
        }

        // Check for orphaned cursor-agent processes
        await this.cleanupOrphanedCursorAgentProcesses();
    }

    /**
     * Detect and clean up orphaned cursor-agent processes
     * @param {string} projectRoot - Optional project root to focus cleanup
     */
    async cleanupOrphanedCursorAgentProcesses(projectRoot = null) {
        try {
            // Find all cursor-agent processes
            const psOutput = execSync('ps aux | grep cursor-agent | grep -v grep', {
                encoding: 'utf8',
                timeout: 5000
            }).trim();

            if (!psOutput) {
                return; // No cursor-agent processes found
            }

            const processes = psOutput.split('\n').map(line => {
                const parts = line.trim().split(/\s+/);
                return {
                    pid: parts[1],
                    ppid: parts[2],
                    command: parts.slice(10).join(' ')
                };
            });

            const orphanedProcesses = processes.filter(proc => {
                // Skip if this PID is tracked in our active sessions
                const isTracked = Array.from(this.activeSessions.values())
                    .some(session => session.pid == proc.pid);

                if (isTracked) {
                    return false;
                }

                // Check if parent process exists
                try {
                    process.kill(proc.ppid, 0); // Test if parent exists
                    return false; // Parent exists, not orphaned
                } catch (e) {
                    return true; // Parent doesn't exist, likely orphaned
                }
            });

            if (orphanedProcesses.length > 0) {
                log('SessionManager: Found orphaned cursor-agent processes', {
                    count: orphanedProcesses.length,
                    pids: orphanedProcesses.map(p => p.pid)
                });

                // Kill orphaned processes
                for (const proc of orphanedProcesses) {
                    try {
                        process.kill(proc.pid, 'SIGTERM');
                        log('SessionManager: Terminated orphaned cursor-agent process', {
                            pid: proc.pid
                        });
                    } catch (killError) {
                        log('SessionManager: Failed to kill orphaned process', {
                            pid: proc.pid,
                            error: killError.message
                        });
                    }
                }
            }

        } catch (error) {
            // Ignore errors - orphan cleanup is best-effort
            log('SessionManager: Orphan process cleanup failed (non-critical)', {
                error: error.message
            });
        }
    }

    /**
     * Get session statistics for monitoring
     */
    getSessionStats() {
        const currentTime = Date.now();
        const sessions = Array.from(this.activeSessions.values());

        const stats = {
            totalActiveSessions: sessions.length,
            avgSessionAge: sessions.length > 0 ?
                sessions.reduce((sum, s) => sum + (currentTime - s.startTime), 0) / sessions.length : 0,
            operationTypes: {},
            oldestSession: null,
            sessionDetails: []
        };

        // Analyze sessions
        sessions.forEach(session => {
            const age = currentTime - session.startTime;
            const inactivity = currentTime - session.lastActivity;

            // Track operation types
            stats.operationTypes[session.operationType] =
                (stats.operationTypes[session.operationType] || 0) + 1;

            // Find oldest session
            if (!stats.oldestSession || age > (currentTime - stats.oldestSession.startTime)) {
                stats.oldestSession = {
                    sessionId: session.sessionId,
                    age,
                    operationType: session.operationType
                };
            }

            // Collect session details
            stats.sessionDetails.push({
                sessionId: session.sessionId,
                pid: session.pid,
                age,
                inactivity,
                operationType: session.operationType,
                isResearch: session.isResearch
            });
        });

        return stats;
    }

    /**
     * Emergency cleanup all sessions (called on process exit)
     */
    emergencyCleanupAll() {
        log('SessionManager: Emergency cleanup - terminating all sessions');

        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }

        const sessionIds = Array.from(this.activeSessions.keys());
        sessionIds.forEach(sessionId => {
            try {
                // Force immediate cleanup without awaiting
                const session = this.activeSessions.get(sessionId);
                if (session && session.childProcess && !session.childProcess.killed) {
                    session.childProcess.removeAllListeners();
                    session.childProcess.kill('SIGKILL');
                }

                if (session && session.tmpFile && fs.existsSync(session.tmpFile)) {
                    fs.unlinkSync(session.tmpFile);
                }
            } catch (error) {
                // Ignore errors during emergency cleanup
            }
        });

        this.activeSessions.clear();
    }
}

// Create singleton instance
export const sessionManager = new CursorAgentSessionManager();
