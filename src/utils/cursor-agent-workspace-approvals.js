/**
 * src/utils/cursor-agent-workspace-approvals.js
 *
 * Utility for managing cursor-agent workspace trust and MCP approvals.
 * This automatically creates the necessary approval files to prevent
 * cursor-agent CLI from hanging on approval prompts.
 *
 * Based on reverse engineering of cursor-agent behavior:
 * - ~/.cursor/projects/{workspace-hash}/.workspace-trusted
 * - ~/.cursor/projects/{workspace-hash}/mcp-approvals.json
 *
 * Patterns:
 * - Functional programming with pure functions where possible
 * - Resource management with automatic cleanup
 * - Comprehensive error handling with detailed diagnostics
 * - Immutable data structures for configuration
 */

import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { log } from '../../scripts/modules/utils.js';

/**
 * Main function to ensure cursor-agent workspace is trusted and MCPs are approved
 * @param {string} workspacePath - Absolute path to the workspace
 * @param {string} [mcpConfigPath] - Optional path to MCP config file (default: .cursor/mcp.json)
 * @returns {Promise<{success: boolean, workspaceDir?: string, error?: string}>}
 */
export async function ensureCursorAgentApprovals(
	workspacePath,
	mcpConfigPath = '.cursor/mcp.json'
) {
	try {
		// Normalize workspace path
		const normalizedWorkspacePath = path.resolve(workspacePath);

		log(
			'debug',
			`Setting up cursor-agent approvals for workspace: ${normalizedWorkspacePath}`
		);

		// Get the cursor-agent projects directory path for this workspace
		const workspaceProjectDir = getCursorAgentProjectDir(
			normalizedWorkspacePath
		);

		log('debug', `Cursor-agent project directory: ${workspaceProjectDir}`);

		// Create the directory if it doesn't exist
		if (!fs.existsSync(workspaceProjectDir)) {
			fs.mkdirSync(workspaceProjectDir, { recursive: true });
			log('debug', 'Created cursor-agent project directory');
		}

		// 1. Create/update .workspace-trusted file
		await createWorkspaceTrustedFile(
			workspaceProjectDir,
			normalizedWorkspacePath
		);

		// 2. Create/update mcp-approvals.json file
		const mcpConfigFullPath = path.join(normalizedWorkspacePath, mcpConfigPath);
		await createMCPApprovalsFile(
			workspaceProjectDir,
			mcpConfigFullPath,
			normalizedWorkspacePath
		);

		log(
			'info',
			`Cursor-agent approvals configured successfully for workspace: ${normalizedWorkspacePath}`
		);

		return {
			success: true,
			workspaceDir: workspaceProjectDir
		};
	} catch (error) {
		log('error', 'Failed to setup cursor-agent approvals:', error);
		return {
			success: false,
			error: error.message
		};
	}
}

/**
 * Get the cursor-agent project directory path for a given workspace
 * @param {string} workspacePath - Absolute path to the workspace
 * @returns {string} - Path to cursor-agent project directory
 */
export function getCursorAgentProjectDir(workspacePath) {
	// Convert workspace path to cursor-agent project directory format
	// Example: /home/stephan/Code/claude-task-master -> home-stephan-Code-claude-task-master
	const normalizedPath = path.resolve(workspacePath);
	const pathSegments = normalizedPath
		.split(path.sep)
		.filter((segment) => segment);
	const projectDirName = pathSegments.join('-');

	return path.join(os.homedir(), '.cursor', 'projects', projectDirName);
}

/**
 * Read and combine global + local MCP configs (mimics cursor-agent behavior)
 * @param {string} localMcpConfigPath - Path to local .cursor/mcp.json
 * @returns {Object} - Combined MCP configuration
 */
function readCombinedMCPConfigs(localMcpConfigPath) {
	const allMcpServers = {};

	// Read global MCP config (~/.cursor/mcp.json)
	try {
		const globalConfigPath = path.join(os.homedir(), '.cursor', 'mcp.json');
		if (fs.existsSync(globalConfigPath)) {
			const globalConfig = JSON.parse(
				fs.readFileSync(globalConfigPath, 'utf8')
			);
			if (globalConfig.mcpServers) {
				for (const [serverKey, serverConfig] of Object.entries(
					globalConfig.mcpServers
				)) {
					allMcpServers[serverKey] = serverConfig;
				}
				log(
					'debug',
					`Loaded ${Object.keys(globalConfig.mcpServers).length} global MCP servers`
				);
			}
		}
	} catch (error) {
		log(
			'debug',
			'No global MCP config found or failed to parse:',
			error.message
		);
	}

	// Read local MCP config (project/.cursor/mcp.json) - overrides global
	try {
		if (fs.existsSync(localMcpConfigPath)) {
			const localConfig = JSON.parse(
				fs.readFileSync(localMcpConfigPath, 'utf8')
			);
			if (localConfig.mcpServers) {
				for (const [serverKey, serverConfig] of Object.entries(
					localConfig.mcpServers
				)) {
					allMcpServers[serverKey] = serverConfig; // Local overrides global
				}
				log(
					'debug',
					`Loaded ${Object.keys(localConfig.mcpServers).length} local MCP servers`
				);
			}
		}
	} catch (error) {
		log(
			'debug',
			'No local MCP config found or failed to parse:',
			error.message
		);
	}

	const totalServers = Object.keys(allMcpServers).length;
	log(
		'debug',
		`Combined total: ${totalServers} MCP servers from global + local configs`
	);

	return { mcpServers: allMcpServers };
}

