import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isValidPassword, normalizeEmail } from './accountInput.ts'

describe('account input', () => {
  it('normalizes valid email addresses', () => {
    assert.equal(
      normalizeEmail('  Larry@HoffmanIts.com  '),
      'larry@hoffmanits.com',
    )
  })

  it('rejects malformed, oversized, and non-string email values', () => {
    assert.equal(normalizeEmail('not-an-email'), null)
    assert.equal(normalizeEmail('a..b@example.com'), null)
    assert.equal(normalizeEmail('a@localhost'), null)
    assert.equal(normalizeEmail(`${'a'.repeat(250)}@example.com`), null)
    assert.equal(normalizeEmail(null), null)
  })

  it('enforces the documented password requirements', () => {
    assert.equal(isValidPassword('Password1'), true)
    assert.equal(isValidPassword('password1'), false)
    assert.equal(isValidPassword('PASSWORD1'), false)
    assert.equal(isValidPassword('Password'), false)
    assert.equal(isValidPassword('P1a'), false)
  })
})
