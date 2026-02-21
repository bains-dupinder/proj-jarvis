import OpenAI from 'openai'

export interface EmbeddingProvider {
  model: string
  dimensions: number
  embed(texts: string[]): Promise<number[][]>
}

/**
 * OpenAI embeddings using text-embedding-3-small (1536 dimensions).
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  model = 'text-embedding-3-small'
  dimensions = 1536
  private client: OpenAI

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey })
  }

  /**
   * Embed one or more texts. Batches into groups of 100 (API limit).
   */
  async embed(texts: string[]): Promise<number[][]> {
    const results: number[][] = []
    const batchSize = 100

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize)
      const response = await this.client.embeddings.create({
        model: this.model,
        input: batch,
      })

      // Response embeddings are in same order as input
      for (const item of response.data) {
        results.push(item.embedding)
      }
    }

    return results
  }
}

/**
 * Convert a float32 array to a Buffer for SQLite BLOB storage.
 */
export function float32ToBlob(vec: number[]): Buffer {
  return Buffer.from(new Float32Array(vec).buffer)
}

/**
 * Convert a SQLite BLOB (Buffer) back to a float32 array.
 */
export function blobToFloat32(blob: Buffer): number[] {
  return Array.from(new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4))
}
