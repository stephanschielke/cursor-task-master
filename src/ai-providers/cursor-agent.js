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
import { createCursorAgentProgressTracker, createRecursiveCursorAgentProgressTracker } from '../progress/cursor-agent-progress-tracker.js';

export class CursorAgentProvider extends BaseAIProvider {
	constructor() {
		super();
		this.name = 'Cursor Agent';
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
					return await this.generateText(options, params);
				},
				generateObject: async (options) => {
					return await this.generateObject(options, params);
				},
				streamText: async (options) => {
					// For now, we'll use generateText and return a simple stream-like object
					const result = await this.generateText(options, params);
					return {
						textStream: async function* () {
							yield result.text;
						},
						usage: result.usage
					};
				}
			};
		} catch (error) {
			log('cursor-agent client initialization error:', error);
			throw new Error(`Cursor Agent client initialization failed: ${error.message}`);
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
		const progressTracker = options.progressTracker || providerParams.progressTracker;

		try {
			// Start progress tracking if enabled
			if (progressTracker) {
				progressTracker.updateProgress(0, 'Preparing cursor-agent request');
			}

			const prompt = this.formatMessages(options.messages, {
				mode: providerParams.mode || 'recursive'
			});
			const model = options.model || providerParams.modelId || 'sonnet-4';

			const args = this.buildCursorAgentArgs({
				model,
				// Use default stream-json format (don't specify outputFormat)
				withDiffs: false, // Disabled for now. Use the new --with-diffs feature for better context
				apiKey: providerParams.apiKey
			});

			log('Calling cursor-agent with args:', { args, model });

			if (progressTracker) {
				progressTracker.updateProgress(0.1, 'Executing cursor-agent');
			}

			const result = await this.executeCursorAgent(args, prompt, progressTracker);

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
				progressTracker.updateTokensWithCost(inputTokens, outputTokens, 0, 0, false);
				progressTracker.complete('Text generation completed');
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
		const progressTracker = options.progressTracker || providerParams.progressTracker;

		try {
			if (progressTracker) {
				progressTracker.updateProgress(0, 'Preparing structured generation request');
			}

			// For JSON generation, bypass the formatMessages enhancements that make cursor-agent conversational
			// Extract the raw prompt without TaskMaster-specific enhancements
			const rawPrompt = this.extractBasePrompt(options.messages);

			// Build schema instructions if schema is provided
			let schemaInstructions = '';
			if (options.schema && options.objectName) {
				// Convert Zod schema to readable format for cursor-agent
				schemaInstructions = this._buildSchemaInstructions(options.schema, options.objectName);
			}

			// Create explicit JSON-only instructions for cursor-agent
			const schemaPrompt = `${rawPrompt}

${schemaInstructions}

IMPORTANT: Respond with ONLY valid JSON that matches the required structure above. Do not include any explanatory text, markdown formatting, or conversational responses. Return only the JSON object.

Do not use any tools or commands. Do not provide explanations. Just return clean JSON.`;

			const textResult = await this.generateText({
				...options,
				messages: schemaPrompt,
				progressTracker: progressTracker
			}, providerParams);

		// Extract JSON from the response
		let jsonStr = textResult?.text;

		// Check if we have valid text response
		if (!jsonStr || typeof jsonStr !== 'string') {
			throw new Error(`Invalid response from cursor-agent: expected text string, got ${typeof jsonStr}. Response: ${JSON.stringify(textResult)}`);
		}

		// Try to find JSON in the response if it's wrapped in other text
		const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
		if (jsonMatch) {
			jsonStr = jsonMatch[0];
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

				// Try to repair the JSON
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
					throw new Error(`Failed to parse JSON response: ${parseError.message}. Raw response: ${jsonStr}`);
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
			// For TaskMaster schemas, provide explicit JSON structure
			if (objectName === 'newTaskData') {
				return `Return a JSON object with exactly this structure:
{
  "title": "Clear, concise title for the task",
  "description": "A one or two sentence description of the task",
  "details": "In-depth implementation details, considerations, and guidance",
  "testStrategy": "Detailed approach for verifying task completion",
  "dependencies": null
}

All fields are required strings except dependencies which should be null for new tasks.`;
			}

			// Check if this looks like PRD parsing based on schema structure
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

			if (objectName === 'tasks_data' || objectName === 'generated_object') {
				return `Return a properly structured JSON object that matches the expected format for the request.`;
			}

			// Generic schema instruction fallback
			return `Return a valid JSON object with the appropriate structure for: ${objectName}`;
		} catch (error) {
			return `Return a valid JSON object.`;
		}
	}

	mapModelIdToCursorAgent(modelId) {
		const modelMap = {
			'sonnet-4': 'sonnet',
			'gpt-5': 'gpt-5',
			'opus': 'opus',
			// Keep original names as fallback
			'sonnet': 'sonnet',
			'gpt5': 'gpt-5'
		};

		return modelMap[modelId] || modelId;
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
		];

		// Do NOT use --output-format=json as it causes hanging!
		// The default 'stream-json' format works perfectly and provides structured output

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
	 * Execute cursor-agent command using tmux for proper interactive handling
	 * Enhanced with timeout management and JSON repair from upstream
	 * @param {Array<string>} args - Command arguments
	 * @param {string} prompt - Prompt to send to cursor-agent
	 * @param {object} [progressTracker] - Optional progress tracker for visual feedback
	 * @returns {Promise<object>} Parsed response from cursor-agent
	 */
	async executeCursorAgent(args, prompt, progressTracker = null) {
		const operation = 'cursor-agent execution';
		const timeoutMs = 120000; // 2 minutes - increased for complex operations

		if (progressTracker) {
			progressTracker.nextPhase(); // Advance to execution phase
		}

		// Use enhanced timeout management from upstream
		return await TimeoutManager.withTimeout(
			this._executeCursorAgentCore(args, prompt, progressTracker),
			timeoutMs,
			operation
		);
	}

		/**
	 * Core cursor-agent execution logic with real-time stdout monitoring (Option 1 - Elegant)
	 * @private
	 */
	async _executeCursorAgentCore(args, prompt, progressTracker = null) {
		return new Promise((resolve, reject) => {
			const sessionId = `cursor-agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
			let tmpFile = null;
			let child = null;
			let resultFound = false;

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

				let outputBuffer = '';

				// Real-time stdout monitoring - this is the elegant part!
				child.stdout.on('data', (data) => {
					const chunk = data.toString();
					outputBuffer += chunk;

					log('DEBUG: Received chunk length:', chunk.length, 'total buffer:', outputBuffer.length);

					// Look for completion marker in real-time
					if (chunk.includes('"type":"result"') && !resultFound) {
						log('DEBUG: Found result marker, parsing completion...');

						// Give a small buffer for the JSON to complete
						setTimeout(() => {
							if (!resultFound) {
								resultFound = true;
								const parsed = this._parseCompletionFromOutput(outputBuffer);

								if (parsed) {
									log('cursor-agent response received (direct):', {
										resultLength: parsed.result?.length || 0,
										isError: parsed.is_error,
										sessionId: parsed.session_id
									});

									cleanup();
									resolve(parsed);
								} else {
									cleanup();
									reject(new Error('Failed to parse cursor-agent result despite finding marker'));
								}
							}
						}, 200); // Small buffer for JSON completion
					}
				});

				child.stdout.on('end', () => {
					log('DEBUG: stdout stream ended');
				});

				child.stderr.on('data', (data) => {
					log('cursor-agent stderr:', data.toString());
				});

				child.on('close', (code) => {
					if (!resultFound) {
						log('DEBUG: Process closed with code', code, 'buffer length:', outputBuffer.length);
						log('DEBUG: Final buffer content (last 300 chars):', outputBuffer.slice(-300));

						// Process completed, try to parse final output
						const parsed = this._parseCompletionFromOutput(outputBuffer);
						cleanup();

						if (parsed) {
							log('DEBUG: Successfully parsed result on close event');
							resolve(parsed);
						} else {
							reject(new Error(`cursor-agent exited with code ${code}, no result found. Buffer length: ${outputBuffer.length}`));
						}
					}
				});

				child.on('error', (error) => {
					if (!resultFound) {
						cleanup();
						reject(new Error(`cursor-agent process error: ${error.message}`));
					}
				});

				// Timeout handling
				const timeout = setTimeout(() => {
					if (!resultFound) {
						log('DEBUG: Timeout reached, killing process...');
						if (child && !child.killed) {
							child.kill('SIGTERM');
							setTimeout(() => {
								if (child && !child.killed) {
									child.kill('SIGKILL');
								}
							}, 5000);
						}
						cleanup();
						reject(new Error('cursor-agent timeout after 120 seconds'));
					}
				}, 120000); // 2 minutes

				const cleanup = () => {
					clearTimeout(timeout);

					// Properly terminate the child process if it's still running
					if (child && !child.killed) {
						log('DEBUG: Terminating child process and removing listeners...');

						// Remove all listeners to prevent hanging
						child.removeAllListeners();

						// Kill the process
						child.kill('SIGTERM');
					}

					if (tmpFile) {
						try {
							fs.unlinkSync(tmpFile);
							log('DEBUG: Cleaned up temp file:', tmpFile);
						} catch (fileCleanupError) {
							log('Warning: Failed to cleanup temp file:', { tmpFile, error: fileCleanupError.message });
						}
					}
				};

				if (progressTracker) {
					progressTracker.updateProgress(0.4, 'Monitoring cursor-agent output in real-time');
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

				reject(new Error(`cursor-agent direct execution setup failed: ${error.message}`));
			}
		});
	}

	/**
	 * Parse completion result from cursor-agent output
	 * @private
	 */
	_parseCompletionFromOutput(output) {
		const cleanOutput = output
			.replace(/\x1b\[[0-9;]*m/g, '') // Remove ANSI color codes
			.replace(/[\x00-\x1F\x7F]/g, ''); // Remove control characters

		// Try to find complete JSON objects by finding balanced braces for {"type":"result"...}
		const resultLineRegex = /"type":"result"[^}]*}/g;
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
								promptTokens: Math.round(((resultObj.duration_api_ms || 0) / 100) * 0.7),
								completionTokens: Math.round(((resultObj.duration_api_ms || 0) / 100) * 0.3)
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
			if (trimmedLine.includes('"type":"result"') && trimmedLine.includes('"result":')) {
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
								promptTokens: Math.round(((resultObj.duration_api_ms || 0) / 100) * 0.7),
								completionTokens: Math.round(((resultObj.duration_api_ms || 0) / 100) * 0.3)
							},
							finishReason: 'stop',
							session_id: resultObj.session_id,
							request_id: resultObj.request_id
						};

						log('DEBUG: Successfully parsed cursor-agent result via fallback:', {
							isError,
							resultLength: actualResult.length,
							sessionId: resultObj.session_id
						});

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
				.map(msg => {
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
			expand_task: isRecursive ? this.buildTaskExpansionStrategy : this.buildSequentialTaskExpansionStrategy,
			parse_prd: isRecursive ? this.buildPRDParsingStrategy : this.buildSequentialPRDParsingStrategy,
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
			operationDescription: options.description || 'Processing cursor-agent request',
			...options
		});
	}

	/**
	 * Create a recursive progress tracker for complex operations
	 * @param {number} maxDepth - Maximum recursion depth
	 * @param {string} operationType - Type of recursive operation
	 * @returns {CursorAgentProgressTracker} Configured recursive progress tracker
	 */
	createRecursiveProgressTracker(maxDepth = 3, operationType = 'recursive-expand') {
		return createRecursiveCursorAgentProgressTracker(maxDepth, operationType);
	}
}
