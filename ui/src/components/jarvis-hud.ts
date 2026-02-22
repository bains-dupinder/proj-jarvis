import { LitElement, html, css } from 'lit'
import { customElement, property, query } from 'lit/decorators.js'

interface OrbitPoint {
  radiusScale: number
  speed: number
  phase: number
  size: number
}

type HudMode = 'blue' | 'green' | 'red'

interface HudPalette {
  bg0: string
  bg1: string
  bg2: string
  grid: string
  ring: string
  arcA: string
  arcB: string
  arcC: string
  sweepA: string
  sweepB: string
  sweepC: string
  point: string
  coreA: string
  coreB: string
  telemetryA: string
  telemetryB: string
  scanline: string
}

@customElement('jarvis-hud')
export class JarvisHud extends LitElement {
  static styles = css`
    :host {
      position: absolute;
      inset: 0;
      display: block;
      overflow: hidden;
      pointer-events: none;
      z-index: 0;
    }

    canvas {
      width: 100%;
      height: 100%;
      display: block;
      opacity: 0.96;
    }
  `

  @query('canvas')
  private canvasEl!: HTMLCanvasElement

  @property({ type: String })
  mode: HudMode = 'blue'

  private ctx: CanvasRenderingContext2D | null = null
  private rafId: number | null = null
  private dpr = 1
  private width = 0
  private height = 0
  private orbitPoints: OrbitPoint[] = []
  private readonly onResize = () => this.resizeCanvas()

  connectedCallback(): void {
    super.connectedCallback()
    window.addEventListener('resize', this.onResize)
  }

  firstUpdated(): void {
    this.ctx = this.canvasEl.getContext('2d')
    this.orbitPoints = Array.from({ length: 48 }, (_, i) => ({
      radiusScale: 0.72 + this.seed(i, 1) * 0.6,
      speed: 0.1 + this.seed(i, 2) * 0.6,
      phase: this.seed(i, 3) * Math.PI * 2,
      size: 0.7 + this.seed(i, 4) * 2.5,
    }))
    this.resizeCanvas()
    this.loop(performance.now())
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    window.removeEventListener('resize', this.onResize)
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }

  private seed(index: number, salt: number): number {
    const v = Math.sin(index * 13.713 + salt * 91.337) * 43758.5453
    return v - Math.floor(v)
  }

  private resizeCanvas(): void {
    if (!this.ctx) return
    const rect = this.getBoundingClientRect()
    this.width = Math.max(1, rect.width)
    this.height = Math.max(1, rect.height)
    this.dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.canvasEl.width = Math.floor(this.width * this.dpr)
    this.canvasEl.height = Math.floor(this.height * this.dpr)
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
  }

  private loop(now: number): void {
    this.draw(now * 0.001)
    this.rafId = requestAnimationFrame((t) => this.loop(t))
  }

