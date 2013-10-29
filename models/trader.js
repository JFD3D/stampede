var db = require("redis").createClient(6379),
    async = require("async"),
    config = require("./../plugins/config"),
    email = require("./../plugins/email"),
    live_traders = {},
    controller = require("./../routes/controller"),
    Market = require("./market"),
    Wallet = require("./wallet"),
    market = new Market(), 
    wallet = new Wallet(), 
    timer, 
    trader_count,
    sheets = [],
    
    /*
     *
     * Constants for trading
     *
     *
     *
     */
     
    MAX_INFO_AGE = 60000,                                     // Allowed age of information(prices) for decision making
    MAX_SUM_INVESTMENT = config.trading.maximum_investment,   // Allowed max sum of investment
    MAX_PER_HAND = config.trading.maximum_$_per_trade,        // Allowed investment per trader's 'hand'
    MAX_HANDS = 3,                                            // Number of trader hands
    INITIAL_GREED = 0.05,                                   // Greed (.05 means trader looks for 5% upside) XXX: As of now, this is calculated based on current market shift (difference btw low and high)
    BID_ALIGN = config.trading.bid_alignment;                 // Align bid before buying to allow competitive price

function Trader(name) {
  
  this.name = name;
/*
  this.record = {
    book: redis_repository_for_deals
    hands: 3
  };
  this.deals = array of deals
*/

}

