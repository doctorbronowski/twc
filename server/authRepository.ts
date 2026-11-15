import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import type { Pool, PoolConnection } from 'mysql2/promise'
import type {
  AuthAccount,
  AuthenticatedSession,
  AuthRepository,
  CreateSessionResult,
  EmailChangeCompletionResult,
  EmailChangeRequestResult,
} from './auth.ts'

interface AccountRow extends RowDataPacket {
  id: number
  username: string
  pending_email: string | null
  password_hash: string
  email_verified_at: string | null
  disabled_at: string | null
}

interface EmailChangeTokenRow extends RowDataPacket {
  id: number
  accountId: number
  pendingEmail: string
  username: string
  accountPendingEmail: string | null
}

interface TokenRow extends RowDataPacket {
  id: number
  account_id: number
}

interface ActiveSessionRow extends RowDataPacket {
  id: number
  token_hash: Buffer
}

function isDuplicateEntry(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ER_DUP_ENTRY'
  )
}

function assertTokenLifetime(seconds: number) {
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 86_400) {
    throw new Error('Token lifetime must be between 1 second and 24 hours.')
  }
}

export class MySqlAuthRepository implements AuthRepository {
  private readonly pool: Pool

  constructor(pool: Pool) {
    this.pool = pool
  }

  async findAccountByUsername(username: string): Promise<AuthAccount | null> {
    const [rows] = await this.pool.execute<AccountRow[]>(
      `SELECT id, username, pending_email, password_hash, email_verified_at,
          disabled_at
        FROM \`account\`
        WHERE username = ?
        LIMIT 1`,
      [username],
    )
    const row = rows[0]
    return row
      ? {
          id: row.id,
          username: row.username,
          pendingEmail: row.pending_email,
          passwordHash: row.password_hash,
          emailVerifiedAt: row.email_verified_at,
          disabledAt: row.disabled_at,
        }
      : null
  }

  async findAccountById(id: number): Promise<AuthAccount | null> {
    const [rows] = await this.pool.execute<AccountRow[]>(
      `SELECT id, username, pending_email, password_hash, email_verified_at,
          disabled_at
        FROM \`account\`
        WHERE id = ?
        LIMIT 1`,
      [id],
    )
    const row = rows[0]
    return row
      ? {
          id: row.id,
          username: row.username,
          pendingEmail: row.pending_email,
          passwordHash: row.password_hash,
          emailVerifiedAt: row.email_verified_at,
          disabledAt: row.disabled_at,
        }
      : null
  }

  async createAccount(
    username: string,
    passwordHash: string,
  ): Promise<number | null> {
    try {
      const [result] = await this.pool.execute<ResultSetHeader>(
        'INSERT INTO `account` (username, password_hash) VALUES (?, ?)',
        [username, passwordHash],
      )
      return result.insertId
    } catch (error) {
      if (isDuplicateEntry(error)) {
        return null
      }
      throw error
    }
  }

  async storeEmailVerificationToken(
    accountId: number,
    tokenHash: Buffer,
    expiresAfterSeconds: number,
  ): Promise<void> {
    assertTokenLifetime(expiresAfterSeconds)
    const expiresAt = `DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ${expiresAfterSeconds} SECOND)`
    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      await connection.execute(
        `DELETE FROM account_email_verification_tokens
          WHERE consumed_at IS NOT NULL
            OR expires_at <= CURRENT_TIMESTAMP(3)`,
      )
      await connection.execute(
        `DELETE FROM account_email_verification_tokens
          WHERE account_id = ? AND consumed_at IS NULL`,
        [accountId],
      )
      await connection.execute(
        `INSERT INTO account_email_verification_tokens
          (account_id, token_hash, expires_at)
          VALUES (?, ?, ${expiresAt})`,
        [accountId, tokenHash],
      )
      await connection.commit()
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  }

