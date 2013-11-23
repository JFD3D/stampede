// Use the GoogleStrategy within Passport.
//   Strategies in passport require a `validate` function, which accept
//   credentials (in this case, an OpenID identifier and profile), and invoke a
//   callback with a user object.
var GoogleStrategy = require("passport-google-oauth").OAuth2Strategy,
    
    // Load config file to 
    config = require("./config"),

    // Use redis to find share holders able to login
    db = require("redis").createClient(6379),
    
    // get from: https://code.google.com/apis/console

    GOOGLE_CLIENT_ID = config.auth.client_id,
    GOOGLE_CLIENT_SECRET = config.auth.client_secret,
    passport = require("passport"),  
    
    //colors for console :)
    cl = {
      r: '\u001b[31m',
      g: '\u001b[32m',
      b: '\u001b[34m',
      res: '\u001b[0m'
    };

exports.initiate = function(app) {

  app.configure('development', function(){
    app.googleRealm = config.hosts.development+':'+config.port+'/';
    app.googleReturnURL = app.googleRealm+'auth/google/return';
  });

  app.configure('production', function(){
    app.googleRealm = config.hosts.production;
    app.googleReturnURL = config.hosts.production+'/auth/google/return';
  });

  // Passport session setup.
  //   To support persistent login sessions, Passport needs to be able to
  //   serialize users into and deserialize users out of the session.  Typically,
  //   this will be as simple as storing the user ID when serializing, and finding
  //   the user by ID when deserializing.  However, since this example does not
  //   have a database of user records, the complete Google profile is serialized
  //   and deserialized.
  passport.serializeUser(function(user, done) {
    done(null, user);
  });

  passport.deserializeUser(function(obj, done) {
    done(null, obj);
  });
  // Initialize Passport!  Also use passport.session() middleware, to support
  // persistent login sessions (recommended).
  app.use(passport.initialize());
  app.use(passport.session());  
  //PASSPORT specific END
  passport.use(new GoogleStrategy({
      clientID: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      callbackURL: app.googleReturnURL,
      realm: app.googleRealm
    },
    function(accessToken, refreshToken, profile, done) {
      // asynchronous verification, for effect...
      process.nextTick(function () {
        
        // To keep the example simple, the user's Google profile is returned to
        // represent the logged-in user.  In a typical application, you would want
        // to associate the Google account with a user record in your database,
        // and return that user instead.
        //profile.identifier = identifier;
        return done(null, profile);
      });
    }
  ));
  // GET /auth/google
  //   Use passport.authenticate() as route middleware to authenticate the
  //   request.  The first step in Google authentication will involve redirecting
  //   the user to google.com.  After authenticating, Google will redirect the
  //   user back to this application at /auth/google/return
  app.get('/auth/google', 
    passport.authenticate('google', 
      { 
        scope: [
          'https://www.googleapis.com/auth/userinfo.profile', 
          'https://www.googleapis.com/auth/userinfo.email'
        ]
      }
    ),
    function(req, res) {}
  );

  // GET /auth/google/return
  //   Use passport.authenticate() as route middleware to authenticate the
  //   request.  If authentication fails, the user will be redirected back to the
  //   login page.  Otherwise, the primary route function function will be called,
  //   which, in this example, will redirect the user to the home page.
  app.get('/auth/google/return', 
    passport.authenticate('google', { failureRedirect: '/login' }),

    function(req, res) {
      allowedUser(req.path || "/", req.user.emails[0].value, function(yes, user) {
        if (yes) {
          req.current_user = user;
          res.redirect("/");
        }
        else {
          res.render('noaccess');
        }
      });
    }
  );
  
  //authentication routes
  
  app.get('/logout', function(req, res){
    req.path = "/";
    req.session.redirect_to = "/";
    req.logout();
    res.redirect('/login');
  });

  app.get('/login', function(req, res){
    res.render('login', { title: "Stampede | Login", "currentpage":"login" });
  });

  app.get('/noaccess', function(req, res){
    res.render('noaccess', { title: "No stampede.", "currentpage":"login" });
  });


};

// Basic ensure authentication function
// Custom made
exports.ensure = function (req, res, next) {
  req.session.redirect_to = req.path || "/";
  // checked req.path before, now only user existence
  if (req.isAuthenticated()) {
    console.log(cl.g+"Access to:", req.path, "by:", req.user.emails[0].value+cl.res);
    allowedUser(req.path || "/", req.user.emails[0].value, function(yes, user) {
      if (yes) {
        req.current_user = user;
        return next();
      }
      else {
        res.redirect("/noaccess");
      }
    });
  }
  else {
    res.redirect('/auth/google');
  }
};

// REUSABLE ACTIONS
// AUTHORIZATION PART
// Custom check on the array of allowed users
function allowedUser(path, email, callback) {
  var loaded_user = {};
  if (config.allowed_user_emails.indexOf(email) > -1) {
    loaded_user.email = email;
    loaded_user.owner = (email === config.owner.email);
    callback(true, loaded_user);
  }
  else {
    // Check if shareholders have been added who should be able to login
    db.smembers("stampede_shares", function(redis_errors, share_list) {
      var allowed_paths = ["/value_sheet", "/shares"],
          allowed_for_holder = (allowed_paths.indexOf(path) > -1);
      if (
        share_list && 
        share_list.length > 0
      ) {
        share_list.forEach(function(share_string) {
          var share_arrayed = share_string.split("|");
          if (share_arrayed[0] === email) loaded_user.email = email;
        });
        console.log("authentication | per share holder | email, path, allowed_for_holder:", email, path, allowed_for_holder);
      }
      callback((loaded_user.email !== undefined && allowed_for_holder), loaded_user.email ? loaded_user : null);
    });
  }
}