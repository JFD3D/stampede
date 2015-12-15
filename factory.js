'use strict'

// We create and extend our reusable STAMPEDE object in startup plugin
{
  let os            = require('os')
  let fork          = require('child_process').fork
  let _S            = require('./plugins/startup')({ dir: __dirname }).init()
  let LOG           = _S.LOG('series master')
  let RUNNING       = false
  let _WORKERS      = []

  const CPUS        = os.cpus()
  const CORE_COUNT  = CPUS.length
  const MEM_TOTAL   = os.totalmem()
  const WORKER_MEM  = parseInt(MEM_TOTAL / 1024 / 1024 / CORE_COUNT)

  LOG('Starting...')

  function Worker(id) {
    let proc = fork(
      __dirname + "/worker.js", [id], {
        execArgv: ["--max_old_space_size=" + WORKER_MEM]
    })
    return {
      id    : id,
      proc  : proc
    }
  }

  function init() {
    for (var id = 1; id <= CORE_COUNT; id++) {
      _WORKERS.push(Worker(id))
    }
  }
  

}
