import { TestMCPClient } from './test-mcp-client.js';

async function debugCursorAgent() {
	const client = new TestMCPClient();

	try {
		await client.connect();

		console.log('\n🔧 Testing cursor-agent provider configuration...');

		// First check if cursor-agent is configured properly
		const modelsResult = await client.callTool('models', {
			projectRoot:
				process.env.TEST_INTROPY_PROJECT_ROOT || '/tmp/test-intropy-ai-mcp'
		});

		console.log('📊 Models configuration:', modelsResult);

		console.log('\n🎯 Now testing PRD parsing with full debug info...');

		// Test PRD parsing with the actual project
		const prdResult = await client.callTool('parse_prd', {
			projectRoot:
				process.env.TEST_INTROPY_PROJECT_ROOT || '/tmp/test-intropy-ai-mcp',
			input: '.taskmaster/docs/intropy-ai-mcp-prd.txt',
			numTasks: '3', // Smaller number for testing
			research: false, // Disable research to simplify
			force: true
		});

		console.log('📊 PRD parsing result:', JSON.stringify(prdResult, null, 2));

		// Check if tasks were created
		const tasksResult = await client.callTool('get_tasks', {
			projectRoot:
				process.env.TEST_INTROPY_PROJECT_ROOT || '/tmp/test-intropy-ai-mcp'
		});

		console.log('📋 Tasks after parsing:', tasksResult);
	} catch (error) {
		console.error('💥 Debug test failed:', error);
	} finally {
		await client.close();
	}
}

debugCursorAgent();
