import { LitElement, html, css } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { WsClient } from './ws-client.js'
import { getToken, setToken, clearToken } from './auth-store.js'
import type { SessionMeta } from './components/session-list.js'
import './components/session-list.js'
import './components/chat-view.js'
import './components/jarvis-hud.js'

type HudMode = 'blue' | 'green' | 'red'

@customElement('jarvis-app')
export class JarvisApp extends LitElement {
  static styles = css`
    :host {
      --ink: #dff6ff;
      --panel-bg: linear-gradient(155deg, rgba(9, 23, 37, 0.9), rgba(3, 12, 20, 0.92));
      --panel-edge: rgba(138, 226, 255, 0.35);
      --accent: #79dcff;
      --accent-strong: #b4f0ff;
      display: block;
      position: relative;
      height: 100vh;
      width: 100vw;
      overflow: hidden;
      color: var(--ink);
      font-family: 'Rajdhani', 'Orbitron', 'Eurostile', sans-serif;
      background: #0c1119;
    }

    .preauth {
      position: relative;
      height: 100%;
      width: 100%;
      background: #050a11;
    }

    jarvis-hud {
      position: absolute;
      inset: 0;
    }

    .backdrop {
      position: absolute;
      inset: 0;
      z-index: 1;
      pointer-events: none;
      background:
        radial-gradient(circle at 50% 48%, rgba(125, 216, 255, 0.16), rgba(125, 216, 255, 0) 30%),
        radial-gradient(circle at 80% 10%, rgba(83, 159, 199, 0.13), transparent 32%),
        radial-gradient(circle at 10% 90%, rgba(67, 118, 155, 0.12), transparent 35%);
    }

    .shell {
      position: relative;
      z-index: 2;
      height: 100%;
      width: 100%;
      transition: opacity 300ms ease, filter 300ms ease;
    }

    .shell--locked {
      opacity: 0;
      filter: blur(8px);
      pointer-events: none;
    }

    .auth-screen {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      padding: 28px;
    }

    .auth-card {
      width: min(460px, 100%);
      padding: 30px 28px;
      border-radius: 16px;
      background: var(--panel-bg);
      border: 1px solid var(--panel-edge);
      box-shadow:
        0 0 0 1px rgba(160, 233, 255, 0.1) inset,
        0 24px 60px rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(8px);
      transform-origin: center;
    }

    .auth-card--shake {
      animation: shake 360ms ease;
    }

    .auth-card h1 {
      margin: 0 0 4px;
      font-size: 26px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--accent-strong);
    }

    .auth-card p {
      margin: 0 0 20px;
      font-size: 16px;
      color: rgba(212, 242, 255, 0.76);
    }

    .auth-hint {
      margin-bottom: 16px;
      font-size: 12px;
      letter-spacing: 0.2em;
      color: rgba(164, 223, 247, 0.68);
      text-transform: uppercase;
    }

    .auth-card form {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .auth-card input {
      padding: 12px 14px;
      border: 1px solid rgba(115, 188, 226, 0.45);
      border-radius: 8px;
      background: rgba(5, 13, 22, 0.95);
      color: #ecfbff;
      font-size: 16px;
      font-family: 'Rajdhani', sans-serif;
      letter-spacing: 0.04em;
      outline: none;
      transition: border-color 120ms ease, box-shadow 120ms ease;
    }

    .auth-card input:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(97, 208, 255, 0.2);
    }

    .auth-card button {
      padding: 12px;
      border: 1px solid rgba(158, 231, 255, 0.6);
      border-radius: 8px;
      background: linear-gradient(135deg, rgba(60, 185, 230, 0.85), rgba(105, 229, 255, 0.7));
      color: #032031;
      font-size: 15px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      font-weight: 700;
      cursor: pointer;
      transition: transform 140ms ease, filter 140ms ease;
    }

    .auth-card button:hover {
      transform: translateY(-1px);
      filter: brightness(1.08);
    }

    .auth-card button:disabled {
      opacity: 0.72;
      cursor: progress;
    }

    .auth-error {
      color: #ff8e7a;
      font-size: 14px;
      line-height: 1.35;
    }

    .splash,
    .online-overlay {
      position: absolute;
      inset: 0;
      z-index: 4;
      display: grid;
      place-items: center;
      pointer-events: none;
    }

    .splash {
      background:
        radial-gradient(circle at center, rgba(22, 69, 97, 0.45), rgba(4, 10, 16, 0.95) 62%),
        rgba(4, 10, 16, 0.95);
      animation: overlay-fade 320ms ease-out 1.68s forwards;
    }

    .splash-mark {
      position: relative;
      text-align: center;
      padding: 42px 48px;
      border: 1px solid rgba(133, 216, 255, 0.36);
      border-radius: 14px;
      background: rgba(3, 12, 20, 0.78);
      box-shadow:
        0 0 46px rgba(58, 178, 226, 0.2),
        0 0 0 1px rgba(167, 236, 255, 0.1) inset;
      overflow: hidden;
    }

    .splash-mark::before,
    .splash-mark::after {
      content: '';
      position: absolute;
      inset: 8px;
      border-radius: 10px;
      border: 1px solid rgba(126, 205, 241, 0.26);
      pointer-events: none;
    }

    .splash-mark::after {
      inset: 14px;
      border-style: dashed;
      opacity: 0.6;
      animation: ring-rotate 8s linear infinite;
    }

    .boot-tag {
      margin-bottom: 10px;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.32em;
      color: rgba(165, 228, 251, 0.78);
      animation: pulse 1s ease-in-out infinite;
    }

    .splash-word {
      font-size: clamp(34px, 7vw, 76px);
      letter-spacing: 0.42em;
      color: #caf5ff;
      text-shadow:
        0 0 8px rgba(149, 235, 255, 0.9),
        0 0 24px rgba(91, 207, 255, 0.56);
      transform: translateX(0.2em);
      animation: reveal 2s linear forwards;
      font-weight: 700;
    }

    .boot-line {
      margin-top: 10px;
      font-size: 12px;
      letter-spacing: 0.2em;
      color: rgba(174, 231, 251, 0.74);
      text-transform: uppercase;
    }

    .online-overlay {
      background:
        radial-gradient(circle at center, rgba(24, 80, 52, 0.42), rgba(5, 13, 10, 0.94) 62%),
        rgba(5, 13, 10, 0.92);
      animation: online-fade 180ms ease-out;
    }

    .online-mark {
      text-align: center;
      display: grid;
      justify-items: center;
      gap: 16px;
    }

    .online-ring {
      width: 138px;
      height: 138px;
      border-radius: 50%;
      position: relative;
      border: 2px solid rgba(170, 255, 210, 0.8);
      box-shadow: 0 0 24px rgba(112, 241, 173, 0.35);
      animation: ring-rotate 3s linear infinite;
    }

    .online-ring::before,
    .online-ring::after {
      content: '';
      position: absolute;
      inset: 8px;
      border-radius: 50%;
      border: 1px dashed rgba(171, 255, 217, 0.66);
    }

    .online-ring::after {
      inset: 28px;
      border-style: solid;
      animation: ring-rotate-reverse 2.2s linear infinite;
    }

    .online-text {
      font-size: clamp(24px, 5vw, 44px);
      letter-spacing: 0.36em;
      color: #b6ffdb;
      text-shadow:
        0 0 7px rgba(169, 255, 214, 0.9),
        0 0 20px rgba(79, 236, 158, 0.45);
      text-transform: uppercase;
      transform: translateX(0.18em);
    }

    .online-sub {
      font-size: 12px;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: rgba(181, 255, 224, 0.75);
    }

    .main-layout {
      height: 100%;
      width: 100%;
      display: flex;
      background: #0b1017;
    }

    .sidebar {
      width: 252px;
      min-width: 252px;
      flex-shrink: 0;
      border-right: 1px solid #1f2733;
      background: #0d141d;
    }

    .main {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
      background: #0f1722;
    }

    .no-session {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: rgba(193, 209, 228, 0.78);
      letter-spacing: 0.06em;
      font-size: 16px;
      text-transform: uppercase;
    }

    @keyframes pulse {
      0%, 100% { opacity: 0.66; }
      50% { opacity: 1; }
    }

    @keyframes reveal {
      0% { clip-path: inset(0 100% 0 0); opacity: 0.1; }
      24% { clip-path: inset(0 0 0 0); opacity: 1; }
      100% { clip-path: inset(0 0 0 0); opacity: 1; }
    }

    @keyframes ring-rotate {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    @keyframes ring-rotate-reverse {
      from { transform: rotate(360deg); }
      to { transform: rotate(0deg); }
    }

    @keyframes overlay-fade {
      from { opacity: 1; }
      to { opacity: 0; }
    }

    @keyframes online-fade {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes shake {
      0%, 100% { transform: translateX(0); }
      20% { transform: translateX(-8px); }
      40% { transform: translateX(8px); }
      60% { transform: translateX(-6px); }
      80% { transform: translateX(6px); }
    }

    @media (max-width: 900px) {
      .sidebar {
        width: 216px;
        min-width: 216px;
      }

      .splash-mark {
        padding: 34px 26px;
      }
    }

    @media (max-width: 700px) {
      .main-layout {
        flex-direction: column;
      }

      .sidebar {
        width: 100%;
        min-width: 0;
        height: 210px;
        border-right: none;
        border-bottom: 1px solid #1f2733;
      }

      .auth-screen {
        padding: 18px;
      }
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

  @state()
  private showSplash = true

  @state()
  private showOnlineOverlay = false

  @state()
  private hudMode: HudMode = 'blue'

  @state()
  private authShake = false

  private client: WsClient | null = null
  private appUnsubscribers: Array<() => void> = []
  private splashTimer: ReturnType<typeof setTimeout> | null = null
  private hudResetTimer: ReturnType<typeof setTimeout> | null = null
  private shakeTimer: ReturnType<typeof setTimeout> | null = null

  async connectedCallback() {
    super.connectedCallback()
    this.splashTimer = setTimeout(() => {
      this.showSplash = false
      this.focusTokenInput()
    }, 2000)

    const saved = getToken()
    if (saved) {
      await this.tryConnect(saved)
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    this.clearTimers()
    for (const unsub of this.appUnsubscribers) unsub()
    this.appUnsubscribers = []
  }

  private clearTimers() {
    if (this.splashTimer) {
      clearTimeout(this.splashTimer)
      this.splashTimer = null
    }
    if (this.hudResetTimer) {
      clearTimeout(this.hudResetTimer)
      this.hudResetTimer = null
    }
    if (this.shakeTimer) {
      clearTimeout(this.shakeTimer)
      this.shakeTimer = null
    }
  }

  private async pause(ms: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, ms))
  }

  private async focusTokenInput() {
    if (this.authenticated) return
    await this.updateComplete
    const input = this.renderRoot.querySelector<HTMLInputElement>('.auth-card input')
    input?.focus()
  }

  private async tryConnect(token: string, inputEl?: HTMLInputElement) {
    if (this.connecting) return

    this.connecting = true
    this.authError = ''
    this.authShake = false
    this.hudMode = 'blue'
    if (this.hudResetTimer) {
      clearTimeout(this.hudResetTimer)
      this.hudResetTimer = null
    }

    const wsUrl = `ws://${window.location.host}/ws`
    const client = new WsClient(wsUrl, token)

