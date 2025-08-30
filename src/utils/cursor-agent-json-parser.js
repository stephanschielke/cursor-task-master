/**
 * Cursor-Agent JSON Stream Parser
 *
 * Specialized parser for cursor-agent's stream-json output format.
 * Handles large responses with thousands of assistant message chunks.
 */

import { getDebugFlag } from '../../scripts/modules/config-manager.js';

/**
 * Debug logging utility - prevents MCP response stream contamination
 */
const DebugLogger = {
	/**
	 * Log debug messages only when debug flag is enabled
	 * Uses silent logging to prevent console contamination
	 * @param {...any} args - Arguments to log
	 */
	log(...args) {
		if (getDebugFlag()) {
			this.silent(...args);
		}
	},

	/**
	 * Log warnings only when debug flag is enabled
	 * @param {...any} args - Arguments to warn
	 */
	warn(...args) {
		if (getDebugFlag()) {
			this.silent(...args);
		}
	},

	/**
	 * Silent no-op logging function
	 * Prevents console output from contaminating MCP JSON response streams
	 * @param {...any} args - Ignored arguments
	 */
	silent() {
		// Silent operation - no console output to prevent MCP response contamination
	}
};

/**
 * Pattern matcher for detecting various error types in cursor-agent output
 */
const ErrorPatterns = {
	MCP_ERROR: /^MCP error/i,
	MCP_ERROR_CODE: /^MCP error -?\d+/i,
	CONNECTION_CLOSED: /connection closed/i,
	UNHANDLED_REJECTION: /unhandledRejection/i,
	WARNING: /^Warning:/i,
	ERROR: /^Error:/i,
	ERROR_PAREN: /^Error \(/i
};

/**
 * Build standardized response object
 */
function buildResponseObject(resultObject, actualResult, sessionId, mcpErrors = [], errors = [], warnings = []) {
	const estimatedTokens = Math.ceil((actualResult?.toString().length || 0) / 4);
	const inputTokens = Math.round(estimatedTokens * 0.7);
	const outputTokens = Math.round(estimatedTokens * 0.3);

	const hasErrors = mcpErrors.length > 0 || errors.length > 0;

	return {
		result: actualResult,
		is_error: resultObject.is_error === true || hasErrors,
		mcpErrors: mcpErrors,
		errors: errors,
		warnings: warnings,
		usage: {
			totalTokens: estimatedTokens,
			promptTokens: inputTokens,
			completionTokens: outputTokens
		},
		finishReason: hasErrors ? 'error' : 'stop',
		session_id: sessionId || resultObject.session_id,
		request_id: resultObject.request_id
	};
}

/**
 * Parse cursor-agent stream-json output to extract the result
 * @param {string} output - Raw cursor-agent stream output
 * @param {boolean} isResearchOperation - Whether this is a research operation (affects parsing strategy)
 * @returns {Object|null} Parsed result object or null if parsing fails
 */
function parseCursorAgentOutput(output, isResearchOperation = false) {
	if (!output || typeof output !== 'string') {
		return null;
	}

	// Clean output: Remove ANSI codes and control characters
	const cleanOutput = output
		.replace(/\x1b\[[0-9;]*m/g, '') // Remove ANSI color codes
		.replace(/[\x00-\x1F\x7F]/g, ''); // Remove control characters

	// Strategy 1: Handle both normal and concatenated cursor-agent output
	let lines = cleanOutput.split('\n');

	// If we have very few lines but the content is long, cursor-agent likely concatenated everything
	if (lines.length <= 3 && cleanOutput.length > 500) {
		DebugLogger.log('[PARSER-DEBUG] Detected concatenated cursor-agent output, attempting to split...');

		// Try to split on JSON object boundaries and error patterns
		let splitContent = cleanOutput
			// Add newlines before JSON objects
			.replace(/}\s*{/g, '}\n{')
			// Add newlines before error patterns
			.replace(/(Error \(|McpError:|Warning:)/g, '\n$1')
			// Add newlines after stack traces (lines starting with "    at")
			.replace(/(\s+at [^\n]+)/g, '$1\n');

		lines = splitContent.split('\n');
		DebugLogger.log('[PARSER-DEBUG] After splitting: got', lines.length, 'lines');
	}

	let resultObject = null;
	let sessionId = null;
	const mcpErrors = [];
	const errors = [];
	const warnings = [];

	DebugLogger.log('[PARSER-DEBUG] Strategy 1: Line-by-line parsing');
	DebugLogger.log('[PARSER-DEBUG] Total lines to parse:', lines.length);

	// Extract session ID from any line and look for result object
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmedLine = line.trim();
		if (!trimmedLine) continue;

		// CRITICAL: Capture MCP errors (these explain empty results!)
		if (trimmedLine.includes('MCP error') || trimmedLine.includes('McpError')) {
			mcpErrors.push(trimmedLine);
			DebugLogger.log('[PARSER-ERROR] MCP Error detected:', trimmedLine);
			continue;
		}

		// Capture other error patterns
		if (trimmedLine.includes('Error (') || trimmedLine.startsWith('Error:')) {
			errors.push(trimmedLine);
			DebugLogger.log('[PARSER-ERROR] Error detected:', trimmedLine);
			continue;
		}

		// Capture warnings
		if (trimmedLine.includes('Warning:') || trimmedLine.includes('WARN')) {
			warnings.push(trimmedLine);
			DebugLogger.log('[PARSER-WARN] Warning detected:', trimmedLine);
			continue;
		}

		try {
			const jsonObj = JSON.parse(trimmedLine);

			// Log interesting objects
			if (jsonObj.type === 'result' || jsonObj.session_id) {
				DebugLogger.log('[PARSER-DEBUG] Found interesting JSON object:', {
					lineNumber: i,
					type: jsonObj.type,
					hasResult: !!jsonObj.result,
					resultLength: jsonObj.result ? jsonObj.result.length : 0,
					hasSessionId: !!jsonObj.session_id,
					lineLength: trimmedLine.length
				});
			}

			// Capture session ID from any object
			if (jsonObj.session_id && !sessionId) {
				sessionId = jsonObj.session_id;
			}

			// Look for the result object
			if (jsonObj.type === 'result') {
				DebugLogger.log('[PARSER-DEBUG] Found result object on line', i);
				resultObject = jsonObj;
				break; // Found it!
			}
		} catch (e) {
			// Log problematic lines that might contain partial JSON
			if (
				trimmedLine.includes('result') ||
				trimmedLine.includes('session_id')
			) {
				DebugLogger.log('[PARSER-DEBUG] Failed to parse potentially important line:', {
					lineNumber: i,
					error: e.message,
					linePreview: trimmedLine.substring(0, 100),
					lineLength: trimmedLine.length
				});
			}
			// Skip invalid JSON lines - cursor-agent sometimes outputs partial lines
			continue;
		}
	}

	DebugLogger.log('[PARSER-DEBUG] Strategy 1 result:', {
		foundResultObject: !!resultObject,
		foundSessionId: !!sessionId
	});

	// Strategy 2: Fallback - regex search for result objects (for malformed streams)
	if (!resultObject) {
		DebugLogger.log('[PARSER-DEBUG] Strategy 2: Regex-based extraction');

		// Look for "type":"result" pattern and then extract the full JSON object
		const resultTypeMatch = cleanOutput.match(/"type":"result"/);

		if (resultTypeMatch) {
			DebugLogger.log(
				'[PARSER-DEBUG] Found "type":"result" at position',
				resultTypeMatch.index
			);

			// Find the start of the JSON object containing this match
			let startPos = resultTypeMatch.index;
			while (startPos > 0 && cleanOutput[startPos] !== '{') {
				startPos--;
			}

			// Find the end using brace counting from the start position
			let braceCount = 0;
			let endPos = startPos;
			let inString = false;
			let escapeNext = false;

			for (let i = startPos; i < cleanOutput.length; i++) {
				const char = cleanOutput[i];

				if (escapeNext) {
					escapeNext = false;
					continue;
				}

				if (char === '\\') {
					escapeNext = true;
					continue;
				}

				if (char === '"' && !escapeNext) {
					inString = !inString;
					continue;
				}

				if (!inString) {
					if (char === '{') braceCount++;
					else if (char === '}') braceCount--;

					if (braceCount === 0) {
						endPos = i;
						break;
					}
				}
			}

			if (braceCount === 0) {
				const jsonStr = cleanOutput.substring(startPos, endPos + 1);
				DebugLogger.log('[PARSER-DEBUG] Extracted JSON string length:', jsonStr.length);
				DebugLogger.log('[PARSER-DEBUG] JSON preview:', jsonStr.substring(0, 200));

				try {
					resultObject = JSON.parse(jsonStr);
					sessionId = resultObject.session_id;
					DebugLogger.log('[PARSER-DEBUG] Strategy 2 success: parsed JSON object');
				} catch (parseError) {
					DebugLogger.log(
						'[PARSER-DEBUG] Strategy 2 JSON parse failed:',
						parseError.message
					);
				}
			} else {
				DebugLogger.log(
					'[PARSER-DEBUG] Strategy 2: Unmatched braces, braceCount =',
					braceCount
				);
			}
		} else {
			DebugLogger.log('[PARSER-DEBUG] Strategy 2: No "type":"result" pattern found');
		}
	}

	// Strategy 3: Last resort - look for any "result" field in the output
	if (!resultObject && isResearchOperation) {
		// For research operations, try to extract result content even from partial data
		const resultContentMatch = cleanOutput.match(/"result":"([^"]+)"/);
		const sessionMatch = cleanOutput.match(/"session_id":"([^"]+)"/);

		if (resultContentMatch && sessionMatch) {
			resultObject = {
				type: 'result',
				result: resultContentMatch[1],
				session_id: sessionMatch[1],
				is_error: false,
				duration_ms: 0,
				duration_api_ms: 0
			};
			sessionId = sessionMatch[1];
		}
	}

	if (!resultObject) {
		// Enhanced debugging info for malformed responses
		DebugLogger.log('❌ Cursor-agent JSON parsing failed');
		DebugLogger.log('📊 Response analysis:', {
			totalLength: output.length,
			hasResultMarker: output.includes('"type":"result"'),
			hasSessionId: output.includes('"session_id"'),
			mcpErrorCount: mcpErrors.length,
			errorCount: errors.length,
			warningCount: warnings.length,
			truncatedPreview: output.slice(0, 200) + '...'
		});

		// Report critical MCP errors that explain empty results
		if (mcpErrors.length > 0) {
			DebugLogger.log('🚨 MCP ERRORS DETECTED (These explain empty results):');
			mcpErrors.forEach((error) => DebugLogger.log('   -', error));
		}

		if (errors.length > 0) {
			DebugLogger.log('⚠️ OTHER ERRORS:');
			errors.forEach((error) => DebugLogger.log('   -', error));
		}

		DebugLogger.log('💡 This might indicate:');
		DebugLogger.log(
			'   - Outdated TaskMaster CLI version (update with: npm install -g task-master-ai@latest)'
		);
		DebugLogger.log('   - Cursor-agent response truncation or timeout');
		DebugLogger.log('   - Network issues during cursor-agent execution');
		DebugLogger.log('   - MCP server connection issues');

		return {
			result: '',
			is_error: true,
			mcpErrors: mcpErrors,
			errors: errors,
			warnings: warnings,
			usage: { totalTokens: 0, promptTokens: 0, completionTokens: 0 },
			finishReason: 'error',
			session_id: sessionId,
			request_id: null
		};
	}

	// Build standardized response object
	const isError = resultObject.is_error === true;
	let actualResult = resultObject.result || '';

	// Handle double-encoded JSON responses from cursor-agent
	// Early return for non-string results (already parsed JSON objects)
	if (typeof actualResult !== 'string') {
		return buildResponseObject(resultObject, actualResult, sessionId, mcpErrors, errors, warnings);
	}

	// Early return for very short strings (unlikely to be double-encoded)
	if (actualResult.length <= 10) {
		return buildResponseObject(resultObject, actualResult, sessionId, mcpErrors, errors, warnings);
	}

	// At this point, actualResult is guaranteed to be a string with length > 10
	// More aggressive detection: look for any escaped quotes or common JSON patterns
	const hasEscapedQuotes = actualResult.includes('\\"');
	const hasEscapedNewlines = actualResult.includes('\\n');
	const looksLikeJson =
		actualResult.startsWith('[') ||
		actualResult.startsWith('{') ||
		actualResult.startsWith('"[') ||
		actualResult.startsWith('"{');

	DebugLogger.log('[PARSER-DEBUG] Detection flags:');
	DebugLogger.log('[PARSER-DEBUG] - hasEscapedQuotes:', hasEscapedQuotes);
	DebugLogger.log('[PARSER-DEBUG] - hasEscapedNewlines:', hasEscapedNewlines);
	DebugLogger.log('[PARSER-DEBUG] - looksLikeJson:', looksLikeJson);

	if (looksLikeJson && (hasEscapedQuotes || hasEscapedNewlines)) {
		try {
			DebugLogger.log('[PARSER-DEBUG] Attempting to parse double-encoded JSON result');
			const parsedResult = JSON.parse(actualResult);
			DebugLogger.log('[PARSER-DEBUG] Successfully parsed double-encoded JSON');
			DebugLogger.log('[PARSER-DEBUG] Parsed result type:', typeof parsedResult);
			DebugLogger.log(
				'[PARSER-DEBUG] Parsed result preview:',
				JSON.stringify(parsedResult).substring(0, 200)
			);
			actualResult = parsedResult;
		} catch (parseError) {
			DebugLogger.log(
				'[PARSER-DEBUG] Failed to parse double-encoded JSON:',
				parseError.message
			);
			DebugLogger.log('[PARSER-DEBUG] Will try alternative parsing strategies');

			// Try removing outer quotes if present
			let cleanedResult = actualResult;
			if (actualResult.startsWith('"') && actualResult.endsWith('"')) {
				cleanedResult = actualResult.slice(1, -1);
				DebugLogger.log('[PARSER-DEBUG] Trying after removing outer quotes');
				try {
					const parsedResult = JSON.parse(cleanedResult);
					DebugLogger.log('[PARSER-DEBUG] Success with outer quote removal');
					actualResult = parsedResult;
				} catch (cleanError) {
					DebugLogger.log(
						'[PARSER-DEBUG] Still failed after quote removal:',
						cleanError.message
					);
				}
			}
		}
	}

	return {
		result: actualResult,
		is_error: isError || mcpErrors.length > 0, // Mark as error if MCP errors found
		mcpErrors: mcpErrors,
		errors: errors,
		warnings: warnings,
		usage: {
			totalTokens: Math.round((resultObject.duration_api_ms || 0) / 100),
			promptTokens: Math.round(
				((resultObject.duration_api_ms || 0) / 100) * 0.7
			),
			completionTokens: Math.round(
				((resultObject.duration_api_ms || 0) / 100) * 0.3
			)
		},
		finishReason: mcpErrors.length > 0 ? 'error' : 'stop',
		session_id: sessionId || resultObject.session_id,
		request_id: resultObject.request_id
	};
}

/**
 * Extract all assistant message chunks and combine them into a single response
 * Useful for debugging or alternative parsing strategies
 * @param {string} output - Raw cursor-agent output
 * @returns {Object} Combined assistant response with metadata
 */
function extractAssistantMessages(output) {
	const lines = output.split('\n');
	const assistantChunks = [];
	let sessionId = null;

	for (const line of lines) {
		const trimmedLine = line.trim();
		if (!trimmedLine) continue;

		try {
			const jsonObj = JSON.parse(trimmedLine);

			if (jsonObj.session_id && !sessionId) {
				sessionId = jsonObj.session_id;
			}

			if (jsonObj.type === 'assistant' && jsonObj.message?.content) {
				const textContent = jsonObj.message.content
					.filter((item) => item.type === 'text')
					.map((item) => item.text)
					.join('');

				if (textContent) {
					assistantChunks.push(textContent);
				}
			}
		} catch (e) {
			continue;
		}
	}

	return {
		combinedText: assistantChunks.join(''),
		chunkCount: assistantChunks.length,
		sessionId: sessionId,
		chunks: assistantChunks
	};
}

export { parseCursorAgentOutput, extractAssistantMessages };
