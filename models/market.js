var db = require("redis").createClient(6379),
    async = require("async"),
    config = require("./../plugins/config"),
    common = require("./../plugins/common"),
    email = require("./../plugins/email"),
    controller = require("./../routes/controller"),
    MA = require('moving-average'),
    ma = MA(config.trading.momentum_time_span),
    error_email_sent;

function Market() {
  this.current = {};
  this.momentum_array = [];
  this.momentum_indicator = 0;
  this.check_frequency = 4000 + (Math.random()*5000);
}

Market.prototype = {
  check: function(callback) {
    //console.log("market | config.trading.momentum_time_span:", config.trading.momentum_time_span);

    var me = this;
    controller.ticker(function(error, data) {
      if (
        error && 
        !data
      ) {
        console.log("!!! There was error loading market data ("+error+") !!!");
        me.current.error = "Unable to load current balance ["+(new Date())+"].";
      }
      else {

        ["last", "bid", "low", "high", "volume", "ask"].forEach(function(property) {
          me.current[property] = parseFloat(data[property] || 0);
        });

        // Further market calculations
        ma.push(Date.now(), me.current.last);
        me.current.EMA = ma.movingAverage();
        me.current.moving_variance = ma.variance();
        me.current.timestamp = new Date(parseInt(data.timestamp)*1000);
        me.current.middle = (me.current.high + me.current.low) / 2;
        me.current.top = me.top = (me.top && me.top > me.current.high) ? me.top : me.current.high;
        me.current.shift_span = (me.current.high - me.current.low) / (me.current.high || 0 + 0.00001);
        if (me.current.error) delete me.current.error
        me.tick();
        error_email_sent = null;
      }
      callback(error, me.current);      
    }); 
  },

  tick: function() {
    
    var me = this,
        m_array = me.momentum_array,
        m_span = config.trading.momentum_time_span,
        now = +(new Date()),
        m_to_start = now - m_span,
        m_indicator = 0;

    // Market momentum updates
    m_array.push({
      time: new Date(),
      market_shift: (me.current.last - me.current.EMA)
    });

    var start_time = +m_array[0].time,
        end_time = +m_array[m_array.length-1].time;

    // Remove points that are too old
    me.momentum_array = m_array.filter(function(point) {
      //console.log("MOMENTUM check: point.market_shift, (+point.time > m_to_start), point.time, m_to_start:", point.market_shift, (+point.time > m_to_start), +point.time, m_to_start);
      var within_span = (+point.time > m_to_start);
      if (within_span) m_indicator += point.market_shift;
      return within_span;
    });

    // Average by key is defined for all array prototype in /plugins/common.js
    me.current.momentum_average = me.momentum_array.averageByKey("market_shift");
    me.current.momentum_indicator = m_indicator / me.current.last;
    me.current.momentum_record_healthy = (me.momentum_array.length > 10);
    //console.log("MOMENTUM tick | me.momentum_array.length, start_time, end_time, m_to_start:", me.momentum_array.length, start_time, end_time, m_to_start);
  }
};


module.exports = Market;
