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
		try {
			const prompt = this.formatMessages(options.messages);
			const model = options.model || providerParams.modelId || 'sonnet-4';
			
			const args = this.buildCursorAgentArgs({
				model,
				outputFormat: 'json',
				withDiffs: true, // Use the new --with-diffs feature for better context
				apiKey: providerParams.apiKey
			});

			log('Calling cursor-agent with args:', { args, model });

			const result = await this.executeCursorAgent(args, prompt);
			
			if (result.is_error) {
				throw new Error(`Cursor Agent error: ${result.result}`);
			}

			return {
				text: result.result,
				usage: {
					totalTokens: result.total_tokens || 0,
					promptTokens: result.input_tokens || 0,
					completionTokens: result.output_tokens || 0
				},
				finishReason: 'stop'
			};
		} catch (error) {
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
		try {
			const basePrompt = this.formatMessages(options.messages);
			const schemaPrompt = `${basePrompt}\n\nIMPORTANT: Please respond with valid JSON that matches this schema exactly:\n${JSON.stringify(options.schema, null, 2)}\n\nResponse (JSON only):`;
			
			const textResult = await this.generateText({
				...options,
				messages: schemaPrompt
			}, providerParams);

			// Extract JSON from the response
			let jsonStr = textResult.text;
			
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
	 * Build command line arguments for cursor-agent
	 * @param {object} options - Options for building args
	 * @param {string} options.model - Model to use
	 * @param {string} options.outputFormat - Output format (json, text, stream-json)
	 * @param {boolean} [options.withDiffs] - Include git diffs in context
	 * @param {string} [options.apiKey] - API key if provided
	 * @returns {Array<string>} Command line arguments
	 */
	buildCursorAgentArgs(options) {
		const args = [
			'cursor-agent',
			'--print', // Print responses to console for scripts
			'--output-format', options.outputFormat || 'json'
		];

		// Add model if specified
		if (options.model) {
			args.push('--model', options.model);
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
	 * Execute cursor-agent command using tmux for proper interactive handling
	 * Enhanced with timeout management and JSON repair from upstream
	 * @param {Array<string>} args - Command arguments
	 * @param {string} prompt - Prompt to send to cursor-agent
	 * @returns {Promise<object>} Parsed response from cursor-agent
	 */
	async executeCursorAgent(args, prompt) {
		const operation = 'cursor-agent execution';
		const timeoutMs = 120000; // 2 minutes - increased for complex operations

		// Use enhanced timeout management from upstream
		return await TimeoutManager.withTimeout(
			this._executeCursorAgentCore(args, prompt),
			timeoutMs,
			operation
		);
	}

	/**
	 * Enhanced JSON parsing with automatic repair capability from upstream
	 * @private
	 */
	_parseJSONWithRepair(jsonString, context = 'unknown') {
		try {
			return JSON.parse(jsonString);
		} catch (error) {
			log('DEBUG: Initial JSON parse failed, attempting repair...', { context, error: error.message });

			try {
				const repairedJson = jsonrepair(jsonString);
				const parsed = JSON.parse(repairedJson);
				log('INFO: Successfully repaired JSON from cursor-agent', { context });
				return parsed;
			} catch (repairError) {
				log('DEBUG: JSON repair failed', { context, repairError: repairError.message });
				return null;
			}
		}
	}

	/**
	 * Core cursor-agent execution logic with enhanced error recovery
	 * @private
	 */
	async _executeCursorAgentCore(args, prompt) {
		return new Promise((resolve, reject) => {
			const timeout = 25000; // Internal timeout for polling
			const sessionName = `cursor-agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
			
			let tmpFile = null;
			try {
				log('Executing cursor-agent via tmux:', { 
					sessionName,
					command: args.join(' '), 
					promptLength: prompt.length,
					promptPreview: prompt.slice(0, 200) + '...'
				});

				// Create detached tmux session
				execSync(`tmux new-session -d -s ${sessionName}`, {
					encoding: 'utf8',
					timeout: 5000,
					cwd: process.cwd()
				});

				// Write prompt to temporary file to avoid shell escaping issues
				tmpFile = `/tmp/cursor-prompt-${sessionName}.txt`;
				try {
					fs.writeFileSync(tmpFile, prompt, 'utf8');
					log('DEBUG: Temp file created:', tmpFile);
				} catch (fileError) {
					throw new Error(`Failed to create temp file: ${fileError.message}`);
				}

				// Build command using temp file to avoid complex escaping
				const command = `cat ${tmpFile} | ${args.join(' ')}`;
				
				// DEBUG: Log the exact command being executed
				log('DEBUG: Executing command in tmux:', command);
				
				// Send command to tmux session using single quotes to avoid escaping issues
				execSync(`tmux send-keys -t ${sessionName} '${command}' Enter`, {
					encoding: 'utf8',
					timeout: 5000,
					cwd: process.cwd()
				});

				// Poll for completion
				let attempts = 0;
				const maxAttempts = Math.ceil(timeout / 2000); // Check every 2 seconds
				
				const checkCompletion = () => {
					attempts++;
					
					try {
						// Capture the pane output
						const output = execSync(`tmux capture-pane -t ${sessionName} -p`, {
							encoding: 'utf8',
							timeout: 5000,
							cwd: process.cwd()
						});

						// Look for any JSON response in the output
						log('DEBUG: tmux output:', output.slice(-500)); // Last 500 chars for debugging
						
						// Try multiple JSON extraction patterns
						let parsed = null;
						
						// Pattern 1: Look for {"type":"result"...} format 
						const resultMatch = output.match(/\{"type":"result".*?\}/s);
						if (resultMatch) {
							parsed = this._parseJSONWithRepair(resultMatch[0], 'result pattern');
							if (parsed) {
								log('DEBUG: Parsed JSON from result pattern');
							}
						}
						
						// Pattern 2: Look for any complete JSON object starting with {
						if (!parsed) {
							const lines = output.split('\n');
							for (let i = lines.length - 1; i >= 0; i--) {
								const line = lines[i].trim();
								if (line.startsWith('{') && line.endsWith('}')) {
									const testParsed = this._parseJSONWithRepair(line, `line ${i}`);
									if (testParsed && (testParsed.type || testParsed.result || testParsed.content)) {
										parsed = testParsed;
										log('DEBUG: Parsed JSON from line scan');
										break;
									}
								}
							}
						}
						
						if (parsed) {
								
								log('cursor-agent response received via tmux:', { 
									type: parsed.type, 
									isError: parsed.is_error,
									duration: parsed.duration_ms,
									sessionName
								});

								// Clean up tmux session and temp file
								try {
									execSync(`tmux kill-session -t ${sessionName}`, { timeout: 2000 });
								} catch (cleanupError) {
									log('Warning: Failed to cleanup tmux session:', { sessionName, error: cleanupError.message });
								}
								
								// Clean up temp file 
								if (tmpFile) {
									try {
										fs.unlinkSync(tmpFile);
									} catch (fileCleanupError) {
										log('Warning: Failed to cleanup temp file:', { tmpFile, error: fileCleanupError.message });
									}
								}
								
								resolve(parsed);
								return;
						}

						// Force kill logic: If we see substantial output but no JSON, kill after 15 seconds
						const hasSubstantialOutput = output.length > 200 && (
							output.includes('Hello!') || 
							output.includes('Perfect!') || 
							output.includes('Read ') || 
							attempts >= 8 // 16 seconds of polling
						);
						
						if (hasSubstantialOutput && !parsed) {
							log('DEBUG: Force killing cursor-agent - has substantial output but no clean JSON');
							try {
								execSync(`tmux kill-session -t ${sessionName}`, { timeout: 2000 });
							} catch (cleanupError) {
								log('Warning: Failed to force cleanup tmux session:', { sessionName, error: cleanupError.message });
							}
							
							// Clean up temp file 
							if (tmpFile) {
								try {
									fs.unlinkSync(tmpFile);
								} catch (fileCleanupError) {
									log('Warning: Failed to cleanup temp file:', { tmpFile, error: fileCleanupError.message });
								}
							}
							
							// Try to extract any useful text content as fallback
							const textContent = output
								.replace(/\x1b\[[0-9;]*m/g, '') // Remove ANSI codes
								.split('\n')
								.filter(line => line.trim().length > 0)
								.slice(-10) // Last 10 meaningful lines
								.join('\n');
								
							resolve({
								text: textContent || 'Response received but no clean JSON format',
								usage: { totalTokens: 0, promptTokens: 0, completionTokens: 0 },
								finishReason: 'force_stop'
							});
							return;
						}

						// Check if we've hit timeout
						if (attempts >= maxAttempts) {
							throw new Error(`Timeout waiting for cursor-agent response after ${timeout}ms`);
						}

						// Continue polling
						setTimeout(checkCompletion, 2000);
						
					} catch (error) {
						// Clean up session and temp file on error
						try {
							execSync(`tmux kill-session -t ${sessionName}`, { timeout: 2000 });
						} catch (cleanupError) {
							// Ignore cleanup errors
						}
						
						// Clean up temp file 
						if (tmpFile) {
							try {
								fs.unlinkSync(tmpFile);
							} catch (fileCleanupError) {
								// Ignore temp file cleanup errors
							}
						}
						
						reject(new Error(`cursor-agent tmux execution failed: ${error.message}`));
					}
				};

				// Start polling after a brief delay
				setTimeout(checkCompletion, 3000);
				
			} catch (error) {
				log('cursor-agent tmux setup error:', error);
				
				// Clean up session and temp file if they were created
				try {
					execSync(`tmux kill-session -t ${sessionName}`, { timeout: 2000 });
				} catch (cleanupError) {
					// Ignore cleanup errors
				}
				
				// Clean up temp file if it was created
				if (tmpFile) {
					try {
						fs.unlinkSync(tmpFile);
					} catch (fileCleanupError) {
						// Ignore temp file cleanup errors
					}
				}
				
				reject(new Error(`cursor-agent tmux setup failed: ${error.message}`));
			}
		});
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

	/**
	 * Check if cursor-agent is available and user is authenticated
	 * @returns {Promise<boolean>} True if cursor-agent is ready to use
	 */
	async isAvailable() {
		try {
			const result = execSync('cursor-agent status', { 
				encoding: 'utf8',
				timeout: 10000 
			});
			
			// Check if the status indicates the user is authenticated
			return !result.includes('not authenticated') && !result.includes('login required');
		} catch (error) {
			log('cursor-agent availability check failed:', error);
			return false;
		}
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
}
