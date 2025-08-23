/**
 * src/ai-providers/cursor-agent.js
 *
 * Implementation for interacting with Cursor models via cursor-agent CLI
 * This provider leverages your existing Cursor subscription and authentication
 * while providing full workspace context to AI operations.
 */

import { BaseAIProvider } from './base-provider.js';
import { execSync, spawn } from 'child_process';
import fs from 'fs';
import { log } from '../../scripts/modules/utils.js';
import { TimeoutManager } from '../utils/timeout-manager.js';
import { jsonrepair } from 'jsonrepair';
import {
	createCursorAgentProgressTracker,
	createRecursiveCursorAgentProgressTracker
} from '../progress/cursor-agent-progress-tracker.js';
import { sessionManager } from '../utils/cursor-agent-session-manager.js';
import {
	getCachedChatId,
	cacheChatId,
	configureCaching,
	markResumeFailure
} from '../utils/cursor-agent-session-cache.js';

export class CursorAgentProvider extends BaseAIProvider {
	constructor() {
		super();
		this.name = 'Cursor Agent';

		// Configure session caching based on environment variables and defaults
		this.configureSessionCaching();
	}

	/**
	 * Configure session storage based on environment and configuration
	 */
	configureSessionCaching() {
		const storageConfig = {
			// Enable/disable session reuse via environment variable
			enabled: process.env.CURSOR_AGENT_SESSION_REUSE !== 'false', // Default: enabled

			// Max sessions to store (default: 50, increased since no TTL expiration)
			maxSessions: parseInt(process.env.CURSOR_AGENT_MAX_SESSIONS || '50'),

			// Max failed resume attempts before session invalidation (default: 3)
			maxResumeAttempts: parseInt(process.env.CURSOR_AGENT_MAX_RESUME_ATTEMPTS || '3'),

			// Whether to persist sessions to disk (default: true for long-term storage)
			persistToDisk: process.env.CURSOR_AGENT_PERSIST_SESSIONS !== 'false'
		};

		// Configure the session storage
		configureCaching(storageConfig);

		log('Cursor Agent session storage configured', storageConfig);
	}

	getRequiredApiKeyName() {
		return 'CURSOR_API_KEY';
	}

	isRequiredApiKey() {
		// cursor-agent can work without API key if user is logged in
		return false;
	}

	/**
	 * Override validateAuth to handle cursor-agent authentication
	 * cursor-agent uses Cursor's built-in authentication (cursor-agent login)
	 * @param {object} params - Parameters to validate
	 */
	validateAuth(params) {
		// cursor-agent handles authentication internally
		// No API key required if user is logged in via cursor-agent login
		// We could check if user is authenticated, but cursor-agent will handle that
	}

	/**
	 * Creates and returns a Cursor Agent client instance.
	 * @param {object} params - Parameters for client initialization
	 * @param {string} [params.apiKey] - Optional Cursor API key (rarely used)
	 * @param {string} [params.modelId] - Model to use (sonnet-4, gpt-5, etc.)
	 * @param {string} [params.commandName] - Name of the command invoking the service
	 * @returns {Object} Cursor Agent client with AI SDK compatible interface
	 * @throws {Error} If initialization fails
	 */
	getClient(params) {
		try {
			return {
				generateText: async (options) => {
					try {
						// Add model validation before execution
						if (options.model && !this.isModelSupported(options.model)) {
							throw new Error(
								`Unsupported model: ${options.model}. Supported models: ${this.getSupportedModels().join(', ')}`
							);
						}
						return await this.generateText(options, params);
					} catch (error) {
						log('generateText client method error:', error);
						throw new Error(`Generate text failed: ${error.message}`);
					}
				},
				generateObject: async (options) => {
					try {
						// Add model validation before execution
						if (options.model && !this.isModelSupported(options.model)) {
							throw new Error(
								`Unsupported model: ${options.model}. Supported models: ${this.getSupportedModels().join(', ')}`
							);
						}
						return await this.generateObject(options, params);
					} catch (error) {
						log('generateObject client method error:', error);
						throw new Error(`Generate object failed: ${error.message}`);
					}
				},
				streamText: async (options) => {
					try {
						// Enhanced streaming implementation with proper AI SDK interface
						if (options.model && !this.isModelSupported(options.model)) {
							throw new Error(
								`Unsupported model: ${options.model}. Supported models: ${this.getSupportedModels().join(', ')}`
							);
						}

						const result = await this.generateText(options, params);

						return {
							textStream: async function* () {
								// Simulate streaming by yielding chunks of text
								const text = result.text;
								const chunkSize = Math.max(1, Math.floor(text.length / 10)); // 10 chunks

								for (let i = 0; i < text.length; i += chunkSize) {
									const chunk = text.slice(i, i + chunkSize);
									yield chunk;

									// Add small delay to simulate streaming
									await new Promise(resolve => setTimeout(resolve, 50));
								}
							},
							text: result.text,
							usage: result.usage,
							finishReason: result.finishReason
						};
					} catch (error) {
						log('streamText client method error:', error);
						throw new Error(`Stream text failed: ${error.message}`);
					}
				},
				// Add validation method for CLI setup
				validateSetup: async (modelId = null) => {
					try {
						return await this.validateCursorAgentSetup(modelId);
					} catch (error) {
						log('validateSetup client method error:', error);
						throw new Error(`Setup validation failed: ${error.message}`);
					}
				}
			};
		} catch (error) {
			log('cursor-agent client initialization error:', error);
			throw new Error(
				`Cursor Agent client initialization failed: ${error.message}`
			);
		}
	}

