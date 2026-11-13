import express from 'express'
import { parseActivity } from './activityInput.ts'
import type { ActivityRepository } from './activityRepository.ts'

export function createApp(repository: ActivityRepository) {
  const app = express()

  app.use(express.json({ limit: '64kb' }))

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok' })
  })

  app.get('/api/activities', async (_request, response) => {
    try {
      const activities = await repository.listActivities()
      response.json({ activities })
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

  app.post('/api/activities', async (request, response) => {
    const parsedActivity = parseActivity(request.body)

    if (!parsedActivity.ok) {
      response.status(400).json({ error: 'Activity data is invalid.' })
      return
    }

    try {
      const id = await repository.createActivity(parsedActivity.value)
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
  })

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

  return app
}
