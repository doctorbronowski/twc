import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { hashPassword, verifyPassword } from './password.ts'

describe('password hashing', () => {
  it('stores salted scrypt hashes and verifies the original password', async () => {
    const firstHash = await hashPassword('SecurePassword123')
    const secondHash = await hashPassword('SecurePassword123')

    assert.notEqual(firstHash, 'SecurePassword123')
    assert.notEqual(firstHash, secondHash)
    assert.equal(await verifyPassword('SecurePassword123', firstHash), true)
    assert.equal(await verifyPassword('WrongPassword123', firstHash), false)
  })

  it('rejects malformed password hashes', async () => {
    assert.equal(await verifyPassword('Password123', 'not-a-hash'), false)
    assert.equal(
      await verifyPassword('Password123', 'scrypt$999999$8$1$salt$key'),
      false,
    )
  })
})
