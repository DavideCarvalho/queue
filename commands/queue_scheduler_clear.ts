/*
 * @adonisjs/queue
 *
 * (c) AdonisJS
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

export default class QueueSchedulerClear extends BaseCommand {
  static commandName = 'queue:scheduler:clear'
  static description = 'Remove all scheduled jobs'

  static options: CommandOptions = {
    startApp: true,
  }

  @flags.string({ description: 'Name of the adapter storing the schedules', alias: 'a' })
  declare adapter?: string

  async run() {
    const { Schedule } = await import('@boringnode/queue')

    const schedules = await Schedule.list({}, { adapter: this.adapter })

    if (schedules.length === 0) {
      this.logger.info('No schedules to clear')
      return
    }

    if (this.app.inProduction) {
      const confirmed = await this.prompt.confirm(
        `Are you sure you want to remove all ${schedules.length} schedules?`
      )

      if (!confirmed) {
        return
      }
    }

    for (const schedule of schedules) {
      await schedule.delete()
    }

    this.logger.success(`Removed ${schedules.length} schedules successfully`)
  }
}
