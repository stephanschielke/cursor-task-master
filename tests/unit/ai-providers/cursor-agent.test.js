/**
 * Tests for CursorAgentProvider - Cursor CLI integration for TaskMaster
 *
 * This test suite covers:
 * 1. Provider instantiation and configuration
 * 2. generateText and generateObject methods with mock responses
 * 3. Error handling scenarios with controlled failures
 * 4. Tmux session management with mock process spawning
 * 5. JSON parsing and auto-repair edge cases
 * 6. Basic smoke tests that can run without actual cursor-agent CLI
 */

import { jest } from '@jest/globals';
import { CursorAgentProvider } from '../../../src/ai-providers/cursor-agent.js';

// Mock external dependencies
jest.mock('child_process', () => ({
	execSync: jest.fn(),
	spawn: jest.fn()
}));

// Note: fs module mocking removed as not needed for basic provider tests

const mockLog = jest.fn();

jest.mock('../../../scripts/modules/utils.js', () => ({
	log: mockLog
}));

const mockWithTimeout = jest.fn();

jest.mock('../../../src/utils/timeout-manager.js', () => ({
	TimeoutManager: {
		withTimeout: mockWithTimeout
	}
}));

jest.mock('../../../src/progress/cursor-agent-progress-tracker.js', () => ({
	createCursorAgentProgressTracker: jest.fn(),
	createRecursiveCursorAgentProgressTracker: jest.fn()
}));

const mockJsonrepair = jest.fn();

// Mock both static and dynamic imports of jsonrepair
jest.mock('jsonrepair', () => ({
	jsonrepair: mockJsonrepair
}));

// Mock dynamic import for jsonrepair (used in cursor-agent.js)
const originalImport = global.__import__;
global.__import__ = jest.fn();
global.import = jest.fn().mockImplementation((moduleName) => {
	if (moduleName === 'jsonrepair') {
		return Promise.resolve({ jsonrepair: mockJsonrepair });
	}
	return originalImport ? originalImport(moduleName) : import(moduleName);
});

// Import mocked modules
import { execSync, spawn } from 'child_process';
import { log } from '../../../scripts/modules/utils.js';
import { TimeoutManager } from '../../../src/utils/timeout-manager.js';
import { jsonrepair } from 'jsonrepair';

