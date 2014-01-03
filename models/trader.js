var config = require("./../plugins/config"),
    async = require("async"),
    db = require("redis").createClient(config.redis_port || 6379),
    email = require("./../plugins/email"),
    live_traders = {},
    controller = require("./../routes/controller"),
    Market = require("./market"),
    Wallet = require("./wallet"),

    /*
     *
     *
     *  Initialize market and wallet instances
     *
     *
     *
     */

    market = new Market(), 
    wallet = new Wallet(), 

    // Additional shared variables

    timer,                // Timer for market check
    trader_count,         // Current trader count
    sheets = [],          // Current USD value history list
    error_email_sent,     // Indicate if email for certain error has already been sent
    trader_main_list = "stampede_traders",        // Main repository in redis for keeping list of traders
    stampede_value_sheet = "stampede_usd_value",  // Repository unsorted list for USD value history
    error_email_sent,
    cycle_counter = 0,    // For simulation purposes so that notification is only emitted
    broadcast_time,       // Will compute leftover on this
    cycle_sell_decisions = [],
    cycle_buy_decisions = [],

    /*
     *
     * Constants for trading
     *
     *
     *
     */
    
    MAX_SUM_INVESTMENT,     // Allowed max sum of investment
    MAX_PER_DEAL,           // Allowed investment per trader's deal
    MAX_DEALS_HELD,         // Number of trader deals
    INITIAL_GREED,          // Greed (.05 means trader looks for 5% upside) XXX: As of now, this is calculated based on current market shift (difference btw low and high)
    BID_ALIGN,              // Align bid before buying to allow competitive price
    IMPATIENCE,             // Where do I buy up from middle

    /*
     *
     * Trading strategies
     *
     *
     *
     */    

    MOMENTUM_ENABLED,       // Whether purchases will be happening on momentum up trend
    TRAILING_STOP_ENABLED,  // Whether sales will happen only after trailing stop is reached



// nasty variable declaration end
    variable_declaration_ender;                     


