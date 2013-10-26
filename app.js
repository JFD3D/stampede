
/**
 * Module dependencies.
 */

var express = require('express'),
    http = require('http'),
    path = require('path'),
    redis = require('redis'),
    common = require('./plugins/common'),
    config = require('./plugins/config'),
    RedisStore = require('connect-redis')(express),
    sessionStore = new RedisStore(),
    app = express(),
    environment = process.env.NODE_ENV || 'development',
    auth = require('./plugins/authentication')
;

// all environments
app.configure(function(){
  app.set('port', process.env.PORT || config.port);
  app.set('views', __dirname + '/views');
  app.set('view engine', 'jade');
  app.use(express.favicon());
  app.use(express.logger('dev'));
  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(express.cookieParser('d9aue0c2uq0euc0aw90daspjaxs'));
  app.use(express.session());
  
  // Authentication module injection
  auth.initiate(app);

  app.use(app.router);
  app.use(express.static(path.join(__dirname, 'public')));
  app.use(express.session({ secret: '9s98dd8d8s99cs9s9a9a9s88d'+environment, store: sessionStore, key: 'stampede-'+environment+'.sid' }));

  // development only
  if ('development' === environment) {
    app.use(express.errorHandler());
  }
});

var controller = require('./routes/controller'),
    live = require('./plugins/live'),
    server = app.listen(app.get('port'), function() {
      console.log('Stampeding at ' + app.get('port') + ' feet.');
    });

if (server) {
  live.sockets(app, server);
  controller.wakeTraders(function(live_traders) {
    app.set("live_traders", live_traders);
    //console.log("Traders are now awake | live_traders:", live_traders);
  });
}

app.get("/", auth.ensure, controller.index);
app.post("/trader/create", auth.ensure, controller.addTrader);
app.get("/trader/:trader_name/remove", auth.ensure, controller.removeTrader);


