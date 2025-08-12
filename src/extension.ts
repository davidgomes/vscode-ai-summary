import * as vscode from 'vscode';
import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';
import { createGroq } from '@ai-sdk/groq';

class SummaryViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'cursorSummaryView';
  private _view?: vscode.WebviewView;

  private _lastSummary: string = '';

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml(this._lastSummary);
  }

  setSummary(summary: string) {
    this._lastSummary = summary;
    if (this._view) {
      this._view.webview.postMessage({ type: 'summary', value: summary });
    }
  }

  private getHtml(initial: string): string {
    const escaped = initial
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    body { font-family: var(--vscode-font-family); padding: 8px; }
    .muted { color: var(--vscode-descriptionForeground); }
    pre { white-space: pre-wrap; word-wrap: break-word; }
  </style>
  <script>
    const vscode = acquireVsCodeApi();
    window.addEventListener('message', (e) => {
      const msg = e.data;
      if (msg.type === 'summary') {
        document.getElementById('summary').textContent = msg.value || '';
      } else if (msg.type === 'status') {
        document.getElementById('status').textContent = msg.value || '';
      }
    });
  </script>
  </head>
<body>
  <div id="status" class="muted"></div>
  <pre id="summary">${escaped}</pre>
</body>
</html>`;
  }
}

let debounceTimer: NodeJS.Timeout | undefined;
let currentCancellation: vscode.CancellationTokenSource | undefined;
let extensionContext: vscode.ExtensionContext | undefined;

const SECRET_STORAGE_KEY = 'aiSummary.groqApiKey';

async function getGroqApiKey(): Promise<string | undefined> {
  // Prefer Secret Storage
  if (extensionContext) {
    const secret = await extensionContext.secrets.get(SECRET_STORAGE_KEY);
    if (secret && secret.trim()) {
      return secret.trim();
    }
  }

  // Fallback to configuration setting
  const config = vscode.workspace.getConfiguration('aiSummary');
  const configured: string | undefined = config.get('groqApiKey');
  if (configured && configured.trim()) {
    return configured.trim();
  }

  // Fallback to environment variable
  const fromEnv = process.env.GROQ_API_KEY;
  if (fromEnv && fromEnv.trim()) {
    return fromEnv.trim();
  }

  return undefined;
}

async function summarizeSelection(text: string, view: SummaryViewProvider): Promise<void> {
  console.log('summarizeSelection', text);
  
  try {
    currentCancellation?.cancel();
    currentCancellation = new vscode.CancellationTokenSource();
    const token = currentCancellation.token;

    view.setSummary('');
    vscode.commands.executeCommand('setContext', 'cursorSummary.loading', true);

    const instruction = 'You are a concise assistant. Summarize the provided text in 1-3 bullet points, preserving key facts and terminology.';

    const apiKey = await getGroqApiKey();
    if (!apiKey) {
      vscode.window.showErrorMessage('Groq API key not set. Run "AI Summary: Register Groq API Key" to configure.');
      return;
    }

    const groq = createGroq({ apiKey });
    const model = groq('llama-3.1-8b-instant');
    
    const { textStream } = await streamText({
      model,
      system: instruction,
      prompt: `Heavily summarize this selection and return just the summmary, no other text:\n\n${text}`,
      temperature: 0.2,
    });
    
    console.log('textStream', textStream);

    let accumulated = '';
    for await (const part of textStream) {
      if (token.isCancellationRequested) { break; }
      accumulated += String(part);
      view.setSummary(accumulated);
    }
    view.setSummary(accumulated.trim());
  } catch (err: any) {
    view.setSummary(`Error: ${err?.message ?? String(err)}`);
  } finally {
    vscode.commands.executeCommand('setContext', 'cursorSummary.loading', false);
  }
}

export function activate(context: vscode.ExtensionContext) {
  extensionContext = context;
  const provider = new SummaryViewProvider();

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SummaryViewProvider.viewType, provider)
  );

  // Command: Register Groq API Key (stores in Secret Storage)
  context.subscriptions.push(
    vscode.commands.registerCommand('aiSummary.registerGroqApiKey', async () => {
      const value = await vscode.window.showInputBox({
        title: 'AI Summary: Register Groq API Key',
        prompt: 'Enter your Groq API key (stored securely in Secret Storage).',
        placeHolder: 'gsk_...'
        , password: true,
        ignoreFocusOut: true,
        validateInput: (val) => (val && val.trim().length > 0 ? undefined : 'API key cannot be empty')
      });
      if (!value) {
        return;
      }
      await context.secrets.store(SECRET_STORAGE_KEY, value.trim());
      vscode.window.showInformationMessage('Groq API key saved securely.');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('cursorSummary.refresh', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }
      const selection = editor.selection;
      if (selection.isEmpty) { return; }
      const text = editor.document.getText(selection);
      await summarizeSelection(text, provider);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('cursorSummary.copy', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }
      // Copy last summary by reading from visible view via command: retrieve isn't available, so keep local state
      // We already store last summary in provider
      await vscode.env.clipboard.writeText((provider as any)._lastSummary || '');
      vscode.window.showInformationMessage('Summary copied to clipboard');
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((e) => {
      const editor = e.textEditor;
      const selection = editor.selection;
      if (!editor || selection.isEmpty) {
        provider.setSummary('');
        return;
      }
      const text = editor.document.getText(selection);
      if (!text.trim()) {
        provider.setSummary('');
        return;
      }
      if (debounceTimer) { clearTimeout(debounceTimer); }
      debounceTimer = setTimeout(() => {
        void summarizeSelection(text, provider);
      }, 350);
    })
  );
}

export function deactivate() {
  currentCancellation?.cancel();
}


