"use strict"

module.exports = function(STAMPEDE) {

  var db              = STAMPEDE.db
  var config          = STAMPEDE.config
  var common          = STAMPEDE.common
  
  
  var LOG             = STAMPEDE.LOG("simulator")
  var _               = STAMPEDE._
  var async           = STAMPEDE.async

  const REC_SET_ATTR  = ["include_in_series", "name"]
  const SETS_REPO     = "stampede_data_sets"
  const XC            = config.exchange.currency

  function Simulator() {
    this.loaded_data_sets   = []
    this.current            = {}
    this.series_simulation  = false
  }

  function Set(record_name, options) {
    record_name = record_name || ("stampede_data_set_" + Date.now())
    options     = options || {
      name: "N/A",
      include_in_series: false
    }

    this.record_name        = record_name || ("stampede_data_set_" + Date.now())
    this.include_in_series  = options.include_in_series
    this.optional_ui_name   = options.name
    this.attribute_key      = "stampede_set_name:" + record_name
    this.headers            = ["time", "high", "low", "last"]
    this.csv_file_name      = record_name + ".csv"
    this.csv_file_path      = (
      STAMPEDE.config.data_set_directory || "/var/stampede_data_sets/"
    ) + this.csv_file_name
  }

  Set.prototype = {
    save: function(data, done) {
      var set         = this
      var start_time  = Date.now()
      var data_length = data.length

      db.sadd(SETS_REPO, set.record_name, function(error, response) {
        var csv_content = common.generateCSV(
              data, set.headers, true
            )
        // Save separate (no need to wait, the filing will take a lot longer ?)
        if (set.optional_ui_name && set.optional_ui_name.length) {
          db.hmset(set.attribute_key, {
            name: set.optional_ui_name,
            include_in_series: set.include_in_series
          })
        }
        common.fileTo(set.csv_file_path, csv_content, function(error_writing) {
          common.timer(start_time, "saveSet(" + data_length + ")")
          if (done) return done(null, set)
        })
      })      
    },

    updateAttributes: function(attributes, done) {
      var updates         = {}
      var set             = this

      REC_SET_ATTR.forEach(function (attr_name) {
        if (attributes.hasOwnProperty(attr_name)) {
          let value = attributes[attr_name]

          updates[attr_name] = value
          set[attr_name]     = value
        }
      })

      if (_.keys(updates).length) {
        LOG("updateAttributes:", updates)
        db.hmset(set.attribute_key, updates, done)
      }
      else return done("No valid updates submitted.")
    },

    load: function(done) {
      var set = this

      common.loadCSV(set.csv_file_path, function(row) {
        let time = parseInt(row[0])

        return (time > 0 ? {
          time: parseInt(row[0]),
          high: parseFloat(row[1]),
          low: parseFloat(row[2]),
          last: parseFloat(row[3])
        } : null)
      }, done)
    },
    getAttributes: function(done) {
      var set = this

      db.hgetall(set.attribute_key, function(error, attributes) {
        if (attributes) {
          set.optional_ui_name  = attributes.name
          set.include_in_series = (attributes.include_in_series === "true")
        }
        if (done) return done(error)
      })
    },
    remove: function(done) {
      var set = this
      var fs  = require("fs")
      
      async.series([
        function(next) {
          db.srem(SETS_REPO, set.record_name, next)
        },
        function(next) {
          db.hdel(set.attribute_key, next)
        },
        function(next) {
          fs.unlink(set.csv_file_path, next)
        }
      ], done)
    }

  }

  Simulator.prototype = {
    
    run: function(done) {
      var sim = this

      STAMPEDE.trader.prepareForSimulation(sim.series_simulation)
      LOG("run | Loading traders for deal removal.")
      STAMPEDE.trader.loadTraders(function() {
        STAMPEDE.trader.cleanBooks()
        LOG("removed cleanBooks | reloading traders")
        STAMPEDE.trader.wakeAll(function() {
          LOG("starting simulation wakeAll")
          if (done) done({
            message: "Started Market simulation."
          })
        })
      })
    },

    saveSet: function(options, done) {
      var set  = new Set(null, options)

      if (options.data) {
        set.save(options.data, done)
      }
      else return done("Data for new set not provided!")
    },

    updateSet: function(options, done) {
      var set = new Set(options.set_name)

      set.updateAttributes(options, done)
    },
    
    loadAllSets: function(done) {
      var sim               = this
      var data_sets_results = []

      db.smembers(SETS_REPO, function(error, data_sets) {
        if (data_sets.length > 0) {
          sim.loaded_data_sets = data_sets
          async.eachSeries(data_sets, function(data_set_name, next) {
            let set = new Set(data_set_name)

            set.getAttributes(function() {
              data_sets_results.push({
                record_name: data_set_name,
                include_in_series: set.include_in_series,
                optional_ui_name: set.optional_ui_name
              })
              return next()
            })
          }, function() {
            STAMPEDE.controller.refreshSimulationSets(data_sets_results)
            LOG(data_sets_results)
            if (done) return done(error, data_sets_results)  
          })
        }
        else {
          STAMPEDE.controller.refreshSimulationSets([])
          if (done) return done(error, [])
        }
          
      })
    },

    removeSet: function(data_set_name, done) {
      var sim = this
      var set = new Set(data_set_name)

      set.remove(function() {
        sim.loadAllSets(done)
      })
    },

    loadSet: function(data_set_name, done) {
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

        return done(error, data)
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
      
      LOG(
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
              (sim.current.serie_index + 1) + " of " + 
              sim.current.series_array.length + ")"
            ) : 
            "Interactive"
          ) + ") | Ratio: " + final_ratio + ".", 
        permanent: true
      })

      if (sim.series_simulation) {
        // Now record results of simulation (start value, options, end value)
        let props = sim.current.data_set_properties
        let result = [
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
          let serie_attribute_arrayed = serie_attribute.split(":")
          if (serie_attribute_arrayed[0] !== "data_sets") {
            let item    = {}
            item.value  = 
              config[serie_attribute_arrayed[0]][serie_attribute_arrayed[1]]
            item.type   = serie_attribute_arrayed[0]
            item.field  = serie_attribute_arrayed[1]

            result.push(item)
          }
        })



        var sales           = 0
        var purchases       = 0
        var sales_vol       = 0
        var purchases_vol   = 0

        _.each(current_traders, function(live_trader) {
          sales += (live_trader.sales || 0)
          sales_vol += (live_trader.book.sales_amount_currency || 0)
          purchases += (live_trader.purchases || 0)
          purchases_vol += (live_trader.book.purchases_amount_currency || 0)
        })

        result.push({
          value: purchases + " (" + XC.toUpperCase() + " " + parseInt(purchases_vol) + ")",
          field: "purchases",
          type: "purchases"
        })

        result.push({
          value: sales + " (" + XC.toUpperCase() + " " + parseInt(sales_vol) + ")",
          field: "sales",
          type: "sales"
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
          LOG("Continuing with next serie ("+sim.current.serie_index+").")
          sim.analyseResults()
          sim.processSerie()
        }
        else {
          // End simulation series
          sim.series_simulation = false
          STAMPEDE.trader.stopAll()
          LOG("!!!!!!! Series simulations ended.")
        }
      }
      else {
        LOG("Finishing interactive simulation, refreshing all.")
        STAMPEDE.trader.refreshAll()
        STAMPEDE.trader.stopAll()
      }
    },

    analyseResults: function() {
      var sim                 = this
      var results             = sim.current.series_results
      var analysis            = []
      // Analyse per dataset
      var results_count       = results.length
      var top_ratio_result    = results[0]
      var lowest_ratio_result = results[results.length - 1]
      var top_ratio           = 
        top_ratio_result[top_ratio_result.length -1].value
      var lowest_ratio        = 
        lowest_ratio_result[lowest_ratio_result.length -1].value
    },

    analyseCurrentSet: function() {
      var sim                 = this
      var data_set            = sim.current.data_set
      var set_len             = data_set.length
      var last_values         = 
        _.pluck(data_set, "last").sort(function(a, b) { 
          return (a - b) 
        })
      var val_len             = last_values.length
      var data_start_time     = data_set[0].time
      var data_end_time       = data_set[set_len - 1].time
      var span                = (data_end_time - data_start_time)
      var set                 = new Set(sim.current.data_set_name)
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
      

      set.getAttributes()
      sim.current.data_set_properties = data_set_properties
      return data_set_properties
    },

    resetDataSet: function() {
      if (this.current.data_set_name) 
        delete this.current.data_set_name
      if (this.current.data_set_properties) 
        delete this.current.data_set_properties
    },

    startSeries: function(done) {
      var sim               = this
      var series_config     = require("./../configs/series/series_config").series
      var series_array      = []
      var series_attributes = ["data_sets:data_set"]
      var series_options    = [[]]
      var data_sets         = []

      LOG("entering startSeries.")

      sim.loadAllSets(function(load_errors, data_sets_results) {
        data_sets_results.forEach(function(set) {
          if (set.include_in_series) {
            data_sets.push(set.record_name)
            series_options[0].push(data_sets.length - 1)
          }
        })
        
        series_config.data_sets = data_sets

        for (var setting in series_config.trading) {
          let setting_array = []
          series_attributes.push("trading:"+setting)
          series_config.trading[setting].forEach(function(option, option_index) {
            setting_array.push(option_index)
          })
          series_options.push(setting_array)
        }

        for (var strategy in series_config.strategies) {
          let setting_array = []
          series_attributes.push("strategy:"+strategy)
          series_config.strategies[strategy].forEach(function(option, option_index) {
            setting_array.push(option_index)
          })
          series_options.push(setting_array)
        }

        LOG(
          "series_options, series_attributes:", 
          series_options, series_attributes
        )

        // Now combine options

        let series_array = cartesian(series_options)

        LOG("series_array.length:", series_array.length)
        sim.current.serie_index = 0
        sim.current.series_array = series_array
        sim.current.series_attributes = series_attributes
        sim.current.series_config = series_config
        sim.current.series_results = []
        sim.series_simulation = true
        
        if (data_sets.length && series_array.length) {
          sim.processSerie()  
          if (done) return done()
        }
        else if (done) return done(
          "No data sets added through simulator or data loader, " +
          "or series config contains incorrect settings."
        )
      })
    },


    processSerie: function() {
      var sim = this
      var serie_options = sim.current.series_array[sim.current.serie_index]
      var serie_data_set_name = 
            sim.current.series_config.data_sets[serie_options[0]]
      STAMPEDE.trader.stopAll()
      sim.applySerieConfig()
      sim.loadSerieSet(serie_data_set_name, function(error, set) {
        STAMPEDE.controller.simulatorWarmUp(set)
        sim.run()
      })
    },

    applySerieConfig: function() {
      var sim           = this
      var serie_config  = sim.current.series_config
      var serie_options = sim.current.series_array[sim.current.serie_index]
      var s             = 0

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

      LOG(
        "applySerieConfig | serie_options, config.trading, config.strategy:", 
        serie_options, config.trading, config.strategy
      )
    },

    loadSerieSet: function(serie_data_set_name, done) {
      var sim = this

      if (serie_data_set_name === sim.current.data_set_name) {
        done(null, STAMPEDE.controller.generated_data)
      }
      else {
        LOG("Loading series set:", serie_data_set_name)
        sim.loadSet(serie_data_set_name, done)
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
