import path from 'node:path'
import type { Request, RequestHandler, Response } from 'express'
import express from 'express'
import { parseActivity } from './activityInput.ts'
import type { ActivityRepository } from './activityRepository.ts'
import {
  type AuthenticationService,
  hasTrustedOrigin,
  loadTrustedOrigins,
  requireAuthentication,
} from './auth.ts'
import { createAuthRouter } from './authRoutes.ts'

const activityPageSizes = new Set([5, 10, 25, 50, 100])
const defaultActivityPageSize = 5

function parsePage(value: unknown): number | null {
  if (value === undefined) {
    return 1
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    return null
  }

  const page = Number(value)
  return Number.isSafeInteger(page) ? page : null
}

function parsePageSize(value: unknown): number | null {
  if (value === undefined) {
    return defaultActivityPageSize
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    return null
  }

  const pageSize = Number(value)
  return activityPageSizes.has(pageSize) ? pageSize : null
}

function parseActivityId(value: unknown): number | null {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    return null
  }
  const id = Number(value)
  return Number.isSafeInteger(id) ? id : null
}

function parseActivityIds(value: unknown): number[] | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !('ids' in value) ||
    !Array.isArray(value.ids) ||
    value.ids.length < 1 ||
    value.ids.length > 10
  ) {
    return null
  }

  const rawIds: unknown[] = value.ids
  const ids: number[] = []
  for (const id of rawIds) {
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
      return null
    }
    ids.push(id)
  }

  return new Set(ids).size === ids.length ? ids : null
}

interface AppOptions {
  staticDirectory?: string
  authService: AuthenticationService
  allowedOrigins?: ReadonlySet<string>
  registrationEnabled?: boolean
}

function getAuthenticatedAccountId(
  request: Request,
  response: Response,
): number | null {
  const accountId = request.authenticatedUser?.id
  if (accountId === undefined) {
    response.status(401).json({ error: 'Authentication is required.' })
    return null
  }
  return accountId
}

export function createApp(repository: ActivityRepository, options: AppOptions) {
  const app = express()

  app.disable('x-powered-by')
  app.use((_request, response, next) => {
    response.setHeader('Referrer-Policy', 'no-referrer')
    next()
  })
  app.use(express.json({ limit: '64kb' }))
  app.use('/api', (_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store')
    next()
  })

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok' })
  })

  const allowedOrigins = options.allowedOrigins ?? loadTrustedOrigins()
  const requireTrustedActivityOrigin: RequestHandler = (
    request,
    response,
    next,
  ) => {
    if (!hasTrustedOrigin(request, allowedOrigins)) {
      response.status(403).json({ error: 'Request origin is not allowed.' })
      return
    }
    next()
  }

  app.use(
    '/api/auth',
    createAuthRouter(
      options.authService,
      allowedOrigins,
      options.registrationEnabled,
    ),
  )
  app.use('/api/activities', requireAuthentication(options.authService))

  app.get('/api/activities', async (request, response) => {
    const accountId = getAuthenticatedAccountId(request, response)
    if (accountId === null) {
      return
    }

    const page = parsePage(request.query.page)
    if (page === null) {
      response.status(400).json({ error: 'Page must be a positive integer.' })
      return
    }

    const pageSize = parsePageSize(request.query.pageSize)
    if (pageSize === null) {
      response.status(400).json({
        error: 'Page size must be one of 5, 10, 25, 50, or 100.',
      })
      return
    }

    try {
      const activitiesPage = await repository.listActivities(
        accountId,
        page,
        pageSize,
      )
      response.json(activitiesPage)
    } catch (error) {
      console.error(
        'Unable to load activities:',
        error instanceof Error ? error.message : 'Unknown database error',
      )
      response.status(500).json({
        error: 'Activities could not be loaded. Please try again.',
      })
    }
  })

  app.post(
    '/api/activities/export',
    requireTrustedActivityOrigin,
    async (request, response) => {
      const accountId = getAuthenticatedAccountId(request, response)
      if (accountId === null) {
        return
      }
      const ids = parseActivityIds(request.body)
      if (ids === null) {
        response.status(400).json({
          error:
            'Select between 1 and 10 activities using unique positive integer IDs.',
        })
        return
      }

      try {
        const activities = await repository.getActivitiesByIds(accountId, ids)
        if (activities.length !== ids.length) {
          response.status(404).json({
            error: 'One or more selected activities could not be found.',
          })
          return
        }

        response.json({ activities })
      } catch (error) {
        console.error(
          'Unable to load selected activities:',
          error instanceof Error ? error.message : 'Unknown database error',
        )
        response.status(500).json({
          error: 'Selected activities could not be loaded. Please try again.',
        })
      }
    },
  )

  app.post(
    '/api/activities',
    requireTrustedActivityOrigin,
    async (request, response) => {
      const accountId = getAuthenticatedAccountId(request, response)
      if (accountId === null) {
        return
      }
      const parsedActivity = parseActivity(request.body)

      if (!parsedActivity.ok) {
        response.status(400).json({ error: 'Activity data is invalid.' })
        return
      }

      try {
        const id = await repository.createActivity(
          accountId,
          parsedActivity.value,
        )
        response.status(201).json({ id })
      } catch (error) {
        console.error(
          'Unable to save activity:',
          error instanceof Error ? error.message : 'Unknown database error',
        )
        response.status(500).json({
          error: 'The activity could not be saved. Please try again.',
        })
      }
    },
  )

  app.put(
    '/api/activities/:id',
    requireTrustedActivityOrigin,
    async (request, response) => {
      const accountId = getAuthenticatedAccountId(request, response)
      if (accountId === null) {
        return
      }
      const id = parseActivityId(request.params.id)
      if (id === null) {
        response.status(400).json({ error: 'Activity ID is invalid.' })
        return
      }

      const parsedActivity = parseActivity(request.body)
      if (!parsedActivity.ok) {
        response.status(400).json({ error: 'Activity data is invalid.' })
        return
      }

      try {
        const updated = await repository.updateActivity(
          accountId,
          id,
          parsedActivity.value,
        )
        if (!updated) {
          response.status(404).json({ error: 'Activity was not found.' })
          return
        }

        response.json({ id })
      } catch (error) {
        console.error(
          'Unable to update activity:',
          error instanceof Error ? error.message : 'Unknown database error',
        )
        response.status(500).json({
          error: 'The activity could not be updated. Please try again.',
        })
      }
    },
  )

  app.delete(
    '/api/activities/:id',
    requireTrustedActivityOrigin,
    async (request, response) => {
      const accountId = getAuthenticatedAccountId(request, response)
      if (accountId === null) {
        return
      }
      const id = parseActivityId(request.params.id)
      if (id === null) {
        response.status(400).json({ error: 'Activity ID is invalid.' })
        return
      }

      try {
        const deleted = await repository.deleteActivity(accountId, id)
        if (!deleted) {
          response.status(404).json({ error: 'Activity was not found.' })
          return
        }
        response.json({ id })
      } catch (error) {
        console.error(
          'Unable to delete activity:',
          error instanceof Error ? error.message : 'Unknown database error',
        )
        response.status(500).json({
          error: 'The activity could not be deleted. Please try again.',
        })
      }
    },
  )

  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      next: express.NextFunction,
    ) => {
      const errorType =
        typeof error === 'object' && error !== null && 'type' in error
          ? error.type
          : undefined

      if (errorType === 'entity.parse.failed') {
        response.status(400).json({ error: 'Request body must be valid JSON.' })
        return
      }

      if (errorType === 'entity.too.large') {
        response.status(413).json({ error: 'Request body is too large.' })
        return
      }

      next(error)
    },
  )

  if (options.staticDirectory) {
    const staticDirectory = options.staticDirectory
    app.use(
      express.static(staticDirectory, {
        index: false,
      }),
    )

    app.get('/{*path}', (request, response, next) => {
      if (request.path === '/api' || request.path.startsWith('/api/')) {
        next()
        return
      }

      response.sendFile(path.join(staticDirectory, 'index.html'))
    })
  }

  app.use('/api', (_request, response) => {
    response.status(404).json({ error: 'API route was not found.' })
  })

  return app
}
