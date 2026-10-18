/*
 * @adonisjs/queue
 *
 * (c) AdonisJS
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

import type { AdapterFactory } from '@boringnode/queue/types'
import type {
  ScheduleDatesMigrationOptions,
  TextColumnsMigrationOptions,
} from '@boringnode/queue/drivers/knex_adapter'

export interface StorageMigrationOptions {
  /**
   * IANA time zone the processes of @boringnode/queue 0.7 wrote schedule
   * dates in. Required only to convert dates stored without a time zone.
   */
  timezone?: string

  /**
   * MySQL only. Session time zone of the 0.7 connections, when it differs
   * from the one of the migration connection, such as `'+02:00'`.
   */
  databaseTimeZone?: string
}

/**
 * Upgrades the tables of a SQL adapter to the schema `createJobsTable()` and
 * `createSchedulesTable()` create today. Returns the changes worth reporting.
 */
export type StorageMigration = (options: StorageMigrationOptions) => Promise<string[]>

/**
 * The upgrade methods `KnexQueueSchemaService` and `KyselyQueueSchemaService`
 * share. Each one is idempotent, and does nothing on an up to date table.
 */
interface QueueSchema {
  needsScheduleDatesMigration(tableName: string): Promise<boolean>
  migrateScheduleDates(tableName: string, options: ScheduleDatesMigrationOptions): Promise<void>
  migrateTextColumns(options: TextColumnsMigrationOptions): Promise<void>
  addDedupColumns(tableName: string): Promise<void>
}

const migrations = new WeakMap<AdapterFactory, StorageMigration>()

/**
 * Attach the storage migration of an adapter factory created by one of
 * the drivers, so `queue:migrate` can find it.
 */
export function withStorageMigration(factory: AdapterFactory, migration: StorageMigration) {
  migrations.set(factory, migration)
  return factory
}

export function getStorageMigration(factory: AdapterFactory) {
  return migrations.get(factory)
}

/**
 * Runs the upgrade steps of every release since @boringnode/queue 0.6:
 *
 * - 0.8: schedule dates stored as epoch milliseconds
 * - 0.8: LONGTEXT payload and error columns on MySQL
 * - 0.9: unique (queue, dedup_id) index
 */
export function sqlStorageMigration(
  schema: QueueSchema,
  tables: {
    jobsTable: string
    schedulesTable: string
    /** Whether the 0.7 schedule dates were stored without a time zone. */
    wallClockDates: boolean
  }
): StorageMigration {
  return async (options) => {
    const changes: string[] = []

    if (await schema.needsScheduleDatesMigration(tables.schedulesTable)) {
      if (tables.wallClockDates && !options.timezone) {
        throw new Error(
          `The schedules table "${tables.schedulesTable}" stores dates without a time zone. ` +
            'Pass the time zone the previous version wrote them in with --timezone, such as ' +
            '--timezone=Europe/Paris. A wrong value shifts every date for good.'
        )
      }

      await schema.migrateScheduleDates(tables.schedulesTable, options)
      changes.push(`converted the dates of "${tables.schedulesTable}" to epoch milliseconds`)
    }

    await schema.migrateTextColumns(tables)
    await schema.addDedupColumns(tables.jobsTable)

    return changes
  }
}