  async consumeEmailVerificationToken(tokenHash: Buffer): Promise<boolean> {
    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      const [rows] = await connection.execute<TokenRow[]>(
        `SELECT id, account_id
          FROM account_email_verification_tokens
          WHERE token_hash = ? AND consumed_at IS NULL
            AND expires_at > CURRENT_TIMESTAMP(3)
          LIMIT 1
          FOR UPDATE`,
        [tokenHash],
      )
      const token = rows[0]
      if (!token) {
        await connection.commit()
        return false
      }

      await connection.execute(
        `UPDATE account_email_verification_tokens
          SET consumed_at = CURRENT_TIMESTAMP(3)
          WHERE id = ? AND consumed_at IS NULL`,
        [token.id],
      )
      await connection.execute(
        `UPDATE \`account\`
          SET email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP(3)),
              updated_at = CURRENT_TIMESTAMP(3)
          WHERE id = ?`,
        [token.account_id],
      )
      await connection.commit()
      return true
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  }

  async storePasswordResetToken(
    accountId: number,
    tokenHash: Buffer,
    expiresAfterSeconds: number,
  ): Promise<void> {
    assertTokenLifetime(expiresAfterSeconds)
    const expiresAt = `DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ${expiresAfterSeconds} SECOND)`
    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      await connection.execute(
        `DELETE FROM account_password_reset_tokens
          WHERE consumed_at IS NOT NULL
            OR expires_at <= CURRENT_TIMESTAMP(3)`,
      )
      await connection.execute(
        `DELETE FROM account_password_reset_tokens
          WHERE account_id = ? AND consumed_at IS NULL`,
        [accountId],
      )
      await connection.execute(
        `INSERT INTO account_password_reset_tokens
          (account_id, token_hash, expires_at)
          VALUES (?, ?, ${expiresAt})`,
        [accountId, tokenHash],
      )
      await connection.commit()
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  }

  async resetPasswordWithToken(
    tokenHash: Buffer,
    passwordHash: string,
  ): Promise<boolean> {
    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      const [rows] = await connection.execute<TokenRow[]>(
        `SELECT t.id, t.account_id
          FROM account_password_reset_tokens AS t
          INNER JOIN \`account\` AS a ON a.id = t.account_id
          WHERE t.token_hash = ? AND t.consumed_at IS NULL
            AND t.expires_at > CURRENT_TIMESTAMP(3)
            AND a.disabled_at IS NULL
          LIMIT 1
          FOR UPDATE`,
        [tokenHash],
      )
      const token = rows[0]
      if (!token) {
        await connection.commit()
        return false
      }

      await connection.execute(
        `UPDATE account_password_reset_tokens
          SET consumed_at = CURRENT_TIMESTAMP(3)
          WHERE id = ? AND consumed_at IS NULL`,
        [token.id],
      )
      await connection.execute(
        `UPDATE \`account\`
          SET password_hash = ?, updated_at = CURRENT_TIMESTAMP(3)
          WHERE id = ?`,
        [passwordHash, token.account_id],
      )
      await connection.execute('DELETE FROM sessions WHERE account_id = ?', [
        token.account_id,
      ])
      await connection.commit()
      return true
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  }

  async changePassword(
    accountId: number,
    currentPasswordHash: string,
    passwordHash: string,
    currentSessionTokenHash: Buffer,
  ): Promise<boolean> {
    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE \`account\`
          SET password_hash = ?, updated_at = CURRENT_TIMESTAMP(3)
          WHERE id = ? AND password_hash = ? AND disabled_at IS NULL`,
        [passwordHash, accountId, currentPasswordHash],
      )
      if (result.affectedRows !== 1) {
        await connection.commit()
        return false
      }