/**
 * Create or update the .workspace-trusted file
 * @param {string} workspaceProjectDir - cursor-agent project directory
 * @param {string} workspacePath - Absolute workspace path
 */
async function createWorkspaceTrustedFile(workspaceProjectDir, workspacePath) {
	const trustedFilePath = path.join(workspaceProjectDir, '.workspace-trusted');

	const trustedConfig = {
		trustedAt: new Date().toISOString(),
		workspacePath: workspacePath
	};

	fs.writeFileSync(trustedFilePath, JSON.stringify(trustedConfig, null, 2));
	log('debug', `Created .workspace-trusted file: ${trustedFilePath}`);
}

/**
 * Create or update the mcp-approvals.json file
 * @param {string} workspaceProjectDir - cursor-agent project directory
 * @param {string} mcpConfigPath - Path to MCP config file
 * @param {string} workspacePath - Absolute workspace path
 */
async function createMCPApprovalsFile(
	workspaceProjectDir,
	mcpConfigPath,
	workspacePath
) {
	const approvalsFilePath = path.join(
		workspaceProjectDir,
		'mcp-approvals.json'
	);

	// Read existing approvals if they exist
	let existingApprovals = [];
	if (fs.existsSync(approvalsFilePath)) {
		try {
			const content = fs.readFileSync(approvalsFilePath, 'utf8');
			existingApprovals = JSON.parse(content);
			if (!Array.isArray(existingApprovals)) {
				existingApprovals = [];
			}
		} catch (error) {
			log(
				'debug',
				'Failed to read existing mcp-approvals.json, starting fresh:',
				error.message
			);
			existingApprovals = [];
		}
	}

	// Read and combine global + local MCP configs (like cursor-agent does)
	const combinedConfig = readCombinedMCPConfigs(mcpConfigPath);
	const mcpServers = combinedConfig.mcpServers || {};

	if (Object.keys(mcpServers).length === 0) {
		log(
			'debug',
			'No MCP servers found in combined global + local configs, creating empty approvals file'
		);
		fs.writeFileSync(
			approvalsFilePath,
			JSON.stringify(existingApprovals, null, 2)
		);
		return;
	}

	// Generate approval IDs for each MCP server
	const newApprovals = [];
	for (const [serverKey, serverConfig] of Object.entries(mcpServers)) {
		const approvalId = generateMCPApprovalId(
			serverKey,
			serverConfig,
			workspacePath
		);
		newApprovals.push(approvalId);
	}

	// Merge with existing approvals (deduplicate)
	const allApprovals = [...new Set([...existingApprovals, ...newApprovals])];

	// Write updated approvals
	fs.writeFileSync(approvalsFilePath, JSON.stringify(allApprovals, null, 2));

	log(
		'debug',
		`Updated mcp-approvals.json with ${newApprovals.length} approval${newApprovals.length === 1 ? '' : 's'}`
	);
	log('debug', `Approval IDs: ${newApprovals.join(', ')}`);

	if (newApprovals.length > 0) {
		log(
			'debug',
			`Server breakdown: ${newApprovals.map((id) => id.split('-')[0]).join(', ')}`
		);
	}
}

/**
 * Generate MCP approval ID using cursor-agent's EXACT schema
 * Based on reverse-engineered cursor-agent source code
 * @param {string} mcpConfigKey - Server key from mcp.json
 * @param {Object} mcpConfigValue - Server configuration object
 * @param {string} currentDir - Current working directory (workspace path)
 * @returns {string} - Single, correct approval ID
 */
/**
 * Generate MCP approval ID using functional programming approach
 * @param {string} mcpConfigKey - Server key from mcp.json
 * @param {Object} mcpConfigValue - Server configuration object
 * @param {string} currentDir - Current working directory (workspace path)
 * @returns {string} - Single, correct approval ID
 * @throws {Error} If inputs are invalid
 */
export function generateMCPApprovalId(mcpConfigKey, mcpConfigValue, currentDir) {
	// Input validation with clear error messages
	if (!mcpConfigKey || typeof mcpConfigKey !== 'string') {
		throw new Error('Invalid MCP config key: must be a non-empty string');
	}
	if (!mcpConfigValue || typeof mcpConfigValue !== 'object') {
		throw new Error('Invalid MCP config value: must be an object');
	}
	if (!currentDir || typeof currentDir !== 'string') {
		throw new Error('Invalid current directory: must be a non-empty string');
	}

	// Functional composition: validate -> normalize -> create hash data -> generate hash -> format ID
	const normalizedServer = normalizeServerConfigForApprovals(mcpConfigValue);
	const hashData = createHashDataForApprovals(currentDir, normalizedServer);
	const hash = generateApprovalHash(hashData);
	return formatApprovalId(mcpConfigKey, hash);
}

