# LLM Chat for Obsidian

Chat with AI models like OpenAI, Claude, and Gemini directly within your Obsidian notes.

## Features

- **Multi-Provider Support**: Choose between OpenAI (GPT), Anthropic (Claude), and Google (Gemini).
- **Context-Aware**: The AI can read the current note, linked notes via `[[WikiLinks]]`, and other notes within the same project folder.
- **Native Experience**: Chat directly in your editor. No separate sidebars or windows needed.
- **Tool Use**: The AI can create or append to other notes automatically based on its response.
- **Project Templating**: Easily bootstrap new project structures with dedicated overview and chat notes.

## Commands

### Chat with AI
The primary command for interaction.
- **What it does**: Parses the current note as a conversation and appends the AI's response.
- **Conversation Format**: Use three or more underscores (`___`) to separate messages. The plugin automatically distinguishes between your text and AI responses (marked with `ai::`).
- **Context Management**: 
    - Automatically includes the content of any notes linked via `[[WikiLinks]]` or `[Markdown Links]()` in your current message.
    - If the note is within a "Project" folder (starts with `Project `), it automatically includes all other notes in that folder as context.

### Write with AI
Similar to "Chat with AI" but optimized for inline content generation and editing.
- **What it does**: 
    - **Selection Replacement**: If you highlight text, the AI's response will replace the selection.
    - **Cursor Insertion**: If no text is selected, the AI's response is inserted exactly at your cursor position.
- **Smart Context**: The AI is provided with the text immediately before and after your cursor, allowing it to maintain style, tone, and flow.
- **Best for**: Drafting articles, expanding on ideas, rewriting sentences, or refining existing text without adding chat formatting.

### New Project
Helps you organize your work into structured projects.
- **What it does**: Prompts for a project name and creates:
    - A folder named `Project [Name]`
    - An `Overview` note based on a template (Goals, Tasks, etc.)
    - A `Chat` note for focused brainstorms related to the project.

## How to Use

1. **Configure Settings**: Go to Settings > LLM Chat. Select your provider and enter your API Key.
2. **Standard Chat**: Write your prompt in a note and run **"Chat with AI"** from the Command Palette (`Cmd/Ctrl + P`).
3. **Using Links**: Link to other notes like `[[References]]` in your prompt to "show" them to the AI.
4. **Project Mode**: Use **"New Project"** to keep complex tasks organized.

## Installation

1. Copy `main.js`, `styles.css`, and `manifest.json` to your vault's plugin folder: `.obsidian/plugins/obsidian-llm-chat/`.
2. Reload Obsidian.
3. Enable "LLM Chat" in Community Plugins.

## Development

1. Clone this repo.
2. Run `npm i` to install dependencies.
3. Run `npm run dev` to start compilation in watch mode.

