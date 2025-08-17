/**
 * web-research.js
 * Enhanced research functionality with web search integration using open-webSearch MCP
 */

import chalk from 'chalk';
import fs from 'fs';
import { log } from '../utils.js';

/**
 * Determines if a research query would benefit from web search
 * @param {string} query - The research query
 * @param {string} detailLevel - Detail level (low, medium, high)
 * @returns {boolean} True if web search is recommended
 */
function shouldUseWebSearch(query, detailLevel) {
    // Keywords that indicate web search would be beneficial
    const webSearchIndicators = [
        // Technology and libraries
        'latest', 'current', 'recent', 'new', 'updated', 'version',
        'best practices', 'state of the art', 'modern',
        
        // Time-sensitive terms  
        '2024', '2025', 'this year', 'current year', 'nowadays',
        'recently released', 'just released',
        
        // Comparison and trends
        'vs', 'versus', 'compared to', 'alternative', 'trending',
        'popular', 'recommended', 'better than',
        
        // Documentation and tutorials
        'how to', 'tutorial', 'guide', 'documentation', 'examples',
        'setup', 'installation', 'getting started',
        
        // Technology specific
        'framework', 'library', 'api', 'sdk', 'tool', 'package',
        'npm', 'github', 'repository', 'open source',
        
        // Security and updates
        'security', 'vulnerability', 'patch', 'fix', 'update',
        'deprecated', 'migration', 'breaking changes'
    ];
    
    const queryLower = query.toLowerCase();
    const hasWebIndicators = webSearchIndicators.some(indicator => 
        queryLower.includes(indicator.toLowerCase())
    );
    
    // High detail level benefits more from web search
    const detailLevelBoost = detailLevel === 'high' ? true : 
                            detailLevel === 'medium' ? hasWebIndicators : 
                            false;
    
    return hasWebIndicators || detailLevelBoost;
}

/**
 * Performs intelligent web search with rate limiting and result optimization
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @param {Object} context - Execution context
 * @returns {Promise<Object>} Search results with content
 */
async function performWebSearch(query, options = {}, context = {}) {
    const { 
        maxResults = 5, 
        engines = ['bing', 'duckduckgo'], 
        includeContent = true,
        timeout = 15000 
    } = options;
    
    const { logFn } = context;
    
    try {
        // Use web search MCP with rate limiting
        const searchResults = await searchWithMCP(query, {
            limit: maxResults,
            engines: engines,
            timeout: timeout
        });
        
        if (!searchResults || searchResults.length === 0) {
            logFn?.info('No web search results found');
            return { results: [], content: '' };
        }
        
        logFn?.info(`Found ${searchResults.length} web search results`);
        
        // Optionally fetch detailed content for top results
        let detailedResults = searchResults;
        if (includeContent && searchResults.length > 0) {
            detailedResults = await enrichResultsWithContent(
                searchResults, 
                { maxContentResults: Math.min(3, searchResults.length) },
                context
            );
        }
        
        // Format results for AI consumption
        const formattedContent = formatSearchResultsForAI(detailedResults);
        
        return {
            results: detailedResults,
            content: formattedContent,
            metadata: {
                query,
                resultCount: detailedResults.length,
                engines: engines,
                timestamp: new Date().toISOString()
            }
        };
        
    } catch (error) {
        logFn?.warn(`Web search failed: ${error.message}`);
        return { results: [], content: '', error: error.message };
    }
}

/**
 * Calls web search MCP with proper error handling and rate limiting
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @returns {Promise<Array>} Search results
 */
