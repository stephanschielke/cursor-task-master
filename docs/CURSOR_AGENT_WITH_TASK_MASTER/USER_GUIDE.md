# Cursor Agent Integration User Guide

## Overview

This guide explains how to configure and use cursor-agent CLI integration with TaskMaster AI, providing cost-effective AI operations using your existing Cursor subscription.

## Key Benefits

- **Eliminate API costs** for TaskMaster operations
- **Full workspace context** for AI operations
- **Consistent model experience** across Cursor and TaskMaster
- **No additional authentication** required

## Prerequisites

### Required Software
- [Cursor IDE](https://cursor.com/) with active subscription
- [cursor-agent CLI](https://docs.cursor.com/en/cli/) installed and authenticated
- [tmux](https://github.com/tmux/tmux) terminal multiplexer
- TaskMaster AI with MCP server configured

### Verification Commands
```bash
# Verify cursor-agent is installed and authenticated
cursor-agent status

# Verify tmux is available
tmux -V

# Check current TaskMaster configuration
cat .taskmaster/config.json
```

## Configuration

### Authentication Setup

**Recommended: Browser Authentication**
```bash
cursor-agent login          # Opens browser for auth
cursor-agent status         # Check auth status
cursor-agent logout         # Clear credentials (if needed)
```

**Alternative: API Key Authentication**
```bash
export CURSOR_API_KEY=your_api_key_here
cursor-agent --api-key your_api_key_here "prompt"
```

### TaskMaster Configuration

Update `.taskmaster/config.json` to use cursor-agent as primary provider:
```json
{
  "models": {
    "main": {
      "provider": "cursor-agent",
      "modelId": "sonnet",
      "maxTokens": 16384,
      "temperature": 0.2
    },
    "research": {
      "provider": "perplexity",
      "modelId": "sonar-pro"
    },
    "fallback": {
      "provider": "openai",
      "modelId": "gpt-4"
    }
  }
}
```

### MCP Server Configuration

Ensure your `.cursor/mcp.json` includes the TaskMaster MCP server:
```json
{
  "mcpServers": {
    "task-master-ai": {
      "command": "node",
      "args": ["<path-to-project>/mcp-server/server.js"],
      "env": {
        "PERPLEXITY_API_KEY": "your-key-here",
        "OPENAI_API_KEY": "your-fallback-key"
      }
    }
  }
}
```

## Usage

### Session Management (Important for Advanced Users)

**Session Lifecycle:**
- Every cursor-agent execution creates a unique `session_id`
- Sessions can be **paused** with `Ctrl+D` (not terminated)
- Sessions can be **resumed** using `--resume [chatId]`
- `cursor-agent ls` lists previous conversation history

**Session ID Extraction:**
```bash
# When soft-stopping with Ctrl+D:
To resume this session: cursor-agent --resume=2f98f950-3b88-430d-b0eb-6a25660a0d98

# Session ID is also in JSON output:
{
  "session_id": "2f98f950-3b88-430d-b0eb-6a25660a0d98"
}
```

### Available Models

**Working Models:**
- `sonnet` (Claude Sonnet - recommended)
- `gpt-5`, `gpt-4o` (OpenAI models)
- `opus` (Claude Opus)

**Model-Specific Commands:**
```bash
cursor-agent sonnet "prompt"    # Direct sonnet model
cursor-agent opus "prompt"      # Direct opus model
cursor-agent gpt5 "prompt"      # Direct GPT-5 model
```

### Output Formats

**Critical Parameters for TaskMaster:**
```bash
cursor-agent --print --output-format json --model sonnet
```

**Available Output Formats:**
- `text` - Human-readable progress tracking
- `json` - Single JSON object on completion
- `stream-json` - Real-time JSON events (default)

**JSON Success Response Structure:**
```json
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "duration_ms": 1234,
  "duration_api_ms": 1234,
  "result": "<full assistant response text>",
  "session_id": "<uuid>",
  "request_id": "<optional request id>"
}
```

### Permission System

Configure permissions in `~/.cursor/cli-config.json` or `<project>/.cursor/cli.json`:

**Verified Structure:**
```json
{
  "permissions": {
    "allow": ["Shell(ls)", "Shell(git)", "Shell(npm)"],
    "deny": []
  }
}
```

**Shell Command Examples:**
- `"Shell(git)"` - Allow git commands
- `"Shell(npm)"` - Allow npm commands
- `"Shell(ls)"` - Allow directory listing
- `"Shell(rm)"` - File deletion (use with caution)
- `"Shell(sudo)"` - Superuser commands (high risk)

**Note:** Additional permission types may exist but require further verification against official documentation.
```

### MCP Integration

**MCP Server Management:**
```bash
cursor-agent mcp list                    # List configured MCP servers
cursor-agent mcp login <identifier>      # Authenticate with MCP server
cursor-agent mcp list-tools <identifier> # List available tools
```

**Configuration:** Uses `.cursor/mcp.json` automatically - same config as IDE.

## Essential Commands

### Testing Commands
```bash
# Test basic functionality
echo "Hello" | cursor-agent --print --output-format json --model sonnet

# List available sessions
cursor-agent ls

# Resume specific session
cursor-agent --resume=session-id-here "continue previous task"

# Check authentication
cursor-agent status

# Interactive mode with rules support
cursor-agent --model sonnet "implement feature X"

# Non-interactive with specific format
cursor-agent --print --output-format text --model sonnet "analyze codebase"
```

### TaskMaster Integration Commands
```bash
# Test TaskMaster operations after MCP restart
task-master expand --id=1 --model=sonnet
task-master parse-prd documents/prd.txt
task-master add-task --prompt="New feature request"
```

### Debugging Commands
```bash
# Test model availability
cursor-agent --print --model sonnet "test" 2>&1 | head -5

# Check MCP configuration
cursor-agent mcp list

# Verify permissions
ls ~/.cursor/cli-config.json

# Test tmux integration
echo "test" | timeout 10s cursor-agent --print --output-format json --model sonnet
```

## Configuration Hierarchy

The cursor-agent integration follows this precedence order:

```
1. CLI Arguments (Highest Priority)
2. Environment Variables
3. Configuration Files (Lowest Priority)
```

### Configuration Examples

**CLI Arguments Override:**
```bash
# Environment says model=opus, CLI overrides to sonnet
export CURSOR_MODEL=opus
cursor-agent --model sonnet "prompt"
# Result: Uses sonnet model (CLI wins)
```

**Environment Variables:**
```bash
# Set via environment variables
export CURSOR_MODEL=sonnet
export CURSOR_OUTPUT_FORMAT=json
cursor-agent --print "prompt"

# Or inline
CURSOR_MODEL=sonnet cursor-agent --print "prompt"
```

## Research Capabilities & Limitations

**CRITICAL LIMITATION: No Direct Internet Access**

Cursor Agent CLI **cannot access the internet directly**. It can only:

1. **Local Project Context** - files, git, project structure
2. **Configured MCP Servers** - TaskMaster MCP integration
3. **Workspace Rules** - .cursor/rules and project-specific context

**For Internet Research:** Use TaskMaster's research command which has internet access through MCP servers.

**Available Context:**
```bash
# What cursor-agent CAN access:
- Local codebase files and git history
- Project-specific .cursor/rules
- TaskMaster MCP tools and context
- Workspace configuration

# What cursor-agent CANNOT access:
- General internet search
- Live web content
- Real-time information
- External APIs (unless via MCP)
```

## Troubleshooting

### Common Issues

#### Authentication Problems
```bash
# Check authentication status
cursor-agent status

# Re-authenticate if needed
cursor-agent logout
cursor-agent login
```

#### Model Availability Issues
```bash
# Test specific model
cursor-agent --print --model sonnet "test prompt"

# Check available models
cursor-agent --help | grep -A 10 "model"
```

#### TaskMaster Integration Issues
```bash
# Verify MCP server is running
ps aux | grep "mcp-server/server.js"

# Restart MCP server if needed
./scripts/restart-mcp-server.sh restart

# Test provider loading
./scripts/restart-mcp-server.sh test
```

#### tmux Session Issues
```bash
# List tmux sessions
tmux list-sessions

# Kill orphaned sessions
tmux kill-session -t session-name

# Check tmux is working
echo "test" | tmux new-session -d -s test-session
```

### Error Messages

**"Cannot read properties of undefined"**
- Usually indicates cursor-agent provider configuration issue
- Solution: Restart MCP server after configuration changes

**"Cursor Agent generateObject failed"**
- Authentication or model availability issue
- Solution: Check `cursor-agent status` and re-authenticate if needed

**"tmux: command not found"**
- tmux not installed
- Solution: Install tmux (`sudo apt-get install tmux` on Ubuntu)

### Performance Optimization

**Expected Response Times:**
- Simple queries: 8-12 seconds
- Complex tasks (expand, parse-prd): 15-30 seconds
- Large context operations: 30-60 seconds

**Best Practices:**
- Use for batch operations rather than interactive chat
- Leverage TaskMaster's caching for repeated operations
- Monitor tmux sessions to prevent accumulation

## Integration Workflow

### Daily Usage Pattern
1. **Start development session** - Ensure cursor-agent is authenticated
2. **Work in Cursor** - Use normal Cursor chat for interactive work
3. **Use TaskMaster** - Leverage cursor-agent integration for:
   - `expand_task` - Break down complex tasks
   - `parse_prd` - Generate tasks from requirements
   - `add_task` - Create new tasks with full context
   - `update_task` - Modify tasks with current project state

### When to Restart MCP Server
- After adding cursor-agent provider (one-time setup)
- After modifying provider code
- After changing MCP tool definitions
- **NOT needed** for configuration changes

### Integration with Other Providers
```json
{
  "models": {
    "main": "cursor-agent",        // Cost-free operations
    "research": "perplexity",      // Internet research
    "fallback": "openai"           // Backup when cursor unavailable
  }
}
```

This hybrid approach maximizes cost savings while maintaining full functionality.

---

*This guide covers verified functionality based on actual implementation and testing. For technical architecture details, see the [Architecture Guide](ARCHITECTURE_GUIDE.md).*
