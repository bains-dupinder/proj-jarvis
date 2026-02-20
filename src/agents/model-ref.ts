export interface ModelRef {
  provider: string
  model: string
}

/**
 * Parse a model reference string like "anthropic/claude-opus-4-6"
 * into its provider and model components.
 */
export function parseModelRef(ref: string): ModelRef {
  const slashIdx = ref.indexOf('/')
  if (slashIdx === -1) {
    throw new Error(`Invalid model ref "${ref}": expected "provider/model" format`)
  }

  const provider = ref.slice(0, slashIdx)
  const model = ref.slice(slashIdx + 1)

  if (!provider || !model) {
    throw new Error(`Invalid model ref "${ref}": provider and model must be non-empty`)
  }

  return { provider, model }
}
