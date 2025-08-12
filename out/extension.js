"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const ai_1 = require("ai");
const groq_1 = require("@ai-sdk/groq");
class SummaryViewProvider {
    constructor() {
        this._lastSummary = '';
    }
    resolveWebviewView(webviewView, _context, _token) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this.getHtml(this._lastSummary);
    }
    setSummary(summary) {
        this._lastSummary = summary;
        if (this._view) {
            this._view.webview.postMessage({ type: 'summary', value: summary });
        }
    }
    getHtml(initial) {
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
SummaryViewProvider.viewType = 'cursorSummaryView';
let debounceTimer;
let currentCancellation;
async function summarizeSelection(text, view) {
    console.log('summarizeSelection', text);
    try {
        currentCancellation?.cancel();
        currentCancellation = new vscode.CancellationTokenSource();
        const token = currentCancellation.token;
        view.setSummary('');
        vscode.commands.executeCommand('setContext', 'cursorSummary.loading', true);
        const instruction = 'You are a concise assistant. Summarize the provided text in 2-4 bullet points, preserving key facts and terminology.';
        // const openai = createOpenAI({ apiKey: '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' });
        const groq = (0, groq_1.createGroq)({ apiKey: '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' });
        const model = groq('llama-3.1-8b-instant');
        console.log("text", text);
        const { textStream } = await (0, ai_1.streamText)({
            model,
            system: instruction,
            prompt: `Heavily summarize this selection and return just the summmary, no other text:\n\n${text}`,
            temperature: 0.2,
        });
        console.log('textStream', textStream);
        let accumulated = '';
        for await (const part of textStream) {
            if (token.isCancellationRequested) {
                break;
            }
            accumulated += String(part);
            view.setSummary(accumulated);
        }
        view.setSummary(accumulated.trim());
    }
    catch (err) {
        view.setSummary(`Error: ${err?.message ?? String(err)}`);
    }
    finally {
        vscode.commands.executeCommand('setContext', 'cursorSummary.loading', false);
    }
}
function activate(context) {
    const provider = new SummaryViewProvider();
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(SummaryViewProvider.viewType, provider));
    context.subscriptions.push(vscode.commands.registerCommand('cursorSummary.refresh', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        const selection = editor.selection;
        if (selection.isEmpty) {
            return;
        }
        const text = editor.document.getText(selection);
        await summarizeSelection(text, provider);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('cursorSummary.copy', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        // Copy last summary by reading from visible view via command: retrieve isn't available, so keep local state
        // We already store last summary in provider
        await vscode.env.clipboard.writeText(provider._lastSummary || '');
        vscode.window.showInformationMessage('Summary copied to clipboard');
    }));
    context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection((e) => {
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
        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(() => {
            void summarizeSelection(text, provider);
        }, 350);
    }));
}
function deactivate() {
    currentCancellation?.cancel();
}
//# sourceMappingURL=extension.js.map