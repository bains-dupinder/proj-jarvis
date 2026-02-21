import { LitElement, html, css } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { WsClient } from './ws-client.js'
import { getToken, setToken, clearToken } from './auth-store.js'
import type { SessionMeta } from './components/session-list.js'
import './components/session-list.js'
import './components/chat-view.js'

@customElement('jarvis-app')
export class JarvisApp extends LitElement {
  static styles = css`
    :host {
      display: flex;
      height: 100vh;
      width: 100vw;
      color: #e0e0e0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    /* Auth screen */
    .auth-screen {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
    }
    .auth-card {
      background: #1e1e2e;
      border: 1px solid #333;
      border-radius: 12px;
      padding: 32px;
      width: 360px;
    }
    .auth-card h1 {
      font-size: 20px;
      margin: 0 0 6px;
    }
    .auth-card p {
      font-size: 13px;
      color: #888;
      margin: 0 0 20px;
    }
    .auth-card form {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .auth-card input {
      padding: 10px 14px;
      border: 1px solid #333;
      border-radius: 8px;
      background: #0f0f0f;
      color: #e0e0e0;
      font-size: 14px;
      outline: none;
    }
    .auth-card input:focus {
      border-color: #555;
    }
    .auth-card button {
      padding: 10px;
      border: none;
      border-radius: 8px;
      background: #3b5998;
      color: white;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }
    .auth-card button:hover {
      background: #4a6db5;
    }
    .auth-error {
      color: #ff6b6b;
      font-size: 13px;
      text-align: center;
    }

    /* Main layout */
    .sidebar {
      width: 240px;
      min-width: 240px;
      flex-shrink: 0;
    }
    .main {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .no-session {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: #555;
      font-size: 15px;
    }
  `

  @state()
  private authenticated = false

  @state()
  private authError = ''

  @state()
  private connecting = false

  @state()
  private sessions: SessionMeta[] = []

  @state()
  private activeSessionKey: string | null = null

  private client: WsClient | null = null

  async connectedCallback() {
    super.connectedCallback()

    // Try reconnect with saved token
    const saved = getToken()
    if (saved) {
      await this.tryConnect(saved)
    }
  }

  private async tryConnect(token: string) {
    this.connecting = true
    this.authError = ''

    const wsUrl = `ws://${window.location.host}/ws`
    const client = new WsClient(wsUrl, token)

    try {
      await client.connect()
      this.client = client
      this.authenticated = true
      setToken(token)
      await this.loadSessions()
    } catch (err) {
      this.authError = err instanceof Error ? err.message : 'Connection failed'
      clearToken()
    } finally {
      this.connecting = false
    }
  }

  private async loadSessions() {
    if (!this.client) return
    try {
      const res = await this.client.request<{ sessions: SessionMeta[] }>('sessions.list')
      // Sort newest first
      this.sessions = res.sessions.sort((a, b) => b.updatedAt - a.updatedAt)
    } catch (err) {
      console.error('Failed to load sessions:', err)
    }
  }

  private async handleTokenSubmit(e: Event) {
    e.preventDefault()
    const form = e.target as HTMLFormElement
    const input = form.querySelector('input') as HTMLInputElement
    const token = input.value.trim()
    if (!token) return
    await this.tryConnect(token)
  }

  private async handleNewSession() {
    if (!this.client) return
    try {
      const res = await this.client.request<{ sessionKey: string; meta: SessionMeta }>(
        'sessions.create',
      )
      this.sessions = [res.meta, ...this.sessions]
      this.activeSessionKey = res.sessionKey
    } catch (err) {
      console.error('Failed to create session:', err)
    }
  }

  private handleSelectSession(e: CustomEvent<{ sessionKey: string }>) {
    this.activeSessionKey = e.detail.sessionKey
  }

  render() {
    if (!this.authenticated) {
      return this.renderAuth()
    }
    return this.renderMain()
  }

  private renderAuth() {
    return html`
      <div class="auth-screen">
        <div class="auth-card">
          <h1>Virtual Assistant</h1>
          <p>Enter your auth token to connect</p>
          <form @submit=${this.handleTokenSubmit}>
            <input
              type="password"
              placeholder="Enter token"
              ?disabled=${this.connecting}
              autofocus
            />
            <button type="submit" ?disabled=${this.connecting}>
              ${this.connecting ? 'Connecting...' : 'Connect'}
            </button>
            ${this.authError
              ? html`<div class="auth-error">${this.authError}</div>`
              : ''}
          </form>
        </div>
      </div>
    `
  }

  private renderMain() {
    return html`
      <div class="sidebar">
        <jarvis-session-list
          .sessions=${this.sessions}
          .activeKey=${this.activeSessionKey}
          @session-new=${this.handleNewSession}
          @session-select=${this.handleSelectSession}
        ></jarvis-session-list>
      </div>
      <div class="main">
        ${this.activeSessionKey && this.client
          ? html`
              <jarvis-chat-view
                .client=${this.client}
                .sessionKey=${this.activeSessionKey}
              ></jarvis-chat-view>
            `
          : html`<div class="no-session">Select or create a session to start chatting</div>`
        }
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'jarvis-app': JarvisApp
  }
}