Trader.prototype = {
  create: function(callback) {
    var me = this;
    db.incr("stampede_trader_number", function(error, number) {
      me.name = "trader_"+number;
      db.sadd("stampede_traders", me.name, function(error, response) {
        me.record = {
//          name: me.name,
          book: "book_for_"+me.name,
          hands: MAX_HANDS
        };
        me.deals = [];
        live_traders[me.name] = me;
        db.hmset(me.name, me.record, callback);
        me.record.current_investment = 0;
      });
    });
  },
  
  remove: function(done) {
    var me = live_traders[this.name],
        my_book = me.record.book;
    
    db.srem("stampede_traders", me.name, function(error, response) {
      db.del(my_book);
      db.del(me.name, function() {
        delete live_traders[me.name];
        wakeAll(done);
      })
    });
  },
  
  checkInventory: function(callback) {
    var me = this;
    me.deals = me.deals || [];
    // calls back with array of bitcoin stashes bought at different prices, with a sell price
    if (
      me.record &&
      me.record.book
    ) {
      db.smembers(me.record.book, function(error, deals) {
        me.deals = deals || [];
        me.deals.forEach(function(deal, index) {
          me.deals[index] = parseDeal(deal);
        });
        //console.log("trader | checkInventory | deals, me.deals:", deals, me.deals);
        if (callback) callback(error, me.record);
      });
    }
    else if (callback) callback(null, null) ;
  },
  
  checkRecord: function(callback) {
    var trader = this;
    //console.log("trader | checkRecord | trader:", trader);
    db.hgetall(trader.name, function(error, my_record) {
      trader.record = my_record;
      my_record.hands = parseFloat(my_record.hands);
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
   
  isBuying: function(deal) {
    var me = this,
        decision = false;
    
    // decide if buying, how much
    
    var has_free_hands = me.record.hands > me.deals.length,
        has_resources = me.record.current_investment < (me.record.hands * MAX_PER_HAND),
        available_resources = (wallet.current.investment < MAX_SUM_INVESTMENT) && (wallet.current.usd_available > MAX_PER_HAND),
        trader_bid = (market.current.last / BID_ALIGN),
        bid_below_middle = trader_bid < market.current.middle,
        potential_better_than_fee = (market.current.shift_span / 2) > (2 * (wallet.current.fee / 100)),
        profit_from_middle = trader_bid / market.current.middle,
        current_market_greed = (market.current.shift_span / 2),
        trader_greed = ((current_market_greed > INITIAL_GREED) ? INITIAL_GREED : current_market_greed) + (wallet.current.fee / (2*100)),
        weighted_heat = wallet.cool + (current_market_greed),
        potential_better_than_heat = weighted_heat > 1;
        
    if (
      has_free_hands &&
      has_resources &&
      available_resources &&
      bid_below_middle &&
      potential_better_than_fee &&
      potential_better_than_heat
    ) decision = true;
    
    console.log(
      "*** Buying deal? ***",
      "\n|- Has hands available (..., me.deals.length):", has_free_hands, me.deals.length,
      "\n|- Has resources(..., me.record.current_investment, wallet.current.usd_available):", has_resources, me.record.current_investment, wallet.current.usd_available,
      "\n|- Available resources (..., wallet.current.investment):", available_resources, wallet.current.investment,
      "\n|- Bid is below middle (..., market.current.last, market.current.middle):", bid_below_middle, market.current.last, market.current.middle,
      "\n|- Projected profit is better than fee (..., market.current.shift_span):", potential_better_than_fee, market.current.shift_span,
      "\n|- Projected profit is better than heat (..., wallet.cool, weighted_heat, profit_from_middle):", potential_better_than_heat, wallet.cool, weighted_heat, profit_from_middle,
      "\n_BUY__ Decision:", decision ? "BUYING" : "HOLDING",
      "\n******"
    );
    
    return decision;
  },
  
  isSelling: function(deal) {
    var me = this,
        decision = false;
    // decide if selling, how much
    var current_market_greed = (market.current.shift_span / 2),
        current_sale_price = (market.current.last * BID_ALIGN),
        trader_greed = ((current_market_greed > INITIAL_GREED) ? INITIAL_GREED : current_market_greed) + (wallet.current.fee / (2*100));
        candidate_deals = me.deals.filter(function(deal_for_sale) {
          //console.log("isSelling | deal_for_sale, market.current.last", deal_for_sale, market.current.last);
          console.log("trader | isSelling | would sell at:", (deal_for_sale.buy_price * (trader_greed + 1)), "current sale at:", current_sale_price);
          return (deal_for_sale.buy_price * (1 + trader_greed)) < current_sale_price;
        }),
        weighted_heat = wallet.cool + (1 - (market.current.middle / (market.current.last * BID_ALIGN)));
        potential_better_than_heat = (weighted_heat > 1);
    
    if (
      candidate_deals &&
      candidate_deals.length > 0 &&
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
      "\n|- potential_better_than_heat (..., weighted_heat, wallet.cool):", potential_better_than_heat, weighted_heat, wallet.cool,
      "\n_SALE_ Decision:", decision ? "SELLING" : "HOLDING",
      "\n******",
      "\nDeal for sale details:", deal
    );
    
    return decision;
  },
  
  decide: function(done) {
    var me = this;
    if (market.current) {
      var deal = {};
      if (me.isBuying(deal)) {
        me.buy(deal, done);
      }
      else if (me.isSelling(deal)) {
        me.sell(deal, done);
      }
      else {
        console.log("("+me.name+"): Not selling, nor buying.");
        //controller.updateDecisions({decision: "("+me.name+") Decided to HOLD (last:$"+market.current.last+")."});
        done();
      }
    }
    else {
      console.log("("+me.name+"): Market is not ready for my decisions yet.")
      done();
    }
  },
  
  sell: function(deal, done) {
    //console.log("I am selling, deal:", deal);
    var me = this;
    
    email.send({
      to: config.owner.email,
      subject: "Stampede - Selling: "+deal.name,
      template: "sale.jade",
      data: {
        deal: deal,
        market: market,
        wallet: wallet
      }
    }, function(success) {
      console.log("Email sending success?:", success);
    });
    deal.heat = deal.buy_price / MAX_SUM_INVESTMENT;
    wallet.cool -= (wallet.cool > 0 && deal.heat > 0) ? deal.heat : (market.current.shift_span / 2);
    
    controller.updateDecisions({decision: "Decided to sell "+deal.amount+"BTC for $"+((market.current.last * BID_ALIGN)*deal.amount)+"."});
    
    controller.sell(deal.amount, (market.current.last * BID_ALIGN).toFixed(2), function(error, order) {
      console.log("BITSTAMP: Response after attempt to sell | deal, error, order:", deal, error, order);
      if (order && order.id) {
        me.removeDeal(deal, function(redis_errors, redis_response) {
          done();
        });  
      }
      else {
        done();
      }
    });
    
  },
  
  buy: function(deal, done) {
    var me = this;
    deal.buy_price = (market.current.last / BID_ALIGN);
    deal.amount = (MAX_PER_HAND / deal.buy_price).toFixed(7);
    deal.sell_price = (deal.buy_price * (1 + market.current.shift_span + (wallet.current.fee / 100)));
    deal.heat = deal.buy_price / MAX_SUM_INVESTMENT;
    wallet.cool -= (wallet.cool > 0 && deal.heat > 0) ? deal.heat : (market.current.shift_span / 2);
    controller.updateDecisions({decision: "Decided to buy "+deal.amount+"BTC for $"+MAX_PER_HAND+"."});
    deal.buy_price = deal.buy_price;
    
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
    });
    
    controller.buy(deal.amount, (deal.buy_price).toFixed(2), function(error, order) {
      console.log("trader | buy | deal, order:", deal, order);
      if (
        order && 
        order.id
      ) {
        deal.order_id = parseInt(order.id);
        me.recordDeal(deal, function(redis_errors, redis_response) {
          wakeAll(function(live_traders) {
            console.log("Refreshing after PURCHASE.")
          });
        });
      }
      else {
        done();
      }
    });
  },
  
  presentAll: function(callback) {
    callback(null, live_traders);
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
      done("Problems finding deal.", null);
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
        order_id: parseInt(deal_arrayed[4])
      };
  return objectified_deal;
}

//"deal|1.1|332|338"
function stringDeal(deal) {
  deal.name = "deal|"+deal.amount+"|"+deal.buy_price+"|"+deal.sell_price+"|"+deal.order_id;
  return deal.name;
}

function checkMarket(done) {
  console.log("* Checking market.");
  // Initialize into global var, exposed on top
  market.check(function(error, market_current) {
    controller.updateMarket(market.current);
    controller.updateWallet(wallet.current);

    if (live_traders) {
      controller.updateTraders(live_traders);
      var i = 0;
      var btc_to_distribute = wallet.current.btc_available - wallet.current.btc_amount_managed;
      wallet.current.usd_value = (wallet.current.btc_balance || 0) * (market.current.last || 0) + (wallet.current.usd_balance || 0);

      
      var q = async.queue(function(trader_name, internal_callback) {
        var trader = live_traders[trader_name];
        if (
          btc_to_distribute > 0 &&
          live_traders[trader_name].deals.length < MAX_HANDS
        ) {
          var new_deal = {
            buy_price: market.current.last,
            amount: btc_to_distribute < (MAX_PER_HAND / market.current.last) ? btc_to_distribute : (MAX_PER_HAND / market.current.last),
            sell_price: market.current.last * (1 + (market.current.shift_span / 2))
          };
          btc_to_distribute -= new_deal.amount;
          wallet.current.btc_amount_managed += new_deal.amount;
          trader.recordDeal(new_deal, function(redis_error, redis_response) {
            console.log("updateMarket | Ad hoc deal recorded | new_deal, redis_error, redis_response:", new_deal, redis_error, redis_response);
          });
        }
        console.log("Trader deciding:", trader_name);
        trader.decide(internal_callback);
      }, 2);
      q.drain = function() {
        //console.log("Queue drained in checkMarket.");
        var cool_up = market.current.shift_span / 2;
        wallet.cool = (
          wallet.cool < 1 && 
          cool_up < (1 - wallet.cool)
        ) ? wallet.cool + cool_up : 1;
        var next_check = (market.check_frequency);
        console.log("Will check again in:", (next_check / 1000), "seconds.");
        if (timer) clearTimeout(timer);
        timer = setTimeout(function() {
          checkMarket(function() {
            updateSheets();
          });
        }, next_check);
        
        done(null, market.current);
      }
      for (var trader_name in live_traders) {
        q.push(trader_name, function(error) {
          console.log("Finished processing trader:", trader_name);
        });
      }
    }
    else {
      console.log("No traders present.");
      done(null, market.current);
    }
  });
}

function checkSheets(done) {
  console.log("* Checking history sheets.");
  var now = new Date(),
      timestamp = now.getTime();
  db.smembers("stampede_usd_value", function(error, sheet_records) {
    //console.log("checkSheets | done | error, response:", error, sheet_records);
    sheet_records.forEach(function(record) {
      var current = record.split("|");
      if (
        current[0] &&
        !isNaN(parseInt(current[0])) &&
        current[1] &&
        !isNaN(parseFloat(current[1]))
      ) sheets.push({time: parseInt(current[0]), value: parseFloat(current[1])});
    });
    sheets.sort(function(a, b) {return a.time - b.time});
    controller.drawSheets(sheets, "full");
    done(error, sheets);

  });
}

function updateSheets() {
  console.log("* Updating history sheets.");
  var now = new Date(),
      timestamp = now.getTime(),
      current_usd_value = wallet.current.usd_value;

  db.sadd("stampede_usd_value", timestamp+"|"+current_usd_value, function(error, response) {
    var new_value = {time: timestamp, value: current_usd_value};
    sheets.push(new_value);
    //console.log("updateSheets | sheets:", sheets);
    controller.drawSheets(new_value, "incremental");
  });
}


function checkWallet(done) {
  // Initialize into global var, exposed on top
  console.log("* Checking wallet.");
  wallet.check(live_traders, function() {
    wallet.current.available_to_traders = 
      (MAX_SUM_INVESTMENT - wallet.current.investment) < wallet.current.usd_available ? 
        MAX_SUM_INVESTMENT - wallet.current.investment : 
        wallet.current.usd_available;
    done(null, wallet.current);
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
  db.smembers("stampede_traders", function(error, trader_list) {
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
        checkWallet,
        checkSheets,
        checkMarket
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

function stopAll(done) {
  clearTimeout(timer);
  wallet = null;
  market = null;
  sheets = [];
  live_traders = {};
  done();
}

exports.stopAll = stopAll;
exports.wakeAll = wakeAll;
exports.instance = Trader;