/**
 * Cursor-Agent JSON Stream Parser
 *
 * Specialized parser for cursor-agent's stream-json output format.
 * Handles large responses with thousands of assistant message chunks.
 */

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

	// Strategy 1: Line-by-line parsing (most reliable for stream-json)
	const lines = cleanOutput.split('\n');
	let resultObject = null;
	let sessionId = null;

	console.log('[PARSER-DEBUG] Strategy 1: Line-by-line parsing');
	console.log('[PARSER-DEBUG] Total lines to parse:', lines.length);

	// Extract session ID from any line and look for result object
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmedLine = line.trim();
		if (!trimmedLine) continue;

		try {
			const jsonObj = JSON.parse(trimmedLine);

			// Log interesting objects
			if (jsonObj.type === 'result' || jsonObj.session_id) {
				console.log('[PARSER-DEBUG] Found interesting JSON object:', {
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
				console.log('[PARSER-DEBUG] Found result object on line', i);
				resultObject = jsonObj;
				break; // Found it!
			}
		} catch (e) {
			// Log problematic lines that might contain partial JSON
			if (
				trimmedLine.includes('result') ||
				trimmedLine.includes('session_id')
			) {
				console.log(
					'[PARSER-DEBUG] Failed to parse potentially important line:',
					{
						lineNumber: i,
						error: e.message,
						linePreview: trimmedLine.substring(0, 100),
						lineLength: trimmedLine.length
					}
				);
			}
			// Skip invalid JSON lines - cursor-agent sometimes outputs partial lines
			continue;
		}
	}

	console.log('[PARSER-DEBUG] Strategy 1 result:', {
		foundResultObject: !!resultObject,
		foundSessionId: !!sessionId
	});

	// Strategy 2: Fallback - regex search for result objects (for malformed streams)
	if (!resultObject) {
		console.log('[PARSER-DEBUG] Strategy 2: Regex-based extraction');

		// Look for "type":"result" pattern and then extract the full JSON object
		const resultTypeMatch = cleanOutput.match(/"type":"result"/);

		if (resultTypeMatch) {
			console.log(
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
				console.log(
					'[PARSER-DEBUG] Extracted JSON string length:',
					jsonStr.length
				);
				console.log('[PARSER-DEBUG] JSON preview:', jsonStr.substring(0, 200));

				try {
					resultObject = JSON.parse(jsonStr);
					sessionId = resultObject.session_id;
					console.log('[PARSER-DEBUG] Strategy 2 success: parsed JSON object');
				} catch (parseError) {
					console.warn(
						'[PARSER-DEBUG] Strategy 2 JSON parse failed:',
						parseError.message
					);
				}
			} else {
				console.warn(
					'[PARSER-DEBUG] Strategy 2: Unmatched braces, braceCount =',
					braceCount
				);
			}
		} else {
			console.log(
				'[PARSER-DEBUG] Strategy 2: No "type":"result" pattern found'
			);
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
		console.warn('❌ Cursor-agent JSON parsing failed');
		console.warn('📊 Response analysis:', {
			totalLength: output.length,
			hasResultMarker: output.includes('"type":"result"'),
			hasSessionId: output.includes('"session_id"'),
			truncatedPreview: output.slice(0, 200) + '...'
		});
		console.warn('💡 This might indicate:');
		console.warn(
			'   - Outdated TaskMaster CLI version (update with: npm install -g task-master-ai@latest)'
		);
		console.warn('   - Cursor-agent response truncation or timeout');
		console.warn('   - Network issues during cursor-agent execution');
		return null;
	}

	// Build standardized response object
	const isError = resultObject.is_error === true;
	let actualResult = resultObject.result || '';

	// Handle double-encoded JSON responses from cursor-agent
	// Always log what we're getting to debug the issue
	console.log('[PARSER-DEBUG] Raw result analysis:');
	console.log('[PARSER-DEBUG] - Type:', typeof actualResult);
	console.log('[PARSER-DEBUG] - Length:', actualResult.length);
	console.log(
		'[PARSER-DEBUG] - Preview (first 300 chars):',
		actualResult.substring(0, 300)
	);
	console.log(
		'[PARSER-DEBUG] - Last 100 chars):',
		actualResult.substring(Math.max(0, actualResult.length - 100))
	);

	if (typeof actualResult === 'string' && actualResult.length > 10) {
		// More aggressive detection: look for any escaped quotes or common JSON patterns
		const hasEscapedQuotes = actualResult.includes('\\"');
		const hasEscapedNewlines = actualResult.includes('\\n');
		const looksLikeJson =
			actualResult.startsWith('[') ||
			actualResult.startsWith('{') ||
			actualResult.startsWith('"[') ||
			actualResult.startsWith('"{');

		console.log('[PARSER-DEBUG] Detection flags:');
		console.log('[PARSER-DEBUG] - hasEscapedQuotes:', hasEscapedQuotes);
		console.log('[PARSER-DEBUG] - hasEscapedNewlines:', hasEscapedNewlines);
		console.log('[PARSER-DEBUG] - looksLikeJson:', looksLikeJson);

		if (looksLikeJson && (hasEscapedQuotes || hasEscapedNewlines)) {
			try {
				console.log(
					'[PARSER-DEBUG] Attempting to parse double-encoded JSON result'
				);
				const parsedResult = JSON.parse(actualResult);
				console.log('[PARSER-DEBUG] Successfully parsed double-encoded JSON');
				console.log('[PARSER-DEBUG] Parsed result type:', typeof parsedResult);
				console.log(
					'[PARSER-DEBUG] Parsed result preview:',
					JSON.stringify(parsedResult).substring(0, 200)
				);
				actualResult = parsedResult;
			} catch (parseError) {
				console.warn(
					'[PARSER-DEBUG] Failed to parse double-encoded JSON:',
					parseError.message
				);
				console.warn('[PARSER-DEBUG] Will try alternative parsing strategies');

				// Try removing outer quotes if present
				let cleanedResult = actualResult;
				if (actualResult.startsWith('"') && actualResult.endsWith('"')) {
					cleanedResult = actualResult.slice(1, -1);
					console.warn('[PARSER-DEBUG] Trying after removing outer quotes');
					try {
						const parsedResult = JSON.parse(cleanedResult);
						console.log('[PARSER-DEBUG] Success with outer quote removal');
						actualResult = parsedResult;
					} catch (cleanError) {
						console.warn(
							'[PARSER-DEBUG] Still failed after quote removal:',
							cleanError.message
						);
					}
				}
			}
		}
	}

	return {
		result: actualResult,
		is_error: isError,
		usage: {
			totalTokens: Math.round((resultObject.duration_api_ms || 0) / 100),
			promptTokens: Math.round(
				((resultObject.duration_api_ms || 0) / 100) * 0.7
			),
			completionTokens: Math.round(
				((resultObject.duration_api_ms || 0) / 100) * 0.3
			)
		},
		finishReason: 'stop',
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
