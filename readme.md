## AI Summary

This VSCode extension continuously summarizes whatever text you're highlighting in VSCode/Cursor in your sidebar.

![Demo](./demo_video.gif)

## Requirements
- A Groq API key

## Setup
1. Install the extension
2. Register your Groq API key securely:
   - Open the Command Palette and run: `AI Summary: Register Groq API Key`
   - Paste your key (e.g., `gsk_...`) and press Enter

### Commands
- `aiSummary.groqApiKey`: Registers the Groq API key to be used for summarization
- `aiSummary.copy`: Copies the currently generated summary to the clipboard
