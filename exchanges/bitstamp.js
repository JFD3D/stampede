// Reuse wrapper from https://github.com/askmike/bitstamp
// Create ticker from bitstamp streaming API

var Exchange = require("bitstamp")
var trades_channel

Exchange.prototype.startTicking = function() {
  var me = this
  var Pusher = require("pusher-client")
  var pusher = new Pusher("de504dc5763aeef9ff52")
  var events = require("events")
  var Ticker = new events.EventEmitter()

  trades_channel = pusher.subscribe("live_trades")
  me.tickEmitter = Ticker
  trades_channel.bind("trade", function(data) {
    console.log("incoming:", data)
    Ticker.emit("tick", data)
  })
}


Exchange.prototype.stopTicking = function() {
  trades_channel.unbind("trade")
}


module.exports = Exchange