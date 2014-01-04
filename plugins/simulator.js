var Trader = require("./../models/trader"),
    Market = require("./../models/market"),
    config = Trader.config,
    controller = require("./../routes/controller"),
    Wallet = require("./../models/wallet"),
    xc = config.exchange.currency;

function Simulation() {


}

var SimulatedTrader = Trader.instance,
    sim = new Simulation();


exports.run = function(callback) {
  Trader.prepareForSimulation();
  Trader.viewTraders(Trader.removeAllDeals);
  setTimeout(Trader.wakeAll, 5000);
  callback({
    message: "Started Market simulation."
  });
};