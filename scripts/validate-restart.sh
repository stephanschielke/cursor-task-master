#!/bin/bash
# Validation script for MCP server restart functionality
# This script tests the restart process without disrupting active Cursor sessions

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "🔍 TaskMaster MCP Server Restart Validation"
echo "============================================"

# Test 1: Check if restart script exists and is executable
echo -n "✓ Checking restart script exists and is executable... "
if [ -x "./scripts/restart-mcp-server.sh" ]; then
    echo -e "${GREEN}PASS${NC}"
else
    echo -e "${RED}FAIL${NC} - Script not found or not executable"
    exit 1
fi

# Test 2: Check status function
echo -n "✓ Testing status function... "
if ./scripts/restart-mcp-server.sh status > /dev/null 2>&1; then
    echo -e "${GREEN}PASS${NC}"
else
    echo -e "${RED}FAIL${NC} - Status function failed"
    exit 1
fi

# Test 3: Check provider loading
echo -n "✓ Testing provider loading... "
if ./scripts/restart-mcp-server.sh test > /dev/null 2>&1; then
    echo -e "${GREEN}PASS${NC}"
else
    echo -e "${RED}FAIL${NC} - Provider loading test failed"
    exit 1
fi

# Test 4: Check log file creation
echo -n "✓ Testing log file creation... "
if [ -f "/tmp/taskmaster-mcp-restart.log" ]; then
    echo -e "${GREEN}PASS${NC}"
else
    echo -e "${RED}FAIL${NC} - Log file not created"
    exit 1
fi

# Test 5: Verify cursor-agent CLI availability
echo -n "✓ Testing cursor-agent CLI availability... "
if command -v cursor-agent > /dev/null 2>&1; then
    echo -e "${GREEN}PASS${NC}"
else
    echo -e "${YELLOW}WARN${NC} - cursor-agent CLI not found in PATH"
fi

# Test 6: Verify tmux availability
echo -n "✓ Testing tmux availability... "
if command -v tmux > /dev/null 2>&1; then
    echo -e "${GREEN}PASS${NC}"
else
    echo -e "${RED}FAIL${NC} - tmux not found in PATH"
    exit 1
fi

# Test 7: Check MCP server path
echo -n "✓ Verifying MCP server path... "
MCP_PATH="${TASKMASTER_PROJECT_ROOT:-$(pwd)}/mcp-server/server.js"
if [ -f "$MCP_PATH" ]; then
    echo -e "${GREEN}PASS${NC}"
else
    echo -e "${RED}FAIL${NC} - MCP server not found at $MCP_PATH"
    exit 1
fi

# Test 8: Check if current process is the expected one
echo -n "✓ Verifying current MCP server process... "
CURRENT_PID=$(pgrep -f "mcp-server/server.js" 2>/dev/null || echo "")
if [ -n "$CURRENT_PID" ]; then
    echo -e "${GREEN}PASS${NC} (PID: $CURRENT_PID)"
else
    echo -e "${YELLOW}WARN${NC} - No MCP server process found"
fi

echo
echo "🎯 Validation Summary:"
echo "====================="
echo -e "✅ Restart script is ready to use"
echo -e "✅ All core dependencies available"  
echo -e "✅ Provider loading works correctly"
echo -e "✅ Logging system functional"

if [ -n "$CURRENT_PID" ]; then
    echo
    echo "⚠️  IMPORTANT NOTES:"
    echo "==================="
    echo "• MCP server is currently running (PID: $CURRENT_PID)"
    echo "• Restart will temporarily disconnect Cursor"  
    echo "• You'll need to restart Cursor after MCP restart"
    echo "• Test in development environment first"
    echo
    echo "🚀 Ready to restart when needed:"
    echo "  ./scripts/restart-mcp-server.sh restart"
fi

echo
echo -e "${GREEN}All validations passed! 🎉${NC}"
