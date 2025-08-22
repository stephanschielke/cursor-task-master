#!/bin/bash
# TaskMaster MCP Server Restart Script
# Gracefully stops and restarts the MCP server for provider updates

set -e  # Exit on any error

# Configuration - use environment variables with defaults
MCP_SERVER_PATH="${TASKMASTER_PROJECT_ROOT:-$(pwd)}/mcp-server/server.js"
PID_FILE="/tmp/taskmaster-mcp-server.pid"
LOG_FILE="/tmp/taskmaster-mcp-restart.log"
CURSOR_MCP_CONFIG="${CURSOR_MCP_CONFIG_PATH:-${HOME}/.cursor/mcp.json}"
MAX_WAIT_TIME=30  # seconds

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    local level=$1
    shift
    local message="$@"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "${timestamp} [${level}] ${message}" | tee -a "$LOG_FILE"
}

# Function to find MCP server process
find_mcp_process() {
    # Look for the MCP server process
    pgrep -f "mcp-server/server.js" 2>/dev/null || true
}

# Function to verify server is running
verify_server_running() {
    local pid=$1
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        return 0
    else
        return 1
    fi
}

# Function to wait for process to stop
wait_for_stop() {
    local pid=$1
    local count=0
    
    while [ $count -lt $MAX_WAIT_TIME ]; do
        if ! kill -0 "$pid" 2>/dev/null; then
            return 0
        fi
        sleep 1
        count=$((count + 1))
        echo -n "."
    done
    return 1
}

# Function to stop server gracefully
stop_server() {
    log "INFO" "Stopping TaskMaster MCP Server..."
    
    local pid=$(find_mcp_process)
    
    if [ -z "$pid" ]; then
        log "WARN" "No MCP server process found"
        return 0
    fi
    
    log "INFO" "Found MCP server with PID: $pid"
    
    # Send SIGTERM for graceful shutdown
    log "INFO" "Sending SIGTERM to PID $pid"
    kill -TERM "$pid" 2>/dev/null || {
        log "ERROR" "Failed to send SIGTERM to PID $pid"
        return 1
    }
    
    # Wait for graceful shutdown
    echo -n "Waiting for graceful shutdown"
    if wait_for_stop "$pid"; then
        echo
        log "SUCCESS" "Server stopped gracefully"
    else
        echo
        log "WARN" "Graceful shutdown timeout, forcing kill"
        kill -KILL "$pid" 2>/dev/null || true
        sleep 2
        
        if verify_server_running "$pid"; then
            log "ERROR" "Failed to stop server even with SIGKILL"
            return 1
        else
            log "INFO" "Server force-killed successfully"
        fi
    fi
    
    # Clean up PID file if it exists
    [ -f "$PID_FILE" ] && rm -f "$PID_FILE"
    
    return 0
}

# Function to start server
start_server() {
    log "INFO" "Starting TaskMaster MCP Server..."
    
    # Verify server script exists
    if [ ! -f "$MCP_SERVER_PATH" ]; then
        log "ERROR" "MCP server script not found: $MCP_SERVER_PATH"
        return 1
    fi
    
    # Start server in background
    cd "$(dirname "$MCP_SERVER_PATH")/.."
    nohup node "$MCP_SERVER_PATH" > /tmp/taskmaster-mcp-stdout.log 2> /tmp/taskmaster-mcp-stderr.log &
    local new_pid=$!
    
    # Save PID
    echo "$new_pid" > "$PID_FILE"
    log "INFO" "Server started with PID: $new_pid"
    
    # Wait a moment for startup
    sleep 3
    
    # Verify server is still running
    if verify_server_running "$new_pid"; then
        log "SUCCESS" "Server started successfully and is running"
        return 0
    else
        log "ERROR" "Server failed to start or crashed immediately"
        
        # Show recent logs for debugging
        if [ -f /tmp/taskmaster-mcp-stderr.log ]; then
            log "ERROR" "Recent error logs:"
            tail -10 /tmp/taskmaster-mcp-stderr.log | while read line; do
                log "ERROR" "  $line"
            done
        fi
        
        return 1
    fi
}

