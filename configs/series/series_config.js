var series = {
  
  data_sets: [
    "stampede_data_set_2014-04-25-22:21:20",
    "stampede_data_set_2014-04-25-22:21:29"
  ],

  trading: {

    maximum_currency_per_deal: [5, 7, 10],

    max_number_of_deals_per_trader: [100],

    momentum_time_span: [(30*60*1000), (50*60*1000)],

    greed: [0.03, 0.05, 0.07, 0.09],

    altitude_drop: [2, 1, 0]

  },

  strategies: {

    momentum_trading: [true, false],

    trailing_stop: [true, false],

    bell_bottom: [true, false],

    combined_selling: [true, false]

  }

};

exports.series = series;

