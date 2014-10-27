module.exports = function(STAMPEDE) {
  
  var debug = false
  var generator = {}
  var minute = 60*1000
  var hour = 60*minute
  var day = 24*hour
  var config = {
        time_back: (30*day),
        low_high_window: 24*hour,
        min: 10,
        max: 2000,
        trend: {
          LT: {
            duration: 14*day,
            impact: 0.05
          },
          MT: {
            duration: 6*hour,
            impact: 0.02
          },
          ST: {
            duration: 1*minute,
            impact: 0.005
          }
        }
      }
      // Initialize variables for performance measurements
  var extremes_calculation = 0

      // Initialize variables for trends (LT -> Long term, MT -> Middle term, ST -> Short term)
  var trends = [
        {name: "LT"},
        {name: "MT"},
        {name: "ST"}
      ] 


  function generateData() {

      /*

      Need to generate:
        - high (over past 24 hrs)
        - low (over past 24 hrs)
        - last
        - 

      */

    // Initialize array for data and create the first data point
    var now = Date.now(),
        start_time = now - config.time_back,    // Initialize start time 60 days back
        time_point = start_time + 1,            // Initialize first time_point
        data = [initializeStartPoint(start_time)],
        current_extremes = initializeCurrentExtremes(data, start_time),
        i = 0 

    while (
      //i < 50000 &&
      time_point < now 
    ) {
      
      // We have our first data point already, so iterate right away
      i++

      if (i % 10000 === 0) {
        console.log(
          "Generating " + i + 
          ". data point datetime: " + new Date(time_point) + "."
        )
      }
      // Calculate time shift somewhere btw 5 - 7 seconds
      var time_shift = parseInt(
            (5 + (2 * Math.random())) * 10000
          ), // <<<<< if (10000), THIS is FORCED DATA THINNING!!! BAD

          // Initialize new data point
          previous_data_point = data[data.length-1],
          data_point = initializeDataPoint(time_point, time_shift, previous_data_point)

      data.push(data_point)

      // Time and encapsulate extreme calculation (very costly function)
      var t1 = Date.now()
      assignExtremes(current_extremes, data, data_point, time_point)
      var t2 = Date.now()
      extremes_calculation += (t2 - t1)
      // Add time shift to current time_point
      time_point += time_shift             
    }
    var end = Date.now()

    console.log("generateData (Length:"+data.length+") | took "+((end-now)/1000).toFixed(2)+" seconds (Extremes: "+(extremes_calculation/1000).toFixed(2)+" seconds | "+(extremes_calculation/(end-now)*100).toFixed(2)+"%).")
    return data

  }

  function initializeStartPoint(start_time) {
    return {
      high: 490,
      last: 460,
      low: 455,
      time: start_time || Date.now()
    }    
  }

  function initializeCurrentExtremes(data, start_time) {
    return {
        high: data[0].high,
        low: data[0].low,
        time_low: start_time,
        time_high: start_time
    }    
  }

  function assignExtremes(current_extremes, data, data_point, time_point) {
    if (
      current_extremes.time_low < (time_point - config.low_high_window) ||
      current_extremes.time_high < (time_point - config.low_high_window)
    ) {
      var borders = findExtremesInRangeByKey(data, config.low_high_window, "last")
      current_extremes.low = borders.min
      current_extremes.high = borders.max
      current_extremes.time_high = borders.time_max
      current_extremes.time_low = borders.time_min
    }
    else {
      if (data_point.last > current_extremes.high) {
        current_extremes.high = data_point.last
        current_extremes.time_high = data_point.time
      }
      if (data_point.last < current_extremes.low) {
        current_extremes.low = data_point.last
        current_extremes.time_low = data_point.time
      }
    }
    
    data_point.low = current_extremes.low
    data_point.high = current_extremes.high
  }

  function initializeDataPoint(time_point, time_shift, previous_data_point) {
    var data_point = {},
        vector = 1

    trends.forEach(function(trend) {
      var trend_name = trend.name,
          trend_config = config.trend[trend_name]

      if (
        trend.duration > 0
      ) {
        trend.duration = trend.duration - time_shift
      } 
      else {
        trend.duration = parseInt(Math.random()*trend_config.duration)
        trend.up = (Math.round(Math.random()) > 0)
        trend.impact = Math.random() * trend_config.impact * (time_shift / trend_config.duration) * (trend.up ? 1 : -1)


        // trend.candidate_target = (1 + trend.impact) * previous_data_point.last
        // trend.target = (trend.candidate_target > config.max) ? config.max : (trend.candidate_target < config.min ? config.min : trend.candidate_target)
      }

      var future_value = (1 + trend.impact) * previous_data_point.last
      var direction = (future_value > config.max) ? true : (future_value < config.min ? false : true)
      trend.vector = (trend.impact * (direction ? 1 : -1))
      vector += trend.vector

    })

    data_point.time = time_point         // Add current time to the data point

    if (debug) console.log("generateData | trends, vector:", trends, vector)

    data_point.last = vector * previous_data_point.last
    if (debug) {
      console.log(
        "generateData | vector, last:", 
        vector, data_point.last, "at:", time_point
      )
    }
    return data_point   
  }

  function findExtremesInRangeByKey(data, range, key) {

   /*   First, isolate range, we start from end, since we are looking for the latest range of data
    *   
    *   We assume: 
    *   1. This is time series data
    *   2. The data is sorted by start > end (starting with first/oldest time point and ending with latest)
    */

    var last_position = data.length-1,
        initial_point = data[last_position],
        range_start = initial_point.time - range,
        result = {
          min: initial_point[key],
          max: initial_point[key],
          time_min: initial_point.time,
          time_max: initial_point.time
        }
   
    for (var i = last_position; (i > 0 && data[i].time > range_start); i--) {
      var cur = data[i][key]
      if (
        cur && 
        cur > result.max
      ) {
        result.max = cur
        result.time_max = data[i].time
      }
      if (
        cur && 
        cur < result.min
      ) {
        result.min = cur
        result.time_min = data[i].time
      }
    }

    if (debug) {
      console.log(
        "findExtremesInRangeByKey | initial_point, data.length, result:", 
        initial_point, data.length, result
      )
    }

    return result
  }


  //if (debug) console.log("GENERATED DATA:\n", generateData())

  function binner(data, span, key) {
    var divider = data.length / (span || 1000),
        binned_data = [],
        key = key || "last",
        cursor = {size: 0}

    data.forEach(function(data_point, index) {
      cursor.time = data_point.time
      cursor[key] = (cursor[key] > 0) ? (cursor[key] + data_point[key]) : data_point[key]
      cursor.size++

      if (cursor.size > divider) {
        var binned_point = { time: cursor.time }
        binned_point[key] = cursor[key] / cursor.size
        binned_data.push(binned_point)
        cursor = {size: 0}
      }
    })
    
    if (debug) console.log("binner | binned_data:", binned_data)

    return binned_data
  }  

  generator.launch = generateData
  generator.bin = binner
  generator.initializeStartPoint = initializeStartPoint
  generator.assignExtremes = assignExtremes
  generator.initializeDataPoint = initializeDataPoint
  generator.initializeCurrentExtremes = initializeCurrentExtremes

  return generator
}



