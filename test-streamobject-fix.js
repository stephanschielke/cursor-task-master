import { TestMCPClient } from './test-mcp-client.js';

async function testStreamObjectFix() {
	const client = new TestMCPClient();

	try {
		await client.connect();
		console.log('\n🎯 Testing streamObject fix with a simple PRD...');

		// Create a test PRD file first
		console.log('📝 Creating test PRD...');
		await client.callTool('initialize_project', {
			projectName: 'test-streamobject',
			projectRoot: '/tmp/test-cursor-agent-fix',
			yes: true
		});

		// Now test parse_prd with a simple request
		console.log('📋 Testing parse_prd with cursor-agent...');
		const result = await client.callTool('add_task', {
			projectRoot: '/tmp/test-cursor-agent-fix',
			prompt: 'Create a simple web server task'
		});

		console.log('📊 Result:', result);
	} catch (error) {
		console.error('💥 Test failed:', error);
	} finally {
		await client.close();
	}
}

testStreamObjectFix();
