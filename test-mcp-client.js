#!/usr/bin/env node

/**
 * Test MCP Client for testing TaskMaster MCP tools
 * Especially useful for testing cursor-agent provider fixes
 */

import { spawn } from 'child_process';
import { createInterface } from 'readline';

class TestMCPClient {
	constructor() {
		this.serverProcess = null;
		this.messageId = 0;
		this.pendingRequests = new Map();
		this.connected = false;
	}

	async connect() {
		console.log('🔌 Connecting to TaskMaster MCP Server...');

		this.serverProcess = spawn('node', ['./mcp-server/server.js'], {
			stdio: ['pipe', 'pipe', 'pipe'],
			cwd: process.cwd()
		});

		this.serverProcess.stdout.on('data', (data) => {
			const lines = data
				.toString()
				.split('\n')
				.filter((line) => line.trim());

			for (const line of lines) {
				try {
					const message = JSON.parse(line);
					this.handleMessage(message);
				} catch (error) {
					console.log('📄 Server log:', line);
				}
			}
		});

		this.serverProcess.stderr.on('data', (data) => {
			console.log('🚨 Server error:', data.toString());
		});

		// Initialize connection
		await this.sendRequest('initialize', {
			protocolVersion: '2024-11-05',
			capabilities: {
				sampling: {}
			},
			clientInfo: {
				name: 'test-mcp-client',
				version: '1.0.0'
			}
		});

		this.connected = true;
		console.log('✅ Connected to MCP server');
	}

	handleMessage(message) {
		if (message.id && this.pendingRequests.has(message.id)) {
			const { resolve, reject } = this.pendingRequests.get(message.id);
			this.pendingRequests.delete(message.id);

			if (message.error) {
				reject(new Error(`MCP Error: ${message.error.message}`));
			} else {
				resolve(message.result);
			}
		} else if (message.method === 'notifications/message') {
			console.log(`📢 ${message.params.level}: ${message.params.data.message}`);
		}
	}

	async sendRequest(method, params = {}) {
		return new Promise((resolve, reject) => {
			const id = ++this.messageId;
			const request = {
				jsonrpc: '2.0',
				id,
				method,
				params
			};

			this.pendingRequests.set(id, { resolve, reject });

			const requestStr = JSON.stringify(request) + '\n';
			this.serverProcess.stdin.write(requestStr);

			// Timeout after 15 minutes (for long operations like PRD parsing)
			setTimeout(() => {
				if (this.pendingRequests.has(id)) {
					this.pendingRequests.delete(id);
					reject(new Error('Request timeout'));
				}
			}, 900000);
		});
	}

	async callTool(name, arguments_) {
		console.log(`🔧 Calling tool: ${name}`);
		console.log(`📋 Arguments:`, JSON.stringify(arguments_, null, 2));

		try {
			const result = await this.sendRequest('tools/call', {
				name,
				arguments: arguments_
			});

			console.log(`✅ Tool ${name} completed successfully`);
			return result;
		} catch (error) {
			console.log(`❌ Tool ${name} failed:`, error.message);
			throw error;
		}
	}

	async listTools() {
		const result = await this.sendRequest('tools/list');
		return result.tools;
	}

	async testParsePRD(projectRoot, inputFile, numTasks = 5) {
		console.log('\n🎯 TESTING: parse_prd with cursor-agent provider');
		console.log('='.repeat(60));

		try {
			const result = await this.callTool('parse_prd', {
				projectRoot,
				input: inputFile,
				numTasks: numTasks.toString(),
				research: true,
				force: true
			});

			console.log('📊 Parse PRD Result:');
			if (result.content) {
				result.content.forEach((item) => {
					if (item.type === 'text') {
						console.log(item.text);
					}
				});
			}

			return result;
		} catch (error) {
			console.log('💥 Parse PRD failed:', error.message);
			return null;
		}
	}

	async testGetTasks(projectRoot) {
		console.log('\n📋 TESTING: get_tasks');
		console.log('='.repeat(40));

		try {
			const result = await this.callTool('get_tasks', {
				projectRoot
			});

			console.log('📊 Get Tasks Result:');
			if (result.content) {
				result.content.forEach((item) => {
					if (item.type === 'text') {
						console.log(item.text);
					}
				});
			}

			return result;
		} catch (error) {
			console.log('💥 Get Tasks failed:', error.message);
			return null;
		}
	}

	async close() {
		if (this.serverProcess) {
			this.serverProcess.kill();
			console.log('🔌 Disconnected from MCP server');
		}
	}
}

// Main test execution
async function main() {
	const client = new TestMCPClient();

	try {
		await client.connect();

		// List available tools
		console.log('\n🔧 Available tools:');
		const tools = await client.listTools();
		tools.forEach((tool) => {
			console.log(`  - ${tool.name}: ${tool.description}`);
		});

		// Test with the provided parameters - use env var with fallback
		const projectRoot =
			process.env.TEST_INTROPY_PROJECT_ROOT || '/tmp/test-intropy-ai-mcp';
		const inputFile = '.taskmaster/docs/intropy-ai-mcp-prd.txt';

		// Test parse PRD (the main fix)
		await client.testParsePRD(projectRoot, inputFile, 8);

		// Test get tasks (to see if parsing worked)
		await client.testGetTasks(projectRoot);
	} catch (error) {
		console.error('💥 Test failed:', error);
	} finally {
		await client.close();
		process.exit(0);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch(console.error);
}

export { TestMCPClient };
