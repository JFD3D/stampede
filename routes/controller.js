

/*
  This is the main route controller and provides a way for: 
  - rendering views
  - pushing updates to client

*/

module.exports = function(STAMPEDE) {
  var LOG = STAMPEDE.LOG("controller")
  var config = STAMPEDE.config
  var common = STAMPEDE.common
  var exchange = STAMPEDE.exchange
  var Trader = STAMPEDE.trader
  var live = STAMPEDE.live
  var simulator = new STAMPEDE.simulator()
  var simulated_exchange = (config.exchange.selected === "simulated_exchange")
  var jade = STAMPEDE.jade
  var async = STAMPEDE.async
  var generated_data = []
  var traders_awake = false
  var controller = {}

  controller.index = function(req, res) {
    if (simulated_exchange) {

      var cleanBooks = Trader.cleanBooks
      var wakeTraders = controller.wakeTraders
      var cleanSheets = Trader.cleanSheets

      async.series([
        simulatorRealtimePrep,
        cleanSheets,
        wakeTraders,
        cleanBooks
      ], respond)
    }
    else {
      respond()
    }

    function respond() {

      LOG("Index respond")
      var response = {
        title: 'Stampede',
        current_user: req.current_user,
        traders_awake: traders_awake,
        simulator_enabled: false,
        trading_config: config.trading,
        config: config,
        trading_strategies: config.strategy,
        helpers: STAMPEDE.helpers
      }
      res.render('index', response)
      // Delay displaying all information on front end
      // Beats the waiting for cycle refresh
      setTimeout(Trader.refreshAll, 2000)
    }

  }

  controller.shares = function(req, res) {
    res.render('share_index', {
      title: "Stampede - Shares view",
      helpers: STAMPEDE.helpers,
      current_user: req.current_user
    })
  }

  controller.addShare = function(req, res) {
    var holder = req.body.holder.trim()
        investment = parseInt(req.body.investment),
        input_valid = (
          common.validateEmail(holder) &&
          investment > 0
        )

    if (input_valid) Trader.addShare(holder, investment)

    res.redirect("/shares")

  }

  controller.refreshShares = function(shares) {

    jade.renderFile(__dirname + "/../views/_shares_table.jade", {
      shares: shares, 
      helpers: STAMPEDE.helpers,
      formatter: common.formatter
    }, function(error, html) {
      if (error) console.log(
        "rendering updateShares | error, html:", error, html
      )
      if (html) live.sendToAll("stampede_updates", {
        container: "live-shares",
        html: html
      })
    })

  }

  controller.addTrader = function(req, res) {
    var trader = new Trader.instance()
    trader.create(function(error, response) {
      res.send({message: "Trader added."})
    })
  }

  controller.removeTrader = function(req, res) {
    var trader_name = req.params.trader_name
    var trader = new Trader.instance(trader_name)
    trader.remove(function(live_traders) {
      res.send({message: "Removed."})
    })
  }

  controller.removeDeal = function(req, res) {
    var deal_name = req.params.deal_name,
        deal = {name: deal_name},
        trader_name = req.params.trader_name,
        trader = new Trader.instance(trader_name)
    trader.wake(function(error, record) {
      trader.removeDeal(deal_name, function() {
        res.send({message: "Deal removed."})
      })
    })
  }


  controller.sellDeal = function(req, res) {
    var deal_name = req.params.deal_name,
        deal = {name: deal_name},
        trader_name = req.params.trader_name,
        trader = new Trader.instance(trader_name)
    trader.wake(function(error, record) {
      trader.sellDeal(deal_name, function() {
        res.send({message: "Deal sale opened."})
      })
    })
  }


  controller.wakeTraders = function(done) {
    Trader.wakeAll(function() {
      traders_awake = true
      if (done) done()
    })
  }

  controller.stop = function(req, res) {
    Trader.stopAll(function() {
      traders_awake = false
      res.send({message: "Stopped all traders.", success: true})
    })
  }

  controller.start = function(req, res) {
    Trader.wakeAll(function() {
      traders_awake = true
      res.send({message: "Woke all traders.", success: true})
    })
  }

  controller.getValueSheet = function(req, res) {
    Trader.pullValueSheet(function(value_sheet) {
      res.send({
        value_sheet: value_sheet,
        message: "Value sheet pulled: Length ("+value_sheet.length+")"
      })
    })
  }

  controller.refreshMarket = function(market_data) {
    jade.renderFile(__dirname + "/../views/_market.jade", {
      current_market: market_data, 
      helpers: STAMPEDE.helpers,
      formatter: common.formatter
    }, function(error, html) {
      if (html) live.sendToAll("stampede_updates", {
        container: "live-ticker",
        html: html
      })
    })
    if (market_data.last) live.sendToAll(
      "stampede_updates", {current_last_price: "$"+market_data.last.toFixed(2)}
    )
  }

  controller.refreshOverview = function(market_data) {
    jade.renderFile(__dirname + "/../views/_overview.jade", {
      current_market: STAMPEDE.current_market,
      current_wallet: STAMPEDE.current_wallet,
      helpers: STAMPEDE.helpers,
      formatter: common.formatter
    }, function(error, html) {
      if (html) live.sendToAll("stampede_updates", {
        container: "live-overview",
        html: html
      })
    })
  }

  controller.drawSheets = function(data, update_type) {
    var outgoing = {
      data: data,
      display_limit: config.sheet_size_limit,
      update_type: update_type,
      container: "live-sheets"
    }
    live.sendToAll("stampede_value_sheet_update", outgoing)
  }

  controller.refreshWallet = function(wallet_data, done) {
    jade.renderFile(__dirname + "/../views/_wallet.jade", {
      current_wallet: wallet_data, 
      helpers: STAMPEDE.helpers,
      formatter: common.formatter
    }, function(error, html) {
      if (error) console.log("!!!! refreshWallet error:", error)
      if (html) live.sendToAll("stampede_updates", {
        container: "live-balance",
        html: html
      })
      if (done) done()
    })
  }

  controller.refreshTraders = function(traders, done) {
    jade.renderFile(__dirname + "/../views/_traders.jade", {
      traders: traders, 
      helpers: STAMPEDE.helpers,
      formatter: common.formatter
    }, function(error, html) {
      if (error) console.log("refreshTraders | renderFile | error:", error)
      if (html) live.sendToAll("stampede_updates", {
        container: "live-traders",
        html: html
      })
      if (done) done()
    })
  }

  controller.refreshTradingConfig = function(done) {
    var outgoing = {
      data: STAMPEDE.config,
      container: "live-trading-config"
    }

    console.log("^^^^^ Updating wallet with data.", outgoing)
    live.sendToAll("stampede_updates", outgoing)
    if (done) done()
  }


  controller.refreshDecisions = function(data) {
    jade.renderFile(__dirname + "/../views/_decision_indicators.jade", {
      decisions: data, 
    helpers: STAMPEDE.helpers
  }, function(error, html) {
      if (error) console.log("refreshDecisions | renderFile | error:", error)
      if (html) live.sendToAll("stampede_updates", {
        container: "decision-indicators",
        html: html
      })
    })  
  }

  controller.refreshSimulationSets = function(data_sets, done) {
    jade.renderFile(__dirname + "/../views/_simulator_data_sets.jade", {
      data_sets: data_sets, 
    helpers: STAMPEDE.helpers
  }, function(error, html) {
      if (error) console.log("refreshSimulationSets | renderFile | error:", error)
      if (html) live.sendToAll("stampede_updates", {
        container: "simulator-data-sets",
        html: html
      })
      if (done) done()
    })
  }

  controller.refreshSimulationResults = function(results, done) {
    jade.renderFile(__dirname + "/../views/_simulator_serie_results.jade", {
      serie_results: results,
      formatter: common.formatter,
      helpers: STAMPEDE.helpers
    }, function(error, html) {
      if (error) console.log("refreshSimulationResults | renderFile | error:", error)
      if (html) live.sendToAll("stampede_updates", {
        container: "simulator-series",
        html: html
      })
      if (done) done()
    })
  }

  controller.updateTradingStrategy = function(req, res) {
    var update_body = req.body
    var new_config = {}
    for (var attribute in config.strategy) {
      new_config[attribute] = (update_body[attribute] === "on" ? true : false)
    }
    Trader.updateStrategy(new_config)
    res.send({message: "Strategy update submitted."})
  }


  controller.updateTradingConfig = function(req, res) {
    var update_body = req.body
    var new_config = {}
    for (var attribute in config.trading) {
      new_config[attribute] = (
        parseFloat(update_body[attribute]) || config.trading[attribute]
      )
    }
    Trader.updateConfig(new_config)
    res.send({message: "Trading configuration update submitted."})
  }

  controller.resetTradingConfig = function(req, res) {
    Trader.resetConfig()
    res.redirect("/")
  }

  controller.notifyClient = function(data, done) {
    var outgoing = data

    live.sendToAll("stampede_updates", outgoing)
    if (done) done()
  }


  // EXCHANGE interaction routes

  controller.transactions = function(callback) {
    exchange.transactions(callback)
  }

  controller.user_transactions = function(callback) {
    exchange.user_transactions(callback)
  }

  controller.ticker = function(callback) {
    exchange.ticker(callback)
  }

  controller.buy = function(amount, price, callback) {
    exchange.buy(amount, price, callback)
  }

  controller.sell = function(amount, price, callback) {
    exchange.sell(amount, price, callback)
  }

  controller.balance = function(callback) {
    exchange.balance(callback)
  }

  // GENERATOR SPECific

  controller.simulatorHome = function(req, res) {
    if (simulated_exchange) {
      res.render('index', {
        title: 'Stampede: Simulator',
        current_user: req.current_user,
        data_sets: [],
        simulator_enabled: true,
        trading_config: config.trading,
        config: config,
        traders_awake: true,
        trading_strategies: config.strategy,
        helpers: STAMPEDE.helpers
      })

    }
    else {
      res.redirect("/")
    }

    setTimeout(function() {
      Trader.loadTraders(function() {
        simulator.loadAllSets()
        Trader.refreshAll() 
      })
    }, 2000)
  }

  controller.simulatorGenerate = function(req, res) {

    generated_data = STAMPEDE.generator.launch()
    controller.generated_data = generated_data
    simulator.resetDataSet()
    var binned_data = STAMPEDE.generator.bin(generated_data, 20000)

    res.send({
      message: "Generated data.",
      data: binned_data
    })
  }

  controller.simulatorCleanUp = function(req, res) {
    Trader.cleanBooks(function() {
      res.send({message: "All deals removed."})
    })
  }

  controller.simulatorRun = function(req, res) {
    console.log(
      "Simulator warming up (data length - "+generated_data.length+")."
    )
    
    // MAKE SURE we run simulation on virtual exchange !!!
    if (generated_data && generated_data.length && simulated_exchange) {
      LOG("simulatorRun | generated_data.length:", generated_data.length)
      simulatorWarmUp(generated_data)
      // simulator.startSeries()
      simulator.run(function(response) {
        res.send({message: response.message || "Submitted simulator launch."})
      })
    }
    else {
      res.send({
        message: "WARNING: Simulated exchange is not selected or no data."
      })
    }
  }



  controller.simulatorRunSeries = function(req, res) {
    // MAKE SURE we run simulation on virtual exchange !!!
    if (simulated_exchange) {

      simulator.startSeries()
      res.render("series", {
        simulator_enabled: true,
        trading_config: config.trading,
        traders_awake: true,
        trading_strategies: config.strategy,
        helpers: STAMPEDE.helpers,
        title: "Stampede: Series simulation"
      })
    }
    else {
      res.send({message: "WARNING: Simulated exchange is not selected."})
    }
  }

  controller.simulatorSave = function(req, res) {
    console.log("Storage of generated data requested.")
    var optional_set_name = (req.body.set_name_ui || null)
    if (generated_data) {
      simulator.saveSet(optional_set_name, generated_data, function(errors) {
        res.send({message: "Submitted the simulator dataset for save."})
        simulator.loadAllSets()
      })
    }
    else {
      res.send({message: "No data set loaded to store."})
    }
  }

  controller.simulatorLoad = function(req, res) {
    var set_name = req.params.data_set
    simulator.loadSet(set_name, function(error, data) {
      generated_data = data
      controller.generated_data = generated_data
      var binned_data = STAMPEDE.generator.bin(data, 20000)
      res.send({
        message: "Loaded data.",
        data: binned_data
      })
    })
  }

  controller.simulatorRemove = function(req, res) {
    var set_name = req.params.data_set
    simulator.removeSet(set_name)
  }

  // Called from within simulated exchange once the end of data has been reached
  controller.simulatorFinish = function(exchange_data) {
    simulator.finish()
  }

  controller.simulatorWarmUp = simulatorWarmUp

  function simulatorWarmUp(data) {
    controller.generated_data = data
    if (data && data.length) STAMPEDE.exchange.load(STAMPEDE, data)
  }

  // This is used to real time simulate data on index
  function simulatorRealtimePrep(done) {
    // No data is passed into simulated exchange, it will be a real time exchange
    STAMPEDE.exchange.load(STAMPEDE)
    if (done) return done()
  }

  return (controller)

}