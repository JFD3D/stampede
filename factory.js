'use strict'

// We create and extend our reusable STAMPEDE object in startup plugin
{
  let os            = require('os')
  let async         = require('async')
  let fork          = require('child_process').fork
  let _S            = require('./plugins/startup')({ dir: __dirname }).init()
  let LOG           = _S.LOG('factory')
  let _             = _S._
  let _SIM          = _S.current_simulator
  let _RUNNING      = 0
  let _COMPLETED    = 0
  let _WORKERS      = []
  let _RESULTS      = []
  let _CACHE        = {}
  let _SERIES

  const CPUS        = os.cpus()
  const WORKER_COUNT= (CPUS.length / 2)
  const MEM_TOTAL   = os.totalmem()
  const WORKER_MEM  = parseInt(MEM_TOTAL / 1024 / 1024 / WORKER_COUNT)

  function broadcast() {
    _RESULTS.sort((a, b) => (b[b.length-1].value - a[a.length-1].value))
    _S.controller.refreshSimulationResults(_RESULTS)
  }

  function Worker(id) {
    let current = {
      idx: null,
      completed: 0,
      started: 0,
      proc: null
    }
    let receive = message => {
      let content = message.content
      let channel = message.channel

      if (channel === 'completion') {
        _COMPLETED++
        _RUNNING--
        _RESULTS.push(content.result)
        _S.controller.notifyClient({
          message: 'Serie ('+
            ( 
              content.serie ? 
              (
                content.serie.options + ' / (' + 
                _COMPLETED + ' of ' + 
                _SERIES.array.length + ')'
              ) : 
              'Interactive'
            ) + ') | Ratio: ' + content.final_ratio + '.', 
          permanent: true
        })
        broadcast()
        assignSerie()
      }
      else {
        LOG('receive | message:', message)
      }
    }
    // Create and assign process
    let spawn      = () => {
      current.proc = fork(
        __dirname + '/worker.js', [id], {
          execArgv: ['--max_old_space_size=' + WORKER_MEM]
      })
      current.proc.on('message', receive)
      current.proc.on('error', error => {
        LOG(
          'worker(' + id + ') error:', error, 'Killing and resurrecting')
        current.proc.kill('SIGKILL')
        spawn()
      })

      current.proc.on('exit', (code, signal) => {
        LOG(
          'worker(' + id + ') code, signal:', code, signal, 
          'Resurrecting')
        spawn()
      })
    }
    let assignSerie = done => {
      let new_serie = _S.series.next()
      if (new_serie && new_serie.data_set) {
        new_serie.attributes = _SERIES.attributes
        LOG('assignSerie | id, data_set:', id, new_serie.data_set)
        send('serie', new_serie)
        _RUNNING++
        return finalize()
      }
      else if (_RUNNING === 0) {
        LOG(`Series finished (${_RUNNING})`)
        return finalize()
      }
      else {
        LOG(`Series still in process (${_RUNNING})`)
        return finalize()
      }
      function finalize(errs) {
        if (done) return done(errs)
      }
    }
    let kill        = signal => proc.kill(signal || 'SIGKILL')
    let send        = (channel, content) => {
      current.proc.send({ channel: channel, content: content})
      LOG('worker sending on channel:', channel)
    }

    // Initialize right away before listening
    spawn()

    return {
      id          : id,
      current     : current,
      assignSerie : assignSerie,
      mem         : 0,
      kill        : kill,
      send        : (channel, content) => {
        proc.send({ channel: channel, content: content})
      }
    }
  }

  function startAssignments() {
    async.eachSeries(_WORKERS, (worker, next) => {
      worker.assignSerie(next)
    }, () => {
      LOG('startAssignments | finalized')
    })
  }

  function init() {
    LOG('Starting...')
    _SIM.loadAllSets((errors, data_sets) => {
      _SERIES = _S.series.generate(data_sets)
      if (_SERIES.generated) {
        for (let id = 1; id <= WORKER_COUNT; id++) {
          _WORKERS.push(Worker(id))
        }
        startAssignments()
      }
      else {
        LOG('Series invalid | _SERIES:', _SERIES)
        process.exit(2)
      }
    })
  }

  _S.factory = {
    init: init
  }
  

}
