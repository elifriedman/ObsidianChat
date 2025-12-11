import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, requestUrl, RequestUrlParam } from 'obsidian';

interface ChatPluginSettings {
	selectedProvider: 'openai' | 'anthropic' | 'gemini';
	openaiApiKey: string;
	openaiModel: string;
	anthropicApiKey: string;
	anthropicModel: string;
	geminiApiKey: string;
	geminiModel: string;
}

const DEFAULT_SETTINGS: ChatPluginSettings = {
	selectedProvider: 'openai',
	openaiApiKey: '',
	openaiModel: 'gpt-3.5-turbo',
	anthropicApiKey: '',
	anthropicModel: 'claude-3-opus-20240229',
	geminiApiKey: '',
	geminiModel: 'gemini-1.5-flash'
}

export default class ChatPlugin extends Plugin {
	settings: ChatPluginSettings;

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: 'chat-with-ai',
			name: 'Chat with AI',
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				await this.handleChatCommand(editor);
			}
		});

		this.addSettingTab(new ChatSettingTab(this.app, this));
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async handleChatCommand(editor: Editor) {
		const textToChat = editor.getValue();

		if (!textToChat.trim()) {
			new Notice('No text found to chat with.');
			return;
		}

		new Notice(`Asking ${this.settings.selectedProvider}...`);

		try {
			const response = await this.callAI(textToChat);

			const modelNameDisplay = this.getModelName(this.settings.selectedProvider);
			const replyText = `\n\n-- -\n${modelNameDisplay}: ${response} \n-- -\n`;

			// Append to end of file
			const lineCount = editor.lineCount();
			editor.replaceRange(replyText, { line: lineCount, ch: 0 });

		} catch (error) {
			console.error('AI Chat Error:', error);
			new Notice(`Error: ${error.message} `);
		}
	}

	getModelName(provider: string): string {
		switch (provider) {
			case 'openai': return this.settings.openaiModel;
			case 'anthropic': return this.settings.anthropicModel;
			case 'gemini': return this.settings.geminiModel;
			default: return 'unknown';
		}
	}

	async callAI(text: string): Promise<string> {
		const provider = this.settings.selectedProvider;

		if (provider === 'openai') {
			return this.callOpenAI(text);
		} else if (provider === 'anthropic') {
			return this.callAnthropic(text);
		} else if (provider === 'gemini') {
			return this.callGemini(text);
		} else {
			throw new Error('Unknown provider selected.');
		}
	}

	async callOpenAI(text: string): Promise<string> {
		if (!this.settings.openaiApiKey) throw new Error('OpenAI API Key not set.');

		const requestBody = {
			model: this.settings.openaiModel,
			messages: [{ role: 'user', content: text }]
		};

		const response = await requestUrl({
			url: 'https://api.openai.com/v1/chat/completions',
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.settings.openaiApiKey} `
			},
			body: JSON.stringify(requestBody)
		});

		if (response.status >= 400) {
			throw new Error(`OpenAI request failed: ${response.status} ${response.text} `);
		}

		const data = response.json;
		return data.choices[0].message.content;
	}

	async callAnthropic(text: string): Promise<string> {
		if (!this.settings.anthropicApiKey) throw new Error('Anthropic API Key not set.');

		const requestBody = {
			model: this.settings.anthropicModel,
			max_tokens: 1024,
			messages: [{ role: 'user', content: text }]
		};

		const response = await requestUrl({
			url: 'https://api.anthropic.com/v1/messages',
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': this.settings.anthropicApiKey,
				'anthropic-version': '2023-06-01'
			},
			body: JSON.stringify(requestBody)
		});

		if (response.status >= 400) {
			throw new Error(`Anthropic request failed: ${response.status} ${response.text} `);
		}

		const data = response.json;
		return data.content[0].text;
	}

	async callGemini(text: string): Promise<string> {
		if (!this.settings.geminiApiKey) throw new Error('Gemini API Key not set.');

		const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.settings.geminiModel}:generateContent?key=${this.settings.geminiApiKey}`;

		const requestBody = {
			contents: [{
				parts: [{ text: text }]
			}]
		};

		const response = await requestUrl({
			url: url,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(requestBody)
		});

		if (response.status >= 400) {
			throw new Error(`Gemini request failed: ${response.status} ${response.text}`);
		}

		const data = response.json;
		// Gemini response structure
		// candidates[0].content.parts[0].text
		if (data.candidates && data.candidates.length > 0 && data.candidates[0].content && data.candidates[0].content.parts) {
			return data.candidates[0].content.parts[0].text;
		} else {
			return "(No response text found)";
		}
	}
}

