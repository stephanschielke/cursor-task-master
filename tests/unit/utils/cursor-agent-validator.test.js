/**
 * Tests for CursorAgentValidator - Configuration validation for cursor-agent CLI
 *
 * This test suite covers:
 * 1. cursor-agent CLI availability checking
 * 2. Model validation against MODEL_MAP
 * 3. Health check functionality
 * 4. Error categorization and user-friendly messaging
 * 5. Cache management and performance
 * 6. Configuration validation scenarios
 */

import { jest } from '@jest/globals';

// Create accessible mock functions
const mockExecSync = jest.fn();
const mockLog = jest.fn();

// Mock external dependencies BEFORE importing the module under test
jest.unstable_mockModule('child_process', () => ({
	execSync: mockExecSync
}));

jest.unstable_mockModule('../../../scripts/modules/utils.js', () => ({
	log: mockLog
}));

// Import after mocking
const { CursorAgentValidator, cursorAgentValidator, validateCursorAgentModel, checkCursorAgentHealth } = await import('../../../src/utils/cursor-agent-validator.js');
const { execSync } = await import('child_process');

jest.mock('../../../scripts/modules/config-manager.js', () => ({
	MODEL_MAP: {
		'cursor-agent': [
			{
				id: 'sonnet-4',
				swe_score: 0.727,
				cost_per_1m_tokens: { input: 0, output: 0 },
				allowed_roles: ['main', 'fallback', 'research'],
				max_tokens: 64000,
				supported: true
			},
			{
				id: 'gpt-5',
				swe_score: 0.749,
				cost_per_1m_tokens: { input: 0, output: 0 },
				allowed_roles: ['main', 'fallback', 'research'],
				max_tokens: 32000,
				supported: true
			},
			{
				id: 'opus',
				swe_score: 0.725,
				cost_per_1m_tokens: { input: 0, output: 0 },
				allowed_roles: ['main', 'fallback', 'research'],
				max_tokens: 32000,
				supported: true
			},
			{
				id: 'unsupported-model',
				supported: false
			}
		]
	}
}));

// Import mocked modules
import { log } from '../../../scripts/modules/utils.js';

