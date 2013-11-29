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
    me.current.cool = (me.current.cool || me.cool);

    controller.balance(function(error, data) {
      if (
        data && !isNaN(parseFloat(data.fee))
      ) {
        ["btc_reserved", "fee", "btc_available", config.exchange.currency+"_reserved", "btc_balance", config.exchange.currency+"_balance", config.exchange.currency+"_available"].forEach(function(property) {
          me.current[property] = parseFloat(data[property] || 0);
        });
        me.current.timestamp = new Date();
        if (me.current.error) delete me.current.error;
      }
      else {
        console.log("!!!!!!!!!!!!!!!!ERROR Getting WALLET from API !!!!!!!!!!!!!!");
        me.current.error = "Unable to load current balance ["+(new Date())+"].";
      }
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
    me.current.initial_investment = 0;
    console.log("wallet | summarizeShares | currency_value:", me.current.currency_value);
    db.smembers("stampede_shares", function(errors, share_list) {
      if (
        share_list && 
        share_list.length > 0
      ) {
        
        // Parse each recorded share
        share_list.forEach(function(share_string) {
          var share_arrayed = share_string.split("|"),
              share = {
                holder: share_arrayed[0],
                invested_currency_amount: parseInt(share_arrayed[1])
              };
          me.current.initial_investment += share.invested_currency_amount;
          me.shares.push(share);
        });

        // Now assign part value
        me.shares.forEach(function(share) {
          var piece = share.invested_currency_amount / (me.current.initial_investment || 0.01);
          var current_currency_value = piece * me.current.currency_value;
          share.current_currency_value = current_currency_value.toFixed(2);
          share.pie_share = (piece*100).toFixed(1)+"%";
          share.profit_loss = ((current_currency_value - share.invested_currency_amount) / share.invested_currency_amount*100).toFixed(2)+"%";
        });
        if (callback) callback(errors, me.shares);
      } 
      else {
        me.shares = [{
          holder: "Primary",
          invested_currency_amount: 0,
          pie_share: "100%",
          current_currency_value: me.current.currency_value || 0
        }];
        if (callback) callback(null, me.shares);
      }
    });
  },

  addShare: function(holder, amount_invested, callback) {
    var share = {
      holder: holder,
      invested_currency_amount: amount_invested
    };
    db.sadd("stampede_shares", share.holder+"|"+share.invested_currency_amount, callback);
  }

};


module.exports = Wallet;
