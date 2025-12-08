import {
	isApiKeySet,
	CUSTOM_PROVIDERS,
	getCursorCliSettings,
	getCursorCliSettingsForCommand
} from '../../../../scripts/modules/config-manager.js';

describe('Cursor CLI config', () => {
	test('cursor-cli is treated as no-key provider', () => {
		expect(isApiKeySet(CUSTOM_PROVIDERS.CURSOR_CLI)).toBe(true);
	});

	test('cursor-cli settings expose defaults and per-command overrides', () => {
		const settings = getCursorCliSettings(process.cwd(), true);
		expect(settings.command).toBeDefined();
		const commandSettings = getCursorCliSettingsForCommand(
			'generateText',
			process.cwd(),
			true
		);
		expect(commandSettings.command).toBeDefined();
	});
});
