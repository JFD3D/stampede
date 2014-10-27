module.exports = function(STAMPEDE) {
  var live = {}


  var sio = require('socket.io')
  var redis = require('redis')
  var db = STAMPEDE.db
  var io
  var connected_count = 0
  var controller = STAMPEDE.controller

  live.sockets = sockets;
  live.sendToAll = sendToAll;


  function sockets(app, server) {
    io = sio.listen(server);
    var RedisStore = require('socket.io/lib/stores/redis')
      , pub    = redis.createClient()
      , sub    = redis.createClient()
      , client = redis.createClient();

    io.set('store', new RedisStore({
      redisPub : pub
    , redisSub : sub
    , redisClient : client
    }));
    
    io.enable('browser client minification');  // send minified client
    io.enable('browser client etag');          // apply etag caching logic based on version number
    io.enable('browser client gzip');          // gzip the file
    io.set('log level', 1);                    // reduce logging
    
    // Server listeners
    io.sockets.on('connection', function (socket) {
      socket.on("disconnect", function () {
        console.log("Client disconnected.");
      });
      socket.on("reconnect", function () {
        console.log("Client reconnected.");
      });
      socket.on("request", function(incoming, respond) {
        console.log(incoming);
        if (
          incoming.action &&
          controller[incoming.action] !== undefined
        ) {
          controller[incoming.action](function(error, data) {
            (error) ? respond({
              errors: error
            }) : respond(data);
          });
        }
      });
    });
  };

  function sendToAll(channel, data) {
    io.sockets.emit(channel, data);
  }

  function send(socket_id, content) {
    io.sockets.socket(socket_id).emit('stampede_updates', content);
  }

  return live
}

