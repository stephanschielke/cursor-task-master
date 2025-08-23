# TaskMaster MCP Server Operations Guide

## Quick Start

### ✅ Verify Restart Readiness
```bash
cd /path/to/taskmaster
./scripts/validate-restart.sh
```

### 🔄 Restart MCP Server
```bash
./scripts/restart-mcp-server.sh restart
```

### 📊 Check Status
```bash
./scripts/restart-mcp-server.sh status
```

## When MCP Server Restart is Required

### ⚠️ **RESTART REQUIRED** - Provider Changes
- **New Provider Addition**: Adding cursor-agent provider requires restart to load into registry
- **Provider Code Changes**: Modifications to existing provider classes (e.g., `CursorAgentProvider`)
- **MCP Tool Definitions**: Changes to tool schemas or function signatures
- **Core Module Changes**: Updates to `ai-services-unified.js` or `config-manager.js`

```bash
# After adding cursor-agent provider
git checkout cursor-agent-provider
./scripts/restart-mcp-server.sh restart

# After modifying provider logic
# Edit: src/ai-providers/cursor-agent.js
./scripts/restart-mcp-server.sh restart

# After changing provider registration  
# Edit: scripts/modules/ai-services-unified.js
./scripts/restart-mcp-server.sh restart
```

### 🟡 **NO RESTART NEEDED** - Configuration Changes
- **Configuration Updates**: `.taskmaster/config.json` changes (loaded dynamically)
- **Environment Variables**: Most env vars loaded per-request via `dotenv.config()`
- **Task Data**: `tasks.json` changes (loaded per-operation)

```bash
# TaskMaster config changes (loaded dynamically)
# Edit: .taskmaster/config.json
# No restart needed - changes picked up on next request

# Environment variables (loaded per-request)
# Edit: .env file
# No restart needed - loaded via dotenv.config()

# Task data changes (read from filesystem)
# Edit: .taskmaster/tasks/tasks.json  
# No restart needed - read fresh each operation
```

## Server Architecture

### Implementation Details
- **Entry Point**: `mcp-server/server.js` 
- **Main Class**: `TaskMasterMCPServer` in `mcp-server/src/index.js`
- **Framework**: [FastMCP v3.8.4](https://github.com/punkpeye/fastmcp)
- **Transport**: stdio with 2-minute timeout

### Graceful Shutdown
The server implements proper signal handling:
```javascript
// Handle graceful shutdown
process.on('SIGINT', async () => {
  await server.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await server.stop();
  process.exit(0);
});
```

## Restart Script Commands

### Available Commands
```bash
./scripts/restart-mcp-server.sh start      # Start server
./scripts/restart-mcp-server.sh stop       # Stop server gracefully  
./scripts/restart-mcp-server.sh restart    # Stop and start (recommended)
./scripts/restart-mcp-server.sh status     # Show current status
./scripts/restart-mcp-server.sh test       # Test provider loading
```

### Safety Features
- **Graceful shutdown** with SIGTERM (30-second timeout)
- **Force kill fallback** if graceful shutdown fails
- **Process verification** before and after operations
- **Provider loading test** to verify functionality
- **Comprehensive logging** to `/tmp/taskmaster-mcp-restart.log`
- **PID file management** to track server process

## Step-by-Step Operations

### Pre-Restart Verification
```bash
# Check current status
./scripts/restart-mcp-server.sh status

# Validate restart readiness  
./scripts/validate-restart.sh

# Expected output:
# ✅ Restart script is ready to use
# ✅ All core dependencies available  
# ✅ Provider loading works correctly
# ✅ Logging system functional
```

### Perform Restart
```bash
# Execute restart
./scripts/restart-mcp-server.sh restart

# Monitor logs in real-time (optional)
tail -f /tmp/taskmaster-mcp-restart.log
```

### Post-Restart Verification
```bash
# Verify new server is running
./scripts/restart-mcp-server.sh status

# Test provider functionality
./scripts/restart-mcp-server.sh test

# Restart Cursor IDE to reconnect to MCP server
# (This step is currently manual)
```

## Expected Output Examples

### Successful Restart
```
2025-08-17 09:15:00 [INFO] ========================================
2025-08-17 09:15:00 [INFO] TaskMaster MCP Server Restart Started
2025-08-17 09:15:00 [INFO] ========================================
2025-08-17 09:15:00 [INFO] Stopping TaskMaster MCP Server...
2025-08-17 09:15:00 [INFO] Found MCP server with PID: 2796798
2025-08-17 09:15:00 [INFO] Sending SIGTERM to PID 2796798
2025-08-17 09:15:02 [SUCCESS] Server stopped gracefully
2025-08-17 09:15:04 [INFO] Starting TaskMaster MCP Server...
2025-08-17 09:15:04 [INFO] Server started with PID: 2801234
2025-08-17 09:15:07 [SUCCESS] Server started successfully and is running
2025-08-17 09:15:07 [INFO] Testing provider availability...
2025-08-17 09:15:07 [INFO]   ✅ CursorAgentProvider loaded successfully
2025-08-17 09:15:07 [SUCCESS] Provider loading test passed
2025-08-17 09:15:07 [SUCCESS] ========================================
2025-08-17 09:15:07 [SUCCESS] TaskMaster MCP Server Restart Complete
2025-08-17 09:15:07 [SUCCESS] ========================================
```

### Status Check
```
2025-08-17 09:09:23 [INFO] TaskMaster MCP Server Status: RUNNING (PID: 2796798)
2025-08-17 09:09:23 [INFO]   2796798  964555 node <path-to-project>/mcp-server/server.js    46:00
```

### Provider Test
```  
2025-08-17 09:09:29 [INFO] Testing provider availability...
2025-08-17 09:09:29 [INFO]   ✅ CursorAgentProvider loaded successfully
2025-08-17 09:09:29 [INFO]   Provider name: Cursor Agent
2025-08-17 09:09:29 [SUCCESS] Provider loading test passed
```

## Environment Configuration

### Dynamic Loading
```javascript
import dotenv from 'dotenv';
dotenv.config(); // Loads .env file automatically
```

### Supported Variables
- **API Keys**: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `PERPLEXITY_API_KEY`
- **Endpoints**: `OLLAMA_BASE_URL`, `AZURE_OPENAI_ENDPOINT`
- **Provider Control**: Any env var loaded via `dotenv.config()`

## Troubleshooting

### Common Issues

#### Permission Denied
```bash
# Fix script permissions
chmod +x scripts/restart-mcp-server.sh
chmod +x scripts/validate-restart.sh
```

#### MCP Server Not Found
```bash
# Verify server path exists
ls -la <path-to-project>/mcp-server/server.js
```

#### Provider Loading Fails
```bash
# Test provider manually
cd <path-to-project>
node -e "
const { CursorAgentProvider } = require('./src/ai-providers/cursor-agent.js');
console.log('Provider loaded:', new CursorAgentProvider().name);
"
```

#### Cursor Connection Issues
```bash
# Check MCP configuration
cat ~/.cursor/mcp.json | grep -A 10 "task-master-ai"

# Restart Cursor after MCP restart
# (Manual step - close and reopen Cursor IDE)
```

### Log Files
- **Restart operations**: `/tmp/taskmaster-mcp-restart.log`
- **Server stdout**: `/tmp/taskmaster-mcp-stdout.log`  
- **Server stderr**: `/tmp/taskmaster-mcp-stderr.log`

## cursor-agent Provider Integration

The restart system supports cursor-agent provider specifically by:

1. **Validating tmux availability** (required for cursor-agent execution)
2. **Testing cursor-agent CLI** availability in PATH
3. **Verifying CursorAgentProvider** can be loaded successfully
4. **Ensuring provider registry** includes cursor-agent
5. **Confirming configuration** supports cursor-agent as main provider

After restart, the MCP server will have the updated provider registry and can use cursor-agent for TaskMaster operations.

## Advanced Management Strategies

### Manual Process Management
```bash
# Find running MCP server
pgrep -f "mcp-server/server.js"

# Send SIGTERM for graceful shutdown
kill -TERM <PID>

# Force kill if needed
kill -KILL <PID>
```

### Process Manager Integration (Optional)

#### Using PM2
```bash
# Install PM2 globally
npm install -g pm2

# Start with PM2
pm2 start mcp-server/server.js --name taskmaster-mcp

# Restart
pm2 restart taskmaster-mcp
```

#### Using systemd (Linux)
```ini
# /etc/systemd/system/taskmaster-mcp.service
[Unit]
Description=TaskMaster MCP Server
After=network.target

[Service]
Type=simple
User=stephan
WorkingDirectory=<path-to-project>
ExecStart=/usr/bin/node mcp-server/server.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

---

*This guide provides comprehensive operations management for the TaskMaster MCP Server, with specific support for cursor-agent provider integration.*
