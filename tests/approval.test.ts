import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ApprovalManager, DeniedError } from '../src/tools/approval.js'

describe('ApprovalManager', () => {
  it('resolves a pending request on approve', async () => {
    const mgr = new ApprovalManager()
    const promise = mgr.request('abc-123')

    assert.ok(mgr.hasPending('abc-123'))
    const ok = mgr.resolve('abc-123')
    assert.ok(ok)
    assert.ok(!mgr.hasPending('abc-123'))

    // Should resolve without throwing
    await promise
  })

  it('rejects a pending request with DeniedError', async () => {
    const mgr = new ApprovalManager()
    const promise = mgr.request('abc-456')

    mgr.reject('abc-456', 'not allowed')

    await assert.rejects(promise, (err) => {
      assert.ok(err instanceof DeniedError)
      assert.equal(err.message, 'not allowed')
      return true
    })
  })

  it('returns false for unknown approval IDs', () => {
    const mgr = new ApprovalManager()
    assert.ok(!mgr.resolve('nope'))
    assert.ok(!mgr.reject('nope'))
    assert.ok(!mgr.hasPending('nope'))
  })

  it('clears pending entry after resolve', () => {
    const mgr = new ApprovalManager()
    mgr.request('x')
    mgr.resolve('x')
    // Second resolve should return false
    assert.ok(!mgr.resolve('x'))
  })
})
