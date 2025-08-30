/**
 * tests/unit/utils/cursor-agent-session-cache.test.js
 *
 * Unit tests for cursor-agent session persistent storage functionality
 */

import {
	getCachedChatId,
	cacheChatId,
	clearCachedSession,
	clearAllSessions,
	getCacheStats,
	configureCaching,
	markResumeFailure,
	cleanupFailedSessions
} from '../../../src/utils/cursor-agent-session-cache.js';

describe('CursorAgentSessionCache', () => {
	const testProjectRoot = '/tmp/test-cursor-agent-sessions';
	const testModel = 'sonnet-4';
	const testChatId = 'test-chat-123';

	beforeEach(() => {
		// Clear all sessions before each test
		clearAllSessions(testProjectRoot);

		// Reset configuration to defaults
		configureCaching({
			enabled: true,
			maxSessions: 50,
			maxResumeAttempts: 3
		});
	});

	afterEach(() => {
		// Clean up after each test
		clearAllSessions(testProjectRoot);
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

	describe('session failure handling', () => {
		it('should invalidate session after max resume failures', () => {
			// Set low failure threshold for testing
			configureCaching({
				enabled: true,
				maxResumeAttempts: 2
			});

			cacheChatId(testProjectRoot, testModel, testChatId);

			// Should be available initially
			expect(getCachedChatId(testProjectRoot, testModel)).toBe(testChatId);

			// Mark first failure - should still be available
			markResumeFailure(testProjectRoot, testModel, testChatId);
			expect(getCachedChatId(testProjectRoot, testModel)).toBe(testChatId);

			// Mark second failure - should be removed
			markResumeFailure(testProjectRoot, testModel, testChatId);
			expect(getCachedChatId(testProjectRoot, testModel)).toBeNull();
		});

		it('should reset resume attempts on successful session update', () => {
			configureCaching({
				enabled: true,
				maxResumeAttempts: 2
			});

			// Cache initial session
			cacheChatId(testProjectRoot, testModel, testChatId);

			// Mark a failure
			markResumeFailure(testProjectRoot, testModel, testChatId);

			// Update with new session - should reset attempts
			const newChatId = 'new-chat-456';
			cacheChatId(testProjectRoot, testModel, newChatId, true);

			// Should be available again
			expect(getCachedChatId(testProjectRoot, testModel)).toBe(newChatId);
		});

		it('should handle non-existent session failure gracefully', () => {
			const result = markResumeFailure(
				testProjectRoot,
				testModel,
				'non-existent-chat'
			);
			expect(result).toBe(false);
		});

		it('should update lastUsedAt when accessing storage', () => {
			cacheChatId(testProjectRoot, testModel, testChatId);

			const stats1 = getCacheStats(testProjectRoot);
			const before = stats1.totalSessions;

			// Access the session
			const cachedId = getCachedChatId(testProjectRoot, testModel);
			expect(cachedId).toBe(testChatId);

			// Should still be available (persistent storage)
			const stats2 = getCacheStats(testProjectRoot);
			expect(stats2.totalSessions).toBe(before);
		});
	});

	describe('session limits', () => {
		it('should enforce maximum session limit', () => {
			// Set low limit for testing
			configureCaching({
				enabled: true,
				maxSessions: 5 // Low limit for testing
			});

			// Cache sessions that exceed the limit in the same project
			const sessionIds = [];
			for (let i = 1; i <= 10; i++) {
				const chatId = `chat-${i}`;
				const modelId = `model-${i}`;
				cacheChatId(testProjectRoot, modelId, chatId);
				sessionIds.push(chatId);
			}

			// Should have triggered cleanup to maintain the limit
			const stats = getCacheStats(testProjectRoot);
			expect(stats.totalSessions).toBe(5); // Should be maintained at the limit

			// Most recent sessions should still exist
			expect(getCachedChatId(testProjectRoot, 'model-10')).toBe('chat-10');
			expect(getCachedChatId(testProjectRoot, 'model-9')).toBe('chat-9');
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
			cacheChatId(testProjectRoot, 'sonnet-4', 'chat-1');
			cacheChatId(testProjectRoot, 'gpt-5', 'chat-2');

			expect(getCacheStats(testProjectRoot).totalSessions).toBe(2);

			clearAllSessions(testProjectRoot);

			expect(getCacheStats(testProjectRoot).totalSessions).toBe(0);
		});
	});

	describe('storage statistics', () => {
		it('should provide accurate storage statistics', () => {
			// Initially empty
			let stats = getCacheStats(testProjectRoot);
			expect(stats.totalSessions).toBe(0);
			expect(stats.activeSessions).toBe(0);
			expect(stats.enabled).toBe(true);

			// Add some sessions
			cacheChatId(testProjectRoot, testModel, 'chat-1');
			cacheChatId(testProjectRoot, 'gpt-4', 'chat-2');

			stats = getCacheStats(testProjectRoot);
			expect(stats.totalSessions).toBe(2);
			expect(stats.activeSessions).toBe(2);
			expect(stats.failedSessions).toBe(0);
		});

		it('should track failed sessions in statistics', () => {
			configureCaching({
				enabled: true,
				maxResumeAttempts: 1 // Very low for testing
			});

			cacheChatId(testProjectRoot, testModel, testChatId);

			// Mark as failed (should be removed)
			markResumeFailure(testProjectRoot, testModel, testChatId);

			const stats = getCacheStats(testProjectRoot);
			expect(stats.totalSessions).toBe(0); // Removed after max failures
			expect(stats.activeSessions).toBe(0);
			expect(stats.failedSessions).toBe(0); // Failed sessions are removed
		});

		it('should track age information when sessions exist', () => {
			cacheChatId(testProjectRoot, testModel, testChatId);

			const stats = getCacheStats(testProjectRoot);
			expect(stats.oldestSessionDays).toBeDefined();
			expect(stats.newestSessionDays).toBeDefined();
			expect(typeof stats.oldestSessionDays).toBe('number');
			expect(typeof stats.newestSessionDays).toBe('number');
		});
	});

	describe('configuration', () => {
		it('should accept configuration changes', () => {
			const newConfig = {
				enabled: false,
				maxSessions: 100,
				maxResumeAttempts: 5,
				persistToDisk: false
			};

			configureCaching(newConfig);

			const stats = getCacheStats(testProjectRoot);
			expect(stats.enabled).toBe(false);
			expect(stats.maxSessions).toBe(100);
			expect(stats.maxResumeAttempts).toBe(5);
		});

		it('should merge partial configuration changes', () => {
			// Set initial config
			configureCaching({
				enabled: true,
				maxSessions: 50,
				maxResumeAttempts: 3
			});

			// Change only maxResumeAttempts
			configureCaching({
				maxResumeAttempts: 5
			});

			const stats = getCacheStats(testProjectRoot);
			expect(stats.enabled).toBe(true); // Should remain true
			expect(stats.maxResumeAttempts).toBe(5); // Should be updated
			expect(stats.maxSessions).toBe(50); // Should remain unchanged
		});
	});

	describe('cleanup operations', () => {
		it('should clean up failed sessions manually', () => {
			// Set very low failure threshold for testing
			configureCaching({
				enabled: true,
				maxResumeAttempts: 1
			});

			// Create sessions that will fail
			cacheChatId(testProjectRoot, testModel, 'chat-1');
			cacheChatId(testProjectRoot, 'model-2', 'chat-2');

			// Mark both as failed (they'll be removed automatically)
			markResumeFailure(testProjectRoot, testModel, 'chat-1');
			markResumeFailure(testProjectRoot, 'model-2', 'chat-2');

			expect(getCacheStats(testProjectRoot).totalSessions).toBe(0); // Already removed

			// Create new session that's not failed
			cacheChatId(testProjectRoot, 'new-model', 'chat-3');
			expect(getCacheStats(testProjectRoot).totalSessions).toBe(1);

			// Cleanup should find no failed sessions to remove
			const cleanedCount = cleanupFailedSessions(testProjectRoot);
			expect(cleanedCount).toBe(0);
			expect(getCacheStats(testProjectRoot).totalSessions).toBe(1);
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
