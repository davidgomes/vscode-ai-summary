import * as vscode from 'vscode';

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

async function summarizeSelection(text: string, view: SummaryViewProvider): Promise<void> {
  try {
    currentCancellation?.cancel();
    currentCancellation = new vscode.CancellationTokenSource();
    const token = currentCancellation.token;

    view.setSummary('');
    vscode.commands.executeCommand('setContext', 'cursorSummary.loading', true);

    const instruction = 'You are a concise assistant. Summarize the provided text in 2-4 bullet points, preserving key facts and terminology.';

    // VS Code Language Model API (Cursor provider, auto family)
    const models = await vscode.lm.selectChatModels({ vendor: 'cursor', family: 'auto' });
    if (!models || models.length === 0) {
      view.setSummary('No Cursor chat models available. Ensure Cursor is installed and signed in.');
      return;
    }
    const model = models[0];

    const messages: vscode.LanguageModelChatMessage[] = [
      vscode.LanguageModelChatMessage.User(`${instruction}\n\nSummarize this selection:\n\n${text}`)
    ];

    const response = await model.sendRequest(
      messages,
      {
        justification: 'Summarize highlighted text',
        modelOptions: { temperature: 0.2, topK: 40 }
      },
      token
    );

    let accumulated = '';
    for await (const chunk of response.text) {
      accumulated += chunk;
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
  const provider = new SummaryViewProvider();

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SummaryViewProvider.viewType, provider)
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