class ChatSettingTab extends PluginSettingTab {
	plugin: ChatPlugin;

	constructor(app: App, plugin: ChatPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('AI Provider')
			.setDesc('Select which AI provider to use.')
			.addDropdown(dropdown => dropdown
				.addOption('openai', 'OpenAI')
				.addOption('anthropic', 'Anthropic')
				.addOption('gemini', 'Google Gemini')
				.setValue(this.plugin.settings.selectedProvider)
				.onChange(async (value) => {
					this.plugin.settings.selectedProvider = value as 'openai' | 'anthropic' | 'gemini';
					await this.plugin.saveSettings();
					this.display();
				}));

		if (this.plugin.settings.selectedProvider === 'openai') {
			new Setting(containerEl)
				.setName('OpenAI API Key')
				.setDesc('Required for OpenAI')
				.addText(text => text
					.setPlaceholder('sk-...')
					.setValue(this.plugin.settings.openaiApiKey)
					.onChange(async (value) => {
						this.plugin.settings.openaiApiKey = value;
						await this.plugin.saveSettings();
					}));

			new Setting(containerEl)
				.setName('OpenAI Model')
				.setDesc('e.g. gpt-3.5-turbo, gpt-4')
				.addText(text => text
					.setPlaceholder('gpt-3.5-turbo')
					.setValue(this.plugin.settings.openaiModel)
					.onChange(async (value) => {
						this.plugin.settings.openaiModel = value;
						await this.plugin.saveSettings();
					}));
		}

		if (this.plugin.settings.selectedProvider === 'anthropic') {
			new Setting(containerEl)
				.setName('Anthropic API Key')
				.setDesc('Required for Anthropic')
				.addText(text => text
					.setPlaceholder('sk-ant-...')
					.setValue(this.plugin.settings.anthropicApiKey)
					.onChange(async (value) => {
						this.plugin.settings.anthropicApiKey = value;
						await this.plugin.saveSettings();
					}));

			new Setting(containerEl)
				.setName('Anthropic Model')
				.setDesc('e.g. claude-3-opus-20240229')
				.addText(text => text
					.setPlaceholder('claude-3-opus-20240229')
					.setValue(this.plugin.settings.anthropicModel)
					.onChange(async (value) => {
						this.plugin.settings.anthropicModel = value;
						await this.plugin.saveSettings();
					}));
		}

		if (this.plugin.settings.selectedProvider === 'gemini') {
			new Setting(containerEl)
				.setName('Gemini API Key')
				.setDesc('Required for Gemini')
				.addText(text => text
					.setPlaceholder('AIza...')
					.setValue(this.plugin.settings.geminiApiKey)
					.onChange(async (value) => {
						this.plugin.settings.geminiApiKey = value;
						await this.plugin.saveSettings();
					}));

			new Setting(containerEl)
				.setName('Gemini Model')
				.setDesc('e.g. gemini-1.5-flash')
				.addText(text => text
					.setPlaceholder('gemini-1.5-flash')
					.setValue(this.plugin.settings.geminiModel)
					.onChange(async (value) => {
						this.plugin.settings.geminiModel = value;
						await this.plugin.saveSettings();
					}));
		}
	}
}