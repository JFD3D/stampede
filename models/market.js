

module.exports = function(STAMPEDE) {
  var LOG = STAMPEDE.LOG("market")
  var async = STAMPEDE.async
  var config = STAMPEDE.config
  var common = STAMPEDE.common
  var email = STAMPEDE.email
  var perf_timers = STAMPEDE.perf_timers
  var MA = require('moving-average') 
  var momentum_errors = 0
  var momentum_average
  var error_email_sent

  perf_timers.market_assignment = 0
  perf_timers.momentum_calc = 0
  perf_timers.market_tick = 0

  function Market() {
    this.current = {
      last_check_time: Date.now(),
      EMA: 0,
      moving_variance: 0,
      momentum_record_healthy: false,
      momentum_indicator: false,
      momentum_average: 0
    }
    this.momentum_array = []
    this.momentum_indicator = 0
    this.timer = null
  }

  Market.prototype = {
    check: function(callback) {
      var me = this
      me.current.error = null
      var tick_start = Date.now()
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
          if (config.strategy.momentum_trading) me.tickMomentum()
          error_email_sent = null
        }
        callback(error, me.current)      
      }) 
    },
    assign: function(data) {
      var me = this
      var assign_start = Date.now()


      // Assign listed properties to market current
      ticker_properties = ["bid", "low", "high", "volume", "ask"]
      ticker_properties.forEach(function(property) {
        me.current[property] = parseFloat(data[property] || 0)
      })

      if (data.simulation_progress) {
        me.current.simulation_progress = data.simulation_progress
      }

      me.current.starting_point = (data.starting_point)

      // Further market calculations
      me.current.time = (data.time || Date.now())

      me.current.middle = (me.current.high + me.current.low) / 2
      me.current.top = me.top = (
        me.top && me.top > me.current.high
      ) ? me.top : me.current.high
      me.current.spread = (
        me.current.high - me.current.low
      ) / (me.current.high || 0 + 0.00001)

      perf_timers.market_assignment += (Date.now() - assign_start)

    },

    tickMomentum: function() {
    
      var me = this
      var momentum_update_start = Date.now()
      // Initialize Moving Average instance when starting... 
      // do not reuse as global variable for simulation
      if (me.current.starting_point || !momentum_average) {
        var time_since_last_check = (
              me.current.time - me.current.last_check_time
            )

        LOG("assign | time_since_last_check:", time_since_last_check)
        // Assign 100 cycles to momentum time span (needs to be configurable)
        // Changed it from absolute value since we needed to simulate this
        me.current.momentum_time_span = (100 * time_since_last_check)
        momentum_average = MA(me.current.momentum_time_span)
      }

      me.current.last_check_time = me.current.time

      momentum_average.push(me.current.time, me.current.last)
      me.current.EMA = momentum_average.movingAverage()
      me.current.moving_variance = momentum_average.variance()

      var m_array = me.momentum_array
      var m_span = config.trading.momentum_time_span
      var now = (me.current.time || Date.now())
      var m_to_start = (now - m_span)
      var m_indicator = 0

      // Market momentum updates
      m_array.push({
        time: me.current.time,
        market_shift: (me.current.last - me.current.EMA)
      })

      var start_time = +m_array[0].time
      var end_time = +m_array[m_array.length-1].time

      // Remove points that are too old
      me.momentum_array = m_array.filter(function(point) {
        var within_span = (+point.time > m_to_start)
        if (within_span) {
          m_indicator += point.market_shift
        }
        return within_span
      })

      // Average by key is defined for all array prototype in /plugins/common.js
      me.current.momentum_average = 
        me.momentum_array.averageByKey("market_shift")
      me.current.momentum_indicator = m_indicator / me.current.last
      me.current.momentum_record_healthy = (me.momentum_array.length > 10)
      perf_timers.momentum_calc += (Date.now() - momentum_update_start)        
    }
  }

  return Market

}
