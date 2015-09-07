// -- gets the trade history for last 150 days
// http://api.bitcoincharts.com/v1/trades.csv?symbol=bitstampUSD&start=1426407713

module.exports = function(STAMPEDE) {
  
  // Plugins
  var common    = STAMPEDE.common
  var LOG       = STAMPEDE.LOG("data_loader")
  var generator = STAMPEDE.generator
  var simulator = STAMPEDE.simulator

  // Node modules
  var http      = require("http")
  var fs        = require("fs")
  var Reader    = require("fast-csv")

  // Constants
  var BASE_URL  = 
      "http://api.bitcoincharts.com/v1/trades.csv?symbol=bitstampUSD&start="

  function load(options, done) {
    var day_span = options.day_span || 90
    var span_start = (Date.now() - (day_span * common.time.day))
    var span_start_unix = parseInt(span_start / 1000)
    var url = BASE_URL + span_start_unix
    var start_point_time
    var current_extremes
    var data = []
    var point_count = 0


    var csvStream = 
      Reader()
        .on("data", function(data_point) {

          var time = (parseInt(data_point[0]) * 1000)
          var last = parseFloat(data_point[1])
          var point = {
            time: time,
            last: last
          }
          
          if (time > span_start) {
            point_count ++
            if (point_count % 10000 === 0) 
              LOG("--- loading point (" + point_count + ")")
            if (!start_point_time) {
              start_point_time = time
              current_extremes = {
                high: last,
                low: last,
                time_low: time,
                time_high: time
              }
            }
            

            data.push(point)
            generator.assignExtremes(current_extremes, data, point, time)          
          }
        })
        .on("end", function() {
          return done(null, {
            data: data,
            day_span: day_span,
            start_point_time: start_point_time
          })
        })
    
    if (
      options.req.files && 
      options.req.files.data_file &&
      options.req.files.data_file.path
    ) {
      LOG("getting file, req.files:", options.req.files)
      var read_stream = fs.createReadStream(options.req.files.data_file.path)

      read_stream.pipe(csvStream)
    }
    else {
      LOG("load | url, span start, span_start_unix:", url, new Date(span_start), span_start_unix)
      http.get(url, function(res) {
        res.pipe(csvStream)
      })
    }

  }

  return {
    load: load
  }
}