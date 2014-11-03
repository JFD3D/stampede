

module.exports = function(STAMPEDE) {

  var async = STAMPEDE.async
  var config = STAMPEDE.config
  var db = STAMPEDE.db
  var email = STAMPEDE.email
  var live_traders
  var error_email_sent
  var LOG = STAMPEDE.LOG("wallet")

  function Wallet() {
    this.current = {}
    this.shares = []
    this.cool = 1
  }

  Wallet.prototype = {
    check: function(current_traders, callback) {
      var me = this
      live_traders = current_traders
      STAMPEDE.controller.balance(function(error, data) {
        if (
          data && 
          !isNaN(parseFloat(data.fee))
        ) {
          me.assign(data)
          if (me.current.error) delete me.current.error
        }
        else {
          console.log(
            "!!!!!!!!!!!!!!!!ERROR Getting WALLET from API !!!!!!!!!!!!!!", 
            error, data
          )
          me.current.error = "Unable to load current balance ["+(new Date())+"]."
        }
        
        // Fasten in case of series simulation, avoid share summarization
        if (me.simulation) {
          callback()
        } 
        else {
          me.summarizeShares(callback)
        }
      })
    },
    assign: function(data) {
      var me = this
      var wallet_properties = [
        "btc_reserved", 
        "fee", 
        "btc_available", 
        config.exchange.currency+"_reserved", 
        "btc_balance", 
        config.exchange.currency+"_balance", 
        config.exchange.currency+"_available"
      ]

      wallet_properties.forEach(function(property) {
        me.current[property] = parseFloat(data[property] || 0)
      })
      me.current.cool = (me.current.cool || me.cool)
      me.current.time = data.time || Date.now()
      me.summarizeDeals()
      return me
    },

    assignAvailableResources: function(MAX_SUM_INVESTMENT) {
      var me = this
      me.current.available_to_traders = 
        (
          MAX_SUM_INVESTMENT - me.current.investment
        ) < me.current[config.exchange.currency+"_available"] ? 
          MAX_SUM_INVESTMENT - me.current.investment : 
          me.current[config.exchange.currency+"_available"]
    },

    summarizeDeals: function() {
      var me = this
      me.current.investment = 0
      me.current.btc_amount_managed = 0
      for (var trader_name in live_traders) {
        var current_trader_deals = (live_traders[trader_name].deals || [])
        var trader_record = live_traders[trader_name].record || {}
        trader_record.current_investment = 0
        trader_record.current_deals = 
          current_trader_deals.length

        current_trader_deals.forEach(function(current_trader_deal) {
          var deal_buy_price = current_trader_deal.buy_price,
              deal_amount = current_trader_deal.amount
          me.current.btc_amount_managed += parseFloat(deal_amount)
          if (
            !isNaN(deal_amount * deal_buy_price)
          ) me.current.investment += (deal_amount * deal_buy_price)
          trader_record.current_investment += 
            isNaN(deal_amount * deal_buy_price) ? 
              0 : (deal_amount * deal_buy_price)
        })

        me.current.average_buy_price = 
          (me.current.investment / me.current.btc_amount_managed) || 0
      }
      
    },

    summarizeShares: function(callback) {
      var me = this
      me.shares = []
      me.current.initial_investment = 0

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
                }
            me.current.initial_investment += share.invested_currency_amount
            me.shares.push(share)
          })

          // Now assign part value
          me.shares.forEach(function(share) {
            var piece = 
                  share.invested_currency_amount / 
                  (me.current.initial_investment || 0.01),
                current_currency_value = piece * me.current.currency_value
            
            share.current_currency_value = current_currency_value
            share.pie_share = (piece*100).toFixed(1)+"%"
            share.profit_loss = (
              (current_currency_value - share.invested_currency_amount) / 
              share.invested_currency_amount*100
            ).toFixed(3)+"%"

          })
          if (callback) callback()
        } 
        else {
          var current_currency_value = me.current.currency_value || 0
          // Assign initial investment as maximum 
          // (this flies in case of simulator)
          var current_initial_investment = config.trading.maximum_investment
          LOG("config.trading.maximum_investment:", config.trading.maximum_investment)
          me.current.initial_investment = current_initial_investment

          me.shares = [{
            holder: "Primary",
            invested_currency_amount: current_initial_investment,
            pie_share: "100%",
            current_currency_value: current_currency_value,
            profit_loss: (
              (current_currency_value / current_initial_investment - 1) * 100
            ).toFixed(3) + "%"
          }]

          if (callback) callback()
        }
      })
    },

    addShare: function(holder, amount_invested, callback) {
      var share = {
        holder: holder,
        invested_currency_amount: amount_invested
      }
      db.sadd(
        "stampede_shares", 
        share.holder+"|"+share.invested_currency_amount, callback)
    }

  }

  return Wallet

}