  private palette(): HudPalette {
    if (this.mode === 'green') {
      return {
        bg0: '#0a1d14',
        bg1: '#08150f',
        bg2: '#040a07',
        grid: 'rgba(118, 241, 182, 0.11)',
        ring: 'rgba(140, 247, 194, 0.45)',
        arcA: 'rgba(161, 255, 210, 0.92)',
        arcB: 'rgba(98, 239, 169, 0.82)',
        arcC: 'rgba(205, 255, 232, 0.6)',
        sweepA: 'rgba(64, 168, 121, 0)',
        sweepB: 'rgba(161, 255, 209, 0.1)',
        sweepC: 'rgba(187, 255, 220, 0.46)',
        point: 'rgba(188, 255, 219, 0.82)',
        coreA: 'rgba(200, 255, 226, 0.84)',
        coreB: 'rgba(105, 255, 177, 0.28)',
        telemetryA: 'rgba(136, 246, 189, 0.45)',
        telemetryB: 'rgba(81, 206, 154, 0.31)',
        scanline: 'rgba(126, 240, 183, 0.034)',
      }
    }

    if (this.mode === 'red') {
      return {
        bg0: '#241015',
        bg1: '#17090d',
        bg2: '#0d0507',
        grid: 'rgba(255, 129, 129, 0.12)',
        ring: 'rgba(255, 153, 153, 0.52)',
        arcA: 'rgba(255, 182, 182, 0.94)',
        arcB: 'rgba(255, 120, 128, 0.83)',
        arcC: 'rgba(255, 208, 208, 0.62)',
        sweepA: 'rgba(178, 71, 71, 0)',
        sweepB: 'rgba(255, 141, 141, 0.11)',
        sweepC: 'rgba(255, 178, 178, 0.5)',
        point: 'rgba(255, 193, 193, 0.84)',
        coreA: 'rgba(255, 198, 198, 0.84)',
        coreB: 'rgba(255, 117, 117, 0.32)',
        telemetryA: 'rgba(255, 158, 158, 0.5)',
        telemetryB: 'rgba(221, 100, 100, 0.34)',
        scanline: 'rgba(255, 140, 140, 0.038)',
      }
    }

    return {
      bg0: '#0b1826',
      bg1: '#081221',
      bg2: '#04090f',
      grid: 'rgba(93, 199, 255, 0.09)',
      ring: 'rgba(113, 217, 255, 0.4)',
      arcA: 'rgba(128, 232, 255, 0.9)',
      arcB: 'rgba(54, 185, 255, 0.8)',
      arcC: 'rgba(178, 241, 255, 0.6)',
      sweepA: 'rgba(50, 143, 190, 0)',
      sweepB: 'rgba(124, 222, 255, 0.06)',
      sweepC: 'rgba(150, 236, 255, 0.38)',
      point: 'rgba(169, 240, 255, 0.7)',
      coreA: 'rgba(177, 244, 255, 0.78)',
      coreB: 'rgba(108, 219, 255, 0.25)',
      telemetryA: 'rgba(111, 212, 255, 0.45)',
      telemetryB: 'rgba(56, 170, 225, 0.28)',
      scanline: 'rgba(110, 199, 255, 0.028)',
    }
  }

  private draw(t: number): void {
    if (!this.ctx) return

    const ctx = this.ctx
    const palette = this.palette()
    const w = this.width
    const h = this.height
    const cx = w * 0.5
    const cy = h * 0.5
    const baseRadius = Math.min(w, h) * 0.18

    ctx.clearRect(0, 0, w, h)

    const bg = ctx.createRadialGradient(cx, cy, baseRadius * 0.6, cx, cy, Math.max(w, h) * 0.75)
    bg.addColorStop(0, palette.bg0)
    bg.addColorStop(0.45, palette.bg1)
    bg.addColorStop(1, palette.bg2)
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, w, h)

