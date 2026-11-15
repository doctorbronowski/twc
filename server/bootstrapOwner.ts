import { createInterface } from 'node:readline/promises'
import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { createConnection } from 'mysql2/promise'
import { isValidPassword, normalizeEmail } from './accountInput.ts'
import { isUnsignedIntColumnType } from './databaseSchema.ts'
import { hashPassword } from './password.ts'

interface AccountRow extends RowDataPacket {
  id: number
}

interface ActivityAccountColumnRow extends RowDataPacket {
  COLUMN_TYPE: string
  IS_NULLABLE: 'YES' | 'NO'
}

interface CountRow extends RowDataPacket {
  unassignedCount: number
}

interface ConstraintRow extends RowDataPacket {
  CONSTRAINT_NAME: string
}

function requiredEnvironmentValue(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is required to bootstrap the owner account.`)
  }
  return value
}

function readHiddenPassword(prompt: string): Promise<string> {
  const input = process.stdin
  if (!input.isTTY) {
    throw new Error('Run the owner bootstrap from an interactive terminal.')
  }

  return new Promise((resolve, reject) => {
    const output = process.stdout
    const previousRawMode = input.isRaw
    const passwordBytes: number[] = []
    let finished = false

    const finish = (error?: Error) => {
      if (finished) {
        return
      }
      finished = true
      input.off('data', onData)
      input.setRawMode(previousRawMode ?? false)
      input.pause()
      output.write('\n')
      if (error) {
        reject(error)
      } else {
        resolve(Buffer.from(passwordBytes).toString('utf8'))
      }
    }

    const onData = (chunk: Buffer) => {
      for (const byte of chunk) {
        if (byte === 3) {
          finish(new Error('Owner bootstrap cancelled.'))
          return
        }
        if (byte === 10 || byte === 13) {
          finish()
          return
        }
        if (byte === 8 || byte === 127) {
          const lastByte = passwordBytes.pop()
          if (lastByte !== undefined && (lastByte & 0xc0) === 0x80) {
            while (
              passwordBytes.length > 0 &&
              (passwordBytes[passwordBytes.length - 1] & 0xc0) === 0x80
            ) {
              passwordBytes.pop()
            }
            if (passwordBytes.length > 0) {
              passwordBytes.pop()
            }
          }
          continue
        }
        if (byte >= 32) {
          passwordBytes.push(byte)
        }
      }
    }

    output.write(prompt)
    input.setRawMode(true)
    input.resume()
    input.on('data', onData)
  })
}

async function promptForOwnerPassword(): Promise<string> {
  const password = await readHiddenPassword('Owner password (input hidden): ')
  const confirmation = await readHiddenPassword('Confirm password: ')
  if (password !== confirmation) {
    throw new Error('The password entries do not match.')
  }
  if (!isValidPassword(password)) {
    throw new Error(
      'The password must be at least 8 characters and contain uppercase, lowercase, and numeric characters.',
    )
  }
  return password
}

const database = process.env.DB_NAME ?? 'twc'
if (database !== 'twc') {
  throw new Error('The owner bootstrap only manages the twc database.')
}

const port = Number(process.env.DB_PORT ?? 3306)
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('DB_PORT must be an integer between 1 and 65535.')
}

const connection = await createConnection({
  host: process.env.DB_HOST ?? '127.0.0.1',
  port,
  database,
  user: requiredEnvironmentValue('DB_ADMIN_USER'),
  password: requiredEnvironmentValue('DB_ADMIN_PASSWORD'),
})

try {
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  let emailInput: string
  try {
    emailInput = await prompt.question('Initial owner email: ')
  } finally {
    prompt.close()
  }

  const username = normalizeEmail(emailInput)
  if (!username) {
    throw new Error('Enter a valid email address for the initial owner.')
  }

  const [accounts] = await connection.execute<AccountRow[]>(
    'SELECT id FROM `account` WHERE username = ? LIMIT 1',
    [username],
  )

  let accountId: number
  if (accounts.length > 0) {
    accountId = accounts[0].id
    console.log('The existing account was found; its password was not changed.')
  } else {
    const password = await promptForOwnerPassword()
    const passwordHash = await hashPassword(password)
    const [result] = await connection.execute<ResultSetHeader>(
      'INSERT INTO `account` (username, password_hash) VALUES (?, ?)',
      [username, passwordHash],
    )
    accountId = result.insertId
    console.log('The initial owner account was created.')
  }

  const [columns] = await connection.execute<ActivityAccountColumnRow[]>(
    `SELECT COLUMN_TYPE, IS_NULLABLE
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    ['twc', 'work_search_activities', 'account_id'],
  )
  if (
    columns.length === 0 ||
    !isUnsignedIntColumnType(columns[0].COLUMN_TYPE)
  ) {
    throw new Error(
      'Run pnpm db:setup first to prepare the activity ownership schema.',
    )
  }

  await connection.execute(
    'UPDATE work_search_activities SET account_id = ? WHERE account_id IS NULL',
    [accountId],
  )

  const [counts] = await connection.execute<CountRow[]>(
    'SELECT COUNT(*) AS unassignedCount FROM work_search_activities WHERE account_id IS NULL',
  )
  if (counts[0].unassignedCount > 0) {
    throw new Error(
      'Some activities remain unassigned; ownership was not finalized.',
    )
  }

  if (columns[0].IS_NULLABLE === 'YES') {
    await connection.query(
      'ALTER TABLE work_search_activities MODIFY COLUMN account_id INT UNSIGNED NOT NULL',
    )
  }

  const [constraints] = await connection.execute<ConstraintRow[]>(
    `SELECT CONSTRAINT_NAME
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
        AND REFERENCED_TABLE_NAME = ?`,
    ['twc', 'work_search_activities', 'account_id', 'account'],
  )
  if (constraints.length === 0) {
    await connection.query(
      `ALTER TABLE work_search_activities
        ADD CONSTRAINT fk_work_search_activities_account
        FOREIGN KEY (account_id) REFERENCES \`account\` (id)`,
    )
  }

  console.log(
    'Existing unassigned activities now belong to the initial owner. Email verification is required before sign-in.',
  )
} finally {
  await connection.end()
}
