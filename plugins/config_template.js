var credentials = exports.credentials = {
  bitstamp: {
    client_id: "your_bitstamp_login_id",  // Your bitstamp ID (number)
    key: "your_bitstamp_API_key",         // Bitstamp API key, need to generate through their UI
    secret: "your_bitstamp_API_secret"    // Bitstamp API secret
  },
  btcchina: {
    key: "btcchina-key",
    secret: "btcchina-secret",
    client_id: "btcchina-username" 
  }
};

exports.exchange = {
  selected: "bitstamp",                   // Selected exchange
  currency: "usd"                         // Currency on exchange (WARNING, lowercase, 'cny' in case of btcchina)
};

exports.owner = {
  email: "your_email_address"     // Email address where notifications about sales, purchases and errors will be sent
};

exports.email = {
  presence: "application_from_email(gmail)",          // Gmail account email address the app will use to send email notifications from
  password: "application_from_email_password(gmail)"  // Password for the account (make sure this password is permanent)
};

exports.trading = {
  maximum_currency_per_deal: 20,               // Maximum allowed $ per deal / trade / hand
  maximum_investment: 0,                // Maximum total $ allowed to invest in BTC
  bid_alignment: 0.999,                 // Bid align for competitive edge when placing bids 
                                        // EXAMPLE: BTC price is $600, to buy, we would place order at: 600 / 0.999 = 600.6
  max_number_of_deals_per_trader: 3,    // How many deals can a trader manage
  momentum_time_span: 5*60*1000,        // Set momentum time span to x minutes (change the first number, that is minutes)
  greed: 0.02,                           // What upside does the trader look for?
                                        // EXAMPLE: If bought 1 BTC for $600, with greed at 0.05, it will sell for 600*(1+0.05) = 630
  impatience: 0.1                       // When do I buy, for how much over current middle 
                                        // (Example: Middle is at $600, hight at $700, impatience 0.2, I would buy at (700 - 600)*0.2 + 600 = 620
};

exports.strategy = {
  momentum_trading: true,
  trailing_stop: true
};

// Google authentication keys
exports.auth = {
  client_id: "googleOauthClientId",
  client_secret: "googleOauthClientSecret"
};

// Port the app will be running at
exports.port = 3111;

// Hosts, also used for authentication realm
exports.hosts = {
  development: "http://localhost", 
  production: "production_url"
};

// Email addresses of ppl allowed to access this app (needs to be google authenticable)
exports.allowed_user_emails = ["email@address.com", "email2@address.com"]; 