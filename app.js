var START = (function() {

  function Stampede() {
    var STAMPEDE = {}
    STAMPEDE.name = "stampede"
    STAMPEDE.environment = (process.env.NODE_ENV || 'development')
    STAMPEDE.config = require("./configs/config")

    // Load shareable dependencies
    STAMPEDE.MA = require("moving-average")
    STAMPEDE.async = require("async")
    STAMPEDE.jade = require("jade")
    STAMPEDE._ = require("underscore")

    // Array of plugins that will be loaded
    // ORDER is important
    STAMPEDE.plugins = [
      "common",
      "auth",
      "email",
      "generator",
      "helpers",
      "live",
      "simulator"
    ]

    // Array of routers
    STAMPEDE.models = [
      "market",
      "wallet",
      "trader",
      "cycle"
    ]

    STAMPEDE.LOG = function(module_name) {
      // Assign default logging function to each module and plugin     
      return (function() {
        var args = Array.prototype.slice.call(arguments)
        args.unshift(module_name.toUpperCase() + "(" + process.pid + "):")
        console.log.apply(null, args)
      })
    }

    STAMPEDE.initialize = function() {
      // Trigger to cycle through modules and initialize
      connectDatabase()
      setupApplication()
      loadDependencies()
      initializeExchange()
      initiateAuthentication()
      assignRoutes()
      initiateLiveCommunication()
    }

    return STAMPEDE
  }



  function loadDependencies() {
    var module_types = ["plugins", "models"]

    module_types.forEach(initializeModuleType)
    // Load route controller
    STAMPEDE.controller = require("./routes/controller")(STAMPEDE)
    
  }

  function initializeModuleType(type) {
    
    STAMPEDE[type].forEach(function(module_name) {
      var module_loaded = require("./" + type + "/" + module_name)
      var module_initialized = module_loaded(STAMPEDE)
      STAMPEDE[module_name] = module_initialized
    })
  }

  function initiateAuthentication() {
    // Authentication module injection
    STAMPEDE.auth.initiate(STAMPEDE.app)
  }

  function connectDatabase() {
    var redis = require("redis")
    STAMPEDE.db = redis.createClient(STAMPEDE.config.redis_port || 6379)
  }

  function setupApplication() {
    var express = require('express')
    var morgan = require('morgan')
    var http = require('http')
    var path = require('path')
    var config = STAMPEDE.config
    var environment = STAMPEDE.environment
    var session = require('express-session')
    var cookieParser = require('cookie-parser')
    var bodyParser = require('body-parser')
    var favicon = require('serve-favicon')
    var methodOverride = require('method-override')
    var RedisStore = require('connect-redis')(session)
    var app = express()
    
    app.use(morgan("dev", {
      skip: function (req, res) { return res.statusCode === 304 }
    }))
    // all environments
    app.use(express.static(path.join(__dirname, 'public')))
    app.use(methodOverride())
    app.use(cookieParser())
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({
      extended: true
    }));
    app.use(session({ 
      key: STAMPEDE.name + '-' + environment + '.sid',
      store: new RedisStore(), 
      secret: (config.session_secret + environment),
      saveUninitialized: true,
      resave: true
    }))
    app.use(favicon(__dirname + '/public/images/favicon.ico'))
    app.set('views', __dirname + '/views')
    app.set('view engine', 'jade')
    app.set('port', config.port)

    STAMPEDE.app = app
  }

  function initializeExchange() {
    var config = STAMPEDE.config
    var Exchange = 
        require("./exchanges/" + config.exchange.selected + ".js")(STAMPEDE)
    var credentials = config.credentials[config.exchange.selected]

    this.exchange = new Exchange(
      credentials.key, credentials.secret, credentials.client_id)
  }

  function initiateLiveCommunication() {
  
    STAMPEDE.server = STAMPEDE.app.listen(STAMPEDE.app.get('port'), function() {

      LOG('Stampeding at ' + STAMPEDE.app.get('port') + ' feet.')
      if (
        STAMPEDE.environment !== "development" && 
        STAMPEDE.config.exchange.selected !== "simulated_exchange"
      ) STAMPEDE.controller.wakeTraders()
    })
    if (STAMPEDE.server) {
      STAMPEDE.live.sockets(STAMPEDE.app, STAMPEDE.server)
    }
  }


  function assignRoutes() {
    var app = STAMPEDE.app
    var controller = STAMPEDE.controller
    var auth = STAMPEDE.auth

    app.get("/", auth.ensure, controller.index)
    app.post("/trader/create", auth.ensure, controller.addTrader)
    app.post("/trading_config/update", auth.ensure, controller.updateTradingConfig)
    app.post("/trading_strategy/update", auth.ensure, controller.updateTradingStrategy)
    app.get("/trading_config/reset", auth.ensure, controller.resetTradingConfig)
    app.get("/trader/:trader_name/remove", auth.ensure, controller.removeTrader)
    app.get("/trader/:trader_name/deal/:deal_name/remove", auth.ensure, controller.removeDeal)
    app.get("/trader/:trader_name/deal/:deal_name/sell", auth.ensure, controller.sellDeal)
    app.get("/stop", auth.ensure, controller.stop)
    app.get("/value_sheet", auth.ensure, controller.getValueSheet)
    app.get("/start", auth.ensure, controller.start)
    app.get("/shares", auth.ensure, controller.shares)
    app.post("/shares/add", auth.ensure, controller.addShare)


    app.get("/simulator", auth.ensure, controller.simulatorHome)
    app.post("/simulator/save_data_set", auth.ensure, controller.simulatorSave)
    app.get("/simulator/generate", auth.ensure, controller.simulatorGenerate)
    app.get("/simulator/run", auth.ensure, controller.simulatorRun)
    app.get("/simulator/run_series", auth.ensure, controller.simulatorRunSeries)
    app.get("/simulator/load_data_set/:data_set", auth.ensure, controller.simulatorLoad)
    app.get("/simulator/remove_data_set/:data_set", auth.ensure, controller.simulatorRemove)

    app.get("/remove_all_simulator_deals", auth.ensure, controller.simulatorRemoveDeals)      
  }

  var STAMPEDE = Stampede()
  var LOG = STAMPEDE.LOG("app")

  STAMPEDE.initialize()

} ())