# Function to verify Cursor can connect
verify_cursor_connection() {
    log "INFO" "Verifying Cursor MCP integration..."
    
    # Check if Cursor MCP config exists
    if [ ! -f "$CURSOR_MCP_CONFIG" ]; then
        log "WARN" "Cursor MCP config not found: $CURSOR_MCP_CONFIG"
        return 1
    fi
    
    # Check if task-master-ai is configured
    if ! grep -q "task-master-ai" "$CURSOR_MCP_CONFIG" 2>/dev/null; then
        log "WARN" "task-master-ai not found in Cursor MCP config"
        return 1
    fi
    
    log "INFO" "Cursor MCP configuration appears valid"
    
    # Note: We can't easily test the actual MCP connection without Cursor running
    # This would require implementing an MCP client or using Cursor's built-in tools
    log "INFO" "Restart Cursor to establish new MCP connection"
    
    return 0
}

# Function to show server status
show_status() {
    local pid=$(find_mcp_process)
    
    if [ -n "$pid" ]; then
        log "INFO" "TaskMaster MCP Server Status: ${GREEN}RUNNING${NC} (PID: $pid)"
        
        # Show process details
        ps -p "$pid" -o pid,ppid,cmd,etime 2>/dev/null | tail -n +2 | while read line; do
            log "INFO" "  $line"
        done
        
        # Show recent logs if available
        if [ -f /tmp/taskmaster-mcp-stdout.log ]; then
            local log_lines=$(wc -l < /tmp/taskmaster-mcp-stdout.log 2>/dev/null || echo "0")
            if [ "$log_lines" -gt 0 ]; then
                log "INFO" "Recent stdout (last 5 lines):"
                tail -5 /tmp/taskmaster-mcp-stdout.log | while read line; do
                    log "INFO" "  $line"
                done
            fi
        fi
    else
        log "INFO" "TaskMaster MCP Server Status: ${RED}STOPPED${NC}"
    fi
}

# Function to test provider loading
test_provider_loading() {
    log "INFO" "Testing provider availability..."
    
    local server_dir="$(dirname "$MCP_SERVER_PATH")"
    cd "$server_dir/.."
    
    # Test if cursor-agent provider can be imported
    node -e "
        try {
            const { CursorAgentProvider } = require('./src/ai-providers/cursor-agent.js');
            const provider = new CursorAgentProvider();
            console.log('✅ CursorAgentProvider loaded successfully');
            console.log('Provider name:', provider.name);
        } catch (error) {
            console.error('❌ Failed to load CursorAgentProvider:', error.message);
            process.exit(1);
        }
    " 2>&1 | while read line; do
        log "INFO" "  $line"
    done
    
    local exit_code=${PIPESTATUS[0]}
    if [ $exit_code -eq 0 ]; then
        log "SUCCESS" "Provider loading test passed"
        return 0
    else
        log "ERROR" "Provider loading test failed"
        return 1
    fi
}

# Main restart function
restart_server() {
    log "INFO" "========================================"
    log "INFO" "TaskMaster MCP Server Restart Started"
    log "INFO" "========================================"
    
    # Stop existing server
    if ! stop_server; then
        log "ERROR" "Failed to stop server"
        return 1
    fi
    
    # Wait a moment between stop and start
    sleep 2
    
    # Start new server
    if ! start_server; then
        log "ERROR" "Failed to start server"
        return 1
    fi
    
    # Test provider loading
    if ! test_provider_loading; then
        log "ERROR" "Provider loading test failed"
        return 1
    fi
    
    # Verify Cursor integration
    verify_cursor_connection
    
    log "SUCCESS" "========================================"
    log "SUCCESS" "TaskMaster MCP Server Restart Complete"
    log "SUCCESS" "========================================"
    log "INFO" "Next steps:"
    log "INFO" "1. Restart Cursor to reconnect to MCP server"
    log "INFO" "2. Test TaskMaster operations (e.g., expand_task)"
    log "INFO" "3. Check logs: $LOG_FILE"
    
    return 0
}

# Script usage
usage() {
    echo "Usage: $0 {start|stop|restart|status|test}"
    echo "  start   - Start the MCP server"
    echo "  stop    - Stop the MCP server"
    echo "  restart - Stop and start the MCP server"
    echo "  status  - Show current server status"
    echo "  test    - Test provider loading"
    exit 1
}

# Initialize log file
echo "=== TaskMaster MCP Server Management Log ===" > "$LOG_FILE"

# Main command handling
case "${1:-restart}" in
    start)
        start_server
        exit $?
        ;;
    stop)
        stop_server
        exit $?
        ;;
    restart)
        restart_server
        exit $?
        ;;
    status)
        show_status
        exit 0
        ;;
    test)
        test_provider_loading
        exit $?
        ;;
    *)
        usage
        ;;
esac
