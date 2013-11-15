var db = require("redis").createClient(6379),
    async = require("async"),
    config = require("./../plugins/config"),
    controller = require("./../routes/controller"),
    live_traders, error_email_sent;

function Wallet() {
  this.current = {};
  this.cool = 1;
  this.check_frequency = 5000;
}

Wallet.prototype = {
  check: function(current_traders, callback) {
    var me = this;
    live_traders = current_traders;
    controller.balance(function(error, data) {
      if (
        error && 
        !error_email_sent
      ) {
        email.send({
          to: config.owner.email,
          subject: "Stampede: Error getting balance from bitstamp API",
          template: "error.jade",
          data: {error:error}
        }, function(success) {
          console.log("ERROR Email sending success?:", success);
          error_email_sent = true;
        });        
      } else if (!error) error_email_sent = null;
      data = data || {};
      ["btc_reserved", "fee", "btc_available", "usd_reserved", "btc_balance", "usd_balance", "usd_available"].forEach(function(property) {
        data[property] = parseFloat(data[property] || 0);
      });
      data.timestamp = new Date();
      me.current = data;
      me.current.cool = me.cool;
      me.summarizeDeals(callback);
    });
  },
  summarizeDeals: function(callback) {
    var me = this;
    me.current.investment = 0;
    me.current.btc_amount_managed = 0;
    for (var trader_name in live_traders) {
      var current_trader_deals = live_traders[trader_name].deals || [];
      (live_traders[trader_name].record || {}).current_investment = 0;
      (live_traders[trader_name].record || {}).current_deals = current_trader_deals.length;
      current_trader_deals.forEach(function(current_trader_deal) {
            deal_buy_price = current_trader_deal.buy_price,
            deal_amount = current_trader_deal.amount;
        me.current.btc_amount_managed += deal_amount;
        if (
          !isNaN(deal_amount * deal_buy_price)
        ) me.current.investment += (deal_amount * deal_buy_price);
        live_traders[trader_name].record.current_investment += 
          isNaN(deal_amount * deal_buy_price) ? 0 : (deal_amount * deal_buy_price);
      });
    }
    if (callback) callback(null, me.current);
  }
};


module.exports = Wallet;