describe('CursorAgentValidator', () => {
	let validator;

	beforeEach(() => {
		jest.clearAllMocks();
		validator = new CursorAgentValidator();
		validator.clearCache(); // Ensure clean state for each test
		
		// Reset mockExecSync with default behavior
		mockExecSync.mockReturnValue('cursor-agent version 1.0.0\n');
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	describe('Constructor and Basic Properties', () => {
		test('should instantiate with correct properties', () => {
			expect(validator.name).toBe('CursorAgentValidator');
			expect(validator._cachedAvailability).toBeNull();
			expect(validator._cachedModels).toBeNull();
		});

		test('should export singleton instance', () => {
			expect(cursorAgentValidator).toBeInstanceOf(CursorAgentValidator);
		});
	});

	describe('checkCursorAgentAvailability', () => {
		test('should return available when cursor-agent is installed', async () => {
			mockExecSync.mockReturnValue('cursor-agent version 1.0.0\n');

			const result = await validator.checkCursorAgentAvailability();

			expect(result.available).toBe(true);
			expect(result.version).toBe('cursor-agent version 1.0.0');
			expect(mockExecSync).toHaveBeenCalledWith('cursor-agent --version', {
				encoding: 'utf8',
				timeout: 5000,
				stdio: 'pipe'
			});
		});

		test('should return unavailable when cursor-agent is not found', async () => {
			const mockError = new Error('command not found: cursor-agent');
			mockExecSync.mockImplementation(() => {
				throw mockError;
			});

			const result = await validator.checkCursorAgentAvailability();

			expect(result.available).toBe(false);
			expect(result.error).toContain('not installed or not in PATH');
		});

		test('should handle timeout errors', async () => {
			const mockError = new Error('timeout exceeded');
			mockExecSync.mockImplementation(() => {
				throw mockError;
			});

			const result = await validator.checkCursorAgentAvailability();

			expect(result.available).toBe(false);
			expect(result.error).toContain('timeout');
		});

		test('should handle permission errors', async () => {
			const mockError = new Error('Permission denied');
			mockExecSync.mockImplementation(() => {
				throw mockError;
			});

			const result = await validator.checkCursorAgentAvailability();

			expect(result.available).toBe(false);
			expect(result.error).toContain('Permission denied');
		});

		test('should cache results by default', async () => {
			mockExecSync.mockReturnValue('cursor-agent version 1.0.0\n');

			// First call
			const result1 = await validator.checkCursorAgentAvailability();
			// Second call  
			const result2 = await validator.checkCursorAgentAvailability();

			expect(result1).toBe(result2); // Should be same object reference
			expect(mockExecSync).toHaveBeenCalledTimes(1); // Should only call CLI once
		});

		test('should bypass cache when useCache is false', async () => {
			mockExecSync.mockReturnValue('cursor-agent version 1.0.0\n');

			// First call
			await validator.checkCursorAgentAvailability();
			// Second call with cache disabled
			await validator.checkCursorAgentAvailability({ useCache: false });

			expect(mockExecSync).toHaveBeenCalledTimes(2);
		});
	});

	describe('validateModel', () => {
		test('should validate supported model successfully', async () => {
			const result = await validator.validateModel('sonnet-4');

			expect(result.valid).toBe(true);
			expect(result.supported).toBe(true);
			expect(result.error).toBeUndefined();
		});

		test('should reject unknown model', async () => {
			const result = await validator.validateModel('unknown-model');

			expect(result.valid).toBe(false);
			expect(result.supported).toBe(false);
			expect(result.suggestion).toBeDefined();
		});

		test('should reject unsupported model', async () => {
			const result = await validator.validateModel('unsupported-model');

			expect(result.valid).toBe(false);
			expect(result.supported).toBe(false);
			expect(result.suggestion).toBeDefined(); // Unknown models get suggestions, not errors
			expect(result.error).toBeUndefined(); // Unknown models don't have error messages
		});

		test('should suggest alternative models', async () => {
			const result = await validator.validateModel('sonnet-unknown');

			expect(result.valid).toBe(false);
			expect(result.suggestion).toBe('sonnet-4'); // Should suggest sonnet variant
		});

		test('should suggest gpt alternative for gpt models', async () => {
			const result = await validator.validateModel('gpt-unknown');

			expect(result.valid).toBe(false);
			expect(result.suggestion).toBe('gpt-5'); // Should suggest gpt variant
		});

		test('should handle validation errors gracefully', async () => {
			// Mock an error in the validation process
			jest.spyOn(validator, '_testModelWithCLI').mockRejectedValue(new Error('Test error'));

			const result = await validator.validateModel('sonnet-4');

			expect(mockLog).toHaveBeenCalled();
			expect(result.valid).toBe(false);
		});
	});

	describe('performHealthCheck', () => {
		test('should pass health check with valid configuration', async () => {
			mockExecSync.mockReturnValue('cursor-agent version 1.0.0\n');

			const config = {
				models: {
					main: { provider: 'cursor-agent', modelId: 'sonnet-4' },
					fallback: { provider: 'anthropic', modelId: 'claude-3-5-sonnet' }
				}
			};

			const result = await validator.performHealthCheck(config);

			expect(result.healthy).toBe(true);
			expect(result.issues.filter(i => i.type === 'critical')).toHaveLength(0);
		});

		test('should fail health check when cursor-agent unavailable', async () => {
			mockExecSync.mockImplementation(() => {
				throw new Error('command not found');
			});

			const result = await validator.performHealthCheck({});

			expect(result.healthy).toBe(false);
			expect(result.issues.some(i => i.type === 'critical')).toBe(true);
			expect(result.recommendations).toContain('Run: npm install -g @cursor/cursor-agent');
		});

		test('should warn about invalid models', async () => {
			mockExecSync.mockReturnValue('cursor-agent version 1.0.0\n');

			const config = {
				models: {
					main: { provider: 'cursor-agent', modelId: 'invalid-model' }
				}
			};

			const result = await validator.performHealthCheck(config);

			expect(result.issues.some(i => 
				i.type === 'warning' && 
				i.message.includes('Invalid cursor-agent model')
			)).toBe(true);
		});

		test('should recommend fallback provider', async () => {
			mockExecSync.mockReturnValue('cursor-agent version 1.0.0\n');

			const config = {
				models: {
					main: { provider: 'cursor-agent', modelId: 'sonnet-4' }
					// No fallback provider
				}
			};

			const result = await validator.performHealthCheck(config);

			expect(result.recommendations.some(r => 
				r.includes('fallback provider')
			)).toBe(true);
		});

		test('should handle health check errors gracefully', async () => {
			// Mock an error in the health check process
			mockExecSync.mockImplementation(() => {
				throw new Error('Unexpected error');
			});

			const result = await validator.performHealthCheck({});

			expect(result.healthy).toBe(false);
			expect(result.issues.some(i => i.type === 'critical')).toBe(true);
		});
	});

	describe('getAvailableModels', () => {
		test('should return list of supported models', () => {
			const models = validator.getAvailableModels();

			expect(models).toHaveLength(3); // sonnet-4, gpt-5, opus
			expect(models[0]).toHaveProperty('id');
			expect(models[0]).toHaveProperty('name');
			expect(models[0]).toHaveProperty('swe_score');
			expect(models[0]).toHaveProperty('max_tokens');
		});

		test('should cache models list', () => {
			const models1 = validator.getAvailableModels();
			const models2 = validator.getAvailableModels();

			expect(models1).toBe(models2); // Should be same object reference
		});

		test('should provide display names for known models', () => {
			const models = validator.getAvailableModels();
			const sonnet = models.find(m => m.id === 'sonnet-4');
			const gpt = models.find(m => m.id === 'gpt-5');

			expect(sonnet.name).toBe('Claude 4 (Sonnet)');
			expect(gpt.name).toBe('GPT-5');
		});
	});

	describe('Cache Management', () => {
		test('should clear all caches', async () => {
			mockExecSync.mockReturnValue('cursor-agent version 1.0.0\n');

			// Populate caches
			await validator.checkCursorAgentAvailability();
			validator.getAvailableModels();

			expect(validator._cachedAvailability).not.toBeNull();
			expect(validator._cachedModels).not.toBeNull();

			// Clear caches
			validator.clearCache();

			expect(validator._cachedAvailability).toBeNull();
			expect(validator._cachedModels).toBeNull();
		});
	});

	describe('Utility Functions', () => {
		test('validateCursorAgentModel should work as standalone function', async () => {
			const result = await validateCursorAgentModel('sonnet-4');

			expect(result).toHaveProperty('valid');
			expect(result).toHaveProperty('supported');
		});

		test('checkCursorAgentHealth should work as standalone function', async () => {
			mockExecSync.mockReturnValue('cursor-agent version 1.0.0\n');

			const result = await checkCursorAgentHealth({});

			expect(result).toHaveProperty('healthy');
			expect(result).toHaveProperty('issues');
			expect(result).toHaveProperty('recommendations');
		});
	});

	describe('Error Categorization', () => {
		test('should categorize ENOENT errors', async () => {
			const mockError = new Error('spawn cursor-agent ENOENT');
			mockExecSync.mockImplementation(() => {
				throw mockError;
			});

			const result = await validator.checkCursorAgentAvailability();

			expect(result.error).toContain('executable not found');
		});

		test('should provide generic error for unknown error types', async () => {
			const mockError = new Error('Some unexpected error');
			mockExecSync.mockImplementation(() => {
				throw mockError;
			});

			const result = await validator.checkCursorAgentAvailability();

			expect(result.error).toContain('cursor-agent CLI execution failed');
		});
	});
});

// Test fixtures for reuse
export const createMockCursorAgentConfig = (overrides = {}) => {
	return {
		models: {
			main: { provider: 'cursor-agent', modelId: 'sonnet-4' },
			fallback: { provider: 'anthropic', modelId: 'claude-3-5-sonnet' },
			...overrides
		}
	};
};

export const mockCursorAgentAvailable = () => {
	mockExecSync.mockReturnValue('cursor-agent version 1.0.0\n');
};

export const mockCursorAgentUnavailable = (errorType = 'not found') => {
	const errorMessages = {
		'not found': 'command not found: cursor-agent',
		'timeout': 'timeout exceeded',
		'permission': 'Permission denied'
	};

	mockExecSync.mockImplementation(() => {
		throw new Error(errorMessages[errorType] || errorMessages['not found']);
	});
};
