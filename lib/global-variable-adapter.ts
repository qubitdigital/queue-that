import { createLocalStorageAdapter } from './local-storage-adapter'




export function createGlobalVariableAdapter (queueName: string) {
  window.__queueThat__ = window.__queueThat__ || {}

  const localStorageAdapter = createLocalStorageAdapter(queueName)
  localStorageAdapter.save = save
  localStorageAdapter.load = load
  localStorageAdapter.remove = remove
  localStorageAdapter.type = 'globalVariable'

  return localStorageAdapter

  function save (key: string, data: string|number|boolean|object) {
    window.__queueThat__[key] = String(data)
  }

  function load (key:string) {
    return window.__queueThat__[key]
  }

  function remove (key:string) {
    delete window.__queueThat__[key]
  }
}
