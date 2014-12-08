

// This is a redirection to exchange object under Simulator > exchange
module.exports = Exchange



// The exchange instance will create an object that provides ticker data and simulates exchange apis
function Exchange() {
  /*  Serves to simulate exchange adapter
   *  Initialize object for trading simulation
   *
   *
   */
  console.log("Initializing Simulated Exchange wrapper...")
  this.initialization_start = Date.now()
}

var initialization = (function() {

  var LOG
  var config
  var generator
  var xc
  var controller
  var ticker_interval
  var stop_ticking_now

  Exchange.prototype = {
    
    load: function(STAMPEDE, market_data) {

      LOG = STAMPEDE.LOG("sim_x")
      config = STAMPEDE.config
      generator = STAMPEDE.generator
      xc = config.exchange.currency
      controller = STAMPEDE.controller
      var me = this

      console.log(
        "Exchange (init:" + me.initialization_start + ") | Loading data.",
          market_data ? market_data.length : "Starting real time simulation."
      )
      var now = Date.now()
      me.real_time = (!market_data)

      market_data = 
         market_data || [generator.initializeStartPoint(now)]

      me.current_extremes = 
        generator.initializeCurrentExtremes(market_data, now)

      me.ticks = market_data
      me.ticks_length = market_data.length
      me.current_tick = 0
      var start_tick = me.ticks[me.current_tick]
      
      start_tick.starting_point = true
      me.current_balance = {
        btc_reserved: 0,
        fee: 0.4,
        btc_available: 0.0001,
        btc_balance: 0.0001,
        time: (start_tick.time || 0)
      }

      me.current_balance[xc + "_reserved"] = 0
      me.current_balance[xc + "_balance"] = 
        me.current_balance[xc + "_available"] = config.trading.maximum_investment

      // Initialize container for future ticker data, that will be supplied by generator
      me.volume = 10000
    },


    balance: function(callback) {
      var me = this
      me.current_balance.time = (me.ticks[me.current_tick] || {}).time
      callback(null, me.current_balance)
    },

    ticker: function(callback, no_shift) {
      // Take currently loaded data and move further by a tick
      
      var me = this,
          market_current = me.ticks[me.current_tick]
      
      if (me.real_time) {
        var now = Date.now(),
            market_next = 
              generator.initializeDataPoint(
                now, now - market_current.time, market_current
              )
        me.ticks.push(market_next)
        me.ticks_length = me.ticks.length
        generator.assignExtremes(me.current_extremes, me.ticks, market_next, now)
      }
      
      if (!no_shift) me.current_tick++

      if (market_current) {
        market_current.bid = market_current.last
        market_current.ask = market_current.last
        market_current.volume = me.volume
        market_current.simulation_progress = me.current_tick / me.ticks_length
        callback(null, market_current)
      }
      else {
        callback((me.current_tick > me.ticks.length) ? {
          stop: true
        } : "Unable to retrieve ticker data from Simulated Exchange.", null)
        controller.simulatorFinish(me)
      }
      
    },

    startTicking: function() {
      var me = this
      var events = require("events")
      var Ticker = new events.EventEmitter()

      me.tickEmitter = Ticker
      stop_ticking_now = false
      if (ticker_interval) clearInterval(ticker_interval)
      if (me.real_time) {
        ticker_interval = setInterval(function() {
          me.emitTick()
        }, 1500)
      }
      else {
        me.emitTick(true) // True to execute next tick right away
      }
    },

    emitTick: function(recycle) {
      var me = this
      me.ticker(function(error, market_current) {
        if (market_current) {
          me.tickEmitter.emit("tick", {
            price: market_current.last
          })
        }
        else {
          LOG("startTicking | stop")
        }
      }, true) // <- true for no shift to current tick
      
      if (recycle && !stop_ticking_now) {
        setImmediate(function() {
          me.emitTick(recycle)
        })
      }
    },

    stopTicking: function() {
      console.log("simulated_exchange: stopTicking")
      clearInterval(ticker_interval)
      stop_ticking_now = true
    },

    buy: function(amount, price, callback) {

      amount = parseFloat(amount)
      price = parseFloat(price)
      
      var me = this
      var adjusted_amount_price = (amount*price)*(1+(me.current_balance.fee/100))

      if (me.current_balance[xc+"_available"] >= adjusted_amount_price) {

        me.current_balance.btc_available += amount
        me.current_balance.btc_balance = me.current_balance.btc_available
        me.current_balance[xc+"_available"] -= adjusted_amount_price
        me.current_balance[xc+"_balance"] = me.current_balance[xc+"_available"]
        me.volume += amount
        
        //LOG("buy | amount, btc_balance:", amount, me.current_balance.btc_balance)

        callback(null, {
          id: parseInt(Math.random()*10000)
        })
      }
      else {
        callback("Not enough " + xc + "resources in balance.", null)
      }
    },
    sell: function(amount, price, callback) {
      amount = parseFloat(amount)
      price = parseFloat(price)

      var me = this
      var adjusted_amount_price = (amount*price)*(1-(me.current_balance.fee/100))

      if (me.current_balance.btc_available >= amount) {
        me.current_balance.btc_available -= amount
        me.current_balance.btc_balance = me.current_balance.btc_available
        me.current_balance[xc+"_available"] += adjusted_amount_price
        me.current_balance[xc+"_balance"] = me.current_balance[xc+"_available"]
        me.volume += amount
        callback(null, {
          id: parseInt(Math.random()*10000)
        })
      }
      else {
        callback("Not enough BTC resources in balance.", null)  
      }
    }
  }


} ())

