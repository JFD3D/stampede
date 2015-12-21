'use strict'

module.exports = _S => {
  
  let _   = require('underscore')

  _.extend(_S, {
    perf_timers     : {},
    role            : _S.role || 'server',
    name            : 'stampede',
    environment     : (process.env.NODE_ENV || 'development'),
    config          : require(_S.dir + '/configs/config'),

    // Load shareable dependencies
    MA              : require('moving-average'),
    moment          : require('moment'),
    redis           : require('redis'),
    async           : require('async'),
    jade            : require('jade'),
    _               : _,

    // Array of plugins that will be loaded
    // ORDER is important
    plugins         : [
      'common',
      'auth',
      'email',
      'generator',
      'helpers',
      'live',
      'simulator',
      'data_loader'
    ],

    // Array of routers
    models          : [
      'market',
      'wallet',
      'book',
      'trader',
      'series'
    ],

    module_types    : [
      'plugins',
      'models'
    ],

    // Because of scope, we keep this without arrows
    LOG: function(module_name) {
      // Assign default logging function to each module and plugin     
      return (function() {
        let args = Array.prototype.slice.call(arguments)
        args.unshift(module_name.toUpperCase() + '(' + process.pid + '):')
        console.log.apply(null, args)
      })
    },

    /// App initialization functions
    // Initialize the application components based on the role

    init: () => {
      initializeRedisConnection()
      initializeExchange()
      loadDependencies()
      instantiateSimulator()

      if (_S.role === 'server') {
        setupWebApplication()
        initiateAuthentication()
        assignRoutes()
        startListening()
        initiateLiveCommunication()
      }

      return _S
    }

  })

  function initializeRedisConnection() {
    _S.db = _S.redis.createClient(_S.config.redis_port || 6379)
  }

  function loadDependencies () {
    _S.module_types.forEach(initializeModuleType)
  }

  function instantiateSimulator() {
    _S.current_simulator = new _S.simulator()
  }

  function initializeExchange() {
    let config      = _S.config
    let Exchange    = require(_S.dir + '/exchanges/' + config.exchange.selected)
    let credentials = config.credentials[config.exchange.selected]

    _S.ExchangeInstance   = Exchange
    _S.exchange_simulated = (config.exchange.selected === 'simulated_exchange')
    _S.exchange           = 
      new Exchange(credentials.key, credentials.secret, credentials.client_id)
  }

  function initializeModuleType(type) {
    
    _S[type].forEach(function(module_name) {
      var module_loaded = require(_S.dir + '/' + type + '/' + module_name)
      var module_initialized = module_loaded(_S)
      _S[module_name] = module_initialized
    })
  }

  function initiateAuthentication() {
    // Authentication module injection
    _S.auth.initiate(_S.app)
  }

  function setupWebApplication() {
    var express         = require('express')
    var morgan          = require('morgan')
    var http            = require('http')
    var path            = require('path')
    var session         = require('express-session')
    var cookieParser    = require('cookie-parser')
    var bodyParser      = require('body-parser')
    var favicon         = require('serve-favicon')
    var methodOverride  = require('method-override')
    var RedisStore      = require('connect-redis')(session)
    var multer          = require('multer')

    var app             = express()
    var config          = _S.config
    var environment     = _S.environment

    app.use(morgan('dev', { skip: (req, res) => res.statusCode === 304 }))

    // all environments
    app.use(express.static(path.join(_S.dir, 'public')))
    app.use(methodOverride())
    app.use(cookieParser())
    app.use(bodyParser.json())
    app.use(bodyParser.urlencoded({ extended: true }))
    app.use(multer({ dest: '/tmp' }))
    app.use(session({ 
      key               : _S.name + '-' + environment + '.sid',
      store             : new RedisStore(), 
      secret            : (config.session_secret + environment),
      saveUninitialized : true,
      resave            : true
    }))
    app.use(favicon(_S.dir + '/public/images/favicon.ico'))
    app.set('views', _S.dir + '/views')
    app.set('view engine', 'jade')
    app.set('port', config.port)

    _S.app                = app
  }

  function startListening() {
    _S.server = _S.app.listen(_S.app.get('port'), () => {
      if (
        _S.environment !== 'development' && 
        _S.config.exchange.selected !== 'simulated_exchange'
      ) _S.controller.wakeTraders()
    })
  }
    
  function initiateLiveCommunication() {
    if (_S.server) {
      _S.live.sockets(_S.app, _S.server)
    }
  }

  function assignRoutes() {
    var app     = _S.app
    var auth    = _S.auth
    var enAuth  = auth.ensure
    var Con

    // Load route controller
    _S.controller = require(_S.dir + '/routes/controller')(_S)
    Con           = _S.controller
    // Assign common formatting functions
    app.use((req, res, next) => {
      res.locals.formatter = _S.common.formatter
      return next()
    })

    app.get('/', enAuth, Con.index)
    app.post('/trader/create', enAuth, Con.addTrader)
    app.post('/trading_config/update', enAuth, Con.updateTradingConfig)
    app.post('/trading_strategy/update', enAuth, Con.updateTradingStrategy)
    app.get('/trading_config/reset', enAuth, Con.resetTradingConfig)
    app.get('/trader/:trader_name/remove', enAuth, Con.removeTrader)
    app.get('/trader/:trader_name/deal/:deal_name/remove', enAuth, Con.removeDeal)
    app.get('/trader/:trader_name/deal/:deal_name/sell', enAuth, Con.sellDeal)
    app.get('/stop', enAuth, Con.stop)
    app.get('/value_sheet', enAuth, Con.getValueSheet)
    app.get('/start', enAuth, Con.start)
    app.get('/shares', enAuth, Con.shares)
    app.post('/shares/add', enAuth, Con.addShare)
    app.get('/simulator', enAuth, Con.simulatorHome)
    app.get('/data_loader', enAuth, Con.dataLoader)
    app.post('/simulator/save_data_set', enAuth, Con.simulatorSave)
    app.get('/simulator/generate', enAuth, Con.simulatorGenerate)
    app.get('/simulator/run', enAuth, Con.simulatorRun)
    app.get('/simulator/run_series', enAuth, Con.simulatorRunSeries)
    app.get('/simulator/series', enAuth, Con.factoryRunSeries)
    app.post('/simulator/switch_set_inclusion', enAuth, Con.switchSetInclusion)
    app.get('/simulator/load_data_set/:data_set', enAuth, Con.simulatorLoad)
    app.get('/simulator/remove_data_set/:data_set', enAuth, Con.simulatorRemove)
    app.get('/remove_all_simulator_deals', enAuth, Con.simulatorCleanUp)
    app.post('/load_trade_history', enAuth, Con.loadTradeHistory)    
  }  

  return _S

}