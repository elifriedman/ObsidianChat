import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, requestUrl, RequestUrlParam, TFile } from 'obsidian';

interface ChatPluginSettings {
	selectedProvider: 'openai' | 'anthropic' | 'gemini';
	openaiApiKey: string;
	openaiModel: string;
	anthropicApiKey: string;
	anthropicModel: string;
	geminiApiKey: string;
	geminiModel: string;
	debugMode: boolean;
}

interface ChatMessage {
	role: 'user' | 'assistant';
	content: string;
}

const DEFAULT_SETTINGS: ChatPluginSettings = {
	selectedProvider: 'openai',
	openaiApiKey: '',
	openaiModel: 'gpt-5-mini',
	anthropicApiKey: '',
	anthropicModel: 'claude-3-opus-20240229',
	geminiApiKey: '',
	geminiModel: 'gemini-1.5-flash',
	debugMode: false
}

export default class ChatPlugin extends Plugin {
	settings: ChatPluginSettings;

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: 'chat-with-ai',
			name: 'Chat with AI',
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				await this.handleChatCommand(editor, view);
			}
		});

		this.addCommand({
			id: 'write-with-ai',
			name: 'Write with AI',
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				await this.handleChatCommand(editor, view, true);
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

	async handleChatCommand(editor: Editor, view: MarkdownView, writeMode: boolean = false) {
		const textToChat = editor.getValue();

		if (!textToChat.trim()) {
			new Notice('No text found to chat with.');
			return;
		}

		const messages = this.parseMessages(textToChat);

		if (view.file) {
			messages.unshift({
				role: 'user',
				content: `Note Title: ${view.file.basename}`
			});
		}

		// Process links in messages
		for (const msg of messages) {
			if (msg.role === 'user' && view.file) {
				msg.content = await this.processMessageLinks(msg.content, view.file);
			}
		}

		new Notice(`Asking ${this.settings.selectedProvider}...`);
		this.log('Sending messages to AI:', messages);

		try {
			const response = await this.callAI(messages);

			const modelNameDisplay = this.getModelName(this.settings.selectedProvider);
			let replyText = '';

			if (writeMode) {
				replyText = `\n${response}\n`;
			} else {
				replyText = `\n___\nai::${modelNameDisplay}\n${response}\n___\n`;
			}

			// Append to end of file
			const lineCount = editor.lineCount();
			editor.replaceRange(replyText, { line: lineCount, ch: 0 });

		} catch (error) {
			console.error('AI Chat Error:', error);
			new Notice(`Error: ${error.message} `);
		}
	}

	parseMessages(text: string): ChatMessage[] {
		// Split by any sequence of 3 or more underscores, allowing optional spaces between them
		// Regex explanation:
		// _       match an underscore
		// \s*     match zero or more whitespace characters
		// (?: ... ) non-capturing group
		// {2,}    match the previous group 2 or more times (so total 3+ underscores)
		const parts = text.split(/_(?:\s*_){2,}/);
		const messages: ChatMessage[] = [];

		for (let part of parts) {
			part = part.trim();
			if (!part) continue;

			let isAssistant = false;
			let content = part;

			// Check for ai:: prefix
			if (part.contains('ai::')) {
				isAssistant = true;
				// Remove the ai::Line identifier
				// We expect the format "ai::ModelName\nContent"
				const newlineIndex = part.indexOf('\n');
				if (newlineIndex > 0) {
					content = part.substring(newlineIndex + 1).trim();
				} else {
					// strip from the ai:: until the first nontext character
					content = part.replace(/^ai::.*?[^\w]/, '').trim();
				}
			}

			messages.push({
				role: isAssistant ? 'assistant' : 'user',
				content: content
			});
		}

		return messages;
	}

	async processMessageLinks(content: string, sourceFile: TFile): Promise<string> {
		let modifiedContent = content;

		// Regex for WikiLinks: [[Link]] or [[Link|Alias]]
		const wikiLinkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

		// Regex for Markdown links: [Text](Path)
		const mdLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;

		const matches: { path: string, match: string }[] = [];

		let match;
		while ((match = wikiLinkRegex.exec(content)) !== null) {
			matches.push({ path: match[1], match: match[0] });
		}
		while ((match = mdLinkRegex.exec(content)) !== null) {
			matches.push({ path: match[2], match: match[0] });
		}

		for (const m of matches) {
			const linkpath = m.path;
			const destFile = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourceFile.path);

			if (destFile instanceof TFile && (destFile.extension === 'md' || destFile.extension === 'txt')) {
				const fileContent = await this.app.vault.read(destFile);

				// Append content to the block
				modifiedContent += `\n--- Content of ${destFile.basename} ---\n${fileContent}\n--- End of ${destFile.basename} ---\n`;
			}
		}

		return modifiedContent;
	}

	getModelName(provider: string): string {
		switch (provider) {
			case 'openai': return this.settings.openaiModel;
			case 'anthropic': return this.settings.anthropicModel;
			case 'gemini': return this.settings.geminiModel;
			default: return 'unknown';
		}
	}

	async callAI(messages: ChatMessage[]): Promise<string> {
		const provider = this.settings.selectedProvider;

		if (provider === 'openai') {
			return this.callOpenAI(messages);
		} else if (provider === 'anthropic') {
			return this.callAnthropic(messages);
		} else if (provider === 'gemini') {
			return this.callGemini(messages);
		} else {
			throw new Error('Unknown provider selected.');
		}
	}

	async callOpenAI(messages: ChatMessage[]): Promise<string> {
		if (!this.settings.openaiApiKey) throw new Error('OpenAI API Key not set.');

		const requestBody = {
			model: this.settings.openaiModel,
			messages: messages
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

	async callAnthropic(messages: ChatMessage[]): Promise<string> {
		if (!this.settings.anthropicApiKey) throw new Error('Anthropic API Key not set.');

		const requestBody = {
			model: this.settings.anthropicModel,
			max_tokens: 1024,
			messages: messages
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

	async callGemini(messages: ChatMessage[]): Promise<string> {
		if (!this.settings.geminiApiKey) throw new Error('Gemini API Key not set.');

		const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.settings.geminiModel}:generateContent?key=${this.settings.geminiApiKey}`;

		const contents = messages.map(msg => ({
			role: msg.role === 'assistant' ? 'model' : 'user',
			parts: [{ text: msg.content }]
		}));

		const requestBody = {
			contents: contents
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
	log(message: string, ...args: any[]) {
		if (this.settings.debugMode) {
			console.log(message, ...args);
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
		new Setting(containerEl)
			.setName('Debug Mode')
			.setDesc('Enable debug logging in console.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.debugMode)
				.onChange(async (value) => {
					this.plugin.settings.debugMode = value;
					await this.plugin.saveSettings();
				}));
	}
}