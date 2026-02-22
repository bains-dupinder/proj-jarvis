import { LitElement, html, css } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { repeat } from 'lit/directives/repeat.js'

export interface SessionMeta {
  key: string
  agentId: string
  createdAt: number
  updatedAt: number
  label?: string
}

@customElement('jarvis-session-list')
export class SessionList extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: #141420;
      border-right: 1px solid #222;
    }
    .header {
      padding: 16px;
      border-bottom: 1px solid #222;
    }
    .header h2 {
      font-size: 14px;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin: 0 0 10px;
    }
    .new-btn {
      width: 100%;
      padding: 8px 12px;
      border: 1px dashed #444;
      border-radius: 8px;
      background: transparent;
      color: #aaa;
      font-size: 13px;
      cursor: pointer;
    }
    .new-btn:hover {
      border-color: #666;
      color: #ddd;
    }
    .list {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
    }
    .session-item {
      padding: 10px 12px;
      border-radius: 8px;
      cursor: pointer;
      margin-bottom: 4px;
      transition: background 0.1s;
    }
    .session-item:hover {
      background: #1e1e2e;
    }
    .session-item.active {
      background: #1e3a5f;
    }
    .session-item .agent {
      font-size: 13px;
      font-weight: 600;
      color: #ddd;
    }
    .session-item .date {
      font-size: 11px;
      color: #666;
      margin-top: 2px;
    }
  `

  @property({ type: Array })
  sessions: SessionMeta[] = []

  @property({ type: String })
  activeKey: string | null = null

  private handleNew() {
    this.dispatchEvent(
      new CustomEvent('session-new', { bubbles: true, composed: true }),
    )
  }

  private handleSelect(key: string) {
    this.dispatchEvent(
      new CustomEvent('session-select', {
        detail: { sessionKey: key },
        bubbles: true,
        composed: true,
      }),
    )
  }

  private formatDate(ts: number): string {
    const d = new Date(ts)
    const now = new Date()
    const isToday =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear()

    if (isToday) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }

  private shortKey(key: string): string {
    return key.slice(0, 8)
  }

  render() {
    return html`
      <div class="header">
        <h2>Sessions</h2>
        <button class="new-btn" @click=${this.handleNew}>+ New Session</button>
      </div>
      <div class="list">
        ${repeat(
          this.sessions,
          (s) => s.key,
          (s) => html`
            <div
              class="session-item ${s.key === this.activeKey ? 'active' : ''}"
              @click=${() => this.handleSelect(s.key)}
            >
              <div class="agent">${s.label?.trim() || s.agentId}</div>
              <div class="date">${this.formatDate(s.updatedAt)} · ${this.shortKey(s.key)}</div>
            </div>
          `,
        )}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'jarvis-session-list': SessionList
  }
}
