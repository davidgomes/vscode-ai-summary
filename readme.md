## AI Summary

Summarize selected text in VS Code using Groq models and view the result in a sidebar.

### Features
- Summarize any selection with streaming output
- Sidebar view to show the latest summary
- Copy summary to clipboard

### Requirements
- A Groq API key

### Setup
1. Install the extension
2. Register your Groq API key securely:
   - Open the Command Palette and run: `AI Summary: Register Groq API Key`
   - Paste your key (e.g., `gsk_...`) and press Enter

Alternative configuration methods (less preferred):
- Set the `GROQ_API_KEY` environment variable
- Set `aiSummary.groqApiKey` in settings (note: not stored securely)

### Usage
- Select some text in an editor
- The "Summary" sidebar updates automatically, or you can run `Summary: Refresh`
- Use `Summary: Copy to Clipboard` to copy the latest summary

### Commands
- `AI Summary: Register Groq API Key` — store your Groq API key in VS Code Secret Storage
- `Summary: Refresh` — force refresh the summary of the current selection
- `Summary: Copy to Clipboard` — copy the latest summary

### Configuration
- `aiSummary.groqApiKey` (string): Optional. Prefer using the command to store securely
