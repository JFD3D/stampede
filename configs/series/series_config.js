var series = {
  
  data_sets: [
    "stampede_data_set_2014-06-01-19:52:56",
    "stampede_data_set_2014-06-01-19:53:32"
  ],

  trading: {

    base_currency_per_deal: [5],

    max_number_of_deals_per_trader: [100],

    momentum_time_span: [(30*60*1000)],

    greed: [0.03, 0.06, 0.09],

    altitude_drop: [2, 1, 0],

    impatience: [0.9, 0.5]

  },

  strategies: {

    momentum_trading: [false],

    trailing_stop: [false],

    bell_bottom: [true],

    combined_selling: [true, false],

    dynamic_multiplier: [true, false]

  }

};

exports.series = series;

