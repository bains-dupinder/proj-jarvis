import { LitElement, html, css } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { repeat } from 'lit/directives/repeat.js'
import './message-item.js'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  runId?: string
}

@customElement('jarvis-message-list')
export class MessageList extends LitElement {
  static styles = css`
    :host {
      display: block;
      flex: 1;
      overflow-y: auto;
      padding: 16px 20px;
    }
    .empty {
      text-align: center;
      color: #666;
      margin-top: 40%;
      font-size: 15px;
    }
  `

  @state()
  messages: ChatMessage[] = []

  /**
   * Set all messages (e.g. from history load).
   */
  setMessages(msgs: ChatMessage[]) {
    this.messages = [...msgs]
  }

  /**
   * Add a message to the list.
   */
  addMessage(msg: ChatMessage) {
    this.messages = [...this.messages, msg]
  }

  /**
   * Append streaming text to the assistant message for the given runId.
   */
  addDelta(runId: string, text: string) {
    this.messages = this.messages.map((m) =>
      m.runId === runId && m.role === 'assistant'
        ? { ...m, content: m.content + text }
        : m,
    )
  }

  /**
   * Mark the streaming message for the given runId as complete.
   */
  finishRun(runId: string) {
    this.messages = this.messages.map((m) =>
      m.runId === runId && m.role === 'assistant'
        ? { ...m, streaming: false }
        : m,
    )
  }

  updated() {
    // Auto-scroll to bottom
    this.scrollTop = this.scrollHeight
  }

  render() {
    if (this.messages.length === 0) {
      return html`<div class="empty">Start a conversation...</div>`
    }

    return html`
      ${repeat(
        this.messages,
        (m) => m.id,
        (m) => html`
          <jarvis-message-item
            .role=${m.role}
            .content=${m.content}
            .streaming=${m.streaming ?? false}
          ></jarvis-message-item>
        `,
      )}
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'jarvis-message-list': MessageList
  }
}
