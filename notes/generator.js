
function generateData() {
  var minute = 60*1000,
      hour = 60*minute,
      day = 24*hour,
      config = {
        time_back: (1*day),
        min: process.env.MIN || 10,
        max: process.env.MAX || 2000,
        trend: {
          LT: {
            duration: 30*day,
            impact: 0.9
          },
          MT: {
            duration: 6*hour,
            impact: 0.7
          },
          ST: {
            duration: 2*minute,
            impact: 0.3
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
      i = 0,

      // Initialize variables for trends (LT -> Long term, MT -> Middle term, ST -> Short term)
      trends = [
        {name: "LT"},
        {name: "MT"},
        {name: "ST"}
      ];  

  while (time_point < now) {
    
    // We have our first data point already, so iterate right away
    i++;

    // Calculate time shift somewhere btw 5 - 7 seconds
    var time_shift = (5 + (2 * Math.random())) * 1000,
        // Initialize new data point
        data_point = {},
        vector = 0;

    trends.forEach(function(trend) {
      var trend_name = trend.name,
          trend_config = config.trend[trend_name];

      if (
        trend.duration > 0 && 
        trend.target && 
        trend.impact
      ) {
        trend.duration = trend.duration - time_shift;
      } 
      else {
        trend.duration = (Math.random()*trend_config.duration);
        trend.impact = (1 - (Math.random()*2)) * trend_config.impact);
        trend.target = trend.impact * data[data.length-1].last;
      }

      trend.vector = 1 - (data[data.length -1].last / trend.target);
      vector += trend.vector;
    });

    time_point += time_shift;             // Add time shift to current time_point
    data_point.time = time_point;         // Add current time to the data point
    
    data_point.last = vector * data[data.length-1].last;

    data.push(data_point);
    var borders = findExtremesInRangeByKey(data, 24*hour, "last");
    data_point.high = borders.max;
    data_point.low = borders.min;
  }

}
  
Array.prototype.calculateVector = function(trends) {
  var vector = 0;

  return vector;
};

var findExtremesInRangeByKey = function(data, range, key) {

 /*   First, isolate range, we start from end, since we are looking for the latest range of data
  *   
  *   We assume: 
  *   1. This is time series data
  *   2. The data is sorted by start > end (starting with first/oldest time point and ending with latest)
  */

  var initial_value = data[data.length-1][key],
      range_start = initial_value.time - range,
      result = {
        min: initial_value,
        max: initial_value
      };

  for (var i=data.length; data[i].time > range_start; i--) {
    var cur = data[i][key];
    if (
      cur && 
      cur > result.max
    ) result.max = cur;
    if (
      cur && 
      cur < result.min
    ) result.min = cur;
  }
  return result_array
};


// Find within hash that has keys as stringed integers
var findBordersByKey = function (data, key) {
  var result_array = [];



};