function initializeConfig() {

  // Trading configuration variables
  MAX_SUM_INVESTMENT = config.trading.maximum_investment;
  MAX_PER_DEAL = config.trading.maximum_currency_per_deal;         
  MAX_DEALS_HELD = 
    config.trading.max_number_of_deals_per_trader;
  INITIAL_GREED = config.trading.greed;   
  BID_ALIGN = config.trading.bid_alignment;
  IMPATIENCE = config.trading.impatience;

  // Strategies now
  MOMENTUM_ENABLED = config.strategy.momentum_trading;
  TRAILING_STOP_ENABLED = config.strategy.trailing_stop;
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
  
  this.name = name;
  /*
   *
   *
   *  Redis repos and scopes
   *
   *
   *
   */

  this.id_counter = "stampede_trader_number";
  this.trader_prefix = "trader_";
  this.book_prefix = "book_for_";
  this.main_list = trader_main_list;
  this.deals = [];

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

  create: function(callback) {
    var me = this;
    db.incr(me.id_counter, function(error, number) {
      me.name = me.trader_prefix+number;
      db.sadd(me.main_list, me.name, function(error, response) {
        me.record = {
          book: me.book_prefix+me.name,
          deals: MAX_DEALS_HELD
        };
        me.deals = [];
        live_traders[me.name] = me;
        db.hmset(me.name, me.record, callback);
        me.record.current_investment = 0;
        me.record.current_deals = 0;
      });
    });
  },
  
  // Stop and remove trader

  remove: function(done) {
    var me = live_traders[this.name],
        my_book = me.record.book;
    me.checkRecord(function() {
      db.srem(me.main_list, me.name, function(error, response) {
        db.del(my_book);
        db.del(me.name, function() {
          delete live_traders[me.name];
          wakeAll(done);
        });
      });
    });
  },
  
  // Loads trader's deals

  checkInventory: function(callback) {
    var me = this;
    me.deals = me.deals || [];
    if (
      me.record &&
      me.record.book
    ) {
      db.smembers(me.record.book, function(error, deals) {
        me.deals = deals || [];
        me.deals.forEach(function(deal, index) {
          me.deals[index] = parseDeal(deal);
        });
        if (callback) callback(error, me.record);
      });
    }
    else if (callback) callback(null, null) ;
  },

  // Loads trader record from repository and then loads trader's deals

  checkRecord: function(callback) {
    var trader = this;
    //console.log("trader | checkRecord | trader:", trader);
    db.hgetall(trader.name, function(error, my_record) {
      trader.record = my_record;
      trader.checkInventory(callback);
    });
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
    var me = this;
    live_traders[me.name] = me;
    //console.log("trader | wake | me, live_traders:", me, live_traders);
    me.checkRecord(callback);
  },
  
  /*
   *
   * When trader is awake
   *
   *
   *
   *
   */
   
  // decide if buying, define candidate deal

  isBuying: function() {
    var me = this,
        decision = false,

        // Get the lowest price of deal bought
        all_deals = getAllDeals(),
        borders = all_deals.extremesByKey("buy_price"),
        lowest_buy_price = borders.min.buy_price || 0,

        // Check if trader has available spot for another deal
        has_free_hands = MAX_DEALS_HELD > me.deals.length,
        
        // Available resources, compare investment and current available in wallet
        available_resources = 
          (wallet.current.investment < MAX_SUM_INVESTMENT) && 
          (wallet.current[config.exchange.currency+"_available"] > MAX_PER_DEAL),

        // Calculate trader bid (aligned by bid alignment to make us competitive when bidding)
        trader_bid = (market.current.last / BID_ALIGN),

        // Check if aligned bid is below threshold (which combines the impatience variable)
        bid_below_threshold = trader_bid < market.current.threshold,

        // EXPERIMENTAL: If existing deals, check that I am buying for price lower than the lowest existing
        bid_below_lowest = (lowest_buy_price > 0) ? (trader_bid < lowest_buy_price) : bid_below_threshold,

        // Check if current market span (high - low / last) is favorable and wider than fee
        potential_better_than_fee = (market.current.shift_span / 2) > (2 * (wallet.current.fee / 100)),

        // What is the current market acceleration
        current_market_greed = (market.current.shift_span / 2),

        // What potential is the trader looking at
        trader_greed = INITIAL_GREED + ((wallet.current.fee || 0.5) / (2*100)),

        // If current wallet cool combined with greed exceeds 1
        weighted_heat = wallet.current.cool + trader_greed,
        potential_better_than_heat = (weighted_heat > 1),

        // Check if market has positive momentum
        market_momentum_significant = (
          market.current.momentum_record_healthy &&
          market.current.momentum_average > 0
        );
    
    // console.log("isBuying | all_deals.length, borders:", all_deals.length, borders);

    // Decision process takes place on whether to buy
    if (
      has_free_hands &&
      available_resources &&
      (!MOMENTUM_ENABLED || market_momentum_significant) &&
      bid_below_threshold &&
      bid_below_lowest &&
      potential_better_than_fee &&
      potential_better_than_heat
    ) decision = true;
    
    if (decision) console.log(
      "*** Buying deal? ***",
      "\n|- Has hands available (..., me.deals.length):", has_free_hands, me.deals.length,
      "\n|- Available resources (..., wallet.current.investment):", available_resources, wallet.current.investment,
      "\n|- Bid is below threshold (..., market.current.last, market.current.middle):", bid_below_threshold, market.current.last.toFixed(2), market.current.middle.toFixed(2),
      "\n|- Bid is lowest among deals (..., lowest_buy_price):", bid_below_lowest, lowest_buy_price.toFixed(2),
      "\n|- Projected profit is better than fee (..., market.current.shift_span):", potential_better_than_fee, market.current.shift_span.toFixed(2),
      "\n|- Projected profit is better than heat (..., wallet.current.cool, weighted_heat):", potential_better_than_heat, wallet.current.cool.toFixed(2), weighted_heat,
      "\n|- Market momentum is significant (..., momentum_indicator, momentum_healthy)", market_momentum_significant, market.current.momentum_indicator, market.current.momentum_record_healthy,
      "\n_BUY__ Decision:", decision ? "BUYING" : "HOLDING",
      "\n******"
    );
    
    //console.log("Market from isBuying:", market.current);

    var structured_decision = {
      trader: me.name,
      free_hands: has_free_hands,
      resources: available_resources,
      threshold: bid_below_threshold,
      lowest: bid_below_lowest,
      potential: potential_better_than_heat,
      momentum: (!MOMENTUM_ENABLED || market_momentum_significant),
      cool: potential_better_than_heat,
      decision: decision
    };

    cycle_buy_decisions.push(structured_decision);

    return decision;
  },
  
  decide: function(done) {
    var me = this;
    if (
      market.current &&
      market.current.last > 10
    ) {
      var deal = {};
      if (
        me.isBuying() && 
        !me.simulated
      ) {
        me.buy(deal, done);
      }
      else {
        //console.log("("+me.name+"): Not buying.");
        //controller.notifyClient({message: "("+me.name+") HOLDING (last:"+config.exchange.currency++market.current.last+")."});
        done();
      }
    }
    else {
      console.log("("+me.name+"): Market is not ready for my decisions yet.");
      done();
    }
  },
  
  buy: function(deal, done) {
    var me = this;
    deal.buy_price = (market.current.last / BID_ALIGN);
    deal.amount = (MAX_PER_DEAL / deal.buy_price);
    deal.sell_price = (deal.buy_price * (1 + INITIAL_GREED + (wallet.current.fee / 100)));
    deal.heat = INITIAL_GREED;
    wallet.current.cool -= market.current.shift_span;
    //wallet.current.investment += deal.buy_price;
    controller.notifyClient({
      message: "Decided to buy "+deal.amount.toFixed(7)+"BTC for "+config.exchange.currency.toUpperCase()+" "+MAX_PER_DEAL+" at "+config.exchange.currency.toUpperCase()+" "+deal.buy_price.toFixed(2)+" per BTC.", 
      permanent: true
    });
    
    controller.buy(deal.amount.toFixed(7), (deal.buy_price).toFixed(2), function(error, order) {
      console.log("trader | buy | order, error:", order, error);
      if (
        order &&
        order.id
      ) {
        deal.order_id = order.id;
        me.recordDeal(deal, done);
        if (!config.simulation) email.send({
          to: config.owner.email,
          subject: "Stampede - Buying: "+deal.amount.toFixed(7)+"BTC",
          template: "purchase.jade",
          data: {
            deal: deal,
            market: market,
            wallet: wallet
          }
        }, function(success) {
          console.log("Email sending success?:", success);
          if (error_email_sent) error_email_sent = null;
        });        
      }
      else {
        if (!config.simulation) email.send({
          to: config.owner.email,
          subject: "Stampede: Error BUYING deal through bitstamp API",
          template: "error.jade",
          data: {error:error}
        }, function(success) {
          console.log("ERROR Email sending success?:", success);
          error_email_sent = true;
        });
        done();
      }
    });
  },
  
  recordDeal: function(deal, callback) {
    var me = this;
    me.deals.push(deal);
    var deal_string = stringDeal(deal);
    db.sadd(me.record.book, deal.name, callback);
  },
  
  removeDeal: function(deal, callback) {
    var me = this,
        deal_name = deal.name,
        deal_position = me.deals.lookupIndex("name", deal_name);
    if (deal_position > -1) {
      me.deals.splice(deal_position, 1);
      db.srem(me.record.book, deal_name, callback);
    }
    else {
      console.log("!!! trader | removeDeal | Unable to find deal for removal | deal", deal);
      callback("Problems finding deal.", null);
    }
  }
};

