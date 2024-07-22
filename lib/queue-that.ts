import {createLocalStorageAdapter} from "./local-storage-adapter";
import {createGlobalVariableAdapter} from "./global-variable-adapter.js";
import consola from "consola";

const DEFAULT_QUEUE_LABEL = 'Queue That'
const BACKOFF_TIME = 1000
const QUEUE_GROUP_TIME = 100
const PROCESS_TIMEOUT = 2000
const DEFAULT_BATCH_SIZE = 20
const ACTIVE_QUEUE_TIMEOUT = 2500


declare global {
  interface Window {
    __queueThat__: Record<string, string>
  }
}

export interface QueueOptions<T> {
  process: (batch: T[], callback: (err?: Error) => void) => void
  batchSize?: number
  label?: string
  trim?: (queue: T[]) => T[]
  queueGroupTime?: number
  backoffTime?: number
  processTimeout?: number
  activeQueueTimeout?: number
}

export default function createQueueThat<T> (options: QueueOptions<T>) {
  if (!options.process) {
    throw new Error('a process function is required')
  }
  options.batchSize = options.batchSize || DEFAULT_BATCH_SIZE
  options.label = options.label || DEFAULT_QUEUE_LABEL
  options.trim = options.trim || identity
  options.queueGroupTime = options.queueGroupTime || QUEUE_GROUP_TIME
  options.backoffTime = options.backoffTime || BACKOFF_TIME
  options.processTimeout = options.processTimeout || PROCESS_TIMEOUT
  options.activeQueueTimeout = options.activeQueueTimeout || ACTIVE_QUEUE_TIMEOUT

  if (options.processTimeout > options.activeQueueTimeout) {
    throw new Error('active queue timeout must be greater than process timeout')
  }

  // eslint-disable-next-line prefer-const -- we need to assign to this later
  let checkTimer: number | null = null;
  let newQueueTimer: number | null = null;
  let processTimer: number | null = null;
  let flushTimer: number | null = null;
  let processingTasks = false
  let checkScheduled = false
  const queueId = Math.random() + now()
  let flushScheduled = false
  let destroyed = false

  let storageAdapter = createLocalStorageAdapter<T>(options.label)
  if (!storageAdapter.works()) {
    storageAdapter = createGlobalVariableAdapter<T>(options.label)
  }

  queueThat.storageAdapter = storageAdapter
  queueThat.options = options
  queueThat.flush = flush
  queueThat.destroy = function destroy () {
    destroyed = true
    if(checkTimer) clearTimeout(checkTimer)
    if(processTimer) clearTimeout(processTimer)
    if(newQueueTimer) clearTimeout(newQueueTimer)
    if(flushTimer) clearTimeout(flushTimer)
  }
  queueThat.flushQueueCache = queueThat.storageAdapter.flush
  deactivateOnUnload(queueId)

  consola.info('Initialized with queue ID ' + queueId)

  checkQueueDebounce()
  /**
   * This check is in case the queue is initialised quickly after
   * the queue from the previous page expires.
   */
  newQueueTimer = setTimeout(checkQueue, ACTIVE_QUEUE_TIMEOUT)

  return queueThat

  function queueThat (item: T) {
    const queue = storageAdapter.getQueue()
    queue.push(item)
    storageAdapter.setQueue(options.trim!(queue))

    consola.info('Item queued')

    checkQueueDebounce()
  }

  function flush () {
    if (flushScheduled) return

    checkScheduled = true
    flushScheduled = true
    if(checkTimer) clearTimeout(checkTimer)

    flushTimer = setTimeout(function checkQueueAndReset () {
      checkQueue()
      checkScheduled = false
      flushScheduled = false
    })
  }

  function checkQueueDebounce () {
    if (checkScheduled) return
    checkScheduled = true
    checkTimer = setTimeout(function checkQueueAndReset () {
      checkQueue()
      checkScheduled = false
    }, options.queueGroupTime!)
  }

  function checkQueue () {
    consola.info('Checking queue')

    if (processingTasks) return

    const backoffTime = storageAdapter.getBackoffTime() - now()
    if (backoffTime > 0) {
      setTimeout(checkQueue, backoffTime)
      return
    }

    const lastActiveQueue = getLastActiveQueueInfo()
    if (lastActiveQueue.active && lastActiveQueue.id !== queueId) return
    if (lastActiveQueue.id !== queueId) consola.info('Switching active queue to ' + queueId)

    // Need to always do this to keep active
    storageAdapter.setActiveQueue(queueId)

    const batch = storageAdapter.getQueue().slice(0, options.batchSize!)
    if (batch.length === 0) {
      return
    }

    const batchContainer: {
      containsRepeatedItems: boolean,
      batch: T[]
    } = {
      containsRepeatedItems: storageAdapter.getQueueProcessing(),
      batch: batch
    }

    consola.info('Processing queue batch of ' + batch.length + ' items')
    if (batchContainer.containsRepeatedItems) consola.info('Batch contains repeated items')
    else consola.info('Batch does not contain repeated items')

    const itemsProcessing = batch.length
    let timeout = false
    let finished = false

    options.process(batch, function (err?: Error) {
      if (timeout || destroyed) return
      processingTasks = false
      finished = true
      if (err) {
        processError(err)
        checkQueueDebounce()
        return
      }

      storageAdapter.setErrorCount(0)
      const queue = rest(storageAdapter.getQueue(), itemsProcessing)
      storageAdapter.setQueue(queue)

      storageAdapter.setQueueProcessing(false)
      storageAdapter.flush()

      consola.info('Queue processed, ' + queue.length + ' remaining items')

      checkQueueDebounce()
    })

    processTimer = setTimeout(function () {
      if (finished || destroyed) return
      timeout = true
      processingTasks = false
      processError(new Error('Task timeout'))
    }, options.processTimeout!)

    processingTasks = true
    storageAdapter.setQueueProcessing(true)
    storageAdapter.flush()
  }

  function processError (err: Error) {
    consola.error('Process error, backing off (' + err.message + ')')
    const errorCount = storageAdapter.getErrorCount() + 1
    storageAdapter.setErrorCount(errorCount)
    storageAdapter.setBackoffTime(now() + options.backoffTime! * Math.pow(2, errorCount - 1))
    consola.warn('backoff time ' + (storageAdapter.getBackoffTime() - now()) + 'ms')
  }

  function getLastActiveQueueInfo () {
    const info: {
      id?: number
      active: boolean
    } = {
      active: false
    }
    const activeinstance = storageAdapter.getActiveQueue()
    if (activeinstance === undefined) {
      info.active = false
      return info
    }
    info.id = activeinstance.id
    const timeSinceActive = now() - activeinstance.ts
    info.active = !(timeSinceActive >= ACTIVE_QUEUE_TIMEOUT)
    return info
  }

  function now () {
    return (new Date()).getTime()
  }

  /**
   * Deactivating the queue on beforeunload is not
   * necessary but is better/quicker than waiting for a
   * few seconds for the queue to be unresponsive.
   */
  function deactivateOnUnload (queueId: number) {
    if (window.addEventListener) {
      window.addEventListener('beforeunload', deactivate)
    }

    function deactivate () {
      const activeQueue = storageAdapter.getActiveQueue()
      if (activeQueue && activeQueue.id === queueId) {
        queueThat.destroy()
        storageAdapter.clearActiveQueue()
        consola.info('deactivated on page unload')
      }
    }
  }

  function identity (input: T[]) {
    return input
  }

  function rest(array: T[], n: number) {
    return Array.prototype.slice.call(array, n)
  }

}

