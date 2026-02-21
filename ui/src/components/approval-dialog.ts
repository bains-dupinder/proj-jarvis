import { LitElement, html, css } from 'lit'
import { customElement, property } from 'lit/decorators.js'

@customElement('jarvis-approval-dialog')
export class ApprovalDialog extends LitElement {
  static styles = css`
    :host {
      display: contents;
    }
    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      animation: fadeIn 0.15s ease;
    }
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    .dialog {
      background: #1e1e2e;
      border: 1px solid #333;
      border-radius: 12px;
      padding: 24px;
      max-width: 560px;
      width: 90%;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    }
    h3 {
      margin: 0 0 12px;
      font-size: 16px;
      color: #ffa500;
    }
    p {
      margin: 8px 0;
      font-size: 14px;
      color: #bbb;
    }
    .tool-label {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #888;
      margin-bottom: 4px;
    }
    pre {
      background: #0f0f0f;
      border: 1px solid #333;
      border-radius: 6px;
      padding: 12px 16px;
      margin: 8px 0 16px;
      overflow-x: auto;
      font-size: 13px;
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      color: #e0e0e0;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .actions {
      display: flex;
      gap: 10px;
      justify-content: flex-end;
      margin-top: 16px;
    }
    button {
      padding: 8px 20px;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-deny {
      background: #444;
      color: #e0e0e0;
    }
    .btn-deny:hover {
      background: #555;
    }
    .btn-approve {
      background: #2e7d32;
      color: white;
    }
    .btn-approve:hover {
      background: #388e3c;
    }
  `

  @property({ type: String })
  approvalId = ''

  @property({ type: String })
  toolName = ''

  @property({ type: String })
  summary = ''

  @property({ type: Boolean })
  visible = false

  private approve() {
    this.dispatchEvent(
      new CustomEvent('approve', {
        detail: { approvalId: this.approvalId },
        bubbles: true,
        composed: true,
      }),
    )
  }

  private deny() {
    this.dispatchEvent(
      new CustomEvent('deny', {
        detail: { approvalId: this.approvalId },
        bubbles: true,
        composed: true,
      }),
    )
  }

  render() {
    if (!this.visible) return html``

    return html`
      <div class="overlay">
        <div class="dialog">
          <h3>⚠ Approval Required</h3>
          <div class="tool-label">Tool: ${this.toolName}</div>
          <p>The assistant wants to execute:</p>
          <pre><code>${this.summary}</code></pre>
          <div class="actions">
            <button class="btn-deny" @click=${this.deny} autofocus>Deny</button>
            <button class="btn-approve" @click=${this.approve}>Approve</button>
          </div>
        </div>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'jarvis-approval-dialog': ApprovalDialog
  }
}
