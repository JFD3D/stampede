module.exports = function(STAMPEDE) {

  var db = STAMPEDE.db
  var config = STAMPEDE.config
  var common = STAMPEDE.common
  var xc = config.exchange.currency
  var data_sets_repo = "stampede_data_sets"
  var LOG = STAMPEDE.LOG("simulator")
  var _ = STAMPEDE._
  var async = STAMPEDE.async

  function Simulator() {
    this.loaded_data_sets = []
    this.current = {}
    this.series_simulation = false
  }

  function Set(name, optional_ui_name) {

    name = name || ("stampede_data_set_" + Date.now())

    var csv_file_name = name + ".csv"
    var csv_file_path = (
            STAMPEDE.config.data_set_directory || "/var/stampede_data_sets/"
          ) + csv_file_name

    this.name = name
    this.optional_ui_name = optional_ui_name
    this.optional_name_key = "stampede_set_name:" + name
    this.headers = ["time", "high", "low", "last"]
    this.csv_file_name = csv_file_name
    this.csv_file_path = csv_file_path
  }

  Set.prototype = {
    save: function(data, callback) {
      var set = this
      var start_time = Date.now()
      var data_length = data.length

      db.sadd(data_sets_repo, set.name, function(error, response) {
        var csv_content = common.generateCSV(
              data, set.headers, true
            )
        // Save separate (no need to wait, the filing will take a lot longer ?)
        if (set.optional_ui_name && set.optional_ui_name.length) {
          db.set(set.optional_name_key, set.optional_ui_name)
        }
        common.fileTo(set.csv_file_path, csv_content, function(error_writing) {
          common.timer(start_time, "saveSet(" + data_length + ")")
          if (callback) {
            return callback()
          }
        })
      })      
    },

    load: function(callback) {
      var set = this
      LOG("set.load | set.name:", set.name)
      common.loadCSV(set.csv_file_path, function(row) {
        var time = parseInt(row[0])
        return (time > 0 ? {
          time: parseInt(row[0]),
          high: parseFloat(row[1]),
          low: parseFloat(row[2]),
          last: parseFloat(row[3])
        } : null)
      }, callback)
    },

    getUIName: function(callback) {
      var set = this
      db.get(set.optional_name_key, function(error, optional_ui_name) {
        if (optional_ui_name) set.optional_ui_name = optional_ui_name
        if (callback) callback(error)
      })
    },
    remove: function(callback) {
      var set = this
      var fs = require("fs")
      db.srem(data_sets_repo, set.name)
      fs.unlink(set.csv_file_path, callback)
    }

  }

  Simulator.prototype = {
    
    run: function(callback) {
      var sim = this
      STAMPEDE.trader.prepareForSimulation(sim.series_simulation)
      LOG("run | Loading traders for deal removal.")
      STAMPEDE.trader.loadTraders(function() {
        STAMPEDE.trader.removeAllDeals()
        LOG("removed AllDeals | reloading traders")
        STAMPEDE.trader.wakeAll(function() {
          LOG("starting simulation wakeAll")
          if (callback) callback({
            message: "Started Market simulation."
          })
        })
      })
    },

    saveSet: function(optional_ui_name, data, callback) {
      var set = new Set(null, optional_ui_name)
      set.save(data, callback)
    },
    
    loadAllSets: function(callback) {
      var sim = this
      db.smembers(data_sets_repo, function(error, data_sets) {
        
        if (data_sets.length > 0) {
          sim.loaded_data_sets = data_sets
          var data_sets_results = []
          
          async.eachSeries(data_sets, function(data_set_name, internal_callback) {
            var set = new Set(data_set_name)
            set.getUIName(function() {
              data_sets_results.push({
                name: data_set_name,
                optional_ui_name: set.optional_ui_name
              })
              internal_callback()
            })
          }, function() {
            STAMPEDE.controller.refreshSimulationSets(data_sets_results)
            if (callback) callback(error, data_sets_results)  
          })
        }
        else {
          STAMPEDE.controller.refreshSimulationSets([])
          if (callback) callback(error, [])
        }
          
      })
    },

    removeSet: function(data_set_name, callback) {
      var sim = this
      var set = new Set(data_set_name)
      set.remove(function() {
        sim.loadAllSets(callback)
      })
    },

    loadSet: function(data_set_name, callback) {
      var sim = this
      var i = 0
      var set = new Set(data_set_name)
      var time_start = Date.now()

      LOG("loadSet | data_set_name:", data_set_name)
      set.load(function(error, data) {
        sim.current.data_set_name = data_set_name
        sim.current.data_set = data
        sim.analyseCurrentSet()
        common.timer(time_start, "loadSet | " + data.length)
        callback(error, data)
      })
    },

    // Record results in redis for analysis
    // Trigger check if series is running that dataset has been finished
    // If we have worked with a stored data set
    finish: function() {
      var current_wallet = STAMPEDE.current_wallet
      var current_market = STAMPEDE.current_market
      var current_traders = STAMPEDE.current_traders
      var sim = this
      console.log(
        "Ended simulation | current_market, current_wallet:", 
        current_market, current_wallet
      )

      var final_ratio = parseInt(
        (current_wallet.currency_value / config.trading.maximum_investment) * 100
      )
      STAMPEDE.controller.notifyClient({
        message: "Serie ("+
          ( 
            sim.current.series_array ? 
            (
              sim.current.series_array[sim.current.serie_index] + " / (" + 
              sim.current.serie_index + " of " + 
              sim.current.series_array.length + ")"
            ) : 
            "Interactive"
          ) + ") | Ratio: " + final_ratio + ".", 
        permanent: true
      })

      if (sim.series_simulation) {
        // Now record results of simulation (start value, options, end value)
        var props = sim.current.data_set_properties
        var result = [
              {
                value: sim.current.data_set_properties.name || sim.current.data_set_name, 
                field: "data_set", 
                type: "data_sets"
              },
              {
                value: (
                  " |MAX:" + parseInt(props.max) +
                  " |MIN:" + parseInt(props.min) +
                  " |AVG:" + parseInt(props.average) +
                  " |MED:" + parseInt(props.median) +
                  " |DAYS:" + parseInt(props.span_days)
                ),
                field: "data_set_props",
                type: "data_sets"
              }
            ]

        sim.current.series_attributes.forEach(function(serie_attribute) {
          var serie_attribute_arrayed = serie_attribute.split(":")
          if (serie_attribute_arrayed[0] !== "data_sets") {
            var item = {}
            item.value = 
              config[serie_attribute_arrayed[0]][serie_attribute_arrayed[1]]
            item.type = serie_attribute_arrayed[0]
            item.field = serie_attribute_arrayed[1]
            result.push(item)
          }
        })



        var sales = 0
        var purchases = 0

        _.each(current_traders, function(live_trader) {
          sales += (live_trader.sales || 0)
          purchases += (live_trader.purchases || 0)
        })

        result.push({
          value: sales,
          field: "sales",
          type: "sales"
        })

        result.push({
          value: purchases,
          field: "purchases",
          type: "purchases"
        })

        result.push({
          value: final_ratio,
          type: "ratio",
          field: "ratio"
        })


        sim.current.series_results.push(result)
        STAMPEDE.controller.refreshSimulationResults(
          sim.current.series_results.sort(function(a, b) { 
            return b[b.length-1].value - a[a.length-1].value
          }))
        sim.current.serie_index++
        if (sim.current.series_array.length > sim.current.serie_index) {
          // Continue with next simulation
          console.log("Continuing with next serie ("+sim.current.serie_index+").")
          sim.analyseResults()
          sim.processSerie()
        }
        else {
          // End simulation series
          sim.series_simulation = false
          console.log("!!!!!!! Series simulations ended.")
        }
      }
      else {
        console.log("Finishing interactive simulation, refreshing all.")
        STAMPEDE.trader.refreshAll()
      }
    },

    analyseResults: function() {
      var sim = this
      var results = sim.current.series_results
      var analysis = []
      // Analyse per dataset
      var results_count = results.length
      var top_ratio_result = results[0]
      var lowest_ratio_result = results[results.length - 1]
      var top_ratio = top_ratio_result[top_ratio_result.length -1].value
      var lowest_ratio = lowest_ratio_result[lowest_ratio_result.length -1].value

    },

    analyseCurrentSet: function() {
      var sim = this
      var data_set = sim.current.data_set
      var set_len = data_set.length
      var last_values = _.pluck(data_set, "last").sort(function(a, b) { 
            return (a - b) 
          })
      var val_len = last_values.length
      var data_start_time = data_set[0].time
      var data_end_time = data_set[set_len - 1].time
      var span = (data_end_time - data_start_time)
      var data_set_properties = {
            min: last_values[0],
            max: last_values[val_len - 1],
            span: span,
            span_days: parseInt(span / common.time.day),
            median: common.median(last_values),
            average: common.average(last_values)
          }

      LOG(
        "analyseCurrentSet | data_set_properties, set_len, val_len, data_start_time, data_end_time, data_set[0], data_set[set_len - 1]:",
        data_set_properties, set_len, val_len, data_start_time, data_end_time, data_set[0], data_set[set_len - 1]
      )
      var set = new Set(sim.current.data_set_name)
      set.getUIName(function() {
        data_set_properties.name = set.optional_ui_name || set.name
      })
      sim.current.data_set_properties = data_set_properties
      return data_set_properties
    },

    resetDataSet: function() {
      if (this.current.data_set_name) 
        delete this.current.data_set_name
      if (this.current.data_set_properties) 
        delete this.current.data_set_properties
    },

    startSeries: function() {
      var sim = this,
          series_config = require("./../configs/series/series_config").series,
          series_array = [],
          series_attributes = ["data_sets:data_set"],
          series_options = [[]]

      console.log("entering startSeries.")

      db.smembers(data_sets_repo, function(errors, data_sets) {
        
        series_config.data_sets = data_sets || []

        series_config.data_sets.forEach(function(data_set_name, set_index) { 
          series_options[0].push(set_index)
        })

        for (var setting in series_config.trading) {
          series_attributes.push("trading:"+setting)
          var setting_array = []
          series_config.trading[setting].forEach(function(option, option_index) {
            setting_array.push(option_index)
          })
          series_options.push(setting_array)
        }

        for (var strategy in series_config.strategies) {
          series_attributes.push("strategy:"+strategy)
          var setting_array = []
          series_config.strategies[strategy].forEach(function(option, option_index) {
            setting_array.push(option_index)
          })
          series_options.push(setting_array)
        }

        console.log(
          "series_options, series_attributes:", 
          series_options, series_attributes
        )

        // Now combine options

        var series_array = cartesian(series_options)

        console.log("series_array.length:", series_array.length)
        sim.current.serie_index = 0
        sim.current.series_array = series_array
        sim.current.series_attributes = series_attributes
        sim.current.series_config = series_config
        sim.current.series_results = []
        sim.series_simulation = true
        
        sim.processSerie()
      })


    },


    processSerie: function() {
      var sim = this,
          serie_options = sim.current.series_array[sim.current.serie_index],
          serie_data_set_name = 
            sim.current.series_config.data_sets[serie_options[0]]
      STAMPEDE.trader.stopAll()
      sim.applySerieConfig()
      sim.loadSerieSet(serie_data_set_name, function(error, set) {
        STAMPEDE.controller.simulatorWarmUp(set)
        sim.run()
      })
    },

    applySerieConfig: function() {
      var sim = this,
          serie_config = sim.current.series_config,
          serie_options = sim.current.series_array[sim.current.serie_index],
          s = 0

      for (var setting in serie_config.trading) {
        // Read settings from 1, since we are applying in order after data sets
        s++
        config.trading[setting] = 
          serie_config.trading[setting][serie_options[s]]
      }
      for (var strategy in serie_config.strategies) {
        s++
        config.strategy[strategy] = 
          serie_config.strategies[strategy][serie_options[s]]
      }

      console.log(
        "applySerieConfig | serie_options, config.trading, config.strategy:", 
        serie_options, config.trading, config.strategy
      )
    },

    loadSerieSet: function(serie_data_set_name, callback) {
      var sim = this
      if (serie_data_set_name === sim.current.data_set_name) {
        callback(null, STAMPEDE.controller.generated_data)
      }
      else {
        console.log("Loading series set:", serie_data_set_name)
        sim.loadSet(serie_data_set_name, callback)
      }
    }
  }

  function cartesian(arg) {
    var r = [], max = arg.length-1
    function helper(arr, i) {
      for (var j=0, l=arg[i].length; j<l; j++) {
        var a = arr.slice(0) // clone arr
        a.push(arg[i][j])
        if (i==max) {
          r.push(a)
        } else
          helper(a, i+1)
      }
    }
    helper([], 0)
    return r
  }



  return Simulator
}
