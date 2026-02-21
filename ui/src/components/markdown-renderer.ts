import { LitElement, html, css } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { unsafeHTML } from 'lit/directives/unsafe-html.js'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

@customElement('jarvis-markdown')
export class MarkdownRenderer extends LitElement {
  static styles = css`
    :host {
      display: block;
      line-height: 1.6;
      word-wrap: break-word;
    }
    pre {
      background: #1a1a2e;
      border-radius: 6px;
      padding: 12px 16px;
      overflow-x: auto;
      font-size: 13px;
      margin: 8px 0;
    }
    code {
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      font-size: 13px;
    }
    :not(pre) > code {
      background: #1a1a2e;
      padding: 2px 6px;
      border-radius: 4px;
    }
    p { margin: 6px 0; }
    ul, ol { margin: 6px 0; padding-left: 24px; }
    a { color: #7c8fff; }
    blockquote {
      border-left: 3px solid #444;
      padding-left: 12px;
      margin: 8px 0;
      color: #999;
    }
    h1, h2, h3, h4 { margin: 12px 0 6px; }
    table { border-collapse: collapse; margin: 8px 0; }
    th, td { border: 1px solid #333; padding: 6px 10px; }
    th { background: #1a1a2e; }
    img { max-width: 100%; border-radius: 6px; }
  `

  @property({ type: String })
  content = ''

  render() {
    const rawHtml = marked.parse(this.content, { async: false }) as string
    const safeHtml = DOMPurify.sanitize(rawHtml, { USE_PROFILES: { html: true } })
    return html`${unsafeHTML(safeHtml)}`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'jarvis-markdown': MarkdownRenderer
  }
}
