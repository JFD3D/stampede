var series = {

  trading: {

    base_currency_per_deal: [5],

    max_number_of_deals_per_trader: [100],

    momentum_time_span: [(30*60*1000)],

    greed: [0.03, 0.06, 0.1],

    altitude_drop: [3, 2, 1],

    impatience: [0.1, 0.5, 0.9]

  },

  strategies: {

    momentum_trading: [false],

    trailing_stop: [true, false],

    bell_bottom: [true],

    combined_selling: [true, false],

    dynamic_multiplier: [true, false]

  }

};

exports.series = series;

