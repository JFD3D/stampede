var config = require("./../plugins/config"),
    creds = config.bitstamp_credentials,
    Bitstamp = require("./../plugins/bitstamp.js"),
    bitstamp = new Bitstamp(creds.client_id, creds.key, creds.secret),
    Trader = require("./../models/trader"),
    live = require("./../plugins/live");

/*
 * Rendered actions
 *
 *
 *
 */

exports.index = function(req, res) {
  res.render('index', {
    title: 'Stampede'
  });
};

exports.addTrader = function(req, res) {
  var trader = new Trader();
  trader.create(function(error, response) {
    trader.wakeAll(function(live_traders) {
      console.log("Added trader and woke all.");
      res.redirect("/");
    });
  });
};

exports.removeTrader = function(req, res) {
  var trader_name = req.params.trader_name;
  var trader = new Trader(trader_name);
  trader.remove(function(live_traders) {
    res.send({message: "Removed."});
  });
};

exports.traders = function(callback) {
  var trader = new Trader();
  trader.presentAll(callback);
};

exports.wakeTraders = function(done) {
  var trader = new Trader();
  trader.wakeAll(done);
};

exports.balance = function(done) {
  console.log("Getting ballance for user.");
  bitstamp.balance(done);
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
  console.log("Updating market with data.", data);
  live.sendToAll("stampede_updates", outgoing);
};

exports.updateWallet = function(data, done) {
  var outgoing = {
    data: data,
    container: "live-balance"
  };
  
  console.log("Updating wallet with data.", data);
  live.sendToAll("stampede_updates", outgoing);
  done();
};


exports.transactions = function(callback) {
  bitstamp.transactions(callback);
};

exports.user_transactions = function(callback) {
  bitstamp.user_transactions(callback);
};
