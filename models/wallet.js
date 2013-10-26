var db = require("redis").createClient(6379),
    async = require("async"),
    config = require("./../plugins/config"),
    controller = require("./../routes/controller"),
    live_traders;

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
      data = data || {};
      ["btc_reserved", "fee", "btc_available", "usd_reserved", "btc_balance", "usd_balance", "usd_available"].forEach(function(property) {
        data[property] = parseFloat(data[property] || 0);
      });
      data.timestamp = new Date();
      me.current = data;
      me.current.cool = me.cool;
      me.summarizeDeals(callback);
      //callback(error, data);
      //console.log("Checked wallet:", me);
    });
  },
  summarizeDeals: function(callback) {
    var me = this;
    me.current.investment = 0;
    me.current.btc_amount_managed = 0;
    controller.user_transactions(function(error, transactions) {
      if (error) console.log("BITSTAMP: wallet | summarizeDeals | transactions | error when loading:", error)
      //console.log("wallet | summarizeDeals | transactions:", transactions);
      for (var trader_name in live_traders) {
        var current_trader_deals = live_traders[trader_name].deals || [];
        (live_traders[trader_name].record || {}).current_investment = 0;
        current_trader_deals.forEach(function(current_trader_deal) {
          //console.log("summarizeDeals | current_trader_deal:", current_trader_deal);
          var transaction = transactions.lookup("order_id", current_trader_deal.order_id),
              deal_buy_price = current_trader_deal.buy_price,
              deal_amount = current_trader_deal.amount;
          me.current.btc_amount_managed += deal_amount;
          if (transaction) console.log("^^^^^^ Found transaction for deal, transaction:", current_trader_deal.name, transaction);
          if (!isNaN(deal_amount * deal_buy_price)) me.current.investment += (deal_amount * deal_buy_price);
          live_traders[trader_name].record.current_investment += isNaN(deal_amount * deal_buy_price) ? 0 : (deal_amount * deal_buy_price);
        });
      }
      if (callback) callback(error, me.current);
    });
    //console.log("||| Live traders after wallet recalc:", live_traders);
  }
};


module.exports = Wallet;