// Create a hash by deal name to lookup deals and their traders
function findByDeal(deal_name) {
  var deal_sheet = {};

  for (var trader_name in live_traders) {
    var trader_deals = live_traders[trader_name].deals;
    if (
      trader_deals && 
      trader_deals.length > 0
    ) {
      trader_deals.forEach(function(deal) {
        deal_sheet[deal.name] = trader_name;
      });
    }
  }

  return live_traders[deal_sheet[deal_name]];

}

function highlightExtremeDeals() {
  var all_deals = getAllDeals(),
      borders = all_deals.extremesByKey("buy_price");

  if (
    borders.min && 
    borders.max &&
    borders.min.name !== borders.max.name
  ) all_deals.forEach(function(deal) {
    deal.is_highest = (deal.name === borders.max.name);    
    deal.is_lowest = (deal.name === borders.min.name);
  });
}

function checkSelling(done) {

  var all_deals = getAllDeals(),

      // Get min and max deal from all, initialize a combined deal for further calc
      borders = all_deals.extremesByKey("buy_price"),


      combined_deal = {
        currency_amount: 0,
        amount: 0,
        names: []
      };

  //console.log("sellingCheck | borders:", borders);


  // Calculate weighted price for deals from extremes (lowes and highest)
  // We will sell them at once if the weighted average + fees and profit is below market last

  ["min", "max"].forEach(function(extreme) {
    var current = borders[extreme];
    if (
      current && 
      combined_deal.names.indexOf(current.name) === -1
    ) {
      combined_deal.currency_amount += (current.buy_price * current.amount);
      combined_deal.amount += current.amount;
      combined_deal.names.push(current.name);
      //console.log("sellingCheck | testing trader findByDeal (trader_name):", findByDeal(current.name).name);
    }
    else {
      if (!config.simulation) console.log("sellingCheck | deal combination skip | current, combined_deal.names:", current, combined_deal);
    }
  });

  // decide if selling, and adjust the current price
  var decision = false,

      // Deal independent calculations
      current_market_greed = (market.current.shift_span / 2),
      current_sale_price = (market.current.last * BID_ALIGN),
      trader_greed = INITIAL_GREED + ((wallet.current.fee || 0.5) / (2*100)),
      weighted_heat = wallet.current.cool + trader_greed,
      potential_better_than_heat = (weighted_heat > 1);

  // Deal dependent calculations
  combined_deal.stop_price = market.current.high * (1 - (trader_greed/2));
  if (combined_deal.amount > 0) {
    combined_deal.buy_price = combined_deal.currency_amount / combined_deal.amount;
    combined_deal.would_sell_at = (combined_deal.buy_price) * (1 + trader_greed + (1 - BID_ALIGN));
  }

  // Create structured decision object (rendered on client), used for consolidated decision check
  var structured_decision = {
    trader: "Combined sell at ("+(combined_deal.would_sell_at || 0).toFixed(2)+")",
    would_sell_price: (combined_deal.would_sell_at < current_sale_price),
    cool: potential_better_than_heat,
    managed: (combined_deal.amount <= wallet.current.btc_balance)
  };

  // If trailing stop enabled, add to structured decision
  if (TRAILING_STOP_ENABLED) structured_decision.trailing_stop = (combined_deal.stop_price >= current_sale_price);
        

  // Check trailing stop, if enabled affect decision
  structured_decision.decision = (
    structured_decision.would_sell_price &&
    structured_decision.managed &&
    structured_decision.cool &&
    (!TRAILING_STOP_ENABLED || (combined_deal.stop_price >= current_sale_price))
  );

  // Add the decision to array which will be rendered on client
  cycle_sell_decisions.push(structured_decision);

  // Log the success!
  if (structured_decision.decision) console.log("||| trader | sellingCheck | isSelling? | structured_decision:", structured_decision);

  // Check all outstanding factors and make final decision
  if (
    structured_decision.decision &&
    combined_deal.names.length > 0
  ) {
    decision = true;
    sell(combined_deal, done);
  } else {
    //console.log("||| trader | sellingCheck | isSelling?, combined_deal:", combined_deal);
    done(null, "Not selling.");
  }

  if (decision) console.log(
    "*** Selling deal? ***",
    "\n|- amount is managed (amount):", (combined_deal.amount <= wallet.current.btc_balance), combined_deal.amount,
    "\n|- potential_better_than_heat:", potential_better_than_heat,
    "\n_SALE_ Decision:", decision ? "SELLING" : "HOLDING",
    "\nDeal evaluated details:", combined_deal
  );
}

