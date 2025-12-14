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
	systemPrompt: string;
}

interface ChatMessage {
	role: 'user' | 'assistant' | 'system';
	content: string;
}

interface ChatContext {
	provider?: 'openai' | 'anthropic' | 'gemini';
	model?: string;
	system?: string;
}

const DEFAULT_SETTINGS: ChatPluginSettings = {
	selectedProvider: 'openai',
	openaiApiKey: '',
	openaiModel: 'gpt-5-mini',
	anthropicApiKey: '',
	anthropicModel: 'claude-3-opus-20240229',
	geminiApiKey: '',
	geminiModel: 'gemini-1.5-flash',
	debugMode: false,
	systemPrompt: `You are an intelligent assistant working within Obsidian. 
Your output should be formatted in Markdown. 
You can refer to other notes by using [[WikiLinks]].`
}

const PROJECT_TEMPLATE = `{{date}}

[[Project Chat]]
# Overview
## Description
Brief description of the project.
## Mission
Why are you working on this? This will help you make decisions.
## Directions
What are some ways to accomplish this project?
# Progress
## Tasks
- [ ] 

## General Notes`;

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

		this.addCommand({
			id: 'new-project',
			name: 'New Project',
			callback: () => {
				new NewProjectModal(this.app, (result) => {
					this.createProject(result);
				}).open();
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

	async createProject(projectName: string) {
		const folderName = `Project ${projectName}`;
		const fileName = `Project ${projectName}.md`;
		const folderPath = folderName;
		const filePath = `${folderPath}/${fileName}`;

		try {
			// Create folder
			if (!await this.app.vault.adapter.exists(folderPath)) {
				await this.app.vault.createFolder(folderPath);
			}

			// Prepare content
			let content = PROJECT_TEMPLATE;
			content = content.replace('[[Project Chat]]', `[[Project ${projectName}/Project ${projectName} - Chat]]`);

			// Replace {{date}} if we want to be nice, though strictly not requested, it's good practice.
			// Using basic ISO date for now.
			content = content.replace('{{date}}', new Date().toISOString().split('T')[0]);

			// Create file
			const file = await this.app.vault.create(filePath, content);

			// Open file
			const leaf = this.app.workspace.getLeaf(false);
			await leaf.openFile(file);

			new Notice(`Created project: ${projectName}`);

		} catch (error) {
			console.error('Failed to create project:', error);
			new Notice(`Error creating project: ${error.message}`);
		}
	}

	async handleChatCommand(editor: Editor, view: MarkdownView, writeMode: boolean = false) {
		const textToChat = editor.getValue();
		const overrides: ChatContext = {};

		if (!textToChat.trim()) {
			new Notice('No text found to chat with.');
			return;
		}

		const messages = this.parseMessages(textToChat);

		if (view.file) {
			// Add Note Title
			messages.unshift({
				role: 'user',
				content: `Note Title: ${view.file.basename}`
			});

			// Check for Frontmatter Overrides
			const cache = this.app.metadataCache.getFileCache(view.file);
			if (cache && cache.frontmatter) {
				const frontmatter = cache.frontmatter;
				if (frontmatter.provider) overrides.provider = frontmatter.provider;
				if (frontmatter.model) overrides.model = frontmatter.model;
				if (frontmatter.system) overrides.system = frontmatter.system;
			}

			// Add Project Context if applicable
			const projectContext = await this.getProjectContext(view.file);
			if (projectContext) {
				messages.unshift({
					role: 'user',
					content: `Project Context:\n${projectContext}`
				});
			}
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
			// Inject Tool Instructions
			if (!overrides.system) overrides.system = this.settings.systemPrompt;
			overrides.system += `\n\nYOU HAVE THE ABILITY TO CREATE OR APPEND TO NOTES.
Use this format: <create-note name="Note Title">Content to go in the note</create-note>
- If the note exists, content will be appended to the end.
- If not, it will be created.
- The tag will be replaced by a link [[Note Title]] in the chat.
- Do not markdown format the tag itself, just write it raw.`;

			let response = await this.callAI(messages, overrides);

			// Process Note Creation Tags
			if (view.file) {
				response = await this.processNoteCreation(response, view.file);
			}

			const modelNameDisplay = overrides.model || this.getModelName(overrides.provider || this.settings.selectedProvider);
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

	async processNoteCreation(text: string, currentFile: TFile): Promise<string> {
		const regex = /<create-note name="([^"]+)">([\s\S]*?)<\/create-note>/g;
		let match;
		const findings = [];

		// Find all matches first to avoid issues while modifying string
		while ((match = regex.exec(text)) !== null) {
			findings.push({
				fullMatch: match[0],
				name: match[1],
				content: match[2]
			});
		}

		let processedText = text;

		for (const item of findings) {
			const { fullMatch, name, content } = item;

			// Determine path: same folder as current file
			const parentPath = currentFile.parent ? currentFile.parent.path : '/';
			const fileName = `${name}.md`;
			const filePath = parentPath === '/' ? fileName : `${parentPath}/${fileName}`;

			try {
				const existingFile = this.app.vault.getAbstractFileByPath(filePath);

				if (existingFile instanceof TFile) {
					// Append
					await this.app.vault.append(existingFile, `\n${content}`);
					new Notice(`Appended to ${fileName}`);
				} else {
					// Create
					await this.app.vault.create(filePath, content);
					new Notice(`Created ${fileName}`);
				}

				// Replace the tag with a link
				processedText = processedText.replace(fullMatch, `[[${name}]]`);

			} catch (err) {
				console.error(`Failed to handle note ${name}:`, err);
				new Notice(`Failed to write note ${name}`);
			}
		}

		return processedText;
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

	async getProjectContext(currentFile: TFile): Promise<string> {
		if (!currentFile.basename.startsWith('Project ')) {
			return '';
		}

		const parent = currentFile.parent;
		if (!parent) return '';

		let context = '';

		for (const child of parent.children) {
			if (child instanceof TFile) {
				// skip current file
				if (child.basename === currentFile.basename || child.path === currentFile.path) continue;

				// skip non-text files
				if (child.extension !== 'md' && child.extension !== 'txt') continue;

				const content = await this.app.vault.read(child);
				context += `\n<existing-note name="${child.basename}">\n${content}\n</existing-note>\n`;
			}
		}

		return context;
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
				modifiedContent += `\n<existing-note name="${destFile.basename}">${fileContent}\n</existing-note>\n`;
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

	async callAI(messages: ChatMessage[], overrides?: ChatContext): Promise<string> {
		const provider = overrides?.provider || this.settings.selectedProvider;

		if (!overrides) overrides = {};

		const overwriteDefaultPrompt = overrides.system && overrides.system.startsWith('+++');
		if (overrides.system && overwriteDefaultPrompt) {
			// Append mode: Remove the +++ and append to default
			const appendContent = overrides.system.substring(3).trim();
			overrides.system = `${this.settings.systemPrompt}\n${appendContent}`;
		} else if (!overrides.system && this.settings.systemPrompt) {
			// Fallback to default if no override
			overrides.system = this.settings.systemPrompt;
		}

		if (provider === 'openai') {
			return this.callOpenAI(messages, overrides);
		} else if (provider === 'anthropic') {
			return this.callAnthropic(messages, overrides);
		} else if (provider === 'gemini') {
			return this.callGemini(messages, overrides);
		} else {
			throw new Error('Unknown provider selected.');
		}
	}

	async callOpenAI(messages: ChatMessage[], overrides?: ChatContext): Promise<string> {
		if (!this.settings.openaiApiKey) throw new Error('OpenAI API Key not set.');

		const model = overrides?.model || this.settings.openaiModel;
		const messagesToSend = [...messages];

		if (overrides?.system) {
			messagesToSend.unshift({ role: 'system', content: overrides.system });
		}

		const requestBody = {
			model: model,
			messages: messagesToSend
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

	async callAnthropic(messages: ChatMessage[], overrides?: ChatContext): Promise<string> {
		if (!this.settings.anthropicApiKey) throw new Error('Anthropic API Key not set.');

		const model = overrides?.model || this.settings.anthropicModel;

		const requestBody: any = {
			model: model,
			max_tokens: 1024,
			messages: messages
		};

		if (overrides?.system) {
			requestBody.system = overrides.system;
		}

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

	async callGemini(messages: ChatMessage[], overrides?: ChatContext): Promise<string> {
		if (!this.settings.geminiApiKey) throw new Error('Gemini API Key not set.');

		const model = overrides?.model || this.settings.geminiModel;
		const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.settings.geminiApiKey}`;

		const contents = messages.map(msg => ({
			role: msg.role === 'assistant' ? 'model' : 'user',
			parts: [{ text: msg.content }]
		}));

		const requestBody: any = {
			contents: contents
		};

		if (overrides?.system) {
			requestBody.systemInstruction = {
				parts: [{ text: overrides.system }]
			};
		}

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

class NewProjectModal extends Modal {
	result: string;
	onSubmit: (result: string) => void;

	constructor(app: App, onSubmit: (result: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;

		contentEl.createEl('h2', { text: 'New Project' });

		new Setting(contentEl)
			.setName('Project Name')
			.setDesc('Enter the name of your new project')
			.addText(text => text
				.onChange((value) => {
					this.result = value;
				}));

		new Setting(contentEl)
			.addButton(btn => btn
				.setButtonText('Create')
				.setCta()
				.onClick(() => {
					this.close();
					this.onSubmit(this.result);
				}));
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
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
			.setName('System Prompt')
			.setDesc('Global system prompt for the AI behavior.')
			.addTextArea(text => text
				.setPlaceholder('You are a helpful assistant...')
				.setValue(this.plugin.settings.systemPrompt)
				.onChange(async (value) => {
					this.plugin.settings.systemPrompt = value;
					await this.plugin.saveSettings();
				}));

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