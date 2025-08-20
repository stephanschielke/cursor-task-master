# CursorAgentProvider Optimization Proposal

Based on analysis of cursor-agent's internal system prompt, we can significantly improve our TaskMaster integration.

## Key Insights from cursor-agent System Prompt

1. **Parallel Tool Execution**: cursor-agent is optimized for parallel operations
2. **Task Management**: Built-in todo_write and planning capabilities  
3. **Comprehensive Context**: Designed to gather thorough information before responding
4. **Natural Communication**: Prefers conversational, non-technical language

## Proposed Improvements

### 1. Enhanced Prompt Construction

**Current Approach:**
```javascript
// Simple prompt passing
const prompt = "Expand task 3 into subtasks";
const result = await this.executeCursorAgent(args, prompt);
```

**Optimized Approach:**
```javascript
/**
 * Build cursor-agent optimized prompt based on operation type
 */
buildOptimizedPrompt(operation, context) {
    const promptStrategies = {
        expand_task: this.buildTaskExpansionPrompt,
        parse_prd: this.buildPRDParsingPrompt,
        update_task: this.buildTaskUpdatePrompt,
        add_task: this.buildTaskCreationPrompt
    };
    
    return promptStrategies[operation]?.(context) || context.prompt;
}

buildTaskExpansionPrompt(context) {
    return `You are helping expand a TaskMaster task systematically.

PROJECT CONTEXT (gather comprehensively with parallel tools):
- Project: ${context.projectName || 'TaskMaster project'}
- Current working directory: ${process.cwd()}
- Task to expand: ID ${context.taskId}

TASK DETAILS:
${context.taskDetails}

ANALYSIS APPROACH:
1. Gather project context using parallel file reads and analysis
2. Create a mental todo list for this expansion  
3. Break down systematically considering:
   - Implementation complexity
   - Dependencies between subtasks
   - Testing and validation needs
   - Documentation requirements

GOAL: Provide ${context.numSubtasks || 4-6} well-structured subtasks with:
- Clear titles and descriptions
- Implementation details
- Testing strategies
- Realistic time estimates

Use your comprehensive analysis capabilities to ensure thorough coverage.`;
}
```

### 2. Context-Aware Prompt Enhancement

```javascript
async enhancePromptWithContext(basePrompt, context) {
    // Add cursor-agent specific optimizations
    const enhancements = [];
    
    // Encourage parallel tool usage
    if (context.needsFileAnalysis) {
        enhancements.push("Use parallel file reading to gather comprehensive project context before proceeding.");
    }
    
    // Leverage task management
    if (context.complexTask) {
        enhancements.push("Create an internal todo list to break down this complex operation systematically.");
    }
    
    // Add workspace context
    enhancements.push("You have full workspace context via --with-diffs. Use this to inform your analysis.");
    
    return `${enhancements.join(' ')}

${basePrompt}

Remember: Be thorough in your analysis, use parallel operations where possible, and provide detailed, actionable results.`;
}
```

### 3. Response Processing Improvements

```javascript
parseOptimizedResponse(cursorAgentOutput) {
    // cursor-agent may include additional context beyond our request
    // Parse more intelligently based on its communication patterns
    
    const result = JSON.parse(cursorAgentOutput);
    
    // Extract structured data if cursor-agent created internal todos
    if (result.result.includes('TODO:') || result.result.includes('PLAN:')) {
        return this.parseStructuredResponse(result);
    }
    
    return this.parseStandardResponse(result);
}
```

## Implementation Plan

### Phase 1: Prompt Optimization
- [ ] Implement `buildOptimizedPrompt` method
- [ ] Add operation-specific prompt builders
- [ ] Test with expand_task operations

### Phase 2: Context Enhancement  
- [ ] Add project context gathering
- [ ] Implement parallel tool usage hints
- [ ] Test with complex tasks

### Phase 3: Response Processing
- [ ] Improve JSON parsing robustness
- [ ] Extract additional context from responses
- [ ] Handle cursor-agent's natural language patterns

## Expected Benefits

1. **Better Results**: More comprehensive and contextual task expansions
2. **Faster Execution**: Leveraging cursor-agent's parallel processing
3. **Higher Reliability**: Working with cursor-agent's designed patterns
4. **Richer Context**: Taking advantage of full workspace awareness

## Testing Strategy

1. **A/B Testing**: Compare current vs optimized prompts
2. **Complex Task Testing**: Use challenging real-world tasks  
3. **Performance Monitoring**: Measure response quality and speed
4. **Edge Case Handling**: Test error scenarios and fallbacks

This optimization would significantly improve our cursor-agent integration by aligning with its internal architecture and capabilities.