function sell(deal, done) {

  deal.heat = deal.buy_price / MAX_SUM_INVESTMENT;
  deal.aligned_sell_price = (market.current.last * BID_ALIGN).toFixed(2);
  
  // Align current cool to avoid all sell / buy
  wallet.current.cool -= market.current.shift_span;
  
  controller.notifyClient({
    message: "Decided to sell "+deal.amount+"BTC for "+config.exchange.currency.toUpperCase()+((market.current.last * BID_ALIGN)*deal.amount).toFixed(2)+" at "+config.exchange.currency.toUpperCase()+deal.aligned_sell_price+" per BTC.", 
    permanent: true
  });

  controller.sell(deal.amount.toFixed(7), deal.aligned_sell_price, function(error, order) {
    console.log("EXCHANGE: Response after attempt to sell | error, order:", error, order);
    if (
      order && 
      order.id
    ) {
      // Create asynchronous queue that will purge sold deals from redis and live traders
      var queue = async.queue(function(deal_name, internal_callback) {
        var trader = findByDeal(deal_name);
        if (trader) {
          trader.removeDeal({name: deal_name}, internal_callback);
        } 
        else {
          console.log("!! Associated trader not found for:"+deal_name);
          internal_callback("Unable to find the trader for deal: "+deal_name, null);
        }
      }, 2);

      // Populate the async queue with deals to process
      deal.names.forEach(function(deal_name) { 
        queue.push(deal_name); 
      });

      if (!config.simulation) email.send({
        subject: "Stampede - Selling: "+deal.name,
        template: "sale.jade",
        data: {
          deal: deal,
          market: market,
          wallet: wallet
        }
      }, function(success) {
        console.log("Email sending success?:", success);
        if (error_email_sent) error_email_sent = null;
      });

      // Once queue drained call the last callback
      queue.drain = done;

    }
    else {
      deal.order_id = "freeze";

      if (!config.simulation) email.send({
        subject: "Stampede: Error SELLING deal through bitstamp API",
        template: "error.jade",
        data: {error:error}
      }, function(success) {
        console.log("ERROR Email sending success?:", success);
        error_email_sent = true;
      });   
      done();
    }
  });
  
}


