import { createHash } from 'node:crypto'

export interface RateLimitPolicy {
  key: string
  limit: number
  windowMs: number
}

interface RateLimitBucket {
  count: number
  resetAt: number
}

export interface RateLimitResult {
  allowed: boolean
  retryAfterSeconds: number
}

export class AuthRateLimiter {
  private readonly buckets = new Map<string, RateLimitBucket>()
  private lastCleanupAt = 0

  consume(
    policies: readonly RateLimitPolicy[],
    now = Date.now(),
  ): RateLimitResult {
    this.cleanup(now)
    const hashedPolicies = policies.map((policy) => {
      if (
        !Number.isSafeInteger(policy.limit) ||
        policy.limit < 1 ||
        !Number.isSafeInteger(policy.windowMs) ||
        policy.windowMs < 1
      ) {
        throw new Error(
          'Rate-limit policies must have positive integer limits.',
        )
      }
      return {
        ...policy,
        key: createHash('sha256').update(policy.key).digest('hex'),
      }
    })

    const limitedBuckets = hashedPolicies
      .map((policy) => ({
        policy,
        bucket: this.buckets.get(policy.key),
      }))
      .filter(
        ({ policy, bucket }) =>
          bucket && bucket.resetAt > now && bucket.count >= policy.limit,
      )

    if (limitedBuckets.length > 0) {
      const resetAt = Math.max(
        ...limitedBuckets.map(({ bucket }) => bucket?.resetAt ?? now),
      )
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
      }
    }

    for (const policy of hashedPolicies) {
      const bucket = this.buckets.get(policy.key)
      if (!bucket || bucket.resetAt <= now) {
        this.buckets.set(policy.key, {
          count: 1,
          resetAt: now + policy.windowMs,
        })
      } else {
        bucket.count += 1
      }
    }

    return { allowed: true, retryAfterSeconds: 0 }
  }

  private cleanup(now: number) {
    if (now - this.lastCleanupAt < 60_000 && this.buckets.size < 10_000) {
      return
    }
    this.lastCleanupAt = now
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key)
      }
    }

    if (this.buckets.size >= 10_000) {
      const oldest = [...this.buckets.entries()]
        .sort((left, right) => left[1].resetAt - right[1].resetAt)
        .slice(0, this.buckets.size - 5_000)
      for (const [key] of oldest) {
        this.buckets.delete(key)
      }
    }
  }
}
