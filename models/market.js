

module.exports = function(STAMPEDE) {
  var LOG = STAMPEDE.LOG("market")
  var async = STAMPEDE.async
  var config = STAMPEDE.config
  var common = STAMPEDE.common
  var email = STAMPEDE.email
  var perf_timers = STAMPEDE.perf_timers
  var error_email_sent
  var TICKER_PROPS = ["bid", "low", "high", "volume", "ask"]

  perf_timers.market_assignment = 0
  perf_timers.market_tick = 0

  function Market() {
    this.current = {
      last_check_time: Date.now(),
    }
    this.timer = null
  }

  Market.prototype = {
    check: function(done) {
      var me = this
      var tick_start = Date.now()

      me.current.error = null
      STAMPEDE.controller.ticker(function(error, data) {
        perf_timers.market_tick += (Date.now() - tick_start)
        if (error && !data) {
          LOG("market | check | error loading market data ("+error+")")
          me.current.error = (
            "Unable to load current balance [" + (new Date()) + "]."
          )
        }
        else {
          me.assign(data)
          error_email_sent = null
        }
        done(error, me.current)      
      }) 
    },
    assign: function(data) {
      var me = this
      var assign_start = Date.now()

      // Assign listed properties to market current
      TICKER_PROPS.forEach(function(property) {
        me.current[property] = parseFloat(data[property] || 0)
      })
      if (data.simulation_progress) {
        me.current.simulation_progress = data.simulation_progress
      }
      me.current.starting_point = (data.starting_point)
      // Further market calculations
      me.current.time = (data.time || assign_start)
      me.current.middle = (me.current.high + me.current.low) / 2
      me.current.top = me.top = (
        me.top && me.top > me.current.high
      ) ? me.top : me.current.high
      me.current.spread = (
        me.current.high - me.current.low
      ) / me.current.high
      perf_timers.market_assignment += (Date.now() - assign_start)
    }
  }

  return Market
}