function getAllDeals() {
  var all_deals = [];

  for (var trader_name in live_traders) {
    var trader_deals = live_traders[trader_name].deals;
    if (trader_deals && trader_deals.length > 0) {
      all_deals = all_deals.concat(trader_deals);
    }
    else {
      //console.log("getAllDeals | "+trader_name+" has no deals.");
    }
  }
  return all_deals;
}

//"deal|1.1|332|338"
function parseDeal(deal) {
  var original = ""+deal,
      deal_arrayed = deal.split("|"),
      objectified_deal = {
        name: original,
        amount: parseFloat(deal_arrayed[1]),
        buy_price: parseFloat(deal_arrayed[2]),
        sell_price: parseFloat(deal_arrayed[3]),
        order_id: deal_arrayed[4]
      };
  return objectified_deal;
}

//"deal|1.1|332|338"
function stringDeal(deal) {
  deal.name = "deal|"+deal.amount+"|"+deal.buy_price+"|"+deal.sell_price+"|"+(deal.order_id || "freeze");
  return deal.name;
}

function cycle(done) {
  cycle_counter++;
  broadcast_time = (!config.simulation || cycle_counter % 1000 === 0);
  if (!config.simulation) console.log("Cycle initiated.");
  cycle_buy_decisions = [];
  cycle_sell_decisions = [];
  var actions = [
    checkWallet,
    checkMarket,
    checkSelling
  ];

  // Initialize market and wallet data into global var, exposed on top
  async.series(actions, function(errors, results) {

    // Add attributes to lowest and highest deals to show up in view
    highlightExtremeDeals();

    // Final callback returning default market.current
    if (done) done(null, market.current);
    
    // Update client on performed decisions
    if (broadcast_time) controller.refreshDecisions({
      buy_decisions: cycle_buy_decisions,
      sell_decisions: cycle_sell_decisions
    });
  });
} 

