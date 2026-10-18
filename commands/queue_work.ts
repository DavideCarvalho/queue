/*
 * @adonisjs/queue
 *
 * (c) AdonisJS
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

import { flags, BaseCommand } from '@adonisjs/core/ace'
import { resolveAdapters, resolveJobFactory } from '../src/utils.js'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import type { QueueConfig, QueueManagerConfig } from '../src/types/main.js'

export default class QueueWork extends BaseCommand {
  static commandName = 'queue:work'
  static description = 'Start processing jobs from the queue'

  static options: CommandOptions = {
    startApp: true,
    staysAlive: true,
  }

  @flags.string({ description: 'Comma-separated list of queues to process', alias: 'q' })
  declare queue?: string

  @flags.boolean({ description: 'Process the default queue and every queue of the config' })
  declare allQueues?: boolean

  @flags.number({ description: 'Number of jobs to process concurrently', alias: 'c' })
  declare concurrency?: number

  @flags.string({ description: 'Name of the adapter to process jobs from', alias: 'a' })
  declare adapter?: string

  async run() {
    if (this.queue && this.allQueues) {
      this.logger.error('Cannot use --queue and --all-queues flags together. Choose one of them')
      this.exitCode = 1
      return
    }

    const { Worker } = await import('@boringnode/queue')
    const config = this.app.config.get<QueueConfig>('queue')
    const queueManager = await this.app.container.make('queue.manager')
    const logger = await this.app.container.make('logger')

    /**
     * Commit the router to ensure all routes are registered.
     * This is required when jobs dispatch HTTP requests or
     * use URL generation.
     */
    const router = await this.app.container.make('router')
    router.commit()

    const resolvedAdapters = await resolveAdapters(config, this.app)
    const queues = this.queue
      ? this.queue.split(',').map((q) => q.trim())
      : this.allQueues
        ? [...new Set(['default', ...Object.keys(config.queues ?? {})])]
        : ['default']

    await queueManager.loadJobs()

    this.logger.info(`Starting worker for queues: ${queues.join(', ')}`)
    const jobFactory = resolveJobFactory(config, this.app)

    const workerConfig = {
      ...config,
      autoLoadJobs: false,
      adapters: resolvedAdapters,
      jobFactory,
      logger: config.logger ?? logger,
      worker: {
        ...config.worker,
        ...(this.concurrency !== undefined ? { concurrency: this.concurrency } : {}),
        ...(this.adapter !== undefined ? { adapter: this.adapter } : {}),
      },
    } satisfies QueueManagerConfig

    const worker = new Worker(workerConfig)

    /**
     * The app terminates on SIGTERM (see bin/console.ts). Stop the worker
     * first, or the provider would destroy the QueueManager under it.
     */
    this.app.terminating(() => worker.stop())

    /**
     * `start()` resolves once the worker stopped (SIGTERM, SIGINT) and every
     * running job is finalized. Terminating the app then destroys the
     * QueueManager and closes the connections it used (Redis, Lucid), so
     * the process can exit.
     */
    try {
      await worker.start(queues)
    } finally {
      await this.terminate()
    }
  }
}
