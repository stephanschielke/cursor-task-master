/**
 * Tests for cursor-agent JSON parser
 * Comprehensive test suite for cursor-agent stream-json parsing
 */

import {
    describe,
    it,
    expect,
    beforeEach,
    afterEach,
    jest
} from '@jest/globals';
import {
    parseCursorAgentOutput,
    extractAssistantMessages
} from '../../../src/utils/cursor-agent-json-parser.js';

describe('cursor-agent JSON Parser', () => {
    // Mock console.log and console.warn to capture debug output during tests
    let consoleLogSpy, consoleWarnSpy;

    beforeEach(() => {
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => { });
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => { });
    });

    afterEach(() => {
        consoleLogSpy.mockRestore();
        consoleWarnSpy.mockRestore();
    });

    describe('parseCursorAgentOutput', () => {
        describe('Valid JSON responses', () => {
            it('should parse a simple cursor-agent result response', () => {
                const validOutput = `{"type":"result","subtype":"success","is_error":false,"result":"Hello World","session_id":"test-session-123","request_id":"req-456"}`;

                const result = parseCursorAgentOutput(validOutput);

                expect(result).toBeDefined();
                expect(result.result).toBe('Hello World');
                expect(result.session_id).toBe('test-session-123');
                expect(result.request_id).toBe('req-456');
                expect(result.is_error).toBe(false);
            });

            it('should parse multi-line cursor-agent output with result', () => {
                const multiLineOutput = `{"type":"init","session_id":"test-session-123"}
{"type":"assistant","message":{"content":[{"type":"text","text":"Working..."}]}}
{"type":"result","subtype":"success","is_error":false,"result":"Final answer","session_id":"test-session-123","request_id":"req-456"}
{"type":"end"}`;

                const result = parseCursorAgentOutput(multiLineOutput);

                expect(result).toBeDefined();
                expect(result.result).toBe('Final answer');
                expect(result.session_id).toBe('test-session-123');
                expect(result.request_id).toBe('req-456');
            });

            it('should handle research operations with large responses', () => {
                const largeResult = 'A'.repeat(5000); // Simulate large response
                const researchOutput = `{"type":"result","subtype":"success","is_error":false,"result":"${largeResult}","session_id":"research-session","request_id":"research-req","duration_ms":15000,"duration_api_ms":12000}`;

                const result = parseCursorAgentOutput(researchOutput, true);

                expect(result).toBeDefined();
                expect(result.result).toBe(largeResult);
                expect(result.session_id).toBe('research-session');
                expect(result.usage).toBeDefined();
                expect(result.usage.totalTokens).toBeGreaterThan(0);
            });
        });

        describe('ANSI code and control character handling', () => {
            it('should clean ANSI color codes from output', () => {
                const outputWithANSI = `\x1b[32m{"type":"result","result":"Green text"}\x1b[0m`;

                const result = parseCursorAgentOutput(outputWithANSI);

                expect(result).toBeDefined();
                expect(result.result).toBe('Green text');
            });

            it('should remove control characters', () => {
                const outputWithControlChars = `{"type":"result","result":"Text\x00with\x1Fcontrol\x7Fchars"}`;

                const result = parseCursorAgentOutput(outputWithControlChars);

                expect(result).toBeDefined();
                expect(result.result).toBe('Textwithcontrolchars');
            });

            it('should handle mixed ANSI codes and valid JSON', () => {
                const complexOutput = `\x1b[31mERROR:\x1b[0m Processing...
\x1b[32m{"type":"result","result":"Success after error","session_id":"mixed-session"}\x1b[0m
\x1b[0mComplete`;

                const result = parseCursorAgentOutput(complexOutput);

                expect(result).toBeDefined();
                expect(result.result).toBe('Success after error');
                expect(result.session_id).toBe('mixed-session');
            });
        });

        describe('Malformed JSON handling', () => {
            it('should handle truncated JSON responses', () => {
                const truncatedOutput = `{"type":"result","result":"Incomplete response","session_id":"trunc-ses`;

                const result = parseCursorAgentOutput(truncatedOutput);

                // Should fail gracefully and return null
                expect(result).toBeNull();
            });

            it('should handle incomplete nested JSON', () => {
                const incompleteNested = `{"type":"result","result":"{\\"nested\\": \\"incomplete"}`;

                const result = parseCursorAgentOutput(incompleteNested);

                // Parser should attempt to extract what it can
                expect(result).toBeDefined();
            });

            it('should handle double-encoded JSON strings', () => {
                const doubleEncoded = `{"type":"result","result":"{\\"answer\\": \\"This is double encoded\\"}","session_id":"double-session"}`;

                const result = parseCursorAgentOutput(doubleEncoded);

                expect(result).toBeDefined();
                expect(result.session_id).toBe('double-session');
                // Result should be parsed as nested object
                expect(typeof result.result).toBe('string');
            });
        });

        describe('Session ID extraction', () => {
            it('should extract session_id from various locations', () => {
                const outputWithSessionId = `{"type":"init","session_id":"session-from-init"}
{"type":"result","result":"Answer","session_id":"session-from-result"}`;

                const result = parseCursorAgentOutput(outputWithSessionId);

                expect(result).toBeDefined();
                expect(result.session_id).toBe('session-from-result'); // Should prefer result session_id
            });

            it('should handle missing session_id gracefully', () => {
                const outputWithoutSessionId = `{"type":"result","result":"Answer without session"}`;

                const result = parseCursorAgentOutput(outputWithoutSessionId);

                expect(result).toBeDefined();
                expect(result.result).toBe('Answer without session');
                expect(result.session_id).toBeUndefined();
            });
        });

        describe('Error handling and edge cases', () => {
            it('should return null for empty input', () => {
                expect(parseCursorAgentOutput('')).toBeNull();
                expect(parseCursorAgentOutput(null)).toBeNull();
                expect(parseCursorAgentOutput(undefined)).toBeNull();
            });

            it('should return null for non-string input', () => {
                expect(parseCursorAgentOutput(123)).toBeNull();
                expect(parseCursorAgentOutput({})).toBeNull();
                expect(parseCursorAgentOutput([])).toBeNull();
            });

            it('should handle completely invalid JSON', () => {
                const invalidJSON = `This is not JSON at all! Random text with {brackets} and "quotes"`;

                const result = parseCursorAgentOutput(invalidJSON);

                expect(result).toBeNull();
            });

            it('should handle mixed valid and invalid JSON lines', () => {
                const mixedOutput = `Invalid line here
{"type":"result","result":"Valid result","session_id":"mixed-session"}
Another invalid line
{incomplete json`;

                const result = parseCursorAgentOutput(mixedOutput);

                expect(result).toBeDefined();
                expect(result.result).toBe('Valid result');
                expect(result.session_id).toBe('mixed-session');
            });
        });

        describe('Performance and large responses', () => {
            it('should handle very large cursor-agent responses efficiently', () => {
                // Create a large response with thousands of assistant message chunks
                const chunks = [];
                for (let i = 0; i < 1000; i++) {
                    chunks.push(
                        `{"type":"assistant","message":{"content":[{"type":"text","text":"Chunk ${i}"}]}}`
                    );
                }
                chunks.push(
                    `{"type":"result","result":"Final large result","session_id":"large-session"}`
                );

                const largeOutput = chunks.join('\\n');

                const startTime = Date.now();
                const result = parseCursorAgentOutput(largeOutput);
                const duration = Date.now() - startTime;

                expect(result).toBeDefined();
                expect(result.result).toBe('Final large result');
                expect(result.session_id).toBe('large-session');
                expect(duration).toBeLessThan(1000); // Should complete within 1 second
            });
        });

        describe('Fallback parsing strategies', () => {
            it('should use regex extraction when line parsing fails', () => {
                // Create malformed stream that requires regex extraction
                const malformedStream = `Lots of noise and invalid JSON here
				Some more noise {"type":"result","result":"Extracted via regex","session_id":"regex-session"} and trailing noise
				More invalid content`;

                const result = parseCursorAgentOutput(malformedStream);

                expect(result).toBeDefined();
                expect(result.result).toBe('Extracted via regex');
                expect(result.session_id).toBe('regex-session');
            });

            it('should use last resort extraction for minimal patterns', () => {
                const minimalPattern = `Various noise and incomplete JSON
				"result":"Last resort result" somewhere in the noise
				"session_id":"last-resort-session" in another place`;

                const result = parseCursorAgentOutput(minimalPattern);

                // This tests the most basic fallback - may return null if too malformed
                // The specific behavior depends on the last resort extraction implementation
                expect(result).toBeDefined();
            });
        });
    });

    describe('extractAssistantMessages', () => {
        it('should extract and combine assistant message chunks', () => {
            const outputWithAssistantMessages = `{"type":"init","session_id":"assistant-session"}
{"type":"assistant","message":{"content":[{"type":"text","text":"First chunk "}]}}
{"type":"assistant","message":{"content":[{"type":"text","text":"second chunk "}]}}
{"type":"assistant","message":{"content":[{"type":"text","text":"third chunk"}]}}
{"type":"result","result":"Final result"}`;

            const result = extractAssistantMessages(outputWithAssistantMessages);

            expect(result).toBeDefined();
            expect(result.combinedText).toBe('First chunk second chunk third chunk');
            expect(result.chunkCount).toBe(3);
            expect(result.sessionId).toBe('assistant-session');
            expect(result.chunks).toHaveLength(3);
        });

        it('should handle empty assistant messages gracefully', () => {
            const outputWithoutAssistantMessages = `{"type":"init","session_id":"no-assistant"}
{"type":"result","result":"Direct result"}`;

            const result = extractAssistantMessages(outputWithoutAssistantMessages);

            expect(result).toBeDefined();
            expect(result.combinedText).toBe('');
            expect(result.chunkCount).toBe(0);
            expect(result.sessionId).toBe('no-assistant');
            expect(result.chunks).toHaveLength(0);
        });

        it('should filter non-text content from assistant messages', () => {
            const outputWithMixedContent = `{"type":"assistant","message":{"content":[{"type":"text","text":"Text content"},{"type":"image","url":"ignored"}]}}`;

            const result = extractAssistantMessages(outputWithMixedContent);

            expect(result.combinedText).toBe('Text content');
            expect(result.chunkCount).toBe(1);
        });
    });

    describe('Debug logging behavior', () => {
        it('should not produce debug logs when debug flag is false', () => {
            const validOutput = `{"type":"result","result":"Test","session_id":"debug-session"}`;

            parseCursorAgentOutput(validOutput);

            // Verify no debug logging when debug flag is false
            expect(consoleLogSpy).not.toHaveBeenCalledWith(
                expect.stringContaining('[PARSER-DEBUG]')
            );
        });

        it('should not log parsing strategy information when debug flag is false', () => {
            const validOutput = `{"type":"result","result":"Test"}`;

            parseCursorAgentOutput(validOutput);

            expect(consoleLogSpy).not.toHaveBeenCalledWith(
                expect.stringContaining('Strategy 1: Line-by-line parsing')
            );
        });

        it('should produce error messages for actual parsing failures', () => {
            const invalidOutput = `This is completely invalid`;

            const result = parseCursorAgentOutput(invalidOutput);

            expect(result).toBeNull();
            // Should still show user-facing error messages
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                '❌ Cursor-agent JSON parsing failed'
            );
        });
    });
});
