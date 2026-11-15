import nodemailer from 'nodemailer'
import type { AuthMailer } from './auth.ts'

function requiredEnvironmentValue(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} must be configured to send account email.`)
  }
  return value
}

function readMailConfiguration() {
  const host = requiredEnvironmentValue('SMTP_HOST')
  const port = Number(requiredEnvironmentValue('SMTP_PORT'))
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('SMTP_PORT must be an integer between 1 and 65535.')
  }

  const secureValue = requiredEnvironmentValue('SMTP_SECURE')
  if (secureValue !== 'true' && secureValue !== 'false') {
    throw new Error('SMTP_SECURE must be either true or false.')
  }

  const baseUrl = new URL(requiredEnvironmentValue('APP_BASE_URL'))
  if (
    (baseUrl.protocol !== 'https:' && baseUrl.protocol !== 'http:') ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.pathname !== '/' ||
    baseUrl.search ||
    baseUrl.hash
  ) {
    throw new Error('APP_BASE_URL must be an HTTP(S) origin.')
  }

  return {
    host,
    port,
    secure: secureValue === 'true',
    auth: {
      user: requiredEnvironmentValue('SMTP_USER'),
      pass: requiredEnvironmentValue('SMTP_PASSWORD'),
    },
    from: requiredEnvironmentValue('SMTP_FROM'),
    baseUrl,
  }
}

export function buildEmailActionUrl(
  baseUrl: URL,
  path: '/verify-email' | '/reset-password' | '/verify-email-change',
  token: string,
): string {
  const url = new URL(path, baseUrl)
  url.hash = token
  return url.toString()
}

export class SmtpEmailAdapter implements AuthMailer {
  private config:
    | {
        transporter: ReturnType<typeof nodemailer.createTransport>
        baseUrl: URL
        from: string
      }
    | undefined

  private getTransporter() {
    if (this.config) {
      return this.config
    }

    const config = readMailConfiguration()
    this.config = {
      transporter: nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: config.auth,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      }),
      baseUrl: config.baseUrl,
      from: config.from,
    }
    return this.config
  }

  async sendVerificationEmail(username: string, token: string): Promise<void> {
    const { transporter, baseUrl, from } = this.getTransporter()
    await transporter.sendMail({
      from,
      to: username,
      subject: 'Verify your TWC account',
      text: `Use this link to verify your TWC account. The link expires in 24 hours:\n\n${buildEmailActionUrl(baseUrl, '/verify-email', token)}`,
    })
  }

  async sendPasswordResetEmail(username: string, token: string): Promise<void> {
    const { transporter, baseUrl, from } = this.getTransporter()
    await transporter.sendMail({
      from,
      to: username,
      subject: 'Reset your TWC password',
      text: `Use this link to reset your TWC password. The link expires in 30 minutes:\n\n${buildEmailActionUrl(baseUrl, '/reset-password', token)}`,
    })
  }

  async sendEmailChangeVerificationEmail(
    email: string,
    token: string,
  ): Promise<void> {
    const { transporter, baseUrl, from } = this.getTransporter()
    await transporter.sendMail({
      from,
      to: email,
      subject: 'Verify your new TWC account email',
      text: `Use this link to verify your new TWC account email. The link expires in 24 hours:\n\n${buildEmailActionUrl(baseUrl, '/verify-email-change', token)}`,
    })
  }

  async sendEmailChangeNotification(
    oldEmail: string,
    newEmail: string,
  ): Promise<void> {
    const { transporter, from } = this.getTransporter()
    await transporter.sendMail({
      from,
      to: oldEmail,
      subject: 'Your TWC account email changed',
      text: `The email address for your TWC account was changed to ${newEmail}. If you did not make this change, contact support immediately.`,
    })
  }
}
