import { LitElement, html, css } from 'lit'
import { customElement, property, query } from 'lit/decorators.js'

@customElement('jarvis-input-bar')
export class InputBar extends LitElement {
  static styles = css`
    :host {
      display: block;
      padding: 12px 20px 16px;
      border-top: 1px solid #222;
      background: #0f0f0f;
    }
    form {
      display: flex;
      gap: 8px;
      align-items: flex-end;
    }
    textarea {
      flex: 1;
      resize: none;
      min-height: 42px;
      max-height: 160px;
      padding: 10px 14px;
      border: 1px solid #333;
      border-radius: 10px;
      background: #1a1a1a;
      color: #e0e0e0;
      font-family: inherit;
      font-size: 14px;
      line-height: 1.4;
      outline: none;
    }
    textarea:focus {
      border-color: #555;
    }
    textarea:disabled {
      opacity: 0.5;
    }
    button {
      padding: 10px 20px;
      border: none;
      border-radius: 10px;
      background: #3b5998;
      color: white;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
    }
    button:hover:not(:disabled) {
      background: #4a6db5;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `

  @property({ type: Boolean })
  disabled = false

  @query('textarea')
  private textarea!: HTMLTextAreaElement

  private handleKeydown(e: KeyboardEvent) {
    // Submit on Enter (without Shift), newline on Shift+Enter
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      this.submit()
    }
  }

  private handleSubmit(e: Event) {
    e.preventDefault()
    this.submit()
  }

  private submit() {
    const message = this.textarea.value.trim()
    if (!message || this.disabled) return

    this.dispatchEvent(
      new CustomEvent('send', {
        detail: { message },
        bubbles: true,
        composed: true,
      }),
    )
    this.textarea.value = ''
    this.textarea.style.height = 'auto'
  }

  private handleInput() {
    // Auto-resize textarea
    const ta = this.textarea
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`
  }

  render() {
    return html`
      <form @submit=${this.handleSubmit}>
        <textarea
          placeholder="Message..."
          @keydown=${this.handleKeydown}
          @input=${this.handleInput}
          ?disabled=${this.disabled}
          rows="1"
        ></textarea>
        <button type="submit" ?disabled=${this.disabled}>Send</button>
      </form>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'jarvis-input-bar': InputBar
  }
}
