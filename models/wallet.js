var db = require("redis").createClient(6379),
    async = require("async"),
    config = require("./../plugins/config"),
    email = require("./../plugins/email"),
    controller = require("./../routes/controller"),
    live_traders, error_email_sent;

function Wallet() {
  this.current = {};
  this.shares = [];
  this.cool = 1;
  this.check_frequency = 5000;
}

Wallet.prototype = {
  check: function(current_traders, callback) {
    var me = this;
    live_traders = current_traders;
    controller.balance(function(error, data) {
      if (
        data && parseFloat(data.fee || 0) > 0
      ) {
        ["btc_reserved", "fee", "btc_available", "usd_reserved", "btc_balance", "usd_balance", "usd_available"].forEach(function(property) {
          me.current[property] = parseFloat(data[property] || 0);
        });
        data.timestamp = new Date();
        //me.current = data;
        me.current.cool = me.cool;
        if (me.current.error) delete me.current.error;
        me.summarizeDeals(callback);
      }
      else {
        me.current.error = "Unable to load current balance ["+(new Date())+"].";
      }
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
        me.current.btc_amount_managed += parseFloat(deal_amount);
        if (
          !isNaN(deal_amount * deal_buy_price)
        ) me.current.investment += (deal_amount * deal_buy_price);
        live_traders[trader_name].record.current_investment += 
          isNaN(deal_amount * deal_buy_price) ? 0 : (deal_amount * deal_buy_price);
      });
    }
    me.summarizeShares(callback);
  },

  summarizeShares: function(callback) {
    var me = this;
    me.shares = [];
    console.log("wallet | summarizeShares | usd_value:", me.current.usd_value);
    db.smembers("stampede_shares", function(errors, share_list) {
      if (
        share_list && 
        share_list.length > 0
      ) {
        me.current.initial_investment = 0;
        // Parse each recorded share
        share_list.forEach(function(share_string) {
          var share_arrayed = share_string.split("|"),
              share = {
                holder: share_arrayed[0],
                invested_$_amount: parseInt(share_arrayed[1])
              };
          me.current.initial_investment += share.invested_$_amount;
          me.shares.push(share);
        });

        // Now assign part value
        me.shares.forEach(function(share) {
          var piece = share.invested_$_amount / (me.current.initial_investment || 0.01);
          var current_$_value = piece * me.current.usd_value;
          share.current_$_value = current_$_value.toFixed(2);
          share.pie_share = (piece*100).toFixed(1)+"%";
          share.profit_loss = ((current_$_value - share.invested_$_amount) / share.invested_$_amount*100).toFixed(2)+"%";
        });
        if (callback) callback(errors, me.shares);
      } 
      else {
        me.shares = [{
          holder: "Primary",
          invested_$_amount: 0,
          current_$_value: me.current.usd_value || 0
        }];
        if (callback) callback(null, me.shares);
      }
    });
  },

  addShare: function(holder, amount_invested, callback) {
    var share = {
      holder: holder,
      invested_$_amount: amount_invested
    };
    db.sadd("stampede_shares", share.holder+"|"+share.invested_$_amount, callback);
  }

};


module.exports = Wallet;
