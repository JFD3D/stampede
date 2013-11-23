var db = require("redis").createClient(6379),
    async = require("async"),
    config = require("./../plugins/config"),
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

    
    /*
     *
     * Constants for trading
     *
     *
     *
     */
     
    MAX_INFO_AGE = 60000,                                           // Allowed age of information(prices) for decision making
    MAX_SUM_INVESTMENT = config.trading.maximum_investment,         // Allowed max sum of investment
    MAX_PER_DEAL = config.trading.maximum_$_per_deal,               // Allowed investment per trader's deal
    MAX_DEALS_HELD = 
      config.trading.max_number_of_deals_per_trader || 3,           // Number of trader deals
    INITIAL_GREED = config.trading.greed || 0.05,                   // Greed (.05 means trader looks for 5% upside) XXX: As of now, this is calculated based on current market shift (difference btw low and high)
    BID_ALIGN = config.trading.bid_alignment;                       // Align bid before buying to allow competitive price


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
        })
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
        has_free_hands = MAX_DEALS_HELD > me.deals.length,
        available_resources = (wallet.current.investment < MAX_SUM_INVESTMENT) && (wallet.current.usd_available > MAX_PER_DEAL),
        trader_bid = (market.current.last / BID_ALIGN),
        // bid_below_middle = trader_bid < market.current.middle,
        // potential_better_than_fee = (market.current.shift_span / 2) > (2 * (wallet.current.fee / 100)),
        profit_from_middle = trader_bid / market.current.middle,
        current_market_greed = (market.current.shift_span / 2),
        trader_greed = ((current_market_greed > INITIAL_GREED) ? INITIAL_GREED : current_market_greed) + (wallet.current.fee / (2*100)),
        weighted_heat = wallet.current.cool + trader_greed,
        potential_better_than_heat = weighted_heat > 1,
        market_momentum_significant = (
          market.current.momentum_record_healthy &&
          market.current.momentum_indicator > 0
        );
        
    // Decision process takes place on whether to buy
    // 
    if (
      has_free_hands &&
      available_resources &&
      market_momentum_significant &&
      //bid_below_middle &&
      //potential_better_than_fee &&
      potential_better_than_heat
    ) decision = true;
    
    console.log(
      "*** Buying deal? ***",
      "\n|- Has hands available (..., me.deals.length):", has_free_hands, me.deals.length,
      "\n|- Available resources (..., wallet.current.investment):", available_resources, wallet.current.investment,
      // "\n|- Bid is below middle (..., market.current.last, market.current.middle):", bid_below_middle, market.current.last.toFixed(2), market.current.middle.toFixed(2),
      // "\n|- Projected profit is better than fee (..., market.current.shift_span):", potential_better_than_fee, market.current.shift_span.toFixed(2),
      "\n|- Projected profit is better than heat (..., wallet.current.cool, weighted_heat):", potential_better_than_heat, wallet.current.cool.toFixed(2), weighted_heat,
      "\n|- Market momentum is significant (..., momentum_indicator, momentum_healthy)", market_momentum_significant, market.current.momentum_indicator, market.current.momentum_record_healthy,
      "\n_BUY__ Decision:", decision ? "BUYING" : "HOLDING",
      "\n******"
    );
    
    return decision;
  },
  
  isSelling: function(deal) {
    var me = this,
        decision = false,
        // decide if selling, how much
        current_market_greed = (market.current.shift_span / 2),
        current_sale_price = (market.current.last * BID_ALIGN),
        trader_greed = ((current_market_greed > INITIAL_GREED) ? INITIAL_GREED : current_market_greed) + (wallet.current.fee / (2*100)),
        candidate_deals = me.deals.filter(function(deal_for_sale) {
          deal_for_sale.stop_price = market.current.high * (1 - (trader_greed/2));
          deal_for_sale.would_sell_at = deal_for_sale.buy_price * (1 + trader_greed + (1 - BID_ALIGN));
          
          console.log(
            "||| trader | isSelling? | would sell at:", deal_for_sale.would_sell_at.toFixed(2), 
            "NOW could sell at:", current_sale_price.toFixed(2), 
            //"trailing stop price reached? ($"+deal_for_sale.stop_price.toFixed(2)+"):", (deal_for_sale.stop_price >= current_sale_price),
            "frozen deal?:", (deal_for_sale.order_id === "freeze")
          );
          
          return (
            deal_for_sale.would_sell_at < current_sale_price &&
            //deal_for_sale.stop_price >= current_sale_price &&
            deal_for_sale.order_id != "freeze"
          );
        }),
        weighted_heat = wallet.current.cool + (1 - (market.current.middle / (market.current.last * BID_ALIGN))),
        potential_better_than_heat = (weighted_heat > 1);
    if (
      candidate_deals &&
      candidate_deals.length > 0 &&
      candidate_deals[0].amount < wallet.current.btc_balance &&
      potential_better_than_heat
    ) {
      var deal_for_sale = candidate_deals[0];
      deal.amount = deal_for_sale.amount.toFixed(6);
      deal.name = deal_for_sale.name;
      deal.sell_price = current_sale_price;
      deal.buy_price = deal_for_sale.buy_price;
      deal.order_id = deal_for_sale.order_id;
      decision = true;
    }

    console.log(
      "*** Selling deal? ***",
      "\n|- candidate_deals:", candidate_deals,
      "\n|- amount is managed (amount):", ((candidate_deals[0] || {}).amount < wallet.current.btc_balance), (candidate_deals[0] || {}).amount,
      "\n|- potential_better_than_heat:", potential_better_than_heat,
      "\n_SALE_ Decision:", decision ? "SELLING" : "HOLDING",
      "\n******",
      "\nDeal for sale details:", deal
    );
    
    return decision;
  },
  
  decide: function(done) {
    var me = this;
    if (
      market.current &&
      market.current.last > 10
    ) {
      var deal = {};
      if (me.isBuying()) {
        me.buy(deal, done);
      }
      else if (me.isSelling(deal)) {
        me.sell(deal, done);
      }
      else {
        console.log("("+me.name+"): Not selling, nor buying.");
        controller.updateDecisions({message: "("+me.name+") HOLDING (last:$"+market.current.last+")."});
        done();
      }
    }
    else {
      console.log("("+me.name+"): Market is not ready for my decisions yet.");
      done();
    }
  },
  
  sell: function(deal, done) {
    var me = this;

    deal.heat = deal.buy_price / MAX_SUM_INVESTMENT;
    deal.aligned_sell_price = (market.current.last * BID_ALIGN).toFixed(2);
    
    // Align current cool to avoid all sell / buy
    wallet.current.cool -= INITIAL_GREED;
    
    controller.updateDecisions({
      message: "Decided to sell "+deal.amount+"BTC for $"+((market.current.last * BID_ALIGN)*deal.amount)+".", 
      permanent: true
    });

    controller.sell(deal.amount, deal.aligned_sell_price, function(error, order) {
      console.log("BITSTAMP: Response after attempt to sell | error, order:", error, order);
      if (
        order && 
        order.id
      ) {
        me.removeDeal(deal, function(redis_errors, redis_response) {
          console.log("trader | sell | removeDeal | deal, redis_errors, redis_response:", deal, redis_errors, redis_response);
          wakeAll(done);
        });
        email.send({
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
      }
      else {
        deal.order_id = "freeze";

        email.send({
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
    
  },
  
  buy: function(deal, done) {
    var me = this;
    deal.buy_price = (market.current.last / BID_ALIGN);
    deal.amount = (MAX_PER_DEAL / deal.buy_price).toFixed(7);
    deal.sell_price = (deal.buy_price * (1 + INITIAL_GREED + (wallet.current.fee / 100)));
    deal.heat = INITIAL_GREED;
    wallet.current.cool -= INITIAL_GREED;
    wallet.current.investment += deal.buy_price;
    controller.updateDecisions({message: "Decided to buy "+deal.amount+"BTC for $"+MAX_PER_DEAL+".", permanent: true});
    
    controller.buy(deal.amount, (deal.buy_price).toFixed(2), function(error, order) {
      console.log("trader | buy | order, error:", order, error);
      if (
        order &&
        order.id
      ) {
        deal.order_id = order.id;
        me.recordDeal(deal, done);
        email.send({
          to: config.owner.email,
          subject: "Stampede - Buying: "+deal.amount+"BTC",
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
        email.send({
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
        deal_position = me.deals.lookupIndex("name", deal.name);
    if (deal_position > -1) {
      me.deals.splice(deal_position, 1);
      db.srem(me.record.book, deal.name, callback);
    }
    else {
      console.log("!!! trader | removeDeal | Unable to find deal for removal | deal", deal);
      callback("Problems finding deal.", null);
    }
  }
};

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
  console.log("Cycle initiated.");
  // Initialize market and wallet data into global var, exposed on top
  async.series([
    checkWallet,
    checkMarket
  ], function(errors, results) {
    controller.updateTradingConfig();
    if (done) done(null, market.current)
  });
} 

function checkMarket(done) {
  market.check(function(error, market_current) {
    // Update client side on current market data 
    // & current wallet data
    controller.updateMarket(market.current);
    // Check if traders are initialized
    if (live_traders) {
      controller.updateTraders(live_traders);
      var i = 0, new_deal_count = 0;
      var btc_to_distribute = wallet.current.btc_available - wallet.current.btc_amount_managed;
      wallet.current.usd_value = (wallet.current.btc_balance || 0) * (market.current.last || 0) + (wallet.current.usd_balance || 0);
      controller.updateWallet(wallet.current); 
      var q = async.queue(function(trader_name, internal_callback) {
        var trader = live_traders[trader_name];
        
        // Create ad hoc deals for amount bought manually
        if (
          //btc_to_distribute > 0.01 &&
          1 > 2 && // knocking off ad hoc deal creation for now
          live_traders[trader_name].deals.length < MAX_DEALS_HELD &&
          wallet.current.available_to_traders > MAX_PER_DEAL
        ) {
          var new_deal = {
            buy_price: market.current.last,
            amount: btc_to_distribute < (MAX_PER_DEAL / market.current.last) ? btc_to_distribute : (MAX_PER_DEAL / market.current.last),
            sell_price: market.current.last * (1 + (market.current.shift_span / 2)),
            order_id: "ad_hoc"
          };
          btc_to_distribute -= new_deal.amount;
          wallet.current.btc_amount_managed += new_deal.amount;
          trader.recordDeal(new_deal, function(redis_error, redis_response) {
            new_deal_count++;
            //console.log("trader | recordDeal | Ad hoc deal recorded | new_deal, redis_error, redis_response:", new_deal, redis_error, redis_response);
          });
        }
        trader.decide(internal_callback);
      }, 2);

      for (var trader_name in live_traders) q.push(trader_name);

      q.drain = function() {
        var cool_up = INITIAL_GREED,
            next_check = (market.check_frequency);

        wallet.current.cool = (
          wallet.current.cool < 1 && 
          cool_up < (1 - wallet.current.cool)
        ) ? wallet.current.cool + cool_up : 1;

        console.log("... Cycle(wallet, market) CHECK again in:", (next_check / 1000).toFixed(2), "seconds.");
        
        if (timer) clearTimeout(timer);
        timer = setTimeout(cycle, next_check);

        if (done) done(null, market.current);

        if (new_deal_count > 0) {
          console.log("("+new_deal_count+") <-------------------------- New deals recorded, refreshing data.");
          wakeAll();
        }
        updateSheets();
      }
    }
    else {
      console.log("No traders present.");
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
    sheets.sort(function(a, b) {return a.time - b.time});
    controller.drawSheets(sheets, "full");
    done(error, sheets);
  });
}

function pullValueSheet(callback) {
  callback(sheets);
}

function updateSheets() {
  console.log("* Updating history sheets.");
  var now = new Date(),
      timestamp = now.getTime(),
      current_usd_value = wallet.current.usd_value;
  if (wallet.current.usd_value > 10) {
    db.sadd(stampede_value_sheet, timestamp+"|"+current_usd_value, function(error, response) {
      var new_value = {time: timestamp, value: current_usd_value};
      sheets.push(new_value);
      controller.drawSheets(new_value, "incremental");
    });
  }
}


function checkWallet(done) {
  // Initialize into global var, exposed on top
  console.log("* Checking wallet.");
  wallet.check(live_traders, function() {
    controller.updateShares(wallet.shares);
    wallet.update_counter = 3;
    wallet.current.available_to_traders = 
      (MAX_SUM_INVESTMENT - wallet.current.investment) < wallet.current.usd_available ? 
        MAX_SUM_INVESTMENT - wallet.current.investment : 
        wallet.current.usd_available;
    if (done) done(null, wallet.current);
  });
}

function checkTraders(trader_list, done) {
  var q = async.queue(function(trader_name, internal_callback) {
    var trader = new Trader(trader_name);
    trader.wake(function(error, trader_record) {
      console.log("Trader wakeup: ", trader_name)
      internal_callback(error);
    });
  }, 2);
  q.drain = function() {
    console.log("Queue drained in checkTraders.");
    done(null, live_traders);
  }
  trader_list.forEach(function(trader_name) {
    q.push(trader_name);
  });
}

function wakeAll(done) {

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

function addShare(holder, investment) {
  if (
    wallet &&
    holder.length > 1 &&
    investment > 0
  ) wallet.addShare(holder, investment, function(error, response) {
    console.log("Added share ($"+investment+") for "+holder+". (..., error, response)", error, response);
  });
}

function stopAll(done) {
  clearTimeout(timer);
  wallet = new Wallet();
  market = new Market();
  sheets = [];
  live_traders = {};
  done();
}

function updateAll() {
  controller.updateTraders(live_traders);
  controller.updateMarket(market.current);
  controller.updateWallet(wallet.current);

  console.log("trader | updateAll | sheets.length :", sheets.length);
  setTimeout(controller.drawSheets(sheets, "full"), 5000);
}

exports.stopAll = stopAll;
exports.wakeAll = wakeAll;
exports.instance = Trader;
exports.updateAll = updateAll;
exports.pullValueSheet = pullValueSheet;
exports.addShare = addShare;