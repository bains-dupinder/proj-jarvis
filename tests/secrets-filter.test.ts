import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { filterSecrets } from '../src/security/secrets-filter.js'

describe('filterSecrets', () => {
  it('redacts Anthropic API keys', () => {
    const text = 'My key is sk-ant-abcdefghijklmnopqrstuvwxyz'
    assert.ok(filterSecrets(text).includes('[REDACTED]'))
    assert.ok(!filterSecrets(text).includes('sk-ant-'))
  })

  it('redacts OpenAI API keys', () => {
    const text = 'key=sk-abcdefghijklmnopqrstuvwxyz1234'
    assert.ok(filterSecrets(text).includes('[REDACTED]'))
    assert.ok(!filterSecrets(text).includes('sk-abcdefghijklmnopqrstuvwxyz'))
  })

  it('redacts Bearer tokens', () => {
    const text = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abcdef'
    const result = filterSecrets(text)
    assert.ok(result.includes('[REDACTED]'))
    assert.ok(!result.includes('eyJhbGciOiJ'))
  })

  it('redacts GitHub PAT tokens', () => {
    const text = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij'
    assert.ok(filterSecrets(text).includes('[REDACTED]'))
  })

  it('redacts known env var assignments', () => {
    const text = 'ANTHROPIC_API_KEY=sk-ant-secret123456789012345'
    const result = filterSecrets(text)
    assert.ok(result.includes('[REDACTED]'))
    assert.ok(!result.includes('secret123'))
  })

  it('leaves normal text alone', () => {
    const text = 'Hello world, this is a normal string with no secrets.'
    assert.equal(filterSecrets(text), text)
  })
})
