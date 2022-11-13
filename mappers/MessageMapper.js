const sgMail = require('@sendgrid/mail');

var MessageMapper = function() {

    this.connect = function(key) {
        sgMail.setApiKey(key);
        return this;
    }

    this.send = function(from, to, subject, body) {
        console.log(arguments)
        var msg = {
            to: to,
            from: from + " <noreply@spoo.io>",
            subject: subject,
            text: body
        };
        sgMail.send(msg);
    }

}

module.exports = MessageMapper;