	/**
	 * Generate text using cursor-agent CLI
	 * @param {object} options - Generation options
	 * @param {Array|string} options.messages - Messages or prompt
	 * @param {string} [options.model] - Model to use
	 * @param {number} [options.maxTokens] - Maximum tokens
	 * @param {number} [options.temperature] - Temperature setting
	 * @param {object} providerParams - Provider-specific parameters
	 * @returns {Promise<object>} Generated text response
	 */
	async generateText(options, providerParams = {}) {
		const progressTracker =
			options.progressTracker || providerParams.progressTracker;

		try {
			// Start progress tracking if enabled
			if (progressTracker) {
				progressTracker.updateProgress(0, 'Preparing cursor-agent request');
			}

			const prompt = this.formatMessages(options.messages, {
				mode: providerParams.mode || 'recursive'
			});
			const model = options.model || providerParams.modelId || 'sonnet-4';
			const projectRoot = providerParams.projectRoot || process.cwd();

			// Check for cached session to reuse
			const cachedChatId = getCachedChatId(projectRoot, model);

			const args = this.buildCursorAgentArgs({
				model,
				// Use default stream-json format (don't specify outputFormat)
				withDiffs: false, // Disabled for now. Use the new --with-diffs feature for better context
				apiKey: providerParams.apiKey,
				chatId: cachedChatId // Add cached chat ID if available
			});

			log('Calling cursor-agent with args:', {
				args,
				model,
				cachedSession: !!cachedChatId,
				chatId: cachedChatId
			});

			if (progressTracker) {
				progressTracker.updateProgress(0.1, 'Executing cursor-agent');
			}

			let result;
			let retriedWithoutResume = false;

			try {
				result = await this.executeCursorAgent(
					args,
					prompt,
					progressTracker
				);

				// Check for resume-related errors
				if (result.is_error && cachedChatId && this.isResumeFailure(result.result)) {
					log('Resume failure detected, retrying without cached session', {
						cachedChatId,
						error: result.result
					});

					// Mark the resume failure
					markResumeFailure(projectRoot, model, cachedChatId);

					// Retry without resume by rebuilding args without chatId
					const retryArgs = this.buildCursorAgentArgs({
						model,
						withDiffs: false,
						apiKey: providerParams.apiKey
						// No chatId - will create new session
					});

					if (progressTracker) {
						progressTracker.updateProgress(0.2, 'Retrying with new session...');
					}

					result = await this.executeCursorAgent(
						retryArgs,
						prompt,
						progressTracker
					);
					retriedWithoutResume = true;
				}
			} catch (error) {
				// If we have a cached session and this looks like a resume error, try without resume
				if (cachedChatId && !retriedWithoutResume && this.isResumeFailure(error.message)) {
					log('Resume failure in exception, retrying without cached session', {
						cachedChatId,
						error: error.message
					});

					// Mark the resume failure
					markResumeFailure(projectRoot, model, cachedChatId);

					// Retry without resume
					const retryArgs = this.buildCursorAgentArgs({
						model,
						withDiffs: false,
						apiKey: providerParams.apiKey
						// No chatId - will create new session
					});

					if (progressTracker) {
						progressTracker.updateProgress(0.2, 'Retrying with new session...');
					}

					result = await this.executeCursorAgent(
						retryArgs,
						prompt,
						progressTracker
					);
					retriedWithoutResume = true;
				} else {
					throw error;
				}
			}

			if (progressTracker) {
				progressTracker.updateProgress(0.9, 'Processing cursor-agent response');
			}

			if (result.is_error) {
				if (progressTracker) {
					progressTracker.error(`Cursor Agent error: ${result.result}`);
				}
				throw new Error(`Cursor Agent error: ${result.result}`);
			}

			// Update progress with token information
			const inputTokens = result.input_tokens || 0;
			const outputTokens = result.output_tokens || 0;

			if (progressTracker) {
				// Estimate cost (free for cursor-agent but show token usage)
				progressTracker.updateTokensWithCost(
					inputTokens,
					outputTokens,
					0,
					0,
					false
				);
				progressTracker.complete('Text generation completed');
			}

			// Extract and cache chat ID from response if available
			if (result.chat_id || result.chatId || result.sessionId) {
				const newChatId = result.chat_id || result.chatId || result.sessionId;
				const isNewSession = !cachedChatId || retriedWithoutResume;

				cacheChatId(projectRoot, model, newChatId, isNewSession);
				log('Stored chat ID for session reuse', {
					chatId: newChatId,
					projectRoot,
					model,
					isNewSession,
					wasRetry: retriedWithoutResume
				});
			}

			return {
				text: result.result,
				usage: {
					totalTokens: result.total_tokens || 0,
					promptTokens: inputTokens,
					completionTokens: outputTokens
				},
				finishReason: 'stop'
			};
		} catch (error) {
			if (progressTracker) {
				progressTracker.error(`Generation failed: ${error.message}`);
			}
			log('cursor-agent generateText error:', error);
			throw new Error(`Cursor Agent generateText failed: ${error.message}`);
		}
	}