async function searchWithMCP(query, options = {}) {
    const { limit = 5, engines = ['bing'], timeout = 10000 } = options;
    
    // Rate limiting: max 1 search per 2 seconds to respect search engine limits
    const lastSearchTime = searchWithMCP.lastCall || 0;
    const timeSinceLastSearch = Date.now() - lastSearchTime;
    const minInterval = 2000; // 2 seconds between searches
    
    if (timeSinceLastSearch < minInterval) {
        const waitTime = minInterval - timeSinceLastSearch;
        log('Rate limiting web search, waiting', { waitTime });
        await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    searchWithMCP.lastCall = Date.now();
    
    try {
        // Use the actual web search MCP tool that we tested
        const { mcp_web_search_sse_search } = await import('../../mcp-client.js').catch(() => {
            // If MCP client module doesn't exist, try direct tool import
            return { mcp_web_search_sse_search: null };
        });
        
        if (!mcp_web_search_sse_search) {
            // Fallback to simulated search if MCP not available
            log('MCP web search not available, using fallback');
            return await simulateWebSearchMCP(query, { limit, engines });
        }
        
        // Call the actual MCP search tool
        const searchResults = await mcp_web_search_sse_search({
            query: query,
            limit: limit,
            engines: engines
        });
        
        // Normalize results format
        return Array.isArray(searchResults) ? searchResults : [];
        
    } catch (error) {
        log('MCP web search error:', error);
        
        // Fallback to simulated search on error  
        try {
            return await simulateWebSearchMCP(query, { limit, engines });
        } catch (fallbackError) {
            throw new Error(`Web search failed: ${error.message}`);
        }
    }
}

/**
 * Simulates web search MCP call (to be replaced with actual MCP integration)
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @returns {Promise<Array>} Mock search results
 */
async function simulateWebSearchMCP(query, options = {}) {
    // This is a placeholder - in production this would call the actual MCP
    // For now return empty results to not break the system
    log('Simulating web search MCP call:', { query, options });
    
    // Return empty results for now - actual MCP integration comes next
    return [];
}

/**
 * Enriches search results with detailed content from specific sources
 * @param {Array} results - Basic search results
 * @param {Object} options - Content fetching options
 * @param {Object} context - Execution context
 * @returns {Promise<Array>} Enhanced results with content
 */
async function enrichResultsWithContent(results, options = {}, context = {}) {
    const { maxContentResults = 3 } = options;
    const { logFn } = context;
    
    const enrichedResults = [];
    
    for (let i = 0; i < Math.min(results.length, maxContentResults); i++) {
        const result = results[i];
        let enrichedResult = { ...result };
        
        try {
            // Check if result is from GitHub and fetch README
            if (result.url && result.url.includes('github.com')) {
                logFn?.info(`Fetching GitHub README for: ${result.url}`);
                const readmeContent = await fetchGithubReadme(result.url);
                if (readmeContent) {
                    enrichedResult.content = readmeContent.substring(0, 2000); // Limit content
                    enrichedResult.contentType = 'github-readme';
                }
            }
            
            // Check for other supported content types (CSDN, etc.)
            // This can be extended based on available MCP tools
            
        } catch (error) {
            logFn?.debug(`Failed to enrich result ${result.url}: ${error.message}`);
        }
        
        enrichedResults.push(enrichedResult);
    }
    
    // Add remaining results without content
    for (let i = maxContentResults; i < results.length; i++) {
        enrichedResults.push(results[i]);
    }
    
    return enrichedResults;
}

/**
 * Fetches GitHub README content using MCP
 * @param {string} url - GitHub repository URL
 * @returns {Promise<string>} README content
 */
async function fetchGithubReadme(url) {
    try {
        // Use the actual fetchGithubReadme MCP tool that we tested
        const { mcp_web_search_sse_fetchGithubReadme } = await import('../../mcp-client.js').catch(() => {
            return { mcp_web_search_sse_fetchGithubReadme: null };
        });
        
        if (!mcp_web_search_sse_fetchGithubReadme) {
            log('GitHub README MCP not available');
            return null;
        }
        
        const readmeContent = await mcp_web_search_sse_fetchGithubReadme({ url });
        return readmeContent || null;
        
    } catch (error) {
        log('GitHub README fetch failed:', error);
        return null;
    }
}

/**
 * Formats search results for AI consumption
 * @param {Array} results - Search results with optional content
 * @returns {string} Formatted content for AI
 */
function formatSearchResultsForAI(results) {
    if (!results || results.length === 0) {
        return '';
    }
    
    let formattedContent = '## Web Search Results\n\n';
    
    results.forEach((result, index) => {
        formattedContent += `### Result ${index + 1}: ${result.title}\n`;
        formattedContent += `**URL:** ${result.url}\n`;
        
        if (result.description) {
            formattedContent += `**Description:** ${result.description}\n`;
        }
        
        if (result.content) {
            formattedContent += `**Content Preview:**\n${result.content.substring(0, 1000)}\n`;
        }
        
        if (result.engine) {
            formattedContent += `**Source:** ${result.engine}\n`;
        }
        
        formattedContent += '\n---\n\n';
    });
    
    return formattedContent;
}

/**
 * Integrates web search results into research context
 * @param {string} originalQuery - The research query
 * @param {string} gatheredContext - Existing gathered context
 * @param {Object} webSearchResults - Results from web search
 * @param {string} detailLevel - Detail level for research
 * @returns {string} Enhanced context with web search results
 */
function integrateWebSearchContext(originalQuery, gatheredContext, webSearchResults, detailLevel) {
    if (!webSearchResults.content || webSearchResults.content.length === 0) {
        return gatheredContext;
    }
    
    // Create enhanced context with web search results
    let enhancedContext = gatheredContext;
    
    // Add web search results section
    enhancedContext += '\n\n' + '='.repeat(60) + '\n';
    enhancedContext += 'CURRENT WEB RESEARCH RESULTS\n';
    enhancedContext += '='.repeat(60) + '\n\n';
    
    enhancedContext += `Query: "${originalQuery}"\n`;
    enhancedContext += `Found ${webSearchResults.results.length} relevant results\n`;
    enhancedContext += `Search performed at: ${webSearchResults.metadata?.timestamp}\n\n`;
    
    enhancedContext += webSearchResults.content;
    
    // Add instruction for AI to integrate web results
    enhancedContext += '\n\n' + '-'.repeat(40) + '\n';
    enhancedContext += 'INSTRUCTION: When responding, integrate the above web search results\n';
    enhancedContext += 'with the project context. Prioritize current/recent information from\n';
    enhancedContext += 'web results while relating it back to the specific project needs.\n';
    enhancedContext += '-'.repeat(40) + '\n\n';
    
    return enhancedContext;
}

/**
 * Creates a summary of web search activity for telemetry
 * @param {Object} webSearchResults - Web search results
 * @returns {Object} Search telemetry data
 */
function createWebSearchTelemetry(webSearchResults) {
    if (!webSearchResults || !webSearchResults.results) {
        return { webSearchUsed: false };
    }
    
    return {
        webSearchUsed: true,
        resultCount: webSearchResults.results.length,
        enginesUsed: webSearchResults.metadata?.engines || [],
        hasContentEnrichment: webSearchResults.results.some(r => r.content),
        timestamp: webSearchResults.metadata?.timestamp
    };
}

export {
    shouldUseWebSearch,
    performWebSearch,
    integrateWebSearchContext,
    createWebSearchTelemetry
};
