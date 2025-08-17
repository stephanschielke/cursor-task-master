/**
 * src/ai-providers/cursor-agent.js
 * 
 * Implementation for interacting with Cursor models via cursor-agent CLI
 * This provider leverages your existing Cursor subscription and authentication
 * while providing full workspace context to AI operations.
 */

import { BaseAIProvider } from './base-provider.js';
import { execSync, spawn } from 'child_process';
import { log } from '../../scripts/modules/utils.js';

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
	 * @param {Array<string>} args - Command arguments
	 * @param {string} prompt - Prompt to send to cursor-agent
	 * @returns {Promise<object>} Parsed response from cursor-agent
	 */
	async executeCursorAgent(args, prompt) {
		return new Promise((resolve, reject) => {
			const timeout = 25000; // 25 second timeout with force-kill at 16s
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
					require('fs').writeFileSync(tmpFile, prompt, 'utf8');
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
							try {
								parsed = JSON.parse(resultMatch[0]);
								log('DEBUG: Parsed JSON from result pattern');
							} catch (e) {
								log('DEBUG: Failed to parse result pattern JSON:', e.message);
							}
						}
						
						// Pattern 2: Look for any complete JSON object starting with {
						if (!parsed) {
							const lines = output.split('\n');
							for (let i = lines.length - 1; i >= 0; i--) {
								const line = lines[i].trim();
								if (line.startsWith('{') && line.endsWith('}')) {
									try {
										const testParsed = JSON.parse(line);
										if (testParsed.type || testParsed.result || testParsed.content) {
											parsed = testParsed;
											log('DEBUG: Parsed JSON from line scan');
											break;
										}
									} catch (e) {
										// Continue trying other lines
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
										require('fs').unlinkSync(tmpFile);
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
									require('fs').unlinkSync(tmpFile);
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
								require('fs').unlinkSync(tmpFile);
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
						require('fs').unlinkSync(tmpFile);
					} catch (fileCleanupError) {
						// Ignore temp file cleanup errors
					}
				}
				
				reject(new Error(`cursor-agent tmux setup failed: ${error.message}`));
			}
		});
	}

	/**
	 * Format messages for cursor-agent consumption
	 * @param {Array|string} messages - Messages to format
	 * @returns {string} Formatted prompt string
	 */
	formatMessages(messages) {
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
}
