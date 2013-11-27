exports.bitstamp_credentials = {
  client_id: "your_bitstamp_login_id",  // Your bitstamp ID (number)
  key: "your_bitstamp_API_key",         // Bitstamp API key, need to generate through their UI
  secret: "your_bitstamp_API_secret"    // Bitstamp API secret
};

exports.owner = {
  email: "your_email_address"     // Email address where notifications about sales, purchases and errors will be sent
};

exports.email = {
  presence: "application_from_email(gmail)",          // Gmail account email address the app will use to send email notifications from
  password: "application_from_email_password(gmail)"  // Password for the account (make sure this password is permanent)
};

exports.trading = {
  maximum_$_per_deal: 15,               // Maximum allowed $ per deal / trade / hand
  maximum_investment: 100,              // Maximum total $ allowed to invest in BTC
  bid_alignment: 0.998,                 // Bid align for competitive edge when placing bids 
                                        // EXAMPLE: BTC price is $600, to buy, we would place order at: 600 / 0.999 = 600.6
                                        
  max_number_of_deals_per_trader: 3,    // How many deals can a trader manage
  momentum_time_span: 3*60*1000,        // Set momentum time span to x minutes (change the first number, that is minutes)
  greed: 0.05,
  purchase_acceleration: 1.00            // EXAMPLE: If bought 1 BTC for $600, with greed at 0.05, it will sell for $630 = 600*(1+0.05
                                        //upbid - allowing to buy at a certain percentage over daily medium                          // What upside does the trader look for?
                                        // EXAMPLE: If bought 1 BTC for $600, with greed at 0.05, it will sell for $630 = 600*(1+0.05)
                                         //over_middle - allowing to buy at a certain percentage over daily medium 1.00 is no increase
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