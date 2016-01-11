

/*
  This is the main route _C and provides a way for: 
  - rendering views
  - pushing updates to client

*/

module.exports = function(_S) {
  var LOG             = _S.LOG("controller")
  var CONFIG          = _S.config
  var common          = _S.common
  var Trader          = _S.trader
  var Loader          = _S.data_loader
  var live            = _S.live
  var SIMULATOR       = _S.current_simulator
  var jade            = _S.jade
  var async           = _S.async
  var _C              = {}
  var traders_awake   = false

  const SIMULATION = (CONFIG.exchange.selected === "simulated_exchange")

  _C.index = (req, res) => {
    if (SIMULATION) {
      var cleanBooks = Trader.cleanBooks
      var wakeTraders = _C.wakeTraders
      var cleanSheets = Trader.cleanSheets

      async.series([
        simulatorRealtimePrep,
        cleanSheets,
        wakeTraders,
        cleanBooks
      ], respond)
    }
    else respond()

    function respond() {

      LOG("Index respond")
      var response = {
        title: 'Stampede',
        current_user: req.current_user,
        traders_awake: traders_awake,
        simulator_enabled: false,
        trading_config: CONFIG.trading,
        config: CONFIG,
        trading_strategies: CONFIG.strategy,
        helpers: _S.helpers
      }
      res.render('index', response)
      // Delay displaying all information on front end
      // Beats the waiting for cycle refresh
      setTimeout(Trader.refreshAll, 2000)
    }

  }

  _C.dataLoader = (req, res) => {
    res.render("data_loader", {
      title: 'Stampede: Data loader',
      current_user: req.current_user
    })
  }

  _C.loadTradeHistory = (req, res) => {
    var day_span  = parseInt(req.body.day_span)
    var set_name  = req.body.set_name

    LOG("req.body, req.files:", req.body, req.files)

    if (day_span > 0 && day_span < 1000) {
      Loader.load({
        day_span: day_span,
        set_name: set_name,
        data_file: req.body.data_file,
        req: req
      }, (errors, result) => {
        SIMULATOR.saveSet({
          name: set_name, 
          data: result.data
        }, (errors, set) => {
          res.send({
            data_length: result.data.length,
            set_name: result.set_name,
            day_span: result.day_span,
            start_point_time: result.start_point_time,
            set: set
          })        
        })
      })
        
    }
    else {
      res.redirect("/data_loader")
    }
    
  }

  _C.shares = (req, res) => {
    res.render('share_index', {
      title: "Stampede - Shares view",
      helpers: _S.helpers,
      current_user: req.current_user
    })
  }

  _C.addShare = (req, res) => {
    var holder = req.body.holder.trim()
    var investment = parseInt(req.body.investment)
    var input_valid = (
          common.validateEmail(holder) &&
          investment > 0
        )

    if (input_valid) Trader.addShare(holder, investment)
    res.redirect("/shares")
  }

  _C.refreshShares = (shares) => {

    jade.renderFile(__dirname + "/../views/_shares_table.jade", {
      shares: shares, 
      helpers: _S.helpers,
      formatter: common.formatter
    }, (error, html) => {
      if (error) LOG(
        "rendering updateShares | error, html:", error, html
      )
      if (html) live.sendToAll("stampede_updates", {
        container: "live-shares",
        html: html
      })
    })
  }

  _C.adjustSimulationSpeed = (req, res) => {
    var vector = parseInt(req.body.vector)
    if (SIMULATION && [-1, 0, 1].indexOf(vector)) {
      _S.exchange.setTickingInterval(vector)
      res.send({ 
        message: 'Speed multiplier now at: ' + _S.exchange.tick_interval_multiplier 
      })
    }
    else res.send({ message: 'Incorrect vector or no simulation running.' })
  }

  _C.addTrader = (req, res) => {
    var trader = new Trader.instance()
    trader.create(function(error, response) {
      res.send({message: "Trader added."})
    })
  }

  _C.removeTrader = (req, res) => {
    var trader_name = req.params.trader_name
    var trader = new Trader.instance(trader_name)
    trader.remove(function(live_traders) {
      res.send({message: "Removed."})
    })
  }

  _C.removeDeal = (req, res) => {
    var deal_name = req.params.deal_name,
        deal = {name: deal_name},
        trader_name = req.params.trader_name,
        trader = new Trader.instance(trader_name)
    trader.wake((error, record) => {
      trader.removeDeal(deal_name, () => res.send({ message: "Deal removed." }))
    })
  }


  _C.sellDeal = (req, res) => {
    var deal_name = req.params.deal_name,
        deal = {name: deal_name},
        trader_name = req.params.trader_name,
        trader = new Trader.instance(trader_name)
    trader.wake((error, record) => {
      trader.sellDeal(deal_name, () => {
        res.send({message: "Deal sale opened."})
      })
    })
  }


  _C.wakeTraders = (done) => {
    Trader.wakeAll(() => {
      traders_awake = true
      if (done) done()
    })
  }

  _C.stop = (req, res) => {
    Trader.stopAll(function() {
      traders_awake = false
      res.send({message: "Stopped all traders.", success: true})
    })
  }

  _C.start = (req, res) => {
    Trader.wakeAll(() => {
      traders_awake = true
      res.send({message: "Woke all traders.", success: true})
    })
  }

  _C.getValueSheet = (req, res) => {
    Trader.pullValueSheet((value_sheet) => {
      res.send({
        value_sheet: value_sheet,
        message: "Value sheet pulled: Length ("+value_sheet.length+")"
      })
    })
  }

  _C.refreshMarket = (market_data) => {
    jade.renderFile(__dirname + "/../views/_market.jade", {
      current_market: market_data,
      sim_control: {
        real_time: (SIMULATION && _S.exchange.real_time),
        interval_multiplier: (_S.exchange.tick_interval_multiplier || 1)
      },
      helpers: _S.helpers,
      formatter: common.formatter
    }, (error, html) => {
      if (html) live.sendToAll("stampede_updates", {
        container: "live-ticker",
        html: html
      })
    })
    if (market_data.last) {
      live.sendToAll(
        "stampede_updates", { 
        current_last_price: "$"+market_data.last.toFixed(2),
        price: market_data.last,
        time: market_data.time
      })
    }
  }

  _C.refreshOverview = (market_data) => {
    jade.renderFile(__dirname + "/../views/_overview.jade", {
      current_market: _S.current_market,
      current_wallet: _S.current_wallet,
      helpers: _S.helpers,
      formatter: common.formatter
    }, (error, html) => {
      if (html) live.sendToAll("stampede_updates", {
        container: "live-overview",
        html: html
      })
    })
  }

  _C.drawSheets = (data, update_type) => {
    var outgoing = {
      data: data,
      display_limit: CONFIG.sheet_size_limit,
      update_type: update_type,
      container: "live-sheets"
    }
    live.sendToAll("stampede_value_sheet_update", outgoing)
  }

  _C.refreshWallet = (wallet_data, done) => {
    jade.renderFile(__dirname + "/../views/_wallet.jade", {
      current_wallet: wallet_data, 
      helpers: _S.helpers,
      formatter: common.formatter
    }, function(error, html) {
      if (error) LOG("!!!! refreshWallet error:", error)
      if (html) live.sendToAll("stampede_updates", {
        container: "live-balance",
        html: html
      })
      if (done) done()
    })
  }

  _C.refreshTraders = (traders, done) => {
    jade.renderFile(__dirname + "/../views/_traders.jade", {
      traders: traders, 
      helpers: _S.helpers,
      formatter: common.formatter
    }, (error, html) => {
      if (error) LOG("refreshTraders | renderFile | error:", error)
      if (html) live.sendToAll("stampede_updates", {
        container: "live-traders",
        html: html
      })
      if (done) done()
    })
  }

  _C.refreshTradingConfig = (done) => {
    var outgoing = {
      data: _S.config,
      container: "live-trading-config"
    }

    LOG("^^^^^ Updating wallet with data.", outgoing)
    live.sendToAll("stampede_updates", outgoing)
    if (done) done()
  }


  _C.refreshDecisions = (data) => {
    jade.renderFile(__dirname + "/../views/_decision_indicators.jade", {
      decisions: data, 
    helpers: _S.helpers
  }, (error, html) => {
      if (error) LOG("refreshDecisions | renderFile | error:", error)
      if (html) live.sendToAll("stampede_updates", {
        container: "decision-indicators",
        html: html
      })
    })  
  }

  _C.refreshSimulationSets = (data_sets, done) => {
    jade.renderFile(__dirname + "/../views/_simulator_data_sets.jade", {
      data_sets: data_sets, 
    helpers: _S.helpers
  }, function(error, html) {
      if (error) LOG("refreshSimulationSets | renderFile | error:", error)
      if (html) live.sendToAll("stampede_updates", {
        container: "simulator-data-sets",
        html: html
      })
      if (done) done()
    })
  }

  _C.refreshSimulationResults = (results, done) => {
    jade.renderFile(__dirname + "/../views/_simulator_serie_results.jade", {
      serie_results: results,
      formatter: common.formatter,
      helpers: _S.helpers
    }, (error, html) => {
      if (error) LOG("refreshSimulationResults | renderFile | error:", error)
      if (html) live.sendToAll("stampede_updates", {
        container: "simulator-series",
        html: html
      })
      if (done) done()
    })
  }

  _C.updateTradingStrategy = (req, res) => {
    var update_body = req.body
    var new_config = {}
    for (var attribute in CONFIG.strategy) {
      new_config[attribute] = (update_body[attribute] === "on" ? true : false)
    }
    Trader.updateStrategy(new_config)
    res.send({message: "Strategy update submitted."})
  }


  _C.updateTradingConfig = (req, res) => {
    var update_body = req.body
    var new_config = {}
    for (var attribute in CONFIG.trading) {
      new_config[attribute] = (
        parseFloat(update_body[attribute]) || CONFIG.trading[attribute]
      )
    }
    Trader.updateConfig(new_config)
    res.send({message: "Trading configuration update submitted."})
  }

  _C.resetTradingConfig = (req, res) => {
    Trader.resetConfig()
    res.redirect("/")
  }

  _C.notifyClient = (data, done) => {
    var outgoing = data

    live.sendToAll("stampede_updates", outgoing)
    if (done) done()
  }

  // GENERATOR SPECific

  _C.simulatorHome = (req, res) => {
    if (SIMULATION) {
      res.render('index', {
        title: 'Stampede: Simulator',
        current_user: req.current_user,
        data_sets: [],
        simulator_enabled: true,
        trading_config: CONFIG.trading,
        config: CONFIG,
        traders_awake: true,
        trading_strategies: CONFIG.strategy,
        helpers: _S.helpers
      })

    }
    else {
      res.redirect("/")
    }

    setTimeout(() => {
      Trader.loadTraders(() => {
        SIMULATOR.loadAllSets()
        Trader.refreshAll() 
      })
    }, 2000)
  }

  _C.simulatorGenerate = (req, res) => {
    _S.generated_data = _S.generator.launch()
    SIMULATOR.resetDataSet()

    res.send({
      message: "Generated data.",
      data: _S.generator.bin(_S.generated_data, 300)
    })
  }

  _C.simulatorCleanUp = (req, res) => {
    Trader.cleanBooks(() => {
      res.send({message: "All deals removed."})
    })
  }

  _C.simulatorRun = (req, res) => {
    LOG(
      "Simulator warming up (data length - "+_S.generated_data.length+")."
    )
    
    // MAKE SURE we run simulation on virtual exchange !!!
    if (_S.generated_data && _S.generated_data.length && SIMULATION) {
      LOG("simulatorRun | generated_data.length:", _S.generated_data.length)
      simulatorWarmUp(_S.generated_data)
      // SIMULATOR.startSeries()
      SIMULATOR.run(() => res.send({message: "Submitted simulator launch."}))
    }
    else {
      res.send({
        message: "WARNING: Simulated exchange is not selected or no data."
      })
    }
  }



  _C.simulatorRunSeries = (req, res) => {
    // MAKE SURE we run simulation on virtual exchange !!!
    if (SIMULATION) {
      SIMULATOR.startSeries((errors, started) => {
        if (errors) {
          res.render("general_error", {
            error: errors,
            link_back: "/simulator"
          })
        }
        else {
          res.render("series", {
            simulator_enabled: true,
            trading_config: CONFIG.trading,
            traders_awake: true,
            trading_strategies: CONFIG.strategy,
            helpers: _S.helpers,
            title: "Stampede: Series simulation"
          })
        }
              
      })
    }
    else {
      res.send({message: "WARNING: Simulated exchange is not selected."})
    }
  }


  _C.factoryRunSeries = (req, res) => {
    if (SIMULATION) {
      res.render("series", {
        simulator_enabled: true,
        trading_config: CONFIG.trading,
        traders_awake: true,
        trading_strategies: CONFIG.strategy,
        helpers: _S.helpers,
        title: "Stampede: Series simulation"
      })

      // Start factory run
      _S.factory.init()
    }
    else {
      res.send({message: "WARNING: Simulated exchange is not selected."})
    }
  }

  _C.simulatorSave = (req, res) => {
    LOG("Storage of generated data requested.")
    var optional_set_name = (req.body.set_name_ui || null)
    if (_S.generated_data) {
      SIMULATOR.saveSet({
        name: optional_set_name,
        data: _S.generated_data
      }, (errors) => {
        res.send({message: "Submitted the simulator dataset for save."})
        SIMULATOR.loadAllSets()
      })
    }
    else {
      res.send({message: "No data set loaded to store."})
    }
  }

  _C.switchSetInclusion = (req, res) => {
    var set_name          = req.body.set_name
    var include_in_series = req.body.include_in_series

    SIMULATOR.updateSet({ 
      set_name: set_name,
      include_in_series: include_in_series
    }, error => res.send({ error: error }))
  }

  _C.simulatorLoad = function(req, res) {
    var set_name = req.params.data_set
    SIMULATOR.loadSet(set_name, function(error, data) {
      _S.generated_data = data
      res.send({
        message: "Loaded data.",
        data: _S.generator.bin(data, 300)
      })
    })
  }

  _C.simulatorRemove = function(req, res) {
    var set_name = req.params.data_set
    SIMULATOR.removeSet(set_name)
  }

  _C.simulatorWarmUp = simulatorWarmUp

  function simulatorWarmUp(data) {
    _S.generated_data = data
    if (data && data.length) _S.exchange.load(_S, data)
  }

  // This is used to real time simulate data on index
  function simulatorRealtimePrep(done) {
    // No data is passed into simulated exchange, it will be a real time exchange
    _S.exchange.load(_S)
    if (done) return done()
  }

  return (_C)

}