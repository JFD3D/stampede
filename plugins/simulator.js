var Trader = require("./../models/trader"),
    db = require("redis").createClient(6379),
    config = Trader.config,
    controller = require("./../routes/controller"),
    common = require("./common"),
    xc = config.exchange.currency,
    data_sets_repo = "stampede_data_sets";

function Simulator() {
  this.loaded_data_sets = [];
  this.current = {};
  this.series_simulation = false;
}

Simulator.prototype = {
  run: function(callback) {
    var sim = this;
    Trader.prepareForSimulation(sim.series_simulation);
    Trader.viewTraders(Trader.removeAllDeals);
    setTimeout(Trader.wakeAll, 3000);
    if (callback) callback({
      message: "Started Market simulation."
    });
  },

  saveSet: function(data, callback) {
    var sim = this,
        data_length = data.length,
        data_set_name = "stampede_data_set_"+common.timeLabel(),
        mdb = db.multi();

    db.sadd(data_sets_repo, data_set_name, function(error, response) {
      mdb.hset(data_set_name, "length", data_length);
      data.forEach(function(data_point, point_index) {
        //"#{point_index}":"#{last}|#{high}|#{low}|#{time}"
        var data_point_string = 
            data_point.last + "|" + 
            data_point.high + "|" + 
            data_point.low + "|" + 
            data_point.time;

        mdb.hset(data_set_name, point_index.toString(), data_point_string);
      });

      mdb.exec(function(errors, responses) {
        sim.current.data_set_name = data_set_name;
        sim.loadAllSets(callback);
      });
    });
  },
  loadAllSets: function(callback) {
    var sim = this;
    db.smembers(data_sets_repo, function(error, data_sets) {
      if (data_sets.length > 0) sim.loaded_data_sets = data_sets;
      controller.refreshSimulationSets(data_sets);
      if (callback) callback(error, data_sets);
    });
  },

  removeSet: function(data_set_name, callback) {
    var sim = this;
    db.srem(data_sets_repo, data_set_name);
    db.hdel(data_set_name, function(error, response) {
      sim.loadAllSets(callback);
      sim.resetDataSet();
    });
  },
  loadSet: function(data_set_name, callback) {
    var sim = this,
        i = 0,
        set = [];
    db.hgetall(data_set_name, function(error, data_set_hash) {

      do {
        var data_point_string = data_set_hash[i.toString()];
        if (data_point_string) {
          var data_point_arrayed = data_point_string.split("|");
          set.push({
            last: parseFloat(data_point_arrayed[0]),
            high: parseFloat(data_point_arrayed[1]),
            low: parseFloat(data_point_arrayed[2]),
            time: parseInt(data_point_arrayed[3])
          });
        }
        i++;
      } while (data_point_string);
      sim.current.data_set_name = data_set_name;
      callback(error, set);
    });
  },

  // Record results in redis for analysis
  // Trigger check if series is running that dataset has been finished
  // If we have worked with a stored data set
  finish: function(current_market, current_wallet) {
    var sim = this;
    console.log(
      "Ended simulation | current_market, current_wallet:", 
      current_market, current_wallet
    );

    var final_ratio = parseInt(
      (current_wallet.currency_value / config.trading.maximum_investment) * 100
    );
    controller.notifyClient({
      message: "Serie ("+
        ( 
          sim.current.series_array ? 
          (
            sim.current.series_array[sim.current.serie_index] + " / " + 
            sim.current.series_array.length
          ) : 
          "Interactive"
        ) + ") | Ratio: " + final_ratio + ".", 
      permanent: true
    });

    if (sim.series_simulation) {
      // Now record results of simulation (start value, options, end value);
      var result = [{
        value: sim.current.data_set_name, 
        field: "data_set", 
        type: "data_sets"
      }];

      sim.current.series_attributes.forEach(function(serie_attribute) {
        var serie_attribute_arrayed = serie_attribute.split(":");
        if (serie_attribute_arrayed[0] !== "data_sets") {
          var item = {};
          item.value = 
            config[serie_attribute_arrayed[0]][serie_attribute_arrayed[1]];
          item.type = [serie_attribute_arrayed[0]];
          item.field = [serie_attribute_arrayed[1]]
          result.push(item);
        }
      });

      result.push({
        value: final_ratio,
        type: "ratio",
        field: "ratio"
      });


      sim.current.series_results.push(result);
      controller.refreshSimulationResults(
        sim.current.series_results.sort(function(a, b) { 
          return b[b.length-1].value - a[a.length-1].value;
        }));
      sim.current.serie_index++;
      if (sim.current.series_array.length > sim.current.serie_index) {
        // Continue with next simulation
        console.log("Continuing with next serie ("+sim.current.serie_index+").");
        sim.processSerie();
      }
      else {
        // End simulation series
        sim.series_simulation = false;
        console.log("!!!!!!! Series simulations ended.");
      }
    }
    else {
      console.log("Finishing interactive simulation, refreshing all.");
      Trader.refreshAll();
    }
  },

  resetDataSet: function() {
    if (this.current.data_set_name) delete this.current.data_set_name;
  },

  startSeries: function() {
    var sim = this,
        series_config = require("./../configs/series/series_config").series,
        series_array = [],
        series_attributes = ["data_sets:data_set"],
        series_options = [[]];

    console.log("entering startSeries.");

    db.smembers(data_sets_repo, function(errors, data_sets) {
      
      series_config.data_sets = data_sets || [];

      series_config.data_sets.forEach(function(data_set_name, set_index) { 
        series_options[0].push(set_index);
      });

      for (var setting in series_config.trading) {
        series_attributes.push("trading:"+setting);
        var setting_array = [];
        series_config.trading[setting].forEach(function(option, option_index) {
          setting_array.push(option_index);
        });
        series_options.push(setting_array);
      }

      for (var strategy in series_config.strategies) {
        series_attributes.push("strategy:"+strategy);
        var setting_array = [];
        series_config.strategies[strategy].forEach(function(option, option_index) {
          setting_array.push(option_index);
        });
        series_options.push(setting_array);
      }

      console.log(
        "series_options, series_attributes:", 
        series_options, series_attributes
      );

      // Now combine options

      var series_array = cartesian(series_options);

      console.log("series_array.length:", series_array.length);
      sim.current.serie_index = 0;
      sim.current.series_array = series_array;
      sim.current.series_attributes = series_attributes;
      sim.current.series_config = series_config;
      sim.current.series_results = [];
      sim.series_simulation = true;
      
      sim.processSerie();
    });


  },


  processSerie: function() {
    var sim = this,
        serie_options = sim.current.series_array[sim.current.serie_index],
        serie_data_set_name = 
          sim.current.series_config.data_sets[serie_options[0]];

    sim.applySerieConfig();
    sim.loadSerieSet(serie_data_set_name, function(error, set) {
      controller.simulatorWarmUp(set);
      sim.run();
    });
  },

  applySerieConfig: function() {
    var sim = this,
        serie_config = sim.current.series_config,
        serie_options = sim.current.series_array[sim.current.serie_index],
        s = 0;

    for (var setting in serie_config.trading) {
      // Read settings from 1, since we are applying in order after data sets
      s++;
      config.trading[setting] = serie_config.trading[setting][serie_options[s]];
    }
    for (var strategy in serie_config.strategies) {
      s++;
      config.strategy[strategy] = 
        serie_config.strategies[strategy][serie_options[s]];
    }

    console.log(
      "applySerieConfig | serie_options, config.trading, config.strategy:", 
      serie_options, config.trading, config.strategy
    );
  },

  loadSerieSet: function(serie_data_set_name, callback) {
    var sim = this;
    if (serie_data_set_name === sim.current.data_set_name) {
      callback(null, controller.generated_data);
    }
    else {
      console.log("Loading series set:", serie_data_set_name);
      sim.loadSet(serie_data_set_name, callback);
    }
  }
};

module.exports = Simulator;


function cartesian(arg) {
  var r = [], max = arg.length-1;
  function helper(arr, i) {
    for (var j=0, l=arg[i].length; j<l; j++) {
      var a = arr.slice(0); // clone arr
      a.push(arg[i][j])
      if (i==max) {
        r.push(a);
      } else
        helper(a, i+1);
    }
  }
  helper([], 0);
  return r;
};

