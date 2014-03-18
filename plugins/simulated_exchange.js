// This is a redirection to exchange object under Simulator > exchange

var config = require("./config"),
    xc = config.exchange.currency,
    controller = require("./../routes/controller");


// The exchange instance will create an object that provides ticker data and simulates exchange apis
function Exchange() {
  /*  Serves to simulate exchange adapter
   *  Initialize object for trading simulation
   *
   *
   */
  console.log("Initializing Simulated Exchange wrapper...");
}


Exchange.prototype = {
  
  load: function(market_data) {
    console.log("Loading data.", market_data.length);
    this.ticks = market_data;
    this.ticks_length = market_data.length;
    this.current_tick = 0;
    var start_tick = this.ticks[this.current_tick];
    start_tick.starting_point = true;
    this.current_balance = {
      btc_reserved: 0,
      fee: 0.4,
      btc_available: 0,
      btc_balance: 0,
      time: start_tick.time || 0
    };

    this.current_balance[xc+"_reserved"] = 0;
    this.current_balance[xc+"_balance"] = this.current_balance[xc+"_available"] = config.trading.maximum_investment;

    // Initialize container for future ticker data, that will be supplied by generator
    this.volume = 10000;
  },


  balance: function(callback) {
    var me = this;
    me.current_balance.time = (me.ticks[me.current_tick] || {}).time;
    callback(null, me.current_balance);
  },

  ticker: function(callback) {
    // Take currently loaded data and move further by a tick
    
    var me = this,
        market_current = me.ticks[me.current_tick];

    me.current_tick++;
    
    if (market_current) {
      //["last", "bid", "low", "high", "volume", "ask"]
      market_current.bid = market_current.last;
      market_current.ask = market_current.last;
      market_current.volume = me.volume;
      market_current.simulation_progress = me.current_tick / me.ticks_length;
      //console.log("market_current.time:", market_current.time);
      callback(null, market_current);
    }
    else {
      callback((me.current_tick > me.ticks.length) ? {stop: true} : "Unable to retrieve ticker data from Simulated Exchange.", null);
      controller.simulatorFinish(me);
    }
    
  },
  buy: function(amount, price, callback) {

    amount = parseFloat(amount);
    price = parseFloat(price);
    
    var me = this,
        adjusted_amount_price = (amount*price)*(1+(me.current_balance.fee/100));

    if (me.current_balance[xc+"_available"] >= adjusted_amount_price) {
      me.current_balance.btc_available += amount;
      me.current_balance.btc_balance = me.current_balance.btc_available;
      me.current_balance[xc+"_available"] -= adjusted_amount_price;
      me.current_balance[xc+"_balance"] = me.current_balance[xc+"_available"];
      me.volume += amount;
      callback(null, {id: parseInt(Math.random()*10000)});
    }
    else {
      callback("There were not enough resources in balance.", null);  
    }
  },
  sell: function(amount, price, callback) {
    amount = parseFloat(amount);
    price = parseFloat(price);

    var me = this,
        adjusted_amount_price = (amount*price)*(1-(me.current_balance.fee/100));

    if (me.current_balance.btc_available >= amount) {
      me.current_balance.btc_available -= amount;
      me.current_balance.btc_balance = me.current_balance.btc_available;
      me.current_balance[xc+"_available"] += adjusted_amount_price;
      me.current_balance[xc+"_balance"] = me.current_balance[xc+"_available"];
      me.volume += amount;
      callback(null, {id: parseInt(Math.random()*10000)});
    }
    else {
      callback("There were not enough resources in balance.", null);  
    }
  }
};

module.exports = Exchange;