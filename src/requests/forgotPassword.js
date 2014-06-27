"use strict";

var resourceful = require('resourceful');

var message = resourceful.define('forgotPasswordRequestMessage', function() {
    this.string( 'message', {
        required: true,
        allowEmpty: false,
        format: 'email'
    } );
} );

var errors = [];

//var identityMessage = new message({email:"wat@wat.com"});

var ForgotPasswordRequest = resourceful.define('forgotPasswordRequest', function() {
    this.object('content', {
        required: true,
        conform: function(val) {

            val = new message(val);

            var validation = val.validate(val, message);

            if ( validation.errors.length !== 0 ) {
                val._errors = [];
                val._errors.push( validation.errors );
            }

            return validation.valid;
        }
    });
});

module.exports = function( reqBody ) {
    reqBody._errors = [];

    var fpr = new ForgotPasswordRequest( reqBody );

    var validation = fpr.validate( fpr, ForgotPasswordRequest );

    if ( validation.valid === false ) {
        return reqBody._errors.concat(validation.errors);
    }

    return fpr;
};