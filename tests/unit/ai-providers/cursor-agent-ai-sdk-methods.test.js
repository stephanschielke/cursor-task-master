/**
 * tests/unit/ai-providers/cursor-agent-ai-sdk-methods.test.js
 *
 * Comprehensive tests for CursorAgentProvider AI SDK method compatibility
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { CursorAgentProvider } from '../../../src/ai-providers/cursor-agent.js';

// Mock dependencies
jest.mock('child_process');
jest.mock('fs');
jest.mock('../../../scripts/modules/utils.js', () => ({
    log: jest.fn()
}));
jest.mock('../../../src/utils/timeout-manager.js');
jest.mock('../../../src/utils/cursor-agent-session-manager.js', () => ({
    sessionManager: {
        registerSession: jest.fn(),
        updateSessionActivity: jest.fn(),
        cleanupSession: jest.fn(),
        getSessionStats: jest.fn(() => ({}))
    }
}));
jest.mock('../../../src/progress/cursor-agent-progress-tracker.js');

describe('CursorAgentProvider AI SDK Methods', () => {
    let provider;

    beforeEach(() => {
        provider = new CursorAgentProvider();
        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.resetAllMocks();
    });

    describe('getClient() - AI SDK Interface', () => {
        it('should return AI SDK compatible client interface', () => {
            const params = { modelId: 'sonnet-4' };
            const client = provider.getClient(params);

            expect(client).toBeDefined();
            expect(typeof client.generateText).toBe('function');
            expect(typeof client.generateObject).toBe('function');
            expect(typeof client.streamText).toBe('function');
        });

        it('should handle client initialization errors', () => {
            // Mock provider to throw error
            jest.spyOn(provider, 'generateText').mockImplementation(() => {
                throw new Error('Test error');
            });

            expect(() => provider.getClient({})).not.toThrow();
        });

        it('should pass provider parameters to methods', async () => {
            const params = { modelId: 'sonnet-4', commandName: 'test' };
            const mockGenerateText = jest.spyOn(provider, 'generateText')
                .mockResolvedValue({
                    text: 'test response',
                    usage: { totalTokens: 100, promptTokens: 50, completionTokens: 50 },
                    finishReason: 'stop'
                });

            const client = provider.getClient(params);
            await client.generateText({ messages: 'test prompt' });

            expect(mockGenerateText).toHaveBeenCalledWith(
                { messages: 'test prompt' },
                params
            );
        });
    });

    describe('generateText() - Usage Metrics & Response Handling', () => {
        it('should return proper AI SDK compatible response structure', async () => {
            // Mock executeCursorAgent to return valid cursor-agent response
            jest.spyOn(provider, 'executeCursorAgent').mockResolvedValue({
                result: 'Generated text response',
                is_error: false,
                total_tokens: 150,
                input_tokens: 75,
                output_tokens: 75,
                session_id: 'test-session',
                request_id: 'test-request'
            });

            const result = await provider.generateText({
                messages: 'Test prompt',
                model: 'sonnet-4'
            });

            // Verify AI SDK compatible structure
            expect(result).toHaveProperty('text');
            expect(result).toHaveProperty('usage');
            expect(result).toHaveProperty('finishReason');

            expect(result.text).toBe('Generated text response');
            expect(result.usage.totalTokens).toBe(150);
            expect(result.usage.promptTokens).toBe(75);
            expect(result.usage.completionTokens).toBe(75);
            expect(result.finishReason).toBe('stop');
        });

        it('should handle cursor-agent error responses correctly', async () => {
            jest.spyOn(provider, 'executeCursorAgent').mockResolvedValue({
                result: 'Error message',
                is_error: true
            });

            await expect(provider.generateText({
                messages: 'Test prompt'
            })).rejects.toThrow('Cursor Agent error: Error message');
        });

        it('should handle missing token information gracefully', async () => {
            jest.spyOn(provider, 'executeCursorAgent').mockResolvedValue({
                result: 'Generated text',
                is_error: false
                // Missing token fields
            });

            const result = await provider.generateText({
                messages: 'Test prompt'
            });

            expect(result.usage.totalTokens).toBe(0);
            expect(result.usage.promptTokens).toBe(0);
            expect(result.usage.completionTokens).toBe(0);
        });

        it('should propagate progress tracker updates', async () => {
            const mockProgressTracker = {
                updateProgress: jest.fn(),
                updateTokensWithCost: jest.fn(),
                complete: jest.fn(),
                error: jest.fn()
            };

            jest.spyOn(provider, 'executeCursorAgent').mockResolvedValue({
                result: 'Generated text',
                is_error: false,
                total_tokens: 100,
                input_tokens: 60,
                output_tokens: 40
            });

            await provider.generateText({
                messages: 'Test prompt',
                progressTracker: mockProgressTracker
            });

            expect(mockProgressTracker.updateProgress).toHaveBeenCalledWith(0, 'Preparing cursor-agent request');
            expect(mockProgressTracker.updateProgress).toHaveBeenCalledWith(0.1, 'Executing cursor-agent');
            expect(mockProgressTracker.updateProgress).toHaveBeenCalledWith(0.9, 'Processing cursor-agent response');
            expect(mockProgressTracker.updateTokensWithCost).toHaveBeenCalledWith(60, 40, 0, 0, false);
            expect(mockProgressTracker.complete).toHaveBeenCalledWith('Text generation completed');
        });
    });

    describe('generateObject() - Schema Instructions & JSON Parsing', () => {
        beforeEach(() => {
            // Mock generateText for generateObject dependency
            jest.spyOn(provider, 'generateText').mockResolvedValue({
                text: '{"title": "Test Task", "description": "Test Description"}',
                usage: { totalTokens: 100, promptTokens: 50, completionTokens: 50 },
                finishReason: 'stop'
            });
        });

        it('should return proper AI SDK compatible object response structure', async () => {
            const result = await provider.generateObject({
                messages: 'Create a task',
                schema: { type: 'object' },
                objectName: 'newTaskData'
            });

            expect(result).toHaveProperty('object');
            expect(result).toHaveProperty('usage');
            expect(result).toHaveProperty('finishReason');

            expect(result.object).toEqual({
                title: 'Test Task',
                description: 'Test Description'
            });
            expect(result.finishReason).toBe('stop');
        });

        it('should build correct schema instructions for newTaskData', async () => {
            const schemaInstructions = provider._buildSchemaInstructions({}, 'newTaskData');

            expect(schemaInstructions).toContain('Return a JSON object with exactly this structure');
            expect(schemaInstructions).toContain('"title"');
            expect(schemaInstructions).toContain('"description"');
            expect(schemaInstructions).toContain('"details"');
            expect(schemaInstructions).toContain('"testStrategy"');
            expect(schemaInstructions).toContain('"dependencies": null');
        });

        it('should build correct schema instructions for PRD parsing', async () => {
            const mockSchema = {
                properties: {
                    tasks: { type: 'array' },
                    metadata: { type: 'object' }
                }
            };

            const schemaInstructions = provider._buildSchemaInstructions(mockSchema, 'prd_data');

            expect(schemaInstructions).toContain('"tasks"');
            expect(schemaInstructions).toContain('"metadata"');
            expect(schemaInstructions).toContain('do NOT wrap in');
            expect(schemaInstructions).toContain('generatedAt');
        });

        it('should handle malformed JSON with repair', async () => {
            // Mock generateText to return malformed JSON
            jest.spyOn(provider, 'generateText').mockResolvedValue({
                text: '{"title": "Test Task", "description": "Test Description"', // Missing closing brace
                usage: { totalTokens: 100, promptTokens: 50, completionTokens: 50 },
                finishReason: 'stop'
            });

            // Mock jsonrepair
            const mockJsonRepair = jest.fn().mockReturnValue('{"title": "Test Task", "description": "Test Description"}');
            jest.doMock('jsonrepair', () => ({ jsonrepair: mockJsonRepair }));

            const result = await provider.generateObject({
                messages: 'Create a task',
                schema: { type: 'object' },
                objectName: 'newTaskData'
            });

            expect(result.object).toEqual({
                title: 'Test Task',
                description: 'Test Description'
            });
        });

        it('should extract JSON from text wrapped response', async () => {
            jest.spyOn(provider, 'generateText').mockResolvedValue({
                text: 'Here is the JSON: {"title": "Test Task"} as requested.',
                usage: { totalTokens: 100, promptTokens: 50, completionTokens: 50 },
                finishReason: 'stop'
            });

            const result = await provider.generateObject({
                messages: 'Create a task',
                schema: { type: 'object' },
                objectName: 'newTaskData'
            });

            expect(result.object).toEqual({ title: 'Test Task' });
        });

        it('should handle invalid JSON responses with proper error', async () => {
            jest.spyOn(provider, 'generateText').mockResolvedValue({
                text: 'This is not JSON at all',
                usage: { totalTokens: 100, promptTokens: 50, completionTokens: 50 },
                finishReason: 'stop'
            });

            await expect(provider.generateObject({
                messages: 'Create a task',
                schema: { type: 'object' },
                objectName: 'newTaskData'
            })).rejects.toThrow('No JSON structure found in response');
        });
    });

    describe('streamObject() - Streaming Interface', () => {
        beforeEach(() => {
            jest.spyOn(provider, 'generateObject').mockResolvedValue({
                object: { title: 'Test Task', description: 'Test Description' },
                usage: { totalTokens: 100, promptTokens: 50, completionTokens: 50 },
                finishReason: 'stop'
            });
        });

        it('should return proper streaming interface with partialObjectStream', async () => {
            const result = await provider.streamObject({
                messages: 'Create a task',
                schema: { type: 'object' },
                objectName: 'newTaskData'
            });

            expect(result).toHaveProperty('partialObjectStream');
            expect(result).toHaveProperty('object');
            expect(result).toHaveProperty('usage');
            expect(result).toHaveProperty('finishReason');

            // Test the generator
            expect(typeof result.partialObjectStream).toBe('function');
            const generator = result.partialObjectStream();
            const firstYield = await generator.next();

            expect(firstYield.value).toEqual({
                title: 'Test Task',
                description: 'Test Description'
            });
            expect(firstYield.done).toBe(false);

            const secondYield = await generator.next();
            expect(secondYield.done).toBe(true);
        });

        it('should handle errors from generateObject', async () => {
            jest.spyOn(provider, 'generateObject').mockRejectedValue(new Error('Generation failed'));

            await expect(provider.streamObject({
                messages: 'Create a task'
            })).rejects.toThrow('Cursor Agent streamObject failed: Generation failed');
        });
    });

    describe('Model Mapping Validation', () => {
        it('should correctly map TaskMaster model IDs to cursor-agent models', () => {
            expect(provider.mapModelIdToCursorAgent('sonnet-4')).toBe('sonnet');
            expect(provider.mapModelIdToCursorAgent('gpt-5')).toBe('gpt-5');
            expect(provider.mapModelIdToCursorAgent('opus')).toBe('opus');
            expect(provider.mapModelIdToCursorAgent('sonnet')).toBe('sonnet');
            expect(provider.mapModelIdToCursorAgent('gpt5')).toBe('gpt-5');
        });

        it('should return original model ID for unmapped models', () => {
            expect(provider.mapModelIdToCursorAgent('unknown-model')).toBe('unknown-model');
            expect(provider.mapModelIdToCursorAgent('claude-3')).toBe('claude-3');
        });

        it('should handle empty or null model IDs', () => {
            expect(provider.mapModelIdToCursorAgent(null)).toBeNull();
            expect(provider.mapModelIdToCursorAgent(undefined)).toBeUndefined();
            expect(provider.mapModelIdToCursorAgent('')).toBe('');
        });
    });

    describe('buildCursorAgentArgs() - Command Line Arguments', () => {
        it('should build correct arguments for different models', () => {
            const args1 = provider.buildCursorAgentArgs({ model: 'sonnet-4' });
            expect(args1).toEqual(['cursor-agent', 'sonnet', '--print', '--with-diffs']);

            const args2 = provider.buildCursorAgentArgs({ model: 'gpt-5' });
            expect(args2).toEqual(['cursor-agent', 'gpt-5', '--print', '--with-diffs']);
        });

        it('should handle API key parameter', () => {
            const args = provider.buildCursorAgentArgs({
                model: 'sonnet',
                apiKey: 'test-api-key'
            });

            expect(args).toContain('--api-key');
            expect(args).toContain('test-api-key');
        });

        it('should handle withDiffs parameter', () => {
            const argsWithDiffs = provider.buildCursorAgentArgs({
                model: 'sonnet',
                withDiffs: true
            });
            expect(argsWithDiffs).toContain('--with-diffs');

            const argsWithoutDiffs = provider.buildCursorAgentArgs({
                model: 'sonnet',
                withDiffs: false
            });
            expect(argsWithoutDiffs).not.toContain('--with-diffs');
        });

        it('should ignore cursor-agent placeholder API key', () => {
            const args = provider.buildCursorAgentArgs({
                model: 'sonnet',
                apiKey: 'cursor-agent-no-key-required'
            });

            expect(args).not.toContain('--api-key');
        });
    });
});
