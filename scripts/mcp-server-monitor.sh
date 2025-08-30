#!/bin/bash

# TaskMaster MCP Server Monitor
# Monitors the MCP server health and restarts if needed

# Configuration
MCP_SERVER_PATH="/home/stephan/Code/claude-task-master/mcp-server/server.js"
LOG_FILE="/tmp/mcp-server-monitor.log"
PID_FILE="/tmp/mcp-server.pid"
MAX_RETRIES=3
RETRY_DELAY=5

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE"
}

# Check if MCP server process is running
is_server_running() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if ps -p "$pid" > /dev/null 2>&1; then
            # Check if it's actually our server process
            if ps -p "$pid" -o command --no-headers | grep -q "mcp-server/server.js"; then
                return 0
            fi
        fi
        # Remove stale PID file
        rm -f "$PID_FILE"
    fi
    return 1
}

# Start the MCP server
start_server() {
    log "🚀 Starting MCP server..."
    cd "$(dirname "$MCP_SERVER_PATH")"

    # Start server in background and capture PID
    node "$MCP_SERVER_PATH" > /dev/null 2>&1 &
    local pid=$!
    echo $pid > "$PID_FILE"

    # Wait a moment for server to initialize
    sleep 2

    if is_server_running; then
        log "✅ MCP server started successfully (PID: $pid)"
        return 0
    else
        log "❌ Failed to start MCP server"
        return 1
    fi
}

# Stop the MCP server
stop_server() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        log "🛑 Stopping MCP server (PID: $pid)..."
        kill "$pid" 2>/dev/null
        sleep 2
        if ps -p "$pid" > /dev/null 2>&1; then
            # Force kill if still running
            kill -9 "$pid" 2>/dev/null
        fi
        rm -f "$PID_FILE"
        log "✅ MCP server stopped"
    fi
}

# Test server health by checking if it can handle a simple request
test_server_health() {
    # This is a basic check - in production you might want to test actual MCP communication
    if is_server_running; then
        return 0
    fi
    return 1
}

# Main monitoring function
monitor_server() {
    local retries=0

    while true; do
        if test_server_health; then
            if [ $retries -gt 0 ]; then
                log "✅ Server recovered after $retries restart(s)"
                retries=0
            fi
            echo -e "${GREEN}🟢 MCP Server: HEALTHY${NC}"
        else
            retries=$((retries + 1))
            echo -e "${RED}🔴 MCP Server: UNHEALTHY (Attempt $retries/$MAX_RETRIES)${NC}"
            log "❌ Server health check failed (attempt $retries/$MAX_RETRIES)"

            if [ $retries -le $MAX_RETRIES ]; then
                log "🔄 Attempting to restart server..."
                stop_server
                sleep $RETRY_DELAY

                if start_server; then
                    log "✅ Server restarted successfully"
                    retries=0
                else
                    log "❌ Failed to restart server"
                fi
            else
                log "💀 Max retries exceeded. Manual intervention required."
                echo -e "${RED}💀 MCP Server: FAILED (Manual intervention required)${NC}"
                exit 1
            fi
        fi

        sleep 10  # Check every 10 seconds
    done
}

# Handle script arguments
case "${1:-monitor}" in
    "start")
        log "📋 Manual start requested"
        stop_server  # Stop any existing instance
        start_server
        ;;
    "stop")
        log "📋 Manual stop requested"
        stop_server
        ;;
    "restart")
        log "📋 Manual restart requested"
        stop_server
        start_server
        ;;
    "status")
        if test_server_health; then
            echo -e "${GREEN}🟢 MCP Server: HEALTHY${NC}"
            exit 0
        else
            echo -e "${RED}🔴 MCP Server: UNHEALTHY${NC}"
            exit 1
        fi
        ;;
    "monitor")
        log "📋 Starting MCP server monitoring..."
        echo "📊 TaskMaster MCP Server Monitor"
        echo "📋 Log file: $LOG_FILE"
        echo "🚀 Press Ctrl+C to stop monitoring"
        echo ""

        # Start server if not running
        if ! test_server_health; then
            start_server
        fi

        # Start monitoring loop
        trap 'log "📋 Monitoring stopped by user"; exit 0' INT
        monitor_server
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status|monitor}"
        echo ""
        echo "Commands:"
        echo "  start   - Start the MCP server"
        echo "  stop    - Stop the MCP server"
        echo "  restart - Restart the MCP server"
        echo "  status  - Check server status"
        echo "  monitor - Monitor and auto-restart server (default)"
        exit 1
        ;;
esac
