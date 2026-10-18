/*
 * @adonisjs/queue
 *
 * (c) AdonisJS
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/// <reference types="@adonisjs/redis/redis_provider" />
/// <reference types="@adonisjs/lucid/database_provider" />

import { configProvider } from '@adonisjs/core'
import type { ConfigProvider } from '@adonisjs/core/types'
import type { RedisConnections } from '@adonisjs/redis/types'
import type { AdapterFactory } from '@boringnode/queue/types'
import type { Kysely } from 'kysely'
import type { KyselyAdapterOptions } from '@boringnode/queue/drivers/kysely_adapter'
import { sqlStorageMigration, withStorageMigration } from './storage_migration.js'

/**
 * Queue drivers that integrate with AdonisJS services.
 *
 * These drivers use `configProvider.create()` to lazily resolve
 * connections from the AdonisJS container.
 */
export const drivers: {
  /**
   * Redis driver using @adonisjs/redis connection.
   * Requires @adonisjs/redis to be installed and configured.
   */
  redis: (config?: { connectionName?: keyof RedisConnections }) => ConfigProvider<AdapterFactory>

  /**
   * Database driver using @adonisjs/lucid connection.
   * Requires @adonisjs/lucid to be installed and configured.
   */
  database: (config?: {
    connectionName?: string
    tableName?: string
  }) => ConfigProvider<AdapterFactory>

  /**
   * Database driver using an application-owned Kysely connection.
   */
  kysely: <DB>(
    connection: Kysely<DB>,
    options: KyselyAdapterOptions
  ) => ConfigProvider<AdapterFactory>

  /**
   * Sync driver for testing (executes jobs immediately).
   * No external dependencies required.
   */
  sync: () => ConfigProvider<AdapterFactory>
} = {
  redis(config) {
    return configProvider.create(async (app) => {
      const redis = await app.container.make('redis')
      const { redis: redisAdapter } = await import('@boringnode/queue/drivers/redis_adapter')

      const connection = redis.connection(config?.connectionName)
      return redisAdapter((connection as any).ioConnection)
    })
  },

  database(config) {
    return configProvider.create(async (app) => {
      const db = await app.container.make('lucid.db')
      const { knex, KnexQueueSchemaService } =
        await import('@boringnode/queue/drivers/knex_adapter')

      const connectionName = config?.connectionName || db.primaryConnectionName
      const client = db.connection(connectionName).getWriteClient()
      const dialect = client.client.dialect as string

      return withStorageMigration(
        knex(client, config?.tableName),
        sqlStorageMigration(new KnexQueueSchemaService(client), {
          jobsTable: config?.tableName ?? 'queue_jobs',
          schedulesTable: 'queue_schedules',
          wallClockDates: dialect === 'mysql' || dialect === 'mysql2',
        })
      )
    })
  },

  kysely(connection, options) {
    return configProvider.create(async () => {
      const { kysely: kyselyAdapter, KyselyQueueSchemaService } =
        await import('@boringnode/queue/drivers/kysely_adapter')

      return withStorageMigration(
        kyselyAdapter(connection, options),
        sqlStorageMigration(new KyselyQueueSchemaService(connection, options), {
          jobsTable: options.tableName ?? 'queue_jobs',
          schedulesTable: options.schedulesTableName ?? 'queue_schedules',
          wallClockDates: options.dialect !== 'sqlite',
        })
      )
    })
  },

  sync() {
    return configProvider.create(async () => {
      const { sync } = await import('@boringnode/queue/drivers/sync_adapter')
      return sync()
    })
  },
}
