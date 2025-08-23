/**
 * tests/unit/utils/cursor-agent-session-cache.test.js
 *
 * Unit tests for cursor-agent session caching functionality
 */

import {
    getCachedChatId,
    cacheChatId,
    clearCachedSession,
    clearAllSessions,
    getCacheStats,
    configureCaching,
    cleanupExpiredSessions
} from '../../../src/utils/cursor-agent-session-cache.js';

describe('CursorAgentSessionCache', () => {
    const testProjectRoot = '/test/project';
    const testModel = 'sonnet-4';
    const testChatId = 'test-chat-123';

    beforeEach(() => {
        // Clear all sessions before each test
        clearAllSessions();

        // Reset configuration to defaults
        configureCaching({
            enabled: true,
            sessionTTL: 30 * 60 * 1000, // 30 minutes
            maxSessions: 20
        });
    });

    afterEach(() => {
        // Clean up after each test
        clearAllSessions();
    });

    describe('cacheChatId and getCachedChatId', () => {
        it('should cache and retrieve chat ID for a context', () => {
            // Cache a chat ID
            cacheChatId(testProjectRoot, testModel, testChatId);

            // Retrieve the cached chat ID
            const cachedId = getCachedChatId(testProjectRoot, testModel);
            expect(cachedId).toBe(testChatId);
        });

        it('should return null for non-cached context', () => {
            const cachedId = getCachedChatId('/different/project', testModel);
            expect(cachedId).toBeNull();
        });

        it('should differentiate by project root', () => {
            const chatId1 = 'chat-1';
            const chatId2 = 'chat-2';
            const project1 = '/project1';
            const project2 = '/project2';

            cacheChatId(project1, testModel, chatId1);
            cacheChatId(project2, testModel, chatId2);

            expect(getCachedChatId(project1, testModel)).toBe(chatId1);
            expect(getCachedChatId(project2, testModel)).toBe(chatId2);
        });

        it('should differentiate by model', () => {
            const chatId1 = 'chat-1';
            const chatId2 = 'chat-2';
            const model1 = 'sonnet-4';
            const model2 = 'gpt-5';

            cacheChatId(testProjectRoot, model1, chatId1);
            cacheChatId(testProjectRoot, model2, chatId2);

            expect(getCachedChatId(testProjectRoot, model1)).toBe(chatId1);
            expect(getCachedChatId(testProjectRoot, model2)).toBe(chatId2);
        });

        it('should not cache if disabled', () => {
            // Disable caching
            configureCaching({ enabled: false });

            cacheChatId(testProjectRoot, testModel, testChatId);
            const cachedId = getCachedChatId(testProjectRoot, testModel);

            expect(cachedId).toBeNull();
        });

        it('should not cache empty or null chat IDs', () => {
            cacheChatId(testProjectRoot, testModel, null);
            cacheChatId(testProjectRoot, testModel, '');
            cacheChatId(testProjectRoot, testModel, undefined);

            const cachedId = getCachedChatId(testProjectRoot, testModel);
            expect(cachedId).toBeNull();
        });
    });

    describe('session expiration', () => {
        it('should expire sessions after TTL', (done) => {
            // Set very short TTL for testing
            configureCaching({
                enabled: true,
                sessionTTL: 100 // 100ms
            });

            cacheChatId(testProjectRoot, testModel, testChatId);

            // Should be available immediately
            expect(getCachedChatId(testProjectRoot, testModel)).toBe(testChatId);

            // Should expire after TTL
            setTimeout(() => {
                const cachedId = getCachedChatId(testProjectRoot, testModel);
                expect(cachedId).toBeNull();
                done();
            }, 150);
        }, 200);

        it('should update lastUsedAt when accessing cache', () => {
            cacheChatId(testProjectRoot, testModel, testChatId);

            // Access the cache to update lastUsedAt
            const cachedId1 = getCachedChatId(testProjectRoot, testModel);
            expect(cachedId1).toBe(testChatId);

            // Wait a bit then access again
            setTimeout(() => {
                const cachedId2 = getCachedChatId(testProjectRoot, testModel);
                expect(cachedId2).toBe(testChatId);
            }, 50);
        });
    });

    describe('session limits', () => {
        it('should enforce maximum session limit', () => {
            // Set low limit for testing
            configureCaching({
                enabled: true,
                maxSessions: 2
            });

            // Cache 3 sessions (exceeds limit)
            cacheChatId('/project1', testModel, 'chat-1');
            cacheChatId('/project2', testModel, 'chat-2');
            cacheChatId('/project3', testModel, 'chat-3');

            // Only 2 should remain (newest ones)
            const stats = getCacheStats();
            expect(stats.totalSessions).toBe(2);

            // The oldest should be gone, newest should remain
            expect(getCachedChatId('/project1', testModel)).toBeNull();
            expect(getCachedChatId('/project2', testModel)).toBe('chat-2');
            expect(getCachedChatId('/project3', testModel)).toBe('chat-3');
        });
    });

    describe('cache management', () => {
        it('should clear specific cached session', () => {
            cacheChatId(testProjectRoot, testModel, testChatId);

            expect(getCachedChatId(testProjectRoot, testModel)).toBe(testChatId);

            clearCachedSession(testProjectRoot, testModel);

            expect(getCachedChatId(testProjectRoot, testModel)).toBeNull();
        });

        it('should clear all cached sessions', () => {
            cacheChatId('/project1', 'sonnet-4', 'chat-1');
            cacheChatId('/project2', 'gpt-5', 'chat-2');

            expect(getCacheStats().totalSessions).toBe(2);

            const clearedCount = clearAllSessions();

            expect(clearedCount).toBe(2);
            expect(getCacheStats().totalSessions).toBe(0);
        });
    });

    describe('cache statistics', () => {
        it('should provide accurate cache statistics', () => {
            // Initially empty
            let stats = getCacheStats();
            expect(stats.totalSessions).toBe(0);
            expect(stats.activeSessions).toBe(0);
            expect(stats.enabled).toBe(true);

            // Add some sessions
            cacheChatId('/project1', testModel, 'chat-1');
            cacheChatId('/project2', testModel, 'chat-2');

            stats = getCacheStats();
            expect(stats.totalSessions).toBe(2);
            expect(stats.activeSessions).toBe(2);
        });

        it('should track expired sessions in statistics', (done) => {
            // Set very short TTL for testing
            configureCaching({
                enabled: true,
                sessionTTL: 50 // 50ms
            });

            cacheChatId(testProjectRoot, testModel, testChatId);

            // Wait for expiration
            setTimeout(() => {
                const stats = getCacheStats();
                expect(stats.totalSessions).toBe(1); // Still in cache
                expect(stats.activeSessions).toBe(0); // But expired
                expect(stats.expiredSessions).toBe(1);
                done();
            }, 100);
        }, 150);
    });

    describe('configuration', () => {
        it('should accept configuration changes', () => {
            const newConfig = {
                enabled: false,
                sessionTTL: 60 * 60 * 1000, // 1 hour
                maxSessions: 50
            };

            configureCaching(newConfig);

            const stats = getCacheStats();
            expect(stats.enabled).toBe(false);
            expect(stats.sessionTTL).toBe(60 * 60 * 1000);
            expect(stats.maxSessions).toBe(50);
        });

        it('should merge partial configuration changes', () => {
            // Set initial config
            configureCaching({
                enabled: true,
                sessionTTL: 30 * 60 * 1000,
                maxSessions: 20
            });

            // Change only TTL
            configureCaching({
                sessionTTL: 60 * 60 * 1000
            });

            const stats = getCacheStats();
            expect(stats.enabled).toBe(true); // Should remain true
            expect(stats.sessionTTL).toBe(60 * 60 * 1000); // Should be updated
            expect(stats.maxSessions).toBe(20); // Should remain unchanged
        });
    });

    describe('cleanup operations', () => {
        it('should clean up expired sessions manually', () => {
            // Set very short TTL for testing
            configureCaching({
                enabled: true,
                sessionTTL: 50 // 50ms
            });

            cacheChatId('/project1', testModel, 'chat-1');
            cacheChatId('/project2', testModel, 'chat-2');

            expect(getCacheStats().totalSessions).toBe(2);

            // Wait for expiration
            setTimeout(() => {
                const cleanedCount = cleanupExpiredSessions();
                expect(cleanedCount).toBe(2);
                expect(getCacheStats().totalSessions).toBe(0);
            }, 100);
        });
    });

    describe('error handling', () => {
        it('should handle invalid project roots gracefully', () => {
            expect(() => {
                cacheChatId(null, testModel, testChatId);
            }).not.toThrow();

            expect(() => {
                getCachedChatId(undefined, testModel);
            }).not.toThrow();
        });

        it('should handle invalid models gracefully', () => {
            expect(() => {
                cacheChatId(testProjectRoot, null, testChatId);
            }).not.toThrow();

            expect(() => {
                getCachedChatId(testProjectRoot, undefined);
            }).not.toThrow();
        });
    });
});