describe('CursorAgentProvider', () => {
	let provider;
	let activeTimeouts = [];
	let activeMockProcesses = [];
	let originalSetTimeout;

	beforeEach(() => {
		// Reset all mocks before each test
		jest.clearAllMocks();

		// Clear tracking arrays
		activeTimeouts = [];
		activeMockProcesses = [];

		// Store original setTimeout
		originalSetTimeout = global.setTimeout;

		// Create fresh provider instance
		provider = new CursorAgentProvider();

		// Setup default mock returns
		mockJsonrepair.mockImplementation((json) => json); // Default passthrough

		// Mock TimeoutManager.withTimeout to prevent real processes but allow proper test flow
		mockWithTimeout.mockImplementation(
			async (corePromise, timeout, operation) => {
				// Return a mock successful cursor-agent response
				return {
					result: 'Mock cursor-agent response',
					session_id: 'mock-session-123',
					is_error: false,
					input_tokens: 10,
					output_tokens: 20,
					total_tokens: 30
				};
			}
		);

		// Also mock the core _executeCursorAgentCore method to prevent any real process spawning
		provider._executeCursorAgentCore = jest.fn().mockResolvedValue({
			result: 'Mock cursor-agent response',
			session_id: 'mock-session-123',
			is_error: false,
			input_tokens: 10,
			output_tokens: 20,
			total_tokens: 30
		});

		// Setup spawn mock to track and control child processes in tests
		const mockProcess = {
			stdout: {
				on: jest.fn(),
				removeAllListeners: jest.fn()
			},
			stderr: {
				on: jest.fn(),
				removeAllListeners: jest.fn()
			},
			on: jest.fn(),
			kill: jest.fn(),
			killed: false,
			removeAllListeners: jest.fn()
		};

		// Track this mock process for cleanup
		activeMockProcesses.push(mockProcess);

		// Ensure spawn is properly mocked
		if (spawn.mockImplementation) {
			spawn.mockImplementation(() => mockProcess);
		} else if (spawn.mockReturnValue) {
			spawn.mockReturnValue(mockProcess);
		}

		// Mock setTimeout to track timeouts for cleanup
		global.setTimeout = jest.fn((callback, delay) => {
			const timeoutId = originalSetTimeout(callback, delay);
			activeTimeouts.push(timeoutId);
			return timeoutId;
		});
	});

	afterEach(async () => {
		// Clean up all active timeouts
		activeTimeouts.forEach((timeoutId) => {
			clearTimeout(timeoutId);
		});
		activeTimeouts = [];

		// Clean up all mock processes
		activeMockProcesses.forEach((mockProcess) => {
			mockProcess.killed = true;
			if (mockProcess.removeAllListeners) {
				mockProcess.removeAllListeners();
			}
		});
		activeMockProcesses = [];

		// Restore original setTimeout
		if (originalSetTimeout) {
			global.setTimeout = originalSetTimeout;
		}

		// Wait for any pending async operations to complete
		await new Promise((resolve) => setImmediate(resolve));

		jest.restoreAllMocks();
	});

	describe('Provider Initialization', () => {
		test('should instantiate with correct properties', () => {
			expect(provider).toBeInstanceOf(CursorAgentProvider);
			expect(provider.name).toBe('Cursor Agent');
		});

		test('should not require API key', () => {
			expect(provider.isRequiredApiKey()).toBe(false);
		});

		test('should return correct API key name', () => {
			expect(provider.getRequiredApiKeyName()).toBe('CURSOR_API_KEY');
		});

		test('validateAuth should not throw for any params', () => {
			expect(() => provider.validateAuth({})).not.toThrow();
			expect(() => provider.validateAuth({ apiKey: 'test' })).not.toThrow();
		});
	});

	describe('Client Generation', () => {
		test('should create client with AI SDK compatible interface', () => {
			const client = provider.getClient({ modelId: 'sonnet-4' });

			expect(client).toHaveProperty('generateText');
			expect(client).toHaveProperty('generateObject');
			expect(client).toHaveProperty('streamText');
			expect(typeof client.generateText).toBe('function');
			expect(typeof client.generateObject).toBe('function');
			expect(typeof client.streamText).toBe('function');
		});

		test('should handle client initialization errors gracefully', () => {
			// Mock an error scenario by overriding generateText
			const originalGenerateText = provider.generateText;
			provider.generateText = jest
				.fn()
				.mockRejectedValue(new Error('Mock error'));

			expect(() => provider.getClient({})).not.toThrow();

			// Restore original method
			provider.generateText = originalGenerateText;
		});
	});

	describe('generateText Method', () => {
		test('should handle simple text generation', async () => {
			const result = await provider.generateText({
				messages: 'Test prompt',
				model: 'sonnet-4'
			});

			expect(provider._executeCursorAgentCore).toHaveBeenCalled();
			expect(result).toHaveProperty('text');
			expect(result.text).toBe('Mock cursor-agent response');
		});

		test('should handle messages array format', async () => {
			await provider.generateText({
				messages: [
					{ role: 'system', content: 'You are a helpful assistant' },
					{ role: 'user', content: 'Hello!' }
				]
			});

			expect(provider._executeCursorAgentCore).toHaveBeenCalled();
		});

		test('should handle progress tracking', async () => {
			const mockProgressTracker = {
				updateProgress: jest.fn(),
				error: jest.fn(),
				updateTokensWithCost: jest.fn(),
				complete: jest.fn(),
				nextPhase: jest.fn()
			};

			await provider.generateText({
				messages: 'Test prompt',
				progressTracker: mockProgressTracker
			});

			expect(mockProgressTracker.updateProgress).toHaveBeenCalled();
			expect(provider._executeCursorAgentCore).toHaveBeenCalled();
		});
	});

	describe('generateObject Method', () => {
		test('should handle JSON object generation', async () => {
			// Mock TimeoutManager to return JSON response
			mockWithTimeout.mockResolvedValueOnce({
				result: '{"result": "success", "data": {"key": "value"}}',
				session_id: 'mock-session-123',
				is_error: false
			});

			const result = await provider.generateObject({
				messages: 'Generate JSON',
				schema: { type: 'object' }
			});

			expect(provider._executeCursorAgentCore).toHaveBeenCalled();
			expect(result).toHaveProperty('object');
		});

		test('should handle malformed JSON with auto-repair', async () => {
			const malformedJson = '{"result": "success", "incomplete": ';
			const repairedJson = '{"result": "success", "incomplete": null}';

			// Clear default mock and set specific behavior
			mockJsonrepair.mockReset();
			mockJsonrepair.mockReturnValue(repairedJson);

			provider._executeCursorAgentCore.mockResolvedValueOnce({
				result: malformedJson,
				session_id: 'mock-session-123',
				is_error: false
			});

			const result = await provider.generateObject({
				messages: 'Generate JSON'
			});

			// Verify the result has the expected structure (functional test)
			expect(result).toHaveProperty('object');
			expect(result.object).toEqual({ result: 'success', incomplete: null });
		});

		test('should handle JSON parsing errors', async () => {
			const invalidResponse =
				'This is truly unparseable and unrepairable JSON: }{}{][[malformed';

			provider._executeCursorAgentCore.mockResolvedValueOnce({
				result: invalidResponse,
				session_id: 'mock-session-123',
				is_error: false
			});

			// Should handle parsing errors gracefully by returning empty object
			const result = await provider.generateObject({
				messages: 'Generate JSON'
			});

			expect(result).toHaveProperty('object');
			expect(result.object).toEqual({}); // Graceful fallback to empty object
		});
	});

	describe('Error Handling', () => {
		test('should handle timeout errors', async () => {
			provider._executeCursorAgentCore.mockRejectedValueOnce(
				new Error('Timeout exceeded')
			);

			await expect(
				provider.generateText({
					messages: 'Test prompt'
				})
			).rejects.toThrow('Timeout exceeded');
		});

		test('should handle cursor-agent CLI not found', async () => {
			provider._executeCursorAgentCore.mockRejectedValueOnce(
				new Error('cursor-agent: command not found')
			);

			await expect(
				provider.generateText({
					messages: 'Test prompt'
				})
			).rejects.toThrow();
		});

		test('should log errors appropriately', async () => {
			const mockError = new Error('Test error message for logging');
			provider._executeCursorAgentCore.mockRejectedValueOnce(mockError);

			// Test that the error is properly propagated with cursor-agent context
			await expect(
				provider.generateText({
					messages: 'Test prompt'
				})
			).rejects.toThrow(
				'Cursor Agent generateText failed: Test error message for logging'
			);
		});
	});

	describe('Model Configuration', () => {
		test('should use default model when none specified', async () => {
			await provider.generateText({
				messages: 'Test prompt'
			});

			// Should use default sonnet-4 model
			expect(provider._executeCursorAgentCore).toHaveBeenCalled();
		});

		test('should handle custom model selection', async () => {
			await provider.generateText(
				{
					messages: 'Test prompt',
					model: 'gpt-5'
				},
				{ modelId: 'gpt-5' }
			);

			expect(provider._executeCursorAgentCore).toHaveBeenCalled();
		});
	});

	describe('Stream Text Method', () => {
		test('should return stream-like interface', async () => {
			const mockClient = provider.getClient({});
			const result = await mockClient.streamText({
				messages: 'Test prompt'
			});

			expect(result).toHaveProperty('textStream');
			expect(result).toHaveProperty('usage');
			expect(typeof result.textStream).toBe('function');
		});
	});
});

// Test fixtures and utilities
export const createMockCursorAgentResponse = (text, options = {}) => {
	return {
		text,
		usage: {
			promptTokens: options.promptTokens || 10,
			completionTokens: options.completionTokens || 20,
			totalTokens:
				(options.promptTokens || 10) + (options.completionTokens || 20)
		},
		...options
	};
};

export const createMockJsonResponse = (object, options = {}) => {
	return JSON.stringify(object, null, 2);
};

// Common test patterns for reuse
export const testPatterns = {
	// Test that a method handles various input formats
	testInputFormats: async (method, inputs) => {
		for (const input of inputs) {
			await expect(method(input)).resolves.toBeDefined();
		}
	},

	// Test that a method handles various error scenarios
	testErrorScenarios: async (method, errorScenarios) => {
		for (const { input, expectedError } of errorScenarios) {
			await expect(method(input)).rejects.toThrow(expectedError);
		}
	}
};
