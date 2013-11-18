exports.bitstamp_credentials = {
  client_id: "your_bitstamp_login_id",
  key: "your_bitstamp_API_key",
  secret: "your_bitstamp_API_secret"
};

exports.owner = {
  email: "your_email_address"
};

exports.email = {
  presence: "application_from_email(gmail)",
  password: "application_from_email_password(gmail)"
};

exports.trading = {
  maximum_$_per_trade: 15,
  maximum_investment: 100,
  bid_alignment: 0.998,
  max_number_of_deals_per_trader: 3
};

exports.auth = {
  client_id: "googleOauthClientId",
  client_secret: "googleOauthClientSecret"
};

exports.port = 3111;

exports.hosts = {
  development: "http://localhost",
  production: "production_url"
};

exports.allowed_user_emails = ["email@address.com", "email2@address.com"];