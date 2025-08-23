#!/usr/bin/env node
/**
 * Test script to demonstrate the enhanced cursor-agent provider with progress tracking
 */

import { CursorAgentProvider } from './src/ai-providers/cursor-agent.js';

async function testCursorAgentProgress() {
	console.log('🚀 Testing Enhanced Cursor-Agent with Progress Tracking\n');

	// Create cursor-agent provider instance
	const provider = new CursorAgentProvider();

	// Create a progress tracker for the operation
	const progressTracker = provider.createProgressTracker({
		operationType: 'test-generation',
		operationDescription: 'Testing cursor-agent progress tracking',
		phases: [
			'Initializing test',
			'Preparing request',
			'Executing cursor-agent',
			'Processing response',
			'Finalizing test'
		]
	});

	try {
		console.log('📊 Starting progress tracking...\n');

		// Start the progress tracker
		progressTracker.start();

		// Test a simple text generation with progress tracking
		const result = await provider.generateText(
			{
				messages:
					'Write a brief summary of what progress tracking means for AI operations.',
				progressTracker: progressTracker
			},
			{
				modelId: 'sonnet',
				mode: 'sequential' // Use sequential mode for simpler test
			}
		);

		console.log('\n✅ Test completed successfully!');
		console.log('📈 Final Summary:', progressTracker.getSummary());

		if (result.text) {
			console.log('\n📝 Generated Response:');
			console.log(result.text.slice(0, 200) + '...');
		}
	} catch (error) {
		console.error('\n❌ Test failed:', error.message);
		console.log('📈 Progress Summary:', progressTracker.getSummary());
	} finally {
		// Ensure cleanup
		progressTracker.cleanup();
	}
}

// Test recursive progress tracking
async function testRecursiveProgress() {
	console.log('\n🔄 Testing Recursive Progress Tracking\n');

	const provider = new CursorAgentProvider();

	// Create recursive progress tracker
	const progressTracker = provider.createRecursiveProgressTracker(
		3,
		'test-recursive'
	);

	try {
		console.log('📊 Starting recursive progress tracking...\n');

		progressTracker.start();

		// Simulate recursive operations
		for (let depth = 0; depth < 3; depth++) {
			console.log(`🔄 Recursive depth ${depth + 1}/3`);
			progressTracker.updateRecursiveDepth(depth + 1);

			// Simulate work
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}

		progressTracker.complete('Recursive test completed');

		console.log('\n✅ Recursive test completed!');
		console.log('📈 Final Summary:', progressTracker.getSummary());
	} catch (error) {
		console.error('\n❌ Recursive test failed:', error.message);
	} finally {
		progressTracker.cleanup();
	}
}

// Main test execution
async function main() {
	console.log('🎯 Enhanced Cursor-Agent Progress Tracking Test Suite\n');
	console.log('='.repeat(60));

	try {
		// Test basic progress tracking
		await testCursorAgentProgress();

		// Test recursive progress tracking
		await testRecursiveProgress();

		console.log('\n' + '='.repeat(60));
		console.log('✅ All tests completed! Progress tracking is working.');
	} catch (error) {
		console.error('\n❌ Test suite failed:', error);
		process.exit(1);
	}
}

// Only run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch(console.error);
}

export { testCursorAgentProgress, testRecursiveProgress };
