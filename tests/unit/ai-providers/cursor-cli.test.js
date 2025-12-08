/**
 * Basic sanity checks for the Cursor CLI provider.
 * These tests avoid invoking the real Cursor CLI binary.
 */

import { jest } from '@jest/globals';
import { EventEmitter } from 'events';

let CursorCliProvider;
let execSyncMock;
let spawnMock;

beforeAll(async () => {
	execSyncMock = jest.fn();
	spawnMock = jest.fn(() => {
		const stdout = new EventEmitter();
		const stderr = new EventEmitter();
		const proc = new EventEmitter();
		proc.stdout = stdout;
		proc.stderr = stderr;
		proc.stdin = {
			write: jest.fn(),
			end: jest.fn()
		};
		proc.kill = jest.fn();
		process.nextTick(() => proc.emit('close', 0));
		return proc;
	});

	jest.unstable_mockModule('child_process', async () => {
		const actual = await import('child_process');
		return {
			...actual,
			execSync: execSyncMock,
			spawn: spawnMock
		};
	});

	const module = await import('../../../src/ai-providers/cursor-cli.js');
	CursorCliProvider = module.CursorCliProvider;
});

describe('CursorCliProvider', () => {
	afterEach(() => {
		jest.clearAllMocks();
	});

	it('does not require an API key', () => {
		const provider = new CursorCliProvider();
		expect(provider.isRequiredApiKey()).toBe(false);
		expect(provider.getRequiredApiKeyName()).toBeNull();
	});

	it('throws a clear error when cursor CLI is missing', () => {
		execSyncMock.mockImplementation(() => {
			throw new Error('not found');
		});
		const provider = new CursorCliProvider();
		expect(() =>
			provider.validateAuth({ commandName: 'generateText' })
		).toThrow(/Cursor CLI not available/i);
		expect(execSyncMock).toHaveBeenCalled();
	});

	it('enforces allowed models and defaults to gpt-5.1-codex', async () => {
		const provider = new CursorCliProvider();
		const spyRun = jest
			.spyOn(provider, '_runCursorCli')
			.mockResolvedValue({ stdout: '{"text":"ok"}', stderr: '' });
		const result = await provider.generateText({
			modelId: undefined,
			messages: [{ role: 'user', content: 'hi' }]
		});
		expect(result.text).toBe('ok');
		expect(spyRun).toHaveBeenCalled();
	});

	it('rejects disallowed models', async () => {
		const provider = new CursorCliProvider();
		await expect(
			provider.generateText({
				modelId: 'bad-model',
				messages: [{ role: 'user', content: 'hi' }]
			})
		).rejects.toThrow(/must be one of/i);
	});
});