function checkMarket(done) {
  market.check(function(error, market_current) {
    var stop_simulation = (config.simulation && error && error.stop);
    // Check if traders are initialized
    if (live_traders && !stop_simulation) {
      if (broadcast_time) controller.refreshTraders(live_traders);
      var i = 0, new_deal_count = 0;
      market.current.threshold = IMPATIENCE * (market.current.high - market.current.middle) + market.current.middle;
      var btc_to_distribute = wallet.current.btc_available - wallet.current.btc_amount_managed;
      wallet.current.currency_value = (wallet.current.btc_balance || 0) * (market.current.last || 0) + (wallet.current[config.exchange.currency+"_balance"] || 0);
      if (broadcast_time) controller.refreshWallet(wallet.current); 
      var q = async.queue(function(trader_name, internal_callback) {
        var trader = live_traders[trader_name];
        
        // Decide if buying
        trader.decide(internal_callback);
      }, 1);

      // refresh client side on current market data 
      // & current wallet data
      if (broadcast_time) controller.refreshMarket(market.current);

      for (var trader_name in live_traders) q.push(trader_name);

      q.drain = function() {
        //console.log("Current env:", process.env);
        var cool_up = INITIAL_GREED,
            next_check = (market.simulation ? 2 : ( 
                (process.env.NODE_ENV || "development") === "development" ? 10000 : 4000) +
                (Math.random()*3000)
            );

        wallet.current.cool = (
          wallet.current.cool < 1 && 
          cool_up < (1 - wallet.current.cool)
        ) ? wallet.current.cool + cool_up : 1;

        if (!config.simulation) {
          console.log("... Cycle(wallet, market) CHECK again in:", (next_check / 1000).toFixed(2), "seconds. - "+(new Date())+".");
          refreshSheets();
        }
            
        if (timer) clearTimeout(timer);
        timer = setTimeout(cycle, next_check);

        if (done) done(null, market.current);
      };
    }
    else {
      console.log("No traders present or market simulation stopped.");
      if (done) done(null, market.current);
    }
  });  
}

function checkSheets(done) {
  console.log("* Checking history sheets.");
  var now = new Date(),
      timestamp = now.getTime();
  db.smembers("stampede_usd_value", function(error, sheet_records) {
    //console.log("checkSheets | done | error, response:", error, sheet_records);
    var step = Math.round(sheet_records.length / 1000);
    sheet_records.forEach(function(record, index) {
      var current = record.split("|");
      if (
        step > 0 &&
        (index % step) === 0 &&
        current[0] &&
        parseInt(current[0]) > 10 &&
        current[1] &&
        parseFloat(current[1]) > 10
      ) sheets.push({time: parseInt(current[0]), value: parseFloat(current[1])});
    });
    sheets.sort(function(a, b) {return a.time - b.time;});
    controller.drawSheets(sheets, "full");
    done(error, sheets);
  });
}

function pullValueSheet(callback) {
  callback(sheets);
}

function refreshSheets() {
  //console.log("* Updating history sheets.");
  var now = new Date(),
      timestamp = now.getTime(),
      current_currency_value = wallet.current.currency_value;
  if (wallet.current.currency_value > 10 && !config.simulation) {
    db.sadd(stampede_value_sheet, timestamp+"|"+current_currency_value, function(error, response) {
      var new_value = {time: timestamp, value: current_currency_value};
      sheets.push(new_value);
      if (broadcast_time) controller.drawSheets(new_value, "incremental");
    });
  }
}


function checkWallet(done) {
  // Initialize into global var, exposed on top
  if (!config.simulation) console.log("* Checking wallet.");
  wallet.check(live_traders, function() {
    if (broadcast_time) controller.refreshShares(wallet.shares);
    wallet.assignAvailableResources(MAX_SUM_INVESTMENT);
    if (done) done(null, wallet.current);
  });
}

function updateConfig(new_config) {
  if (configValid(new_config)) {
    for (var attribute in new_config) {
      config.trading[attribute] = new_config[attribute] || config.trading[attribute];
    }

    initializeConfig();
    
    //controller.refreshTradingConfig(config.trading);

    console.log(
      "trader | updateConfig | comparison:",
      "\n: MAX_SUM_INVESTMENT / config.trading.maximum_investment:", MAX_SUM_INVESTMENT, config.trading.maximum_investment,
      "\n: INITIAL_GREED / config.trading.greed:", INITIAL_GREED, config.trading.greed
    );
  }
  else {
    controller.notifyClient({message: "Unable to update config, values are invalid."});
  }
}


function updateStrategy(new_config) {
  for (var attribute in new_config) {
    config.strategy[attribute] = new_config[attribute];
  }

  initializeConfig();

  console.log("updateStrategy | Configuration initialized | config.strategy:", config.strategy);
}