    try {
      await client.connect()
      this.client = client
      setToken(token)
      for (const unsub of this.appUnsubscribers) unsub()
      this.appUnsubscribers = []
      this.appUnsubscribers.push(
        client.on('scheduler.run_completed', () => {
          this.loadSessions().catch((err) => console.error('Failed to refresh sessions:', err))
        }),
      )
      await this.loadSessions(client)

      this.showOnlineOverlay = true
      this.hudMode = 'green'
      await this.pause(2000)
      this.showOnlineOverlay = false
      this.authenticated = true
    } catch {
      this.client = null
      clearToken()
      this.authError = 'Access denied. Invalid token. Please try again.'
      this.hudMode = 'red'
      this.authShake = true

      if (this.shakeTimer) clearTimeout(this.shakeTimer)
      this.shakeTimer = setTimeout(() => {
        this.authShake = false
      }, 360)

      if (this.hudResetTimer) clearTimeout(this.hudResetTimer)
      this.hudResetTimer = setTimeout(() => {
        this.hudMode = 'blue'
      }, 1100)

      if (inputEl) {
        inputEl.value = ''
      }
      await this.focusTokenInput()
    } finally {
      this.connecting = false
    }
  }

  private async loadSessions(clientOverride?: WsClient) {
    const client = clientOverride ?? this.client
    if (!client) return

    try {
      const res = await client.request<{ sessions: SessionMeta[] }>('sessions.list')
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
    await this.tryConnect(token, input)
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
    if (this.authenticated) {
      return this.renderMain()
    }
    return this.renderPreAuth()
  }

  private renderPreAuth() {
    const shellLocked = this.showSplash || this.showOnlineOverlay
    return html`
      <div class="preauth">
        <jarvis-hud .mode=${this.hudMode}></jarvis-hud>
        <div class="backdrop"></div>
        <div class="shell ${shellLocked ? 'shell--locked' : ''}">
          ${this.renderAuth()}
        </div>
        ${this.showSplash ? this.renderSplash() : ''}
        ${this.showOnlineOverlay ? this.renderOnlineOverlay() : ''}
      </div>
    `
  }

  private renderAuth() {
    return html`
      <div class="auth-screen">
        <div class="auth-card ${this.authShake ? 'auth-card--shake' : ''}">
          <div class="auth-hint">Secure Link</div>
          <h1>Jarvis Console</h1>
          <p>Enter your gateway token to initiate a secure operator session.</p>
          <form @submit=${this.handleTokenSubmit}>
            <input
              type="password"
              placeholder="Token"
              ?disabled=${this.connecting}
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
      <div class="main-layout">
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
      </div>
    `
  }

  private renderSplash() {
    return html`
      <div class="splash">
        <div class="splash-mark">
          <div class="boot-tag">System Boot</div>
          <div class="splash-word">J A R V I S</div>
          <div class="boot-line">Initializing Cognitive Core</div>
        </div>
      </div>
    `
  }

  private renderOnlineOverlay() {
    return html`
      <div class="online-overlay">
        <div class="online-mark">
          <div class="online-ring"></div>
          <div class="online-text">J A R V I S ONLINE</div>
          <div class="online-sub">Operator Link Confirmed</div>
        </div>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'jarvis-app': JarvisApp
  }
}
