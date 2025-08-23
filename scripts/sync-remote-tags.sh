#!/bin/bash

# Sync Remote Tags Script
# Ensures local tags are always synchronized with remote tags

set -e

echo "🏷️  Synchronizing tags with remote..."

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to check for tag conflicts
check_tag_conflicts() {
    echo "🔍 Checking for tag conflicts..."

    # Get remote tags with their commits
    remote_tags=$(git ls-remote --tags origin 2>/dev/null || echo "")

    if [ -z "$remote_tags" ]; then
        echo -e "${YELLOW}Warning: Could not fetch remote tags. Check network connection.${NC}"
        return 0
    fi

    conflicts_found=false

    # Check each remote tag against local
    while IFS= read -r line; do
        if [[ $line =~ ^([a-f0-9]+)[[:space:]]+refs/tags/(.+)$ ]]; then
            remote_commit="${BASH_REMATCH[1]}"
            tag_name="${BASH_REMATCH[2]}"

            # Skip annotated tag refs (^{})
            if [[ $tag_name == *"^{}" ]]; then
                continue
            fi

            # Check if local tag exists and points to different commit
            local_commit=$(git rev-list -n 1 "$tag_name" 2>/dev/null || echo "")

            if [ -n "$local_commit" ] && [ "$local_commit" != "$remote_commit" ]; then
                echo -e "${YELLOW}Conflict found: $tag_name${NC}"
                echo "  Local:  $local_commit"
                echo "  Remote: $remote_commit"
                conflicts_found=true
            fi
        fi
    done <<< "$remote_tags"

    if [ "$conflicts_found" = true ]; then
        return 1
    else
        echo -e "${GREEN}✓ No tag conflicts found${NC}"
        return 0
    fi
}

# Function to force sync conflicting tags
force_sync_tags() {
    echo "🔄 Force syncing conflicting tags..."

    # Get all remote tags
    remote_tags=$(git ls-remote --tags origin 2>/dev/null || echo "")

    if [ -z "$remote_tags" ]; then
        echo -e "${RED}Error: Could not fetch remote tags${NC}"
        return 1
    fi

    # Process each remote tag
    while IFS= read -r line; do
        if [[ $line =~ ^([a-f0-9]+)[[:space:]]+refs/tags/(.+)$ ]]; then
            remote_commit="${BASH_REMATCH[1]}"
            tag_name="${BASH_REMATCH[2]}"

            # Skip annotated tag refs (^{})
            if [[ $tag_name == *"^{}" ]]; then
                continue
            fi

            # Check if local tag exists and points to different commit
            local_commit=$(git rev-list -n 1 "$tag_name" 2>/dev/null || echo "")

            if [ -n "$local_commit" ] && [ "$local_commit" != "$remote_commit" ]; then
                echo -e "${YELLOW}Updating $tag_name...${NC}"
                git tag -d "$tag_name" >/dev/null 2>&1 || true
            fi
        fi
    done <<< "$remote_tags"

    # Fetch all tags from remote
    echo "📥 Fetching updated tags from remote..."
    git fetch --tags origin

    echo -e "${GREEN}✓ Tags synchronized with remote${NC}"
}

# Main execution
main() {
    if ! check_tag_conflicts; then
        echo -e "${YELLOW}Tag conflicts detected. Syncing with remote...${NC}"
        force_sync_tags

        # Verify sync was successful
        if check_tag_conflicts; then
            echo -e "${GREEN}✓ All tags now synchronized with remote${NC}"
        else
            echo -e "${RED}❌ Failed to synchronize all tags${NC}"
            exit 1
        fi
    fi

    # Test that we can pull tags without conflicts
    echo "🧪 Testing tag pull..."
    if git pull --tags origin $(git rev-parse --abbrev-ref HEAD) >/dev/null 2>&1; then
        echo -e "${GREEN}✓ Tag synchronization successful - no conflicts${NC}"
    else
        echo -e "${RED}❌ Still experiencing tag conflicts${NC}"
        exit 1
    fi
}

# Usage information
if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    echo "Sync Remote Tags Script"
    echo ""
    echo "Usage: $0 [options]"
    echo ""
    echo "Options:"
    echo "  --help, -h    Show this help message"
    echo "  --check-only  Only check for conflicts, don't fix them"
    echo ""
    echo "This script ensures local tags are always synchronized with remote tags."
    echo "It will delete conflicting local tags and fetch the authoritative remote versions."
    exit 0
fi

if [ "$1" = "--check-only" ]; then
    if check_tag_conflicts; then
        echo -e "${GREEN}✓ All tags are synchronized${NC}"
        exit 0
    else
        echo -e "${YELLOW}Tag conflicts found. Run without --check-only to fix.${NC}"
        exit 1
    fi
fi

# Run main function
main
