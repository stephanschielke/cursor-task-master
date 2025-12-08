import { execSync, spawn } from 'child_process';
import { jsonrepair } from 'jsonrepair';
import { BaseAIProvider } from './base-provider.js';
import {
	getCursorCliSettingsForCommand,
	getSupportedModelsForProvider
} from '../../scripts/modules/config-manager.js';
import { log } from '../../scripts/modules/utils.js';

const ALLOWED_MODELS = [
	'gpt-5.1-codex',
	'gpt-5.1-codex-high',
	'gpt-5.1-codex-max',
	'gpt-5.1-codex-max-high'
];
const DEFAULT_MODEL_ID = ALLOWED_MODELS[0];
const MAX_STDOUT_BYTES = 5 * 1024 * 1024; // 5MB guardrail to avoid runaway output

function buildPromptFromMessages(messages) {
	return messages
		.map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`)
		.join('\n\n');
}

function extractJsonCandidate(output) {
	// Try direct parse
	try {
		return JSON.parse(output);
	} catch (_) {
		// Look for fenced code block
		const codeBlockMatch = output.match(/```(?:json)?\\s*([\\s\\S]*?)\\s*```/);
		if (codeBlockMatch?.[1]) {
			const candidate = codeBlockMatch[1].trim();
			try {
				return JSON.parse(candidate);
			} catch (_) {
				try {
					return JSON.parse(jsonrepair(candidate));
				} catch (_) {
					// fall through
				}
			}
		}
		// Try repairing entire output
		try {
			return JSON.parse(jsonrepair(output));
		} catch (_) {
			return null;
		}
	}
}

export class CursorCliProvider extends BaseAIProvider {
	constructor() {
		super();
		this.name = 'Cursor CLI';
		this.supportsTemperature = false;
		this.needsExplicitJsonSchema = false;
		this.supportedModels = getSupportedModelsForProvider('cursor-cli');
	}

	isRequiredApiKey() {
		return false;
	}

	getRequiredApiKeyName() {
		return null;
	}

	validateAuth(params = {}) {
		// Ensure CLI is present; fail fast so we never fall back to other providers.
		const settings =
			getCursorCliSettingsForCommand(params.commandName) || DEFAULT_MODEL_ID;
		const cmd = settings.command || 'cursor';
		try {
			execSync(`${cmd} --version`, { stdio: 'ignore', timeout: 2000 });
		} catch (error) {
			throw new Error(
				`Cursor CLI not available (command: '${cmd}'). Install the Cursor CLI and ensure it is on PATH. Original error: ${error.message}`
			);
		}
	}

	_runCursorCli(prompt, params) {
		const settings =
			getCursorCliSettingsForCommand(params.commandName) || DEFAULT_MODEL_ID;
		const {
			command = 'cursor',
			args = ['chat', '--json'],
			timeout = 120000,
			workingDirectory,
			env = {},
			allowNpx = true
		} = settings;

		return new Promise((resolve, reject) => {
			const child = spawn(command, args, {
				cwd: workingDirectory || process.cwd(),
				env: { ...process.env, ...env },
				stdio: ['pipe', 'pipe', 'pipe']
			});

			let stdout = '';
			let stderr = '';
			let killed = false;

			const timer = setTimeout(() => {
				killed = true;
				child.kill('SIGKILL');
				reject(
					new Error(
						`Cursor CLI timed out after ${timeout}ms (command: ${command} ${args.join(' ')})`
					)
				);
			}, timeout);

			child.stdout.on('data', (data) => {
				stdout += data.toString();
				if (stdout.length > MAX_STDOUT_BYTES) {
					killed = true;
					child.kill('SIGKILL');
					reject(
						new Error(
							`Cursor CLI produced too much output (> ${MAX_STDOUT_BYTES} bytes)`
						)
					);
				}
			});

			child.stderr.on('data', (data) => {
				stderr += data.toString();
			});

			child.on('error', (err) => {
				if (killed) return;
				clearTimeout(timer);
				reject(err);
			});

			child.on('close', (code) => {
				clearTimeout(timer);
				if (killed) return;
				if (code !== 0) {
					const message = stderr || `Cursor CLI exited with code ${code}`;
					reject(new Error(message));
					return;
				}
				resolve({ stdout, stderr });
			});

			// Send prompt via stdin
			child.stdin.write(prompt);
			child.stdin.end();
		}).catch((error) => {
			// Optional one-shot npx fallback if command missing and allowNpx enabled
			const allowTransientNpx =
				allowNpx &&
				(error.code === 'ENOENT' ||
					/error.*not found|ENOENT/i.test(error.message || ''));
			if (allowTransientNpx) {
				return this._runCursorCliWithNpx(prompt, params);
			}
			throw error;
		});
	}

	_runCursorCliWithNpx(prompt, params) {
		const settings =
			getCursorCliSettingsForCommand(params.commandName) || DEFAULT_MODEL_ID;
		const {
			args = ['chat', '--json'],
			timeout = 120000,
			workingDirectory,
			env = {}
		} = settings;

		return new Promise((resolve, reject) => {
			const child = spawn('npx', ['cursor', ...args], {
				cwd: workingDirectory || process.cwd(),
				env: { ...process.env, ...env },
				stdio: ['pipe', 'pipe', 'pipe']
			});

			let stdout = '';
			let stderr = '';
			let killed = false;

			const timer = setTimeout(() => {
				killed = true;
				child.kill('SIGKILL');
				reject(
					new Error(
						`Cursor CLI (npx) timed out after ${timeout}ms (command: npx cursor ${args.join(' ')})`
					)
				);
			}, timeout);

			child.stdout.on('data', (data) => {
				stdout += data.toString();
				if (stdout.length > MAX_STDOUT_BYTES) {
					killed = true;
					child.kill('SIGKILL');
					reject(
						new Error(
							`Cursor CLI (npx) produced too much output (> ${MAX_STDOUT_BYTES} bytes)`
						)
					);
				}
			});

			child.stderr.on('data', (data) => {
				stderr += data.toString();
			});

			child.on('error', (err) => {
				if (killed) return;
				clearTimeout(timer);
				reject(err);
			});

			child.on('close', (code) => {
				clearTimeout(timer);
				if (killed) return;
				if (code !== 0) {
					const message = stderr || `Cursor CLI (npx) exited with code ${code}`;
					reject(new Error(message));
					return;
				}
				resolve({ stdout, stderr });
			});

			child.stdin.write(prompt);
			child.stdin.end();
		});
	}

	_createUsage() {
		return {
			inputTokens: 0,
			outputTokens: 0,
			totalTokens: 0
		};
	}

	_enforceModel(modelId) {
		const effectiveModel = modelId || DEFAULT_MODEL_ID;
		if (!ALLOWED_MODELS.includes(effectiveModel)) {
			throw new Error(
				`Cursor CLI model must be one of: ${ALLOWED_MODELS.join(
					', '
				)}. Received '${effectiveModel}'.`
			);
		}
		return effectiveModel;
	}

	async generateText(params) {
		const modelId = this._enforceModel(params.modelId);
		this.validateParams({ ...params, apiKey: null, modelId });
		this.validateAuth(params);
		const prompt = buildPromptFromMessages(params.messages);
		const { stdout } = await this._runCursorCli(prompt, params);

		const parsed = extractJsonCandidate(stdout);
		const text =
			typeof parsed === 'string'
				? parsed
				: parsed?.text || parsed?.message || stdout.trim();

		if (!text) {
			throw new Error('Cursor CLI returned empty response.');
		}

		return {
			text,
			usage: this._createUsage()
		};
	}

	async streamText(params) {
		// Cursor CLI does not provide streaming; fall back to generateText
		return this.generateText(params);
	}

	async generateObject(params) {
		const modelId = this._enforceModel(params.modelId);
		this.validateParams({ ...params, apiKey: null, modelId });
		this.validateAuth(params);

		const prompt = buildPromptFromMessages(params.messages);
		const { stdout } = await this._runCursorCli(prompt, params);
		const parsed = extractJsonCandidate(stdout);

		if (!parsed || typeof parsed !== 'object') {
			throw new Error(
				'Cursor CLI did not return valid JSON. Enable debug and check stdout for details.'
			);
		}

		return {
			object: parsed,
			usage: this._createUsage()
		};
	}

	async streamObject(params) {
		// No streaming support; return full object result as a single chunk structure
		const result = await this.generateObject(params);
		return {
			...result,
			partialObjectStream: null
		};
	}
}

export default CursorCliProvider;
