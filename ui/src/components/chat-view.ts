import { LitElement, html, css } from 'lit'
import type { PropertyValues } from 'lit'
import { customElement, property, state, query } from 'lit/decorators.js'
import type { WsClient } from '../ws-client.js'
import type { MessageList, ChatMessage } from './message-list.js'
import './message-list.js'
import './input-bar.js'
import './approval-dialog.js'

interface ApprovalRequest {
  approvalId: string
  toolName: string
  summary: string
}

interface HistoryMessage {
  role: 'user' | 'assistant' | 'tool_result'
  content: string
  timestamp: number
  runId?: string
  toolName?: string
}

interface SchedulerRunCompletedEvent {
  jobId: string
  jobName?: string
  runId: string
  sessionKey?: string
  status: 'success' | 'error'
  summary?: string
  error?: string
}

interface ChatToolResultEvent {
  runId: string
  tool: string
  output: string
  exitCode?: number
}

let msgIdCounter = 0
function nextMsgId(): string {
  return `msg-${++msgIdCounter}`
}

@customElement('jarvis-chat-view')
export class ChatView extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    .progress-bar {
      padding: 4px 20px;
      font-size: 12px;
      color: #888;
      background: #0f0f0f;
      border-bottom: 1px solid #1a1a1a;
    }
  `

  @property({ attribute: false })
  client!: WsClient

  @property({ type: String })
  sessionKey = ''

  @state()
  private streaming = false

  @state()
  private pendingApproval: ApprovalRequest | null = null

  @state()
  private progressMessage = ''

  @query('jarvis-message-list')
  private messageList!: MessageList

  private unsubscribers: Array<() => void> = []
  private currentRunId = ''
  private hasStreamingAssistant = false
  private historyRequestId = 0

  async connectedCallback() {
    super.connectedCallback()
    await this.loadHistory()
    this.subscribeEvents()
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    for (const unsub of this.unsubscribers) unsub()
    this.unsubscribers = []
  }

  protected updated(changed: PropertyValues<this>) {
    if (changed.has('sessionKey')) {
      this.resetViewState()
      void this.loadHistory()
    }
  }

  private resetViewState() {
    this.streaming = false
    this.pendingApproval = null
    this.progressMessage = ''
    this.currentRunId = ''
    this.hasStreamingAssistant = false
    this.messageList?.setMessages([])
  }

  private async loadHistory() {
    const requestId = ++this.historyRequestId
    const targetSession = this.sessionKey

    try {
      const res = await this.client.request<{ messages: HistoryMessage[] }>(
        'chat.history',
        { sessionKey: targetSession },
      )

      // Ignore stale responses from an older session selection.
      if (requestId !== this.historyRequestId || targetSession !== this.sessionKey) {
        return
      }

      const msgs: ChatMessage[] = res.messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({
          id: nextMsgId(),
          role: m.role as 'user' | 'assistant',
          content: m.content,
          runId: m.runId,
        }))

      // Wait for first render so messageList exists
      await this.updateComplete
      this.messageList?.setMessages(msgs)
    } catch (err) {
      console.error('Failed to load history:', err)
    }
  }

  private subscribeEvents() {
    this.unsubscribers.push(
      this.client.on('chat.delta', (data) => {
        const { runId, text } = data as { runId: string; text: string }
        if (!this.currentRunId && this.streaming) {
          this.currentRunId = runId
          this.ensureStreamingAssistant(runId)
        }
        if (runId === this.currentRunId) {
          this.messageList?.addDelta(runId, text)
        }
      }),
    )

    this.unsubscribers.push(
      this.client.on('chat.final', (data) => {
        const { runId } = data as { runId: string }
        if (!this.currentRunId && this.streaming) {
          this.currentRunId = runId
          this.ensureStreamingAssistant(runId)
        }
        if (runId === this.currentRunId) {
          this.messageList?.finishRun(runId)
          this.streaming = false
          this.progressMessage = ''
          this.currentRunId = ''
          this.hasStreamingAssistant = false
        }
      }),
    )

    this.unsubscribers.push(
      this.client.on('chat.error', (data) => {
        const { runId, message } = data as { runId: string; message: string }
        if (!this.currentRunId && this.streaming) {
          this.currentRunId = runId
          this.ensureStreamingAssistant(runId)
        }
        if (runId === this.currentRunId) {
          this.messageList?.addDelta(runId, `\n\n**Error:** ${message}`)
          this.messageList?.finishRun(runId)
          this.streaming = false
          this.progressMessage = ''
          this.currentRunId = ''
          this.hasStreamingAssistant = false
        }
      }),
    )

    this.unsubscribers.push(
      this.client.on('exec.approval_request', (data) => {
        const req = data as ApprovalRequest
        this.pendingApproval = req
      }),
    )

    this.unsubscribers.push(
      this.client.on('tool.progress', (data) => {
        const { message } = data as { message: string }
        this.progressMessage = message
      }),
    )

    this.unsubscribers.push(
      this.client.on('scheduler.run_completed', (data) => {
        void this.handleSchedulerRunCompleted(data as SchedulerRunCompletedEvent)
      }),
    )

    this.unsubscribers.push(
      this.client.on('chat.tool_result', (data) => {
        const evt = data as ChatToolResultEvent
        if (!this.currentRunId && this.streaming) {
          this.currentRunId = evt.runId
          this.ensureStreamingAssistant(evt.runId)
        }

        if (evt.runId !== this.currentRunId) return
        if (evt.tool !== 'bash') return

        const header = `\n\n**Bash Output** (exit ${evt.exitCode ?? 'n/a'}):\n`
        const body = `\`\`\`\n${evt.output}\n\`\`\``
        this.messageList?.addDelta(evt.runId, `${header}${body}`)
      }),
    )
  }

  private async handleSchedulerRunCompleted(evt: SchedulerRunCompletedEvent): Promise<void> {
    const label = evt.jobName?.trim() || evt.jobId
    const header =
      evt.status === 'success'
        ? `Scheduled job "${label}" completed.`
        : `Scheduled job "${label}" failed.`

    let details =
      evt.status === 'success'
        ? (evt.summary?.trim() || '(no output)')
        : `Error: ${evt.error?.trim() || 'Unknown error'}`

    if (evt.status === 'success' && evt.sessionKey) {
      try {
        const res = await this.client.request<{ messages: HistoryMessage[] }>(
          'chat.history',
          { sessionKey: evt.sessionKey, limit: 200 },
        )

        const lastAssistant = [...res.messages]
          .reverse()
          .find((m) => m.role === 'assistant' && m.content.trim().length > 0)

        if (lastAssistant) {
          details = lastAssistant.content
        }
      } catch {
        // Fall back to event summary if session fetch fails.
      }
    }

    const sessionLine = evt.sessionKey ? `Session: ${evt.sessionKey}\n\n` : ''

    this.messageList?.addMessage({
      id: nextMsgId(),
      role: 'assistant',
      content: `${header}\n\n${sessionLine}${details}`,
    })
  }

  private async handleSend(e: CustomEvent<{ message: string }>) {
    const { message } = e.detail
    this.streaming = true
    this.currentRunId = ''
    this.hasStreamingAssistant = false

    // Add user message optimistically
    this.messageList?.addMessage({
      id: nextMsgId(),
      role: 'user',
      content: message,
    })

    try {
      const res = await this.client.request<{ runId: string }>(
        'chat.send',
        { sessionKey: this.sessionKey, message },
      )
      if (!this.currentRunId) {
        this.currentRunId = res.runId
      }
      this.ensureStreamingAssistant(this.currentRunId)
    } catch (err) {
      this.streaming = false
      this.progressMessage = ''
      this.currentRunId = ''
      this.hasStreamingAssistant = false
      const message = err instanceof Error ? err.message : 'Failed to send message'
      this.messageList?.addMessage({
        id: nextMsgId(),
        role: 'assistant',
        content: `**Error:** ${message}`,
      })
      console.error('Failed to send:', err)
    }
  }

  private ensureStreamingAssistant(runId: string) {
    if (this.hasStreamingAssistant) return
    this.messageList?.addMessage({
      id: nextMsgId(),
      role: 'assistant',
      content: '',
      streaming: true,
      runId,
    })
    this.hasStreamingAssistant = true
  }

  private async handleApprove(e: CustomEvent<{ approvalId: string }>) {
    const { approvalId } = e.detail
    this.pendingApproval = null
    try {
      await this.client.request('exec.approve', { approvalId })
    } catch (err) {
      console.error('Failed to approve:', err)
    }
  }

  private async handleDeny(e: CustomEvent<{ approvalId: string }>) {
    const { approvalId } = e.detail
    this.pendingApproval = null
    try {
      await this.client.request('exec.deny', { approvalId })
    } catch (err) {
      console.error('Failed to deny:', err)
    }
  }

  render() {
    return html`
      <jarvis-message-list></jarvis-message-list>
      ${this.progressMessage
        ? html`<div class="progress-bar">⏳ ${this.progressMessage}</div>`
        : ''}
      <jarvis-input-bar
        .disabled=${this.streaming}
        @send=${this.handleSend}
      ></jarvis-input-bar>
      <jarvis-approval-dialog
        .visible=${this.pendingApproval !== null}
        .approvalId=${this.pendingApproval?.approvalId ?? ''}
        .toolName=${this.pendingApproval?.toolName ?? ''}
        .summary=${this.pendingApproval?.summary ?? ''}
        @approve=${this.handleApprove}
        @deny=${this.handleDeny}
      ></jarvis-approval-dialog>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'jarvis-chat-view': ChatView
  }
}
