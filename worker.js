'use strict'

{
  let _S          = require('./module')
  let _ID         = process.argv[2] || "UNKNOWN"
  let LOG         = _S.LOG('worker(' + _ID + ')')
  let _status     = 'idle'
  let cache       = { data_sets: {} }
  let _SIM        = _S.current_simulator

  LOG('born')

  let receive = message => {
    let content = message.content
    let channel = message.channel

    LOG('receive | on channel:', channel)

    if (channel === 'serie' && content && content.options) {
      _status = 'busy'
      startOn(content)
    }
    else {
      process.send({ channel: 'status', content: {
        status   : _status,
        time     : Date.now()
      }})
    }
  }

  let startOn = serie => {
    LOG('startOn | serie:', serie)
    _SIM.current.series_attributes = serie.attributes
    _SIM.processSerie(serie, () => {
      LOG('serie Assigned')
    })

  }

  _SIM.beacon.on('serie_result', (content) => {
    // LOG('serie result sending content:', content)
    _status = 'idle'
    process.send({ channel: 'completion', content: content})
  })

  process.on('message', receive)
  process.on('exit', code => LOG('(' + _ID + ') About to exit with code:', code))
}

