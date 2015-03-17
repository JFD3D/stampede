"use strict"

module.exports = function(STAMPEDE) {

  var config = STAMPEDE.config
  var common = STAMPEDE.common
  var async = STAMPEDE.async
  var db = STAMPEDE.db
  var email = STAMPEDE.email
  var LOG = STAMPEDE.LOG("trader")
  var _ = STAMPEDE._

      // All traders will be loaded into this object
  var live_traders = {}

      // Trading performance timers initialization for benchmarking
  var perf_timers = STAMPEDE.perf_timers

  var logPerformance = common.logPerformance
      // Load Market and Walled models to initialize instances below
      /*
       *
       *
       *  Initialize market and wallet instances
       *
       *
       *
       */

  var market
  var wallet

  // Shared constants
  var TRADER_PREFIX = "trader_"
  var ID_COUNTER = "stampede_trader_number"
  var VALUE_SHEET_KEY = "stampede_value"            // Repository unsorted list for USD value history
  var TRADER_LIST_KEY = "stampede_traders"        // Main repository in redis for keeping list of traders


  // Additional shared variables
  var trader_count                                 // Current trader count
  var sheets = []                                  // Current USD value history list
  var error_email_sent                             // Indicate if email for certain error has already been sent
  var cycle_counter = perf_timers.cycle_counter    // For simulation purposes so that notification is only emitted
  var broadcast_time                               // Will compute leftover on this
  var series_simulation = false                           // Disables broadcast later, (when series of data are simulated)
  var cycle_sell_decisions = []
  var cycle_buy_decisions = []
  var currency_key = config.exchange.currency + "_available"
  var exchange_simulated = (config.exchange.selected === "simulated_exchange")
  var cycle_in_progress
  var last_cycle_end = Date.now()
  var last_full_cycle_end = Date.now()
  var cycles_until_full = 0

      /*
       *
       * Constants for trading
       *
       *
       *
       */
      
  var MAX_SUM_INVESTMENT     // Allowed max sum of investment
  var MIN_PURCHASE          // Allowed investment per trader's deal
  var INITIAL_GREED          // Greed (.05 means trader looks for 5% upside)
  var BID_ALIGN              // Align bid before buying to allow competitive price
  var IMPATIENCE             // Where do I buy up from middle

      /*
       *
       * Trading strategies
       *
       *
       *
       */    

  var MOMENTUM_ENABLED       // Purchases will be happening on momentum up trend
  var TRAILING_STOP_ENABLED  // Sales will happen only after trailing stop is reached
  var SELL_OUT               // Sell all out

      /*
       *
       * Logging options
       *
       *
       *
       */    
  var DECISION_LOGGING

      // USD value sheet size limit
  var SHEET_SIZE_LIMIT


  function initializeConfig() {

    // Trading config
    MAX_SUM_INVESTMENT = config.trading.maximum_investment
    MIN_PURCHASE = config.trading.min_purchase         
    INITIAL_GREED = (config.trading.greed / 100)
    BID_ALIGN = config.trading.bid_alignment
    IMPATIENCE = (config.trading.impatience / 100)
    // Strategies now
    MOMENTUM_ENABLED = config.strategy.momentum_trading
    TRAILING_STOP_ENABLED = config.strategy.trailing_stop
    SELL_OUT = config.strategy.sell_out
    // Logging options load
    DECISION_LOGGING = (config.logging || {}).decisions || false
    // USD value sheet size limit
    SHEET_SIZE_LIMIT = config.sheet_size_limit || 300

    // Set performance timers to zero
    perf_timers.cycle = 0
    perf_timers.decisions = 0
    perf_timers.wallet = 0
    perf_timers.market = 0
    perf_timers.market_post_assignments = 0
    perf_timers.cycle_counter = 0
    perf_timers.trader_decision_prep = 0
    perf_timers.finalize_cycle = 0
    perf_timers.is_buying = 0
    perf_timers.alt_levels = 0
    perf_timers.multiplier_calc = 0
    perf_timers.is_selling = 0
    cycles_until_full = 0
  }




  /*
   *
   *
   *  Trader prototype
   *
   *
   *
   */

  function Trader(name) {

    /*
     *
     *
     *  Trader basics
     *
     *
     *
     */

    
    this.name = name
    
    // Assign profit tracking
    this.profit = 0

    // Assign purchase tracking
    this.purchases = 0
    this.purchases_amount_currency = 0
    this.purchases_amount_btc = 0

    // Assign sales tracking
    this.sales = 0
    this.sales_amount_currency = 0
    this.sales_amount_btc = 0


    /*
     *
     *
     *  Redis repos and scopes
     *
     *
     *
     */

    
    this.book_name = "book_for_" + name
    this.main_list = TRADER_LIST_KEY
  }




  /*
   *
   *
   *  Trader engine definitions
   *
   *
   *
   */

  Trader.prototype = {

    // Record and initialize(add to shared live_traders) new trader
    create: function(done) {
      var me = this
      db.incr(ID_COUNTER, function(error, number) {
        me.name = TRADER_PREFIX + number
        db.sadd(TRADER_LIST_KEY, me.name, function(error, response) {
          live_traders[me.name] = me
          me.record = {
            amount: 0,
            average_buy_price: 0
          }
          db.hmset(me.name, me.record, function() {
            loadTraders(done)
          })
        })
      })
    },
    
    // Stop and remove trader
    remove: function(done) {
      var me = live_traders[this.name]
      var my_book = me.book_name

      async.series([
        function(internal_callback) {
          me.checkRecord(internal_callback)
        },
        function(internal_callback) {
          db.srem(TRADER_LIST_KEY, me.name, internal_callback)
        },
        function(internal_callback) {
          db.del(my_book, internal_callback)
        },
        function(internal_callback) {
          db.del(me.name, internal_callback)
        }
      ], function() {
        loadTraders(done)
      })
    },
    
    // Loads trader record from repository and then loads trader's history
    checkRecord: function(callback) {
      var trader = this
      db.hgetall(trader.name, function(error, my_record) {
        trader.record = my_record
        trader.checkBooks(callback)
      })
    },

    checkBooks: function(callback) {
      var me = this
      var book = []
      db.smembers(me.book_name, function(errors, book_records) {
        if (book_records && book_records.length) {
          book_records.forEach(function(book_record) {
            
          })
        }

      })

    },


    /*
     *
     * Awaken trader = Load all associations
     *
     *
     *
     *
     */
    
    wake: function(callback) {
      var me = this
      live_traders[me.name] = me
      me.checkRecord(callback)
    },
    
    // Decide if buying, define candidate deal

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
          - wallet is cool (to avoid fast consequent purchases)
      */

      var is_buying_start = Date.now()
      var me = this
      var decision = false

          // Current allowed investment (on top of existing)
      var current_allowed_investment = (
            MAX_SUM_INVESTMENT - wallet.current.investment
          )

          // Amount I can invest according to available and allowed
      var available_currency_amount = (
            current_allowed_investment > wallet.current[currency_key]
          ) ? wallet.current[currency_key] : current_allowed_investment

      // Available resources, compare investment 
      // and current available in wallet
      var available_resources = (
            // Check if I am not running over allowed investment amount
            (wallet.current.investment < MAX_SUM_INVESTMENT) &&
            // This serves to knock out trading 
            // (if I assign less investment than deal)
            (MAX_SUM_INVESTMENT > purchase.currency_amount) &&
            // Check if I have enough fiat to buy
            (wallet.current.available_to_traders > purchase.currency_amount)
          )
          // Calculate trader bid 
          // (aligned by bid alignment to make us competitive when bidding)
      var trader_bid = (market.current.last / (1 - (BID_ALIGN / 100)))

          // Check if aligned bid is below threshold 
          // (which combines the impatience variable)
      var bid_below_threshold = trader_bid < market.current.threshold

          // Projected buy price (dependent on existing lowest buy price, 
          // otherwise trader bid is selected)
      var projected_buy_price = (lowest_buy_price > 0 ? 
            (lowest_buy_price * altitude_drop_ratio) : trader_bid
          )


      // check that I am buying for price lower than the lowest existing
      var bid_below_lowest = (
            lowest_buy_price > 0
          ) ? (trader_bid < projected_buy_price) : bid_below_threshold

          // What is the current market acceleration
      var current_market_greed = (market.current.spread / 2)

          // What potential is the trader looking at
      var trader_greed = wallet.current.greed

          // If current wallet cool combined with greed exceeds 1
      var weighted_heat = wallet.current.cool + trader_greed
      var potential_better_than_heat = (weighted_heat > 1)

          // Check if market has positive momentum
      var market_momentum_significant = (
            market.current.momentum_record_healthy &&
            market.current.momentum_average > 0
          )
      
      purchase.buy_price = trader_bid
      me.solvent = (available_resources)
      me.inspired = (potential_better_than_heat)

      // Decision process takes place on whether to buy
      if (
        has_free_hands &&
        available_resources &&
        (!MOMENTUM_ENABLED || market_momentum_significant) &&
        bid_below_threshold &&
        bid_below_lowest &&
        potential_better_than_heat
      ) decision = true
      
      if (DECISION_LOGGING) LOG(
        "*** Buying? ***",
        "\n|- Available resources (..., wallet.current.investment):", 
          available_resources, wallet.current.investment,
        "\n|- Bid is below threshold (..., market.current.last, market.current.middle):", 
          bid_below_threshold, market.current.last.toFixed(2), 
          market.current.middle.toFixed(2),
        "\n|- Projected profit better than heat (..., wallet.current.cool, weighted_heat):", 
          potential_better_than_heat, wallet.current.cool.toFixed(2), 
          weighted_heat,
        "\n|- Market momentum is significant (..., momentum_indicator, momentum_healthy)", 
          market_momentum_significant, 
          market.current.momentum_indicator, 
          market.current.momentum_record_healthy,
        "\n_BUY__ Decision:", decision ? "BUYING" : "HOLDING",
        "\n******"
      )
      
      var structured_decision = {
        buying: decision,
        trader: 
          "T" + me.name.split("_")[1] + 
          ": " + (projected_buy_price * (1 - (BID_ALIGN / 100))).toFixed(2) + "",
        resources: available_resources,
        threshold: bid_below_threshold,
        lowest: bid_below_lowest,
        potential: (potential_better_than_heat)
      }

      if (MOMENTUM_ENABLED) {
        structured_decision.momentum = market_momentum_significant
      }

      cycle_buy_decisions.push(structured_decision)

      perf_timers.is_buying += (Date.now() - is_buying_start)
      return decision
    },


    isSelling: function(combined_deal) {
      var is_selling_start = Date.now()

      var me = this
          // Initialize resulting decision
      var decision = false
          // Deal independent calculations
      var current_market_greed = (market.current.spread / 2)
          // Calculate for comparison on deal
      var current_sale_price = (market.current.last * (1 - (BID_ALIGN / 100)))
          // Assign the same to trader in order to reuse
      me.current_sale_price = current_sale_price
          // Calculate trader greed
      var trader_greed = INITIAL_GREED + ((wallet.current.fee || 0.5) / (2*100))
          // If wallet is ready
      var weighted_heat = wallet.current.cool + trader_greed
          // Check if wallet is ready
      var potential_better_than_heat = (weighted_heat > 1)
          // XXX: Check if market has negative momentum
      var market_momentum_low = (
            market.current.momentum_record_healthy &&
            market.current.momentum_average <= 0
          )


      var structured_decision = {
        selling: false,
        trader: 
          "T"+me.name.split("_")[1] + 
          ": " + (combined_deal.would_sell_at || 0).toFixed(2) + "",
        sell_price: (combined_deal.would_sell_at < current_sale_price),
        cool: potential_better_than_heat
      }

      // If trailing stop enabled, add to structured decision
      // Set the stop deal as deal to sell if not selling combined deal
      // And if trailing stop was hit
      if (TRAILING_STOP_ENABLED) {
        structured_decision.trailing_stop = (
          combined_deal.stop_price >= current_sale_price && 
          selected_deal_count > 0
        )
        combined_deal.trailing_stop = structured_decision.trailing_stop
        if (combined_deal.currency_amount) {
          structured_decision.trader += (
            " (STOP:" + combined_deal.stop_price.toFixed(2) + ")"
          )
        }
      }

      structured_decision.managed = (
        combined_deal.amount <= wallet.current.btc_balance
      )

      if (
        !structured_decision.managed && 
        structured_decision.sell_price
      ) {
        LOG(
          "unmanaged |", 
          "amount:", 
          combined_deal.amount, 
          "btc_balance:", wallet.current.btc_balance, 
          "bal/am", 
          (wallet.current.btc_balance / combined_deal.amount).toFixed(3), "%",
          "bal-am",
          (wallet.current.btc_balance - combined_deal.amount).toFixed(6), "BTC"
        )
      }

      var possible_to_sell = (
            structured_decision.managed &&
            structured_decision.cool
          )

      // Check trailing stop, if enabled affect decision
      structured_decision.selling = (
        possible_to_sell &&
        (
          structured_decision.sell_price &&
          (!TRAILING_STOP_ENABLED || structured_decision.trailing_stop)
        )
      )

      // Add the decision to array which will be rendered on client
      cycle_sell_decisions.push(structured_decision)

      // Log the success!
      if (
        structured_decision.selling && 
        DECISION_LOGGING
      ) console.log(
        "||| trader | sellingCheck | " + 
        "isSelling? | structured_decision:", 
        structured_decision
      )

      // Check all outstanding factors and make final decision
      var decision = structured_decision.selling

      if (decision && DECISION_LOGGING) console.log(
        "*** Selling deal? ***",
        "\n|- amount is managed (amount):", 
          (combined_deal.amount <= wallet.current.btc_balance), 
          combined_deal.amount,
        "\n|- potential_better_than_heat:", potential_better_than_heat,
        "\n_SALE_ Decision:", decision ? "SELLING" : "HOLDING",
        "\nDeal evaluated details:", combined_deal
      )

      perf_timers.is_selling += (Date.now() - is_selling_start)
      return decision 
    },
    
    decide: function(done) {
      var me = this
      //Sanity check
      if (market.current.last > 5) {
        var purchase = {},
            sale = {}

        if (me.isBuying(purchase)) {
          me.buy(purchase, done)
        }
        else if (me.isSelling(sale)) {
          me.sell(sale, done)
        }
        else {
          done()
        }
      }
      else {
        console.log(
          "("+me.name+"): Market is not ready for my decisions yet (market).",
          market.current
        )
        done()
      }
    },
    
    buy: function(purchase, done) {
      var me = this
      var currency_buy_amount = purchase.currency_amount

      purchase.amount = parseFloat(
        (currency_buy_amount / purchase.buy_price).toFixed(7))
      purchase.sell_price = (
        purchase.buy_price * (1 + INITIAL_GREED + (wallet.current.fee / 100))
      )
      purchase.heat = INITIAL_GREED
      wallet.current.cool -= (market.current.spread * 10)
      
      // Reset cycles to load all (market, wallet) details
      cycles_until_full = 1

      //wallet.current.investment += deal.buy_price
      if (!series_simulation) STAMPEDE.controller.notifyClient({
        message: 
          "+B " + purchase.amount.toFixed(5) + 
          "BTC for " + currency_buy_amount.toFixed(2) + 
          " " + config.exchange.currency.toUpperCase() + 
          " at " + purchase.buy_price.toFixed(2) + 
          " " + config.exchange.currency.toUpperCase()+" per BTC.", 
        permanent: true
      })
      
      STAMPEDE.controller.buy(
        purchase.amount.toFixed(7), 
        purchase.buy_price.toFixed(2),
      function(error, order) {
        if (DECISION_LOGGING) console.log(
          "trader | buy | order, error:", order, error
        )
        if (
          order &&
          order.id
        ) {
          deal.order_id = order.id
          me.purchases++
          me.purchases_amount_currency += currency_buy_amount
          me.purchases_amount_btc += deal.amount

          if (!exchange_simulated) email.send({
            to: config.owner.email,
            subject: "Stampede - Buying: " + deal.amount.toFixed(7) + "BTC",
            template: "purchase.jade",
            data: {
              purchase: purchase,
              market: market,
              wallet: wallet
            }
          }, function(success) {
            console.log("Email sending success?:", success)
            if (error_email_sent) error_email_sent = null
          })
          me.recordPurchase(purchase, done)
        }
        else {
          if (!exchange_simulated) email.send({
            to: config.owner.email,
            subject: "Stampede: Error BUYING deal through bitstamp API",
            template: "error.jade",
            data: {error: error}
          }, function(success) {
            console.log("ERROR Email sending success?:", success)
            error_email_sent = true
          })
          done()
        }
      })
    },

    

    // Takes
    /*
    deal = {
      buy_price: Num float,
      amount: Num float,
      names: Array strings,
      currency_value: Num float,
      currency_amount: Num float
    }
    */

    sell: function(sale, done) {

      var me = this
      var sell_price = (market.current.last * (1 - (BID_ALIGN / 100)))
      var buy_price = sale.buy_price
      sale.heat = sale.buy_price / MAX_SUM_INVESTMENT
      sale.aligned_sell_price = sell_price.toFixed(2)
      var profit_loss = ((sale.currency_value - sale.currency_amount) || 0)
      var profit_loss_perc = (
            1 - (sale.currency_amount / sale.currency_value)
          ) * 100
      var currency_label = config.exchange.currency.toUpperCase()
      
      // Align current cool to avoid all sell / buy
      wallet.current.cool -= (market.current.spread * 10)

      // Reset cycles to load all (market, wallet) details
      cycles_until_full = 1
      
      if (!series_simulation) STAMPEDE.controller.notifyClient({
        message: 
          "-S" + ((sale.trailing_stop && !sale.shed) ? "(STOP)" : (sale.shed ? "(SHED)" : "(REG)")) +
          " " + deal.amount.toFixed(5) + 
          " BTC for " + ((market.current.last * (1 - (BID_ALIGN / 100)))*sale.amount).toFixed(2) + 
          " " + currency_label + 
          " at " + sale.aligned_sell_price + 
          " " + currency_label +
          " per BTC. (" + (profit_loss > 0 ? "+" : "") + 
          (profit_loss).toFixed(2) + ", " + profit_loss_perc.toFixed(2) + "%)",
        permanent: true
      })

      STAMPEDE.controller.sell(
        sale.amount.toFixed(7), 
        sale.aligned_sell_price, 
      function(error, order) {
        if (DECISION_LOGGING) console.log(
          "EXCHANGE: Response after attempt to sell | error, order:", 
          error, order
        )
        if (
          order && 
          order.id
        ) {
          var sell_currency_amount = sell_price * sale.amount
          var buy_currency_amount = buy_price * sale.amount
          var buy_fee = buy_currency_amount * (wallet.current.fee / 100)
          var sell_fee = sell_currency_amount * (wallet.current.fee / 100)

          me.sales++
          me.sales_amount_currency += sell_currency_amount
          me.sales_amount_btc += sale.amount
          me.profit += (
            sell_currency_amount - buy_currency_amount - buy_fee - sell_fee
          )

          // Record sale to history
          me.recordSale(sale, done)

          if (!exchange_simulated) email.send({
            subject: "Stampede - Selling at: "+deal.name,
            template: "sale.jade",
            data: {
              sale: sale,
              market: market,
              wallet: wallet
            }
          }, function(success) {
            console.log("Email sending success?:", success)
            if (error_email_sent) error_email_sent = null
          })
        }
        else {
          sale.order_id = "freeze"
          if (!exchange_simulated) email.send({
            subject: "Stampede: Error SELLING through bitstamp API",
            template: "error.jade",
            data: {error:error}
          }, function(success) {
            console.log("ERROR Email sending success?:", success)
            error_email_sent = true
          })   
          done()
        }
      })
      
    }
  }


  function wakeAll(done) {
    STAMPEDE.stop = false
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
    })
  }

  function hook(callback) {
    STAMPEDE.exchange.startTicking()
    STAMPEDE.exchange.tickEmitter.on("tick", tick)
    callback()
  }

  function unhook() {
    STAMPEDE.exchange.stopTicking()
  }

  // Trigger ticking market per streaming API
  function tick(data) {
    market.current.last = data.price
    var time_since_last_cycle = (Date.now() - last_cycle_end)
    var delay_permitted = (exchange_simulated || time_since_last_cycle > 1000)

    if (!cycle_in_progress && !STAMPEDE.stop && delay_permitted) {
      cycle()
    }
    // else {
    //   LOG(
    //     "tick | cycle disallow | delay_permitted, time_since_last_cycle:", 
    //     delay_permitted, (time_since_last_cycle / 1000).toFixed(2), "seconds."
    //   )
    // }
  }

  function cycle(done) {
    cycle_in_progress = true
    if (!config.simulation) console.log("Cycle initiated.")

    var cycle_start_timer = Date.now()
    perf_timers.cycle_counter++
    broadcast_time = (
      !config.simulation || perf_timers.cycle_counter % 1000 === 0
    ) && !series_simulation

    // Update client on performed decisions
    if (broadcast_time) {
      STAMPEDE.controller.refreshDecisions({
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
      perf_timers.cycle += (Date.now() - cycle_start_timer)
      finalizeCycle(cycle_start_timer)
      if (done) {
        return done()
      }
    })
  }

  function finalizeCycle(cycle_start_timer) {
    var finalize_cycle_start = Date.now()
    // Export current market and wallet data
    STAMPEDE.current_market = market.current
    STAMPEDE.current_wallet = wallet.current
    STAMPEDE.current_traders = live_traders
    
    if (broadcast_time) {
      STAMPEDE.controller.refreshOverview()
    }
    
    var stop_cycles = 
          (config.simulation && market.current.error) || STAMPEDE.stop

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
      async.each(trader_names, function(trader_name, internal_callback) {
        var trader = live_traders[trader_name]
        trader.decide(internal_callback)
      }, function() {
        perf_timers.decisions += (Date.now() - decisions_start_timer)
        var cool_up = INITIAL_GREED
        wallet.current.cool = (
          wallet.current.cool < 1 && 
          cool_up < (1 - wallet.current.cool)
        ) ? (wallet.current.cool + cool_up) : 1
        if (done) {
          return done()
        }
      })
    }
    else {
      console.log("No traders present or market simulation stopped.")
      STAMPEDE.stop_simulation = true
      if (done) { 
        return done()
      }
    }
  }

  function checkMarket(done) {
    var market_start_timer = Date.now()

    if (cycles_until_full === 0) {
      market.check(function(error, market_current) {
        return finalize()
      })
    }
    else {
      return finalize()
    }

    function finalize() {
      var market_post_assignments_start = Date.now()
      market.current.threshold = (
        IMPATIENCE * (market.current.high - market.current.middle) + 
        market.current.middle
      )
      market.current.trader_bid = (
        market.current.last / (1 - (BID_ALIGN / 100))
      )
      wallet.current.currency_value = 
        (wallet.current.btc_balance || 0) * (market.current.last || 0) + 
        (wallet.current[config.exchange.currency + "_balance"] || 0)
      // refresh client side on current market and wallet data 
      if (broadcast_time) {
        STAMPEDE.controller.refreshTraders(live_traders)
        STAMPEDE.controller.refreshWallet(wallet.current)
        STAMPEDE.controller.refreshMarket(market.current)
      }
      perf_timers.market_post_assignments += (
        Date.now() - market_post_assignments_start
      )
      perf_timers.market += (Date.now() - market_start_timer)
      if (done) {
        return done()
      }
    }
  }

  function pullValueSheet(callback) {
    callback(sheets)
  }

  function checkSheets(done) {
    console.log("* Checking history sheets.")
    
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
      STAMPEDE.controller.drawSheets(sheets, "full")
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
        if (broadcast_time) {
          STAMPEDE.controller.drawSheets(new_value, "incremental")
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
      wallet.check(live_traders, function() {
        return finalize()
      })
    }
    else {
      return finalize()
    }

    function finalize() {
      if (!series_simulation && broadcast_time) {
        STAMPEDE.controller.refreshShares(wallet.shares)
      }
      wallet.assignAvailableResources(MAX_SUM_INVESTMENT)
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

      console.log(
        "trader | updateConfig | comparison:",
        "\n: MAX_SUM_INVESTMENT / config.trading.maximum_investment:", 
          MAX_SUM_INVESTMENT, config.trading.maximum_investment,
        "\n: INITIAL_GREED / config.trading.greed:", 
          INITIAL_GREED, config.trading.greed
      )
    }
    else {
      if (!series_simulation) STAMPEDE.controller.notifyClient({
        message: "Unable to update config, values are invalid."
      })
    }
  }


  function updateStrategy(new_config) {
    for (var attribute in new_config) {
      config.strategy[attribute] = new_config[attribute]
    }

    initializeConfig()

    console.log(
      "updateStrategy | Configuration initialized | config.strategy:", 
      config.strategy
    )
  }

  function resetConfig() {
    var reset_config = require("./../plugins/config")
    console.log("resetConfig | reset_config.trading:", reset_config.trading)
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
    async.each(trader_list, function(trader_name, internal_callback) {
      var trader = new Trader(trader_name)
      trader.wake(internal_callback)
    }, function() {
      LOG("checkTraders | trader_list:", trader_list)
      STAMPEDE.controller.refreshTraders(live_traders)
      done()
    })
  }


  function loadTraders(done) {
    live_traders = {}
    market = new STAMPEDE.market()
    wallet = new STAMPEDE.wallet()
    db.smembers(TRADER_LIST_KEY, function(error, trader_list) {
      LOG("loadTraders, Viewing ("+trader_list.length+") traders...")
      trader_count = trader_list.length
      if (trader_list.length) {
        checkTraders(trader_list, done)
      }
      else {
        LOG("loadTraders | NO!! trader_list:", trader_list)
        STAMPEDE.controller.refreshTraders(live_traders)
        done()
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
    wallet = new STAMPEDE.wallet()
    market = new STAMPEDE.market()
    sheets = []
    live_traders = {}

    unhook()
    STAMPEDE.stop = true
    if (done) done()
  }

  function refreshAll() {
    var CON = STAMPEDE.controller
    CON.refreshTraders(live_traders)
    CON.refreshOverview()
    CON.refreshMarket(market.current)
    CON.refreshWallet(wallet.current)
    CON.refreshShares(wallet.shares)
    console.log("trader | refreshAll | sheets.length :", sheets.length)
    setTimeout(CON.drawSheets(sheets, "full"), 5000)
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
    loadTraders: loadTraders
  }
}