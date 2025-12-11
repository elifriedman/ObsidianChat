# LLM Chat for Obsidian

Chat with AI models like OpenAI, Claude, and Gemini directly within your Obsidian notes.

## Features

- **Multi-Provider Support**: Choose between OpenAI (GPT), Anthropic (Claude), and Google (Gemini).
- **Direct Integration**: Chat directly in your editor. The AI reads the current note and appends its response.
- **Customizable**: Configure models and API keys in settings.

## How to Use

1. **Configure Settings**: Go to Settings > LLM Chat. Select your provider and enter your API Key.
2. **Type your prompt**: Write your question or prompt in an Obsidian note.
3. **Run Command**: Open the Command Palette (`Cmd/Ctrl + P`) and run **"Chat with AI"**.
4. **Get Response**: The AI's response will be appended to the bottom of your current note.

## Installation

1. Copy `main.js`, `styles.css`, and `manifest.json` to your vault's plugin folder: `.obsidian/plugins/obsidian-llm-chat/`.
2. Reload Obsidian.
3. Enable "LLM Chat" in Community Plugins.

## Development

1. Clone this repo.
2. Run `npm i` to install dependencies.
3. Run `npm run dev` to start compilation in watch mode.
