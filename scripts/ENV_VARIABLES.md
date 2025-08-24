# Environment Variables for TaskMaster Development

This document describes the environment variables used to make TaskMaster development scripts portable and avoid hardcoded personal paths.

## Available Environment Variables

### `TASKMASTER_PROJECT_ROOT`
- **Purpose**: Root directory of the TaskMaster project
- **Default**: Current working directory (`$(pwd)`)
- **Used by**: 
  - `scripts/restart-mcp-server.sh`
  - `scripts/validate-restart.sh`

### `TEST_INTROPY_PROJECT_ROOT`
- **Purpose**: Root directory for intropy-ai-mcp test project  
- **Default**: `/tmp/test-intropy-ai-mcp`
- **Used by**:
  - `test-mcp-client.js`
  - `test-cursor-agent-final.js`
  - `test-cursor-agent-debug.js`

### `CURSOR_MCP_CONFIG_PATH`
- **Purpose**: Path to Cursor's MCP configuration file
- **Default**: `$HOME/.cursor/mcp.json`
- **Used by**:
  - `scripts/restart-mcp-server.sh`

## Setting Environment Variables

### Option 1: Using mise (Recommended)
The environment variables are already configured in `mise.toml`:
```bash
mise install  # Install tools and set environment
```

### Option 2: Manual Export
```bash
export TASKMASTER_PROJECT_ROOT="/path/to/your/taskmaster"
export TEST_INTROPY_PROJECT_ROOT="/path/to/your/test-project"
export CURSOR_MCP_CONFIG_PATH="/path/to/your/.cursor/mcp.json"
```

### Option 3: Per-command Override
```bash
TASKMASTER_PROJECT_ROOT="/custom/path" ./scripts/restart-mcp-server.sh
```

## Benefits

- ✅ **Portable**: Scripts work on any developer's machine
- ✅ **Secure**: No hardcoded personal paths in git history
- ✅ **Flexible**: Easy to override for different environments
- ✅ **Defaults**: Sensible fallbacks when variables aren't set
