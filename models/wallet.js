'use strict'

module.exports = function(_S) {

  var async             = _S.async
  var config            = _S.config
  var db                = _S.db
  var email             = _S.email
  var LOG               = _S.LOG('wallet')
  var currency          = (config.exchange.currency || 'usd')
  var live_traders
  var ERR_EMAIL_SENT

  function Wallet() {
    let current = {
      currency: currency,
      initial_investment: config.trading.maximum_investment,
      investment: 0,
      btc_amount_managed: 0,
      shares: [],
      // Assign lower cool, in order not to start trading right away
      cool: 0.5
    }
    
    function check(current_traders, done) {
      live_traders = current_traders
      _S.exchange.balance(function(error, data) {
        if (data && !isNaN(parseFloat(data.fee))) {
          assignData(data)
          if (current.error) delete current.error
        }
        else {
          LOG(
            '!!!!!!!!!!!!!!!!ERROR Getting WALLET from API !!!!!!!!!!!!!!', 
            error, data
          )
          current.error = 'Unable to load current balance ['+(new Date())+'].'
        }
        
        assignAvailableResources()

        // Fasten in case of series simulation, avoid share summarization
        if (config.simulation) {
          sumInvestmentValue()
          return done()
        } 
        else {
          summarizeShares(() => {
            sumInvestmentValue()
            return done()
          }) // < contains execution of sumInvestmentValue()
        }
      })
    }

    function assignData(data) {
      var wallet_properties = [
        'btc_reserved', 'fee', 'btc_available', 
        (config.exchange.currency + '_reserved'), 
        'btc_balance', 
        (config.exchange.currency + '_balance'), 
        (config.exchange.currency + '_available')
      ]

      wallet_properties.forEach(property => {
        current[property] = parseFloat(data[property] || 0)
      })
      current.cool     = (current.cool || cool)
      current.time     = data.time || Date.now()
      current.greed    = (
        (config.trading.greed / 100) + ((current.fee || 0.5) / (2*100))
      )
    }

    function assignAvailableResources(MAX_SUM_INVESTMENT) {
      var available_currency  = current[config.exchange.currency+'_available']

      current.available_currency   = available_currency
      current.available_to_traders = 
        (
          MAX_SUM_INVESTMENT - current.investment
        ) < available_currency ? 
          MAX_SUM_INVESTMENT - current.investment : 
          available_currency
    }

    function summarizeShares(done) {
      current.shares = []
      current.initial_investment = 0

      db.smembers('stampede_shares', (errors, share_list) => {
        if (share_list && share_list.length) {
          
          // Parse each recorded share
          share_list.forEach(share_string => {
            var share_arrayed = share_string.split('|')
            var share = {
                  holder: share_arrayed[0],
                  invested_currency_amount: parseInt(share_arrayed[1])
                }
            current.initial_investment += share.invested_currency_amount
            current.shares.push(share)
          })

          // Now assign part value
          current.shares.forEach(function(share) {
            var piece                   = (
              share.invested_currency_amount / 
              (current.initial_investment || 0.01)
            )
            var current_currency_value  = (piece * current.currency_value)
            
            share.current_currency_value = current_currency_value
            share.pie_share = ((piece * 100).toFixed(1) + '%')
            share.profit_loss = (
              (current_currency_value - share.invested_currency_amount) / 
              share.invested_currency_amount*100
            ).toFixed(3)+'%'
          })
        }
        else {
          var current_currency_value = current.currency_value || 0
          // Assign initial investment as maximum 
          // (this flies in case of simulator)
          var current_initial_investment = config.trading.maximum_investment

          current.initial_investment = current_initial_investment
          current.shares = [{
            holder: 'Primary',
            invested_currency_amount: current_initial_investment,
            pie_share: '100%',
            current_currency_value: current_currency_value,
            profit_loss: (
              (current_currency_value / current_initial_investment - 1) * 100
            ).toFixed(3) + '%'
          }]
        }
        if (done) return done()
      })
    }

    function sumInvestmentValue() {
      current.profit_loss_currency = (
        current.currency_value - current.initial_investment
      )
      current.profit_loss = (
        current.profit_loss_currency / current.initial_investment
      )
      current.anxiety = Math.abs(
        current.profit_loss < 0 ? (current.profit_loss) : 0
      )
    }

    function addShare(holder, amount_invested, done) {
      db.sadd('stampede_shares', holder+'|'+amount_invested, done)
    }

    return {
      addShare: addShare,
      check: check,
      current: current
    }
  }

  return Wallet

}

