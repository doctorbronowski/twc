import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildEmailActionUrl } from './email.ts'

describe('account email links', () => {
  it('keeps verification and reset tokens in URL fragments, not requests', () => {
    const token = 'a'.repeat(43)
    const verify = new URL(
      buildEmailActionUrl(
        new URL('http://127.0.0.1:5174/'),
        '/verify-email',
        token,
      ),
    )
    const reset = new URL(
      buildEmailActionUrl(
        new URL('https://hitsdev.com/'),
        '/reset-password',
        token,
      ),
    )
    const emailChange = new URL(
      buildEmailActionUrl(
        new URL('http://127.0.0.1:5174/'),
        '/verify-email-change',
        token,
      ),
    )

    assert.equal(verify.pathname, '/verify-email')
    assert.equal(verify.hash, `#${token}`)
    assert.equal(verify.search, '')
    assert.equal(reset.pathname, '/reset-password')
    assert.equal(reset.hash, `#${token}`)
    assert.equal(reset.search, '')
    assert.equal(emailChange.pathname, '/verify-email-change')
    assert.equal(emailChange.hash, `#${token}`)
    assert.equal(emailChange.search, '')
  })
})
