var START = (function() {

  var STAMPEDE = {
    perf_timers: {},
    name: "stampede",
    environment: (process.env.NODE_ENV || 'development'),
    config: require("./configs/config"),

    // Load shareable dependencies
    MA: require("moving-average"),
    moment: require("moment"),
    async: require("async"),
    jade: require("jade"),
    _: require("underscore"),

    // Array of plugins that will be loaded
    // ORDER is important
    plugins: [
      "common",
      "auth",
      "email",
      "generator",
      "helpers",
      "live",
      "simulator"
    ],

    // Array of routers
    models: [
      "market",
      "wallet",
      "trader",
      "cycle"
    ],

    LOG: function(module_name) {
      // Assign default logging function to each module and plugin     
      return (function() {
        var args = Array.prototype.slice.call(arguments)
        args.unshift(module_name.toUpperCase() + "(" + process.pid + "):")
        console.log.apply(null, args)
      })
    },

    // Initialize the application components, order 
    initialize: function() {
      connectDatabase()
      setupApplication()
      loadDependencies()
      initializeExchange()
      initiateAuthentication()
      assignRoutes()
      initiateLiveCommunication()
    }
  }

  var LOG = STAMPEDE.LOG("app")

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
        require("./exchanges/" + config.exchange.selected)
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
    var Con = STAMPEDE.controller
    var auth = STAMPEDE.auth
    var enAuth = auth.ensure


    // Assign common formatting functions
    app.use(function(req, res, next) {
      res.locals.formatter = STAMPEDE.common.formatter
      next()
    })

    app.get("/", enAuth, Con.index)
    app.post("/trader/create", enAuth, Con.addTrader)
    app.post("/trading_config/update", enAuth, Con.updateTradingConfig)
    app.post("/trading_strategy/update", enAuth, Con.updateTradingStrategy)
    app.get("/trading_config/reset", enAuth, Con.resetTradingConfig)
    app.get("/trader/:trader_name/remove", enAuth, Con.removeTrader)
    app.get("/trader/:trader_name/deal/:deal_name/remove", enAuth, Con.removeDeal)
    app.get("/trader/:trader_name/deal/:deal_name/sell", enAuth, Con.sellDeal)
    app.get("/stop", enAuth, Con.stop)
    app.get("/value_sheet", enAuth, Con.getValueSheet)
    app.get("/start", enAuth, Con.start)
    app.get("/shares", enAuth, Con.shares)
    app.post("/shares/add", enAuth, Con.addShare)
    app.get("/simulator", enAuth, Con.simulatorHome)
    app.post("/simulator/save_data_set", enAuth, Con.simulatorSave)
    app.get("/simulator/generate", enAuth, Con.simulatorGenerate)
    app.get("/simulator/run", enAuth, Con.simulatorRun)
    app.get("/simulator/run_series", enAuth, Con.simulatorRunSeries)
    app.get("/simulator/load_data_set/:data_set", enAuth, Con.simulatorLoad)
    app.get("/simulator/remove_data_set/:data_set", enAuth, Con.simulatorRemove)
    app.get("/remove_all_simulator_deals", enAuth, Con.simulatorRemoveDeals)      
  }

  
  STAMPEDE.initialize()

} ())





