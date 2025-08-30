# Cursor Agent Integration Guide

## Overview

This guide provides comprehensive documentation for integrating Cursor Agent as an AI provider in Task Master. The integration allows Task Master to use Cursor Agent's AI capabilities while maintaining proper isolation and error handling.

## Quick Start

### Configuration

Update your `.taskmaster/config.json` to use Cursor Agent:

```json
{
  "models": {
    "main": {
      "provider": "cursor-agent",
      "modelId": "auto",
      "maxTokens": 163840,
      "temperature": 0.2
    }
  }
}
```

### Basic Usage

```javascript
import { CursorAgentProvider } from './src/ai-providers/cursor-agent.js';

const provider = new CursorAgentProvider();
const client = provider.getClient({ projectRoot: '/path/to/project' });

const result = await client.generateText({
  messages: [{ role: 'user', content: 'Hello world' }],
  model: 'auto'
});
```

## Architecture

### Core Components

1. **CursorAgentProvider**: Main provider class handling AI requests
2. **Workspace Approvals**: Automatic management of Cursor Agent workspace trust
3. **Isolated Execution**: Runs Cursor Agent in isolated directories to prevent MCP conflicts
4. **Error Handling**: Comprehensive error detection and reporting

### Key Features

- **Auto Model Selection**: Uses `auto` model to bypass rate limits
- **MCP Isolation**: Prevents circular dependencies with MCP servers
- **Workspace Trust**: Automatic approval management
- **Error Recovery**: Robust error handling and recovery mechanisms
- **Functional Programming**: Pure functions for hash generation and data transformation
- **Resource Management**: Proper cleanup of temporary files and isolated directories

## Configuration Options

### Model Configuration

```json
{
  "provider": "cursor-agent",
  "modelId": "auto",  // Recommended: auto, sonnet-4, opus, etc.
  "maxTokens": 163840,
  "temperature": 0.2,
  "timeout": 120000
}
```

### Environment Variables

```bash
# Optional: Override default cursor-agent path
CURSOR_AGENT_PATH=/custom/path/to/cursor-agent

# Optional: Custom workspace directory
CURSOR_AGENT_WORKSPACE=/path/to/workspace
```

## Supported Models

| Model ID | Description | Status |
|----------|-------------|--------|
| `auto` | Auto-select best available model | ✅ Recommended |
| `sonnet-4` | Claude Sonnet 4 | ✅ Supported |
| `opus` | Claude Opus | ✅ Supported |
| `haiku` | Claude Haiku | ✅ Supported |
| `gpt-5` | GPT-5 | ✅ Supported |
| `gpt-4` | GPT-4 | ✅ Supported |

## Troubleshooting

### Common Issues

#### 1. Empty Responses
**Symptom**: Cursor Agent returns `{"result": ""}`
**Solution**: Use `modelId: "auto"` instead of specific models

#### 2. MCP Connection Errors
**Symptom**: `MCP error -32000: Connection closed`
**Solution**: Integration automatically handles MCP isolation

#### 3. Timeout Errors
**Symptom**: `cursor-agent timeout after 120 seconds`
**Solution**: Check network connectivity and Cursor Agent installation

#### 4. Permission Denied
**Symptom**: Workspace trust or approval errors
**Solution**: Integration handles workspace approvals automatically

### Debug Mode

Enable debug logging:

```bash
DEBUG=1 task-master analyze-complexity
```

Or in code:

```javascript
import { getDebugFlag } from './scripts/modules/config-manager.js';
// Debug logs will be shown when debug flag is enabled
```

## API Reference

### CursorAgentProvider

#### Constructor
```javascript
const provider = new CursorAgentProvider();
```

#### getClient(params)
```javascript
const client = provider.getClient({
  projectRoot: '/path/to/project'  // Required
});
```

#### generateText(options)
```javascript
const result = await client.generateText({
  messages: [{ role: 'user', content: 'Prompt' }],
  model: 'auto',  // Optional, defaults to config
  temperature: 0.2,  // Optional
  maxTokens: 16384  // Optional
});
```

Returns:
```javascript
{
  text: "Generated response",
  usage: {
    inputTokens: 10,
    outputTokens: 20,
    totalTokens: 30
  },
  finishReason: "stop"
}
```

## Implementation Details

### MCP Isolation Strategy

The integration uses several techniques to prevent MCP circular dependencies:

1. **File-based Isolation**: Temporarily moves MCP config files
2. **Directory Isolation**: Runs Cursor Agent in isolated directories
3. **Environment Variables**: Sets MCP-related environment variables

### Workspace Approval Management

Automatically handles:
- `.workspace-trusted` file creation
- `mcp-approvals.json` generation
- Hash-based approval ID generation

### Error Handling

Comprehensive error types:
- `MCP_CONNECTION_ERROR`: MCP server connection issues
- `WORKSPACE_TRUST_ERROR`: Workspace approval problems
- `MODEL_LIMIT_ERROR`: Rate limiting or usage limits
- `TIMEOUT_ERROR`: Request timeout issues

## Performance Considerations

### Optimization Tips

1. **Use Auto Model**: `modelId: "auto"` provides best performance
2. **Proper Timeouts**: Adjust timeout based on model complexity
3. **Batch Requests**: Use appropriate batching for multiple requests

### Resource Usage

- **Memory**: ~50MB per request
- **CPU**: Low overhead, primarily I/O bound
- **Network**: Depends on model and response size

## Security Considerations

### Isolation
- Cursor Agent runs in isolated directories
- No access to host system files outside project scope
- MCP configurations are temporarily moved during execution

### Authentication
- Uses existing Cursor Agent authentication
- No additional credentials required
- Respects Cursor Agent's security model

## Maintenance

### Updates
- Monitor Cursor Agent CLI updates
- Update model compatibility as new models are released
- Review and update approval algorithms if Cursor Agent changes

### Monitoring
- Use `scripts/check-mcp-health.js` for health monitoring
- Monitor timeout rates and error patterns
- Track model usage and performance metrics

## Contributing

### Development Setup
1. Clone the repository
2. Install dependencies: `npm install`
3. Configure Cursor Agent
4. Run tests: `npm test`

### Testing
- Use `modelId: "auto"` for integration tests
- Test with various project sizes and complexities
- Verify MCP isolation works correctly

### Code Style
- Follow existing TypeScript/JavaScript patterns
- Use async/await for all async operations
- Include comprehensive error handling
- Add JSDoc comments for public APIs

## Support

For issues related to Cursor Agent integration:
1. Check Cursor Agent CLI installation
2. Verify workspace trust configuration
3. Review debug logs with `DEBUG=1`
4. Check network connectivity

## Changelog

### v1.0.0
- Initial Cursor Agent integration
- Auto model selection support
- MCP isolation implementation
- Workspace approval automation
- Comprehensive error handling
