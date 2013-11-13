var config = require("./../plugins/config"),
    creds = config.bitstamp_credentials,
    Bitstamp = require("./../plugins/bitstamp.js"),
    bitstamp = new Bitstamp(creds.client_id, creds.key, creds.secret),
    Trader = require("./../models/trader"),
    live = require("./../plugins/live"),
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
    traders_awake: traders_awake
  });
  console.log("Traders are awake:", traders_awake);
  if (traders_awake) Trader.updateAll();
};

exports.addTrader = function(req, res) {
  var trader = new Trader.instance();
  trader.create(function(error, response) {
    res.redirect("/");
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

exports.updateMarket = function(data) {
  var outgoing = {
    data: data,
    container: "live-ticker"
  };
  //console.log("Updating market with data.", data);
  live.sendToAll("stampede_updates", outgoing);
};

exports.drawSheets = function(data, update_type) {
  console.log("Drawing sheets ("+(data.length || "incremental")+").");
  var outgoing = {
    data: data,
    update_type: update_type,
    container: "live-sheets"
  };
  live.sendToAll("stampede_value_sheet_update", outgoing);
};

exports.updateWallet = function(data, done) {
  var outgoing = {
    data: data,
    container: "live-balance"
  };
  
  //console.log("^^^^^ Updating wallet with data.", data);
  live.sendToAll("stampede_updates", outgoing);
  if (done) done();
};

exports.updateTraders = function(data, done) {
  var outgoing = {
    data: data,
    container: "live-traders"
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
