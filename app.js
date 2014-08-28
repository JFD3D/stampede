
/**
 * Module dependencies.
 */

var express = require('express'),
    http = require('http'),
    path = require('path'),
    redis = require('redis'),
    common = require('./plugins/common'),
    config = require('./configs/config'),
    RedisStore = require('connect-redis')(express),
    sessionStore = new RedisStore(),
    app = express(),
    environment = process.env.NODE_ENV || 'development',
    auth = require('./plugins/authentication'),

    //nasty
    variable_ender;

// all environments
app.configure(function(){
  app.set('port', process.env.PORT || config.port);
  app.set('views', __dirname + '/views');
  app.set('view engine', 'jade');
  app.use(express.logger('dev'));
  app.use(express.favicon());
  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(express.cookieParser('d9aue0c2uq0euc0aw90daspjaxs'+environment+config.exchange.selected));
  app.use(express.session({ secret: 'ss9809s0a0s0s99s8d9s8a9d8s9ad0s98'+environment+config.exchange.selected, store: sessionStore, key: 'stampede-'+environment+config.exchange.selected+'.sid' }));
  
  // Authentication module injection
  auth.initiate(app);

  app.use(app.router);
  app.use(express.static(path.join(__dirname, 'public')));

  // development only
  if ('development' === environment) {
    app.use(express.errorHandler());
  }
});

var controller = require('./routes/controller'),
    live = require('./plugins/live'),
    server = app.listen(app.get('port'), function() {
      console.log('Stampeding at ' + app.get('port') + ' feet.');
      if (
        environment !== "development" && 
        config.exchange.selected !== "simulated_exchange"
      ) controller.wakeTraders();
    });

if (server) {
  live.sockets(app, server);
}

app.get("/", auth.ensure, controller.index);
app.post("/trader/create", auth.ensure, controller.addTrader);
app.post("/trading_config/update", auth.ensure, controller.updateTradingConfig);
app.post("/trading_strategy/update", auth.ensure, controller.updateTradingStrategy);
app.get("/trading_config/reset", auth.ensure, controller.resetTradingConfig);
app.get("/trader/:trader_name/remove", auth.ensure, controller.removeTrader);
app.get("/trader/:trader_name/deal/:deal_name/remove", auth.ensure, controller.removeDeal);
app.get("/trader/:trader_name/deal/:deal_name/sell", auth.ensure, controller.sellDeal);
app.get("/stop", auth.ensure, controller.stop);
app.get("/value_sheet", auth.ensure, controller.getValueSheet);
app.get("/start", auth.ensure, controller.start);
app.get("/shares", auth.ensure, controller.shares);
app.post("/shares/add", auth.ensure, controller.addShare);


app.get("/simulator", auth.ensure, controller.simulatorHome);
app.post("/simulator/save_data_set", auth.ensure, controller.simulatorSave);
app.get("/simulator/generate", auth.ensure, controller.simulatorGenerate);
app.get("/simulator/run", auth.ensure, controller.simulatorRun);
app.get("/simulator/run_series", auth.ensure, controller.simulatorRunSeries);
app.get("/simulator/load_data_set/:data_set", auth.ensure, controller.simulatorLoad);
app.get("/simulator/remove_data_set/:data_set", auth.ensure, controller.simulatorRemove);

app.get("/remove_all_simulator_deals", auth.ensure, controller.simulatorRemoveDeals);