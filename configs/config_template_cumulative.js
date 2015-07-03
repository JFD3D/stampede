exports.credentials = {
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
}

// Change me upon deployment
exports.session_secret = 'randomStringForSessionSecret' 

exports.exchange = {
  selected: "bitstamp",                   // Selected exchange
  currency: "usd"                         // Currency on exchange (WARNING, lowercase, 'cny' in case of btcchina)
}

exports.owner = {
  email: "your_email_address"     // Email address where notifications about sales, purchases and errors will be sent
}

exports.email = {
  presence: "application_from_email(gmail)",          // Gmail account email address the app will use to send email notifications from
  password: "application_from_email_password(gmail)"  // Password for the account (make sure this password is permanent)
}

exports.trading = {
  min_purchase: 5,            // Base $ per starting deal / trade / hand
  maximum_investment: 5000,             // Maximum total $ allowed to invest in BTC
  bid_alignment: 0.1,                 // Bid align for competitive edge when placing bids 
                                        
  greed: 5,                          // What upside does the trader look for?
                                        // EXAMPLE: If bought 1 BTC for $600, with greed at 0.05, it will sell for $630 = 600*(1+0.05)
  impatience: 95,
}

exports.strategy = {
  trailing_stop: true,      // Sales will happen only after trailing stop is reached
}

// Google authentication keys
exports.auth = {
  client_id: "googleOauthClientId",
  client_secret: "googleOauthClientSecret"
}

// Port the app will be running at
exports.port = 3111
// Port for redis store
exports.redis_port = 6379

// Size limit to displayed usd values graph
exports.sheet_size_limit = 300

// Hosts, also used for authentication realm
exports.hosts = {
  development: "http://localhost", 
  production: "production_url"
}

exports.logging = {
  decisions: false      // Whether to log decisions into common log 
                        // Recommended to disable when running with simulator
}

// Path for storing stampede generated datasets
exports.data_set_directory = "/var/www/stampede/data/"

// Email addresses of ppl allowed to access this app (needs to be google authenticable)
exports.allowed_user_emails = ["email@address.com", "email2@address.com"] 

