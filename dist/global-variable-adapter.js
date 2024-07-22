"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createGlobalVariableAdapter = void 0;
const local_storage_adapter_1 = require("./local-storage-adapter");
function createGlobalVariableAdapter(queueName) {
    window.__queueThat__ = window.__queueThat__ || {};
    const localStorageAdapter = (0, local_storage_adapter_1.createLocalStorageAdapter)(queueName);
    localStorageAdapter.save = save;
    localStorageAdapter.load = load;
    localStorageAdapter.remove = remove;
    localStorageAdapter.type = 'globalVariable';
    return localStorageAdapter;
    function save(key, data) {
        window.__queueThat__[key] = String(data);
    }
    function load(key) {
        return window.__queueThat__[key];
    }
    function remove(key) {
        delete window.__queueThat__[key];
    }
}
exports.createGlobalVariableAdapter = createGlobalVariableAdapter;
