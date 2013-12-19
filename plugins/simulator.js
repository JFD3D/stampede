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


// exports.runX = function(data, callback) {
//   var sim_config = data.config,
//       market_data = data.market,
//       market_updates = sim_config.notifications || 10,
//       wallet = Trader.wallet,
//       market = Trader.market,
//       xc = config.exchange.currency,
//       wallet_data = {
//         btc_reserved: 0,
//         fee: 0.4,
//         btc_available: 0,
//         btc_balance: 0
//       };
//   wallet_data[xc+"_reserved"] = 0;
//   wallet_data[xc+"_balance"] = wallet_data[xc+"_available"] = sim_config.start_amount;

//   config.trading.maximum_investment = sim_config.start_amount;

//   Trader.prepareForSimulation();

//   wallet.assign(wallet_data).summarizeDeals();
//   wallet.assignAvailableResources(sim_config.start_amount);

//   controller.refreshWallet(wallet.current);
//   live_traders = Trader.live_traders;
//   for (var i = 0; i < sim_config.num_of_traders; i++) {
//     var trader_name = "simulated_trader_"+i;
//     var trader = live_traders[trader_name] = new SimulatedTrader(trader_name);
     
//     trader.simulated = true;
//     trader.deals = [];
//   }

//   console.log("simulator | run | live_traders:", live_traders);

//   callback({
//     message: "Started simulation for: "+market_data.length
//   });

//   market_data.forEach(function(market_current, market_data_index) {
//     var notification_time = market_data_index % Math.floor(market_data.length / market_updates);

//     if (market_data_index === 0) market_current.starting_point = true;

//     process.stdout.write("i:"+market_data_index+"|t:"+notification_time+"\r");
//     //["last", "bid", "low", "high", "volume", "ask"]
//     market_current.bid = market_current.last;
//     market_current.ask = market_current.last;
//     market_current.volume = 10000;


//     market.assign(market_current);

    
//     market.current.threshold = config.trading.impatience * (market.current.high - market.current.middle) + market.current.middle;
//     wallet.current.currency_value = (wallet.current.btc_balance || 0) * (market.current.last || 0) + (wallet.current[config.exchange.currency+"_balance"] || 0);
    
//     if (market_data_index < 2) console.log("market_current", market.current);

//     market.tick();

//     for (var trader_name in live_traders) {
//       var current_trader = live_traders[trader_name],
//           buy_decision = current_trader.isBuying();

//       if (buy_decision) {
//         controller.notifyClient({message: "Buying ("+config.exchange.currency.toUpperCase()+" "+market.current.last.toFixed(2)+")."});
//       }
//     }

//     if (
//       notification_time === 0 || 
//       market_data_index === market_data.length - 1
//     ) controller.refreshMarket(market.current);

//   });
  


// };