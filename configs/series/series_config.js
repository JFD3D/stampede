var series = {
  
  data_sets: [
    "stampede_data_set_2014-03-27-16:06:43",
    "stampede_data_set_2014-03-27-16:06:50",
    "stampede_data_set_2014-03-27-16:06:33"
  ],

  trading: {

    maximum_currency_per_deal: [5,10,15],

    max_number_of_deals_per_trader: [100],

    momentum_time_span: [(50*60*1000), (100*60*1000)],

    greed: [0.03, 0.05, 0.07],

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

