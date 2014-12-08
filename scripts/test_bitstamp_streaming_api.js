// Test pusher client for bitstamp streaming API

var Pusher = require('pusher-client')
var pusher = new Pusher("de504dc5763aeef9ff52")
var trades_channel = pusher.subscribe('live_trades')
var i = 0
var start = Date.now()

trades_channel.bind('trade', function(data) {
    i++
    var average_point_width = ((Date.now() - start) / (i * 1000))
    console.log("incoming:", data, "\naverage_point_width:", average_point_width.toFixed(2), "seconds.")

    if (i > 100) process.exit(0)
});