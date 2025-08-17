/**
 * enhanced-research.js
 * Enhanced performResearch function with web search integration
 */

import chalk from 'chalk';
import boxen from 'boxen';
import { highlight } from 'cli-highlight';
import { performResearch as originalPerformResearch } from './research.js';
import { 
    shouldUseWebSearch, 
    performWebSearch, 
    integrateWebSearchContext,
    createWebSearchTelemetry 
} from './web-research.js';
import { log } from '../utils.js';

/**
 * Enhanced research function with intelligent web search integration
 * @param {string} query - Research query
 * @param {Object} options - Research options
 * @param {Object} context - Execution context  
 * @param {string} outputFormat - Output format ('text' or 'json')
 * @param {boolean} allowFollowUp - Allow follow-up questions
 * @returns {Promise<Object>} Research results with web search integration
 */
export async function performEnhancedResearch(
    query,
    options = {},
    context = {},
    outputFormat = 'text',
    allowFollowUp = true
) {
    const { detailLevel = 'medium' } = options;
    const { mcpLog } = context;
    
    let webSearchResults = null;
    let webSearchTelemetry = { webSearchUsed: false };
    
    try {
        // Step 1: Determine if web search would be beneficial
        const useWebSearch = shouldUseWebSearch(query, detailLevel);
        
        if (useWebSearch) {
            if (outputFormat === 'text') {
                console.log(chalk.gray('🔍 Query benefits from web search, fetching current information...'));
            }
            
            mcpLog?.info('Performing web search to enhance research context');
            
            // Step 2: Perform web search with rate limiting
            try {
                webSearchResults = await performWebSearch(query, {
                    maxResults: getMaxResultsForDetailLevel(detailLevel),
                    engines: getOptimalEngines(query),
                    includeContent: detailLevel === 'high',
                    timeout: 15000
                }, { logFn: mcpLog });
                
                webSearchTelemetry = createWebSearchTelemetry(webSearchResults);
                
                if (outputFormat === 'text' && webSearchResults.results.length > 0) {
                    console.log(chalk.green(`✅ Found ${webSearchResults.results.length} relevant web results`));
                }
                
            } catch (webSearchError) {
                mcpLog?.warn(`Web search failed, continuing with local research: ${webSearchError.message}`);
                webSearchResults = { results: [], content: '', error: webSearchError.message };
            }
        }
        
        // Step 3: Call original research function
        const originalResult = await originalPerformResearch(
            query, 
            options, 
            context, 
            outputFormat, 
            allowFollowUp
        );
        
        // Step 4: If we have web search results, create enhanced version
        if (webSearchResults && webSearchResults.content) {
            const enhancedResult = await createEnhancedResearchResult(
                originalResult,
                webSearchResults,
                query,
                options,
                context,
                outputFormat
            );
            
            // Add web search telemetry to the result
            enhancedResult.webSearchTelemetry = webSearchTelemetry;
            
            return enhancedResult;
        }
        
        // Step 5: Return original result with web search telemetry
        return {
            ...originalResult,
            webSearchTelemetry
        };
        
    } catch (error) {
        mcpLog?.error(`Enhanced research failed: ${error.message}`);
        
        // Fallback to original research function
        const fallbackResult = await originalPerformResearch(
            query, 
            options, 
            context, 
            outputFormat, 
            allowFollowUp
        );
        
        return {
            ...fallbackResult,
            webSearchTelemetry,
            fallbackUsed: true,
            enhancementError: error.message
        };
    }
}

/**
 * Creates an enhanced research result by re-running AI with web search context
 * @param {Object} originalResult - Original research result
 * @param {Object} webSearchResults - Web search results  
 * @param {string} query - Original query
 * @param {Object} options - Research options
 * @param {Object} context - Execution context
 * @param {string} outputFormat - Output format
 * @returns {Promise<Object>} Enhanced research result
 */
async function createEnhancedResearchResult(
    originalResult, 
    webSearchResults, 
    query, 
    options, 
    context, 
    outputFormat
) {
    const { mcpLog } = context;
    
    try {
        // Import required modules for AI service call
        const { generateTextService } = await import('../ai-services-unified.js');
        const { getPromptManager } = await import('../prompt-manager.js');
        const { ContextGatherer } = await import('./context-gatherer.js');
        
        // Create enhanced context by integrating web search results
        const contextGatherer = new ContextGatherer(options.projectRoot, options.tag);
        
        // Get original context (we need to re-gather it)
        const contextResult = await contextGatherer.gather({
            tasks: options.taskIds || [],
            files: options.filePaths || [],
            customContext: options.customContext || '',
            includeProjectTree: options.includeProjectTree || false,
            format: 'research',
            includeTokenCounts: true
        });
        
        // Integrate web search results with original context
        const enhancedContext = integrateWebSearchContext(
            query,
            contextResult.context,
            webSearchResults,
            options.detailLevel
        );
        
        // Create enhanced prompt
        const promptManager = getPromptManager();
        const promptParams = {
            query: query,
            gatheredContext: enhancedContext,
            detailLevel: options.detailLevel,
            projectInfo: {
                root: options.projectRoot,
                taskCount: (options.taskIds || []).length,
                fileCount: (options.filePaths || []).length,
                webResultCount: webSearchResults.results.length
            },
            hasWebResults: true
        };
        
        const { systemPrompt, userPrompt } = await promptManager.loadPrompt(
            'research-enhanced', // Use enhanced research prompt if available
            promptParams
        ).catch(async () => {
            // Fallback to regular research prompt if enhanced doesn't exist
            return await promptManager.loadPrompt('research', promptParams);
        });
        
        if (outputFormat === 'text') {
            console.log(chalk.blue('🔄 Re-analyzing with web search context...'));
        }
        
        // Call AI service with enhanced context
        const enhancedAiResult = await generateTextService({
            role: 'research',
            session: context.session,
            projectRoot: options.projectRoot,
            systemPrompt,
            prompt: userPrompt,
            commandName: context.commandName || 'enhanced-research',
            outputType: context.outputType || 'mcp'
        });
        
        // Create enhanced result
        const enhancedResult = {
            ...originalResult,
            result: enhancedAiResult.mainResult, // Use enhanced AI result
            telemetryData: enhancedAiResult.telemetryData, // Updated telemetry
            webSearchResults: {
                resultCount: webSearchResults.results.length,
                engines: webSearchResults.metadata?.engines,
                timestamp: webSearchResults.metadata?.timestamp
            },
            enhancementUsed: true,
            contextEnhanced: true
        };
        
        // Display enhanced results if in text mode
        if (outputFormat === 'text') {
            displayEnhancedResearchResults(
                enhancedResult.result,
                query,
                options.detailLevel,
                webSearchResults,
                contextResult.tokenBreakdown
            );
        }
        
        return enhancedResult;
        
    } catch (error) {
        mcpLog?.warn(`Failed to create enhanced result: ${error.message}`);
        
        // Return original result with web search metadata
        return {
            ...originalResult,
            webSearchResults: {
                resultCount: webSearchResults.results.length,
                engines: webSearchResults.metadata?.engines,
                timestamp: webSearchResults.metadata?.timestamp
            },
            enhancementError: error.message,
            enhancementUsed: false
        };
    }
}

/**
 * Display enhanced research results with web search indicators
 */
function displayEnhancedResearchResults(result, query, detailLevel, webSearchResults, tokenBreakdown) {
    // Enhanced header with web search indicator
    const header = boxen(
        chalk.green.bold('🌐 Enhanced Research Results') +
        '\n\n' +
        chalk.gray('Query: ') +
        chalk.white(query) +
        '\n' +
        chalk.gray('Detail Level: ') +
        chalk.cyan(detailLevel) +
        '\n' +
        chalk.gray('Web Results: ') +
        chalk.yellow(`${webSearchResults.results.length} sources`) +
        '\n' +
        chalk.gray('Engines: ') +
        chalk.cyan((webSearchResults.metadata?.engines || []).join(', ')),
        {
            padding: { top: 1, bottom: 1, left: 2, right: 2 },
            margin: { top: 1, bottom: 0 },
            borderStyle: 'round',
            borderColor: 'green'
        }
    );
    console.log(header);
    
    // Process the result to highlight code blocks  
    const processedResult = processCodeBlocks(result);
    
    // Main research content in a clean box
    const contentBox = boxen(processedResult, {
        padding: { top: 1, bottom: 1, left: 2, right: 2 },
        margin: { top: 0, bottom: 0 },
        borderStyle: 'single',
        borderColor: 'gray'
    });
    console.log(contentBox);
    
    // Web search sources summary
    if (webSearchResults.results.length > 0) {
        const sourcesList = webSearchResults.results
            .slice(0, 3) // Show top 3 sources
            .map((result, i) => `${i+1}. ${result.title} - ${result.url}`)
            .join('\n');
        
        const sourcesBox = boxen(
            chalk.blue.bold('Top Web Sources:\n') + 
            chalk.gray(sourcesList),
            {
                padding: { top: 0, bottom: 0, left: 1, right: 1 },
                margin: { top: 1, bottom: 1 },
                borderStyle: 'single',
                borderColor: 'blue'
            }
        );
        console.log(sourcesBox);
    }
    
    // Success footer with enhancement indicator
    console.log(chalk.green('✅ Enhanced research completed with web context'));
}

/**
 * Process research result text to highlight code blocks
 */
function processCodeBlocks(text) {
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    
    return text.replace(codeBlockRegex, (match, language, code) => {
        try {
            const lang = language || 'javascript';
            const highlightedCode = highlight(code.trim(), {
                language: lang,
                ignoreIllegals: true
            });
            
            const codeBox = boxen(highlightedCode, {
                padding: { top: 0, bottom: 0, left: 1, right: 1 },
                margin: { top: 0, bottom: 0 },
                borderStyle: 'single',
                borderColor: 'dim'
            });
            
            return '\n' + codeBox + '\n';
        } catch (error) {
            return (
                '\n' +
                chalk.gray('```' + (language || '')) +
                '\n' +
                chalk.white(code.trim()) +
                '\n' +
                chalk.gray('```') +
                '\n'
            );
        }
    });
}

/**
 * Get optimal number of results based on detail level
 */
function getMaxResultsForDetailLevel(detailLevel) {
    switch (detailLevel) {
        case 'high': return 8;
        case 'medium': return 5;
        case 'low': return 3;
        default: return 5;
    }
}

/**
 * Get optimal search engines based on query content  
 */
function getOptimalEngines(query) {
    const queryLower = query.toLowerCase();
    
    // GitHub-specific queries
    if (queryLower.includes('github') || queryLower.includes('repository')) {
        return ['bing', 'duckduckgo'];
    }
    
    // Technical documentation queries
    if (queryLower.includes('documentation') || queryLower.includes('docs')) {
        return ['bing', 'duckduckgo', 'brave'];
    }
    
    // General queries - use multiple engines for diversity
    return ['bing', 'duckduckgo'];
}

export { performEnhancedResearch };
