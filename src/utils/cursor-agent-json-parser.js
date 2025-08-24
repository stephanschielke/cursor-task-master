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

    // Extract session ID from any line and look for result object
    for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        try {
            const jsonObj = JSON.parse(trimmedLine);

            // Capture session ID from any object
            if (jsonObj.session_id && !sessionId) {
                sessionId = jsonObj.session_id;
            }

            // Look for the result object
            if (jsonObj.type === 'result') {
                resultObject = jsonObj;
                break; // Found it!
            }
        } catch (e) {
            // Skip invalid JSON lines - cursor-agent sometimes outputs partial lines
            continue;
        }
    }

    // Strategy 2: Fallback - regex search for result objects (for malformed streams)
    if (!resultObject) {
        // Look for result pattern in the entire output
        const resultPattern = /"type":"result"[^}]*"result":"([^"]*)"[^}]*"session_id":"([^"]*)"[^}]*/g;
        const match = resultPattern.exec(cleanOutput);

        if (match) {
            try {
                // Try to extract the full JSON object around this match
                const matchStart = match.index;
                let startPos = matchStart;
                let endPos = matchStart + match[0].length;

                // Find the start of the JSON object
                while (startPos > 0 && cleanOutput[startPos] !== '{') {
                    startPos--;
                }

                // Find the end using brace counting
                let braceCount = 0;
                for (let i = startPos; i < cleanOutput.length; i++) {
                    if (cleanOutput[i] === '{') braceCount++;
                    else if (cleanOutput[i] === '}') braceCount--;

                    if (braceCount === 0) {
                        endPos = i;
                        break;
                    }
                }

                if (braceCount === 0) {
                    const jsonStr = cleanOutput.substring(startPos, endPos + 1);
                    resultObject = JSON.parse(jsonStr);
                    sessionId = resultObject.session_id;
                }
            } catch (e) {
                console.warn('Cursor-agent fallback parsing failed:', e.message);
            }
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
        return null;
    }

    // Build standardized response object
    const isError = resultObject.is_error === true;
    const actualResult = resultObject.result || '';

    return {
        result: actualResult,
        is_error: isError,
        usage: {
            totalTokens: Math.round((resultObject.duration_api_ms || 0) / 100),
            promptTokens: Math.round(((resultObject.duration_api_ms || 0) / 100) * 0.7),
            completionTokens: Math.round(((resultObject.duration_api_ms || 0) / 100) * 0.3)
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
                    .filter(item => item.type === 'text')
                    .map(item => item.text)
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

export {
    parseCursorAgentOutput,
    extractAssistantMessages
};
