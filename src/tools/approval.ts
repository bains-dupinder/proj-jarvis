export class DeniedError extends Error {
  constructor(reason?: string) {
    super(reason ?? 'Denied by user')
    this.name = 'DeniedError'
  }
}

interface PendingApproval {
  resolve: () => void
  reject: (err: Error) => void
}

export class ApprovalManager {
  private pending = new Map<string, PendingApproval>()

  /**
   * Create a pending approval. Returns a Promise that:
   * - resolves when resolve(approvalId) is called
   * - rejects with DeniedError when reject(approvalId) is called
   */
  request(approvalId: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.pending.set(approvalId, { resolve, reject })
    })
  }

  /**
   * Approve a pending request. Returns false if not found.
   */
  resolve(approvalId: string): boolean {
    const entry = this.pending.get(approvalId)
    if (!entry) return false
    this.pending.delete(approvalId)
    entry.resolve()
    return true
  }

  /**
   * Deny a pending request. Returns false if not found.
   */
  reject(approvalId: string, reason?: string): boolean {
    const entry = this.pending.get(approvalId)
    if (!entry) return false
    this.pending.delete(approvalId)
    entry.reject(new DeniedError(reason))
    return true
  }

  hasPending(approvalId: string): boolean {
    return this.pending.has(approvalId)
  }
}