/**
 * Normalize server configuration for cursor-agent approvals (pure function)
 * Only includes properties that cursor-agent actually uses for hashing
 * @param {Object} config - Raw MCP server configuration
 * @returns {Object} Normalized configuration for hashing
 */
function normalizeServerConfigForApprovals(config) {
	const normalized = {};

	// Handle command-based servers (docker, node, etc.)
	if (config.command !== undefined) {
		normalized.command = config.command;
		if (config.args !== undefined) {
			normalized.args = config.args;
		}
		// Include env ONLY when it exists (even if empty object)
		if (config.env !== undefined) {
			normalized.env = config.env;
		}
	}
	// Handle URL-based servers (SSE endpoints, HTTP servers)
	else if (config.url !== undefined) {
		normalized.url = config.url;
		// Include headers ONLY when they exist
		if (config.headers !== undefined) {
			normalized.headers = config.headers;
		}
	}
	// All other properties are ignored by cursor-agent:
	// autoApprove, disabled, timeout, transportType, etc.

	return normalized;
}

/**
 * Create hash data structure for cursor-agent approvals (pure function)
 * @param {string} currentDir - Current working directory
 * @param {Object} normalizedServer - Normalized server config
 * @returns {Object} Hash data structure
 */
function createHashDataForApprovals(currentDir, normalizedServer) {
	return {
		path: currentDir,
		server: normalizedServer
	};
}

/**
 * Generate SHA256 hash for approval ID (pure function)
 * @param {Object} hashData - Data to hash
 * @returns {string} 16-character hash
 */
function generateApprovalHash(hashData) {
	return createHash('sha256')
		.update(JSON.stringify(hashData))
		.digest('hex')
		.substring(0, 16);
}

/**
 * Format final approval ID (pure function)
 * @param {string} key - MCP server key
 * @param {string} hash - Generated hash
 * @returns {string} Formatted approval ID
 */
function formatApprovalId(key, hash) {
	return `${key}-${hash}`;
}

/**
 * Clean up cursor-agent approval files (useful for testing)
 * @param {string} workspacePath - Absolute path to the workspace
 * @returns {boolean} - Success status
 */
export function cleanupCursorAgentApprovals(workspacePath) {
	try {
		const workspaceProjectDir = getCursorAgentProjectDir(workspacePath);

		const trustedFile = path.join(workspaceProjectDir, '.workspace-trusted');
		const approvalsFile = path.join(workspaceProjectDir, 'mcp-approvals.json');

		let cleaned = false;

		if (fs.existsSync(trustedFile)) {
			fs.unlinkSync(trustedFile);
			cleaned = true;
			log('debug', `Removed .workspace-trusted file: ${trustedFile}`);
		}

		if (fs.existsSync(approvalsFile)) {
			fs.unlinkSync(approvalsFile);
			cleaned = true;
			log('debug', `Removed mcp-approvals.json file: ${approvalsFile}`);
		}

		// Try to remove directory if empty
		if (fs.existsSync(workspaceProjectDir)) {
			const files = fs.readdirSync(workspaceProjectDir);
			if (files.length === 0) {
				fs.rmdirSync(workspaceProjectDir);
				log('debug', `Removed empty project directory: ${workspaceProjectDir}`);
			}
		}

		return cleaned;
	} catch (error) {
		log('error', 'Failed to cleanup cursor-agent approvals:', error);
		return false;
	}
}

/**
 * Check current approval status for a workspace
 * @param {string} workspacePath - Absolute path to the workspace
 * @returns {Object} - Status information
 */
export function checkCursorAgentApprovalStatus(workspacePath) {
	try {
		const workspaceProjectDir = getCursorAgentProjectDir(workspacePath);

		const trustedFile = path.join(workspaceProjectDir, '.workspace-trusted');
		const approvalsFile = path.join(workspaceProjectDir, 'mcp-approvals.json');

		const status = {
			workspaceProjectDir,
			workspaceTrusted: fs.existsSync(trustedFile),
			mcpApprovalsExist: fs.existsSync(approvalsFile),
			trustedConfig: null,
			approvals: []
		};

		// Read trusted config if exists
		if (status.workspaceTrusted) {
			try {
				const content = fs.readFileSync(trustedFile, 'utf8');
				status.trustedConfig = JSON.parse(content);
			} catch (error) {
				log('debug', 'Failed to read .workspace-trusted:', error.message);
			}
		}

		// Read approvals if exist
		if (status.mcpApprovalsExist) {
			try {
				const content = fs.readFileSync(approvalsFile, 'utf8');
				status.approvals = JSON.parse(content);
			} catch (error) {
				log('debug', 'Failed to read mcp-approvals.json:', error.message);
			}
		}

		return status;
	} catch (error) {
		log('error', 'Failed to check cursor-agent approval status:', error);
		return {
			error: error.message
		};
	}
}
