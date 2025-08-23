/**
 * tests/unit/utils/cursor-agent-session-manager.test.js
 *
 * Unit tests for CursorAgentSessionManager functionality
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { CursorAgentSessionManager } from '../../../src/utils/cursor-agent-session-manager.js';

// Mock dependencies
jest.mock('child_process');
jest.mock('../../../scripts/modules/utils.js', () => ({
    log: jest.fn()
}));

describe('CursorAgentSessionManager', () => {
    let sessionManager;
    let mockChildProcess;

    beforeEach(() => {
        sessionManager = new CursorAgentSessionManager();
        // Clear any existing sessions
        sessionManager.activeSessions.clear();

        mockChildProcess = {
            pid: 12345,
            kill: jest.fn(),
            removeAllListeners: jest.fn(),
            killed: false
        };

        jest.clearAllMocks();
    });

    afterEach(() => {
        sessionManager.emergencyCleanupAll();
        if (sessionManager.cleanupInterval) {
            clearInterval(sessionManager.cleanupInterval);
        }
    });

    describe('Session Registration', () => {
        it('should register a new session with correct information', () => {
            const sessionId = 'test-session-1';
            const processInfo = {
                pid: mockChildProcess.pid,
                childProcess: mockChildProcess,
                tmpFile: '/tmp/test-prompt.txt'
            };
            const options = {
                operationType: 'generateText',
                projectRoot: '/test/project',
                timeoutMs: 120000,
                isResearch: false
            };

            const sessionInfo = sessionManager.registerSession(sessionId, processInfo, options);

            expect(sessionInfo.sessionId).toBe(sessionId);
            expect(sessionInfo.pid).toBe(mockChildProcess.pid);
            expect(sessionInfo.operationType).toBe('generateText');
            expect(sessionInfo.projectRoot).toBe('/test/project');
            expect(sessionInfo.timeoutMs).toBe(120000);
            expect(sessionInfo.isResearch).toBe(false);
            expect(sessionManager.activeSessions.has(sessionId)).toBe(true);
        });

        it('should track session start time and activity', () => {
            const sessionId = 'test-session-2';
            const processInfo = {
                pid: mockChildProcess.pid,
                childProcess: mockChildProcess,
                tmpFile: '/tmp/test-prompt.txt'
            };

            const beforeTime = Date.now();
            const sessionInfo = sessionManager.registerSession(sessionId, processInfo);
            const afterTime = Date.now();

            expect(sessionInfo.startTime).toBeGreaterThanOrEqual(beforeTime);
            expect(sessionInfo.startTime).toBeLessThanOrEqual(afterTime);
            expect(sessionInfo.lastActivity).toBe(sessionInfo.startTime);
        });
    });

    describe('Session Activity Updates', () => {
        it('should update session activity timestamp', () => {
            const sessionId = 'test-session-3';
            const processInfo = {
                pid: mockChildProcess.pid,
                childProcess: mockChildProcess,
                tmpFile: '/tmp/test-prompt.txt'
            };

            const sessionInfo = sessionManager.registerSession(sessionId, processInfo);
            const originalActivity = sessionInfo.lastActivity;

            // Wait a moment then update activity
            setTimeout(() => {
                sessionManager.updateSessionActivity(sessionId);
                const updatedSession = sessionManager.activeSessions.get(sessionId);
                expect(updatedSession.lastActivity).toBeGreaterThan(originalActivity);
            }, 10);
        });

        it('should handle activity updates for non-existent sessions gracefully', () => {
            // Should not throw error
            expect(() => {
                sessionManager.updateSessionActivity('non-existent-session');
            }).not.toThrow();
        });
    });

    describe('Session Cleanup', () => {
        it('should unregister completed sessions', () => {
            const sessionId = 'test-session-4';
            const processInfo = {
                pid: mockChildProcess.pid,
                childProcess: mockChildProcess,
                tmpFile: '/tmp/test-prompt.txt'
            };

            sessionManager.registerSession(sessionId, processInfo);
            expect(sessionManager.activeSessions.has(sessionId)).toBe(true);

            const result = sessionManager.unregisterSession(sessionId, 'completed');
            expect(result).toBe(true);
            expect(sessionManager.activeSessions.has(sessionId)).toBe(false);
        });

        it('should return false when trying to unregister non-existent session', () => {
            const result = sessionManager.unregisterSession('non-existent-session', 'completed');
            expect(result).toBe(false);
        });
    });

    describe('Session Statistics', () => {
        it('should return correct session statistics', () => {
            // Register multiple sessions
            for (let i = 1; i <= 3; i++) {
                sessionManager.registerSession(`session-${i}`, {
                    pid: 12340 + i,
                    childProcess: mockChildProcess,
                    tmpFile: `/tmp/test-${i}.txt`
                }, {
                    operationType: i === 1 ? 'generateText' : 'generateObject'
                });
            }

            const stats = sessionManager.getSessionStats();

            expect(stats.totalActiveSessions).toBe(3);
            expect(stats.operationTypes.generateText).toBe(1);
            expect(stats.operationTypes.generateObject).toBe(2);
            expect(stats.sessionDetails).toHaveLength(3);
            expect(stats.oldestSession).toBeDefined();
        });

        it('should return empty statistics for no active sessions', () => {
            const stats = sessionManager.getSessionStats();

            expect(stats.totalActiveSessions).toBe(0);
            expect(stats.avgSessionAge).toBe(0);
            expect(stats.operationTypes).toEqual({});
            expect(stats.oldestSession).toBeNull();
            expect(stats.sessionDetails).toEqual([]);
        });
    });

    describe('Emergency Cleanup', () => {
        it('should clear all active sessions during emergency cleanup', () => {
            // Register multiple sessions
            for (let i = 1; i <= 3; i++) {
                sessionManager.registerSession(`session-${i}`, {
                    pid: 12340 + i,
                    childProcess: mockChildProcess,
                    tmpFile: `/tmp/test-${i}.txt`
                });
            }

            expect(sessionManager.activeSessions.size).toBe(3);

            sessionManager.emergencyCleanupAll();

            expect(sessionManager.activeSessions.size).toBe(0);
        });
    });

    describe('Configuration', () => {
        it('should have correct default configuration values', () => {
            expect(sessionManager.cleanupIntervalMs).toBe(30000); // 30 seconds
            expect(sessionManager.maxSessionAge).toBe(600000); // 10 minutes
            expect(sessionManager.orphanCheckInterval).toBe(60000); // 1 minute
        });
    });
});
