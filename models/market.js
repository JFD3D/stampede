

module.exports = function(STAMPEDE) {
  var LOG = STAMPEDE.LOG("market")
  var async = STAMPEDE.async
  var config = STAMPEDE.config
  var common = STAMPEDE.common
  var email = STAMPEDE.email
  var MA = require('moving-average') 
  var momentum_errors = 0
  var momentum_average
  var error_email_sent

  function Market() {
    this.current = {}
    this.momentum_array = []
    this.momentum_indicator = 0
    this.timer = null
    this.check_frequency = 4000 + (Math.random()*5000)
  }

  Market.prototype = {
    check: function(callback) {
      var me = this
      STAMPEDE.controller.ticker(function(error, data) {
        if (
          error && 
          !data
        ) {
          LOG("market | check | error loading market data ("+error+")")
          me.current.error = 
            "Unable to load current balance ["+(new Date())+"]."
        }
        else {
          me.assign(data)
          if (me.current.error) delete me.current.error
          me.tick()
          error_email_sent = null
        }
        //LOG(callback)
        callback(error, me.current)      
      }) 
    },
    assign: function(data) {
      var me = this

      // Assign listed properties to market current
      ticker_properties = ["last", "bid", "low", "high", "volume", "ask"]
      ticker_properties.forEach(function(property) {
        me.current[property] = parseFloat(data[property] || 0)
      })

      if (data.simulation_progress) {
        me.current.simulation_progress = data.simulation_progress
      }

      // Further market calculations
      me.current.time = (data.time || Date.now())

      // Initialize Moving Average instance when starting... 
      // do not reuse as global variable for simulation
      if (data.starting_point || !momentum_average) {
        momentum_average = MA(config.trading.momentum_time_span)
      }

      momentum_average.push(me.current.time, me.current.last)
      me.current.EMA = momentum_average.movingAverage()
      me.current.moving_variance = momentum_average.variance()
      me.current.timestamp = (
        data.time
      ) ? new Date(data.time) : new Date(parseInt(data.timestamp)*1000)
      me.current.middle = (me.current.high + me.current.low) / 2
      me.current.top = me.top = (
        me.top && me.top > me.current.high
      ) ? me.top : me.current.high
      me.current.spread = (
        me.current.high - me.current.low
      ) / (me.current.high || 0 + 0.00001)
    },

    tick: function() {
      
      var me = this
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

      var start_time = +m_array[0].time,
          end_time = +m_array[m_array.length-1].time

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
    }
  }

  return Market

}
