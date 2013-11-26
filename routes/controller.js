var config = require("./../plugins/config"),
    common = require("./../plugins/common"),
    helpers = require("./../plugins/helpers"),
    live = require("./../plugins/live"),
    Bitstamp = require("./../plugins/bitstamp.js"),
    creds = config.bitstamp_credentials,
    bitstamp = new Bitstamp(creds.client_id, creds.key, creds.secret),
    Trader = require("./../models/trader"),
    jade = require("jade"),
    traders_awake = false;

/*
 * Rendered actions
 *
 *
 *
 */

exports.index = function(req, res) {
  res.render('index', {
    title: 'Stampede',
    traders_awake: traders_awake,
    trading_config: config.trading
  });
  console.log("Traders are awake:", traders_awake);
  if (traders_awake) Trader.updateAll();
};

exports.shares = function(req, res) {
  res.render('shares', {
    title: "Stampede - Shares view",
    current_user: req.current_user
  });
};

exports.addShare = function(req, res) {
  var holder = req.body.holder.trim();
      investment = parseInt(req.body.investment),
      input_valid = (
        common.validateEmail(holder) &&
        investment > 0
      );

  if (input_valid) Trader.addShare(holder, investment);

  res.send({
    message: (input_valid ? "Share submitted" : "Share NOT sumbitted, input invalid.")
  });

};

exports.updateShares = function(shares) {

  jade.renderFile(__dirname + "/../views/_shares.jade", {shares: shares, helpers: helpers}, function(error, html) {
    //console.log("rendering updateShares | error, html:", error, html);
    if (html) live.sendToAll("stampede_updates", {
      container: "live-shares",
      html: html
    });
  });

}

exports.addTrader = function(req, res) {
  var trader = new Trader.instance();
  trader.create(function(error, response) {
    //Trader.wakeAll(function() {
      //traders_awake = true;
    res.redirect("/");
    //});
  });
};

exports.removeTrader = function(req, res) {
  var trader_name = req.params.trader_name;
  var trader = new Trader.instance(trader_name);
  trader.remove(function(live_traders) {
    res.send({message: "Removed."});
  });
};

exports.removeDeal = function(req, res) {
  var deal_name = req.params.deal_name,
      deal = {name: deal_name},
      trader_name = req.params.trader_name,
      trader = new Trader.instance(trader_name);
  trader.wake(function(error, record) {
    trader.removeDeal(deal, function() {
      res.send({message: "Deal removed."});
    });
  });
};

exports.wakeTraders = function(done) {
  Trader.wakeAll(function() {
    traders_awake = true;
    if (done) done();
  });
};

exports.stop = function(req, res) {
  Trader.stopAll(function() {
    traders_awake = false;
    res.send({message: "Stopped all traders.", success: true});
  });
};

exports.start = function(req, res) {
  
  Trader.wakeAll(function() {
    traders_awake = true;
    res.send({message: "Woke all traders.", success: true});
  });

};

exports.balance = function(done) {
  console.log("Getting ballance for user.");
  bitstamp.balance(done);
};

exports.getValueSheet = function(req, res) {
  //callback(error, data);
  Trader.pullValueSheet(function(value_sheet) {

    res.send({
      value_sheet: value_sheet,
      message: "Value sheet pulled: Length ("+value_sheet.length+")"
    });
  });
};


exports.ticker = function(callback) {
  console.log("Getting ticker for user.");
  bitstamp.ticker(callback);
};

exports.buy = function(amount, price, callback) {
  console.log("Buying bitcoins | amount, price:", amount, price);
  bitstamp.buy(amount, price, callback);
};

exports.sell = function(amount, price, callback) {
  console.log("Selling bitcoins | amount, price:", amount, price);
  bitstamp.sell(amount, price, callback);
};

exports.updateMarket = function(market_data) {
  //console.log("Updating market with data.", data);

  jade.renderFile(__dirname + "/../views/_market.jade", {current_market: market_data, helpers: helpers}, function(error, html) {
    //console.log("rendering updateMarket | error, html:", error, html);
    if (html) live.sendToAll("stampede_updates", {
      container: "live-ticker",
      html: html
    });
  });

  if (market_data.last) live.sendToAll("stampede_updates", {current_last_price: "$"+market_data.last});
  
};

exports.drawSheets = function(data, update_type) {
  //console.log("Drawing sheets ("+(data.length || "incremental")+").");
  var outgoing = {
    data: data,
    update_type: update_type,
    container: "live-sheets"
  };
  live.sendToAll("stampede_value_sheet_update", outgoing);
};

exports.updateWallet = function(wallet_data, done) {

  //console.log("^^^^^ Updating wallet with data.", data);

  jade.renderFile(__dirname + "/../views/_wallet.jade", {current_wallet: wallet_data, helpers: helpers}, function(error, html) {
    if (html) live.sendToAll("stampede_updates", {
      container: "live-balance",
      html: html
    });
    if (done) done();
  });
  
};

exports.updateTraders = function(traders, done) {

  jade.renderFile(__dirname + "/../views/_traders.jade", {traders: traders, helpers: helpers}, function(error, html) {
    if (error) console.log("updateTraders | renderFile | error:", error);
    if (html) live.sendToAll("stampede_updates", {
      container: "live-traders",
      html: html
    });
    if (done) done();
  });

};

exports.updateTradingConfig = function(done) {
  var outgoing = {
    data: config.trading,
    container: "live-trading-config"
  };
  
  //console.log("^^^^^ Updating wallet with data.", data);
  live.sendToAll("stampede_updates", outgoing);
  if (done) done();
};

exports.updateDecisions = function(data, done) {
  var outgoing = data;
  
  //console.log("^^^^^ Updating wallet with data.", data);
  live.sendToAll("stampede_updates", outgoing);
  if (done) done();
};


exports.transactions = function(callback) {
  bitstamp.transactions(callback);
};

exports.user_transactions = function(callback) {
  bitstamp.user_transactions(callback);
};
