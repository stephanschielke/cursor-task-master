import { TestMCPClient } from './test-mcp-client.js';

async function finalCursorAgentTest() {
	const client = new TestMCPClient();

	try {
		await client.connect();

		console.log('🔧 Verifying cursor-agent is now configured...');

		// Check model configuration
		const config = await client.callTool('models', {
			projectRoot:
				process.env.TEST_INTROPY_PROJECT_ROOT || '/tmp/test-intropy-ai-mcp'
		});

		if (config.content[0].text.includes('cursor-agent')) {
			console.log('✅ cursor-agent is configured!');
		} else {
			console.log('❌ cursor-agent not detected in config');
		}

		console.log('\n🚀 TESTING PRD PARSING WITH CURSOR-AGENT PROVIDER');
		console.log('='.repeat(60));

		// Now test PRD parsing with cursor-agent
		const result = await client.callTool('parse_prd', {
			projectRoot:
				process.env.TEST_INTROPY_PROJECT_ROOT || '/tmp/test-intropy-ai-mcp',
			input: '.taskmaster/docs/intropy-ai-mcp-prd.txt',
			numTasks: '5',
			research: false, // Start without research to simplify
			force: true
		});

		console.log('📊 PRD Parsing Result:');
		console.log(JSON.stringify(result, null, 2));

		if (result.isError) {
			console.log('❌ PRD parsing failed, error:', result.content[0].text);
		} else {
			console.log('✅ PRD parsing succeeded!');

			// Check if tasks were created
			const tasks = await client.callTool('get_tasks', {
				projectRoot:
					process.env.TEST_INTROPY_PROJECT_ROOT || '/tmp/test-intropy-ai-mcp'
			});

			console.log('📋 Tasks created:', tasks);
		}
	} catch (error) {
		console.error('💥 Final test failed:', error);
	} finally {
		await client.close();
	}
}

finalCursorAgentTest();
