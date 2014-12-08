var credentials = exports.credentials = {
  simulated_exchange: {
    client_id: 0,
    key: "SHONG",
    secret: "BONG"
  }
};

exports.exchange = {
  selected: "simulated_exchange",
  currency: "usd"
};

exports.owner = {
  email: "spontain@gmail.com"
};

exports.email = {
  presence: "email",
  password: "pwd"
};

exports.trading = {
  base_currency_per_deal: 2,            // Maximum allowed $ per deal / trade / hand
  maximum_investment: 10000,             // Maximum total $ allowed to invest in BTC
  bid_alignment: 0.1,                 // Bid align for competitive edge when placing bids 
                                        // EXAMPLE: BTC price is $600, to buy, we would place order at: 600 / 0.999 = 600.6
  max_number_of_deals_per_trader: 50,   // How many deals can a trader manage
  momentum_time_span: 60*60*1000,       // Set momentum time span to x minutes (change the first number, that is minutes)
  greed: 5,                          // What upside does the trader look for?
                                        // EXAMPLE: If bought 1 BTC for $600, with greed at 0.05, it will sell for 600*(1+0.05) = 630
  impatience: 1,                     // When do I buy, for how much over current middle 
                                        // (Example: Middle is at $600, hight at $700, impatience 0.2, I would buy at (700 - 600)*0.2 + 600 = 620
  altitude_drop: 2                      // (%) If I buy at the lowest price, only buy at a price X % lower then the lowest
};

exports.strategy = {
  momentum_trading: false,
  trailing_stop: true,
  bell_bottom: true,
  combined_selling: true,
  dynamic_multiplier: true, // Calculate deal multiplication per altitude drop and current high
  dynamic_drop: true        // Dynamically increase altitude drop per fibonacci series
};

exports.auth = {
  client_id: "cl_id",
  client_secret: "cl_sec"
};

exports.port = 3111;
// Port for redis store
exports.redis_port = 6379;


exports.hosts = {
  development: "http://localhost",
  production: "http://localhost"
};

exports.logging = {
  decisions: false      // Whether to log decisions into common log 
                        // Recommended to disable when running with simulator
};

exports.allowed_user_emails = ["spontain@gmail.com", "peter@spontain.co"];