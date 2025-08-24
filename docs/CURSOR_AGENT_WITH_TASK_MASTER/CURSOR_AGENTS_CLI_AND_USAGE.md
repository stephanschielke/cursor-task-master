---
description: Complete guide to Cursor Agent CLI integration, session management, and TaskMaster usage
---

# Cursor Agent CLI Integration & Usage Guide

## Overview

This document captures comprehensive information about cursor-agent CLI behavior, integration patterns, and TaskMaster implementation details based on [official Cursor CLI documentation](https://docs.cursor.com/en/cli/).

## Key Insights & Discoveries

### Session Management (Critical for TaskMaster Integration)

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

### Authentication Methods

**Recommended: Browser Authentication**
```bash
cursor-agent login          # Opens browser for auth
cursor-agent status         # Check auth status  
cursor-agent logout         # Clear credentials
```

**Alternative: API Key Authentication**
```bash
export CURSOR_API_KEY=your_api_key_here
cursor-agent --api-key your_api_key_here "prompt"
```

### Output Formats & Non-Interactive Mode

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

**Stream JSON Events:**
```json
{"type":"system","subtype":"init",...}
{"type":"user","message":{"role":"user",...},...}
{"type":"assistant","message":{"role":"assistant",...},...}
{"type":"tool_call","subtype":"started",...}
{"type":"tool_call","subtype":"completed",...}
{"type":"result","subtype":"success",...}
```

### Model Selection

**Available Models:**
- `sonnet` (Claude Sonnet - working)
- `sonnet-4` (not available in our environment)
- `sonnet-4-thinking` 
- `gpt-5`, `gpt-4o`
- `opus` (Claude Opus)

**Model-Specific Commands:**
```bash
cursor-agent sonnet "prompt"    # Direct sonnet model
cursor-agent opus "prompt"      # Direct opus model  
cursor-agent gpt5 "prompt"      # Direct GPT-5 model
```

### Permission System

**Permission Types** (configured in `~/.cursor/cli-config.json` or `<project>/.cursor/cli.json`):

**Shell Commands:**
```json
{
  "allow": ["Shell(git)", "Shell(npm)", "Shell(ls)"],
  "deny": ["Shell(rm)", "Shell(sudo)"]
}
```

**File Access:**
```json
{
  "allow": [
    "Read(src/**/*.ts)",
    "Write(src/**)",
    "Read(**/*.md)"
  ],
  "deny": [
    "Read(.env*)",
    "Write(**/*.key)", 
    "Write(**/.env*)"
  ]
}
```

### MCP Integration

**MCP Server Management:**
```bash
cursor-agent mcp list                    # List configured MCP servers
cursor-agent mcp login <identifier>      # Authenticate with MCP server
cursor-agent mcp list-tools <identifier> # List available tools
```

**Configuration:** Uses `.cursor/mcp.json` automatically - same config as IDE.

### Research Capabilities & Limitations

**CRITICAL FINDING: No Internet Access**

Cursor Agent CLI **cannot access the internet directly**. It can only:

1. **Context7 Library Documentation** - via MCP tools
2. **Local Project Context** - files, git, etc.
3. **Configured MCP Servers** - custom integrations

**For Real Research:** Need to set up **internet research MCP server**.

**Available Research Tools:**
```bash
# What cursor-agent CAN access:
- Local codebase files and git
- MCP servers (context7, custom ones)
- Project-specific context

# What cursor-agent CANNOT access:
- General internet search
- Live web content
- Real-time information
```

## TaskMaster Integration Issues & Solutions

### Current Implementation Problems

**1. Wrong JSON Pattern Matching**
```javascript
// ❌ Our current approach - too restrictive
const jsonMatch = output.match(/\{"type":"result"[^}]*\}.*?\}/s);

// ✅ Should match documented format
const successMatch = output.match(/\{"type":"result","subtype":"success".*?\}/s);
```

**2. Force-Kill Instead of Session Management**
```javascript
// ❌ Current: Force terminate after timeout
execSync(`tmux kill-session -t ${sessionName}`);

// ✅ Should: Send Ctrl+D to pause and capture session_id
execSync(`tmux send-keys -t ${sessionName} C-d`);
```

**3. Incorrect Model Names**
```javascript
// ❌ Using unavailable model
modelId: "sonnet-4"  

// ✅ Use available model
modelId: "sonnet"
```

### Recommended Fix Strategy

**1. Update CursorAgentProvider Pattern Matching**
```javascript
// Look for official JSON response format
const jsonMatch = output.match(/\{"type":"result","subtype":"success".*?\}/s);
if (jsonMatch) {
  const parsed = JSON.parse(jsonMatch[0]);
  return {
    text: parsed.result,
    usage: { 
      totalTokens: parsed.duration_ms ? Math.ceil(parsed.duration_ms/1000) : 0 
    },
    finishReason: parsed.is_error ? 'error' : 'stop',
    sessionId: parsed.session_id  // Capture for potential resume
  };
}
```

**2. Implement Session Pause Instead of Force Kill**
```javascript
// Send Ctrl+D to pause session gracefully
execSync(`tmux send-keys -t ${sessionName} C-d`);

// Wait briefly for session to pause and output session ID
setTimeout(() => {
  const output = execSync(`tmux capture-pane -t ${sessionName} -p`);
  const sessionMatch = output.match(/cursor-agent --resume=([a-f0-9-]+)/);
  if (sessionMatch) {
    sessionId = sessionMatch[1];
  }
}, 2000);
```

**3. Update Model Configuration**
```javascript
// In .taskmaster/config.json
{
  "models": {
    "main": {
      "provider": "cursor-agent",
      "modelId": "sonnet",  // Changed from "sonnet-4"
      "maxTokens": 16384,
      "temperature": 0.2
    }
  }
}
```

## Command Reference

### Essential Commands for TaskMaster Integration

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

## Integration Recommendations

### For TaskMaster Research Feature

**Current Status:** TaskMaster research calls will fail because cursor-agent has no internet access.

**Solutions:**
1. **Setup Internet Research MCP** - integrate external research server
2. **Fallback to Context7** - for library/framework documentation  
3. **Local Research Only** - limit to project context and files
4. **Hybrid Approach** - use TaskMaster with external research MCP

### For Reliable Integration

**1. Session Management**
- Implement proper pause/resume instead of force-kill
- Store session IDs for potential recovery
- Handle graceful termination patterns

**2. JSON Response Parsing**  
- Use documented response format exactly
- Handle both success and error cases
- Extract session_id for resume capability

**3. Model & Authentication**
- Verify model availability before use
- Implement proper auth status checking
- Handle authentication failures gracefully

**4. Error Handling**
- Distinguish between cursor-agent errors vs connection issues
- Provide fallback mechanisms for failed sessions
- Log session IDs for manual debugging

## Future Enhancements

### Session Persistence
- Store successful session IDs in TaskMaster state
- Allow resuming previous research sessions
- Implement session cleanup strategies

### Advanced MCP Integration
- Set up internet research MCP server
- Integrate Context7 for library documentation
- Create TaskMaster-specific MCP tools

### Performance Optimization
- Session reuse for related queries
- Batch processing for multiple prompts
- Connection pooling for frequent operations

---

**Last Updated:** 2025-08-17  
**Sources:** [Cursor CLI Documentation](https://docs.cursor.com/en/cli/)

