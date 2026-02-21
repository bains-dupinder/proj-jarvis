import { LitElement, html, css } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import './markdown-renderer.js'

@customElement('jarvis-message-item')
export class MessageItem extends LitElement {
  static styles = css`
    :host {
      display: block;
      margin: 0 0 12px;
    }
    .message {
      padding: 10px 16px;
      border-radius: 12px;
      max-width: 85%;
    }
    .message--user {
      background: #1e3a5f;
      margin-left: auto;
      border-bottom-right-radius: 4px;
    }
    .message--assistant {
      background: #1e1e2e;
      margin-right: auto;
      border-bottom-left-radius: 4px;
    }
    .role-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #888;
      margin-bottom: 4px;
      font-weight: 600;
    }
    .cursor {
      display: inline-block;
      animation: blink 1s step-end infinite;
      color: #7c8fff;
      margin-left: 2px;
    }
    @keyframes blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0; }
    }
  `

  @property({ type: String })
  role: 'user' | 'assistant' = 'user'

  @property({ type: String })
  content = ''

  @property({ type: Boolean })
  streaming = false

  render() {
    return html`
      <div class="message message--${this.role}">
        <div class="role-label">${this.role}</div>
        <jarvis-markdown .content=${this.content}></jarvis-markdown>
        ${this.streaming ? html`<span class="cursor">▋</span>` : ''}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'jarvis-message-item': MessageItem
  }
}
