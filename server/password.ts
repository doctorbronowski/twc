import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto'

const saltLength = 16
const derivedKeyLength = 64
const scryptOptions = {
  N: 32_768,
  r: 8,
  p: 1,
  maxmem: 128 * 1024 * 1024,
}

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      derivedKeyLength,
      scryptOptions,
      (error, derivedKey) => {
        if (error) {
          reject(error)
          return
        }
        resolve(derivedKey)
      },
    )
  })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(saltLength)
  const derivedKey = await deriveKey(password, salt)
  return [
    'scrypt',
    scryptOptions.N,
    scryptOptions.r,
    scryptOptions.p,
    salt.toString('base64url'),
    derivedKey.toString('base64url'),
  ].join('$')
}

export async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  const [algorithm, nValue, rValue, pValue, saltValue, keyValue, extra] =
    passwordHash.split('$')
  if (
    algorithm !== 'scrypt' ||
    extra !== undefined ||
    Number(nValue) !== scryptOptions.N ||
    Number(rValue) !== scryptOptions.r ||
    Number(pValue) !== scryptOptions.p ||
    !saltValue ||
    !keyValue
  ) {
    return false
  }

  const salt = Buffer.from(saltValue, 'base64url')
  const expectedKey = Buffer.from(keyValue, 'base64url')
  if (salt.length !== saltLength || expectedKey.length !== derivedKeyLength) {
    return false
  }

  const actualKey = await deriveKey(password, salt)
  return timingSafeEqual(actualKey, expectedKey)
}
