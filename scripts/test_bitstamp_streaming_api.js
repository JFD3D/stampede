// Test pusher client for bitstamp streaming API

var Pusher = require('pusher-client')
var pusher = new Pusher("de504dc5763aeef9ff52")
var trades_channel = pusher.subscribe('live_trades')
var i = 0

trades_channel.bind('trade', function(data) {
    i++
    console.log("incoming:", data)

    if (i > 100) process.exit(0)
});