export const WP2_D1_DATABASE_ANALYTICS_QUERY = `query Wp2D1DatabaseDaily(
  $accountTag: String!
  $date: Date!
  $databaseId: String!
) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      d1AnalyticsAdaptiveGroups(
        limit: 1000
        filter: { date_geq: $date, date_leq: $date, databaseId: $databaseId }
      ) {
        dimensions { date databaseId }
        sum { readQueries writeQueries rowsRead rowsWritten }
      }
    }
  }
}`;

export const WP2_D1_ACCOUNT_ANALYTICS_QUERY = `query Wp2D1AccountDaily(
  $accountTag: String!
  $date: Date!
) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      d1AnalyticsAdaptiveGroups(
        limit: 1000
        filter: { date_geq: $date, date_leq: $date }
      ) {
        dimensions { date databaseId }
        sum { readQueries writeQueries rowsRead rowsWritten }
      }
    }
  }
}`;

export const WP2_WORKERS_ANALYTICS_QUERY = `query Wp2WorkersWindow(
  $accountTag: string!
  $scriptName: string!
  $start: Time!
  $terminalityEndInclusive: Time!
) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      workersInvocationsAdaptive(
        limit: 10000
        filter: {
          scriptName: $scriptName
          datetime_geq: $start
          datetime_leq: $terminalityEndInclusive
        }
        orderBy: [datetime_ASC]
      ) {
        dimensions { datetime scriptName scriptVersion status }
        quantiles {
          cpuTimeP50 cpuTimeP99 durationP50
          memoryUsageBytesP50 memoryUsageBytesP99 memoryUsageBytesP999
        }
        sum { errors requests subrequests }
      }
    }
  }
}`;

export const WP2_QUEUE_ANALYTICS_QUERY = `query Wp2QueueWindow(
  $accountTag: string!
  $queueId: string!
  $start: Time!
  $endInclusive: Time!
  $terminalityEndInclusive: Time!
) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      queueDayOperations: queueMessageOperationsAdaptiveGroups(
        limit: 10000
        filter: {
          queueId: $queueId
          datetime_geq: $start
          datetime_leq: $endInclusive
        }
        orderBy: [datetime_ASC]
      ) {
        avg { lagTime retryCount }
        count
        dimensions { actionType consumerType datetime outcome queueId }
        max { messageSize }
        sum { billableOperations bytes }
      }
      queueTerminalOperations: queueMessageOperationsAdaptiveGroups(
        limit: 10000
        filter: {
          queueId: $queueId
          datetime_geq: $start
          datetime_leq: $terminalityEndInclusive
        }
        orderBy: [datetime_ASC]
      ) {
        avg { lagTime retryCount }
        count
        dimensions { actionType consumerType datetime outcome queueId }
        max { messageSize }
        sum { billableOperations bytes }
      }
      queueBacklogAdaptiveGroups(
        limit: 10000
        filter: {
          queueId: $queueId
          datetime_geq: $start
          datetime_leq: $terminalityEndInclusive
        }
        orderBy: [datetime_ASC]
      ) {
        avg { bytes messages }
        dimensions { datetime queueId }
      }
    }
  }
}`;

export const WP2_QUEUE_ACCOUNT_ANALYTICS_QUERY = `query Wp2QueueAccountWindow(
  $accountTag: string!
  $start: Time!
  $endInclusive: Time!
) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      queueMessageOperationsAdaptiveGroups(
        limit: 10000
        filter: {
          datetime_geq: $start
          datetime_leq: $endInclusive
        }
        orderBy: [datetime_ASC]
      ) {
        dimensions { datetime queueId }
        sum { billableOperations }
      }
    }
  }
}`;

export const WP2_ATTEMPT_COHORT_SQL = `SELECT
  messageId, scheduledTime, attempt, phase, outcome, startedAt, finishedAt,
  upstreamRequests, d1Queries, rowsReadObservedBeforeLedger,
  rowsWrittenObservedBeforeLedger, errorCode
FROM scheduler_attempts
WHERE (scheduledTime >= ? AND scheduledTime < ?)
   OR (startedAt >= ? AND startedAt < ?)
ORDER BY scheduledTime ASC, messageId ASC, attempt ASC`;
