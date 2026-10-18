/*
 * @adonisjs/queue
 *
 * (c) AdonisJS
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

import { flags, BaseCommand } from '@adonisjs/core/ace'
import { resolveAdapters } from '../src/utils.js'
import { getStorageMigration } from '../src/storage_migration.js'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import type { QueueConfig } from '../src/types/main.js'

/**
 * Upgrades the storage of each adapter to the format of the installed
 * @boringnode/queue. Every step detects whether it is needed, so the
 * command does nothing on a storage that is already up to date, such as
 * tables created by the migration of a fresh install.
 */
export default class QueueMigrate extends BaseCommand {
  static commandName = 'queue:migrate'
  static description = 'Upgrade the queue storage created by a previous version'

  static options: CommandOptions = {
    startApp: true,
  }

  @flags.string({ description: 'Name of the adapter to migrate. Defaults to all', alias: 'a' })
  declare adapter?: string

  @flags.string({ description: 'Time zone the previous version wrote schedule dates in' })
  declare timezone?: string

  @flags.string({ description: 'MySQL session time zone of the previous version' })
  declare databaseTimezone?: string

  @flags.boolean({ description: 'Skip the confirmation prompt in production' })
  declare force?: boolean

  async run() {
    const config = this.app.config.get<QueueConfig>('queue')
    const names = this.adapter ? [this.adapter] : Object.keys(config.adapters)

    if (this.adapter && !(this.adapter in config.adapters)) {
      this.logger.error(`Adapter "${this.adapter}" is not configured`)
      this.exitCode = 1
      return
    }

    if (this.app.inProduction && !this.force) {
      const confirmed = await this.prompt.confirm(
        'Stop every process running the previous version before migrating. Continue?'
      )
      if (!confirmed) {
        return
      }
    }

    const queueManager = await this.app.container.make('queue.manager')
    const factories = await resolveAdapters(config, this.app)

    for (const name of names) {
      try {
        const migration = getStorageMigration(factories[name])
        const changes = migration
          ? await migration({ timezone: this.timezone, databaseTimeZone: this.databaseTimezone })
          : []

        /**
         * Moves the schedules of Redis to their 0.8 keys. On SQL adapters,
         * it checks the schedule dates are migrated.
         */
        await queueManager.use(name).migrate()

        for (const change of changes) {
          this.logger.info(`${name}: ${change}`)
        }
        this.logger.success(`${name}: up to date`)
      } catch (error) {
        this.logger.error(`${name}: ${error.message}`)
        this.exitCode = 1
      }
    }
  }
}
