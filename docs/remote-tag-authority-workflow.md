# Remote Tag Authority Workflow

This document outlines the workflow for ensuring remote tags are always treated as authoritative in the Task Master project.

## The Problem

Git tags can become out of sync between local and remote repositories, causing conflicts when trying to pull tags. This typically happens when:

- Tags are created locally and pushed
- Tags are moved or recreated on remote
- Multiple developers create the same tag pointing to different commits
- Tags are force-pushed or amended on remote

## The Solution

We maintain **remote tag authority** - the remote repository's tags are always considered the authoritative version.

## Automated Workflow

### Script Usage

Use the provided script to automatically sync tags:

```bash
# Check for tag conflicts (read-only)
./scripts/sync-remote-tags.sh --check-only

# Automatically fix all tag conflicts
./scripts/sync-remote-tags.sh

# Get help
./scripts/sync-remote-tags.sh --help
```

### What the Script Does

1. **Checks for Conflicts**: Compares local tags with remote tags
2. **Reports Differences**: Shows which tags point to different commits
3. **Deletes Conflicting Local Tags**: Removes local tags that conflict with remote
4. **Fetches Remote Tags**: Downloads the authoritative remote versions
5. **Verifies Success**: Tests that tag operations work without conflicts

### Example Output

```bash
🏷️  Synchronizing tags with remote...
🔍 Checking for tag conflicts...
Conflict found: extension@0.24.0
  Local:  1fa4aba185717fc390c3aa2fd1778e36e233e826
  Remote: 7d564920b52ec150dfe0a0d2fa80372be1499fa3
🔄 Force syncing conflicting tags...
Updating extension@0.24.0...
📥 Fetching updated tags from remote...
✓ Tags synchronized with remote
🧪 Testing tag pull...
✓ Tag synchronization successful - no conflicts
```

## Manual Workflow

If you prefer manual control or need to understand the process:

### Step 1: Identify Conflicts

```bash
# Check what remote tags exist
git ls-remote --tags origin

# Compare with local tags
git show-ref --tags

# Look for mismatched commit hashes
```

### Step 2: Delete Conflicting Local Tags

```bash
# Delete specific conflicting tags
git tag -d extension@0.24.0 extension@0.24.1

# Or delete all tags (nuclear option)
git tag -l | xargs git tag -d
```

### Step 3: Fetch Remote Tags

```bash
# Fetch all tags from remote
git fetch --tags origin
```

### Step 4: Verify Success

```bash
# Test that pulls work without conflicts
git pull --tags origin cursor-agent-provider
```

## Integration Points

### Pre-Pull Workflow

Before any `git pull` operation that includes tags:

```bash
# Option 1: Use the script
./scripts/sync-remote-tags.sh --check-only

# Option 2: Manual check
git fetch --dry-run --tags origin
```

### CI/CD Integration

Add tag synchronization to your CI/CD pipeline:

```yaml
# GitHub Actions example
- name: Sync Remote Tags
  run: |
    ./scripts/sync-remote-tags.sh
    git pull --tags origin ${{ github.ref_name }}
```

### Developer Onboarding

New developers should run the sync script after cloning:

```bash
# After git clone
cd task-master
./scripts/sync-remote-tags.sh
```

## Troubleshooting

### Common Issues

1. **"Would clobber existing tag" error**
   - Solution: Run `./scripts/sync-remote-tags.sh`

2. **Network connectivity issues**
   - The script handles offline gracefully
   - Manual sync required when connectivity returns

3. **Permission issues with script**
   - Run: `chmod +x scripts/sync-remote-tags.sh`

4. **Multiple remotes**
   - Script assumes `origin` as the authoritative remote
   - Modify script if using different remote names

### Debug Mode

For detailed troubleshooting:

```bash
# Enable bash debugging
bash -x scripts/sync-remote-tags.sh

# Check specific tag commits
git rev-list -n 1 extension@0.24.0
git ls-remote origin refs/tags/extension@0.24.0
```

## Best Practices

### For Developers

1. **Always sync before pushing tags**
   ```bash
   ./scripts/sync-remote-tags.sh
   git push --tags origin
   ```

2. **Use the script in your daily workflow**
   ```bash
   # Add to your shell aliases
   alias git-sync-tags='./scripts/sync-remote-tags.sh'
   ```

3. **Never force push tags without coordination**
   - Discuss with team first
   - Coordinate the sync timing

### For CI/CD

1. **Include tag sync in automated workflows**
2. **Use `--check-only` for validation steps**
3. **Run sync before any tag-dependent operations**

### For Releases

1. **Sync tags before creating releases**
2. **Verify tag integrity after release creation**
3. **Document which tags are canonical for each release**

## Script Maintenance

The sync script is located at `scripts/sync-remote-tags.sh` and should be updated when:

- Remote repository changes (different name than `origin`)
- Tag naming conventions change
- Additional validation requirements emerge
- Error handling needs improvement

Regular testing of the script ensures it continues to work correctly as the repository evolves.

## Related Documentation

- [Git Workflow](git_workflow.md)
- [Release Process](release-process.md)
- [Development Workflow](dev_workflow.md)


