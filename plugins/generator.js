var debug = false;

function generateData() {

  var minute = 60*1000,
      hour = 60*minute,
      day = 24*hour,

      config = {
        time_back: (60*day),
        low_high_window: 24*hour,
        min: process.env.MIN || 10,
        max: process.env.MAX || 2000,
        trend: {
          LT: {
            duration: 14*day,
            impact: 0.03
          },
          MT: {
            duration: 6*hour,
            impact: 0.04
          },
          ST: {
            duration: 1*minute,
            impact: 0.005
          }
        }
      },

    /*

    Need to generate:
      - high (over past 24 hrs)
      - low (over past 24 hrs)
      - last
      - 

    */

  // Initialize array for data and create the first data point
      now = +(new Date()),
      start_time = now - config.time_back,    // Initialize start time 60 days back
      time_point = start_time + 1,            // Initialize first time_point
      data = [{
        high: 500,
        last: 460,
        low: 400,
        time: start_time
      }],
      current_extremes = {
        high: data[0].high,
        low: data[0].low,
        time_low: start_time,
        time_high: start_time
      },
      i = 0,

      // Initialize variables for performance measurements
      extremes_calculation = 0,

      // Initialize variables for trends (LT -> Long term, MT -> Middle term, ST -> Short term)
      trends = [
        {name: "LT"},
        {name: "MT"},
        {name: "ST"}
      ];  

  while (
    //i < 50000 &&
    time_point < now 
  ) {
    
    // We have our first data point already, so iterate right away
    i++;

    // Calculate time shift somewhere btw 5 - 7 seconds
    var time_shift = parseInt((5 + (2 * Math.random())) * 10000),
        // Initialize new data point
        data_point = {},
        previous_data_point = data[data.length-1],
        vector = 1;

    trends.forEach(function(trend) {
      var trend_name = trend.name,
          trend_config = config.trend[trend_name];

      if (
        trend.duration > 0
      ) {
        trend.duration = trend.duration - time_shift;
      } 
      else {
        trend.duration = parseInt(Math.random()*trend_config.duration);
        trend.up = (Math.round(Math.random()) > 0);
        trend.impact = Math.random() * trend_config.impact * (time_shift / trend_config.duration) * (trend.up ? 1 : -1);


        // trend.candidate_target = (1 + trend.impact) * previous_data_point.last;
        // trend.target = (trend.candidate_target > config.max) ? config.max : (trend.candidate_target < config.min ? config.min : trend.candidate_target);
      }

      var future_value = (1 + trend.impact) * previous_data_point.last;
      var direction = (future_value > config.max) ? true : (future_value < config.min ? false : true);
      trend.vector = (trend.impact * (direction ? 1 : -1));
      vector += trend.vector;

    });

    time_point += time_shift;             // Add time shift to current time_point
    data_point.time = time_point;         // Add current time to the data point

    if (debug) console.log("generateData | trends, vector:", trends, vector);

    data_point.last = vector * previous_data_point.last;
    if (debug) console.log("generateData | vector, last:", vector, data_point.last, "at:", time_point);
    data.push(data_point);


    // Time and encapsulate extreme calculation (very costly function)
    var t1 = +(new Date());

    if (
      current_extremes.time_low < (time_point - config.low_high_window) ||
      current_extremes.time_high < (time_point - config.low_high_window)
    ) {
      var borders = findExtremesInRangeByKey(data, config.low_high_window, "last");
      current_extremes.low = borders.min;
      current_extremes.high = borders.max;
      current_extremes.time_high = borders.time_max;
      current_extremes.time_low = borders.time_min;
    }
    else {
      if (data_point.last > current_extremes.high) {
        current_extremes.high = data_point.last;
        current_extremes.time_high = data_point.time;
      }
      if (data_point.last < current_extremes.low) {
        current_extremes.low = data_point.last;
        current_extremes.time_low = data_point.time;
      }

    }
    
    data_point.low = current_extremes.low;
    data_point.high = current_extremes.high;

    var t2 = +(new Date());
    extremes_calculation += (t2-t1);
  }
  var end = +(new Date());

  console.log("generateData (Length:"+data.length+") | took "+((end-now)/1000).toFixed(2)+" seconds (Extremes: "+(extremes_calculation/1000).toFixed(2)+" seconds | "+(extremes_calculation/(end-now)*100).toFixed(2)+"%).");
  return data;

}
  
Array.prototype.calculateVector = function(trends) {
  var vector = 0;

  return vector;
};

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
      };
 
  for (var i = last_position; (i > 0 && data[i].time > range_start); i--) {
    var cur = data[i][key];
    if (
      cur && 
      cur > result.max
    ) {
      result.max = cur;
      result.time_max = data[i].time;
    }
    if (
      cur && 
      cur < result.min
    ) {
      result.min = cur;
      result.time_min = data[i].time;
    }
  }

  if (debug) console.log("findExtremesInRangeByKey | initial_point, data.length, result:", initial_point, data.length, result);

  return result;
};


//if (debug) console.log("GENERATED DATA:\n", generateData());

function binner(data, span, key) {
  var divider = data.length / (span || 1000),
      binned_data = [],
      key = key || "last",
      cursor = {size: 0};

  data.forEach(function(data_point, index) {
    cursor.time = data_point.time;
    cursor[key] = (cursor[key] > 0) ? (cursor[key] + data_point[key]) : data_point[key];
    cursor.size++;

    if (cursor.size > divider) {
      var binned_point = { time: cursor.time };
      binned_point[key] = cursor[key] / cursor.size;
      binned_data.push(binned_point);
      cursor = {size: 0};
    }
  });
  
  if (debug) console.log("binner | binned_data:", binned_data);

  return binned_data;
}

function generateBinnedData(span) {
  var t1 = +(new Date());
  var data = generateData();
  var t2 = +(new Date());

  console.log("generateBinnedData | generate took "+((t2-t1)/1000).toFixed(2)+" seconds.");

  var t3 = +(new Date());
  var binned_data = binner(data, span || 1000, "last");
  var t4 = +(new Date());

  console.log("generateBinnedData | binner took "+((t4-t3)/1000).toFixed(2)+" seconds.");



  return binned_data;
  
}

exports.launch = generateData;
exports.bin = binner;