      await connection.execute(
        `DELETE FROM sessions
          WHERE account_id = ? AND token_hash <> ?`,
        [accountId, currentSessionTokenHash],
      )
      await connection.commit()
      return true
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  }

  async deactivateAccount(
    accountId: number,
    currentPasswordHash: string,
  ): Promise<boolean> {
    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      const [accounts] = await connection.execute<
        (RowDataPacket & {
          password_hash: string
          disabled_at: string | null
        })[]
      >(
        `SELECT password_hash, disabled_at
          FROM \`account\`
          WHERE id = ?
          LIMIT 1
          FOR UPDATE`,
        [accountId],
      )
      const account = accounts[0]
      if (
        !account ||
        account.disabled_at !== null ||
        account.password_hash !== currentPasswordHash
      ) {
        await connection.commit()
        return false
      }

      await connection.execute(
        `UPDATE \`account\`
          SET disabled_at = CURRENT_TIMESTAMP(3),
              pending_email = NULL,
              updated_at = CURRENT_TIMESTAMP(3)
          WHERE id = ? AND disabled_at IS NULL`,
        [accountId],
      )
      await connection.execute('DELETE FROM sessions WHERE account_id = ?', [
        accountId,
      ])
      await connection.execute(
        'DELETE FROM account_email_change_tokens WHERE account_id = ?',
        [accountId],
      )
      await connection.execute(
        'DELETE FROM account_password_reset_tokens WHERE account_id = ?',
        [accountId],
      )
      await connection.commit()
      return true
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  }

  private async replaceEmailChangeToken(
    connection: Awaited<ReturnType<Pool['getConnection']>>,
    accountId: number,
    pendingEmail: string,
    tokenHash: Buffer,
    expiresAfterSeconds: number,
  ): Promise<void> {
    const expiresAt = `DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ${expiresAfterSeconds} SECOND)`
    await connection.execute(
      `DELETE FROM account_email_change_tokens
        WHERE consumed_at IS NOT NULL
          OR expires_at <= CURRENT_TIMESTAMP(3)`,
    )
    await connection.execute(
      `DELETE FROM account_email_change_tokens
        WHERE account_id = ? AND consumed_at IS NULL`,
      [accountId],
    )
    await connection.execute(
      `INSERT INTO account_email_change_tokens
        (account_id, pending_email, token_hash, expires_at)
        VALUES (?, ?, ?, ${expiresAt})`,
      [accountId, pendingEmail, tokenHash],
    )
  }

  async requestEmailChange(
    accountId: number,
    currentPasswordHash: string,
    pendingEmail: string,
    tokenHash: Buffer,
    expiresAfterSeconds: number,
  ): Promise<EmailChangeRequestResult> {
    assertTokenLifetime(expiresAfterSeconds)
    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      const [accounts] = await connection.execute<
        (RowDataPacket & {
          username: string
          password_hash: string
          disabled_at: string | null
        })[]
      >(
        `SELECT username, password_hash, disabled_at
          FROM \`account\`
          WHERE id = ?
          LIMIT 1
          FOR UPDATE`,
        [accountId],
      )
      const account = accounts[0]
      if (
        !account ||
        account.disabled_at !== null ||
        account.password_hash !== currentPasswordHash
      ) {
        await connection.commit()
        return 'account-changed'
      }

      const [conflicts] = await connection.execute<RowDataPacket[]>(
        `SELECT id
          FROM \`account\`
          WHERE id <> ? AND (username = ? OR pending_email = ?)
          LIMIT 1
          FOR UPDATE`,
        [accountId, pendingEmail, pendingEmail],
      )
      if (conflicts.length > 0) {
        await connection.commit()
        return 'email-in-use'
      }

      await connection.execute(
        `UPDATE \`account\`
          SET pending_email = ?, updated_at = CURRENT_TIMESTAMP(3)
          WHERE id = ?`,
        [pendingEmail, accountId],
      )
      await this.replaceEmailChangeToken(
        connection,
        accountId,
        pendingEmail,
        tokenHash,
        expiresAfterSeconds,
      )
      await connection.commit()
      return 'stored'
    } catch (error) {
      await connection.rollback()
      if (isDuplicateEntry(error)) {
        return 'email-in-use'
      }
      throw error
    } finally {
      connection.release()
    }
  }

  async resendEmailChangeToken(
    accountId: number,
    pendingEmail: string,
    tokenHash: Buffer,
    expiresAfterSeconds: number,
  ): Promise<boolean> {
    assertTokenLifetime(expiresAfterSeconds)
    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      const [accounts] = await connection.execute<
        (RowDataPacket & {
          pending_email: string | null
          disabled_at: string | null
        })[]
      >(
        `SELECT pending_email, disabled_at
          FROM \`account\`
          WHERE id = ?
          LIMIT 1
          FOR UPDATE`,
        [accountId],
      )
      if (
        !accounts[0] ||
        accounts[0].disabled_at !== null ||
        accounts[0].pending_email !== pendingEmail
      ) {
        await connection.commit()
        return false
      }

      await this.replaceEmailChangeToken(
        connection,
        accountId,
        pendingEmail,
        tokenHash,
        expiresAfterSeconds,
      )
      await connection.commit()
      return true
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  }

  async cancelEmailChange(accountId: number): Promise<void> {
    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      await connection.execute(
        `UPDATE \`account\`
          SET pending_email = NULL, updated_at = CURRENT_TIMESTAMP(3)
          WHERE id = ?`,
        [accountId],
      )
      await connection.execute(
        'DELETE FROM account_email_change_tokens WHERE account_id = ?',
        [accountId],
      )
      await connection.commit()
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  }

  async completeEmailChange(
    tokenHash: Buffer,
    currentSessionTokenHash: Buffer | null,
  ): Promise<EmailChangeCompletionResult> {
    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      const [tokens] = await connection.execute<EmailChangeTokenRow[]>(
        `SELECT t.id, t.account_id AS accountId,
            t.pending_email AS pendingEmail, a.username,
            a.pending_email AS accountPendingEmail
          FROM account_email_change_tokens AS t
          INNER JOIN \`account\` AS a ON a.id = t.account_id
          WHERE t.token_hash = ? AND t.consumed_at IS NULL
            AND t.expires_at > CURRENT_TIMESTAMP(3)
            AND a.disabled_at IS NULL
          LIMIT 1
          FOR UPDATE`,
        [tokenHash],
      )
      const token = tokens[0]
      if (!token || token.accountPendingEmail !== token.pendingEmail) {
        await connection.commit()
        return { status: 'invalid-token' }
      }

      const [conflicts] = await connection.execute<RowDataPacket[]>(
        `SELECT id
          FROM \`account\`
          WHERE id <> ?
            AND (username = ? OR pending_email = ?)
          LIMIT 1
          FOR UPDATE`,
        [token.accountId, token.pendingEmail, token.pendingEmail],
      )
      if (conflicts.length > 0) {
        await connection.commit()
        return { status: 'email-in-use' }
      }

      const [updated] = await connection.execute<ResultSetHeader>(
        `UPDATE \`account\`
          SET username = ?, pending_email = NULL,
              email_verified_at = CURRENT_TIMESTAMP(3),
              updated_at = CURRENT_TIMESTAMP(3)
          WHERE id = ? AND pending_email = ?`,
        [token.pendingEmail, token.accountId, token.pendingEmail],
      )
      if (updated.affectedRows !== 1) {
        await connection.commit()
        return { status: 'invalid-token' }
      }

      await connection.execute(
        `UPDATE account_email_change_tokens
          SET consumed_at = CURRENT_TIMESTAMP(3)
          WHERE id = ? AND consumed_at IS NULL`,
        [token.id],
      )
      await connection.execute(
        `DELETE FROM account_email_change_tokens
          WHERE account_id = ? AND id <> ?`,
        [token.accountId, token.id],
      )

      let keepCurrentSession = false
      if (currentSessionTokenHash) {
        const [sessions] = await connection.execute<RowDataPacket[]>(
          `SELECT id
            FROM sessions
            WHERE account_id = ? AND token_hash = ?
              AND expires_at > CURRENT_TIMESTAMP(3)
            LIMIT 1
            FOR UPDATE`,
          [token.accountId, currentSessionTokenHash],
        )
        keepCurrentSession = sessions.length > 0
      }

      if (keepCurrentSession && currentSessionTokenHash) {
        await connection.execute(
          `DELETE FROM sessions
            WHERE account_id = ? AND token_hash <> ?`,
          [token.accountId, currentSessionTokenHash],
        )
      } else {
        await connection.execute('DELETE FROM sessions WHERE account_id = ?', [
          token.accountId,
        ])
      }

      await connection.commit()
      return {
        status: 'completed',
        oldEmail: token.username,
        newEmail: token.pendingEmail,
      }
    } catch (error) {
      await connection.rollback()
      if (isDuplicateEntry(error)) {
        return { status: 'email-in-use' }
      }
      throw error
    } finally {
      connection.release()
    }
  }

  private async getActiveSession(
    connection: PoolConnection,
    accountId: number,
  ): Promise<ActiveSessionRow | null> {
    const [sessions] = await connection.execute<ActiveSessionRow[]>(
      `SELECT id, token_hash
        FROM sessions
        WHERE account_id = ? AND expires_at > CURRENT_TIMESTAMP(3)
        ORDER BY id
        FOR UPDATE`,
      [accountId],
    )
    if (sessions.length > 1) {
      await connection.execute(
        'DELETE FROM sessions WHERE account_id = ? AND id <> ?',
        [accountId, sessions[0].id],
      )
    }
    return sessions[0] ?? null
  }

  async createSession(
    expectedAccount: AuthAccount,
    tokenHash: Buffer,
    existingSessionTokenHash: Buffer | null,
  ): Promise<CreateSessionResult> {
    await this.pool.execute(
      'DELETE FROM sessions WHERE expires_at <= CURRENT_TIMESTAMP(3)',
    )
    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      const [accounts] = await connection.execute<AccountRow[]>(
        `SELECT id, username, pending_email, password_hash, email_verified_at,
            disabled_at
          FROM \`account\`
          WHERE id = ?
          FOR UPDATE`,
        [expectedAccount.id],
      )
      const account = accounts[0]
      if (
        !account ||
        account.disabled_at !== null ||
        account.email_verified_at === null ||
        account.username !== expectedAccount.username ||
        account.password_hash !== expectedAccount.passwordHash
      ) {
        await connection.commit()
        return 'account-changed'
      }

      const activeSession = await this.getActiveSession(connection, account.id)
      if (
        activeSession &&
        (!existingSessionTokenHash ||
          !activeSession.token_hash.equals(existingSessionTokenHash))
      ) {
        await connection.commit()
        return 'active-session'
      }

      await connection.execute(
        'DELETE FROM sessions WHERE account_id = ? AND expires_at <= CURRENT_TIMESTAMP(3)',
        [account.id],
      )
      if (existingSessionTokenHash) {
        await connection.execute('DELETE FROM sessions WHERE token_hash = ?', [
          existingSessionTokenHash,
        ])
      }
      await connection.execute(
        `INSERT INTO sessions (account_id, token_hash, expires_at)
          VALUES (?, ?, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 15 MINUTE))`,
        [account.id, tokenHash],
      )
      await connection.commit()
      return 'created'
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  }

  async getAndTouchSession(
    tokenHash: Buffer,
  ): Promise<AuthenticatedSession | null> {
    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      const [rows] = await connection.execute<
        (RowDataPacket & { account_id: number })[]
      >('SELECT account_id FROM sessions WHERE token_hash = ? LIMIT 1', [
        tokenHash,
      ])
      if (!rows[0]) {
        await connection.commit()
        return null
      }
      const [accounts] = await connection.execute<AccountRow[]>(
        `SELECT id, username, pending_email, password_hash, email_verified_at,
            disabled_at
          FROM \`account\`
          WHERE id = ? AND disabled_at IS NULL
          FOR UPDATE`,
        [rows[0].account_id],
      )
      const account = accounts[0]
      if (!account) {
        await connection.commit()
        return null
      }

      const session = await this.getActiveSession(connection, account.id)
      if (!session?.token_hash.equals(tokenHash)) {
        await connection.commit()
        return null
      }

      await connection.execute(
        `UPDATE sessions
          SET last_activity_at = CURRENT_TIMESTAMP(3),
              expires_at = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 15 MINUTE)
          WHERE id = ?`,
        [session.id],
      )
      await connection.commit()
      return {
        sessionId: session.id,
        id: account.id,
        username: account.username,
      }
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  }

  async revokeSession(tokenHash: Buffer): Promise<void> {
    await this.pool.execute('DELETE FROM sessions WHERE token_hash = ?', [
      tokenHash,
    ])
  }
}
