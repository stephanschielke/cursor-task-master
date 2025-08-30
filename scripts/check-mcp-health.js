#!/usr/bin/env node

/**
 * Health check script for TaskMaster MCP Server
 * Returns 0 if healthy, 1 if unhealthy
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function checkMCPHealth() {
    try {
        console.log('🔍 Checking MCP server health...');

        // Check if MCP server process is running
        const { stdout } = await execAsync('ps aux | grep "mcp-server/server.js" | grep -v grep');

        if (!stdout.trim()) {
            console.log('❌ MCP server process not found');
            return false;
        }

        console.log('✅ MCP server process is running');

        // Additional health checks could go here:
        // - Test MCP protocol communication
        // - Check server responsiveness
        // - Verify tool registration

        return true;

    } catch (error) {
        console.log(`❌ Health check failed: ${error.message}`);
        return false;
    }
}

async function main() {
    const isHealthy = await checkMCPHealth();

    if (isHealthy) {
        console.log('🟢 MCP Server: HEALTHY');
        process.exit(0);
    } else {
        console.log('🔴 MCP Server: UNHEALTHY');
        process.exit(1);
    }
}

main();