	/**
	 * Generate structured object using cursor-agent CLI
	 * @param {object} options - Generation options
	 * @param {Array|string} options.messages - Messages or prompt
	 * @param {object} options.schema - Expected response schema
	 * @param {string} [options.model] - Model to use
	 * @param {object} providerParams - Provider-specific parameters
	 * @returns {Promise<object>} Generated object response
	 */
	async generateObject(options, providerParams = {}) {
		const progressTracker =
			options.progressTracker || providerParams.progressTracker;

		try {
			if (progressTracker) {
				progressTracker.updateProgress(
					0,
					'Preparing structured generation request'
				);
			}

			// For JSON generation, bypass the formatMessages enhancements that make cursor-agent conversational
			// Extract the raw prompt without TaskMaster-specific enhancements
			const rawPrompt = this.extractBasePrompt(options.messages);

			// Build schema instructions if schema is provided
			let schemaInstructions = '';
			if (options.schema && options.objectName) {
				// Convert Zod schema to readable format for cursor-agent
				schemaInstructions = this._buildSchemaInstructions(
					options.schema,
					options.objectName
				);
			}

			// Create explicit JSON-only instructions for cursor-agent
			const schemaPrompt = `${rawPrompt}

${schemaInstructions}

IMPORTANT: Respond with ONLY valid JSON that matches the required structure above. Do not include any explanatory text, markdown formatting, or conversational responses. Return only the JSON object.

Do not use any tools or commands. Do not provide explanations. Just return clean JSON.`;

			const textResult = await this.generateText(
				{
					...options,
					messages: schemaPrompt,
					progressTracker: progressTracker
				},
				providerParams
			);

			// Extract JSON from the response
			let jsonStr = textResult?.text;

			// Check if we have valid text response
			if (!jsonStr || typeof jsonStr !== 'string') {
				throw new Error(
					`Invalid response from cursor-agent: expected text string, got ${typeof jsonStr}. Response: ${JSON.stringify(textResult)}`
				);
			}

			// Try to find JSON in the response if it's wrapped in other text
			const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
			if (jsonMatch) {
				jsonStr = jsonMatch[0];
			} else {
				// No JSON structure found - check if it's clearly non-JSON content
				if (!jsonStr.includes('{') && !jsonStr.includes('[')) {
					throw new Error(
						`No JSON structure found in response. Content appears to be plain text: ${jsonStr.slice(0, 100)}...`
					);
				}
			}

			try {
				const parsedObject = JSON.parse(jsonStr);
				return {
					object: parsedObject,
					usage: textResult.usage,
					finishReason: 'stop'
				};
			} catch (parseError) {
				log('Failed to parse JSON response:', { jsonStr, parseError });

				// Check if this is clearly not JSON before attempting repair
				const trimmed = jsonStr.trim();
				if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
					throw new Error(
						`Invalid JSON response: Content does not appear to be JSON. Raw response: ${jsonStr}`
					);
				}

				// Try to repair the JSON only for content that looks like malformed JSON
				try {
					const { jsonrepair } = await import('jsonrepair');
					const repairedJson = jsonrepair(jsonStr);
					const parsedObject = JSON.parse(repairedJson);

					log('Successfully repaired JSON response');
					return {
						object: parsedObject,
						usage: textResult.usage,
						finishReason: 'stop'
					};
				} catch (repairError) {
					throw new Error(
						`Failed to parse JSON response: ${parseError.message}. Raw response: ${jsonStr}`
					);
				}
			}
		} catch (error) {
			log('cursor-agent generateObject error:', error);
			throw new Error(`Cursor Agent generateObject failed: ${error.message}`);
		}
	}

	/**
	 * Override BaseAIProvider's streamObject method for cursor-agent specific implementation
	 * @param {object} options - Streaming options
	 * @returns {Promise<object>} Streaming object result
	 */
	async streamObject(options) {
		try {
			// Use our generateObject method and wrap it in a stream-like interface
			const result = await this.generateObject(options);

			// Return the expected stream object structure with partialObjectStream (not objectStream)
			return {
				partialObjectStream: async function* () {
					yield result.object;
				},
				object: result.object,
				usage: result.usage,
				finishReason: result.finishReason || 'stop'
			};
		} catch (error) {
			throw new Error(`Cursor Agent streamObject failed: ${error.message}`);
		}
	}

	/**
	 * Build schema instructions for cursor-agent from Zod schema
	 * @param {object} schema - Zod schema object
	 * @param {string} objectName - Name of the object
	 * @returns {string} Formatted schema instructions
	 */
	_buildSchemaInstructions(schema, objectName) {
		try {
			// Schema instruction templates
			const templates = this._getSchemaTemplates();

			// Check for exact object name matches first
			if (templates[objectName]) {
				return templates[objectName];
			}

			// Check for pattern-based matches
			const patternMatches = this._matchSchemaPatterns(schema, objectName);
			if (patternMatches) {
				return patternMatches;
			}

			// Try to build generic instructions from schema structure
			if (schema && schema.properties) {
				return this._buildGenericSchemaInstructions(schema, objectName);
			}

			// Final fallback
			return `Return a valid JSON object with the appropriate structure for: ${objectName}`;
		} catch (error) {
			log('Error building schema instructions:', error);
			return `Return a valid JSON object.`;
		}
	}

	/**
	 * Get predefined schema templates for known object types
	 * @returns {object} Object with template definitions
	 */
	_getSchemaTemplates() {
		return {
			'newTaskData': `Return a JSON object with exactly this structure:
{
  "title": "Clear, concise title for the task",
  "description": "A one or two sentence description of the task",
  "details": "In-depth implementation details, considerations, and guidance",
  "testStrategy": "Detailed approach for verifying task completion",
  "dependencies": null
}

All fields are required strings except dependencies which should be null for new tasks.`,

			'subtaskData': `Return a JSON object with exactly this structure:
{
  "title": "Clear, concise title for the subtask",
  "description": "Brief description of what this subtask accomplishes",
  "details": "Implementation steps and technical considerations",
  "dependencies": [],
  "status": "pending"
}

All fields are required. Dependencies should be an array of task/subtask IDs.`,

			'complexityAnalysis': `Return a JSON object with exactly this structure:
{
  "taskId": "ID of the analyzed task",
  "complexityScore": 7,
  "reasoningFactors": ["Factor 1", "Factor 2"],
  "recommendedSubtasks": 5,
  "expansionRecommendation": "Detailed explanation of why expansion is recommended"
}

complexityScore should be 1-10, reasoningFactors should list complexity drivers.`,

			'tasks_data': `Return a properly structured JSON object that matches the expected format for task-related data.`,

			'generated_object': `Return a properly structured JSON object that matches the expected format for the request.`
		};
	}

	/**
	 * Match schema patterns for dynamic instruction generation
	 * @param {object} schema - Zod schema object
	 * @param {string} objectName - Name of the object
	 * @returns {string|null} Matched template or null
	 */
	_matchSchemaPatterns(schema, objectName) {
		// PRD parsing pattern
		if (schema && schema.properties && schema.properties.tasks && schema.properties.metadata) {
			return `Return a JSON object with exactly this structure (do NOT wrap in "${objectName}" or any other key):
{
  "tasks": [
    {
      "id": 1,
      "title": "Task title",
      "description": "Brief task description",
      "details": "Detailed implementation guidance",
      "testStrategy": "How to test and verify completion",
      "priority": "high",
      "dependencies": [],
      "status": "pending"
    }
  ],
  "metadata": {
    "projectName": "Project name from the PRD",
    "totalTasks": 1,
    "sourceFile": "Source PRD filename",
    "generatedAt": "${new Date().toISOString()}"
  }
}

CRITICAL: Return the object directly with "tasks" and "metadata" as top-level keys. Do NOT wrap it in a "${objectName}" key.`;
		}

		// Task list pattern
		if (schema && schema.properties && schema.properties.tasks && Array.isArray(schema.properties.tasks)) {
			return `Return a JSON object with a "tasks" array containing task objects with standard TaskMaster structure.`;
		}

		// Analysis pattern
		if (objectName.toLowerCase().includes('analysis') || objectName.toLowerCase().includes('complexity')) {
			return `Return a JSON object containing analysis results with scores, recommendations, and detailed explanations.`;
		}

		return null;
	}

	/**
	 * Build generic schema instructions from schema structure
	 * @param {object} schema - Zod schema object
	 * @param {string} objectName - Name of the object
	 * @returns {string} Generic schema instructions
	 */
	_buildGenericSchemaInstructions(schema, objectName) {
		try {
			const properties = schema.properties || {};
			const requiredFields = schema.required || [];

			let instruction = `Return a JSON object for "${objectName}" with the following structure:\n{\n`;

			// Build property examples
			Object.keys(properties).forEach(key => {
				const prop = properties[key];
				let example = this._getPropertyExample(prop, key);
				instruction += `  "${key}": ${example},\n`;
			});

			instruction = instruction.slice(0, -2) + '\n}'; // Remove last comma

			if (requiredFields.length > 0) {
				instruction += `\n\nRequired fields: ${requiredFields.join(', ')}`;
			}

			return instruction;
		} catch (error) {
			return `Return a valid JSON object for: ${objectName}`;
		}
	}

	/**
	 * Get example value for a schema property
	 * @param {object} property - Schema property definition
	 * @param {string} key - Property key name
	 * @returns {string} Example value as string
	 */
	_getPropertyExample(property, key) {
		if (!property) return '"example value"';

		const type = property.type;

		switch (type) {
			case 'string':
				if (key.toLowerCase().includes('id')) return '"example-id"';
				if (key.toLowerCase().includes('title')) return '"Example Title"';
				if (key.toLowerCase().includes('description')) return '"Example description"';
				return '"example value"';

			case 'number':
			case 'integer':
				if (key.toLowerCase().includes('score')) return '7';
				if (key.toLowerCase().includes('count')) return '5';
				return '42';

			case 'boolean':
				return 'true';

			case 'array':
				return '[]';

			case 'object':
				return '{}';

			default:
				return '"example value"';
		}
	}

	mapModelIdToCursorAgent(modelId) {
		// Handle null/undefined/empty cases
		if (!modelId) {
			return modelId;
		}

		const modelMap = {
			// Anthropic Claude models
			'sonnet-4': 'sonnet',
			'claude-3-sonnet': 'sonnet',
			'claude-sonnet': 'sonnet',
			'sonnet': 'sonnet',

			// Claude Opus
			'opus': 'opus',
			'claude-3-opus': 'opus',
			'claude-opus': 'opus',

			// Claude Haiku (if supported)
			'haiku': 'haiku',
			'claude-3-haiku': 'haiku',
			'claude-haiku': 'haiku',

			// OpenAI GPT models
			'gpt-5': 'gpt-5',
			'gpt5': 'gpt-5',
			'openai-gpt-5': 'gpt-5',

			'gpt-4': 'gpt-4',
			'gpt4': 'gpt-4',
			'openai-gpt-4': 'gpt-4',

			'gpt-4-turbo': 'gpt-4-turbo',
			'gpt4-turbo': 'gpt-4-turbo',

			// o1 models (if supported)
			'o1': 'o1',
			'o1-preview': 'o1-preview',
			'openai-o1': 'o1',
			'openai-o1-preview': 'o1-preview'
		};

		return modelMap[modelId] || modelId;
	}

	/**
	 * Get list of supported cursor-agent models
	 * @returns {Array<string>} List of supported model IDs
	 */
	getSupportedModels() {
		return [
			'sonnet-4', 'sonnet', 'claude-3-sonnet', 'claude-sonnet',
			'opus', 'claude-3-opus', 'claude-opus',
			'haiku', 'claude-3-haiku', 'claude-haiku',
			'gpt-5', 'gpt5', 'openai-gpt-5',
			'gpt-4', 'gpt4', 'openai-gpt-4',
			'gpt-4-turbo', 'gpt4-turbo',
			'o1', 'o1-preview', 'openai-o1', 'openai-o1-preview'
		];
	}

	/**
	 * Validate if a model is supported by cursor-agent
	 * @param {string} modelId - Model ID to validate
	 * @returns {boolean} True if model is supported
	 */
	isModelSupported(modelId) {
		if (!modelId) return false;

		const mappedModel = this.mapModelIdToCursorAgent(modelId);
		const knownCursorAgentModels = ['sonnet', 'opus', 'haiku', 'gpt-5', 'gpt-4', 'gpt-4-turbo', 'o1', 'o1-preview'];

		return knownCursorAgentModels.includes(mappedModel);
	}

	/**
	 * Check cursor-agent CLI availability and version
	 * @returns {Promise<object>} CLI availability information
	 */
	async checkCursorAgentCLI() {
		try {
			const versionOutput = execSync('cursor-agent --version', {
				encoding: 'utf8',
				timeout: 5000,
				stdio: 'pipe'
			}).trim();

			const versionMatch = versionOutput.match(/(\d+\.\d+\.\d+)/);
			const version = versionMatch ? versionMatch[1] : 'unknown';

			return {
				available: true,
				version: version,
				rawOutput: versionOutput
			};
		} catch (error) {
			let errorType = 'unknown';
			let errorMessage = error.message;

			if (error.code === 'ENOENT') {
				errorType = 'not_found';
				errorMessage = 'cursor-agent CLI not found. Please install cursor-agent.';
			} else if (error.code === 'ETIMEDOUT') {
				errorType = 'timeout';
				errorMessage = 'cursor-agent CLI check timed out.';
			}

			return {
				available: false,
				error: errorType,
				message: errorMessage,
				details: error
			};
		}
	}

	/**
	 * Validate cursor-agent CLI is available and ready for use
	 * @param {string} modelId - Optional model to validate
	 * @returns {Promise<object>} Validation result
	 */
	async validateCursorAgentSetup(modelId = null) {
		const cliCheck = await this.checkCursorAgentCLI();

		if (!cliCheck.available) {
			return {
				valid: false,
				issue: 'cli_not_available',
				message: cliCheck.message,
				details: cliCheck
			};
		}

		// Validate model if provided
		if (modelId && !this.isModelSupported(modelId)) {
			return {
				valid: false,
				issue: 'unsupported_model',
				message: `Model '${modelId}' is not supported by cursor-agent`,
				supportedModels: this.getSupportedModels(),
				details: { modelId, mappedModel: this.mapModelIdToCursorAgent(modelId) }
			};
		}

		return {
			valid: true,
			cliVersion: cliCheck.version,
			modelSupported: modelId ? this.isModelSupported(modelId) : true,
			details: cliCheck
		};
	}

	/**
	 * Build command line arguments for cursor-agent
	 * @param {object} options - Options for building args
	 * @param {string} options.model - Model to use
	 * @param {string} options.outputFormat - Output format (json, text, stream-json)
	 * @param {boolean} [options.withDiffs] - Include git diffs in context
	 * @param {string} [options.apiKey] - API key if provided
	 * @returns {Array<string>} Command line arguments
	 */
	buildCursorAgentArgs(options) {
		const mappedModel = this.mapModelIdToCursorAgent(options.model || 'sonnet');

		// Use model-specific subcommand instead of --model flag (this works better)
		const args = [
			'cursor-agent',
			mappedModel, // Use subcommand like 'sonnet', 'gpt-5', etc.
			'--print' // Print responses to console for scripts
			// --force removed: proper permissions configured in .cursor/cli.json
		];

		// Do NOT use --output-format=json as it causes hanging!
		// The default 'stream-json' format works perfectly and provides structured output

		// Add session resumption if chatId is provided
		if (options.chatId) {
			args.push('--resume', options.chatId);
		}

		// Add --with-diffs for better context (new feature!)
		if (options.withDiffs !== false) {
			args.push('--with-diffs');
		}

		// Add API key if provided
		if (options.apiKey && options.apiKey !== 'cursor-agent-no-key-required') {
			args.push('--api-key', options.apiKey);
		}

		return args;
	}

	/**
	 * Execute cursor-agent command with optimized timeout handling
	 * Fixed: Removed competing timeout mechanisms for research operations
	 * @param {Array<string>} args - Command arguments
	 * @param {string} prompt - Prompt to send to cursor-agent
	 * @param {object} [progressTracker] - Optional progress tracker for visual feedback
	 * @returns {Promise<object>} Parsed response from cursor-agent
	 */
	async executeCursorAgent(args, prompt, progressTracker = null) {
		// FIXED: Dynamic timeout based on operation type
		// Research operations get longer timeout, regular operations get shorter
		const isResearchOperation =
			prompt.toLowerCase().includes('research') ||
			prompt.toLowerCase().includes('complexity') ||
			prompt.toLowerCase().includes('analyze');
		const timeoutMs = isResearchOperation ? 300000 : 120000; // 5min for research, 2min for regular

		if (progressTracker) {
			progressTracker.nextPhase(); // Advance to execution phase
		}

		// FIXED: Single timeout mechanism - let the core handle it instead of competing timeouts
		return await this._executeCursorAgentCore(
			args,
			prompt,
			progressTracker,
			timeoutMs
		);
	}

	/**
	 * Core cursor-agent execution logic with real-time stdout monitoring (Option 1 - Elegant)
	 * FIXED: Single timeout mechanism, optimized for research operations
	 * @private
	 */
	async _executeCursorAgentCore(
		args,
		prompt,
		progressTracker = null,
		timeoutMs = 120000
	) {
		return new Promise((resolve, reject) => {
			const sessionId = `cursor-agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
			let tmpFile = null;
			let child = null;
			let resultFound = false;
			let sessionRegistered = false;

			try {
				log('Executing cursor-agent directly:', {
					sessionId,
					command: args.join(' '),
					promptLength: prompt.length,
					promptPreview: prompt.slice(0, 200) + '...'
				});

				// Create temp file for prompt to avoid shell escaping issues
				tmpFile = `/tmp/cursor-prompt-${sessionId}.txt`;
				fs.writeFileSync(tmpFile, prompt, 'utf8');
				log('DEBUG: Temp file created:', tmpFile);

				if (progressTracker) {
					progressTracker.updateProgress(0.3, 'Starting cursor-agent process');
				}

				// Build command: cursor-agent sonnet --print "$(cat tempfile)"
				const fullCommand = `${args.join(' ')} "$(cat ${tmpFile})"`;
				log('DEBUG: Executing command:', fullCommand);

				// Spawn cursor-agent process directly - much more elegant than tmux!
				// Use bash for reliability but inherit zsh environment (mise tools, etc.)
				child = spawn('bash', ['-c', fullCommand], {
					stdio: ['ignore', 'pipe', 'pipe'], // ignore stdin, pipe stdout/stderr
					cwd: process.cwd(),
					env: {
						...process.env, // Inherit current zsh environment with mise tools
						NODE_NO_WARNINGS: '1',
						// Ensure bash gets the same PATH and tools that zsh has loaded
						SHELL: '/bin/bash' // But use bash for execution
					}
				});

				// Register session with SessionManager for enhanced tracking
				sessionManager.registerSession(sessionId, {
					pid: child.pid,
					childProcess: child,
					tmpFile: tmpFile
				}, {
					operationType: this.detectOperationType(prompt) || 'generateText',
					projectRoot: process.cwd(),
					timeoutMs: timeoutMs,
					isResearch: timeoutMs > 120000 // Research operations have longer timeouts
				});
				sessionRegistered = true;

				let outputBuffer = '';

				// OPTIMIZED: Real-time stdout monitoring with reduced logging for research operations
				const isResearchOp = timeoutMs > 120000; // Research operations have longer timeouts
				child.stdout.on('data', (data) => {
					const chunk = data.toString();
					outputBuffer += chunk;

					// Update session activity when receiving data
					if (sessionRegistered) {
						sessionManager.updateSessionActivity(sessionId);
					}

					// FIXED: Reduce debug logging for long operations to prevent interference
					if (!isResearchOp || outputBuffer.length % 10000 === 0) {
						log(
							'DEBUG: Received chunk length:',
							chunk.length,
							'total buffer:',
							outputBuffer.length
						);
					}

					// OPTIMIZED: Progress tracking for research operations
					if (
						progressTracker &&
						isResearchOp &&
						chunk.includes('"type":"assistant"')
					) {
						progressTracker.updateProgress(0.6, 'AI generating response...');
					}

					// Look for completion marker in real-time
					if (chunk.includes('"type":"result"') && !resultFound) {
						log('DEBUG: Found result marker, parsing completion...');

						// FIXED: Give longer buffer for complex research responses
						const bufferTime = isResearchOp ? 500 : 200;
						setTimeout(async () => {
							if (!resultFound) {
								resultFound = true;
								const parsed = this._parseCompletionFromOutput(
									outputBuffer,
									isResearchOp
								);

								if (parsed) {
									log('cursor-agent response received (direct):', {
										resultLength: parsed.result?.length || 0,
										isError: parsed.is_error,
										sessionId: parsed.session_id,
										isResearch: isResearchOp
									});

									await enhancedCleanup();
									resolve(parsed);
								} else {
									await enhancedCleanup();
									reject(
										new Error(
											'Failed to parse cursor-agent result despite finding marker'
										)
									);
								}
							}
						}, bufferTime); // Longer buffer for research operations
					}
				});

				child.stdout.on('end', () => {
					log('DEBUG: stdout stream ended');
				});

				child.stderr.on('data', (data) => {
					log('cursor-agent stderr:', data.toString());
				});

				child.on('close', async (code) => {
					if (!resultFound) {
						log(
							'DEBUG: Process closed with code',
							code,
							'buffer length:',
							outputBuffer.length
						);
						// FIXED: Show more context for research operations, less for regular ones
						const contextLength = isResearchOp ? 500 : 300;
						log(
							'DEBUG: Final buffer content (last chars):',
							outputBuffer.slice(-contextLength)
						);

						// OPTIMIZED: Try parsing with more aggressive cleanup for research operations
						const parsed = this._parseCompletionFromOutput(
							outputBuffer,
							isResearchOp
						);
						await enhancedCleanup();

						if (parsed) {
							log('DEBUG: Successfully parsed result on close event');
							resolve(parsed);
						} else {
							// IMPROVED: Better error message for research vs regular operations
							const errorMsg = isResearchOp
								? `Research operation completed but no result parsed. Buffer: ${outputBuffer.length} chars. Try reducing complexity.`
								: `cursor-agent exited with code ${code}, no result found. Buffer length: ${outputBuffer.length}`;
							reject(new Error(errorMsg));
						}
					}
				});

				child.on('error', async (error) => {
					if (!resultFound) {
						await enhancedCleanup();
						reject(new Error(`cursor-agent process error: ${error.message}`));
					}
				});

				// FIXED: Use dynamic timeout from parameter instead of hardcoded value
				const timeout = setTimeout(async () => {
					if (!resultFound) {
						log(
							`DEBUG: Timeout reached after ${timeoutMs / 1000}s, killing process...`
						);
						if (child && !child.killed) {
							child.kill('SIGTERM');
							setTimeout(() => {
								if (child && !child.killed) {
									child.kill('SIGKILL');
								}
							}, 5000);
						}
						await enhancedCleanup();
						reject(
							new Error(
								`cursor-agent timeout after ${timeoutMs / 1000} seconds`
							)
						);
					}
				}, timeoutMs); // Dynamic timeout based on operation type

				// Enhanced cleanup using SessionManager for comprehensive session management
				const enhancedCleanup = async () => {
					clearTimeout(timeout);

					if (sessionRegistered) {
						// Use SessionManager's enhanced cleanup which handles:
						// - Process termination with verification
						// - Temp file cleanup with error handling
						// - Orphaned process detection and cleanup
						// - Session lifecycle logging
						await sessionManager.cleanupSession(sessionId);
					} else {
						// Fallback cleanup if session wasn't registered
						if (child && !child.killed) {
							log('DEBUG: Fallback cleanup - terminating child process...');
							child.removeAllListeners();
							child.kill('SIGTERM');
						}

						if (tmpFile) {
							try {
								fs.unlinkSync(tmpFile);
								log('DEBUG: Fallback cleanup - removed temp file:', tmpFile);
							} catch (fileCleanupError) {
								log('Warning: Failed to cleanup temp file in fallback:', {
									tmpFile,
									error: fileCleanupError.message
								});
							}
						}
					}
				};

				if (progressTracker) {
					progressTracker.updateProgress(
						0.4,
						'Monitoring cursor-agent output in real-time'
					);
				}
			} catch (error) {
				log('cursor-agent direct execution setup error:', error);

				// Clean up on setup error
				if (child && !child.killed) {
					child.kill('SIGTERM');
				}
				if (tmpFile) {
					try {
						fs.unlinkSync(tmpFile);
					} catch (fileCleanupError) {
						// Ignore temp file cleanup errors
					}
				}

				reject(
					new Error(
						`cursor-agent direct execution setup failed: ${error.message}`
					)
				);
			}
		});
	}

	/**
	 * Parse completion result from cursor-agent output
	 * OPTIMIZED: Enhanced parsing for research operations with larger responses
	 * @private
	 */
	_parseCompletionFromOutput(output, isResearchOperation = false) {
		const cleanOutput = output
			.replace(/\x1b\[[0-9;]*m/g, '') // Remove ANSI color codes
			.replace(/[\x00-\x1F\x7F]/g, ''); // Remove control characters

		// OPTIMIZED: More aggressive search for research operations with larger outputs
		const resultLineRegex = isResearchOperation
			? /"type":"result"[\s\S]*?"result":/g
			: // More permissive for research
			/"type":"result"[^}]*}/g; // Original for regular ops
		let match;
		while ((match = resultLineRegex.exec(cleanOutput)) !== null) {
			// Find the start of the JSON object by looking backwards for opening brace
			let startIdx = match.index;
			while (startIdx > 0 && cleanOutput[startIdx] !== '{') {
				startIdx--;
			}

			// Find the end by counting braces
			let braceCount = 0;
			let endIdx = startIdx;
			for (let i = startIdx; i < cleanOutput.length; i++) {
				if (cleanOutput[i] === '{') braceCount++;
				else if (cleanOutput[i] === '}') braceCount--;

				if (braceCount === 0) {
					endIdx = i;
					break;
				}
			}

			if (braceCount === 0) {
				const jsonStr = cleanOutput.substring(startIdx, endIdx + 1);
				try {
					const resultObj = JSON.parse(jsonStr);
					if (resultObj.type === 'result') {
						const isError = resultObj.is_error === true;
						const actualResult = resultObj.result || '';

						const parsed = {
							result: actualResult,
							is_error: isError,
							usage: {
								totalTokens: Math.round((resultObj.duration_api_ms || 0) / 100),
								promptTokens: Math.round(
									((resultObj.duration_api_ms || 0) / 100) * 0.7
								),
								completionTokens: Math.round(
									((resultObj.duration_api_ms || 0) / 100) * 0.3
								)
							},
							finishReason: 'stop',
							session_id: resultObj.session_id,
							request_id: resultObj.request_id
						};

						log('DEBUG: Successfully parsed cursor-agent result:', {
							isError,
							resultLength: actualResult.length,
							sessionId: resultObj.session_id
						});

						return parsed;
					}
				} catch (e) {
					log('DEBUG: Failed to parse JSON result:', e.message);
					continue;
				}
			}
		}

		// Fallback: Look for lines with "type":"result"
		const lines = cleanOutput.split('\n');
		for (const line of lines) {
			const trimmedLine = line.trim();
			if (
				trimmedLine.includes('"type":"result"') &&
				trimmedLine.includes('"result":')
			) {
				try {
					const resultObj = JSON.parse(trimmedLine);
					if (resultObj.type === 'result') {
						const isError = resultObj.is_error === true;
						const actualResult = resultObj.result || '';

						const parsed = {
							result: actualResult,
							is_error: isError,
							usage: {
								totalTokens: Math.round((resultObj.duration_api_ms || 0) / 100),
								promptTokens: Math.round(
									((resultObj.duration_api_ms || 0) / 100) * 0.7
								),
								completionTokens: Math.round(
									((resultObj.duration_api_ms || 0) / 100) * 0.3
								)
							},
							finishReason: 'stop',
							session_id: resultObj.session_id,
							request_id: resultObj.request_id
						};

						log(
							'DEBUG: Successfully parsed cursor-agent result via fallback:',
							{
								isError,
								resultLength: actualResult.length,
								sessionId: resultObj.session_id
							}
						);

						return parsed;
					}
				} catch (e) {
					log('DEBUG: Failed to parse fallback result line:', e.message);
					continue;
				}
			}
		}

		log('DEBUG: No valid result found in output');
		return null;
	}

	/**
	 * Format messages for cursor-agent prompt with recursive MCP enhancement
	 * @param {Array|string} messages - Messages to format
	 * @param {Object} options - Configuration options
	 * @param {string} options.mode - Execution mode: 'sequential' or 'recursive' (default: 'recursive')
	 * @returns {string} Enhanced prompt string optimized for cursor-agent capabilities
	 */
	formatMessages(messages, options = {}) {
		const { mode = 'recursive' } = options;
		const basePrompt = this.extractBasePrompt(messages);

		// Detect operation type and enhance accordingly
		const operationType = this.detectOperationType(basePrompt);

		if (operationType) {
			return this.buildEnhancedPrompt(operationType, basePrompt, mode);
		}

		return basePrompt;
	}

	/**
	 * Extract base prompt from various message formats
	 */
	extractBasePrompt(messages) {
		if (typeof messages === 'string') {
			return messages;
		}

		if (Array.isArray(messages)) {
			return messages
				.map((msg) => {
					if (typeof msg === 'string') return msg;
					if (msg.role && msg.content) {
						return `${msg.role}: ${msg.content}`;
					}
					return JSON.stringify(msg);
				})
				.join('\n\n');
		}

		return JSON.stringify(messages);
	}

	/**
	 * Detect TaskMaster operation type from prompt for enhancement
	 */
	detectOperationType(prompt) {
		const lowerPrompt = prompt.toLowerCase();

		if (lowerPrompt.includes('expand') && lowerPrompt.includes('task')) {
			return 'expand_task';
		}
		if (lowerPrompt.includes('parse') && lowerPrompt.includes('prd')) {
			return 'parse_prd';
		}
		if (lowerPrompt.includes('update') && lowerPrompt.includes('task')) {
			return 'update_task';
		}
		if (lowerPrompt.includes('add') && lowerPrompt.includes('task')) {
			return 'add_task';
		}
		if (lowerPrompt.includes('analyze') && lowerPrompt.includes('complexity')) {
			return 'analyze_complexity';
		}

		return null;
	}

	/**
	 * Build enhanced prompt with operation-specific instructions
	 */
	buildEnhancedPrompt(operationType, basePrompt, mode = 'recursive') {
		const isRecursive = mode === 'recursive';

		const strategies = {
			expand_task: isRecursive
				? this.buildTaskExpansionStrategy
				: this.buildSequentialTaskExpansionStrategy,
			parse_prd: isRecursive
				? this.buildPRDParsingStrategy
				: this.buildSequentialPRDParsingStrategy,
			update_task: this.buildTaskUpdateStrategy,
			add_task: this.buildTaskCreationStrategy,
			analyze_complexity: this.buildComplexityAnalysisStrategy
		};

		const builder = strategies[operationType];
		if (builder) {
			return builder.call(this, basePrompt);
		}

		return basePrompt;
	}

	// =================== OPERATION-SPECIFIC STRATEGY METHODS ===================

	/**
	 * Build recursive task expansion strategy for cursor-agent
	 */
	buildTaskExpansionStrategy(basePrompt) {
		return `You are a TaskMaster AI assistant with RECURSIVE MCP ACCESS and parallel execution capabilities.

AVAILABLE TOOLS:
• Shell: Execute any command including tmux for parallel operations
• TodoWrite: Create structured task lists and planning
• Read: Read multiple files (use in parallel for efficiency)
• Grep: Search codebase patterns and dependencies
• LS/Glob: Discover project structure

🔄 RECURSIVE MCP TOOLS (TaskMaster MCP Server Access):
You have DIRECT ACCESS to TaskMaster via MCP calls:
• expand_task - Break tasks into subtasks RECURSIVELY
• scope_up_task / scope_down_task - Adjust complexity dynamically
• add_task - Create new tasks during analysis
• update_task - Modify tasks with enhanced context
• get_tasks - Query current TaskMaster state
• analyze_complexity - Assess and optimize task complexity

RECURSIVE EXPANSION WORKFLOW:
1. Use TodoWrite to create systematic expansion plan
2. Gather project context in parallel (tmux + multiple Read operations)
3. **RECURSIVE: Use TaskMaster MCP expand_task for complex subtasks**
4. Analyze expansion results and identify optimization needs
5. **RECURSIVE: Use TaskMaster MCP scope_up_task for underscoped items**
6. **RECURSIVE: Use TaskMaster MCP scope_down_task for overscoped items**
7. **RECURSIVE: Use TaskMaster MCP add_task for discovered dependencies**
8. **RECURSIVE: Use TaskMaster MCP update_task with enhanced details**
9. Validate entire task structure and dependencies
10. **FINAL: Use TaskMaster MCP to confirm optimized task structure**

PARALLEL + RECURSIVE STRATEGY:
- Use tmux for parallel file/code analysis
- Use MCP calls for dynamic TaskMaster state management
- Create feedback loops between analysis and task optimization
- Self-manage the entire workflow from expansion to optimization

ORIGINAL REQUEST:
${basePrompt}

EXECUTION APPROACH:
Execute this RECURSIVELY using both local tools AND TaskMaster MCP calls. You can modify TaskMaster state as you analyze. Create a self-optimizing expansion workflow.`;
	}

	/**
	 * Build recursive PRD parsing strategy for cursor-agent
	 */
	buildPRDParsingStrategy(basePrompt) {
		return `You are a TaskMaster AI assistant with RECURSIVE MCP ACCESS for dynamic PRD parsing and task creation.

AVAILABLE TOOLS:
• Shell: Execute commands and manage parallel operations via tmux
• TodoWrite: Create structured parsing plans
• Read: Read PRD and related files in parallel
• Grep: Search for existing patterns and dependencies

🔄 RECURSIVE MCP TOOLS (TaskMaster MCP Server Access):
You have DIRECT ACCESS to TaskMaster via MCP calls:
• add_task - Create new tasks dynamically during parsing
• analyze_complexity - Assess task complexity in real-time
• expand_task - Break down complex discovered tasks immediately
• update_task - Enhance tasks with discovered context
• get_tasks - Query current state for dependency analysis

RECURSIVE PRD PARSING WORKFLOW:
1. Use TodoWrite to create systematic parsing plan
2. Read and analyze PRD content in parallel
3. **RECURSIVE: Use TaskMaster MCP add_task for each discovered requirement**
4. **RECURSIVE: Use TaskMaster MCP analyze_complexity for new tasks**
5. **RECURSIVE: Use TaskMaster MCP expand_task for complex requirements**
6. **RECURSIVE: Use TaskMaster MCP update_task with cross-references**
7. Create dependency relationships between discovered tasks
8. **RECURSIVE: Optimize task structure using MCP calls**
9. Validate complete task hierarchy
10. **FINAL: Confirm optimized PRD-driven task structure**

DYNAMIC TASK CREATION STRATEGY:
- Parse PRD sections and create tasks in real-time
- Use MCP calls to build task structure as you discover requirements
- Create feedback loops between parsing and task optimization
- Self-manage task creation, complexity analysis, and expansion

ORIGINAL REQUEST:
${basePrompt}

EXECUTION APPROACH:
Parse the PRD RECURSIVELY using TaskMaster MCP calls to create and optimize tasks dynamically. Build the entire task structure through recursive MCP interactions.`;
	}

	/**
	 * Build sequential task expansion strategy (non-recursive)
	 */
	buildSequentialTaskExpansionStrategy(basePrompt) {
		return `You are a TaskMaster AI assistant focused on systematic task expansion analysis.

AVAILABLE TOOLS:
• Shell: Execute commands for analysis
• TodoWrite: Create structured expansion plans
• Read: Analyze project files and context
• Grep: Search for patterns and dependencies

SEQUENTIAL EXPANSION WORKFLOW:
1. Use TodoWrite to create detailed expansion plan
2. Gather comprehensive project context
3. Analyze task complexity and requirements
4. Plan optimal subtask breakdown
5. Provide detailed expansion recommendations
6. Include dependency analysis
7. Suggest testing strategies
8. Document implementation approach

ORIGINAL REQUEST:
${basePrompt}

EXECUTION APPROACH:
Provide thorough analysis and recommendations for task expansion without modifying TaskMaster state directly.`;
	}

	/**
	 * Build sequential PRD parsing strategy (non-recursive)
	 */
	buildSequentialPRDParsingStrategy(basePrompt) {
		return `You are a TaskMaster AI assistant focused on systematic PRD analysis and planning.

AVAILABLE TOOLS:
• Shell: Execute commands for analysis
• TodoWrite: Create structured parsing plans
• Read: Analyze PRD and related documentation
• Grep: Search for existing patterns

SEQUENTIAL PRD PARSING WORKFLOW:
1. Use TodoWrite to create systematic parsing plan
2. Read and analyze complete PRD content
3. Identify all requirements and dependencies
4. Plan optimal task structure and hierarchy
5. Provide detailed task creation recommendations
6. Include complexity and dependency analysis
7. Suggest implementation sequence
8. Document testing and validation strategies

ORIGINAL REQUEST:
${basePrompt}

EXECUTION APPROACH:
Provide comprehensive analysis and structured recommendations for PRD-driven task creation without modifying TaskMaster state directly.`;
	}

	/**
	 * Build task update strategy
	 */
	buildTaskUpdateStrategy(basePrompt) {
		return `You are a TaskMaster AI assistant with task update capabilities.

AVAILABLE TOOLS:
• Shell: Execute commands for analysis
• TodoWrite: Create update plans
• Read: Analyze current context and changes
• Grep: Search for related patterns

TASK UPDATE WORKFLOW:
1. Analyze current task state and context
2. Identify specific changes needed
3. Plan update approach and implications
4. Consider dependency impacts
5. Provide detailed update recommendations

ORIGINAL REQUEST:
${basePrompt}

EXECUTION APPROACH:
Provide thorough analysis for task updates with consideration of broader project impact.`;
	}

	/**
	 * Build task creation strategy
	 */
	buildTaskCreationStrategy(basePrompt) {
		return `You are a TaskMaster AI assistant with task creation capabilities.

AVAILABLE TOOLS:
• Shell: Execute commands for analysis
• TodoWrite: Create task creation plans
• Read: Analyze project context
• Grep: Search for patterns and dependencies

TASK CREATION WORKFLOW:
1. Analyze task creation requirements
2. Gather relevant project context
3. Plan task structure and dependencies
4. Consider complexity and implementation approach
5. Provide detailed task creation recommendations

ORIGINAL REQUEST:
${basePrompt}

EXECUTION APPROACH:
Provide comprehensive analysis for creating well-structured tasks with proper context and dependencies.`;
	}

	/**
	 * Build complexity analysis strategy
	 */
	buildComplexityAnalysisStrategy(basePrompt) {
		return `You are a TaskMaster AI assistant with complexity analysis capabilities.

AVAILABLE TOOLS:
• Shell: Execute commands for codebase analysis
• TodoWrite: Create analysis plans
• Read: Analyze code and project files
• Grep: Search for complexity patterns

COMPLEXITY ANALYSIS WORKFLOW:
1. Create systematic analysis plan
2. Gather codebase metrics and patterns
3. Analyze task complexity factors
4. Identify potential bottlenecks and challenges
5. Provide detailed complexity assessment and recommendations

ORIGINAL REQUEST:
${basePrompt}

EXECUTION APPROACH:
Provide thorough complexity analysis with actionable recommendations for task optimization.`;
	}

	/**
	 * Create a progress tracker for cursor-agent operations
	 * @param {object} options - Progress tracker options
	 * @returns {CursorAgentProgressTracker} Configured progress tracker
	 */
	createProgressTracker(options = {}) {
		return createCursorAgentProgressTracker({
			operationType: 'cursor-agent',
			operationDescription:
				options.description || 'Processing cursor-agent request',
			...options
		});
	}

	/**
	 * Create a recursive progress tracker for complex operations
	 * @param {number} maxDepth - Maximum recursion depth
	 * @param {string} operationType - Type of recursive operation
	 * @returns {CursorAgentProgressTracker} Configured recursive progress tracker
	 */
	createRecursiveProgressTracker(
		maxDepth = 3,
		operationType = 'recursive-expand'
	) {
		return createRecursiveCursorAgentProgressTracker(maxDepth, operationType);
	}

	/**
	 * Get current session statistics for monitoring and debugging
	 * @returns {object} Session statistics including active sessions, operation types, etc.
	 */
	getSessionStats() {
		return sessionManager.getSessionStats();
	}

	/**
	 * Force cleanup of a specific session (for debugging/emergency use)
	 * @param {string} sessionId - Session ID to cleanup
	 * @param {boolean} force - Force cleanup even if session appears active
	 * @returns {Promise<boolean>} True if cleanup successful
	 */
	async forceCleanupSession(sessionId, force = true) {
		return await sessionManager.cleanupSession(sessionId, force);
	}

	/**
	 * Perform emergency cleanup of all active sessions
	 */
	emergencyCleanupAll() {
		sessionManager.emergencyCleanupAll();
	}

	/**
	 * Get session cache statistics for monitoring and debugging
	 * @returns {object} Cache statistics including hit rate, active sessions, etc.
	 */
	getSessionCacheStats(projectRoot = process.cwd()) {
		const { getCacheStats } = require('../utils/cursor-agent-session-cache.js');
		return getCacheStats(projectRoot);
	}

	/**
	 * Clear cached session for a specific context
	 * @param {string} projectRoot - Project directory
	 * @param {string} model - Model used
	 * @returns {boolean} True if session was cleared
	 */
	clearCachedSession(projectRoot, model) {
		const { clearCachedSession } = require('../utils/cursor-agent-session-cache.js');
		clearCachedSession(projectRoot, model);
		return true;
	}

	/**
	 * Clear all cached sessions
	 * @returns {number} Number of sessions cleared
	 */
	clearAllCachedSessions(projectRoot = process.cwd()) {
		const { clearAllSessions } = require('../utils/cursor-agent-session-cache.js');
		return clearAllSessions(projectRoot);
	}

	/**
	 * Configure session caching at runtime
	 * @param {object} options - Configuration options
	 * @param {boolean} [options.enabled] - Enable/disable caching
	 * @param {number} [options.sessionTTL] - Session TTL in milliseconds
	 * @param {number} [options.maxSessions] - Maximum sessions to cache
	 */
	configureSessionCache(options = {}) {
		configureCaching(options);
		log('Session storage reconfigured', options);
	}

	/**
	 * Check if an error indicates a resume failure
	 * @param {string} errorMessage - Error message from cursor-agent
	 * @returns {boolean} True if this appears to be a resume failure
	 */
	isResumeFailure(errorMessage) {
		if (!errorMessage || typeof errorMessage !== 'string') {
			return false;
		}

		const resumeFailurePatterns = [
			/chat.*not found/i,
			/invalid.*chat.*id/i,
			/session.*expired/i,
			/unable to resume/i,
			/resume.*failed/i,
			/chat.*id.*invalid/i,
			/session.*not.*found/i,
			/conversation.*not.*found/i
		];

		return resumeFailurePatterns.some(pattern => pattern.test(errorMessage));
	}
}
