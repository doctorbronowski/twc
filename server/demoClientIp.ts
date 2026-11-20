import { BlockList, isIP } from 'node:net'
import { normalizeIp } from './demoStartRateLimiter.ts'

export type DemoClientIpConfig =
  | { mode: 'direct'; production: boolean }
  | { mode: 'forwarded'; trustedProxy: string; production: boolean }

const privateAddresses = new BlockList()
for (const [address, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
] as const) {
  privateAddresses.addSubnet(address, bits, 'ipv4')
}
for (const [address, bits] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
] as const) {
  privateAddresses.addSubnet(address, bits, 'ipv6')
}

export function loadDemoClientIpConfig(
  environment: NodeJS.ProcessEnv = process.env,
): DemoClientIpConfig {
  const production = environment.NODE_ENV === 'production'
  if (production && environment.DEMO_CLIENT_IP_VERIFIED !== 'true') {
    throw new Error(
      'DEMO_CLIENT_IP_VERIFIED must be true after proxy verification.',
    )
  }
  if (environment.DEMO_CLIENT_IP_SOURCE === 'direct') {
    return { mode: 'direct', production }
  }
  if (environment.DEMO_CLIENT_IP_SOURCE === 'forwarded') {
    const proxy = environment.DEMO_TRUSTED_PROXY_IP
    if (!proxy) {
      throw new Error('DEMO_TRUSTED_PROXY_IP must identify the verified proxy.')
    }
    return { mode: 'forwarded', trustedProxy: normalizeIp(proxy), production }
  }
  throw new Error('DEMO_CLIENT_IP_SOURCE must be direct or forwarded.')
}

export function getDemoClientIp(
  remote: string | undefined,
  forwarded: string | undefined,
  config: DemoClientIpConfig,
): string | null {
  if (!remote) {
    return null
  }
  let address: string
  try {
    const normalizedRemote = normalizeIp(remote)
    if (config.mode === 'forwarded') {
      if (normalizedRemote !== config.trustedProxy) {
        return null
      }
      const last = forwarded?.split(',').at(-1)?.trim()
      if (!last) {
        return null
      }
      address = normalizeIp(last)
    } else {
      address = normalizedRemote
    }
  } catch {
    return null
  }
  const version = isIP(address)
  if (
    config.production &&
    privateAddresses.check(address, version === 4 ? 'ipv4' : 'ipv6')
  ) {
    return null
  }
  return address
}
