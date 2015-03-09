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

  var market = new STAMPEDE.market()
  var wallet = new STAMPEDE.wallet()

      // Additional shared variables

  var trader_count                                 // Current trader count
  var sheets = []                                  // Current USD value history list
  var error_email_sent                             // Indicate if email for certain error has already been sent
  var trader_main_list = "stampede_traders"        // Main repository in redis for keeping list of traders
  var stampede_value_sheet = "stampede_value"      // Repository unsorted list for USD value history
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
  var BASE_PER_DEAL          // Allowed investment per trader's deal
  var MAX_DEALS_HELD         // Number of trader deals
  var INITIAL_GREED          // Greed (.05 means trader looks for 5% upside)
  var BID_ALIGN              // Align bid before buying to allow competitive price
  var IMPATIENCE             // Where do I buy up from middle
  var ALTITUDE_DROP          // Defined lower price percentage to buy at

      /*
       *
       * Trading strategies
       *
       *
       *
       */    

  var MOMENTUM_ENABLED       // Purchases will be happening on momentum up trend
  var TRAILING_STOP_ENABLED  // Sales will happen only after trailing stop is reached
  var SHEDDING_ENABLED       // We sell all after value dropping below percentage
  var BELL_BOTTOM_ENABLED    // Purchases will be sized up going down the price per trader
  var COMBINED_SELLING       // Sell highest and lowest priced BTC combined
  var DYNAMIC_MULTIPLIER     // Purchase size adjustment
  var DYNAMIC_DROP           // Increase altitude drop in fibonacci series

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

    // Trading configuration variables
    MAX_SUM_INVESTMENT = config.trading.maximum_investment
    BASE_PER_DEAL = config.trading.base_currency_per_deal         
    MAX_DEALS_HELD = config.trading.max_number_of_deals_per_trader
    INITIAL_GREED = (config.trading.greed / 100)
    BID_ALIGN = config.trading.bid_alignment
    IMPATIENCE = (config.trading.impatience / 100)
    ALTITUDE_DROP = config.trading.altitude_drop

    // Strategies now
    MOMENTUM_ENABLED = config.strategy.momentum_trading
    TRAILING_STOP_ENABLED = config.strategy.trailing_stop
    SHEDDING_ENABLED = config.strategy.shedding
    BELL_BOTTOM_ENABLED = config.strategy.bell_bottom
    COMBINED_SELLING = config.strategy.combined_selling
    DYNAMIC_MULTIPLIER = config.strategy.dynamic_multiplier
    DYNAMIC_DROP = config.strategy.dynamic_drop

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
    perf_timers.future_deals = 0
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
    this.purchases = 0
    this.sales = 0
    this.deals = []

    /*
     *
     *
     *  Redis repos and scopes
     *
     *
     *
     */

    this.id_counter = "stampede_trader_number"
    this.trader_prefix = "trader_"
    this.book_prefix = "book_for_"
    this.main_list = trader_main_list
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
      db.incr(me.id_counter, function(error, number) {
        me.name = me.trader_prefix + number
        db.sadd(trader_main_list, me.name, function(error, response) {
          me.record = {
            book: me.book_prefix + me.name,
            deals: MAX_DEALS_HELD
          }
          me.deals = new Array()
          live_traders[me.name] = me
          me.record.current_investment = 0
          me.record.current_deals = 0
          db.hmset(me.name, me.record, function() {
            loadTraders(done)
          })
        })
      })
    },
    
    // Stop and remove trader
    remove: function(done) {
      var me = live_traders[this.name]
      var my_book = me.record.book

      async.series([
        function(internal_callback) {
          me.checkRecord(internal_callback)
        },
        function(internal_callback) {
          db.srem(trader_main_list, me.name, internal_callback)
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
    
    // Loads trader's deals
    checkInventory: function(callback) {
      var me = this
      me.deals = new Array()
      if (
        me.record && me.record.book && !exchange_simulated
      ) {
        db.smembers(me.record.book, function(error, deals) {
          deals.forEach(function(deal, index) {
            me.deals.push(parseDeal(deal))
          })
          if (callback) {
            return callback(error)
          }
        })
      }
      else if (callback) {
        return callback()
      }
    },

    // Loads trader record from repository and then loads trader's deals
    checkRecord: function(callback) {
      var trader = this
      db.hgetall(trader.name, function(error, my_record) {
        trader.record = my_record
        trader.checkInventory(callback)
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
    
    /*
     *
     * When trader is awake
     *
     *
     *
     *
     */
    
    genFutureDeals: function(price_levels) {
      var me = this
      var future_start = Date.now()

      me.future_deals = new Array()
      me.future_deals_overlap = me.deals.slice(0, 2)
      me.future_deals_sum = 0

      price_levels.forEach(function(price_level, level_index) {

        var future_deal = {buy_price: price_level}

        if (DYNAMIC_MULTIPLIER) {
          future_deal.amount = (
            me.lowest_buy_amount * Math.pow(me.deal_ratio, level_index + 1)
          )
        }
        else {
          var last_2_deals = me.future_deals_overlap.slice(0, 2)
          var last_2_deal_amounts = common.extract(last_2_deals, "amount")
          future_deal.amount = common.sum(last_2_deal_amounts)
          me.future_deals_overlap.unshift(future_deal)
        }
        future_deal.currency_amount = (
          future_deal.buy_price * future_deal.amount
        )

        me.future_deals_sum += future_deal.currency_amount
        if (me.future_deals_sum < wallet.current.available_to_traders) {
          me.future_deals.push(future_deal)
        }
      })

      perf_timers.future_deals += (Date.now() - future_start)

    },

    // decide if buying, define candidate deal

    isBuying: function(purchase) {
      var is_buying_start = Date.now()
      var me = this
      var decision = false

          // Get the lowest price of deal bought
      var deals = me.deals
      var borders = deals.extremesByKey("buy_price")

      var lowest_buy_price = borders.min.buy_price || 0

      var lowest_buy_amount = borders.min.amount || 0

      var lowest_currency_amount = (
            (lowest_buy_price * lowest_buy_amount) || BASE_PER_DEAL
          )


          // Current allowed investment (on top of existing)
      var current_allowed_investment = (
            MAX_SUM_INVESTMENT - wallet.current.investment
          )

          // Amount I can invest according to available and allowed
      var available_currency_amount = (
            current_allowed_investment > wallet.current[currency_key]
          ) ? wallet.current[currency_key] : current_allowed_investment



          // Check if trader has available spot for another deal
      var has_free_hands = MAX_DEALS_HELD > deals.length

      // Initial bought amount is the min per deal amount and ratio is 1
      var deal_ratio = 1

      // Cumulate new deal amount with ratio (static[fibonacci / 2], dynamic)
      // Define altitude drop
      
      
      var altitude_drop_float = ((ALTITUDE_DROP || 0) / 100)
      var altitude_drop_ratio = 1 - (DYNAMIC_DROP ? (
            (DYNAMIC_MULTIPLIER ? (
                altitude_drop_float * (deals.length)
              ) : (
                altitude_drop_float * common.fibonacci(deals.length)
              )
            )
          ) : altitude_drop_float)

      
      // Assign price levels to current object so we can display it
      if (
        BELL_BOTTOM_ENABLED &&
        deals.length
      ) {

        // Get array of price levels which the trader will traverse 
        // until hitting bottom of lowest price / through altitude drop
        var price_levels = getAltitudeLevels({
              min: (market.current.last / 2),
              max: (
                lowest_buy_price < market.current.last ? 
                  lowest_buy_price : market.current.last
              ),
              drop_float: altitude_drop_float,
              dyn_drop: DYNAMIC_DROP,
              dyn_multi: DYNAMIC_MULTIPLIER,
              impatience: IMPATIENCE,
              cur_len: deals.length
            })


        // For fibonacci static multiplier, get lowest 2 deals
        var last_2_deals = deals.slice(0, 2)
        var last_2_deal_amounts = common.extract(last_2_deals, "amount")
        var last_2_deals_sum = common.sum(last_2_deal_amounts)
        var multi_calc_start = Date.now()

        // Dynamic deal ratio if it is enabled (if not, default to 2)
        deal_ratio = (
          DYNAMIC_MULTIPLIER
        ) ? common.getCurrentRatio(
          available_currency_amount, price_levels, 1.99, lowest_currency_amount
        ) : (last_2_deals_sum ? (last_2_deals_sum / lowest_buy_amount) : 1)

        perf_timers.multiplier_calc += (Date.now() - multi_calc_start)

        me.deal_ratio = deal_ratio

        me.last_2_deals_sum = last_2_deals_sum
        me.lowest_buy_amount = lowest_buy_amount
        if (!series_simulation) me.genFutureDeals(price_levels)
      }

      purchase.currency_amount = (lowest_currency_amount * deal_ratio)

      

      // Assign calculated values to trader so that we can display them
      me.next_deal_ratio = deal_ratio
      me.next_deal_amount = purchase.currency_amount

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

          // If existing deals, 
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
        "*** Buying deal? ***",
        "\n|- Has hands available (..., me.deals.length):", 
          has_free_hands, me.deals.length,
        "\n|- Available resources (..., wallet.current.investment):", 
          available_resources, wallet.current.investment,
        "\n|- Bid is below threshold (..., market.current.last, market.current.middle):", 
          bid_below_threshold, market.current.last.toFixed(2), 
          market.current.middle.toFixed(2),
        "\n|- Bid is lowest among deals (..., lowest_buy_price):", 
          bid_below_lowest, lowest_buy_price.toFixed(2),
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
        hands: has_free_hands,
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
          // Bring my deals into scope
      var deals = me.deals
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

      // Build combined deal attributes
      prepareCombinedDeal(combined_deal)

      // Get min and max deal from all, initialize a combined deal for further calc
      var borders = deals.extremesByKey("buy_price")

      // Calculate weighted price for deals from extremes (lowes and highest)
      // Only if COMBINED SELLING is enabled:
      // We will sell them at once if the -
      // Weighted average + fees and profit is below market last
      var selected_extremes = COMBINED_SELLING ? ["min", "max"] : ["min"];

      // If shedding is enabled, sell all
      // var deals_or_extremes = (SHEDDING_ENABLED ? deals : selected_extremes)
      selected_extremes.forEach(function(extreme) {
        var current = borders[extreme]
        if (
          current && 
          combined_deal.names.indexOf(current.name) === -1
        ) {
          combined_deal.currency_amount += (current.buy_price * current.amount)
          combined_deal.max_currency_amount += 
            (
              (
                current.max_price > current.buy_price
              ) ? current.max_price : current.buy_price
            ) * current.amount
          combined_deal.amount += current.amount
          combined_deal.amounts.push(current.amount)
          combined_deal.names.push(current.name)
        }
        else if (!config.simulation) {
          console.log(
            "sellingCheck | deal combination skip | current, " + 
            "combined_deal,",
            current, combined_deal
          )
        }
      })
      
      if (combined_deal.amount > 0) {
        combined_deal.buy_price = (
          combined_deal.currency_amount / combined_deal.amount
        )
        combined_deal.currency_value = (
          combined_deal.amount * current_sale_price
        )
        combined_deal.max_price = (
          combined_deal.max_currency_amount / combined_deal.amount
        )
        combined_deal.would_sell_at = (
          combined_deal.buy_price * (1 + trader_greed + (BID_ALIGN / 100))
        )
      }
      
      /* 

        Deal dependent calculations

      */

      // Stop price is the max price reduced by half of greed
      combined_deal.stop_price = 
        (combined_deal.max_price) * (1 - (trader_greed / 2))

      // Create structured decision object (rendered on client), 
      // used for consolidated decision check
      var selected_deal_count = combined_deal.names.length

      var structured_decision = {
        selling: false,
        trader: 
          "T"+me.name.split("_")[1] + 
          ": " + (combined_deal.would_sell_at || 0).toFixed(2) + "",
        sell_price: (combined_deal.would_sell_at < current_sale_price),
        has_deals: (
          selected_deal_count > 0// || (!COMBINED_SELLING && selected_deal_count)
        ),
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
        structured_decision.has_deals && 
        structured_decision.sell_price
      ) {
        LOG(
          "unmanaged |", 
          "amount:", 
          combined_deal.amount, 
          "btc_balance:", wallet.current.btc_balance, 
          "amounts:", combined_deal.amounts,
          "bal/am", 
          (wallet.current.btc_balance / combined_deal.amount).toFixed(3), "%",
          "bal-am",
          (wallet.current.btc_balance - combined_deal.amount).toFixed(6), "BTC"
        )
      }

      var possible_to_sell = (
            structured_decision.managed &&
            structured_decision.has_deals &&
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

      if (
        SHEDDING_ENABLED && deals.length > 1 && !structured_decision.selling
      ) {
        prepareCombinedDeal(combined_deal)
        var expensive_deals = (
              deals.slice(Math.ceil(deals.length / 2), deals.length)
            )
        deals.forEach(function(deal) {
          combined_deal.names.push(deal.name)
          combined_deal.amount += deal.amount
          combined_deal.currency_amount += (deal.buy_price * deal.amount)
        })
        combined_deal.currency_value = (
          combined_deal.amount * current_sale_price
        )
        structured_decision.managed = (
          combined_deal.amount <= wallet.current.btc_balance
        )
        var deal_value_diff = (
              combined_deal.currency_value / combined_deal.currency_amount
            )

        structured_decision.shedding = (
          (1 - deal_value_diff) > (trader_greed / 2)
        )

        structured_decision.trader += (
          " (SHED:" + 
            ((1 - (trader_greed / 2)) * me.average_buy_price).toFixed(2) + ")"
        )

        if (
          structured_decision.shedding &&
          structured_decision.managed &&
          !me.solvent
        ) {
          structured_decision.selling = true
          combined_deal.shed = true
        }
      }

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
        var purchase_deal = {},
            sale_deal = {}

        if (me.isBuying(purchase_deal)) {
          me.buy(purchase_deal, done)
        }
        else if (me.deals.length && me.isSelling(sale_deal)) {
          me.sell(sale_deal, done)
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
    
    buy: function(deal, done) {
      var me = this
      var currency_buy_amount = deal.currency_amount

      deal.amount = parseFloat(
        (currency_buy_amount / deal.buy_price).toFixed(7))
      deal.sell_price = (
        deal.buy_price * (1 + INITIAL_GREED + (wallet.current.fee / 100))
      )
      deal.heat = INITIAL_GREED
      wallet.current.cool -= (market.current.spread * 10)
      
      // Reset cycles to load all (market, wallet) details
      cycles_until_full = 1

      //wallet.current.investment += deal.buy_price
      if (!series_simulation) STAMPEDE.controller.notifyClient({
        message: 
          "+B " + deal.amount.toFixed(5) + 
          "BTC for " + currency_buy_amount.toFixed(2) + 
          " " + config.exchange.currency.toUpperCase() + 
          " at " + deal.buy_price.toFixed(2) + 
          " " + config.exchange.currency.toUpperCase()+" per BTC.", 
        permanent: true
      })
      
      STAMPEDE.controller.buy(
        deal.amount.toFixed(7), 
        deal.buy_price.toFixed(2),
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
          me.resetCurrentMaximumPrice()
          if (!exchange_simulated) email.send({
            to: config.owner.email,
            subject: "Stampede - Buying: " + deal.amount.toFixed(7) + "BTC",
            template: "purchase.jade",
            data: {
              deal: deal,
              market: market,
              wallet: wallet
            }
          }, function(success) {
            console.log("Email sending success?:", success)
            if (error_email_sent) error_email_sent = null
          })
          me.recordDeal(deal, done)      
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

    sell: function(deal, done) {

      var me = this
      var sell_price = (market.current.last * (1 - (BID_ALIGN / 100)))
      var buy_price = deal.buy_price
      deal.heat = deal.buy_price / MAX_SUM_INVESTMENT
      deal.aligned_sell_price = sell_price.toFixed(2)
      var profit_loss = ((deal.currency_value - deal.currency_amount) || 0)
      var profit_loss_perc = (
            1 - (deal.currency_amount / deal.currency_value)
          ) * 100
      var currency_label = config.exchange.currency.toUpperCase()
      
      // Align current cool to avoid all sell / buy
      wallet.current.cool -= (market.current.spread * 10)

      // Reset cycles to load all (market, wallet) details
      cycles_until_full = 1
      
      if (!series_simulation) STAMPEDE.controller.notifyClient({
        message: 
          "-S" + ((deal.trailing_stop && !deal.shed) ? "(STOP)" : (deal.shed ? "(SHED)" : "(REG)")) +
          " " + deal.amount.toFixed(5) + 
          " BTC for " + ((market.current.last * (1 - (BID_ALIGN / 100)))*deal.amount).toFixed(2) + 
          " " + currency_label + 
          " at " + deal.aligned_sell_price + 
          " " + currency_label +
          " per BTC. (" + (profit_loss > 0 ? "+" : "") + 
          (profit_loss).toFixed(2) + ", " + profit_loss_perc.toFixed(2) + "%)",
        permanent: true
      })

      STAMPEDE.controller.sell(
        deal.amount.toFixed(7), 
        deal.aligned_sell_price, 
      function(error, order) {
        if (DECISION_LOGGING) console.log(
          "EXCHANGE: Response after attempt to sell | error, order:", 
          error, order
        )
        if (
          order && 
          order.id
        ) {
          var sell_currency_amount = sell_price * deal.amount
          var buy_currency_amount = buy_price * deal.amount
          var buy_fee = buy_currency_amount * (wallet.current.fee / 100)
          var sell_fee = sell_currency_amount * (wallet.current.fee / 100)

          me.sales++
          me.profit = (me.profit || 0) + (
            sell_currency_amount - buy_currency_amount - buy_fee - sell_fee
          )

          // Create asynchronous queue that will 
          // purge sold deals from redis and live traders
          async.each(deal.names, function(deal_name, internal_callback) {
            me.removeDeal(deal_name, internal_callback)
          }, done)

          if (!exchange_simulated) email.send({
            subject: "Stampede - Selling at: "+deal.name,
            template: "sale.jade",
            data: {
              deal: deal.names,
              market: market,
              wallet: wallet
            }
          }, function(success) {
            console.log("Email sending success?:", success)
            if (error_email_sent) error_email_sent = null
          })
        }
        else {
          deal.order_id = "freeze"
          if (!exchange_simulated) email.send({
            subject: "Stampede: Error SELLING deal through bitstamp API",
            template: "error.jade",
            data: {error:error}
          }, function(success) {
            console.log("ERROR Email sending success?:", success)
            error_email_sent = true
          })   
          done()
        }
      })
      
    },
    
    recordDeal: function(deal, callback) {
      var me = this
      me.deals.push(deal)
      var deal_string = stringDeal(deal)

      if (!exchange_simulated) {
        db.sadd(me.record.book, deal.name, callback)
      }
      else callback()
    },
    
    removeDeal: function(deal_name, callback) {
      var me = this
      var deal_position = me.deals.lookupIndex("name", deal_name)

      //console.log("removeDeal | me.deals, deal_name:", me.deals, deal_name)
      if (deal_position > -1) {
        me.deals.splice(deal_position, 1)
        if (!exchange_simulated) {
          db.srem(me.record.book, deal_name, callback)
        }
        else callback()
      }
      else {
        console.log(
          "!!! trader | removeDeal | Unable to find deal for removal | deal_name", 
          deal_name
        )
        callback("Problems finding deal.", null)
      }
    },

    //sellDeal

    sellDeal: function(deal_name, callback) {
      var me = this
      var deal_item = me.deals.lookup("name", deal_name)

      //console.log("removeDeal | me.deals, deal_name:", me.deals, deal_name)
      if (deal_item && deal_item.amount > 0) {
        var deal_to_sell = {
          buy_price: deal_item.buy_price,
          amount: deal_item.amount,
          names: [deal_item.name]
        }
        me.sell(deal_to_sell, callback)
      }
      else {
        console.log(
          "!!! trader | sellDeal | Unable to find valid deal for sale | deal_name", 
          deal_name
        )
        callback("Problems finding deal.", null)
      }
    },

    highlightExtremeDeals: function() {
      var me = this
      var all_deals = me.deals
      var borders = all_deals.extremesByKey("buy_price")

      if (
        borders.min && 
        borders.max &&
        borders.min.name !== borders.max.name
      ) all_deals.forEach(function(deal) {
        deal.is_highest = (deal.name === borders.max.name)    
        deal.is_lowest = (deal.name === borders.min.name)
      })
    },

    addCurrentMaximumPrice: function() {
      var me = this
      var current_market = market.current
      
      me.btc_amount = 0 
      me.currency_amount = 0
      if (me.deals.length) {
        me.deals.forEach(function(deal) {
          me.btc_amount += deal.amount
          me.currency_amount += (deal.amount * deal.buy_price)
          deal.max_price = (
            deal.max_price > current_market.last
          ) ? deal.max_price : current_market.last
        })
        me.average_buy_price = (me.currency_amount / me.btc_amount)
      }
    },

    resetCurrentMaximumPrice: function() {
      var me = this
      var current_market = market.current

      if (current_market.last && me.deals.length) {
        me.deals.forEach(function(deal) {
          deal.max_price = current_market.last
        })
      }
    },

    sortDealsByPrice: function() {
      var me = this
      var deals = me.deals || []

      if (deals.length) {
        deals.sort(function(a, b) {
          return a.buy_price - b.buy_price
        })
      }
    }
  }

  // END OF trader prototype definitions

  // Generate altitude levels
  function getAltitudeLevels(options) {
    var levels = []
    var price_cursor = options.max
    var cur_len = options.cur_len
    var drop_float = options.drop_float
    var dyn_drop = options.dyn_drop
    var impatience = options.impatience
    var dyn_multi = options.dyn_multi
    var alt_start = Date.now()

    if (drop_float) {
      do {
        price_cursor = price_cursor / (1 + (
          dyn_drop ? (dyn_multi ? (
            drop_float * (cur_len + levels.length)
          ) : (
            common.fibonacci(cur_len + levels.length) * drop_float
          )
        ) : drop_float))
        levels.push(price_cursor)
      } while (price_cursor > options.min)
    }
    //LOG("getAltitudeLevels | levels:", levels, dyn_drop)
    perf_timers.alt_levels += (Date.now() - alt_start)
    return levels
  }

  // Create a hash by deal name to lookup deals and their traders
  function findByDeal(deal_name) {
    var deal_sheet = {}

    for (var trader_name in live_traders) {
      var trader_deals = live_traders[trader_name].deals
      if (
        trader_deals && 
        trader_deals.length > 0
      ) {
        trader_deals.forEach(function(deal) {
          deal_sheet[deal.name] = trader_name
        })
      }
    }
    return live_traders[deal_sheet[deal_name]]
  }

  // Retrieve ALL deals
  function getAllDeals() {
    var all_deals = []

    for (var trader_name in live_traders) {
      if (live_traders.hasOwnProperty(trader_name)) {
        var trader_deals = live_traders[trader_name].deals
        if (trader_deals && trader_deals.length > 0) {
          all_deals = all_deals.concat(trader_deals)
        }
      }
    }
    return all_deals
  }

  //"deal|1.1|332|338"
  function parseDeal(deal) {
    var original = ""+deal
    var deal_arrayed = deal.split("|")
    var objectified_deal = {
          name: original,
          amount: parseFloat(deal_arrayed[1]),
          buy_price: parseFloat(deal_arrayed[2]),
          sell_price: parseFloat(deal_arrayed[3]),
          order_id: deal_arrayed[4]
        }

    return objectified_deal
  }

  //"deal|1.1[amount]|332[buy_price]|338[order_id]"
  function stringDeal(deal) {
    deal.name = 
      "deal|" + deal.amount + 
      "|" + deal.buy_price + 
      "|" + deal.sell_price + 
      "|" + (deal.order_id || "freeze")
    return deal.name
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
    else {
      LOG(
        "tick | cycle disallow | delay_permitted, time_since_last_cycle:", 
        delay_permitted, (time_since_last_cycle / 1000).toFixed(2), "seconds."
      )
    }
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
        var trader_decision_prep_start = Date.now()
        var trader = live_traders[trader_name]
        // Add attributes to lowest and highest deals to show up in view
        trader.highlightExtremeDeals()
        // Add highest deal price for each deal
        trader.addCurrentMaximumPrice()
        // Sort
        trader.sortDealsByPrice()
        // Decide if buying or selling
        perf_timers.trader_decision_prep += (
          Date.now() - trader_decision_prep_start
        )
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
      [stampede_value_sheet, 0, -1, "WITHSCORES"], 
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
        stampede_value_sheet, time_stamp, current_currency_value, 
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
        db.zcard(stampede_value_sheet, function(error, sheets_size) {
          if (parseInt(sheets_size) > SHEET_SIZE_LIMIT) {
            var cutoff_size = parseInt(sheets_size) - SHEET_SIZE_LIMIT
            db.zremrangebyrank(
              stampede_value_sheet, 0, cutoff_size, 
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

  function prepareCombinedDeal(combined_deal) {
    combined_deal.currency_amount = 0
    combined_deal.currency_value = 0
    combined_deal.max_currency_amount = 0
    combined_deal.amount = 0
    combined_deal.amounts = []
    combined_deal.names = []
  }

  // Trading config validation!

  function configValid(trading_config) {
    return (
      !isNaN(trading_config.base_currency_per_deal) &&
      trading_config.base_currency_per_deal > 1 &&
      !isNaN(trading_config.maximum_investment) &&
      trading_config.maximum_investment >= 0 &&
      !isNaN(trading_config.bid_alignment) &&
      trading_config.bid_alignment < 1 &&
      trading_config.bid_alignment > 0 &&
      trading_config.impatience <= 100 &&
      trading_config.impatience >= 0 &&
      trading_config.greed <= 50 &&
      trading_config.greed > 0 &&
      !isNaN(trading_config.max_number_of_deals_per_trader) &&
      trading_config.max_number_of_deals_per_trader > 0
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
    live_traders = new Object()
    db.smembers(trader_main_list, function(error, trader_list) {
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
    db.del(stampede_value_sheet, function(error, response) {
      LOG("cleanSheets | error:", error, response)
      if (done) return done()
    })
  }

  function removeAllDeals(done) {
    _.each(live_traders, function(trader, trader_name) {
      trader.deals = new Array()
    })
    
    STAMPEDE.controller.refreshTraders(live_traders)

    if (done) {
      done()
    }

  }

  function addShare(holder, investment) {
    if (
      wallet &&
      holder.length > 1 &&
      investment > 0
    ) wallet.addShare(holder, investment, function(error, response) {
      console.log(
        "Added share (" + config.exchange.currency + investment + 
        ") for " + holder + ". (..., error, response)", error, response
      )
    })
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
    STAMPEDE.controller.refreshTraders(live_traders)
    STAMPEDE.controller.refreshOverview()
    STAMPEDE.controller.refreshMarket(market.current)
    STAMPEDE.controller.refreshWallet(wallet.current)
    STAMPEDE.controller.refreshShares(wallet.shares)
    console.log("trader | refreshAll | sheets.length :", sheets.length)
    setTimeout(STAMPEDE.controller.drawSheets(sheets, "full"), 5000)
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
    removeAllDeals: removeAllDeals,
    cleanSheets: cleanSheets,
    loadTraders: loadTraders
  }
}


  

