"use strict"

module.exports = _S => {

  var config          = _S.config
  var common          = _S.common
  var async           = _S.async
  var db              = _S.db
  var email           = _S.email
  var LOG             = _S.LOG("trader")
  var _               = _S._
  // All traders will be loaded into this object
  var live_traders    = {}
  // Trading performance timers initialization for benchmarking
  var perf_timers     = _S.perf_timers
  var logPerformance  = common.logPerformance
  // Load Market and Walled models to initialize instances below
  var market
  var wallet
  // Shared constants
  var TRADER_PREFIX   = "trader_"
  var ID_COUNTER      = "stampede_trader_number"
  // Repository unsorted list for USD value history
  var VALUE_SHEET_KEY = "stampede_value"
  // Main repository in redis for keeping list of traders
  var TRADER_LIST_KEY = "stampede_traders"
  var CURRENCY_LABEL  = config.exchange.currency.toUpperCase()
  // Additional shared variables
  // Current USD value history list
  var sheets              = []
  // For simulation purposes so that notification is only emitted
  var cycle_counter       = perf_timers.cycle_counter
  // Disables broadcast later, (when series of data are simulated)
  var series_simulation   = false
  var cycle_sell_decisions= []
  var cycle_buy_decisions = []
  var currency_key        = config.exchange.currency + "_available"
  var exchange_simulated  = (config.exchange.selected === "simulated_exchange")
  var last_cycle_end      = Date.now()
  var last_full_cycle_end = Date.now()
  var cycles_until_full   = 0
  var trader_count                                 // Current trader count
  var error_email_sent                             // Indicate if email for certain error has already been sent
  var broadcast_time                               // Will compute leftover on this
  var cycle_in_progress
  /*
   * Constants for trading
   */
  // Allowed max sum of investment
  var MAX_SUM_INVESTMENT
  // Allowed investment per trader's deal 
  var MIN_PURCHASE
  // Greed (.05 means trader looks for 5% upside)
  var INITIAL_GREED
  // Align bid before buying to allow competitive price
  var BID_ALIGN
  // Where do I buy up from middle
  var IMPATIENCE
  /*
   * Trading strategies
   */
  // Sales will happen only after trailing stop is reached
  var TRAILING_STOP_ENABLED
  // Market spread based increments for buying
  var MARKET_BASED_BUY
  // Whether we log decisions
  var DECISION_LOGGING
  // USD value sheet size limit
  var SHEET_SIZE_LIMIT
  var AMOUNT_DIVIDER


  function initializeConfig() {

    // Trading config
    MAX_SUM_INVESTMENT    = config.trading.maximum_investment
    MIN_PURCHASE          = config.trading.min_purchase
    INITIAL_GREED         = (config.trading.greed / 100)
    BID_ALIGN             = config.trading.bid_alignment
    IMPATIENCE            = (config.trading.impatience / 100)
    // WIP: divide amount total by this number, get into config?
    AMOUNT_DIVIDER        = 2
    // Strategies now
    TRAILING_STOP_ENABLED = config.strategy.trailing_stop
    MARKET_BASED_BUY      = config.strategy.market_based_buy
    // Logging options load
    DECISION_LOGGING      = (config.logging || {}).decisions || false
    // USD value sheet size limit
    SHEET_SIZE_LIMIT      = config.sheet_size_limit || 300
    // Set performance timers to zero
    perf_timers.cycle                   = 0
    perf_timers.decisions               = 0
    perf_timers.wallet                  = 0
    perf_timers.market                  = 0
    perf_timers.market_post_assignments = 0
    perf_timers.cycle_counter           = 0
    perf_timers.finalize_cycle          = 0
    perf_timers.is_buying               = 0
    perf_timers.is_selling              = 0
    cycles_until_full                   = 0
  }

  /*
   *  Trader prototype
   *
   */

  function Trader(name) {

    /*
     *  Trader basics
     *
     */
    this.name                       = name
    // Assign profit tracking
    this.profit                     = 0
    // Assign purchase tracking
    this.purchases                  = 0
    // Assign sales tracking
    this.sales                      = 0
    this.average_buy_price          = 0
    this.amount                     = 0
    // Book-keeping for purchase/sale entries
    this.book                       = _S.book(name)
    /*
     *  Redis repos and scopes
     *
     */
    this.main_list                  = TRADER_LIST_KEY
  }

  /*
   *  Trader engine definitions
   *
   */
  function cleanBooks(done) {
    _.each(live_traders, function(trader) {
      trader.clean()
    })
    if (done) return done()
  }

  Trader.prototype = {
    // Record and initialize(add to shared live_traders) new trader
    create: function(done) {
      var me = this
      db.incr(ID_COUNTER, function(error, number) {
        me.name = TRADER_PREFIX + number
        db.sadd(TRADER_LIST_KEY, me.name, function(error, response) {
          live_traders[me.name] = me
          me.saveRecord(function() {
            loadTraders(done)
          })
        })
      })
    },
    saveRecord: function(done) {
      var me = this

      db.hmset(me.name, {
        amount              : me.amount,
        max_price           : me.max_price,
        average_buy_price   : me.average_buy_price,
        purchases           : me.purchases,
        sales               : me.sales
      }, done)
    },

    // Used for simulation
    clean: function() {
      var me = this
      me = new Trader(me.name)
    },

    // Stop and remove trader
    remove: function(done) {
      var me = live_traders[this.name]
      var my_book = me.book_name

      async.series([
        next => me.checkRecord(next),
        next => db.srem(TRADER_LIST_KEY, me.name, next),
        next => db.del(my_book, next),
        next => db.del(me.name, next)
      ], function() {
        loadTraders(done)
      })
    },

    // Loads trader record from repository and then loads trader's history
    checkRecord: function(done) {
      var me = this
      db.hgetall(me.name, function(error, my_record) {
        me.average_buy_price  = parseFloat(my_record.average_buy_price || 0)
        me.max_price          = parseFloat(my_record.max_price || 0)
        me.amount             = parseFloat(my_record.amount || 0)
        me.purchases          = parseInt(my_record.purchases || 0)
        me.sales              = parseInt(my_record.sales || 0)
        // Assign shared values to wallet
        wallet.current.investment         += (me.amount * me.average_buy_price)
        wallet.current.btc_amount_managed += me.amount

        me.book.load(done)
      })
    },

    /*
     *
     * Awaken trader = Load associations
     *
     *
     *
     *
     */
    wake: function(done) {
      var me = this

      live_traders[me.name] = me
      if (!config.simulation) {
        me.checkRecord(done)
      }
      else return done()
    },

    validBuyPrice: function(purchase) {
      var me = this

      // Check if price is below threshold
      // (which combines the impatience variable)
      var price_below_threshold = (purchase.price < market.current.threshold)
      var amount_under_min      = me.amount < (2 * MIN_PURCHASE / purchase.price)
      var price_under_average   = me.average_buy_price > purchase.price

      if (DECISION_LOGGING) {
        LOG(
          "validBuyPrice |",
          "\nprice_below_threshold:", price_below_threshold,
          "\namount_under_min:", amount_under_min,
          "\nprice_under_average:", price_under_average
        )
      }
      // Check if purchase price lower my average buy price - greed
      return (
        price_below_threshold && (amount_under_min || price_under_average)
      )
    },

    walletCool: (purchase) => (wallet.current.cool >= 1),
    validBuyAmount: function(purchase) {
      var me                = this
      // Current allowed investment (on top of existing)
      // Amount I can invest according to available and allowed
      // What amount is possible to buy at current price and available funds
      var amount_available  = wallet.current.available_to_traders / purchase.price
      var max_buy_amount    = (MIN_PURCHASE * 3 / purchase.price)
      var amount_possible   = (
        amount_available > max_buy_amount ? max_buy_amount : amount_available
      )
      var target_amount
      var valid_buy_amount
      var equalizer
      var equalizer_currency

      // Calculate equalizing amount to reach a desirable average price
      if (me.amount > (2 * MIN_PURCHASE / purchase.price)) {
        var avg_price         = me.average_buy_price
        var cur_amount        = me.amount
        var cur_price         = purchase.price
        var target_avg_price  = (
          cur_price * (1 + (wallet.current.fee / 100)) * (1 + 
          (
            MARKET_BASED_BUY ? ((
              market.current.spread > 0.02 ? market.current.spread : 0.02
            ) / 2) : INITIAL_GREED
          )
        ))

        equalizer           = (
          (cur_amount * (avg_price - target_avg_price)) /
          (target_avg_price - cur_price)
        )
        equalizer_currency  = (equalizer * purchase.price)
        target_amount       = equalizer
      }
      // Assign basic amount (up by 10% to make sure our purchase goes through)
      else {
        target_amount = ((1.1 * MIN_PURCHASE) / purchase.price)
      }

      // Assign purchase amount (if over available, then use available amout)
      purchase.amount = (
        target_amount > amount_possible ? (amount_possible * 0.9) : target_amount
      )
      valid_buy_amount = (purchase.amount > (MIN_PURCHASE / purchase.price))

      // Check if amount is over minimum purchase
      return valid_buy_amount
    },
    // SELL checks
    validSellPrice: function(sale) {
      var me = this

      return (sale.price > me.target_price)
    },

    validSellAmount: function(sale) {
      var me                        = this
      var available_btc             = wallet.current.btc_available
      var available_amount          = (
        me.amount < available_btc ? me.amount : available_btc
      )
      var available_currency_amount = (available_amount * sale.price)
      var target_amount             = (available_amount / AMOUNT_DIVIDER)
      var target_currency_amount    = (target_amount * sale.price)

      sale.amount = target_amount
      return (target_currency_amount > MIN_PURCHASE)
    },

    checkTrailingStop: function(sale) {
      var me = this

      // If trailing stop enabled, add to structured decision
      // Set the stop deal as deal to sell if not selling combined deal
      // And if trailing stop was hit
      // Stop price is the max price reduced by half of greed
      sale.stop_price =
        (me.max_price) * (1 - (INITIAL_GREED / 2))
      me.target_price = (
        sale.stop_price > me.target_price ? sale.stop_price : me.target_price
      )

      return (
        sale.stop_price >= sale.price
      )
    },

    // Decide if buying, define purchase

    /* INPUT:
        purchase: Object(will be assigned by the end)

       OUTPUT:
        decision: true / false
        assigned purchase object will then be used to execute purchase by
        controller (amount, price)

    */


    isBuying: function(purchase) {

      /* Will buy if
          - price is favorable
          - available resources

         Define checklist for buying.
         Assign checklist entries whether they are required or not.
      */

      var me = this
      var is_buying_start = Date.now()
      var buy_checklist = [
            {required: true, fn: me.validBuyPrice, name: "buy_price"},
            {required: true, fn: me.validBuyAmount, name: "valid_amount"},
            {required: true, fn: me.walletCool, name: 'wallet_cool'}
          ]

      // Calculate trader bid
      // (aligned by bid alignment to make us competitive when bidding)
      var current_buy_price = (market.current.last / (1 - (BID_ALIGN / 100)))

      purchase.price = current_buy_price

      var structured_decision = me.checkOut(buy_checklist, {
            trader: (
              "T" + me.name.split("_")[1] +
              ": " + (current_buy_price).toFixed(2) +
              " (" + me.average_buy_price.toFixed(2) + ")"
            ),
            criteria: {}
          }, purchase)

      if (DECISION_LOGGING) LOG(
        "isBuying | structured_decision, purchase:", structured_decision, purchase
      )

      cycle_buy_decisions.push(structured_decision)
      perf_timers.is_buying += (Date.now() - is_buying_start)

      if (purchase.amount) {
        structured_decision.trader += (', amount: ' + purchase.amount.toFixed(4))
      }

      return structured_decision.decision
    },

    checkOut: function(check_list, structured_decision, deal) {
      var me = this
      var decision = true
      // Cycle through checklist now
      for (var i = 0; i < check_list.length; i++) {
        var entry = check_list[i]

        if (entry.required && entry.fn) {
          var entry_pass = entry.fn.apply(me, [deal])

          structured_decision.criteria[entry.name] = entry_pass
          if (!entry_pass) {
            decision = false
            break
          }
        }
      }
      structured_decision.decision = decision
      return structured_decision
    },


    isSelling: function(sale) {
      var is_selling_start = Date.now()
      var me = this
      // Calculate trader bid
      // (aligned by bid alignment to make us competitive when bidding)
      var current_sell_price = (market.current.last / (1 + (BID_ALIGN / 100)))
      var sell_checklist = [
            { required: true, fn: me.validSellPrice, name: "sell_price" },
            { required: true, fn: me.validSellAmount, name: "sell_amount" },
            {
              required: TRAILING_STOP_ENABLED,
              fn: me.checkTrailingStop,
              name: "trailing_stop"
            }
          ]
      // Initialize decision

      sale.price = current_sell_price

      var structured_decision = me.checkOut(sell_checklist, {
            trader:
              "T" + me.name.split("_")[1] +
              ": " + (current_sell_price).toFixed(2) +
              " (" + (me.target_price).toFixed(2) + ")",
            criteria: {}
          }, sale)

      // Add the decision to array which will be rendered on client
      cycle_sell_decisions.push(structured_decision)

      // Log the success!
      if (DECISION_LOGGING) LOG(
        "||| trader | sellingCheck | " +
        "isSelling? | structured_decision:",
        structured_decision
      )

      // Check all outstanding factors and make final decision
      var decision = structured_decision.decision

      perf_timers.is_selling += (Date.now() - is_selling_start)
      return structured_decision.decision
    },

    decide: function(done) {
      var me            = this
      var cur_price     = market.current.last
      var wallet_cool   = (wallet.current.cool >= 1)

      //Sanity check
      if (cur_price > 5) {
        me.max_price = (me.max_price > cur_price) ? me.max_price : cur_price
        me.target_price = me.average_buy_price * (1 + INITIAL_GREED)

        var purchase  = { time: market.current.time, type: "purchase" }
        var sale      = { time: market.current.time, type: "sale" }
        if (me.isBuying(purchase)) {
          me.buy(purchase, done)
        } else if (
          wallet_cool && me.amount > (MIN_PURCHASE / cur_price) &&
          me.isSelling(sale)
        ) {
          me.sell(sale, done)
        }
        else return done()
      }
      else {
        LOG(
          "decide | (" + me.name +
          "): Market not ready for decisions (current_market)",
          market.current
        )
        return done()
      }
    },

    buy: function(purchase, done) {
      var me = this
      var currency_buy_amount = (purchase.amount * purchase.price)

      wallet.current.cool -= (market.current.spread * 10)
      // Reset cycles to load all (market, wallet) details
      cycles_until_full = 1
      wallet.current.investment += (purchase.amount * purchase.price)
      wallet.current.btc_amount_managed += purchase.amount

      if (!series_simulation) _S.controller.notifyClient({
        message:
          "+B " + purchase.amount.toFixed(5) +
          "BTC for " + currency_buy_amount.toFixed(2) +
          " " + CURRENCY_LABEL +
          " at " + purchase.price.toFixed(2) +
          " " + CURRENCY_LABEL+" per BTC.",
        permanent: true
      })

      _S.exchange.buy(
        purchase.amount.toFixed(6),
        purchase.price.toFixed(2),
      function(error, order) {
        if (DECISION_LOGGING) console.log(
          "trader | buy | order, error:", order, error
        )
        if (
          order &&
          order.id
        ) {
          purchase.order_id = order.id
          if (!exchange_simulated) email.send({
            to: config.owner.email,
            subject: "Stampede - Buying: " + purchase.amount.toFixed(7) + "BTC",
            template: "purchase.jade",
            data: { purchase: purchase, market: market, wallet: wallet }
          }, success => {
            console.log("Email sending success?:", success)
            if (error_email_sent) error_email_sent = false
          })
          me.recordPurchase(purchase, done)
        }
        else {
          if (!exchange_simulated && !error_email_sent) email.send({
            to: config.owner.email,
            subject: "Stampede: Error BUYING deal through bitstamp API",
            template: "error.jade",
            data: { error: error }
          }, success => {
            console.log("ERROR Email sending success?:", success)
            error_email_sent = true
          })
          done()
        }
      })
    },

    recordPurchase: function(purchase, done) {
      var me = this
      var currency_buy_amount = (purchase.price * purchase.amount)

      me.purchases++
      me.average_buy_price = (
        (me.average_buy_price * me.amount) + (currency_buy_amount * (1 + (wallet.current.fee / 100)))
      ) / (me.amount + purchase.amount)
      me.amount += purchase.amount

      // Reset current max_price
      me.max_price = market.current.last

      async.parallel([
        next => {
          // Only save the record to db if we are not simulating
          if (!exchange_simulated) {
            me.saveRecord(next)
          }
          else return next()
        },
        next => me.book.add(purchase, next)
      ], done)
    },

    recordSale: function(sale, done) {
      var me = this
      var sale_ratio = (1 / AMOUNT_DIVIDER)

      me.sales++
      me.amount -= sale.amount

      // Recalculate average buy price (raise it with greed)
      me.average_buy_price = (me.amount * (
        me.average_buy_price * (1 + (INITIAL_GREED * sale_ratio)))) / me.amount

      async.parallel([
        next => {
          // Only save the record to db if we are not simulating
          if (!exchange_simulated) {
            me.saveRecord(next)
          }
          else return next()
        },
        next => {
          me.book.add(sale, next)
        }
      ], done)
    },

    sell: function(sale, done) {

      var me = this
      var sell_price = sale.price

      // Align current cool to avoid all sell / buy
      wallet.current.cool -= (market.current.spread * 10)
      // Reset cycles to load all (market, wallet) details
      cycles_until_full = 1

      if (!series_simulation) _S.controller.notifyClient({
        message: (
          "-S" + ((sale.stop && !sale.shed) ? "(STOP)" : (sale.shed ? "(SHED)" : "(REG)")) +
          " " + sale.amount.toFixed(5) +
          " BTC for " + ((market.current.last * (1 - (BID_ALIGN / 100)))*sale.amount).toFixed(2) +
          " " + CURRENCY_LABEL +
          " at " + sale.price.toFixed(2) +
          " " + CURRENCY_LABEL
        ),
        permanent: true
      })

      _S.exchange.sell(
        sale.amount.toFixed(6),
        sale.price.toFixed(2),
      function(error, order) {
        if (DECISION_LOGGING) console.log(
          "EXCHANGE: Response after attempt to sell | error, order:",
          error, order
        )
        if (
          order &&
          order.id
        ) {
          if (!exchange_simulated) email.send({
            subject: "Stampede - Selling at: "+sale.price,
            template: "sale.jade",
            data: {
              sale: sale,
              market: market,
              wallet: wallet
            }
          }, function(success) {
            console.log("Email sending success?:", success)
            if (error_email_sent) error_email_sent = false
          })
          // Record sale to history
          me.recordSale(sale, done)
          wallet.current.investment -= (sale.amount * me.average_buy_price)
          wallet.current.btc_amount_managed -= sale.amount
        }
        else {
          sale.order_id = "freeze"
          if (!exchange_simulated && !error_email_sent) email.send({
            subject: "Stampede: Error SELLING through bitstamp API",
            template: "error.jade",
            data: { error: error }
          }, function(success) {
            console.log("ERROR Email sending success?:", success, error)
            error_email_sent = true
          })
          return done()
        }
      })

    }
  }


  function wakeAll(done) {
    _S.stop = false
    initializeConfig()
    async.series([
      loadTraders,
      hook,
      checkSheets
    ], function(errors) {
      LOG("wakeAll initiated.")
      if (errors) {
        console.log("Problems loading traders, market or wallet:", errors)
      }
      if (done) done()
      cycle()
    })
  }

  function hook(done) {
    _S.exchange.startTicking()
    _S.exchange.tickEmitter.on("tick", tick)
    done()
  }

  function unhook() {
    _S.exchange.stopTicking()
  }

  // Trigger ticking market per streaming API
  function tick(data) {
    var time_since_last_cycle = (Date.now() - last_cycle_end)
    var delay_permitted = (exchange_simulated || time_since_last_cycle > 1000)

    market.current.last = data.price
    if (!cycle_in_progress && !_S.stop && delay_permitted) {
      cycle()
    }
  }

  function cycle(done) {
    cycle_in_progress = true
    //if (!config.simulation) console.log("Cycle initiated.")

    var cycle_start_timer = Date.now()
    perf_timers.cycle_counter++
    broadcast_time = (
      !config.simulation || perf_timers.cycle_counter % 10000 === 0
    ) && !series_simulation

    // Update client on performed decisions
    if (broadcast_time) {
      _S.controller.refreshDecisions({
        buy_decisions: cycle_buy_decisions,
        sell_decisions: cycle_sell_decisions
      })
    }

    cycle_buy_decisions = []
    cycle_sell_decisions = []

    // Initialize market and wallet data into global var, exposed on top
    async.series([
      checkWallet,
      checkMarket,
      checkDecisions
    ], function() {

      if (cycles_until_full === 0) {
        cycles_until_full += 10
      }
      else {
        cycles_until_full--
      }
      finalizeCycle(cycle_start_timer)
      perf_timers.cycle += (Date.now() - cycle_start_timer)
      if (done) {
        return done()
      }
    })
  }

  function finalizeCycle(cycle_start_timer) {
    var finalize_cycle_start = Date.now()
    // Export current market and wallet data
    _S.current_market   = market.current
    _S.current_wallet   = wallet.current
    _S.current_traders  = live_traders

    if (broadcast_time) {
      _S.controller.refreshOverview()
    }

    var stop_cycles =
          (config.simulation && market.current.error) || _S.stop

    if (perf_timers.cycle_counter % 100000 === 0) logPerformance(perf_timers)
    perf_timers.finalize_cycle += (Date.now() - finalize_cycle_start)
    cycle_in_progress = false
    last_cycle_end = Date.now()
  }

  function checkDecisions(done) {

    var decisions_start_timer = Date.now()
    // Check if traders are initialized
    var trader_names = _.keys(live_traders)

    if (trader_names.length) {
      var currency_amount = 0
      var btc_amount = 0

      async.each(trader_names, (trader_name, next) => {
        var trader = live_traders[trader_name]

        currency_amount += (
          trader.average_buy_price * trader.amount
        )
        btc_amount += trader.amount
        trader.decide(next)
      }, () => {
        perf_timers.decisions += (Date.now() - decisions_start_timer)
        var cool_up = INITIAL_GREED
        wallet.current.cool = (
          wallet.current.cool < 1 &&
          cool_up < (1 - wallet.current.cool)
        ) ? (wallet.current.cool + cool_up) : 1
        wallet.current.average_buy_price = (currency_amount / btc_amount)
        if (done) return done()
      })
    }
    else {
      LOG("No traders present or market simulation stopped.")
      _S.stop_simulation = true
      if (done) return done()
    }
  }

  function checkMarket(done) {
    var market_start_timer = Date.now()

    if (cycles_until_full === 0) {
      market.check((error, market_current) => finalize())
    }
    else return finalize()

    function finalize() {
      var market_post_assignments_start = Date.now()
      market.current.threshold = (
        IMPATIENCE * (market.current.high - market.current.middle) +
        market.current.middle
      )
      wallet.current.currency_value =
        (wallet.current.btc_balance || 0) * (market.current.last || 0) +
        (wallet.current[config.exchange.currency + "_balance"] || 0)
      // refresh client side on current market and wallet data
      perf_timers.market_post_assignments += (
        Date.now() - market_post_assignments_start
      )
      if (broadcast_time) {
        _S.controller.refreshTraders(live_traders)
        _S.controller.refreshWallet(wallet.current)
        _S.controller.refreshMarket(market.current)
      }
      perf_timers.market += (Date.now() - market_start_timer)
      if (done) {
        return done()
      }
    }
  }

  function pullValueSheet(done) {
    return done(sheets)
  }

  function checkSheets(done) {
    LOG("* Checking history sheets.")

    var timestamp = Date.now()

    db.zrange(
      [VALUE_SHEET_KEY, 0, -1, "WITHSCORES"],
    function(error, sheet_records) {
      var step = Math.round(sheet_records.length / 100)
      sheet_records.forEach(function(record, index) {
        var sheets_index = Math.floor(index / 2)
        if (!sheets[sheets_index]) {
          // This is a value
          sheets[sheets_index] = {
            value: parseFloat(record)
          }
        }
        else {
          // This is a timestamp
          sheets[sheets_index].time = parseInt(record)
        }
      })
      if (!series_simulation) 
        _S.controller.drawSheets(sheets, "full")
      done(error, sheets)
    })
  }

  function refreshSheets() {
    var time_stamp = Date.now()
    var current_currency_value = wallet.current.currency_value
    var cur_sheets_len = sheets.length

    if (cur_sheets_len > SHEET_SIZE_LIMIT) {
      sheets = sheets.splice((cur_sheets_len - SHEET_SIZE_LIMIT), cur_sheets_len)
    }

    if (current_currency_value > 10 && !config.simulation) {
      db.zadd(
        VALUE_SHEET_KEY, time_stamp, current_currency_value,
      function(error, response) {

        var new_value = {
          time: time_stamp,
          value: current_currency_value
        }

        sheets.push(new_value)
        if (broadcast_time && _S.controller) {
          _S.controller.drawSheets(new_value, "incremental")
        }

        // Now, let's check if we should remove any points
        db.zcard(VALUE_SHEET_KEY, function(error, sheets_size) {
          if (parseInt(sheets_size) > SHEET_SIZE_LIMIT) {
            var cutoff_size = parseInt(sheets_size) - SHEET_SIZE_LIMIT
            db.zremrangebyrank(
              VALUE_SHEET_KEY, 0, cutoff_size,
            function(error, response) {
              console.log(
                "(Former size: " + sheets_size + " / Limit: " + SHEET_SIZE_LIMIT +
                ") Removed", (cutoff_size), "points from sheets",
                "(Response: " + response + "). Current length:" + sheets.length
              )
            })
          }
        })
      })

    }
  }


  function checkWallet(done) {
    // Initialize into global var, exposed on top
    var wallet_start_timer = Date.now()

    if (cycles_until_full === 0) {
      wallet.check(live_traders, finalize)
    }
    else {
      return finalize()
    }

    function finalize() {
      if (!series_simulation && broadcast_time) {
        _S.controller.refreshShares(wallet.current.shares)
      }
      
      perf_timers.wallet += (Date.now() - wallet_start_timer)
      if (done) {
        return done()
      }
    }
  }

  function updateConfig(new_config) {
    if (configValid(new_config)) {
      for (var attribute in new_config) {
        config.trading[attribute] =
          new_config[attribute] || config.trading[attribute]
      }
      initializeConfig()
      LOG(
        "trader | updateConfig | comparison:",
        "\n: MAX_SUM_INVESTMENT / config.trading.maximum_investment:",
          MAX_SUM_INVESTMENT, config.trading.maximum_investment,
        "\n: INITIAL_GREED / config.trading.greed:",
          INITIAL_GREED, config.trading.greed
      )
    }
    else {
      if (!series_simulation) _S.controller.notifyClient({
        message: "Unable to update config, values are invalid."
      })
    }
  }


  function updateStrategy(new_config) {
    for (var attribute in new_config) {
      config.strategy[attribute] = new_config[attribute]
    }

    initializeConfig()

    LOG(
      "updateStrategy | Configuration initialized | config.strategy:",
      config.strategy
    )
  }

  function resetConfig() {
    var reset_config = require("./../plugins/config")
    config = reset_config
    initializeConfig()
  }

  // Trading config validation!

  function configValid(trading_config) {
    return (
      !isNaN(trading_config.min_purchase) &&
      trading_config.min_purchase > 1 &&
      !isNaN(trading_config.maximum_investment) &&
      trading_config.maximum_investment >= 0 &&
      !isNaN(trading_config.bid_alignment) &&
      trading_config.bid_alignment < 1 &&
      trading_config.bid_alignment > 0 &&
      trading_config.impatience <= 100 &&
      trading_config.impatience >= 0 &&
      trading_config.greed <= 50 &&
      trading_config.greed > 0
    )
  }

  function checkTraders(trader_list, done) {
    async.each(trader_list, function(trader_name, next) {
      var trader = new Trader(trader_name)
      trader.wake(next)
    }, function() {
      if (_S.controller)
        _S.controller.refreshTraders(live_traders)
      return done()
    })
  }


  function loadTraders(done) {
    live_traders = {}
    market = _S.market()
    wallet = _S.wallet()
    db.smembers(TRADER_LIST_KEY, function(error, trader_list) {
      trader_count = trader_list.length
      if (trader_list.length) {
        checkTraders(trader_list, done)
      }
      else {
        if (_S.controller)
          _S.controller.refreshTraders(live_traders)
        return done()
      }
    })
  }

  function prepareForSimulation(series) {
    //initializeConfig()
    stopAll()
    config.simulation = true
    market.simulation = true
    wallet.simulation = true
    if (series) {
      series_simulation = true
      config.series_simulation =
        market.series_simulation =
          wallet.series_simulation =
            true
    }
    cleanSheets()
  }

  function cleanSheets(done) {
    db.del(VALUE_SHEET_KEY, function(error, response) {
      LOG("cleanSheets | error:", error, response)
      if (done) return done()
    })
  }

  function addShare(holder, investment) {
    if (wallet && holder.length > 1 && investment > 0) {
      wallet.addShare(holder, investment, function(error, response) {
        console.log(
          "Added share (" + config.exchange.currency + investment +
          ") for " + holder + ". (..., error, response)", error, response
        )
      })
    }
  }

  function stopAll(done) {
    // clearTimeout(timer)
    wallet = _S.wallet()
    market = _S.market()
    sheets = []
    live_traders = {}
    unhook()
    _S.stop = true
    if (done) done()
  }

  function refreshAll() {
    if (market && wallet) {
      _S.controller.refreshMarket(market.current)
      _S.controller.refreshWallet(wallet.current)
      _S.controller.refreshTraders(live_traders)
      _S.controller.refreshOverview()
      _S.controller.refreshShares(wallet.current.shares)
      console.log("trader | refreshAll | sheets.length :", sheets.length)
      setTimeout(() => {
        _S.controller.drawSheets(sheets, "full")
      }, 2000)
    }
  }


  return {
    stopAll: stopAll,
    wakeAll: wakeAll,
    instance: Trader,
    refreshAll: refreshAll,
    pullValueSheet: pullValueSheet,
    addShare: addShare,
    updateConfig: updateConfig,
    updateStrategy: updateStrategy,
    resetConfig: resetConfig,
    live_traders: live_traders,
    config: config,
    prepareForSimulation: prepareForSimulation,
    cleanSheets: cleanSheets,
    cleanBooks: cleanBooks,
    loadTraders: loadTraders
  }
}
