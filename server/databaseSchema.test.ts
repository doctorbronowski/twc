import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isUnsignedIntColumnType } from './databaseSchema.ts'

test('accepts unsigned integer column types from MySQL and MariaDB', () => {
  assert.equal(isUnsignedIntColumnType('int unsigned'), true)
  assert.equal(isUnsignedIntColumnType('int(10) unsigned'), true)
})

test('rejects other activity account column types', () => {
  assert.equal(isUnsignedIntColumnType('int'), false)
  assert.equal(isUnsignedIntColumnType('bigint unsigned'), false)
})