function resetConfig() {
  var reset_config = require("./../plugins/config");
  console.log("resetConfig | reset_config.trading:", reset_config.trading);
  config = reset_config;
  initializeConfig();
  //controller.refreshTradingConfig(config.trading);
}


// Trading config validation!

function configValid(trading_config) {
  return (
    !isNaN(trading_config.maximum_currency_per_deal) &&
    trading_config.maximum_currency_per_deal > 1 &&
    !isNaN(trading_config.maximum_investment) &&
    trading_config.maximum_investment >= 0 &&
    !isNaN(trading_config.bid_alignment) &&
    trading_config.bid_alignment < 1 &&
    trading_config.bid_alignment > 0.9 &&
    !isNaN(trading_config.max_number_of_deals_per_trader) &&
    trading_config.max_number_of_deals_per_trader > 0
  );
}

function checkTraders(trader_list, done) {
  var q = async.queue(function(trader_name, internal_callback) {
    var trader = new Trader(trader_name);
    trader.wake(function(error, trader_record) {
      //console.log("Trader wakeup: ", trader_name)
      internal_callback(error);
    });
  }, 2);
  q.drain = function() {
    console.log("Queue drained in checkTraders.");
    controller.refreshTraders(live_traders);
    if (done) done(null, live_traders);
  };
  trader_list.forEach(function(trader_name) {
    q.push(trader_name);
  });
}

function wakeAll(done) {

  initializeConfig();

  db.smembers(trader_main_list, function(error, trader_list) {
    console.log("wakeAll, Waking ("+trader_list.length+") traders...");
    trader_count = trader_list.length;
    if (
      trader_list &&
      trader_list.length > 0
    ) {
      async.series([
        function(internal_callback) {
          checkTraders(trader_list, internal_callback);
        },
        cycle,
        checkSheets
      ], function(errors, results) {
        if (errors) {
          console.log("Problems loading traders, market or wallet:", errors);
          done();
        }
        else {
          if (done) done();
        }
      });
    }
    else {
      if (done) done(live_traders);
    }
  });
}

function viewTraders(done) {
  db.smembers(trader_main_list, function(error, trader_list) {
    console.log("viewTraders, Viewing ("+trader_list.length+") traders...");
    trader_count = trader_list.length;
    if (
      trader_list &&
      trader_list.length > 0
    ) {
      checkTraders(trader_list, done);
    }
  });
}

function prepareForSimulation() {
  //initializeConfig();
  stopAll();
  config.simulation = true;
  market.simulation = true;
  db.del("stampede_usd_value");

}

function removeAllDeals() {
  for (var name in live_traders) {
    var trader = live_traders[name];
    var trader_deals_copy = trader.deals.slice(0);
    trader_deals_copy.forEach(function(deal) {
      var deal_name = deal.name;
      trader.removeDeal(deal, function() {
        console.log("removeAllDeals | deal:", deal_name);
      });
    });
  }
}

function addShare(holder, investment) {
  if (
    wallet &&
    holder.length > 1 &&
    investment > 0
  ) wallet.addShare(holder, investment, function(error, response) {
    console.log("Added share ("+config.exchange.currency+investment+") for "+holder+". (..., error, response)", error, response);
  });
}

function stopAll(done) {
  clearTimeout(timer);
  wallet = new Wallet();
  market = new Market();
  sheets = [];
  live_traders = {};
  if (done) done();
}

function refreshAll() {
  controller.refreshTraders(live_traders);
  controller.refreshMarket(market.current);
  controller.refreshWallet(wallet.current);
  console.log("trader | refreshAll | sheets.length :", sheets.length);
  setTimeout(controller.drawSheets(sheets, "full"), 5000);
}

exports.stopAll = stopAll;
exports.wakeAll = wakeAll;
exports.instance = Trader;
exports.refreshAll = refreshAll;
exports.pullValueSheet = pullValueSheet;
exports.addShare = addShare;
exports.updateConfig = updateConfig;
exports.updateStrategy = updateStrategy;
exports.resetConfig = resetConfig;

// Open variables (simulation required)
exports.live_traders = live_traders;
exports.market = market;
exports.wallet = wallet;
exports.config = config;
exports.prepareForSimulation = prepareForSimulation;
exports.removeAllDeals = removeAllDeals;
exports.viewTraders = viewTraders;