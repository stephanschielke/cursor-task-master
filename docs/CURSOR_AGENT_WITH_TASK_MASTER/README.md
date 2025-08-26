# Cursor Agent Integration with TaskMaster

## Overview

TaskMaster integrates with [cursor-agent CLI](https://docs.cursor.com/features/cursor-agent) to leverage your existing Cursor subscription for AI operations, eliminating additional API costs while providing full workspace context.

## Current Implementation Status

✅ **Working Features:**
- cursor-agent CLI integration via tmux isolation
- Session management and caching system
- JSON response parsing with robust error handling
- MCP tool integration (`expand_task`, `add_task`, `parse_prd`, etc.)
- Automatic session cleanup and process management

## Quick Start

### Prerequisites

- [Cursor IDE](https://cursor.com/) with active subscription
- [cursor-agent CLI](https://docs.cursor.com/en/cli/) installed and authenticated
- [tmux](https://github.com/tmux/tmux) terminal multiplexer
- TaskMaster AI with MCP server running

### Verification

```bash
# Check cursor-agent authentication
cursor-agent status

# Verify tmux availability
tmux -V

# Test basic functionality
echo "Hello" | cursor-agent --print --output-format json --model sonnet-4
```

### Configuration

Update `.taskmaster/config.json`:
```json
{
  "models": {
    "main": {
      "provider": "cursor-agent",
      "modelId": "sonnet-4",
      "maxTokens": 163840,
      "temperature": 0.2
    },
    "research": {
      "provider": "cursor-agent",
      "modelId": "sonnet-4",
      "maxTokens": 164000,
      "temperature": 0.2
    },
    "fallback": {
      "provider": "cursor-agent",
      "modelId": "gpt-5",
      "maxTokens": 163840,
      "temperature": 0.2
    }
  }
}
```

## Architecture

### Integration Flow

```
User Request → MCP Server → cursor-agent Provider → tmux Session → cursor-agent CLI → Claude Model → JSON Response → TaskMaster
```

### Key Components

- **CursorAgentProvider** (`src/ai-providers/cursor-agent.js`) - Main integration class with tmux session management
- **Session Manager** (`src/utils/cursor-agent-session-manager.js`) - Session lifecycle and cleanup management
- **JSON Parser** (`src/utils/cursor-agent-json-parser.js`) - Robust response parsing with multiple fallback strategies
- **Session Cache** (`src/utils/cursor-agent-session-cache.js`) - Session reuse and persistence for efficiency

### Technical Implementation

**tmux Isolation Strategy:**
- Creates unique detached tmux sessions for each cursor-agent operation
- Prevents hanging on interactive prompts through process isolation
- Polls session output every 2 seconds with 3-minute timeout for complex operations
- Automatic session cleanup on completion or error

**JSON Response Processing:**
- Three-tier parsing strategy: line-by-line, regex-based extraction, last-resort field matching
- Handles ANSI color codes, control characters, and double-encoded JSON
- Robust error recovery for malformed or truncated responses
- Session ID extraction for caching and reuse

**Session Caching:**
- File-based session persistence in `.taskmaster/cursor-agent-sessions.json`
- Automatic session reuse based on project root and model combination
- Failed resume attempt tracking and session invalidation
- Configurable session limits and cleanup policies

## Usage

### Available Models

- `sonnet-4` - Claude Sonnet 4 (recommended)
- `opus-4.1` - Claude Opus 4.1
- `gpt-5` - OpenAI GPT-5

### Common Operations

```bash
# Expand task with cursor-agent
task-master expand --id=1 --research

# Parse PRD with workspace context
task-master parse-prd documents/requirements.txt

# Add new task with full context
task-master add-task --prompt="Implement user authentication"
```

### Session Management

- Sessions are automatically cached and reused for efficiency
- Session files stored in `.taskmaster/cursor-agent-sessions.json`
- Automatic cleanup prevents session accumulation
- tmux isolation prevents hanging on interactive prompts

## Performance

- **Response Time:** 8-16 seconds for typical operations
- **Best Use Cases:** Batch operations, task expansion, PRD parsing
- **Limitations:** Not suitable for real-time chat interactions

## Troubleshooting

### Authentication Issues

```bash
# Re-authenticate if needed
cursor-agent logout
cursor-agent login
cursor-agent status
```

### Session Issues

```bash
# Clear cached sessions
rm .taskmaster/cursor-agent-sessions.json

# List active tmux sessions
tmux list-sessions

# Kill orphaned sessions
tmux kill-session -t session-name
```

### MCP Server Operations

**When Restart is Required:**
- Adding or modifying providers (like cursor-agent)
- Changes to MCP tool definitions
- Core module updates (`ai-services-unified.js`, `config-manager.js`)

**When Restart is NOT Required:**
- Configuration changes (`.taskmaster/config.json`)
- Environment variable updates
- Task data modifications

**Restart Commands:**
```bash
# Restart MCP server
./scripts/restart-mcp-server.sh restart

# Check status
./scripts/restart-mcp-server.sh status

# Test provider loading
./scripts/restart-mcp-server.sh test

# Validate readiness
./scripts/validate-restart.sh
```

**After Restart:**
- Cursor IDE automatically reconnects to MCP server
- Test cursor-agent provider with `task-master` commands

## Benefits

- **Cost Elimination:** No additional API costs beyond Cursor subscription
- **Full Context:** Access to entire workspace, git history, and cursor rules
- **Consistent Models:** Same Claude models across Cursor and TaskMaster
- **No Additional Auth:** Uses existing Cursor login credentials

## Limitations

- **tmux Dependency:** Requires tmux for session isolation
- **Response Time:** Slower than direct API calls (8-16s vs 2-10s)
- **Cursor Subscription Required:** Must have active Cursor Pro subscription
- **MCP Restart Required:** Provider changes require MCP server restart

---

*This documentation reflects the current working implementation. For future enhancements and vision, see [VISION.md](VISION.md).*
