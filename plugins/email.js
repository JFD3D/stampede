var mailer = require("nodemailer"),
    jade = require("jade"),
    path = require('path'),
    config = require("./config");

/*
 *
 * EMAIL SENDING
 * Via npm package nodemailer (https://github.com/andris9/Nodemailer)
 *
 *
 * @mail_options
 *  from: "Fred Foo ✔ <foo@blurdybloop.com>", // sender address
 *  to: "bar@blurdybloop.com, baz@blurdybloop.com", // list of receivers
 *  subject: "Hello ✔", // Subject line
 *  text: "Hello world ✔", // plaintext body
 *  html: "<b>Hello world ✔</b>" // html body
 *  template: 'file.jade' in ../emails
 *  data: {} from the action
 *
 *
 */
 
exports.send = function(mail_options, callback) {  
  mail_options.from = config.email.presence;
  mail_options.to = mail_options.to || config.owner.email;
  if (mail_options.template) {
    var template_file = __dirname+"/../emails/"+mail_options.template;
    jade.renderFile(template_file, mail_options.data || {}, function(error, file) {
      if (error) throw error;
      mail_options.html = file;
    });
  }
  
  console.log("email | send | mail_options:", mail_options);

  var email_pipe = mailer.createTransport("SMTP", {
      host: "smtp.gmail.com", // hostname
      secureConnection: true, // use SSL
      port: 465, // port for secure SMTP
      auth: {
        user: config.email.presence,
        pass: config.email.password
      }
  });
    
  email_pipe.sendMail(mail_options, function(error, response){
      if (error) {
          console.log("email | sendMail | error:", error);
      } else {
          console.log("Message sent: " + response.message);
      }
      if (callback) callback({success: (error) ? false : true});
      // if you don't want to use this transport object anymore, uncomment following line
      email_pipe.close(); // shut down the connection pool, no more messages
  });  
};  
