var db = require("redis").createClient(6379),
    async = require("async"),
    config = require("./../plugins/config"),
    controller = require("./../routes/controller"),
    error_email_sent;

function Market() {
  this.current = {};
  this.check_frequency = 6000 + (Math.random()*9000);
}

Market.prototype = {
  check: function(callback) {
    var me = this;
    controller.ticker(function(error, data) {
      if (
        error && 
        !data
      ) {
        console.log("!!! There was error loading market data ("+error+") !!!");
        if (!error_email_sent) {
          email.send({
            to: config.owner.email,
            subject: "Stampede: Error getting MARKET details from bitstamp API",
            template: "error.jade",
            data: {error:error}
          }, function(success) {
            console.log("ERROR Email sending success?:", success);
            error_email_sent = true;
          });        
        }
      }
      else {
        me.current = data ? data : {};
        ["last", "bid", "low", "high", "volume", "ask"].forEach(function(property) {
          data[property] = parseFloat(data[property] || 0);
        });
        data.timestamp = new Date(parseInt(data.timestamp)*1000);
        data.middle = (data.high + data.low) / 2;
        data.top = me.top = (me.top && me.top > data.high) ? me.top : data.high;
        data.shift_span = (data.high - data.low) / (data.high || 0 + 0.00001);
        error_email_sent = null;
      }
      callback(error, data);      
    }); 
  }
};

module.exports = Market;
