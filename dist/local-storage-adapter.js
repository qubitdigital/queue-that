"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLocalStorageAdapter = void 0;
const QUEUE_KEY = '* - Queue';
const ACTIVE_QUEUE_KEY = '* - Active Queue';
const BACKOFF_TIME_KEY = '* - Backoff Time';
const ERROR_COUNT_KEY = '* - Error Count';
const QUEUE_PROCESSING_KEY = '* - Queue Processing';
function createLocalStorageAdapter(queueName) {
    const queueKey = QUEUE_KEY.replace('*', queueName);
    const activeQueueKey = ACTIVE_QUEUE_KEY.replace('*', queueName);
    const backoffTimeKey = BACKOFF_TIME_KEY.replace('*', queueName);
    const errorCountKey = ERROR_COUNT_KEY.replace('*', queueName);
    const queueProcessingKey = QUEUE_PROCESSING_KEY.replace('*', queueName);
    let dirtyCache = true;
    let setPending = false;
    let queueCache = [];
    const adapter = {
        getQueue: getQueue,
        setQueue: setQueue,
        getErrorCount: getErrorCount,
        getBackoffTime: getBackoffTime,
        setErrorCount: setErrorCount,
        setBackoffTime: setBackoffTime,
        getActiveQueue: getActiveQueue,
        setActiveQueue: setActiveQueue,
        clearActiveQueue: clearActiveQueue,
        getQueueProcessing: getQueueProcessing,
        setQueueProcessing: setQueueProcessing,
        save: save,
        load: load,
        works: works,
        reset: reset,
        remove: remove,
        type: 'localStorage',
        flush: flush
    };
    return adapter;
    function flush() {
        dirtyCache = true;
        if (setPending) {
            adapter.save(queueKey, JSON.stringify(queueCache));
            setPending = false;
        }
    }
    function getQueue() {
        if (dirtyCache) {
            queueCache = JSON.parse(adapter.load(queueKey) || '[]');
            dirtyCache = false;
            setTimeout(flush, 0);
        }
        return queueCache;
    }
    function setQueue(queue) {
        queueCache = queue;
        dirtyCache = false;
        setPending = true;
        setTimeout(flush, 0);
    }
    function getErrorCount() {
        const count = adapter.load(errorCountKey);
        return count === undefined ? 0 : Number(count);
    }
    function getBackoffTime() {
        const time = adapter.load(backoffTimeKey);
        return time === undefined ? 0 : Number(time);
    }
    function setErrorCount(n) {
        adapter.save(errorCountKey, n);
    }
    function setBackoffTime(n) {
        adapter.save(backoffTimeKey, n);
    }
    function getActiveQueue() {
        if (adapter.load(activeQueueKey) === undefined) {
            return;
        }
        return JSON.parse(adapter.load(activeQueueKey));
    }
    function setActiveQueue(id) {
        adapter.save(activeQueueKey, JSON.stringify({
            id: id,
            ts: now()
        }));
    }
    function clearActiveQueue() {
        adapter.remove(activeQueueKey);
    }
    function getQueueProcessing() {
        return Boolean(Number(adapter.load(queueProcessingKey)));
    }
    function setQueueProcessing(isProcessing) {
        adapter.save(queueProcessingKey, Number(isProcessing));
    }
    function works() {
        let works = false;
        try {
            adapter.save('queue-that-works', 'anything');
            works = adapter.load('queue-that-works') === 'anything';
            adapter.remove('queue-that-works');
        }
        catch (e) { /* empty */ }
        return works;
    }
    function reset() {
        adapter.remove(activeQueueKey);
        adapter.remove(backoffTimeKey);
        adapter.remove(errorCountKey);
        adapter.remove(queueKey);
        adapter.remove(queueProcessingKey);
    }
}
exports.createLocalStorageAdapter = createLocalStorageAdapter;
function save(key, data) {
    window.localStorage[key] = String(data);
}
function load(key) {
    return window.localStorage[key];
}
function remove(key) {
    window.localStorage.removeItem(key);
}
function now() {
    return (new Date()).getTime();
}