    this.drawGrid(ctx, w, h, t, palette)
    this.drawHudCore(ctx, cx, cy, baseRadius, t, palette)
    this.drawTelemetry(ctx, w, h, t, palette)
    this.drawScanlines(ctx, w, h, t, palette)
  }

  private drawGrid(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    t: number,
    palette: HudPalette,
  ): void {
    const step = Math.max(36, Math.min(74, Math.floor(Math.min(w, h) * 0.055)))
    const drift = (t * 18) % step

    ctx.strokeStyle = palette.grid
    ctx.lineWidth = 1
    for (let x = -step; x <= w + step; x += step) {
      ctx.beginPath()
      ctx.moveTo(x + drift, 0)
      ctx.lineTo(x + drift, h)
      ctx.stroke()
    }
    for (let y = -step; y <= h + step; y += step) {
      ctx.beginPath()
      ctx.moveTo(0, y + drift * 0.45)
      ctx.lineTo(w, y + drift * 0.45)
      ctx.stroke()
    }
  }

  private drawHudCore(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    t: number,
    palette: HudPalette,
  ): void {
    const pulse = 0.96 + Math.sin(t * 1.8) * 0.04

    ctx.strokeStyle = palette.ring
    ctx.lineWidth = 1.2
    for (let i = 0; i < 5; i += 1) {
      const radius = r * (0.7 + i * 0.28) * pulse
      ctx.beginPath()
      ctx.arc(cx, cy, radius, 0, Math.PI * 2)
      ctx.stroke()
    }

    const arcLayers = [
      { scale: 1.05, width: 2.6, speed: 0.9, arc: Math.PI * 0.45, color: palette.arcA },
      { scale: 1.38, width: 1.9, speed: -0.7, arc: Math.PI * 0.38, color: palette.arcB },
      { scale: 1.7, width: 1.5, speed: 0.5, arc: Math.PI * 0.31, color: palette.arcC },
    ]

    for (const layer of arcLayers) {
      const start = t * layer.speed
      ctx.strokeStyle = layer.color
      ctx.lineWidth = layer.width
      for (let i = 0; i < 4; i += 1) {
        const offset = (Math.PI * 2 * i) / 4
        ctx.beginPath()
        ctx.arc(cx, cy, r * layer.scale, start + offset, start + offset + layer.arc)
        ctx.stroke()
      }
    }

    const sweep = (t * 0.8) % (Math.PI * 2)
    const sweepGradient = ctx.createLinearGradient(cx - r * 2.1, cy, cx + r * 2.1, cy)
    sweepGradient.addColorStop(0, palette.sweepA)
    sweepGradient.addColorStop(0.48, palette.sweepB)
    sweepGradient.addColorStop(0.5, palette.sweepC)
    sweepGradient.addColorStop(0.52, palette.sweepB)
    sweepGradient.addColorStop(1, palette.sweepA)

    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(sweep)
    ctx.strokeStyle = sweepGradient
    ctx.lineWidth = Math.max(1.4, r * 0.03)
    ctx.beginPath()
    ctx.moveTo(-r * 2.1, 0)
    ctx.lineTo(r * 2.1, 0)
    ctx.stroke()
    ctx.restore()

    for (const point of this.orbitPoints) {
      const angle = t * point.speed + point.phase
      const pr = r * point.radiusScale
      const x = cx + Math.cos(angle) * pr
      const y = cy + Math.sin(angle) * pr
      ctx.fillStyle = palette.point
      ctx.beginPath()
      ctx.arc(x, y, point.size, 0, Math.PI * 2)
      ctx.fill()
    }

    const core = ctx.createRadialGradient(cx, cy, 1, cx, cy, r * 0.45)
    core.addColorStop(0, palette.coreA)
    core.addColorStop(0.4, palette.coreB)
    core.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = core
    ctx.beginPath()
    ctx.arc(cx, cy, r * 0.48, 0, Math.PI * 2)
    ctx.fill()
  }

  private drawTelemetry(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    t: number,
    palette: HudPalette,
  ): void {
    const rows = 16
    const spacing = h / (rows + 2)

    for (let i = 0; i < rows; i += 1) {
      const y = spacing * (i + 1)
      const width = 40 + ((Math.sin(t * 1.9 + i * 0.72) + 1) * 0.5) * 150
      ctx.strokeStyle = i % 2 === 0 ? palette.telemetryA : palette.telemetryB
      ctx.lineWidth = 1

      ctx.beginPath()
      ctx.moveTo(32, y)
      ctx.lineTo(32 + width, y)
      ctx.stroke()

      const rightWidth = 32 + ((Math.sin(t * 1.2 + i * 0.31) + 1) * 0.5) * 132
      ctx.beginPath()
      ctx.moveTo(w - 32, y)
      ctx.lineTo(w - 32 - rightWidth, y)
      ctx.stroke()
    }
  }

  private drawScanlines(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    t: number,
    palette: HudPalette,
  ): void {
    ctx.fillStyle = palette.scanline
    const shift = Math.floor((t * 36) % 4)
    for (let y = shift; y < h; y += 4) {
      ctx.fillRect(0, y, w, 1)
    }
  }

  render() {
    return html`<canvas></canvas>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'jarvis-hud': JarvisHud
  }
}
