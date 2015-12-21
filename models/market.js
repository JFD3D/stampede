"use strict"

module.exports = function(_S) {
  var LOG           = _S.LOG("market")
  var email         = _S.email
  var perf_timers   = _S.perf_timers
  var TICKER_PROPS  = ["bid", "low", "high", "volume", "ask"]
  var ERR_EMAIL_SENT

  perf_timers.market_assignment   = 0
  perf_timers.market_tick         = 0

  function Market() {
    let current  = {
      last_check_time: Date.now(),
    }

    function check(done) {
      var tick_start = Date.now()

      current.error = null
      _S.exchange.ticker((error, data) => {
        perf_timers.market_tick += (Date.now() - tick_start)
        if (error && !data) {
          LOG("market | check | error loading market data ("+error+")")
          current.error = (
            "Unable to load current balance [" + (new Date()) + "]."
          )
        }
        else {
          assignData(data)
          ERR_EMAIL_SENT = null
        }
        return done(error, current)      
      }) 
    }

    function assignData(data) {
      var assign_start  = Date.now()

      // Assign listed properties to market current
      TICKER_PROPS.forEach(property => {
        current[property] = parseFloat(data[property] || 0)
      })
      if (data.simulation_progress) {
        current.simulation_progress = data.simulation_progress
      }
      current.starting_point = (data.starting_point)
      current.time           = (data.time || assign_start)
      current.middle         = (current.high + current.low) / 2
      current.top            = (
        current.top > current.high ? current.top : current.high
      )
      current.spread         = (
        current.high - current.low
      ) / current.high
      perf_timers.market_assignment += (Date.now() - assign_start)
    }

    return {
      timer: null,
      check: check,
      current: current
    }
  }


  return Market
}
