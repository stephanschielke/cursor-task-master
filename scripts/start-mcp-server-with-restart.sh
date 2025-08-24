#!/bin/bash

# Simple auto-restart wrapper for MCP server
# Usage: ./scripts/start-mcp-server-with-restart.sh

cd "$(dirname "$0")/.." || exit 1

SERVER_SCRIPT="mcp-server/server.js"
MAX_RESTARTS=10
RESTART_COUNT=0
RESTART_DELAY=5

echo "🚀 Starting MCP server with auto-restart..."
echo "📁 Working directory: $(pwd)"
echo "🔄 Max restarts: $MAX_RESTARTS"

while [ $RESTART_COUNT -lt $MAX_RESTARTS ]; do
    echo "⚡ Starting MCP server (attempt $((RESTART_COUNT + 1))/$MAX_RESTARTS)..."
    
    # Start the server and capture its exit code
    node "$SERVER_SCRIPT"
    EXIT_CODE=$?
    
    if [ $EXIT_CODE -eq 0 ]; then
        echo "✅ MCP server exited normally."
        break
    else
        RESTART_COUNT=$((RESTART_COUNT + 1))
        echo "💥 MCP server crashed with exit code $EXIT_CODE"
        
        if [ $RESTART_COUNT -lt $MAX_RESTARTS ]; then
            echo "🔄 Restarting in $RESTART_DELAY seconds..."
            sleep $RESTART_DELAY
        else
            echo "❌ Maximum restart attempts reached. Exiting."
            exit $EXIT_CODE
        fi
    fi
done

echo "🏁 MCP server auto-restart wrapper finished."
