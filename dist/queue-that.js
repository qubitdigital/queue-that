"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const local_storage_adapter_1 = require("./local-storage-adapter");
const global_variable_adapter_js_1 = require("./global-variable-adapter.js");
const consola_1 = __importDefault(require("consola"));
const DEFAULT_QUEUE_LABEL = 'Queue That';
const BACKOFF_TIME = 1000;
const QUEUE_GROUP_TIME = 100;
const PROCESS_TIMEOUT = 2000;
const DEFAULT_BATCH_SIZE = 20;
const ACTIVE_QUEUE_TIMEOUT = 2500;
function createQueueThat(options) {
    if (!options.process) {
        throw new Error('a process function is required');
    }
    options.batchSize = options.batchSize || DEFAULT_BATCH_SIZE;
    options.label = options.label || DEFAULT_QUEUE_LABEL;
    options.trim = options.trim || identity;
    options.queueGroupTime = options.queueGroupTime || QUEUE_GROUP_TIME;
    options.backoffTime = options.backoffTime || BACKOFF_TIME;
    options.processTimeout = options.processTimeout || PROCESS_TIMEOUT;
    options.activeQueueTimeout = options.activeQueueTimeout || ACTIVE_QUEUE_TIMEOUT;
    if (options.processTimeout > options.activeQueueTimeout) {
        throw new Error('active queue timeout must be greater than process timeout');
    }
    // eslint-disable-next-line prefer-const -- we need to assign to this later
    let checkTimer = null;
    let newQueueTimer = null;
    let processTimer = null;
    let flushTimer = null;
    let processingTasks = false;
    let checkScheduled = false;
    const queueId = Math.random() + now();
    let flushScheduled = false;
    let destroyed = false;
    let storageAdapter = (0, local_storage_adapter_1.createLocalStorageAdapter)(options.label);
    if (!storageAdapter.works()) {
        storageAdapter = (0, global_variable_adapter_js_1.createGlobalVariableAdapter)(options.label);
    }
    queueThat.storageAdapter = storageAdapter;
    queueThat.options = options;
    queueThat.flush = flush;
    queueThat.destroy = function destroy() {
        destroyed = true;
        if (checkTimer)
            clearTimeout(checkTimer);
        if (processTimer)
            clearTimeout(processTimer);
        if (newQueueTimer)
            clearTimeout(newQueueTimer);
        if (flushTimer)
            clearTimeout(flushTimer);
    };
    queueThat.flushQueueCache = queueThat.storageAdapter.flush;
    deactivateOnUnload(queueId);
    consola_1.default.info('Initialized with queue ID ' + queueId);
    checkQueueDebounce();
    /**
     * This check is in case the queue is initialised quickly after
     * the queue from the previous page expires.
     */
    newQueueTimer = setTimeout(checkQueue, ACTIVE_QUEUE_TIMEOUT);
    return queueThat;
    function queueThat(item) {
        const queue = storageAdapter.getQueue();
        queue.push(item);
        storageAdapter.setQueue(options.trim(queue));
        consola_1.default.info('Item queued');
        checkQueueDebounce();
    }
    function flush() {
        if (flushScheduled)
            return;
        checkScheduled = true;
        flushScheduled = true;
        if (checkTimer)
            clearTimeout(checkTimer);
        flushTimer = setTimeout(function checkQueueAndReset() {
            checkQueue();
            checkScheduled = false;
            flushScheduled = false;
        });
    }
    function checkQueueDebounce() {
        if (checkScheduled)
            return;
        checkScheduled = true;
        checkTimer = setTimeout(function checkQueueAndReset() {
            checkQueue();
            checkScheduled = false;
        }, options.queueGroupTime);
    }
    function checkQueue() {
        consola_1.default.info('Checking queue');
        if (processingTasks)
            return;
        const backoffTime = storageAdapter.getBackoffTime() - now();
        if (backoffTime > 0) {
            setTimeout(checkQueue, backoffTime);
            return;
        }
        const lastActiveQueue = getLastActiveQueueInfo();
        if (lastActiveQueue.active && lastActiveQueue.id !== queueId)
            return;
        if (lastActiveQueue.id !== queueId)
            consola_1.default.info('Switching active queue to ' + queueId);
        // Need to always do this to keep active
        storageAdapter.setActiveQueue(queueId);
        const batch = storageAdapter.getQueue().slice(0, options.batchSize);
        if (batch.length === 0) {
            return;
        }
        const batchContainer = {
            containsRepeatedItems: storageAdapter.getQueueProcessing(),
            batch: batch
        };
        consola_1.default.info('Processing queue batch of ' + batch.length + ' items');
        if (batchContainer.containsRepeatedItems)
            consola_1.default.info('Batch contains repeated items');
        else
            consola_1.default.info('Batch does not contain repeated items');
        const itemsProcessing = batch.length;
        let timeout = false;
        let finished = false;
        options.process(batch, function (err) {
            if (timeout || destroyed)
                return;
            processingTasks = false;
            finished = true;
            if (err) {
                processError(err);
                checkQueueDebounce();
                return;
            }
            storageAdapter.setErrorCount(0);
            const queue = rest(storageAdapter.getQueue(), itemsProcessing);
            storageAdapter.setQueue(queue);
            storageAdapter.setQueueProcessing(false);
            storageAdapter.flush();
            consola_1.default.info('Queue processed, ' + queue.length + ' remaining items');
            checkQueueDebounce();
        });
        processTimer = setTimeout(function () {
            if (finished || destroyed)
                return;
            timeout = true;
            processingTasks = false;
            processError(new Error('Task timeout'));
        }, options.processTimeout);
        processingTasks = true;
        storageAdapter.setQueueProcessing(true);
        storageAdapter.flush();
    }
    function processError(err) {
        consola_1.default.error('Process error, backing off (' + err.message + ')');
        const errorCount = storageAdapter.getErrorCount() + 1;
        storageAdapter.setErrorCount(errorCount);
        storageAdapter.setBackoffTime(now() + options.backoffTime * Math.pow(2, errorCount - 1));
        consola_1.default.warn('backoff time ' + (storageAdapter.getBackoffTime() - now()) + 'ms');
    }
    function getLastActiveQueueInfo() {
        const info = {
            active: false
        };
        const activeinstance = storageAdapter.getActiveQueue();
        if (activeinstance === undefined) {
            info.active = false;
            return info;
        }
        info.id = activeinstance.id;
        const timeSinceActive = now() - activeinstance.ts;
        info.active = !(timeSinceActive >= ACTIVE_QUEUE_TIMEOUT);
        return info;
    }
    function now() {
        return (new Date()).getTime();
    }
    /**
     * Deactivating the queue on beforeunload is not
     * necessary but is better/quicker than waiting for a
     * few seconds for the queue to be unresponsive.
     */
    function deactivateOnUnload(queueId) {
        if (window.addEventListener) {
            window.addEventListener('beforeunload', deactivate);
        }
        function deactivate() {
            const activeQueue = storageAdapter.getActiveQueue();
            if (activeQueue && activeQueue.id === queueId) {
                queueThat.destroy();
                storageAdapter.clearActiveQueue();
                consola_1.default.info('deactivated on page unload');
            }
        }
    }
}
exports.default = createQueueThat;
function identity(input) {
    return input;
}
function rest(array, n) {
    return Array.prototype.slice.call(array, n);
}
