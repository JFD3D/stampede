var db = require("redis").createClient(6379),
    async = require("async"),
    config = require("./../plugins/config"),
    controller = require("./../routes/controller");

function Market() {
  this.current = {};
  this.check_frequency = 6000 + (Math.random()*9000);
}

Market.prototype = {
  check: function(callback) {
    var me = this;
    controller.ticker(function(error, data) {
      if (error && !data) {
        console.log("!!! There was error loading market data ("+error+") !!!");
        callback(error, data);
      }
      else {
        me.current = data ? data : {};
        ["last", "bid", "low", "high", "volume", "ask"].forEach(function(property) {
          data[property] = parseFloat(data[property] || 0);
        });
        data.timestamp = new Date(parseInt(data.timestamp)*1000);
        data.middle = (data.high + data.low) / 2;
        data.shift_span = (data.high - data.low) / (data.high || 0 + 0.00001);
        callback(error, data);
      }
    }); 
  }
};

module.exports = Market;
