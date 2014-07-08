!function(e){if("object"==typeof exports&&"undefined"!=typeof module)module.exports=e();else if("function"==typeof define&&define.amd)define([],e);else{var f;"undefined"!=typeof window?f=window:"undefined"!=typeof global?f=global:"undefined"!=typeof self&&(f=self),f.Bridge=e()}}(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(_dereq_,module,exports){
// Include dependencies
var enc_hex = _dereq_( './include/crypto-js/enc-hex' );
var json3 = _dereq_( './include/json3' );
var jstorage = _dereq_( './include/jstorage' );
var sha256 = _dereq_( './include/crypto-js/sha256' );
var Identity = _dereq_( './Identity' );

// [Bridge Constructor]
// The Bridge object is the global object through which other applications will 
// communicate with the bridged API resources. It provides a simple surface API for logging
// in and logging out users as well as sending requests to the API. Internally, it handles
// all of the request authentication necessary for the API without exposing the user's
// account password to outside scrutiny (and even scrutiny from other local applications
// to a significant extent).
module.exports = function () {

  'use strict';

  // The object to be returned from the factory
  var self = {};

  ///////////////////////////////////////////////////////////////////////////////////////////////////
  // PRIVATE ////////////////////////////////////////////////////////////////////////////////////////
  ///////////////////////////////////////////////////////////////////////////////////////////////////

  ////////////////
  // PROPERTIES //
  ////////////////

  // [PRIVATE] identity
  // The Identity object used to track the user and create requests signed with 
  // appropriate HMAC hash values.
  var identity = null;


  ///////////////
  // FUNCTIONS //
  ///////////////

  // [PRIVATE] clearIdentity()
  // Sets the current Identity object to null so it gets garbage collected and cannot be used 
  // to validate requests going forward.
  var clearIdentity = function () {

    identity = null;

  };

  // [PRIVATE] clearUser
  // Clears the current user data and additional data assigned to the Bridge.
  var clearUser = function () {

    // Set the user and additional data objects to null
    self.user = null;
    self.additionalData = null;

  };

  // [PRIVATE] hasIdentity()
  // Returns whether or not an the Identity object is currently assigned.
  var hasIdentity = function () {

    return ( identity !== null );

  };

  // [PRIVATE] requestPrivate()
  // This function provides the basic functionality used by all of the Bridge Client's internal
  // request function calls. It performs an XHR request to the API server at the specified resource
  // and return a jQuery Deferred object . If this returns null, the request could not be sent
  // because no user credentials were available to sign the request.
  var requestPrivate = function ( method, resource, payload, tempIdentity ) {

    // Notify the user of the request being ready to send.
    if ( typeof self.onRequestCalled === "function" ) {
      self.onRequestCalled( method, resource, payload );
    }

    // Create a deferred object to provide a convenient way for the caller to handle success and 
    // failure.
    var deferred = new jQuery.Deferred();

    // If a temporary identity was provided, use it (even if an identity is set in Bridge).
    var requestIdentity = null;
    if ( tempIdentity !== null && typeof tempIdentity === 'object' ) {
      requestIdentity = tempIdentity;
    }
    // If an identity is set in Bridge, use it.
    else if ( hasIdentity() === true ) {
      requestIdentity = identity;
    }
    // No identity is available. The request can't be sent.
    else { 
      if ( self.debug === true ) {
        console.warn( "BRIDGE | Request | Request cannot be sent. No user credentials available." );
      }
      deferred.reject( { status: 412, message: '412 (Precondition Failed) Null user identity.' }, null );
      return deferred.promise();
    }

    // Build the payloadString to be sent along with the message.
    // Note: If this is a GET request, prepend 'payload=' since the data is sent in the query 
    // string.
    var reqBody = null;
    if ( method.toUpperCase() === 'GET' ) {
      reqBody = 'payload=' + JSON.stringify( requestIdentity.createRequest( payload ) );
    }
    else {
      reqBody = JSON.stringify( requestIdentity.createRequest( payload ) );
    }

    // Send the request
    jQuery.ajax( {
      'type': method,
      'url': self.url + resource,
      'data': reqBody,
      'dataType': 'json',
      'contentType': 'application/json',
      'headers': {
        'Accept': 'application/json'
      },
      'timeout': self.timeout,
      'async': true,
    } )
    .done( function ( data, textStatus, jqXHR ) {

      // Check if the returned header was formatted incorrectly.
      if ( typeof data !== 'object' || typeof data.content !== 'object' ) {
        deferred.reject( { status: 417, message: '417 (Expectation Failed) Malformed message.' }, jqXHR );
        return;
      }

      // Notify the user of the successful request.
      deferred.resolve( data, jqXHR );

    } )
    .fail( function ( jqXHR, textStatus, errorThrown ) {

      // Reject the obvious error codes.
      var error = Bridge.isErrorCodeResponse( jqXHR );
      if ( error !== null ) {

        // Notify the user of the error.
        deferred.reject( error, jqXHR );

      } 
      else // Connection timeout
      {

        // Notify the user of the failure to connect to the server.
        deferred.reject( { status: 0, message: '0 (Timeout) No response from the server.' }, jqXHR );

      }

    } );

    // Return the deferred object to the caller
    return deferred.promise();

  };

  // [PRIVATE] requestChangePasswordPrivate()
  // Ask the server to change the password of the curently logged-in user. This operation requires
  // the user's current password to be supplied and creates a temporary Identity object to send the
  // request for a password change to verify that another individual didn't just hop onto a logged-
  // in computer and change a user's password while they were away from their computer.
  var requestChangePasswordPrivate = function ( oldPassword, newPassword ) {

    // Notify the user of the changePassword call occurring.
    if ( typeof self.onFChangePassword === "function" ) {
      self.onChangePassword();
    }

    // Hash the user's passwords
    var oldHashedPassword = sha256( oldPassword ).toString( enc_hex );
    var newHashedPassword = sha256( newPassword ).toString( enc_hex );

    // Clear the unencrypted passwords from memory
    oldPassword = null;
    newPassword = null;

    // Create a deferred object to return so the end-user can handle success/failure conveniently.
    var deferred = new jQuery.Deferred();

    // Build our internal success handler (this calls deferred.resolve())
    var onDone = function ( data, jqXHR ) {

      // Check that the content type (Message) is formatted correctly.
      if ( typeof data.content.message !== 'string' ) {
        onFail( { status: 417, message: '417 (Expectation Failed) Malformed message.' }, jqXHR );
        return;
      }

      // Set Bridge's identity object using the new password, since future requests will need to be 
      // signed with the new user credentials.
      setIdentity( identity.email, newHashedPassword, true );

      // Log the success to the console.
      if ( self.debug === true ) {
        console.log( "BRIDGE | Change Password | " + data.content.message );
      }

      // Signal the deferred object to use its success() handler.
      deferred.resolve( data, jqXHR );

    };

    // Build our internal failure handler (this calls deferred.reject())
    var onFail = function ( error, jqXHR ) {

      // Log the error to the console.
      if ( Bridge.debug === true ) {
        console.error( "BRIDGE | Change Password | " + error.status.toString() + " >> " + error.message );
      }

      // Signal the deferred object to use its fail() handler.
      deferred.reject( error, jqXHR );

    };

    // Build the payload object to send with the request
    var payload = {
      "appData": {},
      "email": '',
      "firstName": '',
      "lastName": '',
      "password": newHashedPassword
    };

    // Configure a temporary Identity object with the user's credentials, using the password 
    // received as a parameter to double-confirm the user's identity immediately before they 
    // change their account password.
    var tempIdentity = new Identity( identity.email, oldHashedPassword, true );

    // Send the request
    requestPrivate( 'PUT', 'users', payload, tempIdentity ).done( onDone ).fail( onFail );

    // Return the deferred object so the end-user can handle errors as they choose.
    return deferred.promise();

  };

  // [PRIVATE] requestForgotPasswordPrivate()
  // Ask the server to set the user into recovery state for a short period of time and send an
  // account recovery email to the email account provided here, as long as it identifies a user
  // in the database.
  var requestForgotPasswordPrivate = function ( email ) {

    // Notify the user of the forgotPassword call occurring.
    if ( typeof self.onForgotPassword === "function" ) {
      self.onForgotPassword( email );
    }

    // Create a deferred object to return so the end-user can handle success/failure conveniently.
    var deferred = new jQuery.Deferred();

    // Build our internal success handler (this calls deferred.resolve())
    var onDone = function ( data, jqXHR ) {

      // Check that the content type (Message) is formatted correctly.
      if ( typeof data.content.message !== 'string' ) {
        onFail( { status: 417, message: '417 (Expectation Failed) Malformed message.' }, jqXHR );
        return;
      }

      // Log the success to the console.
      if ( self.debug === true ) {
        console.log( "BRIDGE | Forgot Password | " + data.content.message );
      }

      // Signal the deferred object to use its success() handler.
      deferred.resolve( data, jqXHR );

    };

    // Build our internal failure handler (this calls deferred.reject())
    var onFail = function ( error, jqXHR ) {

      // Log the error to the console.
      if ( Bridge.debug === true ) {
        console.error( "BRIDGE | Forgot Password | " + error.status.toString() + " >> " + error.message );
      }

      // Signal the deferred object to use its fail() handler.
      deferred.reject( error, jqXHR );

    };

    // Build the payload object to send with the request
    var payload = {
      "message": email
    };

    // Create a temporary Identity object with a blank password.
    var tempIdentity = new Identity( '', '', true );

    // Send the request
    requestPrivate( 'PUT', 'forgot-password', payload, tempIdentity ).done( onDone ).fail( onFail );

    // Return the deferred object so the end-user can handle errors as they choose.
    return deferred.promise();

  };

  // [PRIVATE] requestLoginPrivate()
  // Log in a user with the given email/password pair. This creates a new Identity object
  // to sign requests for authentication and performs an initial request to the server to
  // send a login package.
  var requestLoginPrivate = function ( email, password, useLocalStorage, dontHashPassword ) {

    // Notify the user of the login call occurring.
    if ( typeof self.onLoginCalled === "function" ) {
      self.onLoginCalled( email, useLocalStorage );
    }

    // Hash the user's password
    var hashedPassword = ( dontHashPassword === true ) ? password :
      sha256( password ).toString( enc_hex );

    // Clear the unencrypted password from memory
    password = null;

    // Create a deferred object to return so the end-user can handle success/failure conveniently.
    var deferred = new jQuery.Deferred();

    // Build our internal success handler (this calls deferred.resolve())
    var onDone = function ( data, jqXHR ) {

      // Check that the content type (Login Package) is formatted correctly.
      if ( typeof data.content.user !== 'object' ) {
        onFail( { status: 417, message: '417 (Expectation Failed) Malformed login package.' }, jqXHR );
        return;
      }

      // Log the success to the console.
      if ( self.debug === true ) {
        console.log( "BRIDGE | Login | " + JSON.stringify( data.content ) );
      }

      // Set the user object using the user data that was returned
      setUser( data.content.user, data.content.additionalData );

      // Store this identity to local storage, if that was requested.
      // [SECURITY NOTE 1] storeLocally should be set based on user input, by asking whether
      // the user is on a private computer or not. This is can be considered a tolerable
      // security risk as long as the user is on a private computer that they trust or manage
      // themselves. However, on a public machine this is probably a security risk, and the
      // user should be able to decline this convencience in favour of security, regardless
      // of whether they are on a public machine or not.
      if ( self.useLocalStorage ) {
        jQuery.jStorage.set( 'bridge-client-identity', JSON.stringify( {
          "email": email,
          "password": hashedPassword
        } ) );
        jQuery.jStorage.setTTL( 'bridge-client-identity', 86400000 ); // Expire in 1 day.
      }

      // Signal the deferred object to use its success() handler.
      deferred.resolve( data, jqXHR );

    };

    // Build our internal failure handler (this calls deferred.reject())
    var onFail = function ( error, jqXHR ) {

      // Clear the user credentials, since they didn't work anyway.
      clearUser();

      // Log the error to the console.
      if ( Bridge.debug === true ) {
        console.error( "BRIDGE | Login | " + error.status.toString() + " >> " + error.message );
      }

      // Signal the deferred object to use its fail() handler.
      deferred.reject( error, jqXHR );

    };

    // This request uses an empty payload
    var payload = {};

    // Set whether or not the Bridge should store user credentials and Bridge configuration
    // to local storage.
    self.useLocalStorage = useLocalStorage;

    // Configure an Identity object with the user's credentials.
    setIdentity( email, hashedPassword, true );

    // Send the request
    requestPrivate( 'GET', 'login', payload, null ).done( onDone ).fail( onFail );

    // Return the deferred object so the end-user can handle errors as they choose.
    return deferred.promise();

  };

  // [PRIVATE] requestRecoverPasswordPrivate()
  // To be called by the page at the address which an account recovery email links the user
  // to. They will have entered their new password to an input field, and the email and hash will 
  // have been made available to the page in the query string of the URL.
  var requestRecoverPasswordPrivate = function ( email, password, hash ) {

    // Notify the user of the recover password call occurring.
    if ( typeof self.onRecoverPasswordCalled === "function" ) {
      self.onRecoverPasswordCalled( email, hash );
    }

    // Hash the user's password
    var hashedPassword = sha256( password ).toString( enc_hex );

    // Clear the unencrypted password from memory
    password = null;

    // Create a deferred object to return so the end-user can handle success/failure conveniently.
    var deferred = new jQuery.Deferred();

    // Build our internal success handler (this calls deferred.resolve())
    var onDone = function ( data, jqXHR ) {

      // Check that the content type (Message) is formatted correctly.
      if ( typeof data.content.message !== 'string' ) {
        onFail( { status: 417, message: '417 (Expectation Failed) Malformed message.' }, jqXHR );
        return;
      }

      // Log the success to the console.
      if ( self.debug === true ) {
        console.log( "BRIDGE | Recover Password | " + data.content.message );
      }

      // Signal the deferred object to use its success() handler.
      deferred.resolve( data, jqXHR );

    };

    // Build our internal failure handler (this calls deferred.reject())
    var onFail = function ( error, jqXHR ) {

      // Log the error to the console.
      if ( Bridge.debug === true ) {
        console.error( "BRIDGE | Recover Password | " + error.status.toString() + " >> " + error.message );
      }

      // Signal the deferred object to use its fail() handler.
      deferred.reject( error, jqXHR );

    };

    // Build the payload object to send with the request
    var payload = {
      "hash": hash,
      "message": hashedPassword
    };

    // Create a temporary an Identity object with a blank password.
    var tempIdentity = new Identity( '', '', true );

    // Send the request
    requestPrivate( 'PUT', 'recover-password', payload, tempIdentity ).done( onDone ).fail( onFail );

    // Return the deferred object so the end-user can handle errors as they choose.
    return deferred.promise();

  };

  // [PRIVATE] requestRegisterPrivate()
  // Register in a user with the given email/password pair, name, and application-specific data.
  // This does creates an Identity object for the user to sign the registration request's HMAC,
  // however the password is transmitted in the content of the message (SHA-256 encrypted), so
  // theoretically an interceptor of this message could reconstruct the HMAC and falsify a request
  // to the server the request is made without using HTTPS protocol and given enough persistence
  // on the part of the attacker. 
  var requestRegisterPrivate = function ( email, password, firstName, lastName, appData ) {

    // Notify the user of the register call occurring.
    if ( typeof self.onRegisterCalled === "function" ) {
      self.onRegisterCalled( email, firstName, lastName, appData );
    }

    // Hash the user's password
    var hashedPassword = sha256( password ).toString( enc_hex );

    // Clear the unencrypted password from memory
    password = null;

    // Create a deferred object to return so the end-user can handle success/failure conveniently.
    var deferred = new jQuery.Deferred();

    // Build our internal success handler (this calls deferred.resolve())
    var onDone = function ( data, jqXHR ) {

      // Check that the content type (Message) is formatted correctly.
      if ( typeof data.content.message !== 'string' ) {
        onFail( { status: 417, message: '417 (Expectation Failed) Malformed message.' }, jqXHR );
        return;
      }

      // Log the success to the console.
      if ( self.debug === true ) {
        console.log( "BRIDGE | Register | " + data.content.message );
      }

      // Signal the deferred object to use its success() handler.
      deferred.resolve( data, jqXHR );

    };

    // Build our internal failure handler (this calls deferred.reject())
    var onFail = function ( error, jqXHR ) {

      // Log the error to the console.
      if ( Bridge.debug === true ) {
        console.error( "BRIDGE | Register | " + error.status.toString() + " >> " + error.message );
      }

      // Signal the deferred object to use its fail() handler.
      deferred.reject( error, jqXHR );

    };

    // Build the payload object to send with the request
    var payload = {
      "appData": appData,
      "email": email,
      "firstName": firstName,
      "lastName": lastName,
      "password": hashedPassword
    };

    // Create a temporary an Identity object with a blank password.
    var tempIdentity = new Identity( '', '', true );

    // Send the request
    requestPrivate( 'POST', 'users', payload, tempIdentity ).done( onDone ).fail( onFail );

    // Return the deferred object so the end-user can handle errors as they choose.
    return deferred.promise();

  };

  // [PRIVATE] requestVerifyEmailPrivate()
  // To be called by the page the at address which an email verification email links the user to.
  // The user will be sent to this page with their email and a hash in the query string of the URL.
  var requestVerifyEmailPrivate = function ( email, hash ) {

    // Notify the user of the verify email call occurring.
    if ( typeof self.onVerifyEmailCalled === "function" ) {
      self.onVerifyEmailCalled( email, hash );
    }

    // Create a deferred object to return so the end-user can handle success/failure conveniently.
    var deferred = new jQuery.Deferred();

    // Build our internal success handler (this calls deferred.resolve())
    var onDone = function ( data, jqXHR ) {

      // Check that the content type (Message) is formatted correctly.
      if ( typeof data.content.message !== 'string' ) {
        onFail( { status: 417, message: '417 (Expectation Failed) Malformed message.' }, jqXHR );
        return;
      }

      // Log the success to the console.
      if ( self.debug === true ) {
        console.log( "BRIDGE | Verify Email | " + data.content.message );
      }

      // Signal the deferred object to use its success() handler.
      deferred.resolve( data, jqXHR );

    };

    // Build our internal failure handler (this calls deferred.reject())
    var onFail = function ( error, jqXHR ) {

      // Log the error to the console.
      if ( Bridge.debug === true ) {
        console.error( "BRIDGE | Verify Email | " + error.status.toString() + " >> " + error.message );
      }

      // Signal the deferred object to use its fail() handler.
      deferred.reject( error, jqXHR );

    };

    // Build the payload object to send with the request
    var payload = {
      "hash": hash
    };

    // Create a temporary an Identity object with a blank password.
    var tempIdentity = new Identity( '', '', true );

    // Send the request
    requestPrivate( 'PUT', 'verify-email', payload, tempIdentity ).done( onDone ).fail( onFail );

    // Return the deferred object so the end-user can handle errors as they choose.
    return deferred.promise();

  };

  // [PRIVATE] setIdentity()
  // Sets the current Identity object to a new instance given a user's email and password.
  var setIdentity = function ( email, password, dontHashPassword ) {

    identity = new Identity( email, password, dontHashPassword );

  };

  // [PRIVATE] setUser
  // Sets the current user and additional data objects based on the data returned from a login
  // and performs all of the associated error checks for malformed login data.
  var setUser = function ( user, additionalData ) {

    // Set the user and additional data objects
    self.user = user;
    self.additionalData = additionalData;

  };


  ///////////////////////////////////////////////////////////////////////////////////////////////////
  // PUBLIC /////////////////////////////////////////////////////////////////////////////////////////
  ///////////////////////////////////////////////////////////////////////////////////////////////////

  ////////////////
  // PROPERTIES //
  ////////////////

  // [PUBLIC] additionalData
  // The a hashmap of optional objects returned by the the database that provide additional
  // information to be used for implementation-specific login needs.
  self.additionalData = null;

  // [PUBLIC] debug
  // If set to true, Bridge will log errors and warnings to the console when they occur.
  self.debug = false;

  // [PUBLIC] timeout
  // The timeout period for requests (in milliseconds).
  self.timeout = 10000;

  // [PUBLIC] url
  // The URL path to the API to be bridged. This URL must be written so that the final 
  // character is a forward-slash (e.g. https://peir.axoninteractive.ca/api/1.0/).
  self.url = '';

  // [PUBLIC] useLocalStorage
  // Whether or not user credentials and Bridge configuration will be persisted to local storage.
  self.useLocalStorage = false;

  // [PUBLIC] user
  // The User object returned by the the database relating to the current identity.
  self.user = null;


  ////////////
  // EVENTS //
  ////////////

  // [PUBLIC] onChangePasswordCalled()
  // The callback to call when the requestChangePassword() function is called.
  // Signature: function () {}
  self.onChangePasswordCalled = null;

  // [PUBLIC] onForgotPasswordCalled()
  // The callback to call when the requestForgotPassword() function is called.
  // Signature: function ( email ) {}
  self.onForgotPasswordCalled = null;

  // [PUBLIC] onLoginCalled()
  // The callback to call when the requestLogin() function is called.
  // Signature: function ( email, useLocalStorage ) {}
  self.onLoginCalled = null;

  // [PUBLIC] loginErrorCallback()
  // The callback to call when the logout() function is called.
  // Signature: function () {}
  self.onLogoutCalled = null;

  // [PUBLIC] onRecoverPasswordCalled()
  // The callback to call when the requestRecoverPassword() function is called.
  // Signature: function ( email, hash ) {}
  self.onRecoverPasswordCalled = null;

  // [PUBLIC] onRegisterCalled()
  // The callback to call when the requestRegister() function is called.
  // Signature: function ( email, firstName, lastName, appData ) {}
  self.onRegisterCalled = null;

  // [PUBLIC] requestCallback()
  // The callback to call when a request() call occurs, but before it is sent.
  // Signature: function ( method, resource, payload ) {}
  self.onRequestCalled = null;

  // [PUBLIC] onVerifyEmailCalled()
  // The callback to call when the requestVerifyEmail() function is called.
  // Signature: function ( email, hash ) {}
  self.onVerifyEmailCalled = null;


  //////////
  // INIT //
  //////////

  // [PUBLIC] init()
  // Configure theb Bridge with a new URL and timeout.
  self.init = function ( url, timeout ) {

    self.url = url;
    self.timeout = timeout;

  };


  ///////////////
  // FUNCTIONS //
  ///////////////

  // [PUBLIC] isErrorCodeResponse()
  // Returns an Error object if the provided jqXHR has a status code between 400 and 599
  // (inclusive). Since the 400 and 500 series status codes represent errors of various kinds,
  // this acts as a catch-all filter for common error cases to be handled by the client.
  // Returns null if the response status is not between 400 and 599 (inclusive).
  // Error format: { status: 404, message: "The resource you requested was not found." }
  self.isErrorCodeResponse = function ( jqXHR ) {

    // Return an Error object if the status code is between 400 and 599 (inclusive).
    if ( jqXHR.status >= 400 && jqXHR.status < 600 ) {

      switch ( jqXHR.status ) {
      case 400:
        return {
          status: 400,
          message: '400 (Bad Request) >> Your request was not formatted correctly.'
        };
      case 401:
        return {
          status: 401,
          message: '401 (Unauthorized) >> You do not have sufficient priveliges to perform this operation.'
        };
      case 403:
        return {
          status: 403,
          message: '403 (Forbidden) >> Your email and password do not match any user on file.'
        };
      case 404:
        return {
          status: 404,
          message: '404 (Not Found) >> The resource you requested does not exist.'
        };
      case 409:
        return {
          status: 409,
          message: '409 (Conflict) >> A unique database field matching your PUT may already exist.'
        };
      case 500:
        return {
          status: 500,
          message: '500 (Internal Server Error) >> An error has taken place in the Bridge server.'
        };
      case 503:
        return {
          status: 503,
          message: '503 (Service Unavailable) >> The Bridge server may be stopped.'
        };
      default:
        return {
          status: jqXHR.status,
          message: 'Error! Something went wrong!'
        };
      }
    }

    // Return null for no error code.
    return null;

  };

  // [PUBLIC] isLoggedIn()
  // Check if there is currently a user object set. If no user object is set, then none
  // was returned from the login attempt (and the user is still logged out) or the user 
  // logged out manually.
  self.isLoggedIn = function () {

    return ( self.user !== null );

  };

  // [PUBLIC] logout()
  // Set the user object to null and clear the Identity object user to sign requests for
  // authentication purposes, so that the logged-out user's credentials can't still be
  // user to authorize requests.
  self.logout = function () {

    // Delete the Identity object to preserve the user's password security.
    clearIdentity();

    // Clear the user so Bridge reports that it is logged out.
    clearUser();

    // Clear the identity from local storage to preserve the user's password security.
    // If no identity is stored, this will do nothing.
    jQuery.jStorage.deleteKey( 'bridge-client-identity' );

    // Notify the user of the logout action.
    if ( typeof self.onLogoutCalled === 'function' ) {
      self.onLogoutCalled();
    }

  };

  // [PUBLIC] request()
  // Sends an XHR request using jQuery.ajax() to the given API resource using the given 
  // HTTP method. The HTTP request body will be set to the JSON.stringify()ed request 
  // that is generated by the Identity object set to perform HMAC signing.
  // Returns a jQuery jqZHR object. See http://api.jquery.com/jQuery.ajax/#jqXHR.
  // If no Identity is set, sendRequest() returns null, indicating no request was sent.
  self.request = function ( method, resource, payload ) {

    return requestPrivate( method, resource, payload, null );

  };

  // [PUBLIC] requestChangePassword()
  // The public requestChangePassword() function used to hide requestChangePasswordPrivate().
  self.requestChangePassword = function ( oldPassword, newPassword ) {

    return requestChangePasswordPrivate( oldPassword, newPassword );

  };

  // [PUBLIC] requestForgotPassword()
  // The public requestForgotPassword() function used to hide requestForgotPasswordPrivate().
  self.requestForgotPassword = function ( email ) {

    return requestForgotPasswordPrivate( email );

  };

  // [PUBLIC] requestLogin()
  // The public requestLogin() function used to hide requestLoginPrivate().
  self.requestLogin = function ( email, password, useLocalStorage ) {

    return requestLoginPrivate( email, password, useLocalStorage, false );

  };

  // [PUBLIC] requestLoginStoredIdentity()
  // Checks the browser's local storage for an existing user and performs a login request
  // using the stored credentials if one is found. Returns a jQuery Deferred object if a login 
  // request was sent and null if no stored identity was found / login request was sent.
  self.requestLoginStoredIdentity = function () {

    // Check if an identity is in local storage to use for authentication.
    var storedIdentity = jQuery.jStorage.get( 'bridge-client-identity', null );
    if ( storedIdentity !== null ) {

      var parsedIdentity = JSON.parse( storedIdentity );

      if ( self.debug === true ) {
        console.log( "Stoed identity: " + JSON.stringify( parsedIdentity ) );
      }

      // Send a login request using the private login call and return the deferred object
      return requestLoginPrivate( parsedIdentity.email, parsedIdentity.password, true, true );

    }

    // No login request was sent, so return null.
    return null;

  };

  // [PUBLIC] requestRecoverPassword()
  // The public requestRecoverPassword() function used to hide requestRecoverPasswordPrivate().
  self.requestRecoverPassword = function ( email, password, hash ) {

    return requestRecoverPasswordPrivate( email, password, hash );

  };

  // [PUBLIC] requestRegister()
  // The public requestRegister() function used to hide requestRegisterPrivate().
  self.requestRegister = function ( email, password, firstName, lastName, appData ) {

    return requestRegisterPrivate( email, password, firstName, lastName, appData );

  };

  // [PUBLIC] requestVerifyEmail()
  // The public requestVerifyEmail() function used to hide requestVerifyEmailPrivate().
  self.requestVerifyEmail = function ( email, hash ) {

    return requestVerifyEmailPrivate( email, hash );

  };

  return self;

};
},{"./Identity":2,"./include/crypto-js/enc-hex":4,"./include/crypto-js/sha256":7,"./include/json3":8,"./include/jstorage":9}],2:[function(_dereq_,module,exports){
// Include dependencies
var enc_hex = _dereq_( './include/crypto-js/enc-hex' );
var hmac_sha256 = _dereq_( './include/crypto-js/hmac-sha256' );
var json3 = _dereq_( './include/json3' );

// [Identity Constructor]
// The Identity object represents an email/password pair used as identification with the
// database to provide authenication for requests. The Identity is used as a request factory
// to create requests that will authenticate the with the server securely.
module.exports = function ( email, password, dontHashPassword ) {

  'use strict';

  // The object to be returned from the factory
  var self = {};

  ///////////////////////////////////////////////////////////////////////////////////////////////////
  // PRIVATE ////////////////////////////////////////////////////////////////////////////////////////
  ///////////////////////////////////////////////////////////////////////////////////////////////////

  ////////////////
  // PROPERTIES //
  ////////////////

  // [PRIVATE] hashedPassword
  // The SHA-256 encoded string generated by hashing the given password. 
  // [SECURITY NOTE 1] By hashing the password we store in memory and keeping it local to 
  // this function, we protect the user's password from scrutiny from other local applications.
  // The password supplied as a constructor argument will also be nulled so that it is not kept 
  // in application memory either, so that the original password information is lost.
  // [SECURITY NOTE 4] If dontHashPassword is set to true, this hashing process is skipped. This 
  // feature exists to allow passwords stored in local storage to be used for authentication, since 
  // they have already been hased in this way. DO NOT USE THIS FOR ANYTHING ELSE!
  var hashedPassword = ( dontHashPassword === true ) ? password : 
    hmac_sha256( password ).toString( enc_hex );

  // [SECURITY NOTE 2] The user's given password should be forgotten once it has been hashed.
  // Although the password is local to this constructor, it is better that it not even be 
  // available in memory once it has been hashed, since the hashed password is much more 
  // difficult to recover in its original form.
  password = null;


  ///////////////
  // FUNCTIONS //
  ///////////////

  // [PRIVATE] hmacSignRequestBody()
  // Returns the given request object after adding the "hmac" property to it and setting "hmac" 
  // by using the user's password as a SHA-256 HMAC hashing secret.
  // [SECURITY NOTE 3] The HMAC string is a hex value, 64 characters in length. It is created 
  // by concatenating the JSON.stringify()ed request content, the request email, and the request 
  // time together, and hashing the result using hashedPassword as a salt. 
  //
  // Pseudocode:
  // toHash = Request Content JSON + Request Email + Request Time JSON
  // salt = hashedPassword
  // hmacString = sha256( toHash, salt )
  // request.hmac = hmacString
  // 
  // By performing the same operation on the data, the server can confirm that the HMAC strings 
  // are identical and authorize the request.
  var hmacSignRequestBody = function ( reqBody ) {

    // Create the concatenated string to be hashed as the HMAC
    var content = JSON.stringify( reqBody.content );
    var email = reqBody.email;
    var time = reqBody.time.toISOString();
    var concat = content + email + time;

    // Add the 'hmac' property to the request with a value computed by salting the concat with the
    // user's hashedPassword.
    // [CAREFUL] hashedPassword should be a string. If it isn't, terrible things WILL happen!
    reqBody.hmac = hmac_sha256( concat, hashedPassword ).toString( enc_hex );

    if ( Bridge.debug === true ) {
      console.log( '=== HMAC Signing Process ===' );
      console.log( 'Hashpass: "' + hashedPassword + '"' );
      console.log( 'Content: "' + content + '"' );
      console.log( 'Email: "' + email + '"' );
      console.log( 'Time: "' + time + '"' );
      console.log( 'Concat: "' + concat + '"' );
      console.log( 'HMAC: "' + reqBody.hmac + '"' );
      console.log( '============================' );
    }

    return reqBody;

  };


  ///////////////////////////////////////////////////////////////////////////////////////////////////
  // PUBLIC /////////////////////////////////////////////////////////////////////////////////////////
  ///////////////////////////////////////////////////////////////////////////////////////////////////

  ////////////////
  // PROPERTIES //
  ////////////////

  // [PUBLIC] email
  // The email used to identify the user within the database.
  self.email = email;


  ///////////////
  // FUNCTIONS //
  ///////////////

  // [PUBLIC] createRequest()
  // Returns a new request, given the content payload of the request as an object. Utilizes
  // hmacSignRequest() to wrap the given payload in an appropriate header to validate against the
  // server-side authorization scheme (assuming the user credentials are correct).
  self.createRequest = function ( payload ) {

    return hmacSignRequestBody( {
      'content': payload,
      'email': email,
      'time': new Date()
    } );

  };

  return self;

};
},{"./include/crypto-js/enc-hex":4,"./include/crypto-js/hmac-sha256":5,"./include/json3":8}],3:[function(_dereq_,module,exports){
;(function (root, factory) {
	if (typeof exports === "object") {
		// CommonJS
		module.exports = exports = factory();
	}
	else if (typeof define === "function" && define.amd) {
		// AMD
		define([], factory);
	}
	else {
		// Global (browser)
		root.CryptoJS = factory();
	}
}(this, function () {

	/**
	 * CryptoJS core components.
	 */
	var CryptoJS = CryptoJS || (function (Math, undefined) {
	    /**
	     * CryptoJS namespace.
	     */
	    var C = {};

	    /**
	     * Library namespace.
	     */
	    var C_lib = C.lib = {};

	    /**
	     * Base object for prototypal inheritance.
	     */
	    var Base = C_lib.Base = (function () {
	        function F() {}

	        return {
	            /**
	             * Creates a new object that inherits from this object.
	             *
	             * @param {Object} overrides Properties to copy into the new object.
	             *
	             * @return {Object} The new object.
	             *
	             * @static
	             *
	             * @example
	             *
	             *     var MyType = CryptoJS.lib.Base.extend({
	             *         field: 'value',
	             *
	             *         method: function () {
	             *         }
	             *     });
	             */
	            extend: function (overrides) {
	                // Spawn
	                F.prototype = this;
	                var subtype = new F();

	                // Augment
	                if (overrides) {
	                    subtype.mixIn(overrides);
	                }

	                // Create default initializer
	                if (!subtype.hasOwnProperty('init')) {
	                    subtype.init = function () {
	                        subtype.$super.init.apply(this, arguments);
	                    };
	                }

	                // Initializer's prototype is the subtype object
	                subtype.init.prototype = subtype;

	                // Reference supertype
	                subtype.$super = this;

	                return subtype;
	            },

	            /**
	             * Extends this object and runs the init method.
	             * Arguments to create() will be passed to init().
	             *
	             * @return {Object} The new object.
	             *
	             * @static
	             *
	             * @example
	             *
	             *     var instance = MyType.create();
	             */
	            create: function () {
	                var instance = this.extend();
	                instance.init.apply(instance, arguments);

	                return instance;
	            },

	            /**
	             * Initializes a newly created object.
	             * Override this method to add some logic when your objects are created.
	             *
	             * @example
	             *
	             *     var MyType = CryptoJS.lib.Base.extend({
	             *         init: function () {
	             *             // ...
	             *         }
	             *     });
	             */
	            init: function () {
	            },

	            /**
	             * Copies properties into this object.
	             *
	             * @param {Object} properties The properties to mix in.
	             *
	             * @example
	             *
	             *     MyType.mixIn({
	             *         field: 'value'
	             *     });
	             */
	            mixIn: function (properties) {
	                for (var propertyName in properties) {
	                    if (properties.hasOwnProperty(propertyName)) {
	                        this[propertyName] = properties[propertyName];
	                    }
	                }

	                // IE won't copy toString using the loop above
	                if (properties.hasOwnProperty('toString')) {
	                    this.toString = properties.toString;
	                }
	            },

	            /**
	             * Creates a copy of this object.
	             *
	             * @return {Object} The clone.
	             *
	             * @example
	             *
	             *     var clone = instance.clone();
	             */
	            clone: function () {
	                return this.init.prototype.extend(this);
	            }
	        };
	    }());

	    /**
	     * An array of 32-bit words.
	     *
	     * @property {Array} words The array of 32-bit words.
	     * @property {number} sigBytes The number of significant bytes in this word array.
	     */
	    var WordArray = C_lib.WordArray = Base.extend({
	        /**
	         * Initializes a newly created word array.
	         *
	         * @param {Array} words (Optional) An array of 32-bit words.
	         * @param {number} sigBytes (Optional) The number of significant bytes in the words.
	         *
	         * @example
	         *
	         *     var wordArray = CryptoJS.lib.WordArray.create();
	         *     var wordArray = CryptoJS.lib.WordArray.create([0x00010203, 0x04050607]);
	         *     var wordArray = CryptoJS.lib.WordArray.create([0x00010203, 0x04050607], 6);
	         */
	        init: function (words, sigBytes) {
	            words = this.words = words || [];

	            if (sigBytes != undefined) {
	                this.sigBytes = sigBytes;
	            } else {
	                this.sigBytes = words.length * 4;
	            }
	        },

	        /**
	         * Converts this word array to a string.
	         *
	         * @param {Encoder} encoder (Optional) The encoding strategy to use. Default: CryptoJS.enc.Hex
	         *
	         * @return {string} The stringified word array.
	         *
	         * @example
	         *
	         *     var string = wordArray + '';
	         *     var string = wordArray.toString();
	         *     var string = wordArray.toString(CryptoJS.enc.Utf8);
	         */
	        toString: function (encoder) {
	            return (encoder || Hex).stringify(this);
	        },

	        /**
	         * Concatenates a word array to this word array.
	         *
	         * @param {WordArray} wordArray The word array to append.
	         *
	         * @return {WordArray} This word array.
	         *
	         * @example
	         *
	         *     wordArray1.concat(wordArray2);
	         */
	        concat: function (wordArray) {
	            // Shortcuts
	            var thisWords = this.words;
	            var thatWords = wordArray.words;
	            var thisSigBytes = this.sigBytes;
	            var thatSigBytes = wordArray.sigBytes;

	            // Clamp excess bits
	            this.clamp();

	            // Concat
	            if (thisSigBytes % 4) {
	                // Copy one byte at a time
	                for (var i = 0; i < thatSigBytes; i++) {
	                    var thatByte = (thatWords[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
	                    thisWords[(thisSigBytes + i) >>> 2] |= thatByte << (24 - ((thisSigBytes + i) % 4) * 8);
	                }
	            } else if (thatWords.length > 0xffff) {
	                // Copy one word at a time
	                for (var i = 0; i < thatSigBytes; i += 4) {
	                    thisWords[(thisSigBytes + i) >>> 2] = thatWords[i >>> 2];
	                }
	            } else {
	                // Copy all words at once
	                thisWords.push.apply(thisWords, thatWords);
	            }
	            this.sigBytes += thatSigBytes;

	            // Chainable
	            return this;
	        },

	        /**
	         * Removes insignificant bits.
	         *
	         * @example
	         *
	         *     wordArray.clamp();
	         */
	        clamp: function () {
	            // Shortcuts
	            var words = this.words;
	            var sigBytes = this.sigBytes;

	            // Clamp
	            words[sigBytes >>> 2] &= 0xffffffff << (32 - (sigBytes % 4) * 8);
	            words.length = Math.ceil(sigBytes / 4);
	        },

	        /**
	         * Creates a copy of this word array.
	         *
	         * @return {WordArray} The clone.
	         *
	         * @example
	         *
	         *     var clone = wordArray.clone();
	         */
	        clone: function () {
	            var clone = Base.clone.call(this);
	            clone.words = this.words.slice(0);

	            return clone;
	        },

	        /**
	         * Creates a word array filled with random bytes.
	         *
	         * @param {number} nBytes The number of random bytes to generate.
	         *
	         * @return {WordArray} The random word array.
	         *
	         * @static
	         *
	         * @example
	         *
	         *     var wordArray = CryptoJS.lib.WordArray.random(16);
	         */
	        random: function (nBytes) {
	            var words = [];

	            var r = (function (m_w) {
	                var m_w = m_w;
	                var m_z = 0x3ade68b1;
	                var mask = 0xffffffff;

	                return function () {
	                    m_z = (0x9069 * (m_z & 0xFFFF) + (m_z >> 0x10)) & mask;
	                    m_w = (0x4650 * (m_w & 0xFFFF) + (m_w >> 0x10)) & mask;
	                    var result = ((m_z << 0x10) + m_w) & mask;
	                    result /= 0x100000000;
	                    result += 0.5;
	                    return result * (Math.random() > .5 ? 1 : -1);
	                }
	            });

	            for (var i = 0, rcache; i < nBytes; i += 4) {
	                var _r = r((rcache || Math.random()) * 0x100000000);

	                rcache = _r() * 0x3ade67b7;
	                words.push((_r() * 0x100000000) | 0);
	            }

	            return new WordArray.init(words, nBytes);
	        }
	    });

	    /**
	     * Encoder namespace.
	     */
	    var C_enc = C.enc = {};

	    /**
	     * Hex encoding strategy.
	     */
	    var Hex = C_enc.Hex = {
	        /**
	         * Converts a word array to a hex string.
	         *
	         * @param {WordArray} wordArray The word array.
	         *
	         * @return {string} The hex string.
	         *
	         * @static
	         *
	         * @example
	         *
	         *     var hexString = CryptoJS.enc.Hex.stringify(wordArray);
	         */
	        stringify: function (wordArray) {
	            // Shortcuts
	            var words = wordArray.words;
	            var sigBytes = wordArray.sigBytes;

	            // Convert
	            var hexChars = [];
	            for (var i = 0; i < sigBytes; i++) {
	                var bite = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
	                hexChars.push((bite >>> 4).toString(16));
	                hexChars.push((bite & 0x0f).toString(16));
	            }

	            return hexChars.join('');
	        },

	        /**
	         * Converts a hex string to a word array.
	         *
	         * @param {string} hexStr The hex string.
	         *
	         * @return {WordArray} The word array.
	         *
	         * @static
	         *
	         * @example
	         *
	         *     var wordArray = CryptoJS.enc.Hex.parse(hexString);
	         */
	        parse: function (hexStr) {
	            // Shortcut
	            var hexStrLength = hexStr.length;

	            // Convert
	            var words = [];
	            for (var i = 0; i < hexStrLength; i += 2) {
	                words[i >>> 3] |= parseInt(hexStr.substr(i, 2), 16) << (24 - (i % 8) * 4);
	            }

	            return new WordArray.init(words, hexStrLength / 2);
	        }
	    };

	    /**
	     * Latin1 encoding strategy.
	     */
	    var Latin1 = C_enc.Latin1 = {
	        /**
	         * Converts a word array to a Latin1 string.
	         *
	         * @param {WordArray} wordArray The word array.
	         *
	         * @return {string} The Latin1 string.
	         *
	         * @static
	         *
	         * @example
	         *
	         *     var latin1String = CryptoJS.enc.Latin1.stringify(wordArray);
	         */
	        stringify: function (wordArray) {
	            // Shortcuts
	            var words = wordArray.words;
	            var sigBytes = wordArray.sigBytes;

	            // Convert
	            var latin1Chars = [];
	            for (var i = 0; i < sigBytes; i++) {
	                var bite = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
	                latin1Chars.push(String.fromCharCode(bite));
	            }

	            return latin1Chars.join('');
	        },

	        /**
	         * Converts a Latin1 string to a word array.
	         *
	         * @param {string} latin1Str The Latin1 string.
	         *
	         * @return {WordArray} The word array.
	         *
	         * @static
	         *
	         * @example
	         *
	         *     var wordArray = CryptoJS.enc.Latin1.parse(latin1String);
	         */
	        parse: function (latin1Str) {
	            // Shortcut
	            var latin1StrLength = latin1Str.length;

	            // Convert
	            var words = [];
	            for (var i = 0; i < latin1StrLength; i++) {
	                words[i >>> 2] |= (latin1Str.charCodeAt(i) & 0xff) << (24 - (i % 4) * 8);
	            }

	            return new WordArray.init(words, latin1StrLength);
	        }
	    };

	    /**
	     * UTF-8 encoding strategy.
	     */
	    var Utf8 = C_enc.Utf8 = {
	        /**
	         * Converts a word array to a UTF-8 string.
	         *
	         * @param {WordArray} wordArray The word array.
	         *
	         * @return {string} The UTF-8 string.
	         *
	         * @static
	         *
	         * @example
	         *
	         *     var utf8String = CryptoJS.enc.Utf8.stringify(wordArray);
	         */
	        stringify: function (wordArray) {
	            try {
	                return decodeURIComponent(escape(Latin1.stringify(wordArray)));
	            } catch (e) {
	                throw new Error('Malformed UTF-8 data');
	            }
	        },

	        /**
	         * Converts a UTF-8 string to a word array.
	         *
	         * @param {string} utf8Str The UTF-8 string.
	         *
	         * @return {WordArray} The word array.
	         *
	         * @static
	         *
	         * @example
	         *
	         *     var wordArray = CryptoJS.enc.Utf8.parse(utf8String);
	         */
	        parse: function (utf8Str) {
	            return Latin1.parse(unescape(encodeURIComponent(utf8Str)));
	        }
	    };

	    /**
	     * Abstract buffered block algorithm template.
	     *
	     * The property blockSize must be implemented in a concrete subtype.
	     *
	     * @property {number} _minBufferSize The number of blocks that should be kept unprocessed in the buffer. Default: 0
	     */
	    var BufferedBlockAlgorithm = C_lib.BufferedBlockAlgorithm = Base.extend({
	        /**
	         * Resets this block algorithm's data buffer to its initial state.
	         *
	         * @example
	         *
	         *     bufferedBlockAlgorithm.reset();
	         */
	        reset: function () {
	            // Initial values
	            this._data = new WordArray.init();
	            this._nDataBytes = 0;
	        },

	        /**
	         * Adds new data to this block algorithm's buffer.
	         *
	         * @param {WordArray|string} data The data to append. Strings are converted to a WordArray using UTF-8.
	         *
	         * @example
	         *
	         *     bufferedBlockAlgorithm._append('data');
	         *     bufferedBlockAlgorithm._append(wordArray);
	         */
	        _append: function (data) {
	            // Convert string to WordArray, else assume WordArray already
	            if (typeof data == 'string') {
	                data = Utf8.parse(data);
	            }

	            // Append
	            this._data.concat(data);
	            this._nDataBytes += data.sigBytes;
	        },

	        /**
	         * Processes available data blocks.
	         *
	         * This method invokes _doProcessBlock(offset), which must be implemented by a concrete subtype.
	         *
	         * @param {boolean} doFlush Whether all blocks and partial blocks should be processed.
	         *
	         * @return {WordArray} The processed data.
	         *
	         * @example
	         *
	         *     var processedData = bufferedBlockAlgorithm._process();
	         *     var processedData = bufferedBlockAlgorithm._process(!!'flush');
	         */
	        _process: function (doFlush) {
	            // Shortcuts
	            var data = this._data;
	            var dataWords = data.words;
	            var dataSigBytes = data.sigBytes;
	            var blockSize = this.blockSize;
	            var blockSizeBytes = blockSize * 4;

	            // Count blocks ready
	            var nBlocksReady = dataSigBytes / blockSizeBytes;
	            if (doFlush) {
	                // Round up to include partial blocks
	                nBlocksReady = Math.ceil(nBlocksReady);
	            } else {
	                // Round down to include only full blocks,
	                // less the number of blocks that must remain in the buffer
	                nBlocksReady = Math.max((nBlocksReady | 0) - this._minBufferSize, 0);
	            }

	            // Count words ready
	            var nWordsReady = nBlocksReady * blockSize;

	            // Count bytes ready
	            var nBytesReady = Math.min(nWordsReady * 4, dataSigBytes);

	            // Process blocks
	            if (nWordsReady) {
	                for (var offset = 0; offset < nWordsReady; offset += blockSize) {
	                    // Perform concrete-algorithm logic
	                    this._doProcessBlock(dataWords, offset);
	                }

	                // Remove processed words
	                var processedWords = dataWords.splice(0, nWordsReady);
	                data.sigBytes -= nBytesReady;
	            }

	            // Return processed words
	            return new WordArray.init(processedWords, nBytesReady);
	        },

	        /**
	         * Creates a copy of this object.
	         *
	         * @return {Object} The clone.
	         *
	         * @example
	         *
	         *     var clone = bufferedBlockAlgorithm.clone();
	         */
	        clone: function () {
	            var clone = Base.clone.call(this);
	            clone._data = this._data.clone();

	            return clone;
	        },

	        _minBufferSize: 0
	    });

	    /**
	     * Abstract hasher template.
	     *
	     * @property {number} blockSize The number of 32-bit words this hasher operates on. Default: 16 (512 bits)
	     */
	    var Hasher = C_lib.Hasher = BufferedBlockAlgorithm.extend({
	        /**
	         * Configuration options.
	         */
	        cfg: Base.extend(),

	        /**
	         * Initializes a newly created hasher.
	         *
	         * @param {Object} cfg (Optional) The configuration options to use for this hash computation.
	         *
	         * @example
	         *
	         *     var hasher = CryptoJS.algo.SHA256.create();
	         */
	        init: function (cfg) {
	            // Apply config defaults
	            this.cfg = this.cfg.extend(cfg);

	            // Set initial values
	            this.reset();
	        },

	        /**
	         * Resets this hasher to its initial state.
	         *
	         * @example
	         *
	         *     hasher.reset();
	         */
	        reset: function () {
	            // Reset data buffer
	            BufferedBlockAlgorithm.reset.call(this);

	            // Perform concrete-hasher logic
	            this._doReset();
	        },

	        /**
	         * Updates this hasher with a message.
	         *
	         * @param {WordArray|string} messageUpdate The message to append.
	         *
	         * @return {Hasher} This hasher.
	         *
	         * @example
	         *
	         *     hasher.update('message');
	         *     hasher.update(wordArray);
	         */
	        update: function (messageUpdate) {
	            // Append
	            this._append(messageUpdate);

	            // Update the hash
	            this._process();

	            // Chainable
	            return this;
	        },

	        /**
	         * Finalizes the hash computation.
	         * Note that the finalize operation is effectively a destructive, read-once operation.
	         *
	         * @param {WordArray|string} messageUpdate (Optional) A final message update.
	         *
	         * @return {WordArray} The hash.
	         *
	         * @example
	         *
	         *     var hash = hasher.finalize();
	         *     var hash = hasher.finalize('message');
	         *     var hash = hasher.finalize(wordArray);
	         */
	        finalize: function (messageUpdate) {
	            // Final message update
	            if (messageUpdate) {
	                this._append(messageUpdate);
	            }

	            // Perform concrete-hasher logic
	            var hash = this._doFinalize();

	            return hash;
	        },

	        blockSize: 512/32,

	        /**
	         * Creates a shortcut function to a hasher's object interface.
	         *
	         * @param {Hasher} hasher The hasher to create a helper for.
	         *
	         * @return {Function} The shortcut function.
	         *
	         * @static
	         *
	         * @example
	         *
	         *     var SHA256 = CryptoJS.lib.Hasher._createHelper(CryptoJS.algo.SHA256);
	         */
	        _createHelper: function (hasher) {
	            return function (message, cfg) {
	                return new hasher.init(cfg).finalize(message);
	            };
	        },

	        /**
	         * Creates a shortcut function to the HMAC's object interface.
	         *
	         * @param {Hasher} hasher The hasher to use in this HMAC helper.
	         *
	         * @return {Function} The shortcut function.
	         *
	         * @static
	         *
	         * @example
	         *
	         *     var HmacSHA256 = CryptoJS.lib.Hasher._createHmacHelper(CryptoJS.algo.SHA256);
	         */
	        _createHmacHelper: function (hasher) {
	            return function (message, key) {
	                return new C_algo.HMAC.init(hasher, key).finalize(message);
	            };
	        }
	    });

	    /**
	     * Algorithm namespace.
	     */
	    var C_algo = C.algo = {};

	    return C;
	}(Math));


	return CryptoJS;

}));
},{}],4:[function(_dereq_,module,exports){
;(function (root, factory) {
	if (typeof exports === "object") {
		// CommonJS
		module.exports = exports = factory(_dereq_("./core"));
	}
	else if (typeof define === "function" && define.amd) {
		// AMD
		define(["./core"], factory);
	}
	else {
		// Global (browser)
		factory(root.CryptoJS);
	}
}(this, function (CryptoJS) {

	return CryptoJS.enc.Hex;

}));
},{"./core":3}],5:[function(_dereq_,module,exports){
;(function (root, factory, undef) {
	if (typeof exports === "object") {
		// CommonJS
		module.exports = exports = factory(_dereq_("./core"), _dereq_("./sha256"), _dereq_("./hmac"));
	}
	else if (typeof define === "function" && define.amd) {
		// AMD
		define(["./core", "./sha256", "./hmac"], factory);
	}
	else {
		// Global (browser)
		factory(root.CryptoJS);
	}
}(this, function (CryptoJS) {

	return CryptoJS.HmacSHA256;

}));
},{"./core":3,"./hmac":6,"./sha256":7}],6:[function(_dereq_,module,exports){
;(function (root, factory) {
	if (typeof exports === "object") {
		// CommonJS
		module.exports = exports = factory(_dereq_("./core"));
	}
	else if (typeof define === "function" && define.amd) {
		// AMD
		define(["./core"], factory);
	}
	else {
		// Global (browser)
		factory(root.CryptoJS);
	}
}(this, function (CryptoJS) {

	(function () {
	    // Shortcuts
	    var C = CryptoJS;
	    var C_lib = C.lib;
	    var Base = C_lib.Base;
	    var C_enc = C.enc;
	    var Utf8 = C_enc.Utf8;
	    var C_algo = C.algo;

	    /**
	     * HMAC algorithm.
	     */
	    var HMAC = C_algo.HMAC = Base.extend({
	        /**
	         * Initializes a newly created HMAC.
	         *
	         * @param {Hasher} hasher The hash algorithm to use.
	         * @param {WordArray|string} key The secret key.
	         *
	         * @example
	         *
	         *     var hmacHasher = CryptoJS.algo.HMAC.create(CryptoJS.algo.SHA256, key);
	         */
	        init: function (hasher, key) {
	            // Init hasher
	            hasher = this._hasher = new hasher.init();

	            // Convert string to WordArray, else assume WordArray already
	            if (typeof key == 'string') {
	                key = Utf8.parse(key);
	            }

	            // Shortcuts
	            var hasherBlockSize = hasher.blockSize;
	            var hasherBlockSizeBytes = hasherBlockSize * 4;

	            // Allow arbitrary length keys
	            if (key.sigBytes > hasherBlockSizeBytes) {
	                key = hasher.finalize(key);
	            }

	            // Clamp excess bits
	            key.clamp();

	            // Clone key for inner and outer pads
	            var oKey = this._oKey = key.clone();
	            var iKey = this._iKey = key.clone();

	            // Shortcuts
	            var oKeyWords = oKey.words;
	            var iKeyWords = iKey.words;

	            // XOR keys with pad constants
	            for (var i = 0; i < hasherBlockSize; i++) {
	                oKeyWords[i] ^= 0x5c5c5c5c;
	                iKeyWords[i] ^= 0x36363636;
	            }
	            oKey.sigBytes = iKey.sigBytes = hasherBlockSizeBytes;

	            // Set initial values
	            this.reset();
	        },

	        /**
	         * Resets this HMAC to its initial state.
	         *
	         * @example
	         *
	         *     hmacHasher.reset();
	         */
	        reset: function () {
	            // Shortcut
	            var hasher = this._hasher;

	            // Reset
	            hasher.reset();
	            hasher.update(this._iKey);
	        },

	        /**
	         * Updates this HMAC with a message.
	         *
	         * @param {WordArray|string} messageUpdate The message to append.
	         *
	         * @return {HMAC} This HMAC instance.
	         *
	         * @example
	         *
	         *     hmacHasher.update('message');
	         *     hmacHasher.update(wordArray);
	         */
	        update: function (messageUpdate) {
	            this._hasher.update(messageUpdate);

	            // Chainable
	            return this;
	        },

	        /**
	         * Finalizes the HMAC computation.
	         * Note that the finalize operation is effectively a destructive, read-once operation.
	         *
	         * @param {WordArray|string} messageUpdate (Optional) A final message update.
	         *
	         * @return {WordArray} The HMAC.
	         *
	         * @example
	         *
	         *     var hmac = hmacHasher.finalize();
	         *     var hmac = hmacHasher.finalize('message');
	         *     var hmac = hmacHasher.finalize(wordArray);
	         */
	        finalize: function (messageUpdate) {
	            // Shortcut
	            var hasher = this._hasher;

	            // Compute HMAC
	            var innerHash = hasher.finalize(messageUpdate);
	            hasher.reset();
	            var hmac = hasher.finalize(this._oKey.clone().concat(innerHash));

	            return hmac;
	        }
	    });
	}());


}));
},{"./core":3}],7:[function(_dereq_,module,exports){
;(function (root, factory) {
	if (typeof exports === "object") {
		// CommonJS
		module.exports = exports = factory(_dereq_("./core"));
	}
	else if (typeof define === "function" && define.amd) {
		// AMD
		define(["./core"], factory);
	}
	else {
		// Global (browser)
		factory(root.CryptoJS);
	}
}(this, function (CryptoJS) {

	(function (Math) {
	    // Shortcuts
	    var C = CryptoJS;
	    var C_lib = C.lib;
	    var WordArray = C_lib.WordArray;
	    var Hasher = C_lib.Hasher;
	    var C_algo = C.algo;

	    // Initialization and round constants tables
	    var H = [];
	    var K = [];

	    // Compute constants
	    (function () {
	        function isPrime(n) {
	            var sqrtN = Math.sqrt(n);
	            for (var factor = 2; factor <= sqrtN; factor++) {
	                if (!(n % factor)) {
	                    return false;
	                }
	            }

	            return true;
	        }

	        function getFractionalBits(n) {
	            return ((n - (n | 0)) * 0x100000000) | 0;
	        }

	        var n = 2;
	        var nPrime = 0;
	        while (nPrime < 64) {
	            if (isPrime(n)) {
	                if (nPrime < 8) {
	                    H[nPrime] = getFractionalBits(Math.pow(n, 1 / 2));
	                }
	                K[nPrime] = getFractionalBits(Math.pow(n, 1 / 3));

	                nPrime++;
	            }

	            n++;
	        }
	    }());

	    // Reusable object
	    var W = [];

	    /**
	     * SHA-256 hash algorithm.
	     */
	    var SHA256 = C_algo.SHA256 = Hasher.extend({
	        _doReset: function () {
	            this._hash = new WordArray.init(H.slice(0));
	        },

	        _doProcessBlock: function (M, offset) {
	            // Shortcut
	            var H = this._hash.words;

	            // Working variables
	            var a = H[0];
	            var b = H[1];
	            var c = H[2];
	            var d = H[3];
	            var e = H[4];
	            var f = H[5];
	            var g = H[6];
	            var h = H[7];

	            // Computation
	            for (var i = 0; i < 64; i++) {
	                if (i < 16) {
	                    W[i] = M[offset + i] | 0;
	                } else {
	                    var gamma0x = W[i - 15];
	                    var gamma0  = ((gamma0x << 25) | (gamma0x >>> 7))  ^
	                                  ((gamma0x << 14) | (gamma0x >>> 18)) ^
	                                   (gamma0x >>> 3);

	                    var gamma1x = W[i - 2];
	                    var gamma1  = ((gamma1x << 15) | (gamma1x >>> 17)) ^
	                                  ((gamma1x << 13) | (gamma1x >>> 19)) ^
	                                   (gamma1x >>> 10);

	                    W[i] = gamma0 + W[i - 7] + gamma1 + W[i - 16];
	                }

	                var ch  = (e & f) ^ (~e & g);
	                var maj = (a & b) ^ (a & c) ^ (b & c);

	                var sigma0 = ((a << 30) | (a >>> 2)) ^ ((a << 19) | (a >>> 13)) ^ ((a << 10) | (a >>> 22));
	                var sigma1 = ((e << 26) | (e >>> 6)) ^ ((e << 21) | (e >>> 11)) ^ ((e << 7)  | (e >>> 25));

	                var t1 = h + sigma1 + ch + K[i] + W[i];
	                var t2 = sigma0 + maj;

	                h = g;
	                g = f;
	                f = e;
	                e = (d + t1) | 0;
	                d = c;
	                c = b;
	                b = a;
	                a = (t1 + t2) | 0;
	            }

	            // Intermediate hash value
	            H[0] = (H[0] + a) | 0;
	            H[1] = (H[1] + b) | 0;
	            H[2] = (H[2] + c) | 0;
	            H[3] = (H[3] + d) | 0;
	            H[4] = (H[4] + e) | 0;
	            H[5] = (H[5] + f) | 0;
	            H[6] = (H[6] + g) | 0;
	            H[7] = (H[7] + h) | 0;
	        },

	        _doFinalize: function () {
	            // Shortcuts
	            var data = this._data;
	            var dataWords = data.words;

	            var nBitsTotal = this._nDataBytes * 8;
	            var nBitsLeft = data.sigBytes * 8;

	            // Add padding
	            dataWords[nBitsLeft >>> 5] |= 0x80 << (24 - nBitsLeft % 32);
	            dataWords[(((nBitsLeft + 64) >>> 9) << 4) + 14] = Math.floor(nBitsTotal / 0x100000000);
	            dataWords[(((nBitsLeft + 64) >>> 9) << 4) + 15] = nBitsTotal;
	            data.sigBytes = dataWords.length * 4;

	            // Hash final blocks
	            this._process();

	            // Return final computed hash
	            return this._hash;
	        },

	        clone: function () {
	            var clone = Hasher.clone.call(this);
	            clone._hash = this._hash.clone();

	            return clone;
	        }
	    });

	    /**
	     * Shortcut function to the hasher's object interface.
	     *
	     * @param {WordArray|string} message The message to hash.
	     *
	     * @return {WordArray} The hash.
	     *
	     * @static
	     *
	     * @example
	     *
	     *     var hash = CryptoJS.SHA256('message');
	     *     var hash = CryptoJS.SHA256(wordArray);
	     */
	    C.SHA256 = Hasher._createHelper(SHA256);

	    /**
	     * Shortcut function to the HMAC's object interface.
	     *
	     * @param {WordArray|string} message The message to hash.
	     * @param {WordArray|string} key The secret key.
	     *
	     * @return {WordArray} The HMAC.
	     *
	     * @static
	     *
	     * @example
	     *
	     *     var hmac = CryptoJS.HmacSHA256(message, key);
	     */
	    C.HmacSHA256 = Hasher._createHmacHelper(SHA256);
	}(Math));


	return CryptoJS.SHA256;

}));
},{"./core":3}],8:[function(_dereq_,module,exports){
(function (global){
/*! JSON v3.3.1 | http://bestiejs.github.io/json3 | Copyright 2012-2014, Kit Cambridge | http://kit.mit-license.org */
;(function () {
  // Detect the `define` function exposed by asynchronous module loaders. The
  // strict `define` check is necessary for compatibility with `r.js`.
  var isLoader = typeof define === "function" && define.amd;

  // A set of types used to distinguish objects from primitives.
  var objectTypes = {
    "function": true,
    "object": true
  };

  // Detect the `exports` object exposed by CommonJS implementations.
  var freeExports = objectTypes[typeof exports] && exports && !exports.nodeType && exports;

  // Use the `global` object exposed by Node (including Browserify via
  // `insert-module-globals`), Narwhal, and Ringo as the default context,
  // and the `window` object in browsers. Rhino exports a `global` function
  // instead.
  var root = objectTypes[typeof window] && window || this,
      freeGlobal = freeExports && objectTypes[typeof module] && module && !module.nodeType && typeof global == "object" && global;

  if (freeGlobal && (freeGlobal["global"] === freeGlobal || freeGlobal["window"] === freeGlobal || freeGlobal["self"] === freeGlobal)) {
    root = freeGlobal;
  }

  // Public: Initializes JSON 3 using the given `context` object, attaching the
  // `stringify` and `parse` functions to the specified `exports` object.
  function runInContext(context, exports) {
    context || (context = root["Object"]());
    exports || (exports = root["Object"]());

    // Native constructor aliases.
    var Number = context["Number"] || root["Number"],
        String = context["String"] || root["String"],
        Object = context["Object"] || root["Object"],
        Date = context["Date"] || root["Date"],
        SyntaxError = context["SyntaxError"] || root["SyntaxError"],
        TypeError = context["TypeError"] || root["TypeError"],
        Math = context["Math"] || root["Math"],
        nativeJSON = context["JSON"] || root["JSON"];

    // Delegate to the native `stringify` and `parse` implementations.
    if (typeof nativeJSON == "object" && nativeJSON) {
      exports.stringify = nativeJSON.stringify;
      exports.parse = nativeJSON.parse;
    }

    // Convenience aliases.
    var objectProto = Object.prototype,
        getClass = objectProto.toString,
        isProperty, forEach, undef;

    // Test the `Date#getUTC*` methods. Based on work by @Yaffle.
    var isExtended = new Date(-3509827334573292);
    try {
      // The `getUTCFullYear`, `Month`, and `Date` methods return nonsensical
      // results for certain dates in Opera >= 10.53.
      isExtended = isExtended.getUTCFullYear() == -109252 && isExtended.getUTCMonth() === 0 && isExtended.getUTCDate() === 1 &&
        // Safari < 2.0.2 stores the internal millisecond time value correctly,
        // but clips the values returned by the date methods to the range of
        // signed 32-bit integers ([-2 ** 31, 2 ** 31 - 1]).
        isExtended.getUTCHours() == 10 && isExtended.getUTCMinutes() == 37 && isExtended.getUTCSeconds() == 6 && isExtended.getUTCMilliseconds() == 708;
    } catch (exception) {}

    // Internal: Determines whether the native `JSON.stringify` and `parse`
    // implementations are spec-compliant. Based on work by Ken Snyder.
    function has(name) {
      if (has[name] !== undef) {
        // Return cached feature test result.
        return has[name];
      }
      var isSupported;
      if (name == "bug-string-char-index") {
        // IE <= 7 doesn't support accessing string characters using square
        // bracket notation. IE 8 only supports this for primitives.
        isSupported = "a"[0] != "a";
      } else if (name == "json") {
        // Indicates whether both `JSON.stringify` and `JSON.parse` are
        // supported.
        isSupported = has("json-stringify") && has("json-parse");
      } else {
        var value, serialized = '{"a":[1,true,false,null,"\\u0000\\b\\n\\f\\r\\t"]}';
        // Test `JSON.stringify`.
        if (name == "json-stringify") {
          var stringify = exports.stringify, stringifySupported = typeof stringify == "function" && isExtended;
          if (stringifySupported) {
            // A test function object with a custom `toJSON` method.
            (value = function () {
              return 1;
            }).toJSON = value;
            try {
              stringifySupported =
                // Firefox 3.1b1 and b2 serialize string, number, and boolean
                // primitives as object literals.
                stringify(0) === "0" &&
                // FF 3.1b1, b2, and JSON 2 serialize wrapped primitives as object
                // literals.
                stringify(new Number()) === "0" &&
                stringify(new String()) == '""' &&
                // FF 3.1b1, 2 throw an error if the value is `null`, `undefined`, or
                // does not define a canonical JSON representation (this applies to
                // objects with `toJSON` properties as well, *unless* they are nested
                // within an object or array).
                stringify(getClass) === undef &&
                // IE 8 serializes `undefined` as `"undefined"`. Safari <= 5.1.7 and
                // FF 3.1b3 pass this test.
                stringify(undef) === undef &&
                // Safari <= 5.1.7 and FF 3.1b3 throw `Error`s and `TypeError`s,
                // respectively, if the value is omitted entirely.
                stringify() === undef &&
                // FF 3.1b1, 2 throw an error if the given value is not a number,
                // string, array, object, Boolean, or `null` literal. This applies to
                // objects with custom `toJSON` methods as well, unless they are nested
                // inside object or array literals. YUI 3.0.0b1 ignores custom `toJSON`
                // methods entirely.
                stringify(value) === "1" &&
                stringify([value]) == "[1]" &&
                // Prototype <= 1.6.1 serializes `[undefined]` as `"[]"` instead of
                // `"[null]"`.
                stringify([undef]) == "[null]" &&
                // YUI 3.0.0b1 fails to serialize `null` literals.
                stringify(null) == "null" &&
                // FF 3.1b1, 2 halts serialization if an array contains a function:
                // `[1, true, getClass, 1]` serializes as "[1,true,],". FF 3.1b3
                // elides non-JSON values from objects and arrays, unless they
                // define custom `toJSON` methods.
                stringify([undef, getClass, null]) == "[null,null,null]" &&
                // Simple serialization test. FF 3.1b1 uses Unicode escape sequences
                // where character escape codes are expected (e.g., `\b` => `\u0008`).
                stringify({ "a": [value, true, false, null, "\x00\b\n\f\r\t"] }) == serialized &&
                // FF 3.1b1 and b2 ignore the `filter` and `width` arguments.
                stringify(null, value) === "1" &&
                stringify([1, 2], null, 1) == "[\n 1,\n 2\n]" &&
                // JSON 2, Prototype <= 1.7, and older WebKit builds incorrectly
                // serialize extended years.
                stringify(new Date(-8.64e15)) == '"-271821-04-20T00:00:00.000Z"' &&
                // The milliseconds are optional in ES 5, but required in 5.1.
                stringify(new Date(8.64e15)) == '"+275760-09-13T00:00:00.000Z"' &&
                // Firefox <= 11.0 incorrectly serializes years prior to 0 as negative
                // four-digit years instead of six-digit years. Credits: @Yaffle.
                stringify(new Date(-621987552e5)) == '"-000001-01-01T00:00:00.000Z"' &&
                // Safari <= 5.1.5 and Opera >= 10.53 incorrectly serialize millisecond
                // values less than 1000. Credits: @Yaffle.
                stringify(new Date(-1)) == '"1969-12-31T23:59:59.999Z"';
            } catch (exception) {
              stringifySupported = false;
            }
          }
          isSupported = stringifySupported;
        }
        // Test `JSON.parse`.
        if (name == "json-parse") {
          var parse = exports.parse;
          if (typeof parse == "function") {
            try {
              // FF 3.1b1, b2 will throw an exception if a bare literal is provided.
              // Conforming implementations should also coerce the initial argument to
              // a string prior to parsing.
              if (parse("0") === 0 && !parse(false)) {
                // Simple parsing test.
                value = parse(serialized);
                var parseSupported = value["a"].length == 5 && value["a"][0] === 1;
                if (parseSupported) {
                  try {
                    // Safari <= 5.1.2 and FF 3.1b1 allow unescaped tabs in strings.
                    parseSupported = !parse('"\t"');
                  } catch (exception) {}
                  if (parseSupported) {
                    try {
                      // FF 4.0 and 4.0.1 allow leading `+` signs and leading
                      // decimal points. FF 4.0, 4.0.1, and IE 9-10 also allow
                      // certain octal literals.
                      parseSupported = parse("01") !== 1;
                    } catch (exception) {}
                  }
                  if (parseSupported) {
                    try {
                      // FF 4.0, 4.0.1, and Rhino 1.7R3-R4 allow trailing decimal
                      // points. These environments, along with FF 3.1b1 and 2,
                      // also allow trailing commas in JSON objects and arrays.
                      parseSupported = parse("1.") !== 1;
                    } catch (exception) {}
                  }
                }
              }
            } catch (exception) {
              parseSupported = false;
            }
          }
          isSupported = parseSupported;
        }
      }
      return has[name] = !!isSupported;
    }

    if (!has("json")) {
      // Common `[[Class]]` name aliases.
      var functionClass = "[object Function]",
          dateClass = "[object Date]",
          numberClass = "[object Number]",
          stringClass = "[object String]",
          arrayClass = "[object Array]",
          booleanClass = "[object Boolean]";

      // Detect incomplete support for accessing string characters by index.
      var charIndexBuggy = has("bug-string-char-index");

      // Define additional utility methods if the `Date` methods are buggy.
      if (!isExtended) {
        var floor = Math.floor;
        // A mapping between the months of the year and the number of days between
        // January 1st and the first of the respective month.
        var Months = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
        // Internal: Calculates the number of days between the Unix epoch and the
        // first day of the given month.
        var getDay = function (year, month) {
          return Months[month] + 365 * (year - 1970) + floor((year - 1969 + (month = +(month > 1))) / 4) - floor((year - 1901 + month) / 100) + floor((year - 1601 + month) / 400);
        };
      }

      // Internal: Determines if a property is a direct property of the given
      // object. Delegates to the native `Object#hasOwnProperty` method.
      if (!(isProperty = objectProto.hasOwnProperty)) {
        isProperty = function (property) {
          var members = {}, constructor;
          if ((members.__proto__ = null, members.__proto__ = {
            // The *proto* property cannot be set multiple times in recent
            // versions of Firefox and SeaMonkey.
            "toString": 1
          }, members).toString != getClass) {
            // Safari <= 2.0.3 doesn't implement `Object#hasOwnProperty`, but
            // supports the mutable *proto* property.
            isProperty = function (property) {
              // Capture and break the objectgs prototype chain (see section 8.6.2
              // of the ES 5.1 spec). The parenthesized expression prevents an
              // unsafe transformation by the Closure Compiler.
              var original = this.__proto__, result = property in (this.__proto__ = null, this);
              // Restore the original prototype chain.
              this.__proto__ = original;
              return result;
            };
          } else {
            // Capture a reference to the top-level `Object` constructor.
            constructor = members.constructor;
            // Use the `constructor` property to simulate `Object#hasOwnProperty` in
            // other environments.
            isProperty = function (property) {
              var parent = (this.constructor || constructor).prototype;
              return property in this && !(property in parent && this[property] === parent[property]);
            };
          }
          members = null;
          return isProperty.call(this, property);
        };
      }

      // Internal: Normalizes the `for...in` iteration algorithm across
      // environments. Each enumerated key is yielded to a `callback` function.
      forEach = function (object, callback) {
        var size = 0, Properties, members, property;

        // Tests for bugs in the current environment's `for...in` algorithm. The
        // `valueOf` property inherits the non-enumerable flag from
        // `Object.prototype` in older versions of IE, Netscape, and Mozilla.
        (Properties = function () {
          this.valueOf = 0;
        }).prototype.valueOf = 0;

        // Iterate over a new instance of the `Properties` class.
        members = new Properties();
        for (property in members) {
          // Ignore all properties inherited from `Object.prototype`.
          if (isProperty.call(members, property)) {
            size++;
          }
        }
        Properties = members = null;

        // Normalize the iteration algorithm.
        if (!size) {
          // A list of non-enumerable properties inherited from `Object.prototype`.
          members = ["valueOf", "toString", "toLocaleString", "propertyIsEnumerable", "isPrototypeOf", "hasOwnProperty", "constructor"];
          // IE <= 8, Mozilla 1.0, and Netscape 6.2 ignore shadowed non-enumerable
          // properties.
          forEach = function (object, callback) {
            var isFunction = getClass.call(object) == functionClass, property, length;
            var hasProperty = !isFunction && typeof object.constructor != "function" && objectTypes[typeof object.hasOwnProperty] && object.hasOwnProperty || isProperty;
            for (property in object) {
              // Gecko <= 1.0 enumerates the `prototype` property of functions under
              // certain conditions; IE does not.
              if (!(isFunction && property == "prototype") && hasProperty.call(object, property)) {
                callback(property);
              }
            }
            // Manually invoke the callback for each non-enumerable property.
            for (length = members.length; property = members[--length]; hasProperty.call(object, property) && callback(property));
          };
        } else if (size == 2) {
          // Safari <= 2.0.4 enumerates shadowed properties twice.
          forEach = function (object, callback) {
            // Create a set of iterated properties.
            var members = {}, isFunction = getClass.call(object) == functionClass, property;
            for (property in object) {
              // Store each property name to prevent double enumeration. The
              // `prototype` property of functions is not enumerated due to cross-
              // environment inconsistencies.
              if (!(isFunction && property == "prototype") && !isProperty.call(members, property) && (members[property] = 1) && isProperty.call(object, property)) {
                callback(property);
              }
            }
          };
        } else {
          // No bugs detected; use the standard `for...in` algorithm.
          forEach = function (object, callback) {
            var isFunction = getClass.call(object) == functionClass, property, isConstructor;
            for (property in object) {
              if (!(isFunction && property == "prototype") && isProperty.call(object, property) && !(isConstructor = property === "constructor")) {
                callback(property);
              }
            }
            // Manually invoke the callback for the `constructor` property due to
            // cross-environment inconsistencies.
            if (isConstructor || isProperty.call(object, (property = "constructor"))) {
              callback(property);
            }
          };
        }
        return forEach(object, callback);
      };

      // Public: Serializes a JavaScript `value` as a JSON string. The optional
      // `filter` argument may specify either a function that alters how object and
      // array members are serialized, or an array of strings and numbers that
      // indicates which properties should be serialized. The optional `width`
      // argument may be either a string or number that specifies the indentation
      // level of the output.
      if (!has("json-stringify")) {
        // Internal: A map of control characters and their escaped equivalents.
        var Escapes = {
          92: "\\\\",
          34: '\\"',
          8: "\\b",
          12: "\\f",
          10: "\\n",
          13: "\\r",
          9: "\\t"
        };

        // Internal: Converts `value` into a zero-padded string such that its
        // length is at least equal to `width`. The `width` must be <= 6.
        var leadingZeroes = "000000";
        var toPaddedString = function (width, value) {
          // The `|| 0` expression is necessary to work around a bug in
          // Opera <= 7.54u2 where `0 == -0`, but `String(-0) !== "0"`.
          return (leadingZeroes + (value || 0)).slice(-width);
        };

        // Internal: Double-quotes a string `value`, replacing all ASCII control
        // characters (characters with code unit values between 0 and 31) with
        // their escaped equivalents. This is an implementation of the
        // `Quote(value)` operation defined in ES 5.1 section 15.12.3.
        var unicodePrefix = "\\u00";
        var quote = function (value) {
          var result = '"', index = 0, length = value.length, useCharIndex = !charIndexBuggy || length > 10;
          var symbols = useCharIndex && (charIndexBuggy ? value.split("") : value);
          for (; index < length; index++) {
            var charCode = value.charCodeAt(index);
            // If the character is a control character, append its Unicode or
            // shorthand escape sequence; otherwise, append the character as-is.
            switch (charCode) {
              case 8: case 9: case 10: case 12: case 13: case 34: case 92:
                result += Escapes[charCode];
                break;
              default:
                if (charCode < 32) {
                  result += unicodePrefix + toPaddedString(2, charCode.toString(16));
                  break;
                }
                result += useCharIndex ? symbols[index] : value.charAt(index);
            }
          }
          return result + '"';
        };

        // Internal: Recursively serializes an object. Implements the
        // `Str(key, holder)`, `JO(value)`, and `JA(value)` operations.
        var serialize = function (property, object, callback, properties, whitespace, indentation, stack) {
          var value, className, year, month, date, time, hours, minutes, seconds, milliseconds, results, element, index, length, prefix, result;
          try {
            // Necessary for host object support.
            value = object[property];
          } catch (exception) {}
          if (typeof value == "object" && value) {
            className = getClass.call(value);
            if (className == dateClass && !isProperty.call(value, "toJSON")) {
              if (value > -1 / 0 && value < 1 / 0) {
                // Dates are serialized according to the `Date#toJSON` method
                // specified in ES 5.1 section 15.9.5.44. See section 15.9.1.15
                // for the ISO 8601 date time string format.
                if (getDay) {
                  // Manually compute the year, month, date, hours, minutes,
                  // seconds, and milliseconds if the `getUTC*` methods are
                  // buggy. Adapted from @Yaffle's `date-shim` project.
                  date = floor(value / 864e5);
                  for (year = floor(date / 365.2425) + 1970 - 1; getDay(year + 1, 0) <= date; year++);
                  for (month = floor((date - getDay(year, 0)) / 30.42); getDay(year, month + 1) <= date; month++);
                  date = 1 + date - getDay(year, month);
                  // The `time` value specifies the time within the day (see ES
                  // 5.1 section 15.9.1.2). The formula `(A % B + B) % B` is used
                  // to compute `A modulo B`, as the `%` operator does not
                  // correspond to the `modulo` operation for negative numbers.
                  time = (value % 864e5 + 864e5) % 864e5;
                  // The hours, minutes, seconds, and milliseconds are obtained by
                  // decomposing the time within the day. See section 15.9.1.10.
                  hours = floor(time / 36e5) % 24;
                  minutes = floor(time / 6e4) % 60;
                  seconds = floor(time / 1e3) % 60;
                  milliseconds = time % 1e3;
                } else {
                  year = value.getUTCFullYear();
                  month = value.getUTCMonth();
                  date = value.getUTCDate();
                  hours = value.getUTCHours();
                  minutes = value.getUTCMinutes();
                  seconds = value.getUTCSeconds();
                  milliseconds = value.getUTCMilliseconds();
                }
                // Serialize extended years correctly.
                value = (year <= 0 || year >= 1e4 ? (year < 0 ? "-" : "+") + toPaddedString(6, year < 0 ? -year : year) : toPaddedString(4, year)) +
                  "-" + toPaddedString(2, month + 1) + "-" + toPaddedString(2, date) +
                  // Months, dates, hours, minutes, and seconds should have two
                  // digits; milliseconds should have three.
                  "T" + toPaddedString(2, hours) + ":" + toPaddedString(2, minutes) + ":" + toPaddedString(2, seconds) +
                  // Milliseconds are optional in ES 5.0, but required in 5.1.
                  "." + toPaddedString(3, milliseconds) + "Z";
              } else {
                value = null;
              }
            } else if (typeof value.toJSON == "function" && ((className != numberClass && className != stringClass && className != arrayClass) || isProperty.call(value, "toJSON"))) {
              // Prototype <= 1.6.1 adds non-standard `toJSON` methods to the
              // `Number`, `String`, `Date`, and `Array` prototypes. JSON 3
              // ignores all `toJSON` methods on these objects unless they are
              // defined directly on an instance.
              value = value.toJSON(property);
            }
          }
          if (callback) {
            // If a replacement function was provided, call it to obtain the value
            // for serialization.
            value = callback.call(object, property, value);
          }
          if (value === null) {
            return "null";
          }
          className = getClass.call(value);
          if (className == booleanClass) {
            // Booleans are represented literally.
            return "" + value;
          } else if (className == numberClass) {
            // JSON numbers must be finite. `Infinity` and `NaN` are serialized as
            // `"null"`.
            return value > -1 / 0 && value < 1 / 0 ? "" + value : "null";
          } else if (className == stringClass) {
            // Strings are double-quoted and escaped.
            return quote("" + value);
          }
          // Recursively serialize objects and arrays.
          if (typeof value == "object") {
            // Check for cyclic structures. This is a linear search; performance
            // is inversely proportional to the number of unique nested objects.
            for (length = stack.length; length--;) {
              if (stack[length] === value) {
                // Cyclic structures cannot be serialized by `JSON.stringify`.
                throw TypeError();
              }
            }
            // Add the object to the stack of traversed objects.
            stack.push(value);
            results = [];
            // Save the current indentation level and indent one additional level.
            prefix = indentation;
            indentation += whitespace;
            if (className == arrayClass) {
              // Recursively serialize array elements.
              for (index = 0, length = value.length; index < length; index++) {
                element = serialize(index, value, callback, properties, whitespace, indentation, stack);
                results.push(element === undef ? "null" : element);
              }
              result = results.length ? (whitespace ? "[\n" + indentation + results.join(",\n" + indentation) + "\n" + prefix + "]" : ("[" + results.join(",") + "]")) : "[]";
            } else {
              // Recursively serialize object members. Members are selected from
              // either a user-specified list of property names, or the object
              // itself.
              forEach(properties || value, function (property) {
                var element = serialize(property, value, callback, properties, whitespace, indentation, stack);
                if (element !== undef) {
                  // According to ES 5.1 section 15.12.3: "If `gap` {whitespace}
                  // is not the empty string, let `member` {quote(property) + ":"}
                  // be the concatenation of `member` and the `space` character."
                  // The "`space` character" refers to the literal space
                  // character, not the `space` {width} argument provided to
                  // `JSON.stringify`.
                  results.push(quote(property) + ":" + (whitespace ? " " : "") + element);
                }
              });
              result = results.length ? (whitespace ? "{\n" + indentation + results.join(",\n" + indentation) + "\n" + prefix + "}" : ("{" + results.join(",") + "}")) : "{}";
            }
            // Remove the object from the traversed object stack.
            stack.pop();
            return result;
          }
        };

        // Public: `JSON.stringify`. See ES 5.1 section 15.12.3.
        exports.stringify = function (source, filter, width) {
          var whitespace, callback, properties, className;
          if (objectTypes[typeof filter] && filter) {
            if ((className = getClass.call(filter)) == functionClass) {
              callback = filter;
            } else if (className == arrayClass) {
              // Convert the property names array into a makeshift set.
              properties = {};
              for (var index = 0, length = filter.length, value; index < length; value = filter[index++], ((className = getClass.call(value)), className == stringClass || className == numberClass) && (properties[value] = 1));
            }
          }
          if (width) {
            if ((className = getClass.call(width)) == numberClass) {
              // Convert the `width` to an integer and create a string containing
              // `width` number of space characters.
              if ((width -= width % 1) > 0) {
                for (whitespace = "", width > 10 && (width = 10); whitespace.length < width; whitespace += " ");
              }
            } else if (className == stringClass) {
              whitespace = width.length <= 10 ? width : width.slice(0, 10);
            }
          }
          // Opera <= 7.54u2 discards the values associated with empty string keys
          // (`""`) only if they are used directly within an object member list
          // (e.g., `!("" in { "": 1})`).
          return serialize("", (value = {}, value[""] = source, value), callback, properties, whitespace, "", []);
        };
      }

      // Public: Parses a JSON source string.
      if (!has("json-parse")) {
        var fromCharCode = String.fromCharCode;

        // Internal: A map of escaped control characters and their unescaped
        // equivalents.
        var Unescapes = {
          92: "\\",
          34: '"',
          47: "/",
          98: "\b",
          116: "\t",
          110: "\n",
          102: "\f",
          114: "\r"
        };

        // Internal: Stores the parser state.
        var Index, Source;

        // Internal: Resets the parser state and throws a `SyntaxError`.
        var abort = function () {
          Index = Source = null;
          throw SyntaxError();
        };

        // Internal: Returns the next token, or `"$"` if the parser has reached
        // the end of the source string. A token may be a string, number, `null`
        // literal, or Boolean literal.
        var lex = function () {
          var source = Source, length = source.length, value, begin, position, isSigned, charCode;
          while (Index < length) {
            charCode = source.charCodeAt(Index);
            switch (charCode) {
              case 9: case 10: case 13: case 32:
                // Skip whitespace tokens, including tabs, carriage returns, line
                // feeds, and space characters.
                Index++;
                break;
              case 123: case 125: case 91: case 93: case 58: case 44:
                // Parse a punctuator token (`{`, `}`, `[`, `]`, `:`, or `,`) at
                // the current position.
                value = charIndexBuggy ? source.charAt(Index) : source[Index];
                Index++;
                return value;
              case 34:
                // `"` delimits a JSON string; advance to the next character and
                // begin parsing the string. String tokens are prefixed with the
                // sentinel `@` character to distinguish them from punctuators and
                // end-of-string tokens.
                for (value = "@", Index++; Index < length;) {
                  charCode = source.charCodeAt(Index);
                  if (charCode < 32) {
                    // Unescaped ASCII control characters (those with a code unit
                    // less than the space character) are not permitted.
                    abort();
                  } else if (charCode == 92) {
                    // A reverse solidus (`\`) marks the beginning of an escaped
                    // control character (including `"`, `\`, and `/`) or Unicode
                    // escape sequence.
                    charCode = source.charCodeAt(++Index);
                    switch (charCode) {
                      case 92: case 34: case 47: case 98: case 116: case 110: case 102: case 114:
                        // Revive escaped control characters.
                        value += Unescapes[charCode];
                        Index++;
                        break;
                      case 117:
                        // `\u` marks the beginning of a Unicode escape sequence.
                        // Advance to the first character and validate the
                        // four-digit code point.
                        begin = ++Index;
                        for (position = Index + 4; Index < position; Index++) {
                          charCode = source.charCodeAt(Index);
                          // A valid sequence comprises four hexdigits (case-
                          // insensitive) that form a single hexadecimal value.
                          if (!(charCode >= 48 && charCode <= 57 || charCode >= 97 && charCode <= 102 || charCode >= 65 && charCode <= 70)) {
                            // Invalid Unicode escape sequence.
                            abort();
                          }
                        }
                        // Revive the escaped character.
                        value += fromCharCode("0x" + source.slice(begin, Index));
                        break;
                      default:
                        // Invalid escape sequence.
                        abort();
                    }
                  } else {
                    if (charCode == 34) {
                      // An unescaped double-quote character marks the end of the
                      // string.
                      break;
                    }
                    charCode = source.charCodeAt(Index);
                    begin = Index;
                    // Optimize for the common case where a string is valid.
                    while (charCode >= 32 && charCode != 92 && charCode != 34) {
                      charCode = source.charCodeAt(++Index);
                    }
                    // Append the string as-is.
                    value += source.slice(begin, Index);
                  }
                }
                if (source.charCodeAt(Index) == 34) {
                  // Advance to the next character and return the revived string.
                  Index++;
                  return value;
                }
                // Unterminated string.
                abort();
              default:
                // Parse numbers and literals.
                begin = Index;
                // Advance past the negative sign, if one is specified.
                if (charCode == 45) {
                  isSigned = true;
                  charCode = source.charCodeAt(++Index);
                }
                // Parse an integer or floating-point value.
                if (charCode >= 48 && charCode <= 57) {
                  // Leading zeroes are interpreted as octal literals.
                  if (charCode == 48 && ((charCode = source.charCodeAt(Index + 1)), charCode >= 48 && charCode <= 57)) {
                    // Illegal octal literal.
                    abort();
                  }
                  isSigned = false;
                  // Parse the integer component.
                  for (; Index < length && ((charCode = source.charCodeAt(Index)), charCode >= 48 && charCode <= 57); Index++);
                  // Floats cannot contain a leading decimal point; however, this
                  // case is already accounted for by the parser.
                  if (source.charCodeAt(Index) == 46) {
                    position = ++Index;
                    // Parse the decimal component.
                    for (; position < length && ((charCode = source.charCodeAt(position)), charCode >= 48 && charCode <= 57); position++);
                    if (position == Index) {
                      // Illegal trailing decimal.
                      abort();
                    }
                    Index = position;
                  }
                  // Parse exponents. The `e` denoting the exponent is
                  // case-insensitive.
                  charCode = source.charCodeAt(Index);
                  if (charCode == 101 || charCode == 69) {
                    charCode = source.charCodeAt(++Index);
                    // Skip past the sign following the exponent, if one is
                    // specified.
                    if (charCode == 43 || charCode == 45) {
                      Index++;
                    }
                    // Parse the exponential component.
                    for (position = Index; position < length && ((charCode = source.charCodeAt(position)), charCode >= 48 && charCode <= 57); position++);
                    if (position == Index) {
                      // Illegal empty exponent.
                      abort();
                    }
                    Index = position;
                  }
                  // Coerce the parsed value to a JavaScript number.
                  return +source.slice(begin, Index);
                }
                // A negative sign may only precede numbers.
                if (isSigned) {
                  abort();
                }
                // `true`, `false`, and `null` literals.
                if (source.slice(Index, Index + 4) == "true") {
                  Index += 4;
                  return true;
                } else if (source.slice(Index, Index + 5) == "false") {
                  Index += 5;
                  return false;
                } else if (source.slice(Index, Index + 4) == "null") {
                  Index += 4;
                  return null;
                }
                // Unrecognized token.
                abort();
            }
          }
          // Return the sentinel `$` character if the parser has reached the end
          // of the source string.
          return "$";
        };

        // Internal: Parses a JSON `value` token.
        var get = function (value) {
          var results, hasMembers;
          if (value == "$") {
            // Unexpected end of input.
            abort();
          }
          if (typeof value == "string") {
            if ((charIndexBuggy ? value.charAt(0) : value[0]) == "@") {
              // Remove the sentinel `@` character.
              return value.slice(1);
            }
            // Parse object and array literals.
            if (value == "[") {
              // Parses a JSON array, returning a new JavaScript array.
              results = [];
              for (;; hasMembers || (hasMembers = true)) {
                value = lex();
                // A closing square bracket marks the end of the array literal.
                if (value == "]") {
                  break;
                }
                // If the array literal contains elements, the current token
                // should be a comma separating the previous element from the
                // next.
                if (hasMembers) {
                  if (value == ",") {
                    value = lex();
                    if (value == "]") {
                      // Unexpected trailing `,` in array literal.
                      abort();
                    }
                  } else {
                    // A `,` must separate each array element.
                    abort();
                  }
                }
                // Elisions and leading commas are not permitted.
                if (value == ",") {
                  abort();
                }
                results.push(get(value));
              }
              return results;
            } else if (value == "{") {
              // Parses a JSON object, returning a new JavaScript object.
              results = {};
              for (;; hasMembers || (hasMembers = true)) {
                value = lex();
                // A closing curly brace marks the end of the object literal.
                if (value == "}") {
                  break;
                }
                // If the object literal contains members, the current token
                // should be a comma separator.
                if (hasMembers) {
                  if (value == ",") {
                    value = lex();
                    if (value == "}") {
                      // Unexpected trailing `,` in object literal.
                      abort();
                    }
                  } else {
                    // A `,` must separate each object member.
                    abort();
                  }
                }
                // Leading commas are not permitted, object property names must be
                // double-quoted strings, and a `:` must separate each property
                // name and value.
                if (value == "," || typeof value != "string" || (charIndexBuggy ? value.charAt(0) : value[0]) != "@" || lex() != ":") {
                  abort();
                }
                results[value.slice(1)] = get(lex());
              }
              return results;
            }
            // Unexpected token encountered.
            abort();
          }
          return value;
        };

        // Internal: Updates a traversed object member.
        var update = function (source, property, callback) {
          var element = walk(source, property, callback);
          if (element === undef) {
            delete source[property];
          } else {
            source[property] = element;
          }
        };

        // Internal: Recursively traverses a parsed JSON object, invoking the
        // `callback` function for each value. This is an implementation of the
        // `Walk(holder, name)` operation defined in ES 5.1 section 15.12.2.
        var walk = function (source, property, callback) {
          var value = source[property], length;
          if (typeof value == "object" && value) {
            // `forEach` can't be used to traverse an array in Opera <= 8.54
            // because its `Object#hasOwnProperty` implementation returns `false`
            // for array indices (e.g., `![1, 2, 3].hasOwnProperty("0")`).
            if (getClass.call(value) == arrayClass) {
              for (length = value.length; length--;) {
                update(value, length, callback);
              }
            } else {
              forEach(value, function (property) {
                update(value, property, callback);
              });
            }
          }
          return callback.call(source, property, value);
        };

        // Public: `JSON.parse`. See ES 5.1 section 15.12.2.
        exports.parse = function (source, callback) {
          var result, value;
          Index = 0;
          Source = "" + source;
          result = get(lex());
          // If a JSON string contains multiple tokens, it is invalid.
          if (lex() != "$") {
            abort();
          }
          // Reset the parser state.
          Index = Source = null;
          return callback && getClass.call(callback) == functionClass ? walk((value = {}, value[""] = result, value), "", callback) : result;
        };
      }
    }

    exports["runInContext"] = runInContext;
    return exports;
  }

  if (freeExports && !isLoader) {
    // Export for CommonJS environments.
    runInContext(root, freeExports);
  } else {
    // Export for web browsers and JavaScript engines.
    var nativeJSON = root.JSON,
        previousJSON = root["JSON3"],
        isRestored = false;

    var JSON3 = runInContext(root, (root["JSON3"] = {
      // Public: Restores the original value of the global `JSON` object and
      // returns a reference to the `JSON3` object.
      "noConflict": function () {
        if (!isRestored) {
          isRestored = true;
          root.JSON = nativeJSON;
          root["JSON3"] = previousJSON;
          nativeJSON = previousJSON = null;
        }
        return JSON3;
      }
    }));

    root.JSON = {
      "parse": JSON3.parse,
      "stringify": JSON3.stringify
    };
  }

  // Export for asynchronous module loaders.
  if (isLoader) {
    define(function () {
      return JSON3;
    });
  }
}).call(this);

}).call(this,typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{}],9:[function(_dereq_,module,exports){
/*
 * ----------------------------- JSTORAGE -------------------------------------
 * Simple local storage wrapper to save data on the browser side, supporting
 * all major browsers - IE6+, Firefox2+, Safari4+, Chrome4+ and Opera 10.5+
 *
 * Author: Andris Reinman, andris.reinman@gmail.com
 * Project homepage: www.jstorage.info
 *
 * Licensed under Unlicense:
 *
 * This is free and unencumbered software released into the public domain.
 * 
 * Anyone is free to copy, modify, publish, use, compile, sell, or
 * distribute this software, either in source code form or as a compiled
 * binary, for any purpose, commercial or non-commercial, and by any
 * means.
 * 
 * In jurisdictions that recognize copyright laws, the author or authors
 * of this software dedicate any and all copyright interest in the
 * software to the public domain. We make this dedication for the benefit
 * of the public at large and to the detriment of our heirs and
 * successors. We intend this dedication to be an overt act of
 * relinquishment in perpetuity of all present and future rights to this
 * software under copyright law.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
 * IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
 * OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
 * ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
 * OTHER DEALINGS IN THE SOFTWARE.
 * 
 * For more information, please refer to <http://unlicense.org/>
 */

 (function(){
    var
        /* jStorage version */
        JSTORAGE_VERSION = "0.4.8",

        /* detect a dollar object or create one if not found */
        $ = window.jQuery || window.$ || (window.$ = {}),

        /* check for a JSON handling support */
        JSON = {
            parse:
                window.JSON && (window.JSON.parse || window.JSON.decode) ||
                String.prototype.evalJSON && function(str){return String(str).evalJSON();} ||
                $.parseJSON ||
                $.evalJSON,
            stringify:
                Object.toJSON ||
                window.JSON && (window.JSON.stringify || window.JSON.encode) ||
                $.toJSON
        };

    // Break if no JSON support was found
    if(!("parse" in JSON) || !("stringify" in JSON)){
        throw new Error("No JSON support found, include //cdnjs.cloudflare.com/ajax/libs/json2/20110223/json2.js to page");
    }

    var
        /* This is the object, that holds the cached values */
        _storage = {__jstorage_meta:{CRC32:{}}},

        /* Actual browser storage (localStorage or globalStorage["domain"]) */
        _storage_service = {jStorage:"{}"},

        /* DOM element for older IE versions, holds userData behavior */
        _storage_elm = null,

        /* How much space does the storage take */
        _storage_size = 0,

        /* which backend is currently used */
        _backend = false,

        /* onchange observers */
        _observers = {},

        /* timeout to wait after onchange event */
        _observer_timeout = false,

        /* last update time */
        _observer_update = 0,

        /* pubsub observers */
        _pubsub_observers = {},

        /* skip published items older than current timestamp */
        _pubsub_last = +new Date(),

        /* Next check for TTL */
        _ttl_timeout,

        /**
         * XML encoding and decoding as XML nodes can't be JSON'ized
         * XML nodes are encoded and decoded if the node is the value to be saved
         * but not if it's as a property of another object
         * Eg. -
         *   $.jStorage.set("key", xmlNode);        // IS OK
         *   $.jStorage.set("key", {xml: xmlNode}); // NOT OK
         */
        _XMLService = {

            /**
             * Validates a XML node to be XML
             * based on jQuery.isXML function
             */
            isXML: function(elm){
                var documentElement = (elm ? elm.ownerDocument || elm : 0).documentElement;
                return documentElement ? documentElement.nodeName !== "HTML" : false;
            },

            /**
             * Encodes a XML node to string
             * based on http://www.mercurytide.co.uk/news/article/issues-when-working-ajax/
             */
            encode: function(xmlNode) {
                if(!this.isXML(xmlNode)){
                    return false;
                }
                try{ // Mozilla, Webkit, Opera
                    return new XMLSerializer().serializeToString(xmlNode);
                }catch(E1) {
                    try {  // IE
                        return xmlNode.xml;
                    }catch(E2){}
                }
                return false;
            },

            /**
             * Decodes a XML node from string
             * loosely based on http://outwestmedia.com/jquery-plugins/xmldom/
             */
            decode: function(xmlString){
                var dom_parser = ("DOMParser" in window && (new DOMParser()).parseFromString) ||
                        (window.ActiveXObject && function(_xmlString) {
                    var xml_doc = new ActiveXObject("Microsoft.XMLDOM");
                    xml_doc.async = "false";
                    xml_doc.loadXML(_xmlString);
                    return xml_doc;
                }),
                resultXML;
                if(!dom_parser){
                    return false;
                }
                resultXML = dom_parser.call("DOMParser" in window && (new DOMParser()) || window, xmlString, "text/xml");
                return this.isXML(resultXML)?resultXML:false;
            }
        };


    ////////////////////////// PRIVATE METHODS ////////////////////////

    /**
     * Initialization function. Detects if the browser supports DOM Storage
     * or userData behavior and behaves accordingly.
     */
    function _init(){
        /* Check if browser supports localStorage */
        var localStorageReallyWorks = false;
        if("localStorage" in window){
            try {
                window.localStorage.setItem("_tmptest", "tmpval");
                localStorageReallyWorks = true;
                window.localStorage.removeItem("_tmptest");
            } catch(BogusQuotaExceededErrorOnIos5) {
                // Thanks be to iOS5 Private Browsing mode which throws
                // QUOTA_EXCEEDED_ERRROR DOM Exception 22.
            }
        }

        if(localStorageReallyWorks){
            try {
                if(window.localStorage) {
                    _storage_service = window.localStorage;
                    _backend = "localStorage";
                    _observer_update = _storage_service.jStorage_update;
                }
            } catch(E3) {/* Firefox fails when touching localStorage and cookies are disabled */}
        }
        /* Check if browser supports globalStorage */
        else if("globalStorage" in window){
            try {
                if(window.globalStorage) {
                    if(window.location.hostname == "localhost"){
                        _storage_service = window.globalStorage["localhost.localdomain"];
                    }
                    else{
                        _storage_service = window.globalStorage[window.location.hostname];
                    }
                    _backend = "globalStorage";
                    _observer_update = _storage_service.jStorage_update;
                }
            } catch(E4) {/* Firefox fails when touching localStorage and cookies are disabled */}
        }
        /* Check if browser supports userData behavior */
        else {
            _storage_elm = document.createElement("link");
            if(_storage_elm.addBehavior){

                /* Use a DOM element to act as userData storage */
                _storage_elm.style.behavior = "url(#default#userData)";

                /* userData element needs to be inserted into the DOM! */
                document.getElementsByTagName("head")[0].appendChild(_storage_elm);

                try{
                    _storage_elm.load("jStorage");
                }catch(E){
                    // try to reset cache
                    _storage_elm.setAttribute("jStorage", "{}");
                    _storage_elm.save("jStorage");
                    _storage_elm.load("jStorage");
                }

                var data = "{}";
                try{
                    data = _storage_elm.getAttribute("jStorage");
                }catch(E5){}

                try{
                    _observer_update = _storage_elm.getAttribute("jStorage_update");
                }catch(E6){}

                _storage_service.jStorage = data;
                _backend = "userDataBehavior";
            }else{
                _storage_elm = null;
                return;
            }
        }

        // Load data from storage
        _load_storage();

        // remove dead keys
        _handleTTL();

        // start listening for changes
        _setupObserver();

        // initialize publish-subscribe service
        _handlePubSub();

        // handle cached navigation
        if("addEventListener" in window){
            window.addEventListener("pageshow", function(event){
                if(event.persisted){
                    _storageObserver();
                }
            }, false);
        }
    }

    /**
     * Reload data from storage when needed
     */
    function _reloadData(){
        var data = "{}";

        if(_backend == "userDataBehavior"){
            _storage_elm.load("jStorage");

            try{
                data = _storage_elm.getAttribute("jStorage");
            }catch(E5){}

            try{
                _observer_update = _storage_elm.getAttribute("jStorage_update");
            }catch(E6){}

            _storage_service.jStorage = data;
        }

        _load_storage();

        // remove dead keys
        _handleTTL();

        _handlePubSub();
    }

    /**
     * Sets up a storage change observer
     */
    function _setupObserver(){
        if(_backend == "localStorage" || _backend == "globalStorage"){
            if("addEventListener" in window){
                window.addEventListener("storage", _storageObserver, false);
            }else{
                document.attachEvent("onstorage", _storageObserver);
            }
        }else if(_backend == "userDataBehavior"){
            setInterval(_storageObserver, 1000);
        }
    }

    /**
     * Fired on any kind of data change, needs to check if anything has
     * really been changed
     */
    function _storageObserver(){
        var updateTime;
        // cumulate change notifications with timeout
        clearTimeout(_observer_timeout);
        _observer_timeout = setTimeout(function(){

            if(_backend == "localStorage" || _backend == "globalStorage"){
                updateTime = _storage_service.jStorage_update;
            }else if(_backend == "userDataBehavior"){
                _storage_elm.load("jStorage");
                try{
                    updateTime = _storage_elm.getAttribute("jStorage_update");
                }catch(E5){}
            }

            if(updateTime && updateTime != _observer_update){
                _observer_update = updateTime;
                _checkUpdatedKeys();
            }

        }, 25);
    }

    /**
     * Reloads the data and checks if any keys are changed
     */
    function _checkUpdatedKeys(){
        var oldCrc32List = JSON.parse(JSON.stringify(_storage.__jstorage_meta.CRC32)),
            newCrc32List;

        _reloadData();
        newCrc32List = JSON.parse(JSON.stringify(_storage.__jstorage_meta.CRC32));

        var key,
            updated = [],
            removed = [];

        for(key in oldCrc32List){
            if(oldCrc32List.hasOwnProperty(key)){
                if(!newCrc32List[key]){
                    removed.push(key);
                    continue;
                }
                if(oldCrc32List[key] != newCrc32List[key] && String(oldCrc32List[key]).substr(0,2) == "2."){
                    updated.push(key);
                }
            }
        }

        for(key in newCrc32List){
            if(newCrc32List.hasOwnProperty(key)){
                if(!oldCrc32List[key]){
                    updated.push(key);
                }
            }
        }

        _fireObservers(updated, "updated");
        _fireObservers(removed, "deleted");
    }

    /**
     * Fires observers for updated keys
     *
     * @param {Array|String} keys Array of key names or a key
     * @param {String} action What happened with the value (updated, deleted, flushed)
     */
    function _fireObservers(keys, action){
        keys = [].concat(keys || []);
        if(action == "flushed"){
            keys = [];
            for(var key in _observers){
                if(_observers.hasOwnProperty(key)){
                    keys.push(key);
                }
            }
            action = "deleted";
        }
        for(var i=0, len = keys.length; i<len; i++){
            if(_observers[keys[i]]){
                for(var j=0, jlen = _observers[keys[i]].length; j<jlen; j++){
                    _observers[keys[i]][j](keys[i], action);
                }
            }
            if(_observers["*"]){
                for(var j=0, jlen = _observers["*"].length; j<jlen; j++){
                    _observers["*"][j](keys[i], action);
                }
            }
        }
    }

    /**
     * Publishes key change to listeners
     */
    function _publishChange(){
        var updateTime = (+new Date()).toString();

        if(_backend == "localStorage" || _backend == "globalStorage"){
            try {
                _storage_service.jStorage_update = updateTime;
            } catch (E8) {
                // safari private mode has been enabled after the jStorage initialization
                _backend = false;
            }
        }else if(_backend == "userDataBehavior"){
            _storage_elm.setAttribute("jStorage_update", updateTime);
            _storage_elm.save("jStorage");
        }

        _storageObserver();
    }

    /**
     * Loads the data from the storage based on the supported mechanism
     */
    function _load_storage(){
        /* if jStorage string is retrieved, then decode it */
        if(_storage_service.jStorage){
            try{
                _storage = JSON.parse(String(_storage_service.jStorage));
            }catch(E6){_storage_service.jStorage = "{}";}
        }else{
            _storage_service.jStorage = "{}";
        }
        _storage_size = _storage_service.jStorage?String(_storage_service.jStorage).length:0;

        if(!_storage.__jstorage_meta){
            _storage.__jstorage_meta = {};
        }
        if(!_storage.__jstorage_meta.CRC32){
            _storage.__jstorage_meta.CRC32 = {};
        }
    }

    /**
     * This functions provides the "save" mechanism to store the jStorage object
     */
    function _save(){
        _dropOldEvents(); // remove expired events
        try{
            _storage_service.jStorage = JSON.stringify(_storage);
            // If userData is used as the storage engine, additional
            if(_storage_elm) {
                _storage_elm.setAttribute("jStorage",_storage_service.jStorage);
                _storage_elm.save("jStorage");
            }
            _storage_size = _storage_service.jStorage?String(_storage_service.jStorage).length:0;
        }catch(E7){/* probably cache is full, nothing is saved this way*/}
    }

    /**
     * Function checks if a key is set and is string or numberic
     *
     * @param {String} key Key name
     */
    function _checkKey(key){
        if(typeof key != "string" && typeof key != "number"){
            throw new TypeError("Key name must be string or numeric");
        }
        if(key == "__jstorage_meta"){
            throw new TypeError("Reserved key name");
        }
        return true;
    }

    /**
     * Removes expired keys
     */
    function _handleTTL(){
        var curtime, i, TTL, CRC32, nextExpire = Infinity, changed = false, deleted = [];

        clearTimeout(_ttl_timeout);

        if(!_storage.__jstorage_meta || typeof _storage.__jstorage_meta.TTL != "object"){
            // nothing to do here
            return;
        }

        curtime = +new Date();
        TTL = _storage.__jstorage_meta.TTL;

        CRC32 = _storage.__jstorage_meta.CRC32;
        for(i in TTL){
            if(TTL.hasOwnProperty(i)){
                if(TTL[i] <= curtime){
                    delete TTL[i];
                    delete CRC32[i];
                    delete _storage[i];
                    changed = true;
                    deleted.push(i);
                }else if(TTL[i] < nextExpire){
                    nextExpire = TTL[i];
                }
            }
        }

        // set next check
        if(nextExpire != Infinity){
            _ttl_timeout = setTimeout(Math.min(_handleTTL, nextExpire - curtime, 0x7FFFFFFF));
        }

        // save changes
        if(changed){
            _save();
            _publishChange();
            _fireObservers(deleted, "deleted");
        }
    }

    /**
     * Checks if there's any events on hold to be fired to listeners
     */
    function _handlePubSub(){
        var i, len;
        if(!_storage.__jstorage_meta.PubSub){
            return;
        }
        var pubelm,
            _pubsubCurrent = _pubsub_last;

        for(i=len=_storage.__jstorage_meta.PubSub.length-1; i>=0; i--){
            pubelm = _storage.__jstorage_meta.PubSub[i];
            if(pubelm[0] > _pubsub_last){
                _pubsubCurrent = pubelm[0];
                _fireSubscribers(pubelm[1], pubelm[2]);
            }
        }

        _pubsub_last = _pubsubCurrent;
    }

    /**
     * Fires all subscriber listeners for a pubsub channel
     *
     * @param {String} channel Channel name
     * @param {Mixed} payload Payload data to deliver
     */
    function _fireSubscribers(channel, payload){
        if(_pubsub_observers[channel]){
            for(var i=0, len = _pubsub_observers[channel].length; i<len; i++){
                // send immutable data that can't be modified by listeners
                try{
                    _pubsub_observers[channel][i](channel, JSON.parse(JSON.stringify(payload)));
                }catch(E){};
            }
        }
    }

    /**
     * Remove old events from the publish stream (at least 2sec old)
     */
    function _dropOldEvents(){
        if(!_storage.__jstorage_meta.PubSub){
            return;
        }

        var retire = +new Date() - 2000;

        for(var i=0, len = _storage.__jstorage_meta.PubSub.length; i<len; i++){
            if(_storage.__jstorage_meta.PubSub[i][0] <= retire){
                // deleteCount is needed for IE6
                _storage.__jstorage_meta.PubSub.splice(i, _storage.__jstorage_meta.PubSub.length - i);
                break;
            }
        }

        if(!_storage.__jstorage_meta.PubSub.length){
            delete _storage.__jstorage_meta.PubSub;
        }

    }

    /**
     * Publish payload to a channel
     *
     * @param {String} channel Channel name
     * @param {Mixed} payload Payload to send to the subscribers
     */
    function _publish(channel, payload){
        if(!_storage.__jstorage_meta){
            _storage.__jstorage_meta = {};
        }
        if(!_storage.__jstorage_meta.PubSub){
            _storage.__jstorage_meta.PubSub = [];
        }

        _storage.__jstorage_meta.PubSub.unshift([+new Date, channel, payload]);

        _save();
        _publishChange();
    }


    /**
     * JS Implementation of MurmurHash2
     *
     *  SOURCE: https://github.com/garycourt/murmurhash-js (MIT licensed)
     *
     * @author <a href="mailto:gary.court@gmail.com">Gary Court</a>
     * @see http://github.com/garycourt/murmurhash-js
     * @author <a href="mailto:aappleby@gmail.com">Austin Appleby</a>
     * @see http://sites.google.com/site/murmurhash/
     *
     * @param {string} str ASCII only
     * @param {number} seed Positive integer only
     * @return {number} 32-bit positive integer hash
     */

    function murmurhash2_32_gc(str, seed) {
        var
            l = str.length,
            h = seed ^ l,
            i = 0,
            k;

        while (l >= 4) {
            k =
                ((str.charCodeAt(i) & 0xff)) |
                ((str.charCodeAt(++i) & 0xff) << 8) |
                ((str.charCodeAt(++i) & 0xff) << 16) |
                ((str.charCodeAt(++i) & 0xff) << 24);

            k = (((k & 0xffff) * 0x5bd1e995) + ((((k >>> 16) * 0x5bd1e995) & 0xffff) << 16));
            k ^= k >>> 24;
            k = (((k & 0xffff) * 0x5bd1e995) + ((((k >>> 16) * 0x5bd1e995) & 0xffff) << 16));

            h = (((h & 0xffff) * 0x5bd1e995) + ((((h >>> 16) * 0x5bd1e995) & 0xffff) << 16)) ^ k;

            l -= 4;
            ++i;
        }

        switch (l) {
            case 3: h ^= (str.charCodeAt(i + 2) & 0xff) << 16;
            case 2: h ^= (str.charCodeAt(i + 1) & 0xff) << 8;
            case 1: h ^= (str.charCodeAt(i) & 0xff);
                h = (((h & 0xffff) * 0x5bd1e995) + ((((h >>> 16) * 0x5bd1e995) & 0xffff) << 16));
        }

        h ^= h >>> 13;
        h = (((h & 0xffff) * 0x5bd1e995) + ((((h >>> 16) * 0x5bd1e995) & 0xffff) << 16));
        h ^= h >>> 15;

        return h >>> 0;
    }

    ////////////////////////// PUBLIC INTERFACE /////////////////////////

    $.jStorage = {
        /* Version number */
        version: JSTORAGE_VERSION,

        /**
         * Sets a key's value.
         *
         * @param {String} key Key to set. If this value is not set or not
         *              a string an exception is raised.
         * @param {Mixed} value Value to set. This can be any value that is JSON
         *              compatible (Numbers, Strings, Objects etc.).
         * @param {Object} [options] - possible options to use
         * @param {Number} [options.TTL] - optional TTL value, in milliseconds
         * @return {Mixed} the used value
         */
        set: function(key, value, options){
            _checkKey(key);

            options = options || {};

            // undefined values are deleted automatically
            if(typeof value == "undefined"){
                this.deleteKey(key);
                return value;
            }

            if(_XMLService.isXML(value)){
                value = {_is_xml:true,xml:_XMLService.encode(value)};
            }else if(typeof value == "function"){
                return undefined; // functions can't be saved!
            }else if(value && typeof value == "object"){
                // clone the object before saving to _storage tree
                value = JSON.parse(JSON.stringify(value));
            }

            _storage[key] = value;

            _storage.__jstorage_meta.CRC32[key] = "2." + murmurhash2_32_gc(JSON.stringify(value), 0x9747b28c);

            this.setTTL(key, options.TTL || 0); // also handles saving and _publishChange

            _fireObservers(key, "updated");
            return value;
        },

        /**
         * Looks up a key in cache
         *
         * @param {String} key - Key to look up.
         * @param {mixed} def - Default value to return, if key didn't exist.
         * @return {Mixed} the key value, default value or null
         */
        get: function(key, def){
            _checkKey(key);
            if(key in _storage){
                if(_storage[key] && typeof _storage[key] == "object" && _storage[key]._is_xml) {
                    return _XMLService.decode(_storage[key].xml);
                }else{
                    return _storage[key];
                }
            }
            return typeof(def) == "undefined" ? null : def;
        },

        /**
         * Deletes a key from cache.
         *
         * @param {String} key - Key to delete.
         * @return {Boolean} true if key existed or false if it didn't
         */
        deleteKey: function(key){
            _checkKey(key);
            if(key in _storage){
                delete _storage[key];
                // remove from TTL list
                if(typeof _storage.__jstorage_meta.TTL == "object" &&
                  key in _storage.__jstorage_meta.TTL){
                    delete _storage.__jstorage_meta.TTL[key];
                }

                delete _storage.__jstorage_meta.CRC32[key];

                _save();
                _publishChange();
                _fireObservers(key, "deleted");
                return true;
            }
            return false;
        },

        /**
         * Sets a TTL for a key, or remove it if ttl value is 0 or below
         *
         * @param {String} key - key to set the TTL for
         * @param {Number} ttl - TTL timeout in milliseconds
         * @return {Boolean} true if key existed or false if it didn't
         */
        setTTL: function(key, ttl){
            var curtime = +new Date();
            _checkKey(key);
            ttl = Number(ttl) || 0;
            if(key in _storage){

                if(!_storage.__jstorage_meta.TTL){
                    _storage.__jstorage_meta.TTL = {};
                }

                // Set TTL value for the key
                if(ttl>0){
                    _storage.__jstorage_meta.TTL[key] = curtime + ttl;
                }else{
                    delete _storage.__jstorage_meta.TTL[key];
                }

                _save();

                _handleTTL();

                _publishChange();
                return true;
            }
            return false;
        },

        /**
         * Gets remaining TTL (in milliseconds) for a key or 0 when no TTL has been set
         *
         * @param {String} key Key to check
         * @return {Number} Remaining TTL in milliseconds
         */
        getTTL: function(key){
            var curtime = +new Date(), ttl;
            _checkKey(key);
            if(key in _storage && _storage.__jstorage_meta.TTL && _storage.__jstorage_meta.TTL[key]){
                ttl = _storage.__jstorage_meta.TTL[key] - curtime;
                return ttl || 0;
            }
            return 0;
        },

        /**
         * Deletes everything in cache.
         *
         * @return {Boolean} Always true
         */
        flush: function(){
            _storage = {__jstorage_meta:{CRC32:{}}};
            _save();
            _publishChange();
            _fireObservers(null, "flushed");
            return true;
        },

        /**
         * Returns a read-only copy of _storage
         *
         * @return {Object} Read-only copy of _storage
        */
        storageObj: function(){
            function F() {}
            F.prototype = _storage;
            return new F();
        },

        /**
         * Returns an index of all used keys as an array
         * ["key1", "key2",.."keyN"]
         *
         * @return {Array} Used keys
        */
        index: function(){
            var index = [], i;
            for(i in _storage){
                if(_storage.hasOwnProperty(i) && i != "__jstorage_meta"){
                    index.push(i);
                }
            }
            return index;
        },

        /**
         * How much space in bytes does the storage take?
         *
         * @return {Number} Storage size in chars (not the same as in bytes,
         *                  since some chars may take several bytes)
         */
        storageSize: function(){
            return _storage_size;
        },

        /**
         * Which backend is currently in use?
         *
         * @return {String} Backend name
         */
        currentBackend: function(){
            return _backend;
        },

        /**
         * Test if storage is available
         *
         * @return {Boolean} True if storage can be used
         */
        storageAvailable: function(){
            return !!_backend;
        },

        /**
         * Register change listeners
         *
         * @param {String} key Key name
         * @param {Function} callback Function to run when the key changes
         */
        listenKeyChange: function(key, callback){
            _checkKey(key);
            if(!_observers[key]){
                _observers[key] = [];
            }
            _observers[key].push(callback);
        },

        /**
         * Remove change listeners
         *
         * @param {String} key Key name to unregister listeners against
         * @param {Function} [callback] If set, unregister the callback, if not - unregister all
         */
        stopListening: function(key, callback){
            _checkKey(key);

            if(!_observers[key]){
                return;
            }

            if(!callback){
                delete _observers[key];
                return;
            }

            for(var i = _observers[key].length - 1; i>=0; i--){
                if(_observers[key][i] == callback){
                    _observers[key].splice(i,1);
                }
            }
        },

        /**
         * Subscribe to a Publish/Subscribe event stream
         *
         * @param {String} channel Channel name
         * @param {Function} callback Function to run when the something is published to the channel
         */
        subscribe: function(channel, callback){
            channel = (channel || "").toString();
            if(!channel){
                throw new TypeError("Channel not defined");
            }
            if(!_pubsub_observers[channel]){
                _pubsub_observers[channel] = [];
            }
            _pubsub_observers[channel].push(callback);
        },

        /**
         * Publish data to an event stream
         *
         * @param {String} channel Channel name
         * @param {Mixed} payload Payload to deliver
         */
        publish: function(channel, payload){
            channel = (channel || "").toString();
            if(!channel){
                throw new TypeError("Channel not defined");
            }

            _publish(channel, payload);
        },

        /**
         * Reloads the data from browser storage
         */
        reInit: function(){
            _reloadData();
        },

        /**
         * Removes reference from global objects and saves it as jStorage
         *
         * @param {Boolean} option if needed to save object as simple "jStorage" in windows context
         */
         noConflict: function( saveInGlobal ) {
            delete window.$.jStorage

            if ( saveInGlobal ) {
                window.jStorage = this;
            }

            return this;
         }
    };

    // Initialize jStorage
    _init();

})();

},{}],10:[function(_dereq_,module,exports){
///////////////////////////////////////////////////////////////////////////////////////////////////
//
// Axon Bridge API Framework
//
// Authored by:   Axon Interactive
//
// Last Modified: June 4, 2014
//
// Dependencies:  crypto-js (https://github.com/evanvosberg/crypto-js)
//                jQuery 1.11.1 (http://jquery.com/)
//                json3 (https://github.com/bestiejs/json3)
//                jStorage (https://github.com/andris9/jStorage)
//
// *** History ***
//
// Version    Date                  Notes
// =========  ====================  =============================================================
// 0.1        June 4, 2014          First stable version. 
//
///////////////////////////////////////////////////////////////////////////////////////////////////

// Require the root AxonBridge module
//var BridgeClient = require( './BridgeClient' );

var bridge = _dereq_( './Bridge' );
module.exports = new bridge();

},{"./Bridge":1}]},{},[10])
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlcyI6WyJjOlxcRGV2ZWxvcG1lbnRcXF9CaXRidWNrZXRcXGJyaWRnZS1jbGllbnRcXG5vZGVfbW9kdWxlc1xcYnJvd3NlcmlmeVxcbm9kZV9tb2R1bGVzXFxicm93c2VyLXBhY2tcXF9wcmVsdWRlLmpzIiwiYzovRGV2ZWxvcG1lbnQvX0JpdGJ1Y2tldC9icmlkZ2UtY2xpZW50L3NyYy9CcmlkZ2UuanMiLCJjOi9EZXZlbG9wbWVudC9fQml0YnVja2V0L2JyaWRnZS1jbGllbnQvc3JjL0lkZW50aXR5LmpzIiwiYzovRGV2ZWxvcG1lbnQvX0JpdGJ1Y2tldC9icmlkZ2UtY2xpZW50L3NyYy9pbmNsdWRlL2NyeXB0by1qcy9jb3JlLmpzIiwiYzovRGV2ZWxvcG1lbnQvX0JpdGJ1Y2tldC9icmlkZ2UtY2xpZW50L3NyYy9pbmNsdWRlL2NyeXB0by1qcy9lbmMtaGV4LmpzIiwiYzovRGV2ZWxvcG1lbnQvX0JpdGJ1Y2tldC9icmlkZ2UtY2xpZW50L3NyYy9pbmNsdWRlL2NyeXB0by1qcy9obWFjLXNoYTI1Ni5qcyIsImM6L0RldmVsb3BtZW50L19CaXRidWNrZXQvYnJpZGdlLWNsaWVudC9zcmMvaW5jbHVkZS9jcnlwdG8tanMvaG1hYy5qcyIsImM6L0RldmVsb3BtZW50L19CaXRidWNrZXQvYnJpZGdlLWNsaWVudC9zcmMvaW5jbHVkZS9jcnlwdG8tanMvc2hhMjU2LmpzIiwiYzovRGV2ZWxvcG1lbnQvX0JpdGJ1Y2tldC9icmlkZ2UtY2xpZW50L3NyYy9pbmNsdWRlL2pzb24zLmpzIiwiYzovRGV2ZWxvcG1lbnQvX0JpdGJ1Y2tldC9icmlkZ2UtY2xpZW50L3NyYy9pbmNsdWRlL2pzdG9yYWdlLmpzIiwiYzovRGV2ZWxvcG1lbnQvX0JpdGJ1Y2tldC9icmlkZ2UtY2xpZW50L3NyYy9pbmRleC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3A0QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1SEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeHVCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5SUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdE1BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeDRCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoOEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKX12YXIgZj1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwoZi5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxmLGYuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiLy8gSW5jbHVkZSBkZXBlbmRlbmNpZXNcclxudmFyIGVuY19oZXggPSByZXF1aXJlKCAnLi9pbmNsdWRlL2NyeXB0by1qcy9lbmMtaGV4JyApO1xyXG52YXIganNvbjMgPSByZXF1aXJlKCAnLi9pbmNsdWRlL2pzb24zJyApO1xyXG52YXIganN0b3JhZ2UgPSByZXF1aXJlKCAnLi9pbmNsdWRlL2pzdG9yYWdlJyApO1xyXG52YXIgc2hhMjU2ID0gcmVxdWlyZSggJy4vaW5jbHVkZS9jcnlwdG8tanMvc2hhMjU2JyApO1xyXG52YXIgSWRlbnRpdHkgPSByZXF1aXJlKCAnLi9JZGVudGl0eScgKTtcclxuXHJcbi8vIFtCcmlkZ2UgQ29uc3RydWN0b3JdXHJcbi8vIFRoZSBCcmlkZ2Ugb2JqZWN0IGlzIHRoZSBnbG9iYWwgb2JqZWN0IHRocm91Z2ggd2hpY2ggb3RoZXIgYXBwbGljYXRpb25zIHdpbGwgXHJcbi8vIGNvbW11bmljYXRlIHdpdGggdGhlIGJyaWRnZWQgQVBJIHJlc291cmNlcy4gSXQgcHJvdmlkZXMgYSBzaW1wbGUgc3VyZmFjZSBBUEkgZm9yIGxvZ2dpbmdcclxuLy8gaW4gYW5kIGxvZ2dpbmcgb3V0IHVzZXJzIGFzIHdlbGwgYXMgc2VuZGluZyByZXF1ZXN0cyB0byB0aGUgQVBJLiBJbnRlcm5hbGx5LCBpdCBoYW5kbGVzXHJcbi8vIGFsbCBvZiB0aGUgcmVxdWVzdCBhdXRoZW50aWNhdGlvbiBuZWNlc3NhcnkgZm9yIHRoZSBBUEkgd2l0aG91dCBleHBvc2luZyB0aGUgdXNlcidzXHJcbi8vIGFjY291bnQgcGFzc3dvcmQgdG8gb3V0c2lkZSBzY3J1dGlueSAoYW5kIGV2ZW4gc2NydXRpbnkgZnJvbSBvdGhlciBsb2NhbCBhcHBsaWNhdGlvbnNcclxuLy8gdG8gYSBzaWduaWZpY2FudCBleHRlbnQpLlxyXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICgpIHtcclxuXHJcbiAgJ3VzZSBzdHJpY3QnO1xyXG5cclxuICAvLyBUaGUgb2JqZWN0IHRvIGJlIHJldHVybmVkIGZyb20gdGhlIGZhY3RvcnlcclxuICB2YXIgc2VsZiA9IHt9O1xyXG5cclxuICAvLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy9cclxuICAvLyBQUklWQVRFIC8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy9cclxuICAvLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy9cclxuXHJcbiAgLy8vLy8vLy8vLy8vLy8vL1xyXG4gIC8vIFBST1BFUlRJRVMgLy9cclxuICAvLy8vLy8vLy8vLy8vLy8vXHJcblxyXG4gIC8vIFtQUklWQVRFXSBpZGVudGl0eVxyXG4gIC8vIFRoZSBJZGVudGl0eSBvYmplY3QgdXNlZCB0byB0cmFjayB0aGUgdXNlciBhbmQgY3JlYXRlIHJlcXVlc3RzIHNpZ25lZCB3aXRoIFxyXG4gIC8vIGFwcHJvcHJpYXRlIEhNQUMgaGFzaCB2YWx1ZXMuXHJcbiAgdmFyIGlkZW50aXR5ID0gbnVsbDtcclxuXHJcblxyXG4gIC8vLy8vLy8vLy8vLy8vL1xyXG4gIC8vIEZVTkNUSU9OUyAvL1xyXG4gIC8vLy8vLy8vLy8vLy8vL1xyXG5cclxuICAvLyBbUFJJVkFURV0gY2xlYXJJZGVudGl0eSgpXHJcbiAgLy8gU2V0cyB0aGUgY3VycmVudCBJZGVudGl0eSBvYmplY3QgdG8gbnVsbCBzbyBpdCBnZXRzIGdhcmJhZ2UgY29sbGVjdGVkIGFuZCBjYW5ub3QgYmUgdXNlZCBcclxuICAvLyB0byB2YWxpZGF0ZSByZXF1ZXN0cyBnb2luZyBmb3J3YXJkLlxyXG4gIHZhciBjbGVhcklkZW50aXR5ID0gZnVuY3Rpb24gKCkge1xyXG5cclxuICAgIGlkZW50aXR5ID0gbnVsbDtcclxuXHJcbiAgfTtcclxuXHJcbiAgLy8gW1BSSVZBVEVdIGNsZWFyVXNlclxyXG4gIC8vIENsZWFycyB0aGUgY3VycmVudCB1c2VyIGRhdGEgYW5kIGFkZGl0aW9uYWwgZGF0YSBhc3NpZ25lZCB0byB0aGUgQnJpZGdlLlxyXG4gIHZhciBjbGVhclVzZXIgPSBmdW5jdGlvbiAoKSB7XHJcblxyXG4gICAgLy8gU2V0IHRoZSB1c2VyIGFuZCBhZGRpdGlvbmFsIGRhdGEgb2JqZWN0cyB0byBudWxsXHJcbiAgICBzZWxmLnVzZXIgPSBudWxsO1xyXG4gICAgc2VsZi5hZGRpdGlvbmFsRGF0YSA9IG51bGw7XHJcblxyXG4gIH07XHJcblxyXG4gIC8vIFtQUklWQVRFXSBoYXNJZGVudGl0eSgpXHJcbiAgLy8gUmV0dXJucyB3aGV0aGVyIG9yIG5vdCBhbiB0aGUgSWRlbnRpdHkgb2JqZWN0IGlzIGN1cnJlbnRseSBhc3NpZ25lZC5cclxuICB2YXIgaGFzSWRlbnRpdHkgPSBmdW5jdGlvbiAoKSB7XHJcblxyXG4gICAgcmV0dXJuICggaWRlbnRpdHkgIT09IG51bGwgKTtcclxuXHJcbiAgfTtcclxuXHJcbiAgLy8gW1BSSVZBVEVdIHJlcXVlc3RQcml2YXRlKClcclxuICAvLyBUaGlzIGZ1bmN0aW9uIHByb3ZpZGVzIHRoZSBiYXNpYyBmdW5jdGlvbmFsaXR5IHVzZWQgYnkgYWxsIG9mIHRoZSBCcmlkZ2UgQ2xpZW50J3MgaW50ZXJuYWxcclxuICAvLyByZXF1ZXN0IGZ1bmN0aW9uIGNhbGxzLiBJdCBwZXJmb3JtcyBhbiBYSFIgcmVxdWVzdCB0byB0aGUgQVBJIHNlcnZlciBhdCB0aGUgc3BlY2lmaWVkIHJlc291cmNlXHJcbiAgLy8gYW5kIHJldHVybiBhIGpRdWVyeSBEZWZlcnJlZCBvYmplY3QgLiBJZiB0aGlzIHJldHVybnMgbnVsbCwgdGhlIHJlcXVlc3QgY291bGQgbm90IGJlIHNlbnRcclxuICAvLyBiZWNhdXNlIG5vIHVzZXIgY3JlZGVudGlhbHMgd2VyZSBhdmFpbGFibGUgdG8gc2lnbiB0aGUgcmVxdWVzdC5cclxuICB2YXIgcmVxdWVzdFByaXZhdGUgPSBmdW5jdGlvbiAoIG1ldGhvZCwgcmVzb3VyY2UsIHBheWxvYWQsIHRlbXBJZGVudGl0eSApIHtcclxuXHJcbiAgICAvLyBOb3RpZnkgdGhlIHVzZXIgb2YgdGhlIHJlcXVlc3QgYmVpbmcgcmVhZHkgdG8gc2VuZC5cclxuICAgIGlmICggdHlwZW9mIHNlbGYub25SZXF1ZXN0Q2FsbGVkID09PSBcImZ1bmN0aW9uXCIgKSB7XHJcbiAgICAgIHNlbGYub25SZXF1ZXN0Q2FsbGVkKCBtZXRob2QsIHJlc291cmNlLCBwYXlsb2FkICk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gQ3JlYXRlIGEgZGVmZXJyZWQgb2JqZWN0IHRvIHByb3ZpZGUgYSBjb252ZW5pZW50IHdheSBmb3IgdGhlIGNhbGxlciB0byBoYW5kbGUgc3VjY2VzcyBhbmQgXHJcbiAgICAvLyBmYWlsdXJlLlxyXG4gICAgdmFyIGRlZmVycmVkID0gbmV3IGpRdWVyeS5EZWZlcnJlZCgpO1xyXG5cclxuICAgIC8vIElmIGEgdGVtcG9yYXJ5IGlkZW50aXR5IHdhcyBwcm92aWRlZCwgdXNlIGl0IChldmVuIGlmIGFuIGlkZW50aXR5IGlzIHNldCBpbiBCcmlkZ2UpLlxyXG4gICAgdmFyIHJlcXVlc3RJZGVudGl0eSA9IG51bGw7XHJcbiAgICBpZiAoIHRlbXBJZGVudGl0eSAhPT0gbnVsbCAmJiB0eXBlb2YgdGVtcElkZW50aXR5ID09PSAnb2JqZWN0JyApIHtcclxuICAgICAgcmVxdWVzdElkZW50aXR5ID0gdGVtcElkZW50aXR5O1xyXG4gICAgfVxyXG4gICAgLy8gSWYgYW4gaWRlbnRpdHkgaXMgc2V0IGluIEJyaWRnZSwgdXNlIGl0LlxyXG4gICAgZWxzZSBpZiAoIGhhc0lkZW50aXR5KCkgPT09IHRydWUgKSB7XHJcbiAgICAgIHJlcXVlc3RJZGVudGl0eSA9IGlkZW50aXR5O1xyXG4gICAgfVxyXG4gICAgLy8gTm8gaWRlbnRpdHkgaXMgYXZhaWxhYmxlLiBUaGUgcmVxdWVzdCBjYW4ndCBiZSBzZW50LlxyXG4gICAgZWxzZSB7IFxyXG4gICAgICBpZiAoIHNlbGYuZGVidWcgPT09IHRydWUgKSB7XHJcbiAgICAgICAgY29uc29sZS53YXJuKCBcIkJSSURHRSB8IFJlcXVlc3QgfCBSZXF1ZXN0IGNhbm5vdCBiZSBzZW50LiBObyB1c2VyIGNyZWRlbnRpYWxzIGF2YWlsYWJsZS5cIiApO1xyXG4gICAgICB9XHJcbiAgICAgIGRlZmVycmVkLnJlamVjdCggeyBzdGF0dXM6IDQxMiwgbWVzc2FnZTogJzQxMiAoUHJlY29uZGl0aW9uIEZhaWxlZCkgTnVsbCB1c2VyIGlkZW50aXR5LicgfSwgbnVsbCApO1xyXG4gICAgICByZXR1cm4gZGVmZXJyZWQucHJvbWlzZSgpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIEJ1aWxkIHRoZSBwYXlsb2FkU3RyaW5nIHRvIGJlIHNlbnQgYWxvbmcgd2l0aCB0aGUgbWVzc2FnZS5cclxuICAgIC8vIE5vdGU6IElmIHRoaXMgaXMgYSBHRVQgcmVxdWVzdCwgcHJlcGVuZCAncGF5bG9hZD0nIHNpbmNlIHRoZSBkYXRhIGlzIHNlbnQgaW4gdGhlIHF1ZXJ5IFxyXG4gICAgLy8gc3RyaW5nLlxyXG4gICAgdmFyIHJlcUJvZHkgPSBudWxsO1xyXG4gICAgaWYgKCBtZXRob2QudG9VcHBlckNhc2UoKSA9PT0gJ0dFVCcgKSB7XHJcbiAgICAgIHJlcUJvZHkgPSAncGF5bG9hZD0nICsgSlNPTi5zdHJpbmdpZnkoIHJlcXVlc3RJZGVudGl0eS5jcmVhdGVSZXF1ZXN0KCBwYXlsb2FkICkgKTtcclxuICAgIH1cclxuICAgIGVsc2Uge1xyXG4gICAgICByZXFCb2R5ID0gSlNPTi5zdHJpbmdpZnkoIHJlcXVlc3RJZGVudGl0eS5jcmVhdGVSZXF1ZXN0KCBwYXlsb2FkICkgKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBTZW5kIHRoZSByZXF1ZXN0XHJcbiAgICBqUXVlcnkuYWpheCgge1xyXG4gICAgICAndHlwZSc6IG1ldGhvZCxcclxuICAgICAgJ3VybCc6IHNlbGYudXJsICsgcmVzb3VyY2UsXHJcbiAgICAgICdkYXRhJzogcmVxQm9keSxcclxuICAgICAgJ2RhdGFUeXBlJzogJ2pzb24nLFxyXG4gICAgICAnY29udGVudFR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXHJcbiAgICAgICdoZWFkZXJzJzoge1xyXG4gICAgICAgICdBY2NlcHQnOiAnYXBwbGljYXRpb24vanNvbidcclxuICAgICAgfSxcclxuICAgICAgJ3RpbWVvdXQnOiBzZWxmLnRpbWVvdXQsXHJcbiAgICAgICdhc3luYyc6IHRydWUsXHJcbiAgICB9IClcclxuICAgIC5kb25lKCBmdW5jdGlvbiAoIGRhdGEsIHRleHRTdGF0dXMsIGpxWEhSICkge1xyXG5cclxuICAgICAgLy8gQ2hlY2sgaWYgdGhlIHJldHVybmVkIGhlYWRlciB3YXMgZm9ybWF0dGVkIGluY29ycmVjdGx5LlxyXG4gICAgICBpZiAoIHR5cGVvZiBkYXRhICE9PSAnb2JqZWN0JyB8fCB0eXBlb2YgZGF0YS5jb250ZW50ICE9PSAnb2JqZWN0JyApIHtcclxuICAgICAgICBkZWZlcnJlZC5yZWplY3QoIHsgc3RhdHVzOiA0MTcsIG1lc3NhZ2U6ICc0MTcgKEV4cGVjdGF0aW9uIEZhaWxlZCkgTWFsZm9ybWVkIG1lc3NhZ2UuJyB9LCBqcVhIUiApO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gTm90aWZ5IHRoZSB1c2VyIG9mIHRoZSBzdWNjZXNzZnVsIHJlcXVlc3QuXHJcbiAgICAgIGRlZmVycmVkLnJlc29sdmUoIGRhdGEsIGpxWEhSICk7XHJcblxyXG4gICAgfSApXHJcbiAgICAuZmFpbCggZnVuY3Rpb24gKCBqcVhIUiwgdGV4dFN0YXR1cywgZXJyb3JUaHJvd24gKSB7XHJcblxyXG4gICAgICAvLyBSZWplY3QgdGhlIG9idmlvdXMgZXJyb3IgY29kZXMuXHJcbiAgICAgIHZhciBlcnJvciA9IEJyaWRnZS5pc0Vycm9yQ29kZVJlc3BvbnNlKCBqcVhIUiApO1xyXG4gICAgICBpZiAoIGVycm9yICE9PSBudWxsICkge1xyXG5cclxuICAgICAgICAvLyBOb3RpZnkgdGhlIHVzZXIgb2YgdGhlIGVycm9yLlxyXG4gICAgICAgIGRlZmVycmVkLnJlamVjdCggZXJyb3IsIGpxWEhSICk7XHJcblxyXG4gICAgICB9IFxyXG4gICAgICBlbHNlIC8vIENvbm5lY3Rpb24gdGltZW91dFxyXG4gICAgICB7XHJcblxyXG4gICAgICAgIC8vIE5vdGlmeSB0aGUgdXNlciBvZiB0aGUgZmFpbHVyZSB0byBjb25uZWN0IHRvIHRoZSBzZXJ2ZXIuXHJcbiAgICAgICAgZGVmZXJyZWQucmVqZWN0KCB7IHN0YXR1czogMCwgbWVzc2FnZTogJzAgKFRpbWVvdXQpIE5vIHJlc3BvbnNlIGZyb20gdGhlIHNlcnZlci4nIH0sIGpxWEhSICk7XHJcblxyXG4gICAgICB9XHJcblxyXG4gICAgfSApO1xyXG5cclxuICAgIC8vIFJldHVybiB0aGUgZGVmZXJyZWQgb2JqZWN0IHRvIHRoZSBjYWxsZXJcclxuICAgIHJldHVybiBkZWZlcnJlZC5wcm9taXNlKCk7XHJcblxyXG4gIH07XHJcblxyXG4gIC8vIFtQUklWQVRFXSByZXF1ZXN0Q2hhbmdlUGFzc3dvcmRQcml2YXRlKClcclxuICAvLyBBc2sgdGhlIHNlcnZlciB0byBjaGFuZ2UgdGhlIHBhc3N3b3JkIG9mIHRoZSBjdXJlbnRseSBsb2dnZWQtaW4gdXNlci4gVGhpcyBvcGVyYXRpb24gcmVxdWlyZXNcclxuICAvLyB0aGUgdXNlcidzIGN1cnJlbnQgcGFzc3dvcmQgdG8gYmUgc3VwcGxpZWQgYW5kIGNyZWF0ZXMgYSB0ZW1wb3JhcnkgSWRlbnRpdHkgb2JqZWN0IHRvIHNlbmQgdGhlXHJcbiAgLy8gcmVxdWVzdCBmb3IgYSBwYXNzd29yZCBjaGFuZ2UgdG8gdmVyaWZ5IHRoYXQgYW5vdGhlciBpbmRpdmlkdWFsIGRpZG4ndCBqdXN0IGhvcCBvbnRvIGEgbG9nZ2VkLVxyXG4gIC8vIGluIGNvbXB1dGVyIGFuZCBjaGFuZ2UgYSB1c2VyJ3MgcGFzc3dvcmQgd2hpbGUgdGhleSB3ZXJlIGF3YXkgZnJvbSB0aGVpciBjb21wdXRlci5cclxuICB2YXIgcmVxdWVzdENoYW5nZVBhc3N3b3JkUHJpdmF0ZSA9IGZ1bmN0aW9uICggb2xkUGFzc3dvcmQsIG5ld1Bhc3N3b3JkICkge1xyXG5cclxuICAgIC8vIE5vdGlmeSB0aGUgdXNlciBvZiB0aGUgY2hhbmdlUGFzc3dvcmQgY2FsbCBvY2N1cnJpbmcuXHJcbiAgICBpZiAoIHR5cGVvZiBzZWxmLm9uRkNoYW5nZVBhc3N3b3JkID09PSBcImZ1bmN0aW9uXCIgKSB7XHJcbiAgICAgIHNlbGYub25DaGFuZ2VQYXNzd29yZCgpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIEhhc2ggdGhlIHVzZXIncyBwYXNzd29yZHNcclxuICAgIHZhciBvbGRIYXNoZWRQYXNzd29yZCA9IHNoYTI1Niggb2xkUGFzc3dvcmQgKS50b1N0cmluZyggZW5jX2hleCApO1xyXG4gICAgdmFyIG5ld0hhc2hlZFBhc3N3b3JkID0gc2hhMjU2KCBuZXdQYXNzd29yZCApLnRvU3RyaW5nKCBlbmNfaGV4ICk7XHJcblxyXG4gICAgLy8gQ2xlYXIgdGhlIHVuZW5jcnlwdGVkIHBhc3N3b3JkcyBmcm9tIG1lbW9yeVxyXG4gICAgb2xkUGFzc3dvcmQgPSBudWxsO1xyXG4gICAgbmV3UGFzc3dvcmQgPSBudWxsO1xyXG5cclxuICAgIC8vIENyZWF0ZSBhIGRlZmVycmVkIG9iamVjdCB0byByZXR1cm4gc28gdGhlIGVuZC11c2VyIGNhbiBoYW5kbGUgc3VjY2Vzcy9mYWlsdXJlIGNvbnZlbmllbnRseS5cclxuICAgIHZhciBkZWZlcnJlZCA9IG5ldyBqUXVlcnkuRGVmZXJyZWQoKTtcclxuXHJcbiAgICAvLyBCdWlsZCBvdXIgaW50ZXJuYWwgc3VjY2VzcyBoYW5kbGVyICh0aGlzIGNhbGxzIGRlZmVycmVkLnJlc29sdmUoKSlcclxuICAgIHZhciBvbkRvbmUgPSBmdW5jdGlvbiAoIGRhdGEsIGpxWEhSICkge1xyXG5cclxuICAgICAgLy8gQ2hlY2sgdGhhdCB0aGUgY29udGVudCB0eXBlIChNZXNzYWdlKSBpcyBmb3JtYXR0ZWQgY29ycmVjdGx5LlxyXG4gICAgICBpZiAoIHR5cGVvZiBkYXRhLmNvbnRlbnQubWVzc2FnZSAhPT0gJ3N0cmluZycgKSB7XHJcbiAgICAgICAgb25GYWlsKCB7IHN0YXR1czogNDE3LCBtZXNzYWdlOiAnNDE3IChFeHBlY3RhdGlvbiBGYWlsZWQpIE1hbGZvcm1lZCBtZXNzYWdlLicgfSwganFYSFIgKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIFNldCBCcmlkZ2UncyBpZGVudGl0eSBvYmplY3QgdXNpbmcgdGhlIG5ldyBwYXNzd29yZCwgc2luY2UgZnV0dXJlIHJlcXVlc3RzIHdpbGwgbmVlZCB0byBiZSBcclxuICAgICAgLy8gc2lnbmVkIHdpdGggdGhlIG5ldyB1c2VyIGNyZWRlbnRpYWxzLlxyXG4gICAgICBzZXRJZGVudGl0eSggaWRlbnRpdHkuZW1haWwsIG5ld0hhc2hlZFBhc3N3b3JkLCB0cnVlICk7XHJcblxyXG4gICAgICAvLyBMb2cgdGhlIHN1Y2Nlc3MgdG8gdGhlIGNvbnNvbGUuXHJcbiAgICAgIGlmICggc2VsZi5kZWJ1ZyA9PT0gdHJ1ZSApIHtcclxuICAgICAgICBjb25zb2xlLmxvZyggXCJCUklER0UgfCBDaGFuZ2UgUGFzc3dvcmQgfCBcIiArIGRhdGEuY29udGVudC5tZXNzYWdlICk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIFNpZ25hbCB0aGUgZGVmZXJyZWQgb2JqZWN0IHRvIHVzZSBpdHMgc3VjY2VzcygpIGhhbmRsZXIuXHJcbiAgICAgIGRlZmVycmVkLnJlc29sdmUoIGRhdGEsIGpxWEhSICk7XHJcblxyXG4gICAgfTtcclxuXHJcbiAgICAvLyBCdWlsZCBvdXIgaW50ZXJuYWwgZmFpbHVyZSBoYW5kbGVyICh0aGlzIGNhbGxzIGRlZmVycmVkLnJlamVjdCgpKVxyXG4gICAgdmFyIG9uRmFpbCA9IGZ1bmN0aW9uICggZXJyb3IsIGpxWEhSICkge1xyXG5cclxuICAgICAgLy8gTG9nIHRoZSBlcnJvciB0byB0aGUgY29uc29sZS5cclxuICAgICAgaWYgKCBCcmlkZ2UuZGVidWcgPT09IHRydWUgKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvciggXCJCUklER0UgfCBDaGFuZ2UgUGFzc3dvcmQgfCBcIiArIGVycm9yLnN0YXR1cy50b1N0cmluZygpICsgXCIgPj4gXCIgKyBlcnJvci5tZXNzYWdlICk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIFNpZ25hbCB0aGUgZGVmZXJyZWQgb2JqZWN0IHRvIHVzZSBpdHMgZmFpbCgpIGhhbmRsZXIuXHJcbiAgICAgIGRlZmVycmVkLnJlamVjdCggZXJyb3IsIGpxWEhSICk7XHJcblxyXG4gICAgfTtcclxuXHJcbiAgICAvLyBCdWlsZCB0aGUgcGF5bG9hZCBvYmplY3QgdG8gc2VuZCB3aXRoIHRoZSByZXF1ZXN0XHJcbiAgICB2YXIgcGF5bG9hZCA9IHtcclxuICAgICAgXCJhcHBEYXRhXCI6IHt9LFxyXG4gICAgICBcImVtYWlsXCI6ICcnLFxyXG4gICAgICBcImZpcnN0TmFtZVwiOiAnJyxcclxuICAgICAgXCJsYXN0TmFtZVwiOiAnJyxcclxuICAgICAgXCJwYXNzd29yZFwiOiBuZXdIYXNoZWRQYXNzd29yZFxyXG4gICAgfTtcclxuXHJcbiAgICAvLyBDb25maWd1cmUgYSB0ZW1wb3JhcnkgSWRlbnRpdHkgb2JqZWN0IHdpdGggdGhlIHVzZXIncyBjcmVkZW50aWFscywgdXNpbmcgdGhlIHBhc3N3b3JkIFxyXG4gICAgLy8gcmVjZWl2ZWQgYXMgYSBwYXJhbWV0ZXIgdG8gZG91YmxlLWNvbmZpcm0gdGhlIHVzZXIncyBpZGVudGl0eSBpbW1lZGlhdGVseSBiZWZvcmUgdGhleSBcclxuICAgIC8vIGNoYW5nZSB0aGVpciBhY2NvdW50IHBhc3N3b3JkLlxyXG4gICAgdmFyIHRlbXBJZGVudGl0eSA9IG5ldyBJZGVudGl0eSggaWRlbnRpdHkuZW1haWwsIG9sZEhhc2hlZFBhc3N3b3JkLCB0cnVlICk7XHJcblxyXG4gICAgLy8gU2VuZCB0aGUgcmVxdWVzdFxyXG4gICAgcmVxdWVzdFByaXZhdGUoICdQVVQnLCAndXNlcnMnLCBwYXlsb2FkLCB0ZW1wSWRlbnRpdHkgKS5kb25lKCBvbkRvbmUgKS5mYWlsKCBvbkZhaWwgKTtcclxuXHJcbiAgICAvLyBSZXR1cm4gdGhlIGRlZmVycmVkIG9iamVjdCBzbyB0aGUgZW5kLXVzZXIgY2FuIGhhbmRsZSBlcnJvcnMgYXMgdGhleSBjaG9vc2UuXHJcbiAgICByZXR1cm4gZGVmZXJyZWQucHJvbWlzZSgpO1xyXG5cclxuICB9O1xyXG5cclxuICAvLyBbUFJJVkFURV0gcmVxdWVzdEZvcmdvdFBhc3N3b3JkUHJpdmF0ZSgpXHJcbiAgLy8gQXNrIHRoZSBzZXJ2ZXIgdG8gc2V0IHRoZSB1c2VyIGludG8gcmVjb3Zlcnkgc3RhdGUgZm9yIGEgc2hvcnQgcGVyaW9kIG9mIHRpbWUgYW5kIHNlbmQgYW5cclxuICAvLyBhY2NvdW50IHJlY292ZXJ5IGVtYWlsIHRvIHRoZSBlbWFpbCBhY2NvdW50IHByb3ZpZGVkIGhlcmUsIGFzIGxvbmcgYXMgaXQgaWRlbnRpZmllcyBhIHVzZXJcclxuICAvLyBpbiB0aGUgZGF0YWJhc2UuXHJcbiAgdmFyIHJlcXVlc3RGb3Jnb3RQYXNzd29yZFByaXZhdGUgPSBmdW5jdGlvbiAoIGVtYWlsICkge1xyXG5cclxuICAgIC8vIE5vdGlmeSB0aGUgdXNlciBvZiB0aGUgZm9yZ290UGFzc3dvcmQgY2FsbCBvY2N1cnJpbmcuXHJcbiAgICBpZiAoIHR5cGVvZiBzZWxmLm9uRm9yZ290UGFzc3dvcmQgPT09IFwiZnVuY3Rpb25cIiApIHtcclxuICAgICAgc2VsZi5vbkZvcmdvdFBhc3N3b3JkKCBlbWFpbCApO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIENyZWF0ZSBhIGRlZmVycmVkIG9iamVjdCB0byByZXR1cm4gc28gdGhlIGVuZC11c2VyIGNhbiBoYW5kbGUgc3VjY2Vzcy9mYWlsdXJlIGNvbnZlbmllbnRseS5cclxuICAgIHZhciBkZWZlcnJlZCA9IG5ldyBqUXVlcnkuRGVmZXJyZWQoKTtcclxuXHJcbiAgICAvLyBCdWlsZCBvdXIgaW50ZXJuYWwgc3VjY2VzcyBoYW5kbGVyICh0aGlzIGNhbGxzIGRlZmVycmVkLnJlc29sdmUoKSlcclxuICAgIHZhciBvbkRvbmUgPSBmdW5jdGlvbiAoIGRhdGEsIGpxWEhSICkge1xyXG5cclxuICAgICAgLy8gQ2hlY2sgdGhhdCB0aGUgY29udGVudCB0eXBlIChNZXNzYWdlKSBpcyBmb3JtYXR0ZWQgY29ycmVjdGx5LlxyXG4gICAgICBpZiAoIHR5cGVvZiBkYXRhLmNvbnRlbnQubWVzc2FnZSAhPT0gJ3N0cmluZycgKSB7XHJcbiAgICAgICAgb25GYWlsKCB7IHN0YXR1czogNDE3LCBtZXNzYWdlOiAnNDE3IChFeHBlY3RhdGlvbiBGYWlsZWQpIE1hbGZvcm1lZCBtZXNzYWdlLicgfSwganFYSFIgKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIExvZyB0aGUgc3VjY2VzcyB0byB0aGUgY29uc29sZS5cclxuICAgICAgaWYgKCBzZWxmLmRlYnVnID09PSB0cnVlICkge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCBcIkJSSURHRSB8IEZvcmdvdCBQYXNzd29yZCB8IFwiICsgZGF0YS5jb250ZW50Lm1lc3NhZ2UgKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gU2lnbmFsIHRoZSBkZWZlcnJlZCBvYmplY3QgdG8gdXNlIGl0cyBzdWNjZXNzKCkgaGFuZGxlci5cclxuICAgICAgZGVmZXJyZWQucmVzb2x2ZSggZGF0YSwganFYSFIgKTtcclxuXHJcbiAgICB9O1xyXG5cclxuICAgIC8vIEJ1aWxkIG91ciBpbnRlcm5hbCBmYWlsdXJlIGhhbmRsZXIgKHRoaXMgY2FsbHMgZGVmZXJyZWQucmVqZWN0KCkpXHJcbiAgICB2YXIgb25GYWlsID0gZnVuY3Rpb24gKCBlcnJvciwganFYSFIgKSB7XHJcblxyXG4gICAgICAvLyBMb2cgdGhlIGVycm9yIHRvIHRoZSBjb25zb2xlLlxyXG4gICAgICBpZiAoIEJyaWRnZS5kZWJ1ZyA9PT0gdHJ1ZSApIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKCBcIkJSSURHRSB8IEZvcmdvdCBQYXNzd29yZCB8IFwiICsgZXJyb3Iuc3RhdHVzLnRvU3RyaW5nKCkgKyBcIiA+PiBcIiArIGVycm9yLm1lc3NhZ2UgKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gU2lnbmFsIHRoZSBkZWZlcnJlZCBvYmplY3QgdG8gdXNlIGl0cyBmYWlsKCkgaGFuZGxlci5cclxuICAgICAgZGVmZXJyZWQucmVqZWN0KCBlcnJvciwganFYSFIgKTtcclxuXHJcbiAgICB9O1xyXG5cclxuICAgIC8vIEJ1aWxkIHRoZSBwYXlsb2FkIG9iamVjdCB0byBzZW5kIHdpdGggdGhlIHJlcXVlc3RcclxuICAgIHZhciBwYXlsb2FkID0ge1xyXG4gICAgICBcIm1lc3NhZ2VcIjogZW1haWxcclxuICAgIH07XHJcblxyXG4gICAgLy8gQ3JlYXRlIGEgdGVtcG9yYXJ5IElkZW50aXR5IG9iamVjdCB3aXRoIGEgYmxhbmsgcGFzc3dvcmQuXHJcbiAgICB2YXIgdGVtcElkZW50aXR5ID0gbmV3IElkZW50aXR5KCAnJywgJycsIHRydWUgKTtcclxuXHJcbiAgICAvLyBTZW5kIHRoZSByZXF1ZXN0XHJcbiAgICByZXF1ZXN0UHJpdmF0ZSggJ1BVVCcsICdmb3Jnb3QtcGFzc3dvcmQnLCBwYXlsb2FkLCB0ZW1wSWRlbnRpdHkgKS5kb25lKCBvbkRvbmUgKS5mYWlsKCBvbkZhaWwgKTtcclxuXHJcbiAgICAvLyBSZXR1cm4gdGhlIGRlZmVycmVkIG9iamVjdCBzbyB0aGUgZW5kLXVzZXIgY2FuIGhhbmRsZSBlcnJvcnMgYXMgdGhleSBjaG9vc2UuXHJcbiAgICByZXR1cm4gZGVmZXJyZWQucHJvbWlzZSgpO1xyXG5cclxuICB9O1xyXG5cclxuICAvLyBbUFJJVkFURV0gcmVxdWVzdExvZ2luUHJpdmF0ZSgpXHJcbiAgLy8gTG9nIGluIGEgdXNlciB3aXRoIHRoZSBnaXZlbiBlbWFpbC9wYXNzd29yZCBwYWlyLiBUaGlzIGNyZWF0ZXMgYSBuZXcgSWRlbnRpdHkgb2JqZWN0XHJcbiAgLy8gdG8gc2lnbiByZXF1ZXN0cyBmb3IgYXV0aGVudGljYXRpb24gYW5kIHBlcmZvcm1zIGFuIGluaXRpYWwgcmVxdWVzdCB0byB0aGUgc2VydmVyIHRvXHJcbiAgLy8gc2VuZCBhIGxvZ2luIHBhY2thZ2UuXHJcbiAgdmFyIHJlcXVlc3RMb2dpblByaXZhdGUgPSBmdW5jdGlvbiAoIGVtYWlsLCBwYXNzd29yZCwgdXNlTG9jYWxTdG9yYWdlLCBkb250SGFzaFBhc3N3b3JkICkge1xyXG5cclxuICAgIC8vIE5vdGlmeSB0aGUgdXNlciBvZiB0aGUgbG9naW4gY2FsbCBvY2N1cnJpbmcuXHJcbiAgICBpZiAoIHR5cGVvZiBzZWxmLm9uTG9naW5DYWxsZWQgPT09IFwiZnVuY3Rpb25cIiApIHtcclxuICAgICAgc2VsZi5vbkxvZ2luQ2FsbGVkKCBlbWFpbCwgdXNlTG9jYWxTdG9yYWdlICk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gSGFzaCB0aGUgdXNlcidzIHBhc3N3b3JkXHJcbiAgICB2YXIgaGFzaGVkUGFzc3dvcmQgPSAoIGRvbnRIYXNoUGFzc3dvcmQgPT09IHRydWUgKSA/IHBhc3N3b3JkIDpcclxuICAgICAgc2hhMjU2KCBwYXNzd29yZCApLnRvU3RyaW5nKCBlbmNfaGV4ICk7XHJcblxyXG4gICAgLy8gQ2xlYXIgdGhlIHVuZW5jcnlwdGVkIHBhc3N3b3JkIGZyb20gbWVtb3J5XHJcbiAgICBwYXNzd29yZCA9IG51bGw7XHJcblxyXG4gICAgLy8gQ3JlYXRlIGEgZGVmZXJyZWQgb2JqZWN0IHRvIHJldHVybiBzbyB0aGUgZW5kLXVzZXIgY2FuIGhhbmRsZSBzdWNjZXNzL2ZhaWx1cmUgY29udmVuaWVudGx5LlxyXG4gICAgdmFyIGRlZmVycmVkID0gbmV3IGpRdWVyeS5EZWZlcnJlZCgpO1xyXG5cclxuICAgIC8vIEJ1aWxkIG91ciBpbnRlcm5hbCBzdWNjZXNzIGhhbmRsZXIgKHRoaXMgY2FsbHMgZGVmZXJyZWQucmVzb2x2ZSgpKVxyXG4gICAgdmFyIG9uRG9uZSA9IGZ1bmN0aW9uICggZGF0YSwganFYSFIgKSB7XHJcblxyXG4gICAgICAvLyBDaGVjayB0aGF0IHRoZSBjb250ZW50IHR5cGUgKExvZ2luIFBhY2thZ2UpIGlzIGZvcm1hdHRlZCBjb3JyZWN0bHkuXHJcbiAgICAgIGlmICggdHlwZW9mIGRhdGEuY29udGVudC51c2VyICE9PSAnb2JqZWN0JyApIHtcclxuICAgICAgICBvbkZhaWwoIHsgc3RhdHVzOiA0MTcsIG1lc3NhZ2U6ICc0MTcgKEV4cGVjdGF0aW9uIEZhaWxlZCkgTWFsZm9ybWVkIGxvZ2luIHBhY2thZ2UuJyB9LCBqcVhIUiApO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gTG9nIHRoZSBzdWNjZXNzIHRvIHRoZSBjb25zb2xlLlxyXG4gICAgICBpZiAoIHNlbGYuZGVidWcgPT09IHRydWUgKSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coIFwiQlJJREdFIHwgTG9naW4gfCBcIiArIEpTT04uc3RyaW5naWZ5KCBkYXRhLmNvbnRlbnQgKSApO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBTZXQgdGhlIHVzZXIgb2JqZWN0IHVzaW5nIHRoZSB1c2VyIGRhdGEgdGhhdCB3YXMgcmV0dXJuZWRcclxuICAgICAgc2V0VXNlciggZGF0YS5jb250ZW50LnVzZXIsIGRhdGEuY29udGVudC5hZGRpdGlvbmFsRGF0YSApO1xyXG5cclxuICAgICAgLy8gU3RvcmUgdGhpcyBpZGVudGl0eSB0byBsb2NhbCBzdG9yYWdlLCBpZiB0aGF0IHdhcyByZXF1ZXN0ZWQuXHJcbiAgICAgIC8vIFtTRUNVUklUWSBOT1RFIDFdIHN0b3JlTG9jYWxseSBzaG91bGQgYmUgc2V0IGJhc2VkIG9uIHVzZXIgaW5wdXQsIGJ5IGFza2luZyB3aGV0aGVyXHJcbiAgICAgIC8vIHRoZSB1c2VyIGlzIG9uIGEgcHJpdmF0ZSBjb21wdXRlciBvciBub3QuIFRoaXMgaXMgY2FuIGJlIGNvbnNpZGVyZWQgYSB0b2xlcmFibGVcclxuICAgICAgLy8gc2VjdXJpdHkgcmlzayBhcyBsb25nIGFzIHRoZSB1c2VyIGlzIG9uIGEgcHJpdmF0ZSBjb21wdXRlciB0aGF0IHRoZXkgdHJ1c3Qgb3IgbWFuYWdlXHJcbiAgICAgIC8vIHRoZW1zZWx2ZXMuIEhvd2V2ZXIsIG9uIGEgcHVibGljIG1hY2hpbmUgdGhpcyBpcyBwcm9iYWJseSBhIHNlY3VyaXR5IHJpc2ssIGFuZCB0aGVcclxuICAgICAgLy8gdXNlciBzaG91bGQgYmUgYWJsZSB0byBkZWNsaW5lIHRoaXMgY29udmVuY2llbmNlIGluIGZhdm91ciBvZiBzZWN1cml0eSwgcmVnYXJkbGVzc1xyXG4gICAgICAvLyBvZiB3aGV0aGVyIHRoZXkgYXJlIG9uIGEgcHVibGljIG1hY2hpbmUgb3Igbm90LlxyXG4gICAgICBpZiAoIHNlbGYudXNlTG9jYWxTdG9yYWdlICkge1xyXG4gICAgICAgIGpRdWVyeS5qU3RvcmFnZS5zZXQoICdicmlkZ2UtY2xpZW50LWlkZW50aXR5JywgSlNPTi5zdHJpbmdpZnkoIHtcclxuICAgICAgICAgIFwiZW1haWxcIjogZW1haWwsXHJcbiAgICAgICAgICBcInBhc3N3b3JkXCI6IGhhc2hlZFBhc3N3b3JkXHJcbiAgICAgICAgfSApICk7XHJcbiAgICAgICAgalF1ZXJ5LmpTdG9yYWdlLnNldFRUTCggJ2JyaWRnZS1jbGllbnQtaWRlbnRpdHknLCA4NjQwMDAwMCApOyAvLyBFeHBpcmUgaW4gMSBkYXkuXHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIFNpZ25hbCB0aGUgZGVmZXJyZWQgb2JqZWN0IHRvIHVzZSBpdHMgc3VjY2VzcygpIGhhbmRsZXIuXHJcbiAgICAgIGRlZmVycmVkLnJlc29sdmUoIGRhdGEsIGpxWEhSICk7XHJcblxyXG4gICAgfTtcclxuXHJcbiAgICAvLyBCdWlsZCBvdXIgaW50ZXJuYWwgZmFpbHVyZSBoYW5kbGVyICh0aGlzIGNhbGxzIGRlZmVycmVkLnJlamVjdCgpKVxyXG4gICAgdmFyIG9uRmFpbCA9IGZ1bmN0aW9uICggZXJyb3IsIGpxWEhSICkge1xyXG5cclxuICAgICAgLy8gQ2xlYXIgdGhlIHVzZXIgY3JlZGVudGlhbHMsIHNpbmNlIHRoZXkgZGlkbid0IHdvcmsgYW55d2F5LlxyXG4gICAgICBjbGVhclVzZXIoKTtcclxuXHJcbiAgICAgIC8vIExvZyB0aGUgZXJyb3IgdG8gdGhlIGNvbnNvbGUuXHJcbiAgICAgIGlmICggQnJpZGdlLmRlYnVnID09PSB0cnVlICkge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoIFwiQlJJREdFIHwgTG9naW4gfCBcIiArIGVycm9yLnN0YXR1cy50b1N0cmluZygpICsgXCIgPj4gXCIgKyBlcnJvci5tZXNzYWdlICk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIFNpZ25hbCB0aGUgZGVmZXJyZWQgb2JqZWN0IHRvIHVzZSBpdHMgZmFpbCgpIGhhbmRsZXIuXHJcbiAgICAgIGRlZmVycmVkLnJlamVjdCggZXJyb3IsIGpxWEhSICk7XHJcblxyXG4gICAgfTtcclxuXHJcbiAgICAvLyBUaGlzIHJlcXVlc3QgdXNlcyBhbiBlbXB0eSBwYXlsb2FkXHJcbiAgICB2YXIgcGF5bG9hZCA9IHt9O1xyXG5cclxuICAgIC8vIFNldCB3aGV0aGVyIG9yIG5vdCB0aGUgQnJpZGdlIHNob3VsZCBzdG9yZSB1c2VyIGNyZWRlbnRpYWxzIGFuZCBCcmlkZ2UgY29uZmlndXJhdGlvblxyXG4gICAgLy8gdG8gbG9jYWwgc3RvcmFnZS5cclxuICAgIHNlbGYudXNlTG9jYWxTdG9yYWdlID0gdXNlTG9jYWxTdG9yYWdlO1xyXG5cclxuICAgIC8vIENvbmZpZ3VyZSBhbiBJZGVudGl0eSBvYmplY3Qgd2l0aCB0aGUgdXNlcidzIGNyZWRlbnRpYWxzLlxyXG4gICAgc2V0SWRlbnRpdHkoIGVtYWlsLCBoYXNoZWRQYXNzd29yZCwgdHJ1ZSApO1xyXG5cclxuICAgIC8vIFNlbmQgdGhlIHJlcXVlc3RcclxuICAgIHJlcXVlc3RQcml2YXRlKCAnR0VUJywgJ2xvZ2luJywgcGF5bG9hZCwgbnVsbCApLmRvbmUoIG9uRG9uZSApLmZhaWwoIG9uRmFpbCApO1xyXG5cclxuICAgIC8vIFJldHVybiB0aGUgZGVmZXJyZWQgb2JqZWN0IHNvIHRoZSBlbmQtdXNlciBjYW4gaGFuZGxlIGVycm9ycyBhcyB0aGV5IGNob29zZS5cclxuICAgIHJldHVybiBkZWZlcnJlZC5wcm9taXNlKCk7XHJcblxyXG4gIH07XHJcblxyXG4gIC8vIFtQUklWQVRFXSByZXF1ZXN0UmVjb3ZlclBhc3N3b3JkUHJpdmF0ZSgpXHJcbiAgLy8gVG8gYmUgY2FsbGVkIGJ5IHRoZSBwYWdlIGF0IHRoZSBhZGRyZXNzIHdoaWNoIGFuIGFjY291bnQgcmVjb3ZlcnkgZW1haWwgbGlua3MgdGhlIHVzZXJcclxuICAvLyB0by4gVGhleSB3aWxsIGhhdmUgZW50ZXJlZCB0aGVpciBuZXcgcGFzc3dvcmQgdG8gYW4gaW5wdXQgZmllbGQsIGFuZCB0aGUgZW1haWwgYW5kIGhhc2ggd2lsbCBcclxuICAvLyBoYXZlIGJlZW4gbWFkZSBhdmFpbGFibGUgdG8gdGhlIHBhZ2UgaW4gdGhlIHF1ZXJ5IHN0cmluZyBvZiB0aGUgVVJMLlxyXG4gIHZhciByZXF1ZXN0UmVjb3ZlclBhc3N3b3JkUHJpdmF0ZSA9IGZ1bmN0aW9uICggZW1haWwsIHBhc3N3b3JkLCBoYXNoICkge1xyXG5cclxuICAgIC8vIE5vdGlmeSB0aGUgdXNlciBvZiB0aGUgcmVjb3ZlciBwYXNzd29yZCBjYWxsIG9jY3VycmluZy5cclxuICAgIGlmICggdHlwZW9mIHNlbGYub25SZWNvdmVyUGFzc3dvcmRDYWxsZWQgPT09IFwiZnVuY3Rpb25cIiApIHtcclxuICAgICAgc2VsZi5vblJlY292ZXJQYXNzd29yZENhbGxlZCggZW1haWwsIGhhc2ggKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBIYXNoIHRoZSB1c2VyJ3MgcGFzc3dvcmRcclxuICAgIHZhciBoYXNoZWRQYXNzd29yZCA9IHNoYTI1NiggcGFzc3dvcmQgKS50b1N0cmluZyggZW5jX2hleCApO1xyXG5cclxuICAgIC8vIENsZWFyIHRoZSB1bmVuY3J5cHRlZCBwYXNzd29yZCBmcm9tIG1lbW9yeVxyXG4gICAgcGFzc3dvcmQgPSBudWxsO1xyXG5cclxuICAgIC8vIENyZWF0ZSBhIGRlZmVycmVkIG9iamVjdCB0byByZXR1cm4gc28gdGhlIGVuZC11c2VyIGNhbiBoYW5kbGUgc3VjY2Vzcy9mYWlsdXJlIGNvbnZlbmllbnRseS5cclxuICAgIHZhciBkZWZlcnJlZCA9IG5ldyBqUXVlcnkuRGVmZXJyZWQoKTtcclxuXHJcbiAgICAvLyBCdWlsZCBvdXIgaW50ZXJuYWwgc3VjY2VzcyBoYW5kbGVyICh0aGlzIGNhbGxzIGRlZmVycmVkLnJlc29sdmUoKSlcclxuICAgIHZhciBvbkRvbmUgPSBmdW5jdGlvbiAoIGRhdGEsIGpxWEhSICkge1xyXG5cclxuICAgICAgLy8gQ2hlY2sgdGhhdCB0aGUgY29udGVudCB0eXBlIChNZXNzYWdlKSBpcyBmb3JtYXR0ZWQgY29ycmVjdGx5LlxyXG4gICAgICBpZiAoIHR5cGVvZiBkYXRhLmNvbnRlbnQubWVzc2FnZSAhPT0gJ3N0cmluZycgKSB7XHJcbiAgICAgICAgb25GYWlsKCB7IHN0YXR1czogNDE3LCBtZXNzYWdlOiAnNDE3IChFeHBlY3RhdGlvbiBGYWlsZWQpIE1hbGZvcm1lZCBtZXNzYWdlLicgfSwganFYSFIgKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIExvZyB0aGUgc3VjY2VzcyB0byB0aGUgY29uc29sZS5cclxuICAgICAgaWYgKCBzZWxmLmRlYnVnID09PSB0cnVlICkge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCBcIkJSSURHRSB8IFJlY292ZXIgUGFzc3dvcmQgfCBcIiArIGRhdGEuY29udGVudC5tZXNzYWdlICk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIFNpZ25hbCB0aGUgZGVmZXJyZWQgb2JqZWN0IHRvIHVzZSBpdHMgc3VjY2VzcygpIGhhbmRsZXIuXHJcbiAgICAgIGRlZmVycmVkLnJlc29sdmUoIGRhdGEsIGpxWEhSICk7XHJcblxyXG4gICAgfTtcclxuXHJcbiAgICAvLyBCdWlsZCBvdXIgaW50ZXJuYWwgZmFpbHVyZSBoYW5kbGVyICh0aGlzIGNhbGxzIGRlZmVycmVkLnJlamVjdCgpKVxyXG4gICAgdmFyIG9uRmFpbCA9IGZ1bmN0aW9uICggZXJyb3IsIGpxWEhSICkge1xyXG5cclxuICAgICAgLy8gTG9nIHRoZSBlcnJvciB0byB0aGUgY29uc29sZS5cclxuICAgICAgaWYgKCBCcmlkZ2UuZGVidWcgPT09IHRydWUgKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvciggXCJCUklER0UgfCBSZWNvdmVyIFBhc3N3b3JkIHwgXCIgKyBlcnJvci5zdGF0dXMudG9TdHJpbmcoKSArIFwiID4+IFwiICsgZXJyb3IubWVzc2FnZSApO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBTaWduYWwgdGhlIGRlZmVycmVkIG9iamVjdCB0byB1c2UgaXRzIGZhaWwoKSBoYW5kbGVyLlxyXG4gICAgICBkZWZlcnJlZC5yZWplY3QoIGVycm9yLCBqcVhIUiApO1xyXG5cclxuICAgIH07XHJcblxyXG4gICAgLy8gQnVpbGQgdGhlIHBheWxvYWQgb2JqZWN0IHRvIHNlbmQgd2l0aCB0aGUgcmVxdWVzdFxyXG4gICAgdmFyIHBheWxvYWQgPSB7XHJcbiAgICAgIFwiaGFzaFwiOiBoYXNoLFxyXG4gICAgICBcIm1lc3NhZ2VcIjogaGFzaGVkUGFzc3dvcmRcclxuICAgIH07XHJcblxyXG4gICAgLy8gQ3JlYXRlIGEgdGVtcG9yYXJ5IGFuIElkZW50aXR5IG9iamVjdCB3aXRoIGEgYmxhbmsgcGFzc3dvcmQuXHJcbiAgICB2YXIgdGVtcElkZW50aXR5ID0gbmV3IElkZW50aXR5KCAnJywgJycsIHRydWUgKTtcclxuXHJcbiAgICAvLyBTZW5kIHRoZSByZXF1ZXN0XHJcbiAgICByZXF1ZXN0UHJpdmF0ZSggJ1BVVCcsICdyZWNvdmVyLXBhc3N3b3JkJywgcGF5bG9hZCwgdGVtcElkZW50aXR5ICkuZG9uZSggb25Eb25lICkuZmFpbCggb25GYWlsICk7XHJcblxyXG4gICAgLy8gUmV0dXJuIHRoZSBkZWZlcnJlZCBvYmplY3Qgc28gdGhlIGVuZC11c2VyIGNhbiBoYW5kbGUgZXJyb3JzIGFzIHRoZXkgY2hvb3NlLlxyXG4gICAgcmV0dXJuIGRlZmVycmVkLnByb21pc2UoKTtcclxuXHJcbiAgfTtcclxuXHJcbiAgLy8gW1BSSVZBVEVdIHJlcXVlc3RSZWdpc3RlclByaXZhdGUoKVxyXG4gIC8vIFJlZ2lzdGVyIGluIGEgdXNlciB3aXRoIHRoZSBnaXZlbiBlbWFpbC9wYXNzd29yZCBwYWlyLCBuYW1lLCBhbmQgYXBwbGljYXRpb24tc3BlY2lmaWMgZGF0YS5cclxuICAvLyBUaGlzIGRvZXMgY3JlYXRlcyBhbiBJZGVudGl0eSBvYmplY3QgZm9yIHRoZSB1c2VyIHRvIHNpZ24gdGhlIHJlZ2lzdHJhdGlvbiByZXF1ZXN0J3MgSE1BQyxcclxuICAvLyBob3dldmVyIHRoZSBwYXNzd29yZCBpcyB0cmFuc21pdHRlZCBpbiB0aGUgY29udGVudCBvZiB0aGUgbWVzc2FnZSAoU0hBLTI1NiBlbmNyeXB0ZWQpLCBzb1xyXG4gIC8vIHRoZW9yZXRpY2FsbHkgYW4gaW50ZXJjZXB0b3Igb2YgdGhpcyBtZXNzYWdlIGNvdWxkIHJlY29uc3RydWN0IHRoZSBITUFDIGFuZCBmYWxzaWZ5IGEgcmVxdWVzdFxyXG4gIC8vIHRvIHRoZSBzZXJ2ZXIgdGhlIHJlcXVlc3QgaXMgbWFkZSB3aXRob3V0IHVzaW5nIEhUVFBTIHByb3RvY29sIGFuZCBnaXZlbiBlbm91Z2ggcGVyc2lzdGVuY2VcclxuICAvLyBvbiB0aGUgcGFydCBvZiB0aGUgYXR0YWNrZXIuIFxyXG4gIHZhciByZXF1ZXN0UmVnaXN0ZXJQcml2YXRlID0gZnVuY3Rpb24gKCBlbWFpbCwgcGFzc3dvcmQsIGZpcnN0TmFtZSwgbGFzdE5hbWUsIGFwcERhdGEgKSB7XHJcblxyXG4gICAgLy8gTm90aWZ5IHRoZSB1c2VyIG9mIHRoZSByZWdpc3RlciBjYWxsIG9jY3VycmluZy5cclxuICAgIGlmICggdHlwZW9mIHNlbGYub25SZWdpc3RlckNhbGxlZCA9PT0gXCJmdW5jdGlvblwiICkge1xyXG4gICAgICBzZWxmLm9uUmVnaXN0ZXJDYWxsZWQoIGVtYWlsLCBmaXJzdE5hbWUsIGxhc3ROYW1lLCBhcHBEYXRhICk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gSGFzaCB0aGUgdXNlcidzIHBhc3N3b3JkXHJcbiAgICB2YXIgaGFzaGVkUGFzc3dvcmQgPSBzaGEyNTYoIHBhc3N3b3JkICkudG9TdHJpbmcoIGVuY19oZXggKTtcclxuXHJcbiAgICAvLyBDbGVhciB0aGUgdW5lbmNyeXB0ZWQgcGFzc3dvcmQgZnJvbSBtZW1vcnlcclxuICAgIHBhc3N3b3JkID0gbnVsbDtcclxuXHJcbiAgICAvLyBDcmVhdGUgYSBkZWZlcnJlZCBvYmplY3QgdG8gcmV0dXJuIHNvIHRoZSBlbmQtdXNlciBjYW4gaGFuZGxlIHN1Y2Nlc3MvZmFpbHVyZSBjb252ZW5pZW50bHkuXHJcbiAgICB2YXIgZGVmZXJyZWQgPSBuZXcgalF1ZXJ5LkRlZmVycmVkKCk7XHJcblxyXG4gICAgLy8gQnVpbGQgb3VyIGludGVybmFsIHN1Y2Nlc3MgaGFuZGxlciAodGhpcyBjYWxscyBkZWZlcnJlZC5yZXNvbHZlKCkpXHJcbiAgICB2YXIgb25Eb25lID0gZnVuY3Rpb24gKCBkYXRhLCBqcVhIUiApIHtcclxuXHJcbiAgICAgIC8vIENoZWNrIHRoYXQgdGhlIGNvbnRlbnQgdHlwZSAoTWVzc2FnZSkgaXMgZm9ybWF0dGVkIGNvcnJlY3RseS5cclxuICAgICAgaWYgKCB0eXBlb2YgZGF0YS5jb250ZW50Lm1lc3NhZ2UgIT09ICdzdHJpbmcnICkge1xyXG4gICAgICAgIG9uRmFpbCggeyBzdGF0dXM6IDQxNywgbWVzc2FnZTogJzQxNyAoRXhwZWN0YXRpb24gRmFpbGVkKSBNYWxmb3JtZWQgbWVzc2FnZS4nIH0sIGpxWEhSICk7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBMb2cgdGhlIHN1Y2Nlc3MgdG8gdGhlIGNvbnNvbGUuXHJcbiAgICAgIGlmICggc2VsZi5kZWJ1ZyA9PT0gdHJ1ZSApIHtcclxuICAgICAgICBjb25zb2xlLmxvZyggXCJCUklER0UgfCBSZWdpc3RlciB8IFwiICsgZGF0YS5jb250ZW50Lm1lc3NhZ2UgKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gU2lnbmFsIHRoZSBkZWZlcnJlZCBvYmplY3QgdG8gdXNlIGl0cyBzdWNjZXNzKCkgaGFuZGxlci5cclxuICAgICAgZGVmZXJyZWQucmVzb2x2ZSggZGF0YSwganFYSFIgKTtcclxuXHJcbiAgICB9O1xyXG5cclxuICAgIC8vIEJ1aWxkIG91ciBpbnRlcm5hbCBmYWlsdXJlIGhhbmRsZXIgKHRoaXMgY2FsbHMgZGVmZXJyZWQucmVqZWN0KCkpXHJcbiAgICB2YXIgb25GYWlsID0gZnVuY3Rpb24gKCBlcnJvciwganFYSFIgKSB7XHJcblxyXG4gICAgICAvLyBMb2cgdGhlIGVycm9yIHRvIHRoZSBjb25zb2xlLlxyXG4gICAgICBpZiAoIEJyaWRnZS5kZWJ1ZyA9PT0gdHJ1ZSApIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKCBcIkJSSURHRSB8IFJlZ2lzdGVyIHwgXCIgKyBlcnJvci5zdGF0dXMudG9TdHJpbmcoKSArIFwiID4+IFwiICsgZXJyb3IubWVzc2FnZSApO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBTaWduYWwgdGhlIGRlZmVycmVkIG9iamVjdCB0byB1c2UgaXRzIGZhaWwoKSBoYW5kbGVyLlxyXG4gICAgICBkZWZlcnJlZC5yZWplY3QoIGVycm9yLCBqcVhIUiApO1xyXG5cclxuICAgIH07XHJcblxyXG4gICAgLy8gQnVpbGQgdGhlIHBheWxvYWQgb2JqZWN0IHRvIHNlbmQgd2l0aCB0aGUgcmVxdWVzdFxyXG4gICAgdmFyIHBheWxvYWQgPSB7XHJcbiAgICAgIFwiYXBwRGF0YVwiOiBhcHBEYXRhLFxyXG4gICAgICBcImVtYWlsXCI6IGVtYWlsLFxyXG4gICAgICBcImZpcnN0TmFtZVwiOiBmaXJzdE5hbWUsXHJcbiAgICAgIFwibGFzdE5hbWVcIjogbGFzdE5hbWUsXHJcbiAgICAgIFwicGFzc3dvcmRcIjogaGFzaGVkUGFzc3dvcmRcclxuICAgIH07XHJcblxyXG4gICAgLy8gQ3JlYXRlIGEgdGVtcG9yYXJ5IGFuIElkZW50aXR5IG9iamVjdCB3aXRoIGEgYmxhbmsgcGFzc3dvcmQuXHJcbiAgICB2YXIgdGVtcElkZW50aXR5ID0gbmV3IElkZW50aXR5KCAnJywgJycsIHRydWUgKTtcclxuXHJcbiAgICAvLyBTZW5kIHRoZSByZXF1ZXN0XHJcbiAgICByZXF1ZXN0UHJpdmF0ZSggJ1BPU1QnLCAndXNlcnMnLCBwYXlsb2FkLCB0ZW1wSWRlbnRpdHkgKS5kb25lKCBvbkRvbmUgKS5mYWlsKCBvbkZhaWwgKTtcclxuXHJcbiAgICAvLyBSZXR1cm4gdGhlIGRlZmVycmVkIG9iamVjdCBzbyB0aGUgZW5kLXVzZXIgY2FuIGhhbmRsZSBlcnJvcnMgYXMgdGhleSBjaG9vc2UuXHJcbiAgICByZXR1cm4gZGVmZXJyZWQucHJvbWlzZSgpO1xyXG5cclxuICB9O1xyXG5cclxuICAvLyBbUFJJVkFURV0gcmVxdWVzdFZlcmlmeUVtYWlsUHJpdmF0ZSgpXHJcbiAgLy8gVG8gYmUgY2FsbGVkIGJ5IHRoZSBwYWdlIHRoZSBhdCBhZGRyZXNzIHdoaWNoIGFuIGVtYWlsIHZlcmlmaWNhdGlvbiBlbWFpbCBsaW5rcyB0aGUgdXNlciB0by5cclxuICAvLyBUaGUgdXNlciB3aWxsIGJlIHNlbnQgdG8gdGhpcyBwYWdlIHdpdGggdGhlaXIgZW1haWwgYW5kIGEgaGFzaCBpbiB0aGUgcXVlcnkgc3RyaW5nIG9mIHRoZSBVUkwuXHJcbiAgdmFyIHJlcXVlc3RWZXJpZnlFbWFpbFByaXZhdGUgPSBmdW5jdGlvbiAoIGVtYWlsLCBoYXNoICkge1xyXG5cclxuICAgIC8vIE5vdGlmeSB0aGUgdXNlciBvZiB0aGUgdmVyaWZ5IGVtYWlsIGNhbGwgb2NjdXJyaW5nLlxyXG4gICAgaWYgKCB0eXBlb2Ygc2VsZi5vblZlcmlmeUVtYWlsQ2FsbGVkID09PSBcImZ1bmN0aW9uXCIgKSB7XHJcbiAgICAgIHNlbGYub25WZXJpZnlFbWFpbENhbGxlZCggZW1haWwsIGhhc2ggKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBDcmVhdGUgYSBkZWZlcnJlZCBvYmplY3QgdG8gcmV0dXJuIHNvIHRoZSBlbmQtdXNlciBjYW4gaGFuZGxlIHN1Y2Nlc3MvZmFpbHVyZSBjb252ZW5pZW50bHkuXHJcbiAgICB2YXIgZGVmZXJyZWQgPSBuZXcgalF1ZXJ5LkRlZmVycmVkKCk7XHJcblxyXG4gICAgLy8gQnVpbGQgb3VyIGludGVybmFsIHN1Y2Nlc3MgaGFuZGxlciAodGhpcyBjYWxscyBkZWZlcnJlZC5yZXNvbHZlKCkpXHJcbiAgICB2YXIgb25Eb25lID0gZnVuY3Rpb24gKCBkYXRhLCBqcVhIUiApIHtcclxuXHJcbiAgICAgIC8vIENoZWNrIHRoYXQgdGhlIGNvbnRlbnQgdHlwZSAoTWVzc2FnZSkgaXMgZm9ybWF0dGVkIGNvcnJlY3RseS5cclxuICAgICAgaWYgKCB0eXBlb2YgZGF0YS5jb250ZW50Lm1lc3NhZ2UgIT09ICdzdHJpbmcnICkge1xyXG4gICAgICAgIG9uRmFpbCggeyBzdGF0dXM6IDQxNywgbWVzc2FnZTogJzQxNyAoRXhwZWN0YXRpb24gRmFpbGVkKSBNYWxmb3JtZWQgbWVzc2FnZS4nIH0sIGpxWEhSICk7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBMb2cgdGhlIHN1Y2Nlc3MgdG8gdGhlIGNvbnNvbGUuXHJcbiAgICAgIGlmICggc2VsZi5kZWJ1ZyA9PT0gdHJ1ZSApIHtcclxuICAgICAgICBjb25zb2xlLmxvZyggXCJCUklER0UgfCBWZXJpZnkgRW1haWwgfCBcIiArIGRhdGEuY29udGVudC5tZXNzYWdlICk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIFNpZ25hbCB0aGUgZGVmZXJyZWQgb2JqZWN0IHRvIHVzZSBpdHMgc3VjY2VzcygpIGhhbmRsZXIuXHJcbiAgICAgIGRlZmVycmVkLnJlc29sdmUoIGRhdGEsIGpxWEhSICk7XHJcblxyXG4gICAgfTtcclxuXHJcbiAgICAvLyBCdWlsZCBvdXIgaW50ZXJuYWwgZmFpbHVyZSBoYW5kbGVyICh0aGlzIGNhbGxzIGRlZmVycmVkLnJlamVjdCgpKVxyXG4gICAgdmFyIG9uRmFpbCA9IGZ1bmN0aW9uICggZXJyb3IsIGpxWEhSICkge1xyXG5cclxuICAgICAgLy8gTG9nIHRoZSBlcnJvciB0byB0aGUgY29uc29sZS5cclxuICAgICAgaWYgKCBCcmlkZ2UuZGVidWcgPT09IHRydWUgKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvciggXCJCUklER0UgfCBWZXJpZnkgRW1haWwgfCBcIiArIGVycm9yLnN0YXR1cy50b1N0cmluZygpICsgXCIgPj4gXCIgKyBlcnJvci5tZXNzYWdlICk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIFNpZ25hbCB0aGUgZGVmZXJyZWQgb2JqZWN0IHRvIHVzZSBpdHMgZmFpbCgpIGhhbmRsZXIuXHJcbiAgICAgIGRlZmVycmVkLnJlamVjdCggZXJyb3IsIGpxWEhSICk7XHJcblxyXG4gICAgfTtcclxuXHJcbiAgICAvLyBCdWlsZCB0aGUgcGF5bG9hZCBvYmplY3QgdG8gc2VuZCB3aXRoIHRoZSByZXF1ZXN0XHJcbiAgICB2YXIgcGF5bG9hZCA9IHtcclxuICAgICAgXCJoYXNoXCI6IGhhc2hcclxuICAgIH07XHJcblxyXG4gICAgLy8gQ3JlYXRlIGEgdGVtcG9yYXJ5IGFuIElkZW50aXR5IG9iamVjdCB3aXRoIGEgYmxhbmsgcGFzc3dvcmQuXHJcbiAgICB2YXIgdGVtcElkZW50aXR5ID0gbmV3IElkZW50aXR5KCAnJywgJycsIHRydWUgKTtcclxuXHJcbiAgICAvLyBTZW5kIHRoZSByZXF1ZXN0XHJcbiAgICByZXF1ZXN0UHJpdmF0ZSggJ1BVVCcsICd2ZXJpZnktZW1haWwnLCBwYXlsb2FkLCB0ZW1wSWRlbnRpdHkgKS5kb25lKCBvbkRvbmUgKS5mYWlsKCBvbkZhaWwgKTtcclxuXHJcbiAgICAvLyBSZXR1cm4gdGhlIGRlZmVycmVkIG9iamVjdCBzbyB0aGUgZW5kLXVzZXIgY2FuIGhhbmRsZSBlcnJvcnMgYXMgdGhleSBjaG9vc2UuXHJcbiAgICByZXR1cm4gZGVmZXJyZWQucHJvbWlzZSgpO1xyXG5cclxuICB9O1xyXG5cclxuICAvLyBbUFJJVkFURV0gc2V0SWRlbnRpdHkoKVxyXG4gIC8vIFNldHMgdGhlIGN1cnJlbnQgSWRlbnRpdHkgb2JqZWN0IHRvIGEgbmV3IGluc3RhbmNlIGdpdmVuIGEgdXNlcidzIGVtYWlsIGFuZCBwYXNzd29yZC5cclxuICB2YXIgc2V0SWRlbnRpdHkgPSBmdW5jdGlvbiAoIGVtYWlsLCBwYXNzd29yZCwgZG9udEhhc2hQYXNzd29yZCApIHtcclxuXHJcbiAgICBpZGVudGl0eSA9IG5ldyBJZGVudGl0eSggZW1haWwsIHBhc3N3b3JkLCBkb250SGFzaFBhc3N3b3JkICk7XHJcblxyXG4gIH07XHJcblxyXG4gIC8vIFtQUklWQVRFXSBzZXRVc2VyXHJcbiAgLy8gU2V0cyB0aGUgY3VycmVudCB1c2VyIGFuZCBhZGRpdGlvbmFsIGRhdGEgb2JqZWN0cyBiYXNlZCBvbiB0aGUgZGF0YSByZXR1cm5lZCBmcm9tIGEgbG9naW5cclxuICAvLyBhbmQgcGVyZm9ybXMgYWxsIG9mIHRoZSBhc3NvY2lhdGVkIGVycm9yIGNoZWNrcyBmb3IgbWFsZm9ybWVkIGxvZ2luIGRhdGEuXHJcbiAgdmFyIHNldFVzZXIgPSBmdW5jdGlvbiAoIHVzZXIsIGFkZGl0aW9uYWxEYXRhICkge1xyXG5cclxuICAgIC8vIFNldCB0aGUgdXNlciBhbmQgYWRkaXRpb25hbCBkYXRhIG9iamVjdHNcclxuICAgIHNlbGYudXNlciA9IHVzZXI7XHJcbiAgICBzZWxmLmFkZGl0aW9uYWxEYXRhID0gYWRkaXRpb25hbERhdGE7XHJcblxyXG4gIH07XHJcblxyXG5cclxuICAvLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy9cclxuICAvLyBQVUJMSUMgLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy9cclxuICAvLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy9cclxuXHJcbiAgLy8vLy8vLy8vLy8vLy8vL1xyXG4gIC8vIFBST1BFUlRJRVMgLy9cclxuICAvLy8vLy8vLy8vLy8vLy8vXHJcblxyXG4gIC8vIFtQVUJMSUNdIGFkZGl0aW9uYWxEYXRhXHJcbiAgLy8gVGhlIGEgaGFzaG1hcCBvZiBvcHRpb25hbCBvYmplY3RzIHJldHVybmVkIGJ5IHRoZSB0aGUgZGF0YWJhc2UgdGhhdCBwcm92aWRlIGFkZGl0aW9uYWxcclxuICAvLyBpbmZvcm1hdGlvbiB0byBiZSB1c2VkIGZvciBpbXBsZW1lbnRhdGlvbi1zcGVjaWZpYyBsb2dpbiBuZWVkcy5cclxuICBzZWxmLmFkZGl0aW9uYWxEYXRhID0gbnVsbDtcclxuXHJcbiAgLy8gW1BVQkxJQ10gZGVidWdcclxuICAvLyBJZiBzZXQgdG8gdHJ1ZSwgQnJpZGdlIHdpbGwgbG9nIGVycm9ycyBhbmQgd2FybmluZ3MgdG8gdGhlIGNvbnNvbGUgd2hlbiB0aGV5IG9jY3VyLlxyXG4gIHNlbGYuZGVidWcgPSBmYWxzZTtcclxuXHJcbiAgLy8gW1BVQkxJQ10gdGltZW91dFxyXG4gIC8vIFRoZSB0aW1lb3V0IHBlcmlvZCBmb3IgcmVxdWVzdHMgKGluIG1pbGxpc2Vjb25kcykuXHJcbiAgc2VsZi50aW1lb3V0ID0gMTAwMDA7XHJcblxyXG4gIC8vIFtQVUJMSUNdIHVybFxyXG4gIC8vIFRoZSBVUkwgcGF0aCB0byB0aGUgQVBJIHRvIGJlIGJyaWRnZWQuIFRoaXMgVVJMIG11c3QgYmUgd3JpdHRlbiBzbyB0aGF0IHRoZSBmaW5hbCBcclxuICAvLyBjaGFyYWN0ZXIgaXMgYSBmb3J3YXJkLXNsYXNoIChlLmcuIGh0dHBzOi8vcGVpci5heG9uaW50ZXJhY3RpdmUuY2EvYXBpLzEuMC8pLlxyXG4gIHNlbGYudXJsID0gJyc7XHJcblxyXG4gIC8vIFtQVUJMSUNdIHVzZUxvY2FsU3RvcmFnZVxyXG4gIC8vIFdoZXRoZXIgb3Igbm90IHVzZXIgY3JlZGVudGlhbHMgYW5kIEJyaWRnZSBjb25maWd1cmF0aW9uIHdpbGwgYmUgcGVyc2lzdGVkIHRvIGxvY2FsIHN0b3JhZ2UuXHJcbiAgc2VsZi51c2VMb2NhbFN0b3JhZ2UgPSBmYWxzZTtcclxuXHJcbiAgLy8gW1BVQkxJQ10gdXNlclxyXG4gIC8vIFRoZSBVc2VyIG9iamVjdCByZXR1cm5lZCBieSB0aGUgdGhlIGRhdGFiYXNlIHJlbGF0aW5nIHRvIHRoZSBjdXJyZW50IGlkZW50aXR5LlxyXG4gIHNlbGYudXNlciA9IG51bGw7XHJcblxyXG5cclxuICAvLy8vLy8vLy8vLy9cclxuICAvLyBFVkVOVFMgLy9cclxuICAvLy8vLy8vLy8vLy9cclxuXHJcbiAgLy8gW1BVQkxJQ10gb25DaGFuZ2VQYXNzd29yZENhbGxlZCgpXHJcbiAgLy8gVGhlIGNhbGxiYWNrIHRvIGNhbGwgd2hlbiB0aGUgcmVxdWVzdENoYW5nZVBhc3N3b3JkKCkgZnVuY3Rpb24gaXMgY2FsbGVkLlxyXG4gIC8vIFNpZ25hdHVyZTogZnVuY3Rpb24gKCkge31cclxuICBzZWxmLm9uQ2hhbmdlUGFzc3dvcmRDYWxsZWQgPSBudWxsO1xyXG5cclxuICAvLyBbUFVCTElDXSBvbkZvcmdvdFBhc3N3b3JkQ2FsbGVkKClcclxuICAvLyBUaGUgY2FsbGJhY2sgdG8gY2FsbCB3aGVuIHRoZSByZXF1ZXN0Rm9yZ290UGFzc3dvcmQoKSBmdW5jdGlvbiBpcyBjYWxsZWQuXHJcbiAgLy8gU2lnbmF0dXJlOiBmdW5jdGlvbiAoIGVtYWlsICkge31cclxuICBzZWxmLm9uRm9yZ290UGFzc3dvcmRDYWxsZWQgPSBudWxsO1xyXG5cclxuICAvLyBbUFVCTElDXSBvbkxvZ2luQ2FsbGVkKClcclxuICAvLyBUaGUgY2FsbGJhY2sgdG8gY2FsbCB3aGVuIHRoZSByZXF1ZXN0TG9naW4oKSBmdW5jdGlvbiBpcyBjYWxsZWQuXHJcbiAgLy8gU2lnbmF0dXJlOiBmdW5jdGlvbiAoIGVtYWlsLCB1c2VMb2NhbFN0b3JhZ2UgKSB7fVxyXG4gIHNlbGYub25Mb2dpbkNhbGxlZCA9IG51bGw7XHJcblxyXG4gIC8vIFtQVUJMSUNdIGxvZ2luRXJyb3JDYWxsYmFjaygpXHJcbiAgLy8gVGhlIGNhbGxiYWNrIHRvIGNhbGwgd2hlbiB0aGUgbG9nb3V0KCkgZnVuY3Rpb24gaXMgY2FsbGVkLlxyXG4gIC8vIFNpZ25hdHVyZTogZnVuY3Rpb24gKCkge31cclxuICBzZWxmLm9uTG9nb3V0Q2FsbGVkID0gbnVsbDtcclxuXHJcbiAgLy8gW1BVQkxJQ10gb25SZWNvdmVyUGFzc3dvcmRDYWxsZWQoKVxyXG4gIC8vIFRoZSBjYWxsYmFjayB0byBjYWxsIHdoZW4gdGhlIHJlcXVlc3RSZWNvdmVyUGFzc3dvcmQoKSBmdW5jdGlvbiBpcyBjYWxsZWQuXHJcbiAgLy8gU2lnbmF0dXJlOiBmdW5jdGlvbiAoIGVtYWlsLCBoYXNoICkge31cclxuICBzZWxmLm9uUmVjb3ZlclBhc3N3b3JkQ2FsbGVkID0gbnVsbDtcclxuXHJcbiAgLy8gW1BVQkxJQ10gb25SZWdpc3RlckNhbGxlZCgpXHJcbiAgLy8gVGhlIGNhbGxiYWNrIHRvIGNhbGwgd2hlbiB0aGUgcmVxdWVzdFJlZ2lzdGVyKCkgZnVuY3Rpb24gaXMgY2FsbGVkLlxyXG4gIC8vIFNpZ25hdHVyZTogZnVuY3Rpb24gKCBlbWFpbCwgZmlyc3ROYW1lLCBsYXN0TmFtZSwgYXBwRGF0YSApIHt9XHJcbiAgc2VsZi5vblJlZ2lzdGVyQ2FsbGVkID0gbnVsbDtcclxuXHJcbiAgLy8gW1BVQkxJQ10gcmVxdWVzdENhbGxiYWNrKClcclxuICAvLyBUaGUgY2FsbGJhY2sgdG8gY2FsbCB3aGVuIGEgcmVxdWVzdCgpIGNhbGwgb2NjdXJzLCBidXQgYmVmb3JlIGl0IGlzIHNlbnQuXHJcbiAgLy8gU2lnbmF0dXJlOiBmdW5jdGlvbiAoIG1ldGhvZCwgcmVzb3VyY2UsIHBheWxvYWQgKSB7fVxyXG4gIHNlbGYub25SZXF1ZXN0Q2FsbGVkID0gbnVsbDtcclxuXHJcbiAgLy8gW1BVQkxJQ10gb25WZXJpZnlFbWFpbENhbGxlZCgpXHJcbiAgLy8gVGhlIGNhbGxiYWNrIHRvIGNhbGwgd2hlbiB0aGUgcmVxdWVzdFZlcmlmeUVtYWlsKCkgZnVuY3Rpb24gaXMgY2FsbGVkLlxyXG4gIC8vIFNpZ25hdHVyZTogZnVuY3Rpb24gKCBlbWFpbCwgaGFzaCApIHt9XHJcbiAgc2VsZi5vblZlcmlmeUVtYWlsQ2FsbGVkID0gbnVsbDtcclxuXHJcblxyXG4gIC8vLy8vLy8vLy9cclxuICAvLyBJTklUIC8vXHJcbiAgLy8vLy8vLy8vL1xyXG5cclxuICAvLyBbUFVCTElDXSBpbml0KClcclxuICAvLyBDb25maWd1cmUgdGhlYiBCcmlkZ2Ugd2l0aCBhIG5ldyBVUkwgYW5kIHRpbWVvdXQuXHJcbiAgc2VsZi5pbml0ID0gZnVuY3Rpb24gKCB1cmwsIHRpbWVvdXQgKSB7XHJcblxyXG4gICAgc2VsZi51cmwgPSB1cmw7XHJcbiAgICBzZWxmLnRpbWVvdXQgPSB0aW1lb3V0O1xyXG5cclxuICB9O1xyXG5cclxuXHJcbiAgLy8vLy8vLy8vLy8vLy8vXHJcbiAgLy8gRlVOQ1RJT05TIC8vXHJcbiAgLy8vLy8vLy8vLy8vLy8vXHJcblxyXG4gIC8vIFtQVUJMSUNdIGlzRXJyb3JDb2RlUmVzcG9uc2UoKVxyXG4gIC8vIFJldHVybnMgYW4gRXJyb3Igb2JqZWN0IGlmIHRoZSBwcm92aWRlZCBqcVhIUiBoYXMgYSBzdGF0dXMgY29kZSBiZXR3ZWVuIDQwMCBhbmQgNTk5XHJcbiAgLy8gKGluY2x1c2l2ZSkuIFNpbmNlIHRoZSA0MDAgYW5kIDUwMCBzZXJpZXMgc3RhdHVzIGNvZGVzIHJlcHJlc2VudCBlcnJvcnMgb2YgdmFyaW91cyBraW5kcyxcclxuICAvLyB0aGlzIGFjdHMgYXMgYSBjYXRjaC1hbGwgZmlsdGVyIGZvciBjb21tb24gZXJyb3IgY2FzZXMgdG8gYmUgaGFuZGxlZCBieSB0aGUgY2xpZW50LlxyXG4gIC8vIFJldHVybnMgbnVsbCBpZiB0aGUgcmVzcG9uc2Ugc3RhdHVzIGlzIG5vdCBiZXR3ZWVuIDQwMCBhbmQgNTk5IChpbmNsdXNpdmUpLlxyXG4gIC8vIEVycm9yIGZvcm1hdDogeyBzdGF0dXM6IDQwNCwgbWVzc2FnZTogXCJUaGUgcmVzb3VyY2UgeW91IHJlcXVlc3RlZCB3YXMgbm90IGZvdW5kLlwiIH1cclxuICBzZWxmLmlzRXJyb3JDb2RlUmVzcG9uc2UgPSBmdW5jdGlvbiAoIGpxWEhSICkge1xyXG5cclxuICAgIC8vIFJldHVybiBhbiBFcnJvciBvYmplY3QgaWYgdGhlIHN0YXR1cyBjb2RlIGlzIGJldHdlZW4gNDAwIGFuZCA1OTkgKGluY2x1c2l2ZSkuXHJcbiAgICBpZiAoIGpxWEhSLnN0YXR1cyA+PSA0MDAgJiYganFYSFIuc3RhdHVzIDwgNjAwICkge1xyXG5cclxuICAgICAgc3dpdGNoICgganFYSFIuc3RhdHVzICkge1xyXG4gICAgICBjYXNlIDQwMDpcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgc3RhdHVzOiA0MDAsXHJcbiAgICAgICAgICBtZXNzYWdlOiAnNDAwIChCYWQgUmVxdWVzdCkgPj4gWW91ciByZXF1ZXN0IHdhcyBub3QgZm9ybWF0dGVkIGNvcnJlY3RseS4nXHJcbiAgICAgICAgfTtcclxuICAgICAgY2FzZSA0MDE6XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgIHN0YXR1czogNDAxLFxyXG4gICAgICAgICAgbWVzc2FnZTogJzQwMSAoVW5hdXRob3JpemVkKSA+PiBZb3UgZG8gbm90IGhhdmUgc3VmZmljaWVudCBwcml2ZWxpZ2VzIHRvIHBlcmZvcm0gdGhpcyBvcGVyYXRpb24uJ1xyXG4gICAgICAgIH07XHJcbiAgICAgIGNhc2UgNDAzOlxyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICBzdGF0dXM6IDQwMyxcclxuICAgICAgICAgIG1lc3NhZ2U6ICc0MDMgKEZvcmJpZGRlbikgPj4gWW91ciBlbWFpbCBhbmQgcGFzc3dvcmQgZG8gbm90IG1hdGNoIGFueSB1c2VyIG9uIGZpbGUuJ1xyXG4gICAgICAgIH07XHJcbiAgICAgIGNhc2UgNDA0OlxyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICBzdGF0dXM6IDQwNCxcclxuICAgICAgICAgIG1lc3NhZ2U6ICc0MDQgKE5vdCBGb3VuZCkgPj4gVGhlIHJlc291cmNlIHlvdSByZXF1ZXN0ZWQgZG9lcyBub3QgZXhpc3QuJ1xyXG4gICAgICAgIH07XHJcbiAgICAgIGNhc2UgNDA5OlxyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICBzdGF0dXM6IDQwOSxcclxuICAgICAgICAgIG1lc3NhZ2U6ICc0MDkgKENvbmZsaWN0KSA+PiBBIHVuaXF1ZSBkYXRhYmFzZSBmaWVsZCBtYXRjaGluZyB5b3VyIFBVVCBtYXkgYWxyZWFkeSBleGlzdC4nXHJcbiAgICAgICAgfTtcclxuICAgICAgY2FzZSA1MDA6XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgIHN0YXR1czogNTAwLFxyXG4gICAgICAgICAgbWVzc2FnZTogJzUwMCAoSW50ZXJuYWwgU2VydmVyIEVycm9yKSA+PiBBbiBlcnJvciBoYXMgdGFrZW4gcGxhY2UgaW4gdGhlIEJyaWRnZSBzZXJ2ZXIuJ1xyXG4gICAgICAgIH07XHJcbiAgICAgIGNhc2UgNTAzOlxyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICBzdGF0dXM6IDUwMyxcclxuICAgICAgICAgIG1lc3NhZ2U6ICc1MDMgKFNlcnZpY2UgVW5hdmFpbGFibGUpID4+IFRoZSBCcmlkZ2Ugc2VydmVyIG1heSBiZSBzdG9wcGVkLidcclxuICAgICAgICB9O1xyXG4gICAgICBkZWZhdWx0OlxyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICBzdGF0dXM6IGpxWEhSLnN0YXR1cyxcclxuICAgICAgICAgIG1lc3NhZ2U6ICdFcnJvciEgU29tZXRoaW5nIHdlbnQgd3JvbmchJ1xyXG4gICAgICAgIH07XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvLyBSZXR1cm4gbnVsbCBmb3Igbm8gZXJyb3IgY29kZS5cclxuICAgIHJldHVybiBudWxsO1xyXG5cclxuICB9O1xyXG5cclxuICAvLyBbUFVCTElDXSBpc0xvZ2dlZEluKClcclxuICAvLyBDaGVjayBpZiB0aGVyZSBpcyBjdXJyZW50bHkgYSB1c2VyIG9iamVjdCBzZXQuIElmIG5vIHVzZXIgb2JqZWN0IGlzIHNldCwgdGhlbiBub25lXHJcbiAgLy8gd2FzIHJldHVybmVkIGZyb20gdGhlIGxvZ2luIGF0dGVtcHQgKGFuZCB0aGUgdXNlciBpcyBzdGlsbCBsb2dnZWQgb3V0KSBvciB0aGUgdXNlciBcclxuICAvLyBsb2dnZWQgb3V0IG1hbnVhbGx5LlxyXG4gIHNlbGYuaXNMb2dnZWRJbiA9IGZ1bmN0aW9uICgpIHtcclxuXHJcbiAgICByZXR1cm4gKCBzZWxmLnVzZXIgIT09IG51bGwgKTtcclxuXHJcbiAgfTtcclxuXHJcbiAgLy8gW1BVQkxJQ10gbG9nb3V0KClcclxuICAvLyBTZXQgdGhlIHVzZXIgb2JqZWN0IHRvIG51bGwgYW5kIGNsZWFyIHRoZSBJZGVudGl0eSBvYmplY3QgdXNlciB0byBzaWduIHJlcXVlc3RzIGZvclxyXG4gIC8vIGF1dGhlbnRpY2F0aW9uIHB1cnBvc2VzLCBzbyB0aGF0IHRoZSBsb2dnZWQtb3V0IHVzZXIncyBjcmVkZW50aWFscyBjYW4ndCBzdGlsbCBiZVxyXG4gIC8vIHVzZXIgdG8gYXV0aG9yaXplIHJlcXVlc3RzLlxyXG4gIHNlbGYubG9nb3V0ID0gZnVuY3Rpb24gKCkge1xyXG5cclxuICAgIC8vIERlbGV0ZSB0aGUgSWRlbnRpdHkgb2JqZWN0IHRvIHByZXNlcnZlIHRoZSB1c2VyJ3MgcGFzc3dvcmQgc2VjdXJpdHkuXHJcbiAgICBjbGVhcklkZW50aXR5KCk7XHJcblxyXG4gICAgLy8gQ2xlYXIgdGhlIHVzZXIgc28gQnJpZGdlIHJlcG9ydHMgdGhhdCBpdCBpcyBsb2dnZWQgb3V0LlxyXG4gICAgY2xlYXJVc2VyKCk7XHJcblxyXG4gICAgLy8gQ2xlYXIgdGhlIGlkZW50aXR5IGZyb20gbG9jYWwgc3RvcmFnZSB0byBwcmVzZXJ2ZSB0aGUgdXNlcidzIHBhc3N3b3JkIHNlY3VyaXR5LlxyXG4gICAgLy8gSWYgbm8gaWRlbnRpdHkgaXMgc3RvcmVkLCB0aGlzIHdpbGwgZG8gbm90aGluZy5cclxuICAgIGpRdWVyeS5qU3RvcmFnZS5kZWxldGVLZXkoICdicmlkZ2UtY2xpZW50LWlkZW50aXR5JyApO1xyXG5cclxuICAgIC8vIE5vdGlmeSB0aGUgdXNlciBvZiB0aGUgbG9nb3V0IGFjdGlvbi5cclxuICAgIGlmICggdHlwZW9mIHNlbGYub25Mb2dvdXRDYWxsZWQgPT09ICdmdW5jdGlvbicgKSB7XHJcbiAgICAgIHNlbGYub25Mb2dvdXRDYWxsZWQoKTtcclxuICAgIH1cclxuXHJcbiAgfTtcclxuXHJcbiAgLy8gW1BVQkxJQ10gcmVxdWVzdCgpXHJcbiAgLy8gU2VuZHMgYW4gWEhSIHJlcXVlc3QgdXNpbmcgalF1ZXJ5LmFqYXgoKSB0byB0aGUgZ2l2ZW4gQVBJIHJlc291cmNlIHVzaW5nIHRoZSBnaXZlbiBcclxuICAvLyBIVFRQIG1ldGhvZC4gVGhlIEhUVFAgcmVxdWVzdCBib2R5IHdpbGwgYmUgc2V0IHRvIHRoZSBKU09OLnN0cmluZ2lmeSgpZWQgcmVxdWVzdCBcclxuICAvLyB0aGF0IGlzIGdlbmVyYXRlZCBieSB0aGUgSWRlbnRpdHkgb2JqZWN0IHNldCB0byBwZXJmb3JtIEhNQUMgc2lnbmluZy5cclxuICAvLyBSZXR1cm5zIGEgalF1ZXJ5IGpxWkhSIG9iamVjdC4gU2VlIGh0dHA6Ly9hcGkuanF1ZXJ5LmNvbS9qUXVlcnkuYWpheC8janFYSFIuXHJcbiAgLy8gSWYgbm8gSWRlbnRpdHkgaXMgc2V0LCBzZW5kUmVxdWVzdCgpIHJldHVybnMgbnVsbCwgaW5kaWNhdGluZyBubyByZXF1ZXN0IHdhcyBzZW50LlxyXG4gIHNlbGYucmVxdWVzdCA9IGZ1bmN0aW9uICggbWV0aG9kLCByZXNvdXJjZSwgcGF5bG9hZCApIHtcclxuXHJcbiAgICByZXR1cm4gcmVxdWVzdFByaXZhdGUoIG1ldGhvZCwgcmVzb3VyY2UsIHBheWxvYWQsIG51bGwgKTtcclxuXHJcbiAgfTtcclxuXHJcbiAgLy8gW1BVQkxJQ10gcmVxdWVzdENoYW5nZVBhc3N3b3JkKClcclxuICAvLyBUaGUgcHVibGljIHJlcXVlc3RDaGFuZ2VQYXNzd29yZCgpIGZ1bmN0aW9uIHVzZWQgdG8gaGlkZSByZXF1ZXN0Q2hhbmdlUGFzc3dvcmRQcml2YXRlKCkuXHJcbiAgc2VsZi5yZXF1ZXN0Q2hhbmdlUGFzc3dvcmQgPSBmdW5jdGlvbiAoIG9sZFBhc3N3b3JkLCBuZXdQYXNzd29yZCApIHtcclxuXHJcbiAgICByZXR1cm4gcmVxdWVzdENoYW5nZVBhc3N3b3JkUHJpdmF0ZSggb2xkUGFzc3dvcmQsIG5ld1Bhc3N3b3JkICk7XHJcblxyXG4gIH07XHJcblxyXG4gIC8vIFtQVUJMSUNdIHJlcXVlc3RGb3Jnb3RQYXNzd29yZCgpXHJcbiAgLy8gVGhlIHB1YmxpYyByZXF1ZXN0Rm9yZ290UGFzc3dvcmQoKSBmdW5jdGlvbiB1c2VkIHRvIGhpZGUgcmVxdWVzdEZvcmdvdFBhc3N3b3JkUHJpdmF0ZSgpLlxyXG4gIHNlbGYucmVxdWVzdEZvcmdvdFBhc3N3b3JkID0gZnVuY3Rpb24gKCBlbWFpbCApIHtcclxuXHJcbiAgICByZXR1cm4gcmVxdWVzdEZvcmdvdFBhc3N3b3JkUHJpdmF0ZSggZW1haWwgKTtcclxuXHJcbiAgfTtcclxuXHJcbiAgLy8gW1BVQkxJQ10gcmVxdWVzdExvZ2luKClcclxuICAvLyBUaGUgcHVibGljIHJlcXVlc3RMb2dpbigpIGZ1bmN0aW9uIHVzZWQgdG8gaGlkZSByZXF1ZXN0TG9naW5Qcml2YXRlKCkuXHJcbiAgc2VsZi5yZXF1ZXN0TG9naW4gPSBmdW5jdGlvbiAoIGVtYWlsLCBwYXNzd29yZCwgdXNlTG9jYWxTdG9yYWdlICkge1xyXG5cclxuICAgIHJldHVybiByZXF1ZXN0TG9naW5Qcml2YXRlKCBlbWFpbCwgcGFzc3dvcmQsIHVzZUxvY2FsU3RvcmFnZSwgZmFsc2UgKTtcclxuXHJcbiAgfTtcclxuXHJcbiAgLy8gW1BVQkxJQ10gcmVxdWVzdExvZ2luU3RvcmVkSWRlbnRpdHkoKVxyXG4gIC8vIENoZWNrcyB0aGUgYnJvd3NlcidzIGxvY2FsIHN0b3JhZ2UgZm9yIGFuIGV4aXN0aW5nIHVzZXIgYW5kIHBlcmZvcm1zIGEgbG9naW4gcmVxdWVzdFxyXG4gIC8vIHVzaW5nIHRoZSBzdG9yZWQgY3JlZGVudGlhbHMgaWYgb25lIGlzIGZvdW5kLiBSZXR1cm5zIGEgalF1ZXJ5IERlZmVycmVkIG9iamVjdCBpZiBhIGxvZ2luIFxyXG4gIC8vIHJlcXVlc3Qgd2FzIHNlbnQgYW5kIG51bGwgaWYgbm8gc3RvcmVkIGlkZW50aXR5IHdhcyBmb3VuZCAvIGxvZ2luIHJlcXVlc3Qgd2FzIHNlbnQuXHJcbiAgc2VsZi5yZXF1ZXN0TG9naW5TdG9yZWRJZGVudGl0eSA9IGZ1bmN0aW9uICgpIHtcclxuXHJcbiAgICAvLyBDaGVjayBpZiBhbiBpZGVudGl0eSBpcyBpbiBsb2NhbCBzdG9yYWdlIHRvIHVzZSBmb3IgYXV0aGVudGljYXRpb24uXHJcbiAgICB2YXIgc3RvcmVkSWRlbnRpdHkgPSBqUXVlcnkualN0b3JhZ2UuZ2V0KCAnYnJpZGdlLWNsaWVudC1pZGVudGl0eScsIG51bGwgKTtcclxuICAgIGlmICggc3RvcmVkSWRlbnRpdHkgIT09IG51bGwgKSB7XHJcblxyXG4gICAgICB2YXIgcGFyc2VkSWRlbnRpdHkgPSBKU09OLnBhcnNlKCBzdG9yZWRJZGVudGl0eSApO1xyXG5cclxuICAgICAgaWYgKCBzZWxmLmRlYnVnID09PSB0cnVlICkge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCBcIlN0b2VkIGlkZW50aXR5OiBcIiArIEpTT04uc3RyaW5naWZ5KCBwYXJzZWRJZGVudGl0eSApICk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIFNlbmQgYSBsb2dpbiByZXF1ZXN0IHVzaW5nIHRoZSBwcml2YXRlIGxvZ2luIGNhbGwgYW5kIHJldHVybiB0aGUgZGVmZXJyZWQgb2JqZWN0XHJcbiAgICAgIHJldHVybiByZXF1ZXN0TG9naW5Qcml2YXRlKCBwYXJzZWRJZGVudGl0eS5lbWFpbCwgcGFyc2VkSWRlbnRpdHkucGFzc3dvcmQsIHRydWUsIHRydWUgKTtcclxuXHJcbiAgICB9XHJcblxyXG4gICAgLy8gTm8gbG9naW4gcmVxdWVzdCB3YXMgc2VudCwgc28gcmV0dXJuIG51bGwuXHJcbiAgICByZXR1cm4gbnVsbDtcclxuXHJcbiAgfTtcclxuXHJcbiAgLy8gW1BVQkxJQ10gcmVxdWVzdFJlY292ZXJQYXNzd29yZCgpXHJcbiAgLy8gVGhlIHB1YmxpYyByZXF1ZXN0UmVjb3ZlclBhc3N3b3JkKCkgZnVuY3Rpb24gdXNlZCB0byBoaWRlIHJlcXVlc3RSZWNvdmVyUGFzc3dvcmRQcml2YXRlKCkuXHJcbiAgc2VsZi5yZXF1ZXN0UmVjb3ZlclBhc3N3b3JkID0gZnVuY3Rpb24gKCBlbWFpbCwgcGFzc3dvcmQsIGhhc2ggKSB7XHJcblxyXG4gICAgcmV0dXJuIHJlcXVlc3RSZWNvdmVyUGFzc3dvcmRQcml2YXRlKCBlbWFpbCwgcGFzc3dvcmQsIGhhc2ggKTtcclxuXHJcbiAgfTtcclxuXHJcbiAgLy8gW1BVQkxJQ10gcmVxdWVzdFJlZ2lzdGVyKClcclxuICAvLyBUaGUgcHVibGljIHJlcXVlc3RSZWdpc3RlcigpIGZ1bmN0aW9uIHVzZWQgdG8gaGlkZSByZXF1ZXN0UmVnaXN0ZXJQcml2YXRlKCkuXHJcbiAgc2VsZi5yZXF1ZXN0UmVnaXN0ZXIgPSBmdW5jdGlvbiAoIGVtYWlsLCBwYXNzd29yZCwgZmlyc3ROYW1lLCBsYXN0TmFtZSwgYXBwRGF0YSApIHtcclxuXHJcbiAgICByZXR1cm4gcmVxdWVzdFJlZ2lzdGVyUHJpdmF0ZSggZW1haWwsIHBhc3N3b3JkLCBmaXJzdE5hbWUsIGxhc3ROYW1lLCBhcHBEYXRhICk7XHJcblxyXG4gIH07XHJcblxyXG4gIC8vIFtQVUJMSUNdIHJlcXVlc3RWZXJpZnlFbWFpbCgpXHJcbiAgLy8gVGhlIHB1YmxpYyByZXF1ZXN0VmVyaWZ5RW1haWwoKSBmdW5jdGlvbiB1c2VkIHRvIGhpZGUgcmVxdWVzdFZlcmlmeUVtYWlsUHJpdmF0ZSgpLlxyXG4gIHNlbGYucmVxdWVzdFZlcmlmeUVtYWlsID0gZnVuY3Rpb24gKCBlbWFpbCwgaGFzaCApIHtcclxuXHJcbiAgICByZXR1cm4gcmVxdWVzdFZlcmlmeUVtYWlsUHJpdmF0ZSggZW1haWwsIGhhc2ggKTtcclxuXHJcbiAgfTtcclxuXHJcbiAgcmV0dXJuIHNlbGY7XHJcblxyXG59OyIsIi8vIEluY2x1ZGUgZGVwZW5kZW5jaWVzXG52YXIgZW5jX2hleCA9IHJlcXVpcmUoICcuL2luY2x1ZGUvY3J5cHRvLWpzL2VuYy1oZXgnICk7XG52YXIgaG1hY19zaGEyNTYgPSByZXF1aXJlKCAnLi9pbmNsdWRlL2NyeXB0by1qcy9obWFjLXNoYTI1NicgKTtcbnZhciBqc29uMyA9IHJlcXVpcmUoICcuL2luY2x1ZGUvanNvbjMnICk7XG5cbi8vIFtJZGVudGl0eSBDb25zdHJ1Y3Rvcl1cbi8vIFRoZSBJZGVudGl0eSBvYmplY3QgcmVwcmVzZW50cyBhbiBlbWFpbC9wYXNzd29yZCBwYWlyIHVzZWQgYXMgaWRlbnRpZmljYXRpb24gd2l0aCB0aGVcbi8vIGRhdGFiYXNlIHRvIHByb3ZpZGUgYXV0aGVuaWNhdGlvbiBmb3IgcmVxdWVzdHMuIFRoZSBJZGVudGl0eSBpcyB1c2VkIGFzIGEgcmVxdWVzdCBmYWN0b3J5XG4vLyB0byBjcmVhdGUgcmVxdWVzdHMgdGhhdCB3aWxsIGF1dGhlbnRpY2F0ZSB0aGUgd2l0aCB0aGUgc2VydmVyIHNlY3VyZWx5LlxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoIGVtYWlsLCBwYXNzd29yZCwgZG9udEhhc2hQYXNzd29yZCApIHtcblxuICAndXNlIHN0cmljdCc7XG5cbiAgLy8gVGhlIG9iamVjdCB0byBiZSByZXR1cm5lZCBmcm9tIHRoZSBmYWN0b3J5XG4gIHZhciBzZWxmID0ge307XG5cbiAgLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vXG4gIC8vIFBSSVZBVEUgLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vL1xuICAvLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy9cblxuICAvLy8vLy8vLy8vLy8vLy8vXG4gIC8vIFBST1BFUlRJRVMgLy9cbiAgLy8vLy8vLy8vLy8vLy8vL1xuXG4gIC8vIFtQUklWQVRFXSBoYXNoZWRQYXNzd29yZFxuICAvLyBUaGUgU0hBLTI1NiBlbmNvZGVkIHN0cmluZyBnZW5lcmF0ZWQgYnkgaGFzaGluZyB0aGUgZ2l2ZW4gcGFzc3dvcmQuIFxuICAvLyBbU0VDVVJJVFkgTk9URSAxXSBCeSBoYXNoaW5nIHRoZSBwYXNzd29yZCB3ZSBzdG9yZSBpbiBtZW1vcnkgYW5kIGtlZXBpbmcgaXQgbG9jYWwgdG8gXG4gIC8vIHRoaXMgZnVuY3Rpb24sIHdlIHByb3RlY3QgdGhlIHVzZXIncyBwYXNzd29yZCBmcm9tIHNjcnV0aW55IGZyb20gb3RoZXIgbG9jYWwgYXBwbGljYXRpb25zLlxuICAvLyBUaGUgcGFzc3dvcmQgc3VwcGxpZWQgYXMgYSBjb25zdHJ1Y3RvciBhcmd1bWVudCB3aWxsIGFsc28gYmUgbnVsbGVkIHNvIHRoYXQgaXQgaXMgbm90IGtlcHQgXG4gIC8vIGluIGFwcGxpY2F0aW9uIG1lbW9yeSBlaXRoZXIsIHNvIHRoYXQgdGhlIG9yaWdpbmFsIHBhc3N3b3JkIGluZm9ybWF0aW9uIGlzIGxvc3QuXG4gIC8vIFtTRUNVUklUWSBOT1RFIDRdIElmIGRvbnRIYXNoUGFzc3dvcmQgaXMgc2V0IHRvIHRydWUsIHRoaXMgaGFzaGluZyBwcm9jZXNzIGlzIHNraXBwZWQuIFRoaXMgXG4gIC8vIGZlYXR1cmUgZXhpc3RzIHRvIGFsbG93IHBhc3N3b3JkcyBzdG9yZWQgaW4gbG9jYWwgc3RvcmFnZSB0byBiZSB1c2VkIGZvciBhdXRoZW50aWNhdGlvbiwgc2luY2UgXG4gIC8vIHRoZXkgaGF2ZSBhbHJlYWR5IGJlZW4gaGFzZWQgaW4gdGhpcyB3YXkuIERPIE5PVCBVU0UgVEhJUyBGT1IgQU5ZVEhJTkcgRUxTRSFcbiAgdmFyIGhhc2hlZFBhc3N3b3JkID0gKCBkb250SGFzaFBhc3N3b3JkID09PSB0cnVlICkgPyBwYXNzd29yZCA6IFxuICAgIGhtYWNfc2hhMjU2KCBwYXNzd29yZCApLnRvU3RyaW5nKCBlbmNfaGV4ICk7XG5cbiAgLy8gW1NFQ1VSSVRZIE5PVEUgMl0gVGhlIHVzZXIncyBnaXZlbiBwYXNzd29yZCBzaG91bGQgYmUgZm9yZ290dGVuIG9uY2UgaXQgaGFzIGJlZW4gaGFzaGVkLlxuICAvLyBBbHRob3VnaCB0aGUgcGFzc3dvcmQgaXMgbG9jYWwgdG8gdGhpcyBjb25zdHJ1Y3RvciwgaXQgaXMgYmV0dGVyIHRoYXQgaXQgbm90IGV2ZW4gYmUgXG4gIC8vIGF2YWlsYWJsZSBpbiBtZW1vcnkgb25jZSBpdCBoYXMgYmVlbiBoYXNoZWQsIHNpbmNlIHRoZSBoYXNoZWQgcGFzc3dvcmQgaXMgbXVjaCBtb3JlIFxuICAvLyBkaWZmaWN1bHQgdG8gcmVjb3ZlciBpbiBpdHMgb3JpZ2luYWwgZm9ybS5cbiAgcGFzc3dvcmQgPSBudWxsO1xuXG5cbiAgLy8vLy8vLy8vLy8vLy8vXG4gIC8vIEZVTkNUSU9OUyAvL1xuICAvLy8vLy8vLy8vLy8vLy9cblxuICAvLyBbUFJJVkFURV0gaG1hY1NpZ25SZXF1ZXN0Qm9keSgpXG4gIC8vIFJldHVybnMgdGhlIGdpdmVuIHJlcXVlc3Qgb2JqZWN0IGFmdGVyIGFkZGluZyB0aGUgXCJobWFjXCIgcHJvcGVydHkgdG8gaXQgYW5kIHNldHRpbmcgXCJobWFjXCIgXG4gIC8vIGJ5IHVzaW5nIHRoZSB1c2VyJ3MgcGFzc3dvcmQgYXMgYSBTSEEtMjU2IEhNQUMgaGFzaGluZyBzZWNyZXQuXG4gIC8vIFtTRUNVUklUWSBOT1RFIDNdIFRoZSBITUFDIHN0cmluZyBpcyBhIGhleCB2YWx1ZSwgNjQgY2hhcmFjdGVycyBpbiBsZW5ndGguIEl0IGlzIGNyZWF0ZWQgXG4gIC8vIGJ5IGNvbmNhdGVuYXRpbmcgdGhlIEpTT04uc3RyaW5naWZ5KCllZCByZXF1ZXN0IGNvbnRlbnQsIHRoZSByZXF1ZXN0IGVtYWlsLCBhbmQgdGhlIHJlcXVlc3QgXG4gIC8vIHRpbWUgdG9nZXRoZXIsIGFuZCBoYXNoaW5nIHRoZSByZXN1bHQgdXNpbmcgaGFzaGVkUGFzc3dvcmQgYXMgYSBzYWx0LiBcbiAgLy9cbiAgLy8gUHNldWRvY29kZTpcbiAgLy8gdG9IYXNoID0gUmVxdWVzdCBDb250ZW50IEpTT04gKyBSZXF1ZXN0IEVtYWlsICsgUmVxdWVzdCBUaW1lIEpTT05cbiAgLy8gc2FsdCA9IGhhc2hlZFBhc3N3b3JkXG4gIC8vIGhtYWNTdHJpbmcgPSBzaGEyNTYoIHRvSGFzaCwgc2FsdCApXG4gIC8vIHJlcXVlc3QuaG1hYyA9IGhtYWNTdHJpbmdcbiAgLy8gXG4gIC8vIEJ5IHBlcmZvcm1pbmcgdGhlIHNhbWUgb3BlcmF0aW9uIG9uIHRoZSBkYXRhLCB0aGUgc2VydmVyIGNhbiBjb25maXJtIHRoYXQgdGhlIEhNQUMgc3RyaW5ncyBcbiAgLy8gYXJlIGlkZW50aWNhbCBhbmQgYXV0aG9yaXplIHRoZSByZXF1ZXN0LlxuICB2YXIgaG1hY1NpZ25SZXF1ZXN0Qm9keSA9IGZ1bmN0aW9uICggcmVxQm9keSApIHtcblxuICAgIC8vIENyZWF0ZSB0aGUgY29uY2F0ZW5hdGVkIHN0cmluZyB0byBiZSBoYXNoZWQgYXMgdGhlIEhNQUNcbiAgICB2YXIgY29udGVudCA9IEpTT04uc3RyaW5naWZ5KCByZXFCb2R5LmNvbnRlbnQgKTtcbiAgICB2YXIgZW1haWwgPSByZXFCb2R5LmVtYWlsO1xuICAgIHZhciB0aW1lID0gcmVxQm9keS50aW1lLnRvSVNPU3RyaW5nKCk7XG4gICAgdmFyIGNvbmNhdCA9IGNvbnRlbnQgKyBlbWFpbCArIHRpbWU7XG5cbiAgICAvLyBBZGQgdGhlICdobWFjJyBwcm9wZXJ0eSB0byB0aGUgcmVxdWVzdCB3aXRoIGEgdmFsdWUgY29tcHV0ZWQgYnkgc2FsdGluZyB0aGUgY29uY2F0IHdpdGggdGhlXG4gICAgLy8gdXNlcidzIGhhc2hlZFBhc3N3b3JkLlxuICAgIC8vIFtDQVJFRlVMXSBoYXNoZWRQYXNzd29yZCBzaG91bGQgYmUgYSBzdHJpbmcuIElmIGl0IGlzbid0LCB0ZXJyaWJsZSB0aGluZ3MgV0lMTCBoYXBwZW4hXG4gICAgcmVxQm9keS5obWFjID0gaG1hY19zaGEyNTYoIGNvbmNhdCwgaGFzaGVkUGFzc3dvcmQgKS50b1N0cmluZyggZW5jX2hleCApO1xuXG4gICAgaWYgKCBCcmlkZ2UuZGVidWcgPT09IHRydWUgKSB7XG4gICAgICBjb25zb2xlLmxvZyggJz09PSBITUFDIFNpZ25pbmcgUHJvY2VzcyA9PT0nICk7XG4gICAgICBjb25zb2xlLmxvZyggJ0hhc2hwYXNzOiBcIicgKyBoYXNoZWRQYXNzd29yZCArICdcIicgKTtcbiAgICAgIGNvbnNvbGUubG9nKCAnQ29udGVudDogXCInICsgY29udGVudCArICdcIicgKTtcbiAgICAgIGNvbnNvbGUubG9nKCAnRW1haWw6IFwiJyArIGVtYWlsICsgJ1wiJyApO1xuICAgICAgY29uc29sZS5sb2coICdUaW1lOiBcIicgKyB0aW1lICsgJ1wiJyApO1xuICAgICAgY29uc29sZS5sb2coICdDb25jYXQ6IFwiJyArIGNvbmNhdCArICdcIicgKTtcbiAgICAgIGNvbnNvbGUubG9nKCAnSE1BQzogXCInICsgcmVxQm9keS5obWFjICsgJ1wiJyApO1xuICAgICAgY29uc29sZS5sb2coICc9PT09PT09PT09PT09PT09PT09PT09PT09PT09JyApO1xuICAgIH1cblxuICAgIHJldHVybiByZXFCb2R5O1xuXG4gIH07XG5cblxuICAvLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy9cbiAgLy8gUFVCTElDIC8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vXG4gIC8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vL1xuXG4gIC8vLy8vLy8vLy8vLy8vLy9cbiAgLy8gUFJPUEVSVElFUyAvL1xuICAvLy8vLy8vLy8vLy8vLy8vXG5cbiAgLy8gW1BVQkxJQ10gZW1haWxcbiAgLy8gVGhlIGVtYWlsIHVzZWQgdG8gaWRlbnRpZnkgdGhlIHVzZXIgd2l0aGluIHRoZSBkYXRhYmFzZS5cbiAgc2VsZi5lbWFpbCA9IGVtYWlsO1xuXG5cbiAgLy8vLy8vLy8vLy8vLy8vXG4gIC8vIEZVTkNUSU9OUyAvL1xuICAvLy8vLy8vLy8vLy8vLy9cblxuICAvLyBbUFVCTElDXSBjcmVhdGVSZXF1ZXN0KClcbiAgLy8gUmV0dXJucyBhIG5ldyByZXF1ZXN0LCBnaXZlbiB0aGUgY29udGVudCBwYXlsb2FkIG9mIHRoZSByZXF1ZXN0IGFzIGFuIG9iamVjdC4gVXRpbGl6ZXNcbiAgLy8gaG1hY1NpZ25SZXF1ZXN0KCkgdG8gd3JhcCB0aGUgZ2l2ZW4gcGF5bG9hZCBpbiBhbiBhcHByb3ByaWF0ZSBoZWFkZXIgdG8gdmFsaWRhdGUgYWdhaW5zdCB0aGVcbiAgLy8gc2VydmVyLXNpZGUgYXV0aG9yaXphdGlvbiBzY2hlbWUgKGFzc3VtaW5nIHRoZSB1c2VyIGNyZWRlbnRpYWxzIGFyZSBjb3JyZWN0KS5cbiAgc2VsZi5jcmVhdGVSZXF1ZXN0ID0gZnVuY3Rpb24gKCBwYXlsb2FkICkge1xuXG4gICAgcmV0dXJuIGhtYWNTaWduUmVxdWVzdEJvZHkoIHtcbiAgICAgICdjb250ZW50JzogcGF5bG9hZCxcbiAgICAgICdlbWFpbCc6IGVtYWlsLFxuICAgICAgJ3RpbWUnOiBuZXcgRGF0ZSgpXG4gICAgfSApO1xuXG4gIH07XG5cbiAgcmV0dXJuIHNlbGY7XG5cbn07IiwiOyhmdW5jdGlvbiAocm9vdCwgZmFjdG9yeSkge1xuXHRpZiAodHlwZW9mIGV4cG9ydHMgPT09IFwib2JqZWN0XCIpIHtcblx0XHQvLyBDb21tb25KU1xuXHRcdG1vZHVsZS5leHBvcnRzID0gZXhwb3J0cyA9IGZhY3RvcnkoKTtcblx0fVxuXHRlbHNlIGlmICh0eXBlb2YgZGVmaW5lID09PSBcImZ1bmN0aW9uXCIgJiYgZGVmaW5lLmFtZCkge1xuXHRcdC8vIEFNRFxuXHRcdGRlZmluZShbXSwgZmFjdG9yeSk7XG5cdH1cblx0ZWxzZSB7XG5cdFx0Ly8gR2xvYmFsIChicm93c2VyKVxuXHRcdHJvb3QuQ3J5cHRvSlMgPSBmYWN0b3J5KCk7XG5cdH1cbn0odGhpcywgZnVuY3Rpb24gKCkge1xuXG5cdC8qKlxuXHQgKiBDcnlwdG9KUyBjb3JlIGNvbXBvbmVudHMuXG5cdCAqL1xuXHR2YXIgQ3J5cHRvSlMgPSBDcnlwdG9KUyB8fCAoZnVuY3Rpb24gKE1hdGgsIHVuZGVmaW5lZCkge1xuXHQgICAgLyoqXG5cdCAgICAgKiBDcnlwdG9KUyBuYW1lc3BhY2UuXG5cdCAgICAgKi9cblx0ICAgIHZhciBDID0ge307XG5cblx0ICAgIC8qKlxuXHQgICAgICogTGlicmFyeSBuYW1lc3BhY2UuXG5cdCAgICAgKi9cblx0ICAgIHZhciBDX2xpYiA9IEMubGliID0ge307XG5cblx0ICAgIC8qKlxuXHQgICAgICogQmFzZSBvYmplY3QgZm9yIHByb3RvdHlwYWwgaW5oZXJpdGFuY2UuXG5cdCAgICAgKi9cblx0ICAgIHZhciBCYXNlID0gQ19saWIuQmFzZSA9IChmdW5jdGlvbiAoKSB7XG5cdCAgICAgICAgZnVuY3Rpb24gRigpIHt9XG5cblx0ICAgICAgICByZXR1cm4ge1xuXHQgICAgICAgICAgICAvKipcblx0ICAgICAgICAgICAgICogQ3JlYXRlcyBhIG5ldyBvYmplY3QgdGhhdCBpbmhlcml0cyBmcm9tIHRoaXMgb2JqZWN0LlxuXHQgICAgICAgICAgICAgKlxuXHQgICAgICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gb3ZlcnJpZGVzIFByb3BlcnRpZXMgdG8gY29weSBpbnRvIHRoZSBuZXcgb2JqZWN0LlxuXHQgICAgICAgICAgICAgKlxuXHQgICAgICAgICAgICAgKiBAcmV0dXJuIHtPYmplY3R9IFRoZSBuZXcgb2JqZWN0LlxuXHQgICAgICAgICAgICAgKlxuXHQgICAgICAgICAgICAgKiBAc3RhdGljXG5cdCAgICAgICAgICAgICAqXG5cdCAgICAgICAgICAgICAqIEBleGFtcGxlXG5cdCAgICAgICAgICAgICAqXG5cdCAgICAgICAgICAgICAqICAgICB2YXIgTXlUeXBlID0gQ3J5cHRvSlMubGliLkJhc2UuZXh0ZW5kKHtcblx0ICAgICAgICAgICAgICogICAgICAgICBmaWVsZDogJ3ZhbHVlJyxcblx0ICAgICAgICAgICAgICpcblx0ICAgICAgICAgICAgICogICAgICAgICBtZXRob2Q6IGZ1bmN0aW9uICgpIHtcblx0ICAgICAgICAgICAgICogICAgICAgICB9XG5cdCAgICAgICAgICAgICAqICAgICB9KTtcblx0ICAgICAgICAgICAgICovXG5cdCAgICAgICAgICAgIGV4dGVuZDogZnVuY3Rpb24gKG92ZXJyaWRlcykge1xuXHQgICAgICAgICAgICAgICAgLy8gU3Bhd25cblx0ICAgICAgICAgICAgICAgIEYucHJvdG90eXBlID0gdGhpcztcblx0ICAgICAgICAgICAgICAgIHZhciBzdWJ0eXBlID0gbmV3IEYoKTtcblxuXHQgICAgICAgICAgICAgICAgLy8gQXVnbWVudFxuXHQgICAgICAgICAgICAgICAgaWYgKG92ZXJyaWRlcykge1xuXHQgICAgICAgICAgICAgICAgICAgIHN1YnR5cGUubWl4SW4ob3ZlcnJpZGVzKTtcblx0ICAgICAgICAgICAgICAgIH1cblxuXHQgICAgICAgICAgICAgICAgLy8gQ3JlYXRlIGRlZmF1bHQgaW5pdGlhbGl6ZXJcblx0ICAgICAgICAgICAgICAgIGlmICghc3VidHlwZS5oYXNPd25Qcm9wZXJ0eSgnaW5pdCcpKSB7XG5cdCAgICAgICAgICAgICAgICAgICAgc3VidHlwZS5pbml0ID0gZnVuY3Rpb24gKCkge1xuXHQgICAgICAgICAgICAgICAgICAgICAgICBzdWJ0eXBlLiRzdXBlci5pbml0LmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG5cdCAgICAgICAgICAgICAgICAgICAgfTtcblx0ICAgICAgICAgICAgICAgIH1cblxuXHQgICAgICAgICAgICAgICAgLy8gSW5pdGlhbGl6ZXIncyBwcm90b3R5cGUgaXMgdGhlIHN1YnR5cGUgb2JqZWN0XG5cdCAgICAgICAgICAgICAgICBzdWJ0eXBlLmluaXQucHJvdG90eXBlID0gc3VidHlwZTtcblxuXHQgICAgICAgICAgICAgICAgLy8gUmVmZXJlbmNlIHN1cGVydHlwZVxuXHQgICAgICAgICAgICAgICAgc3VidHlwZS4kc3VwZXIgPSB0aGlzO1xuXG5cdCAgICAgICAgICAgICAgICByZXR1cm4gc3VidHlwZTtcblx0ICAgICAgICAgICAgfSxcblxuXHQgICAgICAgICAgICAvKipcblx0ICAgICAgICAgICAgICogRXh0ZW5kcyB0aGlzIG9iamVjdCBhbmQgcnVucyB0aGUgaW5pdCBtZXRob2QuXG5cdCAgICAgICAgICAgICAqIEFyZ3VtZW50cyB0byBjcmVhdGUoKSB3aWxsIGJlIHBhc3NlZCB0byBpbml0KCkuXG5cdCAgICAgICAgICAgICAqXG5cdCAgICAgICAgICAgICAqIEByZXR1cm4ge09iamVjdH0gVGhlIG5ldyBvYmplY3QuXG5cdCAgICAgICAgICAgICAqXG5cdCAgICAgICAgICAgICAqIEBzdGF0aWNcblx0ICAgICAgICAgICAgICpcblx0ICAgICAgICAgICAgICogQGV4YW1wbGVcblx0ICAgICAgICAgICAgICpcblx0ICAgICAgICAgICAgICogICAgIHZhciBpbnN0YW5jZSA9IE15VHlwZS5jcmVhdGUoKTtcblx0ICAgICAgICAgICAgICovXG5cdCAgICAgICAgICAgIGNyZWF0ZTogZnVuY3Rpb24gKCkge1xuXHQgICAgICAgICAgICAgICAgdmFyIGluc3RhbmNlID0gdGhpcy5leHRlbmQoKTtcblx0ICAgICAgICAgICAgICAgIGluc3RhbmNlLmluaXQuYXBwbHkoaW5zdGFuY2UsIGFyZ3VtZW50cyk7XG5cblx0ICAgICAgICAgICAgICAgIHJldHVybiBpbnN0YW5jZTtcblx0ICAgICAgICAgICAgfSxcblxuXHQgICAgICAgICAgICAvKipcblx0ICAgICAgICAgICAgICogSW5pdGlhbGl6ZXMgYSBuZXdseSBjcmVhdGVkIG9iamVjdC5cblx0ICAgICAgICAgICAgICogT3ZlcnJpZGUgdGhpcyBtZXRob2QgdG8gYWRkIHNvbWUgbG9naWMgd2hlbiB5b3VyIG9iamVjdHMgYXJlIGNyZWF0ZWQuXG5cdCAgICAgICAgICAgICAqXG5cdCAgICAgICAgICAgICAqIEBleGFtcGxlXG5cdCAgICAgICAgICAgICAqXG5cdCAgICAgICAgICAgICAqICAgICB2YXIgTXlUeXBlID0gQ3J5cHRvSlMubGliLkJhc2UuZXh0ZW5kKHtcblx0ICAgICAgICAgICAgICogICAgICAgICBpbml0OiBmdW5jdGlvbiAoKSB7XG5cdCAgICAgICAgICAgICAqICAgICAgICAgICAgIC8vIC4uLlxuXHQgICAgICAgICAgICAgKiAgICAgICAgIH1cblx0ICAgICAgICAgICAgICogICAgIH0pO1xuXHQgICAgICAgICAgICAgKi9cblx0ICAgICAgICAgICAgaW5pdDogZnVuY3Rpb24gKCkge1xuXHQgICAgICAgICAgICB9LFxuXG5cdCAgICAgICAgICAgIC8qKlxuXHQgICAgICAgICAgICAgKiBDb3BpZXMgcHJvcGVydGllcyBpbnRvIHRoaXMgb2JqZWN0LlxuXHQgICAgICAgICAgICAgKlxuXHQgICAgICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gcHJvcGVydGllcyBUaGUgcHJvcGVydGllcyB0byBtaXggaW4uXG5cdCAgICAgICAgICAgICAqXG5cdCAgICAgICAgICAgICAqIEBleGFtcGxlXG5cdCAgICAgICAgICAgICAqXG5cdCAgICAgICAgICAgICAqICAgICBNeVR5cGUubWl4SW4oe1xuXHQgICAgICAgICAgICAgKiAgICAgICAgIGZpZWxkOiAndmFsdWUnXG5cdCAgICAgICAgICAgICAqICAgICB9KTtcblx0ICAgICAgICAgICAgICovXG5cdCAgICAgICAgICAgIG1peEluOiBmdW5jdGlvbiAocHJvcGVydGllcykge1xuXHQgICAgICAgICAgICAgICAgZm9yICh2YXIgcHJvcGVydHlOYW1lIGluIHByb3BlcnRpZXMpIHtcblx0ICAgICAgICAgICAgICAgICAgICBpZiAocHJvcGVydGllcy5oYXNPd25Qcm9wZXJ0eShwcm9wZXJ0eU5hbWUpKSB7XG5cdCAgICAgICAgICAgICAgICAgICAgICAgIHRoaXNbcHJvcGVydHlOYW1lXSA9IHByb3BlcnRpZXNbcHJvcGVydHlOYW1lXTtcblx0ICAgICAgICAgICAgICAgICAgICB9XG5cdCAgICAgICAgICAgICAgICB9XG5cblx0ICAgICAgICAgICAgICAgIC8vIElFIHdvbid0IGNvcHkgdG9TdHJpbmcgdXNpbmcgdGhlIGxvb3AgYWJvdmVcblx0ICAgICAgICAgICAgICAgIGlmIChwcm9wZXJ0aWVzLmhhc093blByb3BlcnR5KCd0b1N0cmluZycpKSB7XG5cdCAgICAgICAgICAgICAgICAgICAgdGhpcy50b1N0cmluZyA9IHByb3BlcnRpZXMudG9TdHJpbmc7XG5cdCAgICAgICAgICAgICAgICB9XG5cdCAgICAgICAgICAgIH0sXG5cblx0ICAgICAgICAgICAgLyoqXG5cdCAgICAgICAgICAgICAqIENyZWF0ZXMgYSBjb3B5IG9mIHRoaXMgb2JqZWN0LlxuXHQgICAgICAgICAgICAgKlxuXHQgICAgICAgICAgICAgKiBAcmV0dXJuIHtPYmplY3R9IFRoZSBjbG9uZS5cblx0ICAgICAgICAgICAgICpcblx0ICAgICAgICAgICAgICogQGV4YW1wbGVcblx0ICAgICAgICAgICAgICpcblx0ICAgICAgICAgICAgICogICAgIHZhciBjbG9uZSA9IGluc3RhbmNlLmNsb25lKCk7XG5cdCAgICAgICAgICAgICAqL1xuXHQgICAgICAgICAgICBjbG9uZTogZnVuY3Rpb24gKCkge1xuXHQgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuaW5pdC5wcm90b3R5cGUuZXh0ZW5kKHRoaXMpO1xuXHQgICAgICAgICAgICB9XG5cdCAgICAgICAgfTtcblx0ICAgIH0oKSk7XG5cblx0ICAgIC8qKlxuXHQgICAgICogQW4gYXJyYXkgb2YgMzItYml0IHdvcmRzLlxuXHQgICAgICpcblx0ICAgICAqIEBwcm9wZXJ0eSB7QXJyYXl9IHdvcmRzIFRoZSBhcnJheSBvZiAzMi1iaXQgd29yZHMuXG5cdCAgICAgKiBAcHJvcGVydHkge251bWJlcn0gc2lnQnl0ZXMgVGhlIG51bWJlciBvZiBzaWduaWZpY2FudCBieXRlcyBpbiB0aGlzIHdvcmQgYXJyYXkuXG5cdCAgICAgKi9cblx0ICAgIHZhciBXb3JkQXJyYXkgPSBDX2xpYi5Xb3JkQXJyYXkgPSBCYXNlLmV4dGVuZCh7XG5cdCAgICAgICAgLyoqXG5cdCAgICAgICAgICogSW5pdGlhbGl6ZXMgYSBuZXdseSBjcmVhdGVkIHdvcmQgYXJyYXkuXG5cdCAgICAgICAgICpcblx0ICAgICAgICAgKiBAcGFyYW0ge0FycmF5fSB3b3JkcyAoT3B0aW9uYWwpIEFuIGFycmF5IG9mIDMyLWJpdCB3b3Jkcy5cblx0ICAgICAgICAgKiBAcGFyYW0ge251bWJlcn0gc2lnQnl0ZXMgKE9wdGlvbmFsKSBUaGUgbnVtYmVyIG9mIHNpZ25pZmljYW50IGJ5dGVzIGluIHRoZSB3b3Jkcy5cblx0ICAgICAgICAgKlxuXHQgICAgICAgICAqIEBleGFtcGxlXG5cdCAgICAgICAgICpcblx0ICAgICAgICAgKiAgICAgdmFyIHdvcmRBcnJheSA9IENyeXB0b0pTLmxpYi5Xb3JkQXJyYXkuY3JlYXRlKCk7XG5cdCAgICAgICAgICogICAgIHZhciB3b3JkQXJyYXkgPSBDcnlwdG9KUy5saWIuV29yZEFycmF5LmNyZWF0ZShbMHgwMDAxMDIwMywgMHgwNDA1MDYwN10pO1xuXHQgICAgICAgICAqICAgICB2YXIgd29yZEFycmF5ID0gQ3J5cHRvSlMubGliLldvcmRBcnJheS5jcmVhdGUoWzB4MDAwMTAyMDMsIDB4MDQwNTA2MDddLCA2KTtcblx0ICAgICAgICAgKi9cblx0ICAgICAgICBpbml0OiBmdW5jdGlvbiAod29yZHMsIHNpZ0J5dGVzKSB7XG5cdCAgICAgICAgICAgIHdvcmRzID0gdGhpcy53b3JkcyA9IHdvcmRzIHx8IFtdO1xuXG5cdCAgICAgICAgICAgIGlmIChzaWdCeXRlcyAhPSB1bmRlZmluZWQpIHtcblx0ICAgICAgICAgICAgICAgIHRoaXMuc2lnQnl0ZXMgPSBzaWdCeXRlcztcblx0ICAgICAgICAgICAgfSBlbHNlIHtcblx0ICAgICAgICAgICAgICAgIHRoaXMuc2lnQnl0ZXMgPSB3b3Jkcy5sZW5ndGggKiA0O1xuXHQgICAgICAgICAgICB9XG5cdCAgICAgICAgfSxcblxuXHQgICAgICAgIC8qKlxuXHQgICAgICAgICAqIENvbnZlcnRzIHRoaXMgd29yZCBhcnJheSB0byBhIHN0cmluZy5cblx0ICAgICAgICAgKlxuXHQgICAgICAgICAqIEBwYXJhbSB7RW5jb2Rlcn0gZW5jb2RlciAoT3B0aW9uYWwpIFRoZSBlbmNvZGluZyBzdHJhdGVneSB0byB1c2UuIERlZmF1bHQ6IENyeXB0b0pTLmVuYy5IZXhcblx0ICAgICAgICAgKlxuXHQgICAgICAgICAqIEByZXR1cm4ge3N0cmluZ30gVGhlIHN0cmluZ2lmaWVkIHdvcmQgYXJyYXkuXG5cdCAgICAgICAgICpcblx0ICAgICAgICAgKiBAZXhhbXBsZVxuXHQgICAgICAgICAqXG5cdCAgICAgICAgICogICAgIHZhciBzdHJpbmcgPSB3b3JkQXJyYXkgKyAnJztcblx0ICAgICAgICAgKiAgICAgdmFyIHN0cmluZyA9IHdvcmRBcnJheS50b1N0cmluZygpO1xuXHQgICAgICAgICAqICAgICB2YXIgc3RyaW5nID0gd29yZEFycmF5LnRvU3RyaW5nKENyeXB0b0pTLmVuYy5VdGY4KTtcblx0ICAgICAgICAgKi9cblx0ICAgICAgICB0b1N0cmluZzogZnVuY3Rpb24gKGVuY29kZXIpIHtcblx0ICAgICAgICAgICAgcmV0dXJuIChlbmNvZGVyIHx8IEhleCkuc3RyaW5naWZ5KHRoaXMpO1xuXHQgICAgICAgIH0sXG5cblx0ICAgICAgICAvKipcblx0ICAgICAgICAgKiBDb25jYXRlbmF0ZXMgYSB3b3JkIGFycmF5IHRvIHRoaXMgd29yZCBhcnJheS5cblx0ICAgICAgICAgKlxuXHQgICAgICAgICAqIEBwYXJhbSB7V29yZEFycmF5fSB3b3JkQXJyYXkgVGhlIHdvcmQgYXJyYXkgdG8gYXBwZW5kLlxuXHQgICAgICAgICAqXG5cdCAgICAgICAgICogQHJldHVybiB7V29yZEFycmF5fSBUaGlzIHdvcmQgYXJyYXkuXG5cdCAgICAgICAgICpcblx0ICAgICAgICAgKiBAZXhhbXBsZVxuXHQgICAgICAgICAqXG5cdCAgICAgICAgICogICAgIHdvcmRBcnJheTEuY29uY2F0KHdvcmRBcnJheTIpO1xuXHQgICAgICAgICAqL1xuXHQgICAgICAgIGNvbmNhdDogZnVuY3Rpb24gKHdvcmRBcnJheSkge1xuXHQgICAgICAgICAgICAvLyBTaG9ydGN1dHNcblx0ICAgICAgICAgICAgdmFyIHRoaXNXb3JkcyA9IHRoaXMud29yZHM7XG5cdCAgICAgICAgICAgIHZhciB0aGF0V29yZHMgPSB3b3JkQXJyYXkud29yZHM7XG5cdCAgICAgICAgICAgIHZhciB0aGlzU2lnQnl0ZXMgPSB0aGlzLnNpZ0J5dGVzO1xuXHQgICAgICAgICAgICB2YXIgdGhhdFNpZ0J5dGVzID0gd29yZEFycmF5LnNpZ0J5dGVzO1xuXG5cdCAgICAgICAgICAgIC8vIENsYW1wIGV4Y2VzcyBiaXRzXG5cdCAgICAgICAgICAgIHRoaXMuY2xhbXAoKTtcblxuXHQgICAgICAgICAgICAvLyBDb25jYXRcblx0ICAgICAgICAgICAgaWYgKHRoaXNTaWdCeXRlcyAlIDQpIHtcblx0ICAgICAgICAgICAgICAgIC8vIENvcHkgb25lIGJ5dGUgYXQgYSB0aW1lXG5cdCAgICAgICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRoYXRTaWdCeXRlczsgaSsrKSB7XG5cdCAgICAgICAgICAgICAgICAgICAgdmFyIHRoYXRCeXRlID0gKHRoYXRXb3Jkc1tpID4+PiAyXSA+Pj4gKDI0IC0gKGkgJSA0KSAqIDgpKSAmIDB4ZmY7XG5cdCAgICAgICAgICAgICAgICAgICAgdGhpc1dvcmRzWyh0aGlzU2lnQnl0ZXMgKyBpKSA+Pj4gMl0gfD0gdGhhdEJ5dGUgPDwgKDI0IC0gKCh0aGlzU2lnQnl0ZXMgKyBpKSAlIDQpICogOCk7XG5cdCAgICAgICAgICAgICAgICB9XG5cdCAgICAgICAgICAgIH0gZWxzZSBpZiAodGhhdFdvcmRzLmxlbmd0aCA+IDB4ZmZmZikge1xuXHQgICAgICAgICAgICAgICAgLy8gQ29weSBvbmUgd29yZCBhdCBhIHRpbWVcblx0ICAgICAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgdGhhdFNpZ0J5dGVzOyBpICs9IDQpIHtcblx0ICAgICAgICAgICAgICAgICAgICB0aGlzV29yZHNbKHRoaXNTaWdCeXRlcyArIGkpID4+PiAyXSA9IHRoYXRXb3Jkc1tpID4+PiAyXTtcblx0ICAgICAgICAgICAgICAgIH1cblx0ICAgICAgICAgICAgfSBlbHNlIHtcblx0ICAgICAgICAgICAgICAgIC8vIENvcHkgYWxsIHdvcmRzIGF0IG9uY2Vcblx0ICAgICAgICAgICAgICAgIHRoaXNXb3Jkcy5wdXNoLmFwcGx5KHRoaXNXb3JkcywgdGhhdFdvcmRzKTtcblx0ICAgICAgICAgICAgfVxuXHQgICAgICAgICAgICB0aGlzLnNpZ0J5dGVzICs9IHRoYXRTaWdCeXRlcztcblxuXHQgICAgICAgICAgICAvLyBDaGFpbmFibGVcblx0ICAgICAgICAgICAgcmV0dXJuIHRoaXM7XG5cdCAgICAgICAgfSxcblxuXHQgICAgICAgIC8qKlxuXHQgICAgICAgICAqIFJlbW92ZXMgaW5zaWduaWZpY2FudCBiaXRzLlxuXHQgICAgICAgICAqXG5cdCAgICAgICAgICogQGV4YW1wbGVcblx0ICAgICAgICAgKlxuXHQgICAgICAgICAqICAgICB3b3JkQXJyYXkuY2xhbXAoKTtcblx0ICAgICAgICAgKi9cblx0ICAgICAgICBjbGFtcDogZnVuY3Rpb24gKCkge1xuXHQgICAgICAgICAgICAvLyBTaG9ydGN1dHNcblx0ICAgICAgICAgICAgdmFyIHdvcmRzID0gdGhpcy53b3Jkcztcblx0ICAgICAgICAgICAgdmFyIHNpZ0J5dGVzID0gdGhpcy5zaWdCeXRlcztcblxuXHQgICAgICAgICAgICAvLyBDbGFtcFxuXHQgICAgICAgICAgICB3b3Jkc1tzaWdCeXRlcyA+Pj4gMl0gJj0gMHhmZmZmZmZmZiA8PCAoMzIgLSAoc2lnQnl0ZXMgJSA0KSAqIDgpO1xuXHQgICAgICAgICAgICB3b3Jkcy5sZW5ndGggPSBNYXRoLmNlaWwoc2lnQnl0ZXMgLyA0KTtcblx0ICAgICAgICB9LFxuXG5cdCAgICAgICAgLyoqXG5cdCAgICAgICAgICogQ3JlYXRlcyBhIGNvcHkgb2YgdGhpcyB3b3JkIGFycmF5LlxuXHQgICAgICAgICAqXG5cdCAgICAgICAgICogQHJldHVybiB7V29yZEFycmF5fSBUaGUgY2xvbmUuXG5cdCAgICAgICAgICpcblx0ICAgICAgICAgKiBAZXhhbXBsZVxuXHQgICAgICAgICAqXG5cdCAgICAgICAgICogICAgIHZhciBjbG9uZSA9IHdvcmRBcnJheS5jbG9uZSgpO1xuXHQgICAgICAgICAqL1xuXHQgICAgICAgIGNsb25lOiBmdW5jdGlvbiAoKSB7XG5cdCAgICAgICAgICAgIHZhciBjbG9uZSA9IEJhc2UuY2xvbmUuY2FsbCh0aGlzKTtcblx0ICAgICAgICAgICAgY2xvbmUud29yZHMgPSB0aGlzLndvcmRzLnNsaWNlKDApO1xuXG5cdCAgICAgICAgICAgIHJldHVybiBjbG9uZTtcblx0ICAgICAgICB9LFxuXG5cdCAgICAgICAgLyoqXG5cdCAgICAgICAgICogQ3JlYXRlcyBhIHdvcmQgYXJyYXkgZmlsbGVkIHdpdGggcmFuZG9tIGJ5dGVzLlxuXHQgICAgICAgICAqXG5cdCAgICAgICAgICogQHBhcmFtIHtudW1iZXJ9IG5CeXRlcyBUaGUgbnVtYmVyIG9mIHJhbmRvbSBieXRlcyB0byBnZW5lcmF0ZS5cblx0ICAgICAgICAgKlxuXHQgICAgICAgICAqIEByZXR1cm4ge1dvcmRBcnJheX0gVGhlIHJhbmRvbSB3b3JkIGFycmF5LlxuXHQgICAgICAgICAqXG5cdCAgICAgICAgICogQHN0YXRpY1xuXHQgICAgICAgICAqXG5cdCAgICAgICAgICogQGV4YW1wbGVcblx0ICAgICAgICAgKlxuXHQgICAgICAgICAqICAgICB2YXIgd29yZEFycmF5ID0gQ3J5cHRvSlMubGliLldvcmRBcnJheS5yYW5kb20oMTYpO1xuXHQgICAgICAgICAqL1xuXHQgICAgICAgIHJhbmRvbTogZnVuY3Rpb24gKG5CeXRlcykge1xuXHQgICAgICAgICAgICB2YXIgd29yZHMgPSBbXTtcblxuXHQgICAgICAgICAgICB2YXIgciA9IChmdW5jdGlvbiAobV93KSB7XG5cdCAgICAgICAgICAgICAgICB2YXIgbV93ID0gbV93O1xuXHQgICAgICAgICAgICAgICAgdmFyIG1feiA9IDB4M2FkZTY4YjE7XG5cdCAgICAgICAgICAgICAgICB2YXIgbWFzayA9IDB4ZmZmZmZmZmY7XG5cblx0ICAgICAgICAgICAgICAgIHJldHVybiBmdW5jdGlvbiAoKSB7XG5cdCAgICAgICAgICAgICAgICAgICAgbV96ID0gKDB4OTA2OSAqIChtX3ogJiAweEZGRkYpICsgKG1feiA+PiAweDEwKSkgJiBtYXNrO1xuXHQgICAgICAgICAgICAgICAgICAgIG1fdyA9ICgweDQ2NTAgKiAobV93ICYgMHhGRkZGKSArIChtX3cgPj4gMHgxMCkpICYgbWFzaztcblx0ICAgICAgICAgICAgICAgICAgICB2YXIgcmVzdWx0ID0gKChtX3ogPDwgMHgxMCkgKyBtX3cpICYgbWFzaztcblx0ICAgICAgICAgICAgICAgICAgICByZXN1bHQgLz0gMHgxMDAwMDAwMDA7XG5cdCAgICAgICAgICAgICAgICAgICAgcmVzdWx0ICs9IDAuNTtcblx0ICAgICAgICAgICAgICAgICAgICByZXR1cm4gcmVzdWx0ICogKE1hdGgucmFuZG9tKCkgPiAuNSA/IDEgOiAtMSk7XG5cdCAgICAgICAgICAgICAgICB9XG5cdCAgICAgICAgICAgIH0pO1xuXG5cdCAgICAgICAgICAgIGZvciAodmFyIGkgPSAwLCByY2FjaGU7IGkgPCBuQnl0ZXM7IGkgKz0gNCkge1xuXHQgICAgICAgICAgICAgICAgdmFyIF9yID0gcigocmNhY2hlIHx8IE1hdGgucmFuZG9tKCkpICogMHgxMDAwMDAwMDApO1xuXG5cdCAgICAgICAgICAgICAgICByY2FjaGUgPSBfcigpICogMHgzYWRlNjdiNztcblx0ICAgICAgICAgICAgICAgIHdvcmRzLnB1c2goKF9yKCkgKiAweDEwMDAwMDAwMCkgfCAwKTtcblx0ICAgICAgICAgICAgfVxuXG5cdCAgICAgICAgICAgIHJldHVybiBuZXcgV29yZEFycmF5LmluaXQod29yZHMsIG5CeXRlcyk7XG5cdCAgICAgICAgfVxuXHQgICAgfSk7XG5cblx0ICAgIC8qKlxuXHQgICAgICogRW5jb2RlciBuYW1lc3BhY2UuXG5cdCAgICAgKi9cblx0ICAgIHZhciBDX2VuYyA9IEMuZW5jID0ge307XG5cblx0ICAgIC8qKlxuXHQgICAgICogSGV4IGVuY29kaW5nIHN0cmF0ZWd5LlxuXHQgICAgICovXG5cdCAgICB2YXIgSGV4ID0gQ19lbmMuSGV4ID0ge1xuXHQgICAgICAgIC8qKlxuXHQgICAgICAgICAqIENvbnZlcnRzIGEgd29yZCBhcnJheSB0byBhIGhleCBzdHJpbmcuXG5cdCAgICAgICAgICpcblx0ICAgICAgICAgKiBAcGFyYW0ge1dvcmRBcnJheX0gd29yZEFycmF5IFRoZSB3b3JkIGFycmF5LlxuXHQgICAgICAgICAqXG5cdCAgICAgICAgICogQHJldHVybiB7c3RyaW5nfSBUaGUgaGV4IHN0cmluZy5cblx0ICAgICAgICAgKlxuXHQgICAgICAgICAqIEBzdGF0aWNcblx0ICAgICAgICAgKlxuXHQgICAgICAgICAqIEBleGFtcGxlXG5cdCAgICAgICAgICpcblx0ICAgICAgICAgKiAgICAgdmFyIGhleFN0cmluZyA9IENyeXB0b0pTLmVuYy5IZXguc3RyaW5naWZ5KHdvcmRBcnJheSk7XG5cdCAgICAgICAgICovXG5cdCAgICAgICAgc3RyaW5naWZ5OiBmdW5jdGlvbiAod29yZEFycmF5KSB7XG5cdCAgICAgICAgICAgIC8vIFNob3J0Y3V0c1xuXHQgICAgICAgICAgICB2YXIgd29yZHMgPSB3b3JkQXJyYXkud29yZHM7XG5cdCAgICAgICAgICAgIHZhciBzaWdCeXRlcyA9IHdvcmRBcnJheS5zaWdCeXRlcztcblxuXHQgICAgICAgICAgICAvLyBDb252ZXJ0XG5cdCAgICAgICAgICAgIHZhciBoZXhDaGFycyA9IFtdO1xuXHQgICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHNpZ0J5dGVzOyBpKyspIHtcblx0ICAgICAgICAgICAgICAgIHZhciBiaXRlID0gKHdvcmRzW2kgPj4+IDJdID4+PiAoMjQgLSAoaSAlIDQpICogOCkpICYgMHhmZjtcblx0ICAgICAgICAgICAgICAgIGhleENoYXJzLnB1c2goKGJpdGUgPj4+IDQpLnRvU3RyaW5nKDE2KSk7XG5cdCAgICAgICAgICAgICAgICBoZXhDaGFycy5wdXNoKChiaXRlICYgMHgwZikudG9TdHJpbmcoMTYpKTtcblx0ICAgICAgICAgICAgfVxuXG5cdCAgICAgICAgICAgIHJldHVybiBoZXhDaGFycy5qb2luKCcnKTtcblx0ICAgICAgICB9LFxuXG5cdCAgICAgICAgLyoqXG5cdCAgICAgICAgICogQ29udmVydHMgYSBoZXggc3RyaW5nIHRvIGEgd29yZCBhcnJheS5cblx0ICAgICAgICAgKlxuXHQgICAgICAgICAqIEBwYXJhbSB7c3RyaW5nfSBoZXhTdHIgVGhlIGhleCBzdHJpbmcuXG5cdCAgICAgICAgICpcblx0ICAgICAgICAgKiBAcmV0dXJuIHtXb3JkQXJyYXl9IFRoZSB3b3JkIGFycmF5LlxuXHQgICAgICAgICAqXG5cdCAgICAgICAgICogQHN0YXRpY1xuXHQgICAgICAgICAqXG5cdCAgICAgICAgICogQGV4YW1wbGVcblx0ICAgICAgICAgKlxuXHQgICAgICAgICAqICAgICB2YXIgd29yZEFycmF5ID0gQ3J5cHRvSlMuZW5jLkhleC5wYXJzZShoZXhTdHJpbmcpO1xuXHQgICAgICAgICAqL1xuXHQgICAgICAgIHBhcnNlOiBmdW5jdGlvbiAoaGV4U3RyKSB7XG5cdCAgICAgICAgICAgIC8vIFNob3J0Y3V0XG5cdCAgICAgICAgICAgIHZhciBoZXhTdHJMZW5ndGggPSBoZXhTdHIubGVuZ3RoO1xuXG5cdCAgICAgICAgICAgIC8vIENvbnZlcnRcblx0ICAgICAgICAgICAgdmFyIHdvcmRzID0gW107XG5cdCAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgaGV4U3RyTGVuZ3RoOyBpICs9IDIpIHtcblx0ICAgICAgICAgICAgICAgIHdvcmRzW2kgPj4+IDNdIHw9IHBhcnNlSW50KGhleFN0ci5zdWJzdHIoaSwgMiksIDE2KSA8PCAoMjQgLSAoaSAlIDgpICogNCk7XG5cdCAgICAgICAgICAgIH1cblxuXHQgICAgICAgICAgICByZXR1cm4gbmV3IFdvcmRBcnJheS5pbml0KHdvcmRzLCBoZXhTdHJMZW5ndGggLyAyKTtcblx0ICAgICAgICB9XG5cdCAgICB9O1xuXG5cdCAgICAvKipcblx0ICAgICAqIExhdGluMSBlbmNvZGluZyBzdHJhdGVneS5cblx0ICAgICAqL1xuXHQgICAgdmFyIExhdGluMSA9IENfZW5jLkxhdGluMSA9IHtcblx0ICAgICAgICAvKipcblx0ICAgICAgICAgKiBDb252ZXJ0cyBhIHdvcmQgYXJyYXkgdG8gYSBMYXRpbjEgc3RyaW5nLlxuXHQgICAgICAgICAqXG5cdCAgICAgICAgICogQHBhcmFtIHtXb3JkQXJyYXl9IHdvcmRBcnJheSBUaGUgd29yZCBhcnJheS5cblx0ICAgICAgICAgKlxuXHQgICAgICAgICAqIEByZXR1cm4ge3N0cmluZ30gVGhlIExhdGluMSBzdHJpbmcuXG5cdCAgICAgICAgICpcblx0ICAgICAgICAgKiBAc3RhdGljXG5cdCAgICAgICAgICpcblx0ICAgICAgICAgKiBAZXhhbXBsZVxuXHQgICAgICAgICAqXG5cdCAgICAgICAgICogICAgIHZhciBsYXRpbjFTdHJpbmcgPSBDcnlwdG9KUy5lbmMuTGF0aW4xLnN0cmluZ2lmeSh3b3JkQXJyYXkpO1xuXHQgICAgICAgICAqL1xuXHQgICAgICAgIHN0cmluZ2lmeTogZnVuY3Rpb24gKHdvcmRBcnJheSkge1xuXHQgICAgICAgICAgICAvLyBTaG9ydGN1dHNcblx0ICAgICAgICAgICAgdmFyIHdvcmRzID0gd29yZEFycmF5LndvcmRzO1xuXHQgICAgICAgICAgICB2YXIgc2lnQnl0ZXMgPSB3b3JkQXJyYXkuc2lnQnl0ZXM7XG5cblx0ICAgICAgICAgICAgLy8gQ29udmVydFxuXHQgICAgICAgICAgICB2YXIgbGF0aW4xQ2hhcnMgPSBbXTtcblx0ICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzaWdCeXRlczsgaSsrKSB7XG5cdCAgICAgICAgICAgICAgICB2YXIgYml0ZSA9ICh3b3Jkc1tpID4+PiAyXSA+Pj4gKDI0IC0gKGkgJSA0KSAqIDgpKSAmIDB4ZmY7XG5cdCAgICAgICAgICAgICAgICBsYXRpbjFDaGFycy5wdXNoKFN0cmluZy5mcm9tQ2hhckNvZGUoYml0ZSkpO1xuXHQgICAgICAgICAgICB9XG5cblx0ICAgICAgICAgICAgcmV0dXJuIGxhdGluMUNoYXJzLmpvaW4oJycpO1xuXHQgICAgICAgIH0sXG5cblx0ICAgICAgICAvKipcblx0ICAgICAgICAgKiBDb252ZXJ0cyBhIExhdGluMSBzdHJpbmcgdG8gYSB3b3JkIGFycmF5LlxuXHQgICAgICAgICAqXG5cdCAgICAgICAgICogQHBhcmFtIHtzdHJpbmd9IGxhdGluMVN0ciBUaGUgTGF0aW4xIHN0cmluZy5cblx0ICAgICAgICAgKlxuXHQgICAgICAgICAqIEByZXR1cm4ge1dvcmRBcnJheX0gVGhlIHdvcmQgYXJyYXkuXG5cdCAgICAgICAgICpcblx0ICAgICAgICAgKiBAc3RhdGljXG5cdCAgICAgICAgICpcblx0ICAgICAgICAgKiBAZXhhbXBsZVxuXHQgICAgICAgICAqXG5cdCAgICAgICAgICogICAgIHZhciB3b3JkQXJyYXkgPSBDcnlwdG9KUy5lbmMuTGF0aW4xLnBhcnNlKGxhdGluMVN0cmluZyk7XG5cdCAgICAgICAgICovXG5cdCAgICAgICAgcGFyc2U6IGZ1bmN0aW9uIChsYXRpbjFTdHIpIHtcblx0ICAgICAgICAgICAgLy8gU2hvcnRjdXRcblx0ICAgICAgICAgICAgdmFyIGxhdGluMVN0ckxlbmd0aCA9IGxhdGluMVN0ci5sZW5ndGg7XG5cblx0ICAgICAgICAgICAgLy8gQ29udmVydFxuXHQgICAgICAgICAgICB2YXIgd29yZHMgPSBbXTtcblx0ICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsYXRpbjFTdHJMZW5ndGg7IGkrKykge1xuXHQgICAgICAgICAgICAgICAgd29yZHNbaSA+Pj4gMl0gfD0gKGxhdGluMVN0ci5jaGFyQ29kZUF0KGkpICYgMHhmZikgPDwgKDI0IC0gKGkgJSA0KSAqIDgpO1xuXHQgICAgICAgICAgICB9XG5cblx0ICAgICAgICAgICAgcmV0dXJuIG5ldyBXb3JkQXJyYXkuaW5pdCh3b3JkcywgbGF0aW4xU3RyTGVuZ3RoKTtcblx0ICAgICAgICB9XG5cdCAgICB9O1xuXG5cdCAgICAvKipcblx0ICAgICAqIFVURi04IGVuY29kaW5nIHN0cmF0ZWd5LlxuXHQgICAgICovXG5cdCAgICB2YXIgVXRmOCA9IENfZW5jLlV0ZjggPSB7XG5cdCAgICAgICAgLyoqXG5cdCAgICAgICAgICogQ29udmVydHMgYSB3b3JkIGFycmF5IHRvIGEgVVRGLTggc3RyaW5nLlxuXHQgICAgICAgICAqXG5cdCAgICAgICAgICogQHBhcmFtIHtXb3JkQXJyYXl9IHdvcmRBcnJheSBUaGUgd29yZCBhcnJheS5cblx0ICAgICAgICAgKlxuXHQgICAgICAgICAqIEByZXR1cm4ge3N0cmluZ30gVGhlIFVURi04IHN0cmluZy5cblx0ICAgICAgICAgKlxuXHQgICAgICAgICAqIEBzdGF0aWNcblx0ICAgICAgICAgKlxuXHQgICAgICAgICAqIEBleGFtcGxlXG5cdCAgICAgICAgICpcblx0ICAgICAgICAgKiAgICAgdmFyIHV0ZjhTdHJpbmcgPSBDcnlwdG9KUy5lbmMuVXRmOC5zdHJpbmdpZnkod29yZEFycmF5KTtcblx0ICAgICAgICAgKi9cblx0ICAgICAgICBzdHJpbmdpZnk6IGZ1bmN0aW9uICh3b3JkQXJyYXkpIHtcblx0ICAgICAgICAgICAgdHJ5IHtcblx0ICAgICAgICAgICAgICAgIHJldHVybiBkZWNvZGVVUklDb21wb25lbnQoZXNjYXBlKExhdGluMS5zdHJpbmdpZnkod29yZEFycmF5KSkpO1xuXHQgICAgICAgICAgICB9IGNhdGNoIChlKSB7XG5cdCAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ01hbGZvcm1lZCBVVEYtOCBkYXRhJyk7XG5cdCAgICAgICAgICAgIH1cblx0ICAgICAgICB9LFxuXG5cdCAgICAgICAgLyoqXG5cdCAgICAgICAgICogQ29udmVydHMgYSBVVEYtOCBzdHJpbmcgdG8gYSB3b3JkIGFycmF5LlxuXHQgICAgICAgICAqXG5cdCAgICAgICAgICogQHBhcmFtIHtzdHJpbmd9IHV0ZjhTdHIgVGhlIFVURi04IHN0cmluZy5cblx0ICAgICAgICAgKlxuXHQgICAgICAgICAqIEByZXR1cm4ge1dvcmRBcnJheX0gVGhlIHdvcmQgYXJyYXkuXG5cdCAgICAgICAgICpcblx0ICAgICAgICAgKiBAc3RhdGljXG5cdCAgICAgICAgICpcblx0ICAgICAgICAgKiBAZXhhbXBsZVxuXHQgICAgICAgICAqXG5cdCAgICAgICAgICogICAgIHZhciB3b3JkQXJyYXkgPSBDcnlwdG9KUy5lbmMuVXRmOC5wYXJzZSh1dGY4U3RyaW5nKTtcblx0ICAgICAgICAgKi9cblx0ICAgICAgICBwYXJzZTogZnVuY3Rpb24gKHV0ZjhTdHIpIHtcblx0ICAgICAgICAgICAgcmV0dXJuIExhdGluMS5wYXJzZSh1bmVzY2FwZShlbmNvZGVVUklDb21wb25lbnQodXRmOFN0cikpKTtcblx0ICAgICAgICB9XG5cdCAgICB9O1xuXG5cdCAgICAvKipcblx0ICAgICAqIEFic3RyYWN0IGJ1ZmZlcmVkIGJsb2NrIGFsZ29yaXRobSB0ZW1wbGF0ZS5cblx0ICAgICAqXG5cdCAgICAgKiBUaGUgcHJvcGVydHkgYmxvY2tTaXplIG11c3QgYmUgaW1wbGVtZW50ZWQgaW4gYSBjb25jcmV0ZSBzdWJ0eXBlLlxuXHQgICAgICpcblx0ICAgICAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBfbWluQnVmZmVyU2l6ZSBUaGUgbnVtYmVyIG9mIGJsb2NrcyB0aGF0IHNob3VsZCBiZSBrZXB0IHVucHJvY2Vzc2VkIGluIHRoZSBidWZmZXIuIERlZmF1bHQ6IDBcblx0ICAgICAqL1xuXHQgICAgdmFyIEJ1ZmZlcmVkQmxvY2tBbGdvcml0aG0gPSBDX2xpYi5CdWZmZXJlZEJsb2NrQWxnb3JpdGhtID0gQmFzZS5leHRlbmQoe1xuXHQgICAgICAgIC8qKlxuXHQgICAgICAgICAqIFJlc2V0cyB0aGlzIGJsb2NrIGFsZ29yaXRobSdzIGRhdGEgYnVmZmVyIHRvIGl0cyBpbml0aWFsIHN0YXRlLlxuXHQgICAgICAgICAqXG5cdCAgICAgICAgICogQGV4YW1wbGVcblx0ICAgICAgICAgKlxuXHQgICAgICAgICAqICAgICBidWZmZXJlZEJsb2NrQWxnb3JpdGhtLnJlc2V0KCk7XG5cdCAgICAgICAgICovXG5cdCAgICAgICAgcmVzZXQ6IGZ1bmN0aW9uICgpIHtcblx0ICAgICAgICAgICAgLy8gSW5pdGlhbCB2YWx1ZXNcblx0ICAgICAgICAgICAgdGhpcy5fZGF0YSA9IG5ldyBXb3JkQXJyYXkuaW5pdCgpO1xuXHQgICAgICAgICAgICB0aGlzLl9uRGF0YUJ5dGVzID0gMDtcblx0ICAgICAgICB9LFxuXG5cdCAgICAgICAgLyoqXG5cdCAgICAgICAgICogQWRkcyBuZXcgZGF0YSB0byB0aGlzIGJsb2NrIGFsZ29yaXRobSdzIGJ1ZmZlci5cblx0ICAgICAgICAgKlxuXHQgICAgICAgICAqIEBwYXJhbSB7V29yZEFycmF5fHN0cmluZ30gZGF0YSBUaGUgZGF0YSB0byBhcHBlbmQuIFN0cmluZ3MgYXJlIGNvbnZlcnRlZCB0byBhIFdvcmRBcnJheSB1c2luZyBVVEYtOC5cblx0ICAgICAgICAgKlxuXHQgICAgICAgICAqIEBleGFtcGxlXG5cdCAgICAgICAgICpcblx0ICAgICAgICAgKiAgICAgYnVmZmVyZWRCbG9ja0FsZ29yaXRobS5fYXBwZW5kKCdkYXRhJyk7XG5cdCAgICAgICAgICogICAgIGJ1ZmZlcmVkQmxvY2tBbGdvcml0aG0uX2FwcGVuZCh3b3JkQXJyYXkpO1xuXHQgICAgICAgICAqL1xuXHQgICAgICAgIF9hcHBlbmQ6IGZ1bmN0aW9uIChkYXRhKSB7XG5cdCAgICAgICAgICAgIC8vIENvbnZlcnQgc3RyaW5nIHRvIFdvcmRBcnJheSwgZWxzZSBhc3N1bWUgV29yZEFycmF5IGFscmVhZHlcblx0ICAgICAgICAgICAgaWYgKHR5cGVvZiBkYXRhID09ICdzdHJpbmcnKSB7XG5cdCAgICAgICAgICAgICAgICBkYXRhID0gVXRmOC5wYXJzZShkYXRhKTtcblx0ICAgICAgICAgICAgfVxuXG5cdCAgICAgICAgICAgIC8vIEFwcGVuZFxuXHQgICAgICAgICAgICB0aGlzLl9kYXRhLmNvbmNhdChkYXRhKTtcblx0ICAgICAgICAgICAgdGhpcy5fbkRhdGFCeXRlcyArPSBkYXRhLnNpZ0J5dGVzO1xuXHQgICAgICAgIH0sXG5cblx0ICAgICAgICAvKipcblx0ICAgICAgICAgKiBQcm9jZXNzZXMgYXZhaWxhYmxlIGRhdGEgYmxvY2tzLlxuXHQgICAgICAgICAqXG5cdCAgICAgICAgICogVGhpcyBtZXRob2QgaW52b2tlcyBfZG9Qcm9jZXNzQmxvY2sob2Zmc2V0KSwgd2hpY2ggbXVzdCBiZSBpbXBsZW1lbnRlZCBieSBhIGNvbmNyZXRlIHN1YnR5cGUuXG5cdCAgICAgICAgICpcblx0ICAgICAgICAgKiBAcGFyYW0ge2Jvb2xlYW59IGRvRmx1c2ggV2hldGhlciBhbGwgYmxvY2tzIGFuZCBwYXJ0aWFsIGJsb2NrcyBzaG91bGQgYmUgcHJvY2Vzc2VkLlxuXHQgICAgICAgICAqXG5cdCAgICAgICAgICogQHJldHVybiB7V29yZEFycmF5fSBUaGUgcHJvY2Vzc2VkIGRhdGEuXG5cdCAgICAgICAgICpcblx0ICAgICAgICAgKiBAZXhhbXBsZVxuXHQgICAgICAgICAqXG5cdCAgICAgICAgICogICAgIHZhciBwcm9jZXNzZWREYXRhID0gYnVmZmVyZWRCbG9ja0FsZ29yaXRobS5fcHJvY2VzcygpO1xuXHQgICAgICAgICAqICAgICB2YXIgcHJvY2Vzc2VkRGF0YSA9IGJ1ZmZlcmVkQmxvY2tBbGdvcml0aG0uX3Byb2Nlc3MoISEnZmx1c2gnKTtcblx0ICAgICAgICAgKi9cblx0ICAgICAgICBfcHJvY2VzczogZnVuY3Rpb24gKGRvRmx1c2gpIHtcblx0ICAgICAgICAgICAgLy8gU2hvcnRjdXRzXG5cdCAgICAgICAgICAgIHZhciBkYXRhID0gdGhpcy5fZGF0YTtcblx0ICAgICAgICAgICAgdmFyIGRhdGFXb3JkcyA9IGRhdGEud29yZHM7XG5cdCAgICAgICAgICAgIHZhciBkYXRhU2lnQnl0ZXMgPSBkYXRhLnNpZ0J5dGVzO1xuXHQgICAgICAgICAgICB2YXIgYmxvY2tTaXplID0gdGhpcy5ibG9ja1NpemU7XG5cdCAgICAgICAgICAgIHZhciBibG9ja1NpemVCeXRlcyA9IGJsb2NrU2l6ZSAqIDQ7XG5cblx0ICAgICAgICAgICAgLy8gQ291bnQgYmxvY2tzIHJlYWR5XG5cdCAgICAgICAgICAgIHZhciBuQmxvY2tzUmVhZHkgPSBkYXRhU2lnQnl0ZXMgLyBibG9ja1NpemVCeXRlcztcblx0ICAgICAgICAgICAgaWYgKGRvRmx1c2gpIHtcblx0ICAgICAgICAgICAgICAgIC8vIFJvdW5kIHVwIHRvIGluY2x1ZGUgcGFydGlhbCBibG9ja3Ncblx0ICAgICAgICAgICAgICAgIG5CbG9ja3NSZWFkeSA9IE1hdGguY2VpbChuQmxvY2tzUmVhZHkpO1xuXHQgICAgICAgICAgICB9IGVsc2Uge1xuXHQgICAgICAgICAgICAgICAgLy8gUm91bmQgZG93biB0byBpbmNsdWRlIG9ubHkgZnVsbCBibG9ja3MsXG5cdCAgICAgICAgICAgICAgICAvLyBsZXNzIHRoZSBudW1iZXIgb2YgYmxvY2tzIHRoYXQgbXVzdCByZW1haW4gaW4gdGhlIGJ1ZmZlclxuXHQgICAgICAgICAgICAgICAgbkJsb2Nrc1JlYWR5ID0gTWF0aC5tYXgoKG5CbG9ja3NSZWFkeSB8IDApIC0gdGhpcy5fbWluQnVmZmVyU2l6ZSwgMCk7XG5cdCAgICAgICAgICAgIH1cblxuXHQgICAgICAgICAgICAvLyBDb3VudCB3b3JkcyByZWFkeVxuXHQgICAgICAgICAgICB2YXIgbldvcmRzUmVhZHkgPSBuQmxvY2tzUmVhZHkgKiBibG9ja1NpemU7XG5cblx0ICAgICAgICAgICAgLy8gQ291bnQgYnl0ZXMgcmVhZHlcblx0ICAgICAgICAgICAgdmFyIG5CeXRlc1JlYWR5ID0gTWF0aC5taW4obldvcmRzUmVhZHkgKiA0LCBkYXRhU2lnQnl0ZXMpO1xuXG5cdCAgICAgICAgICAgIC8vIFByb2Nlc3MgYmxvY2tzXG5cdCAgICAgICAgICAgIGlmIChuV29yZHNSZWFkeSkge1xuXHQgICAgICAgICAgICAgICAgZm9yICh2YXIgb2Zmc2V0ID0gMDsgb2Zmc2V0IDwgbldvcmRzUmVhZHk7IG9mZnNldCArPSBibG9ja1NpemUpIHtcblx0ICAgICAgICAgICAgICAgICAgICAvLyBQZXJmb3JtIGNvbmNyZXRlLWFsZ29yaXRobSBsb2dpY1xuXHQgICAgICAgICAgICAgICAgICAgIHRoaXMuX2RvUHJvY2Vzc0Jsb2NrKGRhdGFXb3Jkcywgb2Zmc2V0KTtcblx0ICAgICAgICAgICAgICAgIH1cblxuXHQgICAgICAgICAgICAgICAgLy8gUmVtb3ZlIHByb2Nlc3NlZCB3b3Jkc1xuXHQgICAgICAgICAgICAgICAgdmFyIHByb2Nlc3NlZFdvcmRzID0gZGF0YVdvcmRzLnNwbGljZSgwLCBuV29yZHNSZWFkeSk7XG5cdCAgICAgICAgICAgICAgICBkYXRhLnNpZ0J5dGVzIC09IG5CeXRlc1JlYWR5O1xuXHQgICAgICAgICAgICB9XG5cblx0ICAgICAgICAgICAgLy8gUmV0dXJuIHByb2Nlc3NlZCB3b3Jkc1xuXHQgICAgICAgICAgICByZXR1cm4gbmV3IFdvcmRBcnJheS5pbml0KHByb2Nlc3NlZFdvcmRzLCBuQnl0ZXNSZWFkeSk7XG5cdCAgICAgICAgfSxcblxuXHQgICAgICAgIC8qKlxuXHQgICAgICAgICAqIENyZWF0ZXMgYSBjb3B5IG9mIHRoaXMgb2JqZWN0LlxuXHQgICAgICAgICAqXG5cdCAgICAgICAgICogQHJldHVybiB7T2JqZWN0fSBUaGUgY2xvbmUuXG5cdCAgICAgICAgICpcblx0ICAgICAgICAgKiBAZXhhbXBsZVxuXHQgICAgICAgICAqXG5cdCAgICAgICAgICogICAgIHZhciBjbG9uZSA9IGJ1ZmZlcmVkQmxvY2tBbGdvcml0aG0uY2xvbmUoKTtcblx0ICAgICAgICAgKi9cblx0ICAgICAgICBjbG9uZTogZnVuY3Rpb24gKCkge1xuXHQgICAgICAgICAgICB2YXIgY2xvbmUgPSBCYXNlLmNsb25lLmNhbGwodGhpcyk7XG5cdCAgICAgICAgICAgIGNsb25lLl9kYXRhID0gdGhpcy5fZGF0YS5jbG9uZSgpO1xuXG5cdCAgICAgICAgICAgIHJldHVybiBjbG9uZTtcblx0ICAgICAgICB9LFxuXG5cdCAgICAgICAgX21pbkJ1ZmZlclNpemU6IDBcblx0ICAgIH0pO1xuXG5cdCAgICAvKipcblx0ICAgICAqIEFic3RyYWN0IGhhc2hlciB0ZW1wbGF0ZS5cblx0ICAgICAqXG5cdCAgICAgKiBAcHJvcGVydHkge251bWJlcn0gYmxvY2tTaXplIFRoZSBudW1iZXIgb2YgMzItYml0IHdvcmRzIHRoaXMgaGFzaGVyIG9wZXJhdGVzIG9uLiBEZWZhdWx0OiAxNiAoNTEyIGJpdHMpXG5cdCAgICAgKi9cblx0ICAgIHZhciBIYXNoZXIgPSBDX2xpYi5IYXNoZXIgPSBCdWZmZXJlZEJsb2NrQWxnb3JpdGhtLmV4dGVuZCh7XG5cdCAgICAgICAgLyoqXG5cdCAgICAgICAgICogQ29uZmlndXJhdGlvbiBvcHRpb25zLlxuXHQgICAgICAgICAqL1xuXHQgICAgICAgIGNmZzogQmFzZS5leHRlbmQoKSxcblxuXHQgICAgICAgIC8qKlxuXHQgICAgICAgICAqIEluaXRpYWxpemVzIGEgbmV3bHkgY3JlYXRlZCBoYXNoZXIuXG5cdCAgICAgICAgICpcblx0ICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gY2ZnIChPcHRpb25hbCkgVGhlIGNvbmZpZ3VyYXRpb24gb3B0aW9ucyB0byB1c2UgZm9yIHRoaXMgaGFzaCBjb21wdXRhdGlvbi5cblx0ICAgICAgICAgKlxuXHQgICAgICAgICAqIEBleGFtcGxlXG5cdCAgICAgICAgICpcblx0ICAgICAgICAgKiAgICAgdmFyIGhhc2hlciA9IENyeXB0b0pTLmFsZ28uU0hBMjU2LmNyZWF0ZSgpO1xuXHQgICAgICAgICAqL1xuXHQgICAgICAgIGluaXQ6IGZ1bmN0aW9uIChjZmcpIHtcblx0ICAgICAgICAgICAgLy8gQXBwbHkgY29uZmlnIGRlZmF1bHRzXG5cdCAgICAgICAgICAgIHRoaXMuY2ZnID0gdGhpcy5jZmcuZXh0ZW5kKGNmZyk7XG5cblx0ICAgICAgICAgICAgLy8gU2V0IGluaXRpYWwgdmFsdWVzXG5cdCAgICAgICAgICAgIHRoaXMucmVzZXQoKTtcblx0ICAgICAgICB9LFxuXG5cdCAgICAgICAgLyoqXG5cdCAgICAgICAgICogUmVzZXRzIHRoaXMgaGFzaGVyIHRvIGl0cyBpbml0aWFsIHN0YXRlLlxuXHQgICAgICAgICAqXG5cdCAgICAgICAgICogQGV4YW1wbGVcblx0ICAgICAgICAgKlxuXHQgICAgICAgICAqICAgICBoYXNoZXIucmVzZXQoKTtcblx0ICAgICAgICAgKi9cblx0ICAgICAgICByZXNldDogZnVuY3Rpb24gKCkge1xuXHQgICAgICAgICAgICAvLyBSZXNldCBkYXRhIGJ1ZmZlclxuXHQgICAgICAgICAgICBCdWZmZXJlZEJsb2NrQWxnb3JpdGhtLnJlc2V0LmNhbGwodGhpcyk7XG5cblx0ICAgICAgICAgICAgLy8gUGVyZm9ybSBjb25jcmV0ZS1oYXNoZXIgbG9naWNcblx0ICAgICAgICAgICAgdGhpcy5fZG9SZXNldCgpO1xuXHQgICAgICAgIH0sXG5cblx0ICAgICAgICAvKipcblx0ICAgICAgICAgKiBVcGRhdGVzIHRoaXMgaGFzaGVyIHdpdGggYSBtZXNzYWdlLlxuXHQgICAgICAgICAqXG5cdCAgICAgICAgICogQHBhcmFtIHtXb3JkQXJyYXl8c3RyaW5nfSBtZXNzYWdlVXBkYXRlIFRoZSBtZXNzYWdlIHRvIGFwcGVuZC5cblx0ICAgICAgICAgKlxuXHQgICAgICAgICAqIEByZXR1cm4ge0hhc2hlcn0gVGhpcyBoYXNoZXIuXG5cdCAgICAgICAgICpcblx0ICAgICAgICAgKiBAZXhhbXBsZVxuXHQgICAgICAgICAqXG5cdCAgICAgICAgICogICAgIGhhc2hlci51cGRhdGUoJ21lc3NhZ2UnKTtcblx0ICAgICAgICAgKiAgICAgaGFzaGVyLnVwZGF0ZSh3b3JkQXJyYXkpO1xuXHQgICAgICAgICAqL1xuXHQgICAgICAgIHVwZGF0ZTogZnVuY3Rpb24gKG1lc3NhZ2VVcGRhdGUpIHtcblx0ICAgICAgICAgICAgLy8gQXBwZW5kXG5cdCAgICAgICAgICAgIHRoaXMuX2FwcGVuZChtZXNzYWdlVXBkYXRlKTtcblxuXHQgICAgICAgICAgICAvLyBVcGRhdGUgdGhlIGhhc2hcblx0ICAgICAgICAgICAgdGhpcy5fcHJvY2VzcygpO1xuXG5cdCAgICAgICAgICAgIC8vIENoYWluYWJsZVxuXHQgICAgICAgICAgICByZXR1cm4gdGhpcztcblx0ICAgICAgICB9LFxuXG5cdCAgICAgICAgLyoqXG5cdCAgICAgICAgICogRmluYWxpemVzIHRoZSBoYXNoIGNvbXB1dGF0aW9uLlxuXHQgICAgICAgICAqIE5vdGUgdGhhdCB0aGUgZmluYWxpemUgb3BlcmF0aW9uIGlzIGVmZmVjdGl2ZWx5IGEgZGVzdHJ1Y3RpdmUsIHJlYWQtb25jZSBvcGVyYXRpb24uXG5cdCAgICAgICAgICpcblx0ICAgICAgICAgKiBAcGFyYW0ge1dvcmRBcnJheXxzdHJpbmd9IG1lc3NhZ2VVcGRhdGUgKE9wdGlvbmFsKSBBIGZpbmFsIG1lc3NhZ2UgdXBkYXRlLlxuXHQgICAgICAgICAqXG5cdCAgICAgICAgICogQHJldHVybiB7V29yZEFycmF5fSBUaGUgaGFzaC5cblx0ICAgICAgICAgKlxuXHQgICAgICAgICAqIEBleGFtcGxlXG5cdCAgICAgICAgICpcblx0ICAgICAgICAgKiAgICAgdmFyIGhhc2ggPSBoYXNoZXIuZmluYWxpemUoKTtcblx0ICAgICAgICAgKiAgICAgdmFyIGhhc2ggPSBoYXNoZXIuZmluYWxpemUoJ21lc3NhZ2UnKTtcblx0ICAgICAgICAgKiAgICAgdmFyIGhhc2ggPSBoYXNoZXIuZmluYWxpemUod29yZEFycmF5KTtcblx0ICAgICAgICAgKi9cblx0ICAgICAgICBmaW5hbGl6ZTogZnVuY3Rpb24gKG1lc3NhZ2VVcGRhdGUpIHtcblx0ICAgICAgICAgICAgLy8gRmluYWwgbWVzc2FnZSB1cGRhdGVcblx0ICAgICAgICAgICAgaWYgKG1lc3NhZ2VVcGRhdGUpIHtcblx0ICAgICAgICAgICAgICAgIHRoaXMuX2FwcGVuZChtZXNzYWdlVXBkYXRlKTtcblx0ICAgICAgICAgICAgfVxuXG5cdCAgICAgICAgICAgIC8vIFBlcmZvcm0gY29uY3JldGUtaGFzaGVyIGxvZ2ljXG5cdCAgICAgICAgICAgIHZhciBoYXNoID0gdGhpcy5fZG9GaW5hbGl6ZSgpO1xuXG5cdCAgICAgICAgICAgIHJldHVybiBoYXNoO1xuXHQgICAgICAgIH0sXG5cblx0ICAgICAgICBibG9ja1NpemU6IDUxMi8zMixcblxuXHQgICAgICAgIC8qKlxuXHQgICAgICAgICAqIENyZWF0ZXMgYSBzaG9ydGN1dCBmdW5jdGlvbiB0byBhIGhhc2hlcidzIG9iamVjdCBpbnRlcmZhY2UuXG5cdCAgICAgICAgICpcblx0ICAgICAgICAgKiBAcGFyYW0ge0hhc2hlcn0gaGFzaGVyIFRoZSBoYXNoZXIgdG8gY3JlYXRlIGEgaGVscGVyIGZvci5cblx0ICAgICAgICAgKlxuXHQgICAgICAgICAqIEByZXR1cm4ge0Z1bmN0aW9ufSBUaGUgc2hvcnRjdXQgZnVuY3Rpb24uXG5cdCAgICAgICAgICpcblx0ICAgICAgICAgKiBAc3RhdGljXG5cdCAgICAgICAgICpcblx0ICAgICAgICAgKiBAZXhhbXBsZVxuXHQgICAgICAgICAqXG5cdCAgICAgICAgICogICAgIHZhciBTSEEyNTYgPSBDcnlwdG9KUy5saWIuSGFzaGVyLl9jcmVhdGVIZWxwZXIoQ3J5cHRvSlMuYWxnby5TSEEyNTYpO1xuXHQgICAgICAgICAqL1xuXHQgICAgICAgIF9jcmVhdGVIZWxwZXI6IGZ1bmN0aW9uIChoYXNoZXIpIHtcblx0ICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uIChtZXNzYWdlLCBjZmcpIHtcblx0ICAgICAgICAgICAgICAgIHJldHVybiBuZXcgaGFzaGVyLmluaXQoY2ZnKS5maW5hbGl6ZShtZXNzYWdlKTtcblx0ICAgICAgICAgICAgfTtcblx0ICAgICAgICB9LFxuXG5cdCAgICAgICAgLyoqXG5cdCAgICAgICAgICogQ3JlYXRlcyBhIHNob3J0Y3V0IGZ1bmN0aW9uIHRvIHRoZSBITUFDJ3Mgb2JqZWN0IGludGVyZmFjZS5cblx0ICAgICAgICAgKlxuXHQgICAgICAgICAqIEBwYXJhbSB7SGFzaGVyfSBoYXNoZXIgVGhlIGhhc2hlciB0byB1c2UgaW4gdGhpcyBITUFDIGhlbHBlci5cblx0ICAgICAgICAgKlxuXHQgICAgICAgICAqIEByZXR1cm4ge0Z1bmN0aW9ufSBUaGUgc2hvcnRjdXQgZnVuY3Rpb24uXG5cdCAgICAgICAgICpcblx0ICAgICAgICAgKiBAc3RhdGljXG5cdCAgICAgICAgICpcblx0ICAgICAgICAgKiBAZXhhbXBsZVxuXHQgICAgICAgICAqXG5cdCAgICAgICAgICogICAgIHZhciBIbWFjU0hBMjU2ID0gQ3J5cHRvSlMubGliLkhhc2hlci5fY3JlYXRlSG1hY0hlbHBlcihDcnlwdG9KUy5hbGdvLlNIQTI1Nik7XG5cdCAgICAgICAgICovXG5cdCAgICAgICAgX2NyZWF0ZUhtYWNIZWxwZXI6IGZ1bmN0aW9uIChoYXNoZXIpIHtcblx0ICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uIChtZXNzYWdlLCBrZXkpIHtcblx0ICAgICAgICAgICAgICAgIHJldHVybiBuZXcgQ19hbGdvLkhNQUMuaW5pdChoYXNoZXIsIGtleSkuZmluYWxpemUobWVzc2FnZSk7XG5cdCAgICAgICAgICAgIH07XG5cdCAgICAgICAgfVxuXHQgICAgfSk7XG5cblx0ICAgIC8qKlxuXHQgICAgICogQWxnb3JpdGhtIG5hbWVzcGFjZS5cblx0ICAgICAqL1xuXHQgICAgdmFyIENfYWxnbyA9IEMuYWxnbyA9IHt9O1xuXG5cdCAgICByZXR1cm4gQztcblx0fShNYXRoKSk7XG5cblxuXHRyZXR1cm4gQ3J5cHRvSlM7XG5cbn0pKTsiLCI7KGZ1bmN0aW9uIChyb290LCBmYWN0b3J5KSB7XG5cdGlmICh0eXBlb2YgZXhwb3J0cyA9PT0gXCJvYmplY3RcIikge1xuXHRcdC8vIENvbW1vbkpTXG5cdFx0bW9kdWxlLmV4cG9ydHMgPSBleHBvcnRzID0gZmFjdG9yeShyZXF1aXJlKFwiLi9jb3JlXCIpKTtcblx0fVxuXHRlbHNlIGlmICh0eXBlb2YgZGVmaW5lID09PSBcImZ1bmN0aW9uXCIgJiYgZGVmaW5lLmFtZCkge1xuXHRcdC8vIEFNRFxuXHRcdGRlZmluZShbXCIuL2NvcmVcIl0sIGZhY3RvcnkpO1xuXHR9XG5cdGVsc2Uge1xuXHRcdC8vIEdsb2JhbCAoYnJvd3Nlcilcblx0XHRmYWN0b3J5KHJvb3QuQ3J5cHRvSlMpO1xuXHR9XG59KHRoaXMsIGZ1bmN0aW9uIChDcnlwdG9KUykge1xuXG5cdHJldHVybiBDcnlwdG9KUy5lbmMuSGV4O1xuXG59KSk7IiwiOyhmdW5jdGlvbiAocm9vdCwgZmFjdG9yeSwgdW5kZWYpIHtcblx0aWYgKHR5cGVvZiBleHBvcnRzID09PSBcIm9iamVjdFwiKSB7XG5cdFx0Ly8gQ29tbW9uSlNcblx0XHRtb2R1bGUuZXhwb3J0cyA9IGV4cG9ydHMgPSBmYWN0b3J5KHJlcXVpcmUoXCIuL2NvcmVcIiksIHJlcXVpcmUoXCIuL3NoYTI1NlwiKSwgcmVxdWlyZShcIi4vaG1hY1wiKSk7XG5cdH1cblx0ZWxzZSBpZiAodHlwZW9mIGRlZmluZSA9PT0gXCJmdW5jdGlvblwiICYmIGRlZmluZS5hbWQpIHtcblx0XHQvLyBBTURcblx0XHRkZWZpbmUoW1wiLi9jb3JlXCIsIFwiLi9zaGEyNTZcIiwgXCIuL2htYWNcIl0sIGZhY3RvcnkpO1xuXHR9XG5cdGVsc2Uge1xuXHRcdC8vIEdsb2JhbCAoYnJvd3Nlcilcblx0XHRmYWN0b3J5KHJvb3QuQ3J5cHRvSlMpO1xuXHR9XG59KHRoaXMsIGZ1bmN0aW9uIChDcnlwdG9KUykge1xuXG5cdHJldHVybiBDcnlwdG9KUy5IbWFjU0hBMjU2O1xuXG59KSk7IiwiOyhmdW5jdGlvbiAocm9vdCwgZmFjdG9yeSkge1xuXHRpZiAodHlwZW9mIGV4cG9ydHMgPT09IFwib2JqZWN0XCIpIHtcblx0XHQvLyBDb21tb25KU1xuXHRcdG1vZHVsZS5leHBvcnRzID0gZXhwb3J0cyA9IGZhY3RvcnkocmVxdWlyZShcIi4vY29yZVwiKSk7XG5cdH1cblx0ZWxzZSBpZiAodHlwZW9mIGRlZmluZSA9PT0gXCJmdW5jdGlvblwiICYmIGRlZmluZS5hbWQpIHtcblx0XHQvLyBBTURcblx0XHRkZWZpbmUoW1wiLi9jb3JlXCJdLCBmYWN0b3J5KTtcblx0fVxuXHRlbHNlIHtcblx0XHQvLyBHbG9iYWwgKGJyb3dzZXIpXG5cdFx0ZmFjdG9yeShyb290LkNyeXB0b0pTKTtcblx0fVxufSh0aGlzLCBmdW5jdGlvbiAoQ3J5cHRvSlMpIHtcblxuXHQoZnVuY3Rpb24gKCkge1xuXHQgICAgLy8gU2hvcnRjdXRzXG5cdCAgICB2YXIgQyA9IENyeXB0b0pTO1xuXHQgICAgdmFyIENfbGliID0gQy5saWI7XG5cdCAgICB2YXIgQmFzZSA9IENfbGliLkJhc2U7XG5cdCAgICB2YXIgQ19lbmMgPSBDLmVuYztcblx0ICAgIHZhciBVdGY4ID0gQ19lbmMuVXRmODtcblx0ICAgIHZhciBDX2FsZ28gPSBDLmFsZ287XG5cblx0ICAgIC8qKlxuXHQgICAgICogSE1BQyBhbGdvcml0aG0uXG5cdCAgICAgKi9cblx0ICAgIHZhciBITUFDID0gQ19hbGdvLkhNQUMgPSBCYXNlLmV4dGVuZCh7XG5cdCAgICAgICAgLyoqXG5cdCAgICAgICAgICogSW5pdGlhbGl6ZXMgYSBuZXdseSBjcmVhdGVkIEhNQUMuXG5cdCAgICAgICAgICpcblx0ICAgICAgICAgKiBAcGFyYW0ge0hhc2hlcn0gaGFzaGVyIFRoZSBoYXNoIGFsZ29yaXRobSB0byB1c2UuXG5cdCAgICAgICAgICogQHBhcmFtIHtXb3JkQXJyYXl8c3RyaW5nfSBrZXkgVGhlIHNlY3JldCBrZXkuXG5cdCAgICAgICAgICpcblx0ICAgICAgICAgKiBAZXhhbXBsZVxuXHQgICAgICAgICAqXG5cdCAgICAgICAgICogICAgIHZhciBobWFjSGFzaGVyID0gQ3J5cHRvSlMuYWxnby5ITUFDLmNyZWF0ZShDcnlwdG9KUy5hbGdvLlNIQTI1Niwga2V5KTtcblx0ICAgICAgICAgKi9cblx0ICAgICAgICBpbml0OiBmdW5jdGlvbiAoaGFzaGVyLCBrZXkpIHtcblx0ICAgICAgICAgICAgLy8gSW5pdCBoYXNoZXJcblx0ICAgICAgICAgICAgaGFzaGVyID0gdGhpcy5faGFzaGVyID0gbmV3IGhhc2hlci5pbml0KCk7XG5cblx0ICAgICAgICAgICAgLy8gQ29udmVydCBzdHJpbmcgdG8gV29yZEFycmF5LCBlbHNlIGFzc3VtZSBXb3JkQXJyYXkgYWxyZWFkeVxuXHQgICAgICAgICAgICBpZiAodHlwZW9mIGtleSA9PSAnc3RyaW5nJykge1xuXHQgICAgICAgICAgICAgICAga2V5ID0gVXRmOC5wYXJzZShrZXkpO1xuXHQgICAgICAgICAgICB9XG5cblx0ICAgICAgICAgICAgLy8gU2hvcnRjdXRzXG5cdCAgICAgICAgICAgIHZhciBoYXNoZXJCbG9ja1NpemUgPSBoYXNoZXIuYmxvY2tTaXplO1xuXHQgICAgICAgICAgICB2YXIgaGFzaGVyQmxvY2tTaXplQnl0ZXMgPSBoYXNoZXJCbG9ja1NpemUgKiA0O1xuXG5cdCAgICAgICAgICAgIC8vIEFsbG93IGFyYml0cmFyeSBsZW5ndGgga2V5c1xuXHQgICAgICAgICAgICBpZiAoa2V5LnNpZ0J5dGVzID4gaGFzaGVyQmxvY2tTaXplQnl0ZXMpIHtcblx0ICAgICAgICAgICAgICAgIGtleSA9IGhhc2hlci5maW5hbGl6ZShrZXkpO1xuXHQgICAgICAgICAgICB9XG5cblx0ICAgICAgICAgICAgLy8gQ2xhbXAgZXhjZXNzIGJpdHNcblx0ICAgICAgICAgICAga2V5LmNsYW1wKCk7XG5cblx0ICAgICAgICAgICAgLy8gQ2xvbmUga2V5IGZvciBpbm5lciBhbmQgb3V0ZXIgcGFkc1xuXHQgICAgICAgICAgICB2YXIgb0tleSA9IHRoaXMuX29LZXkgPSBrZXkuY2xvbmUoKTtcblx0ICAgICAgICAgICAgdmFyIGlLZXkgPSB0aGlzLl9pS2V5ID0ga2V5LmNsb25lKCk7XG5cblx0ICAgICAgICAgICAgLy8gU2hvcnRjdXRzXG5cdCAgICAgICAgICAgIHZhciBvS2V5V29yZHMgPSBvS2V5LndvcmRzO1xuXHQgICAgICAgICAgICB2YXIgaUtleVdvcmRzID0gaUtleS53b3JkcztcblxuXHQgICAgICAgICAgICAvLyBYT1Iga2V5cyB3aXRoIHBhZCBjb25zdGFudHNcblx0ICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBoYXNoZXJCbG9ja1NpemU7IGkrKykge1xuXHQgICAgICAgICAgICAgICAgb0tleVdvcmRzW2ldIF49IDB4NWM1YzVjNWM7XG5cdCAgICAgICAgICAgICAgICBpS2V5V29yZHNbaV0gXj0gMHgzNjM2MzYzNjtcblx0ICAgICAgICAgICAgfVxuXHQgICAgICAgICAgICBvS2V5LnNpZ0J5dGVzID0gaUtleS5zaWdCeXRlcyA9IGhhc2hlckJsb2NrU2l6ZUJ5dGVzO1xuXG5cdCAgICAgICAgICAgIC8vIFNldCBpbml0aWFsIHZhbHVlc1xuXHQgICAgICAgICAgICB0aGlzLnJlc2V0KCk7XG5cdCAgICAgICAgfSxcblxuXHQgICAgICAgIC8qKlxuXHQgICAgICAgICAqIFJlc2V0cyB0aGlzIEhNQUMgdG8gaXRzIGluaXRpYWwgc3RhdGUuXG5cdCAgICAgICAgICpcblx0ICAgICAgICAgKiBAZXhhbXBsZVxuXHQgICAgICAgICAqXG5cdCAgICAgICAgICogICAgIGhtYWNIYXNoZXIucmVzZXQoKTtcblx0ICAgICAgICAgKi9cblx0ICAgICAgICByZXNldDogZnVuY3Rpb24gKCkge1xuXHQgICAgICAgICAgICAvLyBTaG9ydGN1dFxuXHQgICAgICAgICAgICB2YXIgaGFzaGVyID0gdGhpcy5faGFzaGVyO1xuXG5cdCAgICAgICAgICAgIC8vIFJlc2V0XG5cdCAgICAgICAgICAgIGhhc2hlci5yZXNldCgpO1xuXHQgICAgICAgICAgICBoYXNoZXIudXBkYXRlKHRoaXMuX2lLZXkpO1xuXHQgICAgICAgIH0sXG5cblx0ICAgICAgICAvKipcblx0ICAgICAgICAgKiBVcGRhdGVzIHRoaXMgSE1BQyB3aXRoIGEgbWVzc2FnZS5cblx0ICAgICAgICAgKlxuXHQgICAgICAgICAqIEBwYXJhbSB7V29yZEFycmF5fHN0cmluZ30gbWVzc2FnZVVwZGF0ZSBUaGUgbWVzc2FnZSB0byBhcHBlbmQuXG5cdCAgICAgICAgICpcblx0ICAgICAgICAgKiBAcmV0dXJuIHtITUFDfSBUaGlzIEhNQUMgaW5zdGFuY2UuXG5cdCAgICAgICAgICpcblx0ICAgICAgICAgKiBAZXhhbXBsZVxuXHQgICAgICAgICAqXG5cdCAgICAgICAgICogICAgIGhtYWNIYXNoZXIudXBkYXRlKCdtZXNzYWdlJyk7XG5cdCAgICAgICAgICogICAgIGhtYWNIYXNoZXIudXBkYXRlKHdvcmRBcnJheSk7XG5cdCAgICAgICAgICovXG5cdCAgICAgICAgdXBkYXRlOiBmdW5jdGlvbiAobWVzc2FnZVVwZGF0ZSkge1xuXHQgICAgICAgICAgICB0aGlzLl9oYXNoZXIudXBkYXRlKG1lc3NhZ2VVcGRhdGUpO1xuXG5cdCAgICAgICAgICAgIC8vIENoYWluYWJsZVxuXHQgICAgICAgICAgICByZXR1cm4gdGhpcztcblx0ICAgICAgICB9LFxuXG5cdCAgICAgICAgLyoqXG5cdCAgICAgICAgICogRmluYWxpemVzIHRoZSBITUFDIGNvbXB1dGF0aW9uLlxuXHQgICAgICAgICAqIE5vdGUgdGhhdCB0aGUgZmluYWxpemUgb3BlcmF0aW9uIGlzIGVmZmVjdGl2ZWx5IGEgZGVzdHJ1Y3RpdmUsIHJlYWQtb25jZSBvcGVyYXRpb24uXG5cdCAgICAgICAgICpcblx0ICAgICAgICAgKiBAcGFyYW0ge1dvcmRBcnJheXxzdHJpbmd9IG1lc3NhZ2VVcGRhdGUgKE9wdGlvbmFsKSBBIGZpbmFsIG1lc3NhZ2UgdXBkYXRlLlxuXHQgICAgICAgICAqXG5cdCAgICAgICAgICogQHJldHVybiB7V29yZEFycmF5fSBUaGUgSE1BQy5cblx0ICAgICAgICAgKlxuXHQgICAgICAgICAqIEBleGFtcGxlXG5cdCAgICAgICAgICpcblx0ICAgICAgICAgKiAgICAgdmFyIGhtYWMgPSBobWFjSGFzaGVyLmZpbmFsaXplKCk7XG5cdCAgICAgICAgICogICAgIHZhciBobWFjID0gaG1hY0hhc2hlci5maW5hbGl6ZSgnbWVzc2FnZScpO1xuXHQgICAgICAgICAqICAgICB2YXIgaG1hYyA9IGhtYWNIYXNoZXIuZmluYWxpemUod29yZEFycmF5KTtcblx0ICAgICAgICAgKi9cblx0ICAgICAgICBmaW5hbGl6ZTogZnVuY3Rpb24gKG1lc3NhZ2VVcGRhdGUpIHtcblx0ICAgICAgICAgICAgLy8gU2hvcnRjdXRcblx0ICAgICAgICAgICAgdmFyIGhhc2hlciA9IHRoaXMuX2hhc2hlcjtcblxuXHQgICAgICAgICAgICAvLyBDb21wdXRlIEhNQUNcblx0ICAgICAgICAgICAgdmFyIGlubmVySGFzaCA9IGhhc2hlci5maW5hbGl6ZShtZXNzYWdlVXBkYXRlKTtcblx0ICAgICAgICAgICAgaGFzaGVyLnJlc2V0KCk7XG5cdCAgICAgICAgICAgIHZhciBobWFjID0gaGFzaGVyLmZpbmFsaXplKHRoaXMuX29LZXkuY2xvbmUoKS5jb25jYXQoaW5uZXJIYXNoKSk7XG5cblx0ICAgICAgICAgICAgcmV0dXJuIGhtYWM7XG5cdCAgICAgICAgfVxuXHQgICAgfSk7XG5cdH0oKSk7XG5cblxufSkpOyIsIjsoZnVuY3Rpb24gKHJvb3QsIGZhY3RvcnkpIHtcblx0aWYgKHR5cGVvZiBleHBvcnRzID09PSBcIm9iamVjdFwiKSB7XG5cdFx0Ly8gQ29tbW9uSlNcblx0XHRtb2R1bGUuZXhwb3J0cyA9IGV4cG9ydHMgPSBmYWN0b3J5KHJlcXVpcmUoXCIuL2NvcmVcIikpO1xuXHR9XG5cdGVsc2UgaWYgKHR5cGVvZiBkZWZpbmUgPT09IFwiZnVuY3Rpb25cIiAmJiBkZWZpbmUuYW1kKSB7XG5cdFx0Ly8gQU1EXG5cdFx0ZGVmaW5lKFtcIi4vY29yZVwiXSwgZmFjdG9yeSk7XG5cdH1cblx0ZWxzZSB7XG5cdFx0Ly8gR2xvYmFsIChicm93c2VyKVxuXHRcdGZhY3Rvcnkocm9vdC5DcnlwdG9KUyk7XG5cdH1cbn0odGhpcywgZnVuY3Rpb24gKENyeXB0b0pTKSB7XG5cblx0KGZ1bmN0aW9uIChNYXRoKSB7XG5cdCAgICAvLyBTaG9ydGN1dHNcblx0ICAgIHZhciBDID0gQ3J5cHRvSlM7XG5cdCAgICB2YXIgQ19saWIgPSBDLmxpYjtcblx0ICAgIHZhciBXb3JkQXJyYXkgPSBDX2xpYi5Xb3JkQXJyYXk7XG5cdCAgICB2YXIgSGFzaGVyID0gQ19saWIuSGFzaGVyO1xuXHQgICAgdmFyIENfYWxnbyA9IEMuYWxnbztcblxuXHQgICAgLy8gSW5pdGlhbGl6YXRpb24gYW5kIHJvdW5kIGNvbnN0YW50cyB0YWJsZXNcblx0ICAgIHZhciBIID0gW107XG5cdCAgICB2YXIgSyA9IFtdO1xuXG5cdCAgICAvLyBDb21wdXRlIGNvbnN0YW50c1xuXHQgICAgKGZ1bmN0aW9uICgpIHtcblx0ICAgICAgICBmdW5jdGlvbiBpc1ByaW1lKG4pIHtcblx0ICAgICAgICAgICAgdmFyIHNxcnROID0gTWF0aC5zcXJ0KG4pO1xuXHQgICAgICAgICAgICBmb3IgKHZhciBmYWN0b3IgPSAyOyBmYWN0b3IgPD0gc3FydE47IGZhY3RvcisrKSB7XG5cdCAgICAgICAgICAgICAgICBpZiAoIShuICUgZmFjdG9yKSkge1xuXHQgICAgICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcblx0ICAgICAgICAgICAgICAgIH1cblx0ICAgICAgICAgICAgfVxuXG5cdCAgICAgICAgICAgIHJldHVybiB0cnVlO1xuXHQgICAgICAgIH1cblxuXHQgICAgICAgIGZ1bmN0aW9uIGdldEZyYWN0aW9uYWxCaXRzKG4pIHtcblx0ICAgICAgICAgICAgcmV0dXJuICgobiAtIChuIHwgMCkpICogMHgxMDAwMDAwMDApIHwgMDtcblx0ICAgICAgICB9XG5cblx0ICAgICAgICB2YXIgbiA9IDI7XG5cdCAgICAgICAgdmFyIG5QcmltZSA9IDA7XG5cdCAgICAgICAgd2hpbGUgKG5QcmltZSA8IDY0KSB7XG5cdCAgICAgICAgICAgIGlmIChpc1ByaW1lKG4pKSB7XG5cdCAgICAgICAgICAgICAgICBpZiAoblByaW1lIDwgOCkge1xuXHQgICAgICAgICAgICAgICAgICAgIEhbblByaW1lXSA9IGdldEZyYWN0aW9uYWxCaXRzKE1hdGgucG93KG4sIDEgLyAyKSk7XG5cdCAgICAgICAgICAgICAgICB9XG5cdCAgICAgICAgICAgICAgICBLW25QcmltZV0gPSBnZXRGcmFjdGlvbmFsQml0cyhNYXRoLnBvdyhuLCAxIC8gMykpO1xuXG5cdCAgICAgICAgICAgICAgICBuUHJpbWUrKztcblx0ICAgICAgICAgICAgfVxuXG5cdCAgICAgICAgICAgIG4rKztcblx0ICAgICAgICB9XG5cdCAgICB9KCkpO1xuXG5cdCAgICAvLyBSZXVzYWJsZSBvYmplY3Rcblx0ICAgIHZhciBXID0gW107XG5cblx0ICAgIC8qKlxuXHQgICAgICogU0hBLTI1NiBoYXNoIGFsZ29yaXRobS5cblx0ICAgICAqL1xuXHQgICAgdmFyIFNIQTI1NiA9IENfYWxnby5TSEEyNTYgPSBIYXNoZXIuZXh0ZW5kKHtcblx0ICAgICAgICBfZG9SZXNldDogZnVuY3Rpb24gKCkge1xuXHQgICAgICAgICAgICB0aGlzLl9oYXNoID0gbmV3IFdvcmRBcnJheS5pbml0KEguc2xpY2UoMCkpO1xuXHQgICAgICAgIH0sXG5cblx0ICAgICAgICBfZG9Qcm9jZXNzQmxvY2s6IGZ1bmN0aW9uIChNLCBvZmZzZXQpIHtcblx0ICAgICAgICAgICAgLy8gU2hvcnRjdXRcblx0ICAgICAgICAgICAgdmFyIEggPSB0aGlzLl9oYXNoLndvcmRzO1xuXG5cdCAgICAgICAgICAgIC8vIFdvcmtpbmcgdmFyaWFibGVzXG5cdCAgICAgICAgICAgIHZhciBhID0gSFswXTtcblx0ICAgICAgICAgICAgdmFyIGIgPSBIWzFdO1xuXHQgICAgICAgICAgICB2YXIgYyA9IEhbMl07XG5cdCAgICAgICAgICAgIHZhciBkID0gSFszXTtcblx0ICAgICAgICAgICAgdmFyIGUgPSBIWzRdO1xuXHQgICAgICAgICAgICB2YXIgZiA9IEhbNV07XG5cdCAgICAgICAgICAgIHZhciBnID0gSFs2XTtcblx0ICAgICAgICAgICAgdmFyIGggPSBIWzddO1xuXG5cdCAgICAgICAgICAgIC8vIENvbXB1dGF0aW9uXG5cdCAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgNjQ7IGkrKykge1xuXHQgICAgICAgICAgICAgICAgaWYgKGkgPCAxNikge1xuXHQgICAgICAgICAgICAgICAgICAgIFdbaV0gPSBNW29mZnNldCArIGldIHwgMDtcblx0ICAgICAgICAgICAgICAgIH0gZWxzZSB7XG5cdCAgICAgICAgICAgICAgICAgICAgdmFyIGdhbW1hMHggPSBXW2kgLSAxNV07XG5cdCAgICAgICAgICAgICAgICAgICAgdmFyIGdhbW1hMCAgPSAoKGdhbW1hMHggPDwgMjUpIHwgKGdhbW1hMHggPj4+IDcpKSAgXlxuXHQgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKChnYW1tYTB4IDw8IDE0KSB8IChnYW1tYTB4ID4+PiAxOCkpIF5cblx0ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAoZ2FtbWEweCA+Pj4gMyk7XG5cblx0ICAgICAgICAgICAgICAgICAgICB2YXIgZ2FtbWExeCA9IFdbaSAtIDJdO1xuXHQgICAgICAgICAgICAgICAgICAgIHZhciBnYW1tYTEgID0gKChnYW1tYTF4IDw8IDE1KSB8IChnYW1tYTF4ID4+PiAxNykpIF5cblx0ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICgoZ2FtbWExeCA8PCAxMykgfCAoZ2FtbWExeCA+Pj4gMTkpKSBeXG5cdCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKGdhbW1hMXggPj4+IDEwKTtcblxuXHQgICAgICAgICAgICAgICAgICAgIFdbaV0gPSBnYW1tYTAgKyBXW2kgLSA3XSArIGdhbW1hMSArIFdbaSAtIDE2XTtcblx0ICAgICAgICAgICAgICAgIH1cblxuXHQgICAgICAgICAgICAgICAgdmFyIGNoICA9IChlICYgZikgXiAofmUgJiBnKTtcblx0ICAgICAgICAgICAgICAgIHZhciBtYWogPSAoYSAmIGIpIF4gKGEgJiBjKSBeIChiICYgYyk7XG5cblx0ICAgICAgICAgICAgICAgIHZhciBzaWdtYTAgPSAoKGEgPDwgMzApIHwgKGEgPj4+IDIpKSBeICgoYSA8PCAxOSkgfCAoYSA+Pj4gMTMpKSBeICgoYSA8PCAxMCkgfCAoYSA+Pj4gMjIpKTtcblx0ICAgICAgICAgICAgICAgIHZhciBzaWdtYTEgPSAoKGUgPDwgMjYpIHwgKGUgPj4+IDYpKSBeICgoZSA8PCAyMSkgfCAoZSA+Pj4gMTEpKSBeICgoZSA8PCA3KSAgfCAoZSA+Pj4gMjUpKTtcblxuXHQgICAgICAgICAgICAgICAgdmFyIHQxID0gaCArIHNpZ21hMSArIGNoICsgS1tpXSArIFdbaV07XG5cdCAgICAgICAgICAgICAgICB2YXIgdDIgPSBzaWdtYTAgKyBtYWo7XG5cblx0ICAgICAgICAgICAgICAgIGggPSBnO1xuXHQgICAgICAgICAgICAgICAgZyA9IGY7XG5cdCAgICAgICAgICAgICAgICBmID0gZTtcblx0ICAgICAgICAgICAgICAgIGUgPSAoZCArIHQxKSB8IDA7XG5cdCAgICAgICAgICAgICAgICBkID0gYztcblx0ICAgICAgICAgICAgICAgIGMgPSBiO1xuXHQgICAgICAgICAgICAgICAgYiA9IGE7XG5cdCAgICAgICAgICAgICAgICBhID0gKHQxICsgdDIpIHwgMDtcblx0ICAgICAgICAgICAgfVxuXG5cdCAgICAgICAgICAgIC8vIEludGVybWVkaWF0ZSBoYXNoIHZhbHVlXG5cdCAgICAgICAgICAgIEhbMF0gPSAoSFswXSArIGEpIHwgMDtcblx0ICAgICAgICAgICAgSFsxXSA9IChIWzFdICsgYikgfCAwO1xuXHQgICAgICAgICAgICBIWzJdID0gKEhbMl0gKyBjKSB8IDA7XG5cdCAgICAgICAgICAgIEhbM10gPSAoSFszXSArIGQpIHwgMDtcblx0ICAgICAgICAgICAgSFs0XSA9IChIWzRdICsgZSkgfCAwO1xuXHQgICAgICAgICAgICBIWzVdID0gKEhbNV0gKyBmKSB8IDA7XG5cdCAgICAgICAgICAgIEhbNl0gPSAoSFs2XSArIGcpIHwgMDtcblx0ICAgICAgICAgICAgSFs3XSA9IChIWzddICsgaCkgfCAwO1xuXHQgICAgICAgIH0sXG5cblx0ICAgICAgICBfZG9GaW5hbGl6ZTogZnVuY3Rpb24gKCkge1xuXHQgICAgICAgICAgICAvLyBTaG9ydGN1dHNcblx0ICAgICAgICAgICAgdmFyIGRhdGEgPSB0aGlzLl9kYXRhO1xuXHQgICAgICAgICAgICB2YXIgZGF0YVdvcmRzID0gZGF0YS53b3JkcztcblxuXHQgICAgICAgICAgICB2YXIgbkJpdHNUb3RhbCA9IHRoaXMuX25EYXRhQnl0ZXMgKiA4O1xuXHQgICAgICAgICAgICB2YXIgbkJpdHNMZWZ0ID0gZGF0YS5zaWdCeXRlcyAqIDg7XG5cblx0ICAgICAgICAgICAgLy8gQWRkIHBhZGRpbmdcblx0ICAgICAgICAgICAgZGF0YVdvcmRzW25CaXRzTGVmdCA+Pj4gNV0gfD0gMHg4MCA8PCAoMjQgLSBuQml0c0xlZnQgJSAzMik7XG5cdCAgICAgICAgICAgIGRhdGFXb3Jkc1soKChuQml0c0xlZnQgKyA2NCkgPj4+IDkpIDw8IDQpICsgMTRdID0gTWF0aC5mbG9vcihuQml0c1RvdGFsIC8gMHgxMDAwMDAwMDApO1xuXHQgICAgICAgICAgICBkYXRhV29yZHNbKCgobkJpdHNMZWZ0ICsgNjQpID4+PiA5KSA8PCA0KSArIDE1XSA9IG5CaXRzVG90YWw7XG5cdCAgICAgICAgICAgIGRhdGEuc2lnQnl0ZXMgPSBkYXRhV29yZHMubGVuZ3RoICogNDtcblxuXHQgICAgICAgICAgICAvLyBIYXNoIGZpbmFsIGJsb2Nrc1xuXHQgICAgICAgICAgICB0aGlzLl9wcm9jZXNzKCk7XG5cblx0ICAgICAgICAgICAgLy8gUmV0dXJuIGZpbmFsIGNvbXB1dGVkIGhhc2hcblx0ICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2hhc2g7XG5cdCAgICAgICAgfSxcblxuXHQgICAgICAgIGNsb25lOiBmdW5jdGlvbiAoKSB7XG5cdCAgICAgICAgICAgIHZhciBjbG9uZSA9IEhhc2hlci5jbG9uZS5jYWxsKHRoaXMpO1xuXHQgICAgICAgICAgICBjbG9uZS5faGFzaCA9IHRoaXMuX2hhc2guY2xvbmUoKTtcblxuXHQgICAgICAgICAgICByZXR1cm4gY2xvbmU7XG5cdCAgICAgICAgfVxuXHQgICAgfSk7XG5cblx0ICAgIC8qKlxuXHQgICAgICogU2hvcnRjdXQgZnVuY3Rpb24gdG8gdGhlIGhhc2hlcidzIG9iamVjdCBpbnRlcmZhY2UuXG5cdCAgICAgKlxuXHQgICAgICogQHBhcmFtIHtXb3JkQXJyYXl8c3RyaW5nfSBtZXNzYWdlIFRoZSBtZXNzYWdlIHRvIGhhc2guXG5cdCAgICAgKlxuXHQgICAgICogQHJldHVybiB7V29yZEFycmF5fSBUaGUgaGFzaC5cblx0ICAgICAqXG5cdCAgICAgKiBAc3RhdGljXG5cdCAgICAgKlxuXHQgICAgICogQGV4YW1wbGVcblx0ICAgICAqXG5cdCAgICAgKiAgICAgdmFyIGhhc2ggPSBDcnlwdG9KUy5TSEEyNTYoJ21lc3NhZ2UnKTtcblx0ICAgICAqICAgICB2YXIgaGFzaCA9IENyeXB0b0pTLlNIQTI1Nih3b3JkQXJyYXkpO1xuXHQgICAgICovXG5cdCAgICBDLlNIQTI1NiA9IEhhc2hlci5fY3JlYXRlSGVscGVyKFNIQTI1Nik7XG5cblx0ICAgIC8qKlxuXHQgICAgICogU2hvcnRjdXQgZnVuY3Rpb24gdG8gdGhlIEhNQUMncyBvYmplY3QgaW50ZXJmYWNlLlxuXHQgICAgICpcblx0ICAgICAqIEBwYXJhbSB7V29yZEFycmF5fHN0cmluZ30gbWVzc2FnZSBUaGUgbWVzc2FnZSB0byBoYXNoLlxuXHQgICAgICogQHBhcmFtIHtXb3JkQXJyYXl8c3RyaW5nfSBrZXkgVGhlIHNlY3JldCBrZXkuXG5cdCAgICAgKlxuXHQgICAgICogQHJldHVybiB7V29yZEFycmF5fSBUaGUgSE1BQy5cblx0ICAgICAqXG5cdCAgICAgKiBAc3RhdGljXG5cdCAgICAgKlxuXHQgICAgICogQGV4YW1wbGVcblx0ICAgICAqXG5cdCAgICAgKiAgICAgdmFyIGhtYWMgPSBDcnlwdG9KUy5IbWFjU0hBMjU2KG1lc3NhZ2UsIGtleSk7XG5cdCAgICAgKi9cblx0ICAgIEMuSG1hY1NIQTI1NiA9IEhhc2hlci5fY3JlYXRlSG1hY0hlbHBlcihTSEEyNTYpO1xuXHR9KE1hdGgpKTtcblxuXG5cdHJldHVybiBDcnlwdG9KUy5TSEEyNTY7XG5cbn0pKTsiLCIoZnVuY3Rpb24gKGdsb2JhbCl7XG4vKiEgSlNPTiB2My4zLjEgfCBodHRwOi8vYmVzdGllanMuZ2l0aHViLmlvL2pzb24zIHwgQ29weXJpZ2h0IDIwMTItMjAxNCwgS2l0IENhbWJyaWRnZSB8IGh0dHA6Ly9raXQubWl0LWxpY2Vuc2Uub3JnICovXG47KGZ1bmN0aW9uICgpIHtcbiAgLy8gRGV0ZWN0IHRoZSBgZGVmaW5lYCBmdW5jdGlvbiBleHBvc2VkIGJ5IGFzeW5jaHJvbm91cyBtb2R1bGUgbG9hZGVycy4gVGhlXG4gIC8vIHN0cmljdCBgZGVmaW5lYCBjaGVjayBpcyBuZWNlc3NhcnkgZm9yIGNvbXBhdGliaWxpdHkgd2l0aCBgci5qc2AuXG4gIHZhciBpc0xvYWRlciA9IHR5cGVvZiBkZWZpbmUgPT09IFwiZnVuY3Rpb25cIiAmJiBkZWZpbmUuYW1kO1xuXG4gIC8vIEEgc2V0IG9mIHR5cGVzIHVzZWQgdG8gZGlzdGluZ3Vpc2ggb2JqZWN0cyBmcm9tIHByaW1pdGl2ZXMuXG4gIHZhciBvYmplY3RUeXBlcyA9IHtcbiAgICBcImZ1bmN0aW9uXCI6IHRydWUsXG4gICAgXCJvYmplY3RcIjogdHJ1ZVxuICB9O1xuXG4gIC8vIERldGVjdCB0aGUgYGV4cG9ydHNgIG9iamVjdCBleHBvc2VkIGJ5IENvbW1vbkpTIGltcGxlbWVudGF0aW9ucy5cbiAgdmFyIGZyZWVFeHBvcnRzID0gb2JqZWN0VHlwZXNbdHlwZW9mIGV4cG9ydHNdICYmIGV4cG9ydHMgJiYgIWV4cG9ydHMubm9kZVR5cGUgJiYgZXhwb3J0cztcblxuICAvLyBVc2UgdGhlIGBnbG9iYWxgIG9iamVjdCBleHBvc2VkIGJ5IE5vZGUgKGluY2x1ZGluZyBCcm93c2VyaWZ5IHZpYVxuICAvLyBgaW5zZXJ0LW1vZHVsZS1nbG9iYWxzYCksIE5hcndoYWwsIGFuZCBSaW5nbyBhcyB0aGUgZGVmYXVsdCBjb250ZXh0LFxuICAvLyBhbmQgdGhlIGB3aW5kb3dgIG9iamVjdCBpbiBicm93c2Vycy4gUmhpbm8gZXhwb3J0cyBhIGBnbG9iYWxgIGZ1bmN0aW9uXG4gIC8vIGluc3RlYWQuXG4gIHZhciByb290ID0gb2JqZWN0VHlwZXNbdHlwZW9mIHdpbmRvd10gJiYgd2luZG93IHx8IHRoaXMsXG4gICAgICBmcmVlR2xvYmFsID0gZnJlZUV4cG9ydHMgJiYgb2JqZWN0VHlwZXNbdHlwZW9mIG1vZHVsZV0gJiYgbW9kdWxlICYmICFtb2R1bGUubm9kZVR5cGUgJiYgdHlwZW9mIGdsb2JhbCA9PSBcIm9iamVjdFwiICYmIGdsb2JhbDtcblxuICBpZiAoZnJlZUdsb2JhbCAmJiAoZnJlZUdsb2JhbFtcImdsb2JhbFwiXSA9PT0gZnJlZUdsb2JhbCB8fCBmcmVlR2xvYmFsW1wid2luZG93XCJdID09PSBmcmVlR2xvYmFsIHx8IGZyZWVHbG9iYWxbXCJzZWxmXCJdID09PSBmcmVlR2xvYmFsKSkge1xuICAgIHJvb3QgPSBmcmVlR2xvYmFsO1xuICB9XG5cbiAgLy8gUHVibGljOiBJbml0aWFsaXplcyBKU09OIDMgdXNpbmcgdGhlIGdpdmVuIGBjb250ZXh0YCBvYmplY3QsIGF0dGFjaGluZyB0aGVcbiAgLy8gYHN0cmluZ2lmeWAgYW5kIGBwYXJzZWAgZnVuY3Rpb25zIHRvIHRoZSBzcGVjaWZpZWQgYGV4cG9ydHNgIG9iamVjdC5cbiAgZnVuY3Rpb24gcnVuSW5Db250ZXh0KGNvbnRleHQsIGV4cG9ydHMpIHtcbiAgICBjb250ZXh0IHx8IChjb250ZXh0ID0gcm9vdFtcIk9iamVjdFwiXSgpKTtcbiAgICBleHBvcnRzIHx8IChleHBvcnRzID0gcm9vdFtcIk9iamVjdFwiXSgpKTtcblxuICAgIC8vIE5hdGl2ZSBjb25zdHJ1Y3RvciBhbGlhc2VzLlxuICAgIHZhciBOdW1iZXIgPSBjb250ZXh0W1wiTnVtYmVyXCJdIHx8IHJvb3RbXCJOdW1iZXJcIl0sXG4gICAgICAgIFN0cmluZyA9IGNvbnRleHRbXCJTdHJpbmdcIl0gfHwgcm9vdFtcIlN0cmluZ1wiXSxcbiAgICAgICAgT2JqZWN0ID0gY29udGV4dFtcIk9iamVjdFwiXSB8fCByb290W1wiT2JqZWN0XCJdLFxuICAgICAgICBEYXRlID0gY29udGV4dFtcIkRhdGVcIl0gfHwgcm9vdFtcIkRhdGVcIl0sXG4gICAgICAgIFN5bnRheEVycm9yID0gY29udGV4dFtcIlN5bnRheEVycm9yXCJdIHx8IHJvb3RbXCJTeW50YXhFcnJvclwiXSxcbiAgICAgICAgVHlwZUVycm9yID0gY29udGV4dFtcIlR5cGVFcnJvclwiXSB8fCByb290W1wiVHlwZUVycm9yXCJdLFxuICAgICAgICBNYXRoID0gY29udGV4dFtcIk1hdGhcIl0gfHwgcm9vdFtcIk1hdGhcIl0sXG4gICAgICAgIG5hdGl2ZUpTT04gPSBjb250ZXh0W1wiSlNPTlwiXSB8fCByb290W1wiSlNPTlwiXTtcblxuICAgIC8vIERlbGVnYXRlIHRvIHRoZSBuYXRpdmUgYHN0cmluZ2lmeWAgYW5kIGBwYXJzZWAgaW1wbGVtZW50YXRpb25zLlxuICAgIGlmICh0eXBlb2YgbmF0aXZlSlNPTiA9PSBcIm9iamVjdFwiICYmIG5hdGl2ZUpTT04pIHtcbiAgICAgIGV4cG9ydHMuc3RyaW5naWZ5ID0gbmF0aXZlSlNPTi5zdHJpbmdpZnk7XG4gICAgICBleHBvcnRzLnBhcnNlID0gbmF0aXZlSlNPTi5wYXJzZTtcbiAgICB9XG5cbiAgICAvLyBDb252ZW5pZW5jZSBhbGlhc2VzLlxuICAgIHZhciBvYmplY3RQcm90byA9IE9iamVjdC5wcm90b3R5cGUsXG4gICAgICAgIGdldENsYXNzID0gb2JqZWN0UHJvdG8udG9TdHJpbmcsXG4gICAgICAgIGlzUHJvcGVydHksIGZvckVhY2gsIHVuZGVmO1xuXG4gICAgLy8gVGVzdCB0aGUgYERhdGUjZ2V0VVRDKmAgbWV0aG9kcy4gQmFzZWQgb24gd29yayBieSBAWWFmZmxlLlxuICAgIHZhciBpc0V4dGVuZGVkID0gbmV3IERhdGUoLTM1MDk4MjczMzQ1NzMyOTIpO1xuICAgIHRyeSB7XG4gICAgICAvLyBUaGUgYGdldFVUQ0Z1bGxZZWFyYCwgYE1vbnRoYCwgYW5kIGBEYXRlYCBtZXRob2RzIHJldHVybiBub25zZW5zaWNhbFxuICAgICAgLy8gcmVzdWx0cyBmb3IgY2VydGFpbiBkYXRlcyBpbiBPcGVyYSA+PSAxMC41My5cbiAgICAgIGlzRXh0ZW5kZWQgPSBpc0V4dGVuZGVkLmdldFVUQ0Z1bGxZZWFyKCkgPT0gLTEwOTI1MiAmJiBpc0V4dGVuZGVkLmdldFVUQ01vbnRoKCkgPT09IDAgJiYgaXNFeHRlbmRlZC5nZXRVVENEYXRlKCkgPT09IDEgJiZcbiAgICAgICAgLy8gU2FmYXJpIDwgMi4wLjIgc3RvcmVzIHRoZSBpbnRlcm5hbCBtaWxsaXNlY29uZCB0aW1lIHZhbHVlIGNvcnJlY3RseSxcbiAgICAgICAgLy8gYnV0IGNsaXBzIHRoZSB2YWx1ZXMgcmV0dXJuZWQgYnkgdGhlIGRhdGUgbWV0aG9kcyB0byB0aGUgcmFuZ2Ugb2ZcbiAgICAgICAgLy8gc2lnbmVkIDMyLWJpdCBpbnRlZ2VycyAoWy0yICoqIDMxLCAyICoqIDMxIC0gMV0pLlxuICAgICAgICBpc0V4dGVuZGVkLmdldFVUQ0hvdXJzKCkgPT0gMTAgJiYgaXNFeHRlbmRlZC5nZXRVVENNaW51dGVzKCkgPT0gMzcgJiYgaXNFeHRlbmRlZC5nZXRVVENTZWNvbmRzKCkgPT0gNiAmJiBpc0V4dGVuZGVkLmdldFVUQ01pbGxpc2Vjb25kcygpID09IDcwODtcbiAgICB9IGNhdGNoIChleGNlcHRpb24pIHt9XG5cbiAgICAvLyBJbnRlcm5hbDogRGV0ZXJtaW5lcyB3aGV0aGVyIHRoZSBuYXRpdmUgYEpTT04uc3RyaW5naWZ5YCBhbmQgYHBhcnNlYFxuICAgIC8vIGltcGxlbWVudGF0aW9ucyBhcmUgc3BlYy1jb21wbGlhbnQuIEJhc2VkIG9uIHdvcmsgYnkgS2VuIFNueWRlci5cbiAgICBmdW5jdGlvbiBoYXMobmFtZSkge1xuICAgICAgaWYgKGhhc1tuYW1lXSAhPT0gdW5kZWYpIHtcbiAgICAgICAgLy8gUmV0dXJuIGNhY2hlZCBmZWF0dXJlIHRlc3QgcmVzdWx0LlxuICAgICAgICByZXR1cm4gaGFzW25hbWVdO1xuICAgICAgfVxuICAgICAgdmFyIGlzU3VwcG9ydGVkO1xuICAgICAgaWYgKG5hbWUgPT0gXCJidWctc3RyaW5nLWNoYXItaW5kZXhcIikge1xuICAgICAgICAvLyBJRSA8PSA3IGRvZXNuJ3Qgc3VwcG9ydCBhY2Nlc3Npbmcgc3RyaW5nIGNoYXJhY3RlcnMgdXNpbmcgc3F1YXJlXG4gICAgICAgIC8vIGJyYWNrZXQgbm90YXRpb24uIElFIDggb25seSBzdXBwb3J0cyB0aGlzIGZvciBwcmltaXRpdmVzLlxuICAgICAgICBpc1N1cHBvcnRlZCA9IFwiYVwiWzBdICE9IFwiYVwiO1xuICAgICAgfSBlbHNlIGlmIChuYW1lID09IFwianNvblwiKSB7XG4gICAgICAgIC8vIEluZGljYXRlcyB3aGV0aGVyIGJvdGggYEpTT04uc3RyaW5naWZ5YCBhbmQgYEpTT04ucGFyc2VgIGFyZVxuICAgICAgICAvLyBzdXBwb3J0ZWQuXG4gICAgICAgIGlzU3VwcG9ydGVkID0gaGFzKFwianNvbi1zdHJpbmdpZnlcIikgJiYgaGFzKFwianNvbi1wYXJzZVwiKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHZhciB2YWx1ZSwgc2VyaWFsaXplZCA9ICd7XCJhXCI6WzEsdHJ1ZSxmYWxzZSxudWxsLFwiXFxcXHUwMDAwXFxcXGJcXFxcblxcXFxmXFxcXHJcXFxcdFwiXX0nO1xuICAgICAgICAvLyBUZXN0IGBKU09OLnN0cmluZ2lmeWAuXG4gICAgICAgIGlmIChuYW1lID09IFwianNvbi1zdHJpbmdpZnlcIikge1xuICAgICAgICAgIHZhciBzdHJpbmdpZnkgPSBleHBvcnRzLnN0cmluZ2lmeSwgc3RyaW5naWZ5U3VwcG9ydGVkID0gdHlwZW9mIHN0cmluZ2lmeSA9PSBcImZ1bmN0aW9uXCIgJiYgaXNFeHRlbmRlZDtcbiAgICAgICAgICBpZiAoc3RyaW5naWZ5U3VwcG9ydGVkKSB7XG4gICAgICAgICAgICAvLyBBIHRlc3QgZnVuY3Rpb24gb2JqZWN0IHdpdGggYSBjdXN0b20gYHRvSlNPTmAgbWV0aG9kLlxuICAgICAgICAgICAgKHZhbHVlID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICByZXR1cm4gMTtcbiAgICAgICAgICAgIH0pLnRvSlNPTiA9IHZhbHVlO1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgc3RyaW5naWZ5U3VwcG9ydGVkID1cbiAgICAgICAgICAgICAgICAvLyBGaXJlZm94IDMuMWIxIGFuZCBiMiBzZXJpYWxpemUgc3RyaW5nLCBudW1iZXIsIGFuZCBib29sZWFuXG4gICAgICAgICAgICAgICAgLy8gcHJpbWl0aXZlcyBhcyBvYmplY3QgbGl0ZXJhbHMuXG4gICAgICAgICAgICAgICAgc3RyaW5naWZ5KDApID09PSBcIjBcIiAmJlxuICAgICAgICAgICAgICAgIC8vIEZGIDMuMWIxLCBiMiwgYW5kIEpTT04gMiBzZXJpYWxpemUgd3JhcHBlZCBwcmltaXRpdmVzIGFzIG9iamVjdFxuICAgICAgICAgICAgICAgIC8vIGxpdGVyYWxzLlxuICAgICAgICAgICAgICAgIHN0cmluZ2lmeShuZXcgTnVtYmVyKCkpID09PSBcIjBcIiAmJlxuICAgICAgICAgICAgICAgIHN0cmluZ2lmeShuZXcgU3RyaW5nKCkpID09ICdcIlwiJyAmJlxuICAgICAgICAgICAgICAgIC8vIEZGIDMuMWIxLCAyIHRocm93IGFuIGVycm9yIGlmIHRoZSB2YWx1ZSBpcyBgbnVsbGAsIGB1bmRlZmluZWRgLCBvclxuICAgICAgICAgICAgICAgIC8vIGRvZXMgbm90IGRlZmluZSBhIGNhbm9uaWNhbCBKU09OIHJlcHJlc2VudGF0aW9uICh0aGlzIGFwcGxpZXMgdG9cbiAgICAgICAgICAgICAgICAvLyBvYmplY3RzIHdpdGggYHRvSlNPTmAgcHJvcGVydGllcyBhcyB3ZWxsLCAqdW5sZXNzKiB0aGV5IGFyZSBuZXN0ZWRcbiAgICAgICAgICAgICAgICAvLyB3aXRoaW4gYW4gb2JqZWN0IG9yIGFycmF5KS5cbiAgICAgICAgICAgICAgICBzdHJpbmdpZnkoZ2V0Q2xhc3MpID09PSB1bmRlZiAmJlxuICAgICAgICAgICAgICAgIC8vIElFIDggc2VyaWFsaXplcyBgdW5kZWZpbmVkYCBhcyBgXCJ1bmRlZmluZWRcImAuIFNhZmFyaSA8PSA1LjEuNyBhbmRcbiAgICAgICAgICAgICAgICAvLyBGRiAzLjFiMyBwYXNzIHRoaXMgdGVzdC5cbiAgICAgICAgICAgICAgICBzdHJpbmdpZnkodW5kZWYpID09PSB1bmRlZiAmJlxuICAgICAgICAgICAgICAgIC8vIFNhZmFyaSA8PSA1LjEuNyBhbmQgRkYgMy4xYjMgdGhyb3cgYEVycm9yYHMgYW5kIGBUeXBlRXJyb3JgcyxcbiAgICAgICAgICAgICAgICAvLyByZXNwZWN0aXZlbHksIGlmIHRoZSB2YWx1ZSBpcyBvbWl0dGVkIGVudGlyZWx5LlxuICAgICAgICAgICAgICAgIHN0cmluZ2lmeSgpID09PSB1bmRlZiAmJlxuICAgICAgICAgICAgICAgIC8vIEZGIDMuMWIxLCAyIHRocm93IGFuIGVycm9yIGlmIHRoZSBnaXZlbiB2YWx1ZSBpcyBub3QgYSBudW1iZXIsXG4gICAgICAgICAgICAgICAgLy8gc3RyaW5nLCBhcnJheSwgb2JqZWN0LCBCb29sZWFuLCBvciBgbnVsbGAgbGl0ZXJhbC4gVGhpcyBhcHBsaWVzIHRvXG4gICAgICAgICAgICAgICAgLy8gb2JqZWN0cyB3aXRoIGN1c3RvbSBgdG9KU09OYCBtZXRob2RzIGFzIHdlbGwsIHVubGVzcyB0aGV5IGFyZSBuZXN0ZWRcbiAgICAgICAgICAgICAgICAvLyBpbnNpZGUgb2JqZWN0IG9yIGFycmF5IGxpdGVyYWxzLiBZVUkgMy4wLjBiMSBpZ25vcmVzIGN1c3RvbSBgdG9KU09OYFxuICAgICAgICAgICAgICAgIC8vIG1ldGhvZHMgZW50aXJlbHkuXG4gICAgICAgICAgICAgICAgc3RyaW5naWZ5KHZhbHVlKSA9PT0gXCIxXCIgJiZcbiAgICAgICAgICAgICAgICBzdHJpbmdpZnkoW3ZhbHVlXSkgPT0gXCJbMV1cIiAmJlxuICAgICAgICAgICAgICAgIC8vIFByb3RvdHlwZSA8PSAxLjYuMSBzZXJpYWxpemVzIGBbdW5kZWZpbmVkXWAgYXMgYFwiW11cImAgaW5zdGVhZCBvZlxuICAgICAgICAgICAgICAgIC8vIGBcIltudWxsXVwiYC5cbiAgICAgICAgICAgICAgICBzdHJpbmdpZnkoW3VuZGVmXSkgPT0gXCJbbnVsbF1cIiAmJlxuICAgICAgICAgICAgICAgIC8vIFlVSSAzLjAuMGIxIGZhaWxzIHRvIHNlcmlhbGl6ZSBgbnVsbGAgbGl0ZXJhbHMuXG4gICAgICAgICAgICAgICAgc3RyaW5naWZ5KG51bGwpID09IFwibnVsbFwiICYmXG4gICAgICAgICAgICAgICAgLy8gRkYgMy4xYjEsIDIgaGFsdHMgc2VyaWFsaXphdGlvbiBpZiBhbiBhcnJheSBjb250YWlucyBhIGZ1bmN0aW9uOlxuICAgICAgICAgICAgICAgIC8vIGBbMSwgdHJ1ZSwgZ2V0Q2xhc3MsIDFdYCBzZXJpYWxpemVzIGFzIFwiWzEsdHJ1ZSxdLFwiLiBGRiAzLjFiM1xuICAgICAgICAgICAgICAgIC8vIGVsaWRlcyBub24tSlNPTiB2YWx1ZXMgZnJvbSBvYmplY3RzIGFuZCBhcnJheXMsIHVubGVzcyB0aGV5XG4gICAgICAgICAgICAgICAgLy8gZGVmaW5lIGN1c3RvbSBgdG9KU09OYCBtZXRob2RzLlxuICAgICAgICAgICAgICAgIHN0cmluZ2lmeShbdW5kZWYsIGdldENsYXNzLCBudWxsXSkgPT0gXCJbbnVsbCxudWxsLG51bGxdXCIgJiZcbiAgICAgICAgICAgICAgICAvLyBTaW1wbGUgc2VyaWFsaXphdGlvbiB0ZXN0LiBGRiAzLjFiMSB1c2VzIFVuaWNvZGUgZXNjYXBlIHNlcXVlbmNlc1xuICAgICAgICAgICAgICAgIC8vIHdoZXJlIGNoYXJhY3RlciBlc2NhcGUgY29kZXMgYXJlIGV4cGVjdGVkIChlLmcuLCBgXFxiYCA9PiBgXFx1MDAwOGApLlxuICAgICAgICAgICAgICAgIHN0cmluZ2lmeSh7IFwiYVwiOiBbdmFsdWUsIHRydWUsIGZhbHNlLCBudWxsLCBcIlxceDAwXFxiXFxuXFxmXFxyXFx0XCJdIH0pID09IHNlcmlhbGl6ZWQgJiZcbiAgICAgICAgICAgICAgICAvLyBGRiAzLjFiMSBhbmQgYjIgaWdub3JlIHRoZSBgZmlsdGVyYCBhbmQgYHdpZHRoYCBhcmd1bWVudHMuXG4gICAgICAgICAgICAgICAgc3RyaW5naWZ5KG51bGwsIHZhbHVlKSA9PT0gXCIxXCIgJiZcbiAgICAgICAgICAgICAgICBzdHJpbmdpZnkoWzEsIDJdLCBudWxsLCAxKSA9PSBcIltcXG4gMSxcXG4gMlxcbl1cIiAmJlxuICAgICAgICAgICAgICAgIC8vIEpTT04gMiwgUHJvdG90eXBlIDw9IDEuNywgYW5kIG9sZGVyIFdlYktpdCBidWlsZHMgaW5jb3JyZWN0bHlcbiAgICAgICAgICAgICAgICAvLyBzZXJpYWxpemUgZXh0ZW5kZWQgeWVhcnMuXG4gICAgICAgICAgICAgICAgc3RyaW5naWZ5KG5ldyBEYXRlKC04LjY0ZTE1KSkgPT0gJ1wiLTI3MTgyMS0wNC0yMFQwMDowMDowMC4wMDBaXCInICYmXG4gICAgICAgICAgICAgICAgLy8gVGhlIG1pbGxpc2Vjb25kcyBhcmUgb3B0aW9uYWwgaW4gRVMgNSwgYnV0IHJlcXVpcmVkIGluIDUuMS5cbiAgICAgICAgICAgICAgICBzdHJpbmdpZnkobmV3IERhdGUoOC42NGUxNSkpID09ICdcIisyNzU3NjAtMDktMTNUMDA6MDA6MDAuMDAwWlwiJyAmJlxuICAgICAgICAgICAgICAgIC8vIEZpcmVmb3ggPD0gMTEuMCBpbmNvcnJlY3RseSBzZXJpYWxpemVzIHllYXJzIHByaW9yIHRvIDAgYXMgbmVnYXRpdmVcbiAgICAgICAgICAgICAgICAvLyBmb3VyLWRpZ2l0IHllYXJzIGluc3RlYWQgb2Ygc2l4LWRpZ2l0IHllYXJzLiBDcmVkaXRzOiBAWWFmZmxlLlxuICAgICAgICAgICAgICAgIHN0cmluZ2lmeShuZXcgRGF0ZSgtNjIxOTg3NTUyZTUpKSA9PSAnXCItMDAwMDAxLTAxLTAxVDAwOjAwOjAwLjAwMFpcIicgJiZcbiAgICAgICAgICAgICAgICAvLyBTYWZhcmkgPD0gNS4xLjUgYW5kIE9wZXJhID49IDEwLjUzIGluY29ycmVjdGx5IHNlcmlhbGl6ZSBtaWxsaXNlY29uZFxuICAgICAgICAgICAgICAgIC8vIHZhbHVlcyBsZXNzIHRoYW4gMTAwMC4gQ3JlZGl0czogQFlhZmZsZS5cbiAgICAgICAgICAgICAgICBzdHJpbmdpZnkobmV3IERhdGUoLTEpKSA9PSAnXCIxOTY5LTEyLTMxVDIzOjU5OjU5Ljk5OVpcIic7XG4gICAgICAgICAgICB9IGNhdGNoIChleGNlcHRpb24pIHtcbiAgICAgICAgICAgICAgc3RyaW5naWZ5U3VwcG9ydGVkID0gZmFsc2U7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIGlzU3VwcG9ydGVkID0gc3RyaW5naWZ5U3VwcG9ydGVkO1xuICAgICAgICB9XG4gICAgICAgIC8vIFRlc3QgYEpTT04ucGFyc2VgLlxuICAgICAgICBpZiAobmFtZSA9PSBcImpzb24tcGFyc2VcIikge1xuICAgICAgICAgIHZhciBwYXJzZSA9IGV4cG9ydHMucGFyc2U7XG4gICAgICAgICAgaWYgKHR5cGVvZiBwYXJzZSA9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgIC8vIEZGIDMuMWIxLCBiMiB3aWxsIHRocm93IGFuIGV4Y2VwdGlvbiBpZiBhIGJhcmUgbGl0ZXJhbCBpcyBwcm92aWRlZC5cbiAgICAgICAgICAgICAgLy8gQ29uZm9ybWluZyBpbXBsZW1lbnRhdGlvbnMgc2hvdWxkIGFsc28gY29lcmNlIHRoZSBpbml0aWFsIGFyZ3VtZW50IHRvXG4gICAgICAgICAgICAgIC8vIGEgc3RyaW5nIHByaW9yIHRvIHBhcnNpbmcuXG4gICAgICAgICAgICAgIGlmIChwYXJzZShcIjBcIikgPT09IDAgJiYgIXBhcnNlKGZhbHNlKSkge1xuICAgICAgICAgICAgICAgIC8vIFNpbXBsZSBwYXJzaW5nIHRlc3QuXG4gICAgICAgICAgICAgICAgdmFsdWUgPSBwYXJzZShzZXJpYWxpemVkKTtcbiAgICAgICAgICAgICAgICB2YXIgcGFyc2VTdXBwb3J0ZWQgPSB2YWx1ZVtcImFcIl0ubGVuZ3RoID09IDUgJiYgdmFsdWVbXCJhXCJdWzBdID09PSAxO1xuICAgICAgICAgICAgICAgIGlmIChwYXJzZVN1cHBvcnRlZCkge1xuICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgLy8gU2FmYXJpIDw9IDUuMS4yIGFuZCBGRiAzLjFiMSBhbGxvdyB1bmVzY2FwZWQgdGFicyBpbiBzdHJpbmdzLlxuICAgICAgICAgICAgICAgICAgICBwYXJzZVN1cHBvcnRlZCA9ICFwYXJzZSgnXCJcXHRcIicpO1xuICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXhjZXB0aW9uKSB7fVxuICAgICAgICAgICAgICAgICAgaWYgKHBhcnNlU3VwcG9ydGVkKSB7XG4gICAgICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgICAgLy8gRkYgNC4wIGFuZCA0LjAuMSBhbGxvdyBsZWFkaW5nIGArYCBzaWducyBhbmQgbGVhZGluZ1xuICAgICAgICAgICAgICAgICAgICAgIC8vIGRlY2ltYWwgcG9pbnRzLiBGRiA0LjAsIDQuMC4xLCBhbmQgSUUgOS0xMCBhbHNvIGFsbG93XG4gICAgICAgICAgICAgICAgICAgICAgLy8gY2VydGFpbiBvY3RhbCBsaXRlcmFscy5cbiAgICAgICAgICAgICAgICAgICAgICBwYXJzZVN1cHBvcnRlZCA9IHBhcnNlKFwiMDFcIikgIT09IDE7XG4gICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGV4Y2VwdGlvbikge31cbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIGlmIChwYXJzZVN1cHBvcnRlZCkge1xuICAgICAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICAgIC8vIEZGIDQuMCwgNC4wLjEsIGFuZCBSaGlubyAxLjdSMy1SNCBhbGxvdyB0cmFpbGluZyBkZWNpbWFsXG4gICAgICAgICAgICAgICAgICAgICAgLy8gcG9pbnRzLiBUaGVzZSBlbnZpcm9ubWVudHMsIGFsb25nIHdpdGggRkYgMy4xYjEgYW5kIDIsXG4gICAgICAgICAgICAgICAgICAgICAgLy8gYWxzbyBhbGxvdyB0cmFpbGluZyBjb21tYXMgaW4gSlNPTiBvYmplY3RzIGFuZCBhcnJheXMuXG4gICAgICAgICAgICAgICAgICAgICAgcGFyc2VTdXBwb3J0ZWQgPSBwYXJzZShcIjEuXCIpICE9PSAxO1xuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChleGNlcHRpb24pIHt9XG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGNhdGNoIChleGNlcHRpb24pIHtcbiAgICAgICAgICAgICAgcGFyc2VTdXBwb3J0ZWQgPSBmYWxzZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgaXNTdXBwb3J0ZWQgPSBwYXJzZVN1cHBvcnRlZDtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuIGhhc1tuYW1lXSA9ICEhaXNTdXBwb3J0ZWQ7XG4gICAgfVxuXG4gICAgaWYgKCFoYXMoXCJqc29uXCIpKSB7XG4gICAgICAvLyBDb21tb24gYFtbQ2xhc3NdXWAgbmFtZSBhbGlhc2VzLlxuICAgICAgdmFyIGZ1bmN0aW9uQ2xhc3MgPSBcIltvYmplY3QgRnVuY3Rpb25dXCIsXG4gICAgICAgICAgZGF0ZUNsYXNzID0gXCJbb2JqZWN0IERhdGVdXCIsXG4gICAgICAgICAgbnVtYmVyQ2xhc3MgPSBcIltvYmplY3QgTnVtYmVyXVwiLFxuICAgICAgICAgIHN0cmluZ0NsYXNzID0gXCJbb2JqZWN0IFN0cmluZ11cIixcbiAgICAgICAgICBhcnJheUNsYXNzID0gXCJbb2JqZWN0IEFycmF5XVwiLFxuICAgICAgICAgIGJvb2xlYW5DbGFzcyA9IFwiW29iamVjdCBCb29sZWFuXVwiO1xuXG4gICAgICAvLyBEZXRlY3QgaW5jb21wbGV0ZSBzdXBwb3J0IGZvciBhY2Nlc3Npbmcgc3RyaW5nIGNoYXJhY3RlcnMgYnkgaW5kZXguXG4gICAgICB2YXIgY2hhckluZGV4QnVnZ3kgPSBoYXMoXCJidWctc3RyaW5nLWNoYXItaW5kZXhcIik7XG5cbiAgICAgIC8vIERlZmluZSBhZGRpdGlvbmFsIHV0aWxpdHkgbWV0aG9kcyBpZiB0aGUgYERhdGVgIG1ldGhvZHMgYXJlIGJ1Z2d5LlxuICAgICAgaWYgKCFpc0V4dGVuZGVkKSB7XG4gICAgICAgIHZhciBmbG9vciA9IE1hdGguZmxvb3I7XG4gICAgICAgIC8vIEEgbWFwcGluZyBiZXR3ZWVuIHRoZSBtb250aHMgb2YgdGhlIHllYXIgYW5kIHRoZSBudW1iZXIgb2YgZGF5cyBiZXR3ZWVuXG4gICAgICAgIC8vIEphbnVhcnkgMXN0IGFuZCB0aGUgZmlyc3Qgb2YgdGhlIHJlc3BlY3RpdmUgbW9udGguXG4gICAgICAgIHZhciBNb250aHMgPSBbMCwgMzEsIDU5LCA5MCwgMTIwLCAxNTEsIDE4MSwgMjEyLCAyNDMsIDI3MywgMzA0LCAzMzRdO1xuICAgICAgICAvLyBJbnRlcm5hbDogQ2FsY3VsYXRlcyB0aGUgbnVtYmVyIG9mIGRheXMgYmV0d2VlbiB0aGUgVW5peCBlcG9jaCBhbmQgdGhlXG4gICAgICAgIC8vIGZpcnN0IGRheSBvZiB0aGUgZ2l2ZW4gbW9udGguXG4gICAgICAgIHZhciBnZXREYXkgPSBmdW5jdGlvbiAoeWVhciwgbW9udGgpIHtcbiAgICAgICAgICByZXR1cm4gTW9udGhzW21vbnRoXSArIDM2NSAqICh5ZWFyIC0gMTk3MCkgKyBmbG9vcigoeWVhciAtIDE5NjkgKyAobW9udGggPSArKG1vbnRoID4gMSkpKSAvIDQpIC0gZmxvb3IoKHllYXIgLSAxOTAxICsgbW9udGgpIC8gMTAwKSArIGZsb29yKCh5ZWFyIC0gMTYwMSArIG1vbnRoKSAvIDQwMCk7XG4gICAgICAgIH07XG4gICAgICB9XG5cbiAgICAgIC8vIEludGVybmFsOiBEZXRlcm1pbmVzIGlmIGEgcHJvcGVydHkgaXMgYSBkaXJlY3QgcHJvcGVydHkgb2YgdGhlIGdpdmVuXG4gICAgICAvLyBvYmplY3QuIERlbGVnYXRlcyB0byB0aGUgbmF0aXZlIGBPYmplY3QjaGFzT3duUHJvcGVydHlgIG1ldGhvZC5cbiAgICAgIGlmICghKGlzUHJvcGVydHkgPSBvYmplY3RQcm90by5oYXNPd25Qcm9wZXJ0eSkpIHtcbiAgICAgICAgaXNQcm9wZXJ0eSA9IGZ1bmN0aW9uIChwcm9wZXJ0eSkge1xuICAgICAgICAgIHZhciBtZW1iZXJzID0ge30sIGNvbnN0cnVjdG9yO1xuICAgICAgICAgIGlmICgobWVtYmVycy5fX3Byb3RvX18gPSBudWxsLCBtZW1iZXJzLl9fcHJvdG9fXyA9IHtcbiAgICAgICAgICAgIC8vIFRoZSAqcHJvdG8qIHByb3BlcnR5IGNhbm5vdCBiZSBzZXQgbXVsdGlwbGUgdGltZXMgaW4gcmVjZW50XG4gICAgICAgICAgICAvLyB2ZXJzaW9ucyBvZiBGaXJlZm94IGFuZCBTZWFNb25rZXkuXG4gICAgICAgICAgICBcInRvU3RyaW5nXCI6IDFcbiAgICAgICAgICB9LCBtZW1iZXJzKS50b1N0cmluZyAhPSBnZXRDbGFzcykge1xuICAgICAgICAgICAgLy8gU2FmYXJpIDw9IDIuMC4zIGRvZXNuJ3QgaW1wbGVtZW50IGBPYmplY3QjaGFzT3duUHJvcGVydHlgLCBidXRcbiAgICAgICAgICAgIC8vIHN1cHBvcnRzIHRoZSBtdXRhYmxlICpwcm90byogcHJvcGVydHkuXG4gICAgICAgICAgICBpc1Byb3BlcnR5ID0gZnVuY3Rpb24gKHByb3BlcnR5KSB7XG4gICAgICAgICAgICAgIC8vIENhcHR1cmUgYW5kIGJyZWFrIHRoZSBvYmplY3RncyBwcm90b3R5cGUgY2hhaW4gKHNlZSBzZWN0aW9uIDguNi4yXG4gICAgICAgICAgICAgIC8vIG9mIHRoZSBFUyA1LjEgc3BlYykuIFRoZSBwYXJlbnRoZXNpemVkIGV4cHJlc3Npb24gcHJldmVudHMgYW5cbiAgICAgICAgICAgICAgLy8gdW5zYWZlIHRyYW5zZm9ybWF0aW9uIGJ5IHRoZSBDbG9zdXJlIENvbXBpbGVyLlxuICAgICAgICAgICAgICB2YXIgb3JpZ2luYWwgPSB0aGlzLl9fcHJvdG9fXywgcmVzdWx0ID0gcHJvcGVydHkgaW4gKHRoaXMuX19wcm90b19fID0gbnVsbCwgdGhpcyk7XG4gICAgICAgICAgICAgIC8vIFJlc3RvcmUgdGhlIG9yaWdpbmFsIHByb3RvdHlwZSBjaGFpbi5cbiAgICAgICAgICAgICAgdGhpcy5fX3Byb3RvX18gPSBvcmlnaW5hbDtcbiAgICAgICAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIENhcHR1cmUgYSByZWZlcmVuY2UgdG8gdGhlIHRvcC1sZXZlbCBgT2JqZWN0YCBjb25zdHJ1Y3Rvci5cbiAgICAgICAgICAgIGNvbnN0cnVjdG9yID0gbWVtYmVycy5jb25zdHJ1Y3RvcjtcbiAgICAgICAgICAgIC8vIFVzZSB0aGUgYGNvbnN0cnVjdG9yYCBwcm9wZXJ0eSB0byBzaW11bGF0ZSBgT2JqZWN0I2hhc093blByb3BlcnR5YCBpblxuICAgICAgICAgICAgLy8gb3RoZXIgZW52aXJvbm1lbnRzLlxuICAgICAgICAgICAgaXNQcm9wZXJ0eSA9IGZ1bmN0aW9uIChwcm9wZXJ0eSkge1xuICAgICAgICAgICAgICB2YXIgcGFyZW50ID0gKHRoaXMuY29uc3RydWN0b3IgfHwgY29uc3RydWN0b3IpLnByb3RvdHlwZTtcbiAgICAgICAgICAgICAgcmV0dXJuIHByb3BlcnR5IGluIHRoaXMgJiYgIShwcm9wZXJ0eSBpbiBwYXJlbnQgJiYgdGhpc1twcm9wZXJ0eV0gPT09IHBhcmVudFtwcm9wZXJ0eV0pO1xuICAgICAgICAgICAgfTtcbiAgICAgICAgICB9XG4gICAgICAgICAgbWVtYmVycyA9IG51bGw7XG4gICAgICAgICAgcmV0dXJuIGlzUHJvcGVydHkuY2FsbCh0aGlzLCBwcm9wZXJ0eSk7XG4gICAgICAgIH07XG4gICAgICB9XG5cbiAgICAgIC8vIEludGVybmFsOiBOb3JtYWxpemVzIHRoZSBgZm9yLi4uaW5gIGl0ZXJhdGlvbiBhbGdvcml0aG0gYWNyb3NzXG4gICAgICAvLyBlbnZpcm9ubWVudHMuIEVhY2ggZW51bWVyYXRlZCBrZXkgaXMgeWllbGRlZCB0byBhIGBjYWxsYmFja2AgZnVuY3Rpb24uXG4gICAgICBmb3JFYWNoID0gZnVuY3Rpb24gKG9iamVjdCwgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIHNpemUgPSAwLCBQcm9wZXJ0aWVzLCBtZW1iZXJzLCBwcm9wZXJ0eTtcblxuICAgICAgICAvLyBUZXN0cyBmb3IgYnVncyBpbiB0aGUgY3VycmVudCBlbnZpcm9ubWVudCdzIGBmb3IuLi5pbmAgYWxnb3JpdGhtLiBUaGVcbiAgICAgICAgLy8gYHZhbHVlT2ZgIHByb3BlcnR5IGluaGVyaXRzIHRoZSBub24tZW51bWVyYWJsZSBmbGFnIGZyb21cbiAgICAgICAgLy8gYE9iamVjdC5wcm90b3R5cGVgIGluIG9sZGVyIHZlcnNpb25zIG9mIElFLCBOZXRzY2FwZSwgYW5kIE1vemlsbGEuXG4gICAgICAgIChQcm9wZXJ0aWVzID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgIHRoaXMudmFsdWVPZiA9IDA7XG4gICAgICAgIH0pLnByb3RvdHlwZS52YWx1ZU9mID0gMDtcblxuICAgICAgICAvLyBJdGVyYXRlIG92ZXIgYSBuZXcgaW5zdGFuY2Ugb2YgdGhlIGBQcm9wZXJ0aWVzYCBjbGFzcy5cbiAgICAgICAgbWVtYmVycyA9IG5ldyBQcm9wZXJ0aWVzKCk7XG4gICAgICAgIGZvciAocHJvcGVydHkgaW4gbWVtYmVycykge1xuICAgICAgICAgIC8vIElnbm9yZSBhbGwgcHJvcGVydGllcyBpbmhlcml0ZWQgZnJvbSBgT2JqZWN0LnByb3RvdHlwZWAuXG4gICAgICAgICAgaWYgKGlzUHJvcGVydHkuY2FsbChtZW1iZXJzLCBwcm9wZXJ0eSkpIHtcbiAgICAgICAgICAgIHNpemUrKztcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgUHJvcGVydGllcyA9IG1lbWJlcnMgPSBudWxsO1xuXG4gICAgICAgIC8vIE5vcm1hbGl6ZSB0aGUgaXRlcmF0aW9uIGFsZ29yaXRobS5cbiAgICAgICAgaWYgKCFzaXplKSB7XG4gICAgICAgICAgLy8gQSBsaXN0IG9mIG5vbi1lbnVtZXJhYmxlIHByb3BlcnRpZXMgaW5oZXJpdGVkIGZyb20gYE9iamVjdC5wcm90b3R5cGVgLlxuICAgICAgICAgIG1lbWJlcnMgPSBbXCJ2YWx1ZU9mXCIsIFwidG9TdHJpbmdcIiwgXCJ0b0xvY2FsZVN0cmluZ1wiLCBcInByb3BlcnR5SXNFbnVtZXJhYmxlXCIsIFwiaXNQcm90b3R5cGVPZlwiLCBcImhhc093blByb3BlcnR5XCIsIFwiY29uc3RydWN0b3JcIl07XG4gICAgICAgICAgLy8gSUUgPD0gOCwgTW96aWxsYSAxLjAsIGFuZCBOZXRzY2FwZSA2LjIgaWdub3JlIHNoYWRvd2VkIG5vbi1lbnVtZXJhYmxlXG4gICAgICAgICAgLy8gcHJvcGVydGllcy5cbiAgICAgICAgICBmb3JFYWNoID0gZnVuY3Rpb24gKG9iamVjdCwgY2FsbGJhY2spIHtcbiAgICAgICAgICAgIHZhciBpc0Z1bmN0aW9uID0gZ2V0Q2xhc3MuY2FsbChvYmplY3QpID09IGZ1bmN0aW9uQ2xhc3MsIHByb3BlcnR5LCBsZW5ndGg7XG4gICAgICAgICAgICB2YXIgaGFzUHJvcGVydHkgPSAhaXNGdW5jdGlvbiAmJiB0eXBlb2Ygb2JqZWN0LmNvbnN0cnVjdG9yICE9IFwiZnVuY3Rpb25cIiAmJiBvYmplY3RUeXBlc1t0eXBlb2Ygb2JqZWN0Lmhhc093blByb3BlcnR5XSAmJiBvYmplY3QuaGFzT3duUHJvcGVydHkgfHwgaXNQcm9wZXJ0eTtcbiAgICAgICAgICAgIGZvciAocHJvcGVydHkgaW4gb2JqZWN0KSB7XG4gICAgICAgICAgICAgIC8vIEdlY2tvIDw9IDEuMCBlbnVtZXJhdGVzIHRoZSBgcHJvdG90eXBlYCBwcm9wZXJ0eSBvZiBmdW5jdGlvbnMgdW5kZXJcbiAgICAgICAgICAgICAgLy8gY2VydGFpbiBjb25kaXRpb25zOyBJRSBkb2VzIG5vdC5cbiAgICAgICAgICAgICAgaWYgKCEoaXNGdW5jdGlvbiAmJiBwcm9wZXJ0eSA9PSBcInByb3RvdHlwZVwiKSAmJiBoYXNQcm9wZXJ0eS5jYWxsKG9iamVjdCwgcHJvcGVydHkpKSB7XG4gICAgICAgICAgICAgICAgY2FsbGJhY2socHJvcGVydHkpO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyBNYW51YWxseSBpbnZva2UgdGhlIGNhbGxiYWNrIGZvciBlYWNoIG5vbi1lbnVtZXJhYmxlIHByb3BlcnR5LlxuICAgICAgICAgICAgZm9yIChsZW5ndGggPSBtZW1iZXJzLmxlbmd0aDsgcHJvcGVydHkgPSBtZW1iZXJzWy0tbGVuZ3RoXTsgaGFzUHJvcGVydHkuY2FsbChvYmplY3QsIHByb3BlcnR5KSAmJiBjYWxsYmFjayhwcm9wZXJ0eSkpO1xuICAgICAgICAgIH07XG4gICAgICAgIH0gZWxzZSBpZiAoc2l6ZSA9PSAyKSB7XG4gICAgICAgICAgLy8gU2FmYXJpIDw9IDIuMC40IGVudW1lcmF0ZXMgc2hhZG93ZWQgcHJvcGVydGllcyB0d2ljZS5cbiAgICAgICAgICBmb3JFYWNoID0gZnVuY3Rpb24gKG9iamVjdCwgY2FsbGJhY2spIHtcbiAgICAgICAgICAgIC8vIENyZWF0ZSBhIHNldCBvZiBpdGVyYXRlZCBwcm9wZXJ0aWVzLlxuICAgICAgICAgICAgdmFyIG1lbWJlcnMgPSB7fSwgaXNGdW5jdGlvbiA9IGdldENsYXNzLmNhbGwob2JqZWN0KSA9PSBmdW5jdGlvbkNsYXNzLCBwcm9wZXJ0eTtcbiAgICAgICAgICAgIGZvciAocHJvcGVydHkgaW4gb2JqZWN0KSB7XG4gICAgICAgICAgICAgIC8vIFN0b3JlIGVhY2ggcHJvcGVydHkgbmFtZSB0byBwcmV2ZW50IGRvdWJsZSBlbnVtZXJhdGlvbi4gVGhlXG4gICAgICAgICAgICAgIC8vIGBwcm90b3R5cGVgIHByb3BlcnR5IG9mIGZ1bmN0aW9ucyBpcyBub3QgZW51bWVyYXRlZCBkdWUgdG8gY3Jvc3MtXG4gICAgICAgICAgICAgIC8vIGVudmlyb25tZW50IGluY29uc2lzdGVuY2llcy5cbiAgICAgICAgICAgICAgaWYgKCEoaXNGdW5jdGlvbiAmJiBwcm9wZXJ0eSA9PSBcInByb3RvdHlwZVwiKSAmJiAhaXNQcm9wZXJ0eS5jYWxsKG1lbWJlcnMsIHByb3BlcnR5KSAmJiAobWVtYmVyc1twcm9wZXJ0eV0gPSAxKSAmJiBpc1Byb3BlcnR5LmNhbGwob2JqZWN0LCBwcm9wZXJ0eSkpIHtcbiAgICAgICAgICAgICAgICBjYWxsYmFjayhwcm9wZXJ0eSk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9O1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIE5vIGJ1Z3MgZGV0ZWN0ZWQ7IHVzZSB0aGUgc3RhbmRhcmQgYGZvci4uLmluYCBhbGdvcml0aG0uXG4gICAgICAgICAgZm9yRWFjaCA9IGZ1bmN0aW9uIChvYmplY3QsIGNhbGxiYWNrKSB7XG4gICAgICAgICAgICB2YXIgaXNGdW5jdGlvbiA9IGdldENsYXNzLmNhbGwob2JqZWN0KSA9PSBmdW5jdGlvbkNsYXNzLCBwcm9wZXJ0eSwgaXNDb25zdHJ1Y3RvcjtcbiAgICAgICAgICAgIGZvciAocHJvcGVydHkgaW4gb2JqZWN0KSB7XG4gICAgICAgICAgICAgIGlmICghKGlzRnVuY3Rpb24gJiYgcHJvcGVydHkgPT0gXCJwcm90b3R5cGVcIikgJiYgaXNQcm9wZXJ0eS5jYWxsKG9iamVjdCwgcHJvcGVydHkpICYmICEoaXNDb25zdHJ1Y3RvciA9IHByb3BlcnR5ID09PSBcImNvbnN0cnVjdG9yXCIpKSB7XG4gICAgICAgICAgICAgICAgY2FsbGJhY2socHJvcGVydHkpO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyBNYW51YWxseSBpbnZva2UgdGhlIGNhbGxiYWNrIGZvciB0aGUgYGNvbnN0cnVjdG9yYCBwcm9wZXJ0eSBkdWUgdG9cbiAgICAgICAgICAgIC8vIGNyb3NzLWVudmlyb25tZW50IGluY29uc2lzdGVuY2llcy5cbiAgICAgICAgICAgIGlmIChpc0NvbnN0cnVjdG9yIHx8IGlzUHJvcGVydHkuY2FsbChvYmplY3QsIChwcm9wZXJ0eSA9IFwiY29uc3RydWN0b3JcIikpKSB7XG4gICAgICAgICAgICAgIGNhbGxiYWNrKHByb3BlcnR5KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBmb3JFYWNoKG9iamVjdCwgY2FsbGJhY2spO1xuICAgICAgfTtcblxuICAgICAgLy8gUHVibGljOiBTZXJpYWxpemVzIGEgSmF2YVNjcmlwdCBgdmFsdWVgIGFzIGEgSlNPTiBzdHJpbmcuIFRoZSBvcHRpb25hbFxuICAgICAgLy8gYGZpbHRlcmAgYXJndW1lbnQgbWF5IHNwZWNpZnkgZWl0aGVyIGEgZnVuY3Rpb24gdGhhdCBhbHRlcnMgaG93IG9iamVjdCBhbmRcbiAgICAgIC8vIGFycmF5IG1lbWJlcnMgYXJlIHNlcmlhbGl6ZWQsIG9yIGFuIGFycmF5IG9mIHN0cmluZ3MgYW5kIG51bWJlcnMgdGhhdFxuICAgICAgLy8gaW5kaWNhdGVzIHdoaWNoIHByb3BlcnRpZXMgc2hvdWxkIGJlIHNlcmlhbGl6ZWQuIFRoZSBvcHRpb25hbCBgd2lkdGhgXG4gICAgICAvLyBhcmd1bWVudCBtYXkgYmUgZWl0aGVyIGEgc3RyaW5nIG9yIG51bWJlciB0aGF0IHNwZWNpZmllcyB0aGUgaW5kZW50YXRpb25cbiAgICAgIC8vIGxldmVsIG9mIHRoZSBvdXRwdXQuXG4gICAgICBpZiAoIWhhcyhcImpzb24tc3RyaW5naWZ5XCIpKSB7XG4gICAgICAgIC8vIEludGVybmFsOiBBIG1hcCBvZiBjb250cm9sIGNoYXJhY3RlcnMgYW5kIHRoZWlyIGVzY2FwZWQgZXF1aXZhbGVudHMuXG4gICAgICAgIHZhciBFc2NhcGVzID0ge1xuICAgICAgICAgIDkyOiBcIlxcXFxcXFxcXCIsXG4gICAgICAgICAgMzQ6ICdcXFxcXCInLFxuICAgICAgICAgIDg6IFwiXFxcXGJcIixcbiAgICAgICAgICAxMjogXCJcXFxcZlwiLFxuICAgICAgICAgIDEwOiBcIlxcXFxuXCIsXG4gICAgICAgICAgMTM6IFwiXFxcXHJcIixcbiAgICAgICAgICA5OiBcIlxcXFx0XCJcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBJbnRlcm5hbDogQ29udmVydHMgYHZhbHVlYCBpbnRvIGEgemVyby1wYWRkZWQgc3RyaW5nIHN1Y2ggdGhhdCBpdHNcbiAgICAgICAgLy8gbGVuZ3RoIGlzIGF0IGxlYXN0IGVxdWFsIHRvIGB3aWR0aGAuIFRoZSBgd2lkdGhgIG11c3QgYmUgPD0gNi5cbiAgICAgICAgdmFyIGxlYWRpbmdaZXJvZXMgPSBcIjAwMDAwMFwiO1xuICAgICAgICB2YXIgdG9QYWRkZWRTdHJpbmcgPSBmdW5jdGlvbiAod2lkdGgsIHZhbHVlKSB7XG4gICAgICAgICAgLy8gVGhlIGB8fCAwYCBleHByZXNzaW9uIGlzIG5lY2Vzc2FyeSB0byB3b3JrIGFyb3VuZCBhIGJ1ZyBpblxuICAgICAgICAgIC8vIE9wZXJhIDw9IDcuNTR1MiB3aGVyZSBgMCA9PSAtMGAsIGJ1dCBgU3RyaW5nKC0wKSAhPT0gXCIwXCJgLlxuICAgICAgICAgIHJldHVybiAobGVhZGluZ1plcm9lcyArICh2YWx1ZSB8fCAwKSkuc2xpY2UoLXdpZHRoKTtcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBJbnRlcm5hbDogRG91YmxlLXF1b3RlcyBhIHN0cmluZyBgdmFsdWVgLCByZXBsYWNpbmcgYWxsIEFTQ0lJIGNvbnRyb2xcbiAgICAgICAgLy8gY2hhcmFjdGVycyAoY2hhcmFjdGVycyB3aXRoIGNvZGUgdW5pdCB2YWx1ZXMgYmV0d2VlbiAwIGFuZCAzMSkgd2l0aFxuICAgICAgICAvLyB0aGVpciBlc2NhcGVkIGVxdWl2YWxlbnRzLiBUaGlzIGlzIGFuIGltcGxlbWVudGF0aW9uIG9mIHRoZVxuICAgICAgICAvLyBgUXVvdGUodmFsdWUpYCBvcGVyYXRpb24gZGVmaW5lZCBpbiBFUyA1LjEgc2VjdGlvbiAxNS4xMi4zLlxuICAgICAgICB2YXIgdW5pY29kZVByZWZpeCA9IFwiXFxcXHUwMFwiO1xuICAgICAgICB2YXIgcXVvdGUgPSBmdW5jdGlvbiAodmFsdWUpIHtcbiAgICAgICAgICB2YXIgcmVzdWx0ID0gJ1wiJywgaW5kZXggPSAwLCBsZW5ndGggPSB2YWx1ZS5sZW5ndGgsIHVzZUNoYXJJbmRleCA9ICFjaGFySW5kZXhCdWdneSB8fCBsZW5ndGggPiAxMDtcbiAgICAgICAgICB2YXIgc3ltYm9scyA9IHVzZUNoYXJJbmRleCAmJiAoY2hhckluZGV4QnVnZ3kgPyB2YWx1ZS5zcGxpdChcIlwiKSA6IHZhbHVlKTtcbiAgICAgICAgICBmb3IgKDsgaW5kZXggPCBsZW5ndGg7IGluZGV4KyspIHtcbiAgICAgICAgICAgIHZhciBjaGFyQ29kZSA9IHZhbHVlLmNoYXJDb2RlQXQoaW5kZXgpO1xuICAgICAgICAgICAgLy8gSWYgdGhlIGNoYXJhY3RlciBpcyBhIGNvbnRyb2wgY2hhcmFjdGVyLCBhcHBlbmQgaXRzIFVuaWNvZGUgb3JcbiAgICAgICAgICAgIC8vIHNob3J0aGFuZCBlc2NhcGUgc2VxdWVuY2U7IG90aGVyd2lzZSwgYXBwZW5kIHRoZSBjaGFyYWN0ZXIgYXMtaXMuXG4gICAgICAgICAgICBzd2l0Y2ggKGNoYXJDb2RlKSB7XG4gICAgICAgICAgICAgIGNhc2UgODogY2FzZSA5OiBjYXNlIDEwOiBjYXNlIDEyOiBjYXNlIDEzOiBjYXNlIDM0OiBjYXNlIDkyOlxuICAgICAgICAgICAgICAgIHJlc3VsdCArPSBFc2NhcGVzW2NoYXJDb2RlXTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICBpZiAoY2hhckNvZGUgPCAzMikge1xuICAgICAgICAgICAgICAgICAgcmVzdWx0ICs9IHVuaWNvZGVQcmVmaXggKyB0b1BhZGRlZFN0cmluZygyLCBjaGFyQ29kZS50b1N0cmluZygxNikpO1xuICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJlc3VsdCArPSB1c2VDaGFySW5kZXggPyBzeW1ib2xzW2luZGV4XSA6IHZhbHVlLmNoYXJBdChpbmRleCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiByZXN1bHQgKyAnXCInO1xuICAgICAgICB9O1xuXG4gICAgICAgIC8vIEludGVybmFsOiBSZWN1cnNpdmVseSBzZXJpYWxpemVzIGFuIG9iamVjdC4gSW1wbGVtZW50cyB0aGVcbiAgICAgICAgLy8gYFN0cihrZXksIGhvbGRlcilgLCBgSk8odmFsdWUpYCwgYW5kIGBKQSh2YWx1ZSlgIG9wZXJhdGlvbnMuXG4gICAgICAgIHZhciBzZXJpYWxpemUgPSBmdW5jdGlvbiAocHJvcGVydHksIG9iamVjdCwgY2FsbGJhY2ssIHByb3BlcnRpZXMsIHdoaXRlc3BhY2UsIGluZGVudGF0aW9uLCBzdGFjaykge1xuICAgICAgICAgIHZhciB2YWx1ZSwgY2xhc3NOYW1lLCB5ZWFyLCBtb250aCwgZGF0ZSwgdGltZSwgaG91cnMsIG1pbnV0ZXMsIHNlY29uZHMsIG1pbGxpc2Vjb25kcywgcmVzdWx0cywgZWxlbWVudCwgaW5kZXgsIGxlbmd0aCwgcHJlZml4LCByZXN1bHQ7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIC8vIE5lY2Vzc2FyeSBmb3IgaG9zdCBvYmplY3Qgc3VwcG9ydC5cbiAgICAgICAgICAgIHZhbHVlID0gb2JqZWN0W3Byb3BlcnR5XTtcbiAgICAgICAgICB9IGNhdGNoIChleGNlcHRpb24pIHt9XG4gICAgICAgICAgaWYgKHR5cGVvZiB2YWx1ZSA9PSBcIm9iamVjdFwiICYmIHZhbHVlKSB7XG4gICAgICAgICAgICBjbGFzc05hbWUgPSBnZXRDbGFzcy5jYWxsKHZhbHVlKTtcbiAgICAgICAgICAgIGlmIChjbGFzc05hbWUgPT0gZGF0ZUNsYXNzICYmICFpc1Byb3BlcnR5LmNhbGwodmFsdWUsIFwidG9KU09OXCIpKSB7XG4gICAgICAgICAgICAgIGlmICh2YWx1ZSA+IC0xIC8gMCAmJiB2YWx1ZSA8IDEgLyAwKSB7XG4gICAgICAgICAgICAgICAgLy8gRGF0ZXMgYXJlIHNlcmlhbGl6ZWQgYWNjb3JkaW5nIHRvIHRoZSBgRGF0ZSN0b0pTT05gIG1ldGhvZFxuICAgICAgICAgICAgICAgIC8vIHNwZWNpZmllZCBpbiBFUyA1LjEgc2VjdGlvbiAxNS45LjUuNDQuIFNlZSBzZWN0aW9uIDE1LjkuMS4xNVxuICAgICAgICAgICAgICAgIC8vIGZvciB0aGUgSVNPIDg2MDEgZGF0ZSB0aW1lIHN0cmluZyBmb3JtYXQuXG4gICAgICAgICAgICAgICAgaWYgKGdldERheSkge1xuICAgICAgICAgICAgICAgICAgLy8gTWFudWFsbHkgY29tcHV0ZSB0aGUgeWVhciwgbW9udGgsIGRhdGUsIGhvdXJzLCBtaW51dGVzLFxuICAgICAgICAgICAgICAgICAgLy8gc2Vjb25kcywgYW5kIG1pbGxpc2Vjb25kcyBpZiB0aGUgYGdldFVUQypgIG1ldGhvZHMgYXJlXG4gICAgICAgICAgICAgICAgICAvLyBidWdneS4gQWRhcHRlZCBmcm9tIEBZYWZmbGUncyBgZGF0ZS1zaGltYCBwcm9qZWN0LlxuICAgICAgICAgICAgICAgICAgZGF0ZSA9IGZsb29yKHZhbHVlIC8gODY0ZTUpO1xuICAgICAgICAgICAgICAgICAgZm9yICh5ZWFyID0gZmxvb3IoZGF0ZSAvIDM2NS4yNDI1KSArIDE5NzAgLSAxOyBnZXREYXkoeWVhciArIDEsIDApIDw9IGRhdGU7IHllYXIrKyk7XG4gICAgICAgICAgICAgICAgICBmb3IgKG1vbnRoID0gZmxvb3IoKGRhdGUgLSBnZXREYXkoeWVhciwgMCkpIC8gMzAuNDIpOyBnZXREYXkoeWVhciwgbW9udGggKyAxKSA8PSBkYXRlOyBtb250aCsrKTtcbiAgICAgICAgICAgICAgICAgIGRhdGUgPSAxICsgZGF0ZSAtIGdldERheSh5ZWFyLCBtb250aCk7XG4gICAgICAgICAgICAgICAgICAvLyBUaGUgYHRpbWVgIHZhbHVlIHNwZWNpZmllcyB0aGUgdGltZSB3aXRoaW4gdGhlIGRheSAoc2VlIEVTXG4gICAgICAgICAgICAgICAgICAvLyA1LjEgc2VjdGlvbiAxNS45LjEuMikuIFRoZSBmb3JtdWxhIGAoQSAlIEIgKyBCKSAlIEJgIGlzIHVzZWRcbiAgICAgICAgICAgICAgICAgIC8vIHRvIGNvbXB1dGUgYEEgbW9kdWxvIEJgLCBhcyB0aGUgYCVgIG9wZXJhdG9yIGRvZXMgbm90XG4gICAgICAgICAgICAgICAgICAvLyBjb3JyZXNwb25kIHRvIHRoZSBgbW9kdWxvYCBvcGVyYXRpb24gZm9yIG5lZ2F0aXZlIG51bWJlcnMuXG4gICAgICAgICAgICAgICAgICB0aW1lID0gKHZhbHVlICUgODY0ZTUgKyA4NjRlNSkgJSA4NjRlNTtcbiAgICAgICAgICAgICAgICAgIC8vIFRoZSBob3VycywgbWludXRlcywgc2Vjb25kcywgYW5kIG1pbGxpc2Vjb25kcyBhcmUgb2J0YWluZWQgYnlcbiAgICAgICAgICAgICAgICAgIC8vIGRlY29tcG9zaW5nIHRoZSB0aW1lIHdpdGhpbiB0aGUgZGF5LiBTZWUgc2VjdGlvbiAxNS45LjEuMTAuXG4gICAgICAgICAgICAgICAgICBob3VycyA9IGZsb29yKHRpbWUgLyAzNmU1KSAlIDI0O1xuICAgICAgICAgICAgICAgICAgbWludXRlcyA9IGZsb29yKHRpbWUgLyA2ZTQpICUgNjA7XG4gICAgICAgICAgICAgICAgICBzZWNvbmRzID0gZmxvb3IodGltZSAvIDFlMykgJSA2MDtcbiAgICAgICAgICAgICAgICAgIG1pbGxpc2Vjb25kcyA9IHRpbWUgJSAxZTM7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgIHllYXIgPSB2YWx1ZS5nZXRVVENGdWxsWWVhcigpO1xuICAgICAgICAgICAgICAgICAgbW9udGggPSB2YWx1ZS5nZXRVVENNb250aCgpO1xuICAgICAgICAgICAgICAgICAgZGF0ZSA9IHZhbHVlLmdldFVUQ0RhdGUoKTtcbiAgICAgICAgICAgICAgICAgIGhvdXJzID0gdmFsdWUuZ2V0VVRDSG91cnMoKTtcbiAgICAgICAgICAgICAgICAgIG1pbnV0ZXMgPSB2YWx1ZS5nZXRVVENNaW51dGVzKCk7XG4gICAgICAgICAgICAgICAgICBzZWNvbmRzID0gdmFsdWUuZ2V0VVRDU2Vjb25kcygpO1xuICAgICAgICAgICAgICAgICAgbWlsbGlzZWNvbmRzID0gdmFsdWUuZ2V0VVRDTWlsbGlzZWNvbmRzKCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIC8vIFNlcmlhbGl6ZSBleHRlbmRlZCB5ZWFycyBjb3JyZWN0bHkuXG4gICAgICAgICAgICAgICAgdmFsdWUgPSAoeWVhciA8PSAwIHx8IHllYXIgPj0gMWU0ID8gKHllYXIgPCAwID8gXCItXCIgOiBcIitcIikgKyB0b1BhZGRlZFN0cmluZyg2LCB5ZWFyIDwgMCA/IC15ZWFyIDogeWVhcikgOiB0b1BhZGRlZFN0cmluZyg0LCB5ZWFyKSkgK1xuICAgICAgICAgICAgICAgICAgXCItXCIgKyB0b1BhZGRlZFN0cmluZygyLCBtb250aCArIDEpICsgXCItXCIgKyB0b1BhZGRlZFN0cmluZygyLCBkYXRlKSArXG4gICAgICAgICAgICAgICAgICAvLyBNb250aHMsIGRhdGVzLCBob3VycywgbWludXRlcywgYW5kIHNlY29uZHMgc2hvdWxkIGhhdmUgdHdvXG4gICAgICAgICAgICAgICAgICAvLyBkaWdpdHM7IG1pbGxpc2Vjb25kcyBzaG91bGQgaGF2ZSB0aHJlZS5cbiAgICAgICAgICAgICAgICAgIFwiVFwiICsgdG9QYWRkZWRTdHJpbmcoMiwgaG91cnMpICsgXCI6XCIgKyB0b1BhZGRlZFN0cmluZygyLCBtaW51dGVzKSArIFwiOlwiICsgdG9QYWRkZWRTdHJpbmcoMiwgc2Vjb25kcykgK1xuICAgICAgICAgICAgICAgICAgLy8gTWlsbGlzZWNvbmRzIGFyZSBvcHRpb25hbCBpbiBFUyA1LjAsIGJ1dCByZXF1aXJlZCBpbiA1LjEuXG4gICAgICAgICAgICAgICAgICBcIi5cIiArIHRvUGFkZGVkU3RyaW5nKDMsIG1pbGxpc2Vjb25kcykgKyBcIlpcIjtcbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB2YWx1ZSA9IG51bGw7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSBpZiAodHlwZW9mIHZhbHVlLnRvSlNPTiA9PSBcImZ1bmN0aW9uXCIgJiYgKChjbGFzc05hbWUgIT0gbnVtYmVyQ2xhc3MgJiYgY2xhc3NOYW1lICE9IHN0cmluZ0NsYXNzICYmIGNsYXNzTmFtZSAhPSBhcnJheUNsYXNzKSB8fCBpc1Byb3BlcnR5LmNhbGwodmFsdWUsIFwidG9KU09OXCIpKSkge1xuICAgICAgICAgICAgICAvLyBQcm90b3R5cGUgPD0gMS42LjEgYWRkcyBub24tc3RhbmRhcmQgYHRvSlNPTmAgbWV0aG9kcyB0byB0aGVcbiAgICAgICAgICAgICAgLy8gYE51bWJlcmAsIGBTdHJpbmdgLCBgRGF0ZWAsIGFuZCBgQXJyYXlgIHByb3RvdHlwZXMuIEpTT04gM1xuICAgICAgICAgICAgICAvLyBpZ25vcmVzIGFsbCBgdG9KU09OYCBtZXRob2RzIG9uIHRoZXNlIG9iamVjdHMgdW5sZXNzIHRoZXkgYXJlXG4gICAgICAgICAgICAgIC8vIGRlZmluZWQgZGlyZWN0bHkgb24gYW4gaW5zdGFuY2UuXG4gICAgICAgICAgICAgIHZhbHVlID0gdmFsdWUudG9KU09OKHByb3BlcnR5KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICAgICAgICAvLyBJZiBhIHJlcGxhY2VtZW50IGZ1bmN0aW9uIHdhcyBwcm92aWRlZCwgY2FsbCBpdCB0byBvYnRhaW4gdGhlIHZhbHVlXG4gICAgICAgICAgICAvLyBmb3Igc2VyaWFsaXphdGlvbi5cbiAgICAgICAgICAgIHZhbHVlID0gY2FsbGJhY2suY2FsbChvYmplY3QsIHByb3BlcnR5LCB2YWx1ZSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmICh2YWx1ZSA9PT0gbnVsbCkge1xuICAgICAgICAgICAgcmV0dXJuIFwibnVsbFwiO1xuICAgICAgICAgIH1cbiAgICAgICAgICBjbGFzc05hbWUgPSBnZXRDbGFzcy5jYWxsKHZhbHVlKTtcbiAgICAgICAgICBpZiAoY2xhc3NOYW1lID09IGJvb2xlYW5DbGFzcykge1xuICAgICAgICAgICAgLy8gQm9vbGVhbnMgYXJlIHJlcHJlc2VudGVkIGxpdGVyYWxseS5cbiAgICAgICAgICAgIHJldHVybiBcIlwiICsgdmFsdWU7XG4gICAgICAgICAgfSBlbHNlIGlmIChjbGFzc05hbWUgPT0gbnVtYmVyQ2xhc3MpIHtcbiAgICAgICAgICAgIC8vIEpTT04gbnVtYmVycyBtdXN0IGJlIGZpbml0ZS4gYEluZmluaXR5YCBhbmQgYE5hTmAgYXJlIHNlcmlhbGl6ZWQgYXNcbiAgICAgICAgICAgIC8vIGBcIm51bGxcImAuXG4gICAgICAgICAgICByZXR1cm4gdmFsdWUgPiAtMSAvIDAgJiYgdmFsdWUgPCAxIC8gMCA/IFwiXCIgKyB2YWx1ZSA6IFwibnVsbFwiO1xuICAgICAgICAgIH0gZWxzZSBpZiAoY2xhc3NOYW1lID09IHN0cmluZ0NsYXNzKSB7XG4gICAgICAgICAgICAvLyBTdHJpbmdzIGFyZSBkb3VibGUtcXVvdGVkIGFuZCBlc2NhcGVkLlxuICAgICAgICAgICAgcmV0dXJuIHF1b3RlKFwiXCIgKyB2YWx1ZSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIC8vIFJlY3Vyc2l2ZWx5IHNlcmlhbGl6ZSBvYmplY3RzIGFuZCBhcnJheXMuXG4gICAgICAgICAgaWYgKHR5cGVvZiB2YWx1ZSA9PSBcIm9iamVjdFwiKSB7XG4gICAgICAgICAgICAvLyBDaGVjayBmb3IgY3ljbGljIHN0cnVjdHVyZXMuIFRoaXMgaXMgYSBsaW5lYXIgc2VhcmNoOyBwZXJmb3JtYW5jZVxuICAgICAgICAgICAgLy8gaXMgaW52ZXJzZWx5IHByb3BvcnRpb25hbCB0byB0aGUgbnVtYmVyIG9mIHVuaXF1ZSBuZXN0ZWQgb2JqZWN0cy5cbiAgICAgICAgICAgIGZvciAobGVuZ3RoID0gc3RhY2subGVuZ3RoOyBsZW5ndGgtLTspIHtcbiAgICAgICAgICAgICAgaWYgKHN0YWNrW2xlbmd0aF0gPT09IHZhbHVlKSB7XG4gICAgICAgICAgICAgICAgLy8gQ3ljbGljIHN0cnVjdHVyZXMgY2Fubm90IGJlIHNlcmlhbGl6ZWQgYnkgYEpTT04uc3RyaW5naWZ5YC5cbiAgICAgICAgICAgICAgICB0aHJvdyBUeXBlRXJyb3IoKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gQWRkIHRoZSBvYmplY3QgdG8gdGhlIHN0YWNrIG9mIHRyYXZlcnNlZCBvYmplY3RzLlxuICAgICAgICAgICAgc3RhY2sucHVzaCh2YWx1ZSk7XG4gICAgICAgICAgICByZXN1bHRzID0gW107XG4gICAgICAgICAgICAvLyBTYXZlIHRoZSBjdXJyZW50IGluZGVudGF0aW9uIGxldmVsIGFuZCBpbmRlbnQgb25lIGFkZGl0aW9uYWwgbGV2ZWwuXG4gICAgICAgICAgICBwcmVmaXggPSBpbmRlbnRhdGlvbjtcbiAgICAgICAgICAgIGluZGVudGF0aW9uICs9IHdoaXRlc3BhY2U7XG4gICAgICAgICAgICBpZiAoY2xhc3NOYW1lID09IGFycmF5Q2xhc3MpIHtcbiAgICAgICAgICAgICAgLy8gUmVjdXJzaXZlbHkgc2VyaWFsaXplIGFycmF5IGVsZW1lbnRzLlxuICAgICAgICAgICAgICBmb3IgKGluZGV4ID0gMCwgbGVuZ3RoID0gdmFsdWUubGVuZ3RoOyBpbmRleCA8IGxlbmd0aDsgaW5kZXgrKykge1xuICAgICAgICAgICAgICAgIGVsZW1lbnQgPSBzZXJpYWxpemUoaW5kZXgsIHZhbHVlLCBjYWxsYmFjaywgcHJvcGVydGllcywgd2hpdGVzcGFjZSwgaW5kZW50YXRpb24sIHN0YWNrKTtcbiAgICAgICAgICAgICAgICByZXN1bHRzLnB1c2goZWxlbWVudCA9PT0gdW5kZWYgPyBcIm51bGxcIiA6IGVsZW1lbnQpO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIHJlc3VsdCA9IHJlc3VsdHMubGVuZ3RoID8gKHdoaXRlc3BhY2UgPyBcIltcXG5cIiArIGluZGVudGF0aW9uICsgcmVzdWx0cy5qb2luKFwiLFxcblwiICsgaW5kZW50YXRpb24pICsgXCJcXG5cIiArIHByZWZpeCArIFwiXVwiIDogKFwiW1wiICsgcmVzdWx0cy5qb2luKFwiLFwiKSArIFwiXVwiKSkgOiBcIltdXCI7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAvLyBSZWN1cnNpdmVseSBzZXJpYWxpemUgb2JqZWN0IG1lbWJlcnMuIE1lbWJlcnMgYXJlIHNlbGVjdGVkIGZyb21cbiAgICAgICAgICAgICAgLy8gZWl0aGVyIGEgdXNlci1zcGVjaWZpZWQgbGlzdCBvZiBwcm9wZXJ0eSBuYW1lcywgb3IgdGhlIG9iamVjdFxuICAgICAgICAgICAgICAvLyBpdHNlbGYuXG4gICAgICAgICAgICAgIGZvckVhY2gocHJvcGVydGllcyB8fCB2YWx1ZSwgZnVuY3Rpb24gKHByb3BlcnR5KSB7XG4gICAgICAgICAgICAgICAgdmFyIGVsZW1lbnQgPSBzZXJpYWxpemUocHJvcGVydHksIHZhbHVlLCBjYWxsYmFjaywgcHJvcGVydGllcywgd2hpdGVzcGFjZSwgaW5kZW50YXRpb24sIHN0YWNrKTtcbiAgICAgICAgICAgICAgICBpZiAoZWxlbWVudCAhPT0gdW5kZWYpIHtcbiAgICAgICAgICAgICAgICAgIC8vIEFjY29yZGluZyB0byBFUyA1LjEgc2VjdGlvbiAxNS4xMi4zOiBcIklmIGBnYXBgIHt3aGl0ZXNwYWNlfVxuICAgICAgICAgICAgICAgICAgLy8gaXMgbm90IHRoZSBlbXB0eSBzdHJpbmcsIGxldCBgbWVtYmVyYCB7cXVvdGUocHJvcGVydHkpICsgXCI6XCJ9XG4gICAgICAgICAgICAgICAgICAvLyBiZSB0aGUgY29uY2F0ZW5hdGlvbiBvZiBgbWVtYmVyYCBhbmQgdGhlIGBzcGFjZWAgY2hhcmFjdGVyLlwiXG4gICAgICAgICAgICAgICAgICAvLyBUaGUgXCJgc3BhY2VgIGNoYXJhY3RlclwiIHJlZmVycyB0byB0aGUgbGl0ZXJhbCBzcGFjZVxuICAgICAgICAgICAgICAgICAgLy8gY2hhcmFjdGVyLCBub3QgdGhlIGBzcGFjZWAge3dpZHRofSBhcmd1bWVudCBwcm92aWRlZCB0b1xuICAgICAgICAgICAgICAgICAgLy8gYEpTT04uc3RyaW5naWZ5YC5cbiAgICAgICAgICAgICAgICAgIHJlc3VsdHMucHVzaChxdW90ZShwcm9wZXJ0eSkgKyBcIjpcIiArICh3aGl0ZXNwYWNlID8gXCIgXCIgOiBcIlwiKSArIGVsZW1lbnQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgIHJlc3VsdCA9IHJlc3VsdHMubGVuZ3RoID8gKHdoaXRlc3BhY2UgPyBcIntcXG5cIiArIGluZGVudGF0aW9uICsgcmVzdWx0cy5qb2luKFwiLFxcblwiICsgaW5kZW50YXRpb24pICsgXCJcXG5cIiArIHByZWZpeCArIFwifVwiIDogKFwie1wiICsgcmVzdWx0cy5qb2luKFwiLFwiKSArIFwifVwiKSkgOiBcInt9XCI7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyBSZW1vdmUgdGhlIG9iamVjdCBmcm9tIHRoZSB0cmF2ZXJzZWQgb2JqZWN0IHN0YWNrLlxuICAgICAgICAgICAgc3RhY2sucG9wKCk7XG4gICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgICAgIH1cbiAgICAgICAgfTtcblxuICAgICAgICAvLyBQdWJsaWM6IGBKU09OLnN0cmluZ2lmeWAuIFNlZSBFUyA1LjEgc2VjdGlvbiAxNS4xMi4zLlxuICAgICAgICBleHBvcnRzLnN0cmluZ2lmeSA9IGZ1bmN0aW9uIChzb3VyY2UsIGZpbHRlciwgd2lkdGgpIHtcbiAgICAgICAgICB2YXIgd2hpdGVzcGFjZSwgY2FsbGJhY2ssIHByb3BlcnRpZXMsIGNsYXNzTmFtZTtcbiAgICAgICAgICBpZiAob2JqZWN0VHlwZXNbdHlwZW9mIGZpbHRlcl0gJiYgZmlsdGVyKSB7XG4gICAgICAgICAgICBpZiAoKGNsYXNzTmFtZSA9IGdldENsYXNzLmNhbGwoZmlsdGVyKSkgPT0gZnVuY3Rpb25DbGFzcykge1xuICAgICAgICAgICAgICBjYWxsYmFjayA9IGZpbHRlcjtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoY2xhc3NOYW1lID09IGFycmF5Q2xhc3MpIHtcbiAgICAgICAgICAgICAgLy8gQ29udmVydCB0aGUgcHJvcGVydHkgbmFtZXMgYXJyYXkgaW50byBhIG1ha2VzaGlmdCBzZXQuXG4gICAgICAgICAgICAgIHByb3BlcnRpZXMgPSB7fTtcbiAgICAgICAgICAgICAgZm9yICh2YXIgaW5kZXggPSAwLCBsZW5ndGggPSBmaWx0ZXIubGVuZ3RoLCB2YWx1ZTsgaW5kZXggPCBsZW5ndGg7IHZhbHVlID0gZmlsdGVyW2luZGV4KytdLCAoKGNsYXNzTmFtZSA9IGdldENsYXNzLmNhbGwodmFsdWUpKSwgY2xhc3NOYW1lID09IHN0cmluZ0NsYXNzIHx8IGNsYXNzTmFtZSA9PSBudW1iZXJDbGFzcykgJiYgKHByb3BlcnRpZXNbdmFsdWVdID0gMSkpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAod2lkdGgpIHtcbiAgICAgICAgICAgIGlmICgoY2xhc3NOYW1lID0gZ2V0Q2xhc3MuY2FsbCh3aWR0aCkpID09IG51bWJlckNsYXNzKSB7XG4gICAgICAgICAgICAgIC8vIENvbnZlcnQgdGhlIGB3aWR0aGAgdG8gYW4gaW50ZWdlciBhbmQgY3JlYXRlIGEgc3RyaW5nIGNvbnRhaW5pbmdcbiAgICAgICAgICAgICAgLy8gYHdpZHRoYCBudW1iZXIgb2Ygc3BhY2UgY2hhcmFjdGVycy5cbiAgICAgICAgICAgICAgaWYgKCh3aWR0aCAtPSB3aWR0aCAlIDEpID4gMCkge1xuICAgICAgICAgICAgICAgIGZvciAod2hpdGVzcGFjZSA9IFwiXCIsIHdpZHRoID4gMTAgJiYgKHdpZHRoID0gMTApOyB3aGl0ZXNwYWNlLmxlbmd0aCA8IHdpZHRoOyB3aGl0ZXNwYWNlICs9IFwiIFwiKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBlbHNlIGlmIChjbGFzc05hbWUgPT0gc3RyaW5nQ2xhc3MpIHtcbiAgICAgICAgICAgICAgd2hpdGVzcGFjZSA9IHdpZHRoLmxlbmd0aCA8PSAxMCA/IHdpZHRoIDogd2lkdGguc2xpY2UoMCwgMTApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICAvLyBPcGVyYSA8PSA3LjU0dTIgZGlzY2FyZHMgdGhlIHZhbHVlcyBhc3NvY2lhdGVkIHdpdGggZW1wdHkgc3RyaW5nIGtleXNcbiAgICAgICAgICAvLyAoYFwiXCJgKSBvbmx5IGlmIHRoZXkgYXJlIHVzZWQgZGlyZWN0bHkgd2l0aGluIGFuIG9iamVjdCBtZW1iZXIgbGlzdFxuICAgICAgICAgIC8vIChlLmcuLCBgIShcIlwiIGluIHsgXCJcIjogMX0pYCkuXG4gICAgICAgICAgcmV0dXJuIHNlcmlhbGl6ZShcIlwiLCAodmFsdWUgPSB7fSwgdmFsdWVbXCJcIl0gPSBzb3VyY2UsIHZhbHVlKSwgY2FsbGJhY2ssIHByb3BlcnRpZXMsIHdoaXRlc3BhY2UsIFwiXCIsIFtdKTtcbiAgICAgICAgfTtcbiAgICAgIH1cblxuICAgICAgLy8gUHVibGljOiBQYXJzZXMgYSBKU09OIHNvdXJjZSBzdHJpbmcuXG4gICAgICBpZiAoIWhhcyhcImpzb24tcGFyc2VcIikpIHtcbiAgICAgICAgdmFyIGZyb21DaGFyQ29kZSA9IFN0cmluZy5mcm9tQ2hhckNvZGU7XG5cbiAgICAgICAgLy8gSW50ZXJuYWw6IEEgbWFwIG9mIGVzY2FwZWQgY29udHJvbCBjaGFyYWN0ZXJzIGFuZCB0aGVpciB1bmVzY2FwZWRcbiAgICAgICAgLy8gZXF1aXZhbGVudHMuXG4gICAgICAgIHZhciBVbmVzY2FwZXMgPSB7XG4gICAgICAgICAgOTI6IFwiXFxcXFwiLFxuICAgICAgICAgIDM0OiAnXCInLFxuICAgICAgICAgIDQ3OiBcIi9cIixcbiAgICAgICAgICA5ODogXCJcXGJcIixcbiAgICAgICAgICAxMTY6IFwiXFx0XCIsXG4gICAgICAgICAgMTEwOiBcIlxcblwiLFxuICAgICAgICAgIDEwMjogXCJcXGZcIixcbiAgICAgICAgICAxMTQ6IFwiXFxyXCJcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBJbnRlcm5hbDogU3RvcmVzIHRoZSBwYXJzZXIgc3RhdGUuXG4gICAgICAgIHZhciBJbmRleCwgU291cmNlO1xuXG4gICAgICAgIC8vIEludGVybmFsOiBSZXNldHMgdGhlIHBhcnNlciBzdGF0ZSBhbmQgdGhyb3dzIGEgYFN5bnRheEVycm9yYC5cbiAgICAgICAgdmFyIGFib3J0ID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgIEluZGV4ID0gU291cmNlID0gbnVsbDtcbiAgICAgICAgICB0aHJvdyBTeW50YXhFcnJvcigpO1xuICAgICAgICB9O1xuXG4gICAgICAgIC8vIEludGVybmFsOiBSZXR1cm5zIHRoZSBuZXh0IHRva2VuLCBvciBgXCIkXCJgIGlmIHRoZSBwYXJzZXIgaGFzIHJlYWNoZWRcbiAgICAgICAgLy8gdGhlIGVuZCBvZiB0aGUgc291cmNlIHN0cmluZy4gQSB0b2tlbiBtYXkgYmUgYSBzdHJpbmcsIG51bWJlciwgYG51bGxgXG4gICAgICAgIC8vIGxpdGVyYWwsIG9yIEJvb2xlYW4gbGl0ZXJhbC5cbiAgICAgICAgdmFyIGxleCA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICB2YXIgc291cmNlID0gU291cmNlLCBsZW5ndGggPSBzb3VyY2UubGVuZ3RoLCB2YWx1ZSwgYmVnaW4sIHBvc2l0aW9uLCBpc1NpZ25lZCwgY2hhckNvZGU7XG4gICAgICAgICAgd2hpbGUgKEluZGV4IDwgbGVuZ3RoKSB7XG4gICAgICAgICAgICBjaGFyQ29kZSA9IHNvdXJjZS5jaGFyQ29kZUF0KEluZGV4KTtcbiAgICAgICAgICAgIHN3aXRjaCAoY2hhckNvZGUpIHtcbiAgICAgICAgICAgICAgY2FzZSA5OiBjYXNlIDEwOiBjYXNlIDEzOiBjYXNlIDMyOlxuICAgICAgICAgICAgICAgIC8vIFNraXAgd2hpdGVzcGFjZSB0b2tlbnMsIGluY2x1ZGluZyB0YWJzLCBjYXJyaWFnZSByZXR1cm5zLCBsaW5lXG4gICAgICAgICAgICAgICAgLy8gZmVlZHMsIGFuZCBzcGFjZSBjaGFyYWN0ZXJzLlxuICAgICAgICAgICAgICAgIEluZGV4Kys7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgIGNhc2UgMTIzOiBjYXNlIDEyNTogY2FzZSA5MTogY2FzZSA5MzogY2FzZSA1ODogY2FzZSA0NDpcbiAgICAgICAgICAgICAgICAvLyBQYXJzZSBhIHB1bmN0dWF0b3IgdG9rZW4gKGB7YCwgYH1gLCBgW2AsIGBdYCwgYDpgLCBvciBgLGApIGF0XG4gICAgICAgICAgICAgICAgLy8gdGhlIGN1cnJlbnQgcG9zaXRpb24uXG4gICAgICAgICAgICAgICAgdmFsdWUgPSBjaGFySW5kZXhCdWdneSA/IHNvdXJjZS5jaGFyQXQoSW5kZXgpIDogc291cmNlW0luZGV4XTtcbiAgICAgICAgICAgICAgICBJbmRleCsrO1xuICAgICAgICAgICAgICAgIHJldHVybiB2YWx1ZTtcbiAgICAgICAgICAgICAgY2FzZSAzNDpcbiAgICAgICAgICAgICAgICAvLyBgXCJgIGRlbGltaXRzIGEgSlNPTiBzdHJpbmc7IGFkdmFuY2UgdG8gdGhlIG5leHQgY2hhcmFjdGVyIGFuZFxuICAgICAgICAgICAgICAgIC8vIGJlZ2luIHBhcnNpbmcgdGhlIHN0cmluZy4gU3RyaW5nIHRva2VucyBhcmUgcHJlZml4ZWQgd2l0aCB0aGVcbiAgICAgICAgICAgICAgICAvLyBzZW50aW5lbCBgQGAgY2hhcmFjdGVyIHRvIGRpc3Rpbmd1aXNoIHRoZW0gZnJvbSBwdW5jdHVhdG9ycyBhbmRcbiAgICAgICAgICAgICAgICAvLyBlbmQtb2Ytc3RyaW5nIHRva2Vucy5cbiAgICAgICAgICAgICAgICBmb3IgKHZhbHVlID0gXCJAXCIsIEluZGV4Kys7IEluZGV4IDwgbGVuZ3RoOykge1xuICAgICAgICAgICAgICAgICAgY2hhckNvZGUgPSBzb3VyY2UuY2hhckNvZGVBdChJbmRleCk7XG4gICAgICAgICAgICAgICAgICBpZiAoY2hhckNvZGUgPCAzMikge1xuICAgICAgICAgICAgICAgICAgICAvLyBVbmVzY2FwZWQgQVNDSUkgY29udHJvbCBjaGFyYWN0ZXJzICh0aG9zZSB3aXRoIGEgY29kZSB1bml0XG4gICAgICAgICAgICAgICAgICAgIC8vIGxlc3MgdGhhbiB0aGUgc3BhY2UgY2hhcmFjdGVyKSBhcmUgbm90IHBlcm1pdHRlZC5cbiAgICAgICAgICAgICAgICAgICAgYWJvcnQoKTtcbiAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoY2hhckNvZGUgPT0gOTIpIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gQSByZXZlcnNlIHNvbGlkdXMgKGBcXGApIG1hcmtzIHRoZSBiZWdpbm5pbmcgb2YgYW4gZXNjYXBlZFxuICAgICAgICAgICAgICAgICAgICAvLyBjb250cm9sIGNoYXJhY3RlciAoaW5jbHVkaW5nIGBcImAsIGBcXGAsIGFuZCBgL2ApIG9yIFVuaWNvZGVcbiAgICAgICAgICAgICAgICAgICAgLy8gZXNjYXBlIHNlcXVlbmNlLlxuICAgICAgICAgICAgICAgICAgICBjaGFyQ29kZSA9IHNvdXJjZS5jaGFyQ29kZUF0KCsrSW5kZXgpO1xuICAgICAgICAgICAgICAgICAgICBzd2l0Y2ggKGNoYXJDb2RlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgY2FzZSA5MjogY2FzZSAzNDogY2FzZSA0NzogY2FzZSA5ODogY2FzZSAxMTY6IGNhc2UgMTEwOiBjYXNlIDEwMjogY2FzZSAxMTQ6XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBSZXZpdmUgZXNjYXBlZCBjb250cm9sIGNoYXJhY3RlcnMuXG4gICAgICAgICAgICAgICAgICAgICAgICB2YWx1ZSArPSBVbmVzY2FwZXNbY2hhckNvZGVdO1xuICAgICAgICAgICAgICAgICAgICAgICAgSW5kZXgrKztcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICAgIGNhc2UgMTE3OlxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gYFxcdWAgbWFya3MgdGhlIGJlZ2lubmluZyBvZiBhIFVuaWNvZGUgZXNjYXBlIHNlcXVlbmNlLlxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gQWR2YW5jZSB0byB0aGUgZmlyc3QgY2hhcmFjdGVyIGFuZCB2YWxpZGF0ZSB0aGVcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIGZvdXItZGlnaXQgY29kZSBwb2ludC5cbiAgICAgICAgICAgICAgICAgICAgICAgIGJlZ2luID0gKytJbmRleDtcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvciAocG9zaXRpb24gPSBJbmRleCArIDQ7IEluZGV4IDwgcG9zaXRpb247IEluZGV4KyspIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY2hhckNvZGUgPSBzb3VyY2UuY2hhckNvZGVBdChJbmRleCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIC8vIEEgdmFsaWQgc2VxdWVuY2UgY29tcHJpc2VzIGZvdXIgaGV4ZGlnaXRzIChjYXNlLVxuICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBpbnNlbnNpdGl2ZSkgdGhhdCBmb3JtIGEgc2luZ2xlIGhleGFkZWNpbWFsIHZhbHVlLlxuICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoIShjaGFyQ29kZSA+PSA0OCAmJiBjaGFyQ29kZSA8PSA1NyB8fCBjaGFyQ29kZSA+PSA5NyAmJiBjaGFyQ29kZSA8PSAxMDIgfHwgY2hhckNvZGUgPj0gNjUgJiYgY2hhckNvZGUgPD0gNzApKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gSW52YWxpZCBVbmljb2RlIGVzY2FwZSBzZXF1ZW5jZS5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhYm9ydCgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBSZXZpdmUgdGhlIGVzY2FwZWQgY2hhcmFjdGVyLlxuICAgICAgICAgICAgICAgICAgICAgICAgdmFsdWUgKz0gZnJvbUNoYXJDb2RlKFwiMHhcIiArIHNvdXJjZS5zbGljZShiZWdpbiwgSW5kZXgpKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBJbnZhbGlkIGVzY2FwZSBzZXF1ZW5jZS5cbiAgICAgICAgICAgICAgICAgICAgICAgIGFib3J0KCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChjaGFyQ29kZSA9PSAzNCkge1xuICAgICAgICAgICAgICAgICAgICAgIC8vIEFuIHVuZXNjYXBlZCBkb3VibGUtcXVvdGUgY2hhcmFjdGVyIG1hcmtzIHRoZSBlbmQgb2YgdGhlXG4gICAgICAgICAgICAgICAgICAgICAgLy8gc3RyaW5nLlxuICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGNoYXJDb2RlID0gc291cmNlLmNoYXJDb2RlQXQoSW5kZXgpO1xuICAgICAgICAgICAgICAgICAgICBiZWdpbiA9IEluZGV4O1xuICAgICAgICAgICAgICAgICAgICAvLyBPcHRpbWl6ZSBmb3IgdGhlIGNvbW1vbiBjYXNlIHdoZXJlIGEgc3RyaW5nIGlzIHZhbGlkLlxuICAgICAgICAgICAgICAgICAgICB3aGlsZSAoY2hhckNvZGUgPj0gMzIgJiYgY2hhckNvZGUgIT0gOTIgJiYgY2hhckNvZGUgIT0gMzQpIHtcbiAgICAgICAgICAgICAgICAgICAgICBjaGFyQ29kZSA9IHNvdXJjZS5jaGFyQ29kZUF0KCsrSW5kZXgpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIC8vIEFwcGVuZCB0aGUgc3RyaW5nIGFzLWlzLlxuICAgICAgICAgICAgICAgICAgICB2YWx1ZSArPSBzb3VyY2Uuc2xpY2UoYmVnaW4sIEluZGV4KTtcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKHNvdXJjZS5jaGFyQ29kZUF0KEluZGV4KSA9PSAzNCkge1xuICAgICAgICAgICAgICAgICAgLy8gQWR2YW5jZSB0byB0aGUgbmV4dCBjaGFyYWN0ZXIgYW5kIHJldHVybiB0aGUgcmV2aXZlZCBzdHJpbmcuXG4gICAgICAgICAgICAgICAgICBJbmRleCsrO1xuICAgICAgICAgICAgICAgICAgcmV0dXJuIHZhbHVlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAvLyBVbnRlcm1pbmF0ZWQgc3RyaW5nLlxuICAgICAgICAgICAgICAgIGFib3J0KCk7XG4gICAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgLy8gUGFyc2UgbnVtYmVycyBhbmQgbGl0ZXJhbHMuXG4gICAgICAgICAgICAgICAgYmVnaW4gPSBJbmRleDtcbiAgICAgICAgICAgICAgICAvLyBBZHZhbmNlIHBhc3QgdGhlIG5lZ2F0aXZlIHNpZ24sIGlmIG9uZSBpcyBzcGVjaWZpZWQuXG4gICAgICAgICAgICAgICAgaWYgKGNoYXJDb2RlID09IDQ1KSB7XG4gICAgICAgICAgICAgICAgICBpc1NpZ25lZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgICBjaGFyQ29kZSA9IHNvdXJjZS5jaGFyQ29kZUF0KCsrSW5kZXgpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAvLyBQYXJzZSBhbiBpbnRlZ2VyIG9yIGZsb2F0aW5nLXBvaW50IHZhbHVlLlxuICAgICAgICAgICAgICAgIGlmIChjaGFyQ29kZSA+PSA0OCAmJiBjaGFyQ29kZSA8PSA1Nykge1xuICAgICAgICAgICAgICAgICAgLy8gTGVhZGluZyB6ZXJvZXMgYXJlIGludGVycHJldGVkIGFzIG9jdGFsIGxpdGVyYWxzLlxuICAgICAgICAgICAgICAgICAgaWYgKGNoYXJDb2RlID09IDQ4ICYmICgoY2hhckNvZGUgPSBzb3VyY2UuY2hhckNvZGVBdChJbmRleCArIDEpKSwgY2hhckNvZGUgPj0gNDggJiYgY2hhckNvZGUgPD0gNTcpKSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIElsbGVnYWwgb2N0YWwgbGl0ZXJhbC5cbiAgICAgICAgICAgICAgICAgICAgYWJvcnQoKTtcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIGlzU2lnbmVkID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAvLyBQYXJzZSB0aGUgaW50ZWdlciBjb21wb25lbnQuXG4gICAgICAgICAgICAgICAgICBmb3IgKDsgSW5kZXggPCBsZW5ndGggJiYgKChjaGFyQ29kZSA9IHNvdXJjZS5jaGFyQ29kZUF0KEluZGV4KSksIGNoYXJDb2RlID49IDQ4ICYmIGNoYXJDb2RlIDw9IDU3KTsgSW5kZXgrKyk7XG4gICAgICAgICAgICAgICAgICAvLyBGbG9hdHMgY2Fubm90IGNvbnRhaW4gYSBsZWFkaW5nIGRlY2ltYWwgcG9pbnQ7IGhvd2V2ZXIsIHRoaXNcbiAgICAgICAgICAgICAgICAgIC8vIGNhc2UgaXMgYWxyZWFkeSBhY2NvdW50ZWQgZm9yIGJ5IHRoZSBwYXJzZXIuXG4gICAgICAgICAgICAgICAgICBpZiAoc291cmNlLmNoYXJDb2RlQXQoSW5kZXgpID09IDQ2KSB7XG4gICAgICAgICAgICAgICAgICAgIHBvc2l0aW9uID0gKytJbmRleDtcbiAgICAgICAgICAgICAgICAgICAgLy8gUGFyc2UgdGhlIGRlY2ltYWwgY29tcG9uZW50LlxuICAgICAgICAgICAgICAgICAgICBmb3IgKDsgcG9zaXRpb24gPCBsZW5ndGggJiYgKChjaGFyQ29kZSA9IHNvdXJjZS5jaGFyQ29kZUF0KHBvc2l0aW9uKSksIGNoYXJDb2RlID49IDQ4ICYmIGNoYXJDb2RlIDw9IDU3KTsgcG9zaXRpb24rKyk7XG4gICAgICAgICAgICAgICAgICAgIGlmIChwb3NpdGlvbiA9PSBJbmRleCkge1xuICAgICAgICAgICAgICAgICAgICAgIC8vIElsbGVnYWwgdHJhaWxpbmcgZGVjaW1hbC5cbiAgICAgICAgICAgICAgICAgICAgICBhYm9ydCgpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIEluZGV4ID0gcG9zaXRpb247XG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAvLyBQYXJzZSBleHBvbmVudHMuIFRoZSBgZWAgZGVub3RpbmcgdGhlIGV4cG9uZW50IGlzXG4gICAgICAgICAgICAgICAgICAvLyBjYXNlLWluc2Vuc2l0aXZlLlxuICAgICAgICAgICAgICAgICAgY2hhckNvZGUgPSBzb3VyY2UuY2hhckNvZGVBdChJbmRleCk7XG4gICAgICAgICAgICAgICAgICBpZiAoY2hhckNvZGUgPT0gMTAxIHx8IGNoYXJDb2RlID09IDY5KSB7XG4gICAgICAgICAgICAgICAgICAgIGNoYXJDb2RlID0gc291cmNlLmNoYXJDb2RlQXQoKytJbmRleCk7XG4gICAgICAgICAgICAgICAgICAgIC8vIFNraXAgcGFzdCB0aGUgc2lnbiBmb2xsb3dpbmcgdGhlIGV4cG9uZW50LCBpZiBvbmUgaXNcbiAgICAgICAgICAgICAgICAgICAgLy8gc3BlY2lmaWVkLlxuICAgICAgICAgICAgICAgICAgICBpZiAoY2hhckNvZGUgPT0gNDMgfHwgY2hhckNvZGUgPT0gNDUpIHtcbiAgICAgICAgICAgICAgICAgICAgICBJbmRleCsrO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIC8vIFBhcnNlIHRoZSBleHBvbmVudGlhbCBjb21wb25lbnQuXG4gICAgICAgICAgICAgICAgICAgIGZvciAocG9zaXRpb24gPSBJbmRleDsgcG9zaXRpb24gPCBsZW5ndGggJiYgKChjaGFyQ29kZSA9IHNvdXJjZS5jaGFyQ29kZUF0KHBvc2l0aW9uKSksIGNoYXJDb2RlID49IDQ4ICYmIGNoYXJDb2RlIDw9IDU3KTsgcG9zaXRpb24rKyk7XG4gICAgICAgICAgICAgICAgICAgIGlmIChwb3NpdGlvbiA9PSBJbmRleCkge1xuICAgICAgICAgICAgICAgICAgICAgIC8vIElsbGVnYWwgZW1wdHkgZXhwb25lbnQuXG4gICAgICAgICAgICAgICAgICAgICAgYWJvcnQoKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBJbmRleCA9IHBvc2l0aW9uO1xuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgLy8gQ29lcmNlIHRoZSBwYXJzZWQgdmFsdWUgdG8gYSBKYXZhU2NyaXB0IG51bWJlci5cbiAgICAgICAgICAgICAgICAgIHJldHVybiArc291cmNlLnNsaWNlKGJlZ2luLCBJbmRleCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIC8vIEEgbmVnYXRpdmUgc2lnbiBtYXkgb25seSBwcmVjZWRlIG51bWJlcnMuXG4gICAgICAgICAgICAgICAgaWYgKGlzU2lnbmVkKSB7XG4gICAgICAgICAgICAgICAgICBhYm9ydCgpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAvLyBgdHJ1ZWAsIGBmYWxzZWAsIGFuZCBgbnVsbGAgbGl0ZXJhbHMuXG4gICAgICAgICAgICAgICAgaWYgKHNvdXJjZS5zbGljZShJbmRleCwgSW5kZXggKyA0KSA9PSBcInRydWVcIikge1xuICAgICAgICAgICAgICAgICAgSW5kZXggKz0gNDtcbiAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoc291cmNlLnNsaWNlKEluZGV4LCBJbmRleCArIDUpID09IFwiZmFsc2VcIikge1xuICAgICAgICAgICAgICAgICAgSW5kZXggKz0gNTtcbiAgICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHNvdXJjZS5zbGljZShJbmRleCwgSW5kZXggKyA0KSA9PSBcIm51bGxcIikge1xuICAgICAgICAgICAgICAgICAgSW5kZXggKz0gNDtcbiAgICAgICAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAvLyBVbnJlY29nbml6ZWQgdG9rZW4uXG4gICAgICAgICAgICAgICAgYWJvcnQoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgLy8gUmV0dXJuIHRoZSBzZW50aW5lbCBgJGAgY2hhcmFjdGVyIGlmIHRoZSBwYXJzZXIgaGFzIHJlYWNoZWQgdGhlIGVuZFxuICAgICAgICAgIC8vIG9mIHRoZSBzb3VyY2Ugc3RyaW5nLlxuICAgICAgICAgIHJldHVybiBcIiRcIjtcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBJbnRlcm5hbDogUGFyc2VzIGEgSlNPTiBgdmFsdWVgIHRva2VuLlxuICAgICAgICB2YXIgZ2V0ID0gZnVuY3Rpb24gKHZhbHVlKSB7XG4gICAgICAgICAgdmFyIHJlc3VsdHMsIGhhc01lbWJlcnM7XG4gICAgICAgICAgaWYgKHZhbHVlID09IFwiJFwiKSB7XG4gICAgICAgICAgICAvLyBVbmV4cGVjdGVkIGVuZCBvZiBpbnB1dC5cbiAgICAgICAgICAgIGFib3J0KCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmICh0eXBlb2YgdmFsdWUgPT0gXCJzdHJpbmdcIikge1xuICAgICAgICAgICAgaWYgKChjaGFySW5kZXhCdWdneSA/IHZhbHVlLmNoYXJBdCgwKSA6IHZhbHVlWzBdKSA9PSBcIkBcIikge1xuICAgICAgICAgICAgICAvLyBSZW1vdmUgdGhlIHNlbnRpbmVsIGBAYCBjaGFyYWN0ZXIuXG4gICAgICAgICAgICAgIHJldHVybiB2YWx1ZS5zbGljZSgxKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIFBhcnNlIG9iamVjdCBhbmQgYXJyYXkgbGl0ZXJhbHMuXG4gICAgICAgICAgICBpZiAodmFsdWUgPT0gXCJbXCIpIHtcbiAgICAgICAgICAgICAgLy8gUGFyc2VzIGEgSlNPTiBhcnJheSwgcmV0dXJuaW5nIGEgbmV3IEphdmFTY3JpcHQgYXJyYXkuXG4gICAgICAgICAgICAgIHJlc3VsdHMgPSBbXTtcbiAgICAgICAgICAgICAgZm9yICg7OyBoYXNNZW1iZXJzIHx8IChoYXNNZW1iZXJzID0gdHJ1ZSkpIHtcbiAgICAgICAgICAgICAgICB2YWx1ZSA9IGxleCgpO1xuICAgICAgICAgICAgICAgIC8vIEEgY2xvc2luZyBzcXVhcmUgYnJhY2tldCBtYXJrcyB0aGUgZW5kIG9mIHRoZSBhcnJheSBsaXRlcmFsLlxuICAgICAgICAgICAgICAgIGlmICh2YWx1ZSA9PSBcIl1cIikge1xuICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIC8vIElmIHRoZSBhcnJheSBsaXRlcmFsIGNvbnRhaW5zIGVsZW1lbnRzLCB0aGUgY3VycmVudCB0b2tlblxuICAgICAgICAgICAgICAgIC8vIHNob3VsZCBiZSBhIGNvbW1hIHNlcGFyYXRpbmcgdGhlIHByZXZpb3VzIGVsZW1lbnQgZnJvbSB0aGVcbiAgICAgICAgICAgICAgICAvLyBuZXh0LlxuICAgICAgICAgICAgICAgIGlmIChoYXNNZW1iZXJzKSB7XG4gICAgICAgICAgICAgICAgICBpZiAodmFsdWUgPT0gXCIsXCIpIHtcbiAgICAgICAgICAgICAgICAgICAgdmFsdWUgPSBsZXgoKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHZhbHVlID09IFwiXVwiKSB7XG4gICAgICAgICAgICAgICAgICAgICAgLy8gVW5leHBlY3RlZCB0cmFpbGluZyBgLGAgaW4gYXJyYXkgbGl0ZXJhbC5cbiAgICAgICAgICAgICAgICAgICAgICBhYm9ydCgpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAvLyBBIGAsYCBtdXN0IHNlcGFyYXRlIGVhY2ggYXJyYXkgZWxlbWVudC5cbiAgICAgICAgICAgICAgICAgICAgYWJvcnQoKTtcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgLy8gRWxpc2lvbnMgYW5kIGxlYWRpbmcgY29tbWFzIGFyZSBub3QgcGVybWl0dGVkLlxuICAgICAgICAgICAgICAgIGlmICh2YWx1ZSA9PSBcIixcIikge1xuICAgICAgICAgICAgICAgICAgYWJvcnQoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmVzdWx0cy5wdXNoKGdldCh2YWx1ZSkpO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIHJldHVybiByZXN1bHRzO1xuICAgICAgICAgICAgfSBlbHNlIGlmICh2YWx1ZSA9PSBcIntcIikge1xuICAgICAgICAgICAgICAvLyBQYXJzZXMgYSBKU09OIG9iamVjdCwgcmV0dXJuaW5nIGEgbmV3IEphdmFTY3JpcHQgb2JqZWN0LlxuICAgICAgICAgICAgICByZXN1bHRzID0ge307XG4gICAgICAgICAgICAgIGZvciAoOzsgaGFzTWVtYmVycyB8fCAoaGFzTWVtYmVycyA9IHRydWUpKSB7XG4gICAgICAgICAgICAgICAgdmFsdWUgPSBsZXgoKTtcbiAgICAgICAgICAgICAgICAvLyBBIGNsb3NpbmcgY3VybHkgYnJhY2UgbWFya3MgdGhlIGVuZCBvZiB0aGUgb2JqZWN0IGxpdGVyYWwuXG4gICAgICAgICAgICAgICAgaWYgKHZhbHVlID09IFwifVwiKSB7XG4gICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgLy8gSWYgdGhlIG9iamVjdCBsaXRlcmFsIGNvbnRhaW5zIG1lbWJlcnMsIHRoZSBjdXJyZW50IHRva2VuXG4gICAgICAgICAgICAgICAgLy8gc2hvdWxkIGJlIGEgY29tbWEgc2VwYXJhdG9yLlxuICAgICAgICAgICAgICAgIGlmIChoYXNNZW1iZXJzKSB7XG4gICAgICAgICAgICAgICAgICBpZiAodmFsdWUgPT0gXCIsXCIpIHtcbiAgICAgICAgICAgICAgICAgICAgdmFsdWUgPSBsZXgoKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHZhbHVlID09IFwifVwiKSB7XG4gICAgICAgICAgICAgICAgICAgICAgLy8gVW5leHBlY3RlZCB0cmFpbGluZyBgLGAgaW4gb2JqZWN0IGxpdGVyYWwuXG4gICAgICAgICAgICAgICAgICAgICAgYWJvcnQoKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gQSBgLGAgbXVzdCBzZXBhcmF0ZSBlYWNoIG9iamVjdCBtZW1iZXIuXG4gICAgICAgICAgICAgICAgICAgIGFib3J0KCk7XG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIC8vIExlYWRpbmcgY29tbWFzIGFyZSBub3QgcGVybWl0dGVkLCBvYmplY3QgcHJvcGVydHkgbmFtZXMgbXVzdCBiZVxuICAgICAgICAgICAgICAgIC8vIGRvdWJsZS1xdW90ZWQgc3RyaW5ncywgYW5kIGEgYDpgIG11c3Qgc2VwYXJhdGUgZWFjaCBwcm9wZXJ0eVxuICAgICAgICAgICAgICAgIC8vIG5hbWUgYW5kIHZhbHVlLlxuICAgICAgICAgICAgICAgIGlmICh2YWx1ZSA9PSBcIixcIiB8fCB0eXBlb2YgdmFsdWUgIT0gXCJzdHJpbmdcIiB8fCAoY2hhckluZGV4QnVnZ3kgPyB2YWx1ZS5jaGFyQXQoMCkgOiB2YWx1ZVswXSkgIT0gXCJAXCIgfHwgbGV4KCkgIT0gXCI6XCIpIHtcbiAgICAgICAgICAgICAgICAgIGFib3J0KCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJlc3VsdHNbdmFsdWUuc2xpY2UoMSldID0gZ2V0KGxleCgpKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICByZXR1cm4gcmVzdWx0cztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIFVuZXhwZWN0ZWQgdG9rZW4gZW5jb3VudGVyZWQuXG4gICAgICAgICAgICBhYm9ydCgpO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gdmFsdWU7XG4gICAgICAgIH07XG5cbiAgICAgICAgLy8gSW50ZXJuYWw6IFVwZGF0ZXMgYSB0cmF2ZXJzZWQgb2JqZWN0IG1lbWJlci5cbiAgICAgICAgdmFyIHVwZGF0ZSA9IGZ1bmN0aW9uIChzb3VyY2UsIHByb3BlcnR5LCBjYWxsYmFjaykge1xuICAgICAgICAgIHZhciBlbGVtZW50ID0gd2Fsayhzb3VyY2UsIHByb3BlcnR5LCBjYWxsYmFjayk7XG4gICAgICAgICAgaWYgKGVsZW1lbnQgPT09IHVuZGVmKSB7XG4gICAgICAgICAgICBkZWxldGUgc291cmNlW3Byb3BlcnR5XTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgc291cmNlW3Byb3BlcnR5XSA9IGVsZW1lbnQ7XG4gICAgICAgICAgfVxuICAgICAgICB9O1xuXG4gICAgICAgIC8vIEludGVybmFsOiBSZWN1cnNpdmVseSB0cmF2ZXJzZXMgYSBwYXJzZWQgSlNPTiBvYmplY3QsIGludm9raW5nIHRoZVxuICAgICAgICAvLyBgY2FsbGJhY2tgIGZ1bmN0aW9uIGZvciBlYWNoIHZhbHVlLiBUaGlzIGlzIGFuIGltcGxlbWVudGF0aW9uIG9mIHRoZVxuICAgICAgICAvLyBgV2Fsayhob2xkZXIsIG5hbWUpYCBvcGVyYXRpb24gZGVmaW5lZCBpbiBFUyA1LjEgc2VjdGlvbiAxNS4xMi4yLlxuICAgICAgICB2YXIgd2FsayA9IGZ1bmN0aW9uIChzb3VyY2UsIHByb3BlcnR5LCBjYWxsYmFjaykge1xuICAgICAgICAgIHZhciB2YWx1ZSA9IHNvdXJjZVtwcm9wZXJ0eV0sIGxlbmd0aDtcbiAgICAgICAgICBpZiAodHlwZW9mIHZhbHVlID09IFwib2JqZWN0XCIgJiYgdmFsdWUpIHtcbiAgICAgICAgICAgIC8vIGBmb3JFYWNoYCBjYW4ndCBiZSB1c2VkIHRvIHRyYXZlcnNlIGFuIGFycmF5IGluIE9wZXJhIDw9IDguNTRcbiAgICAgICAgICAgIC8vIGJlY2F1c2UgaXRzIGBPYmplY3QjaGFzT3duUHJvcGVydHlgIGltcGxlbWVudGF0aW9uIHJldHVybnMgYGZhbHNlYFxuICAgICAgICAgICAgLy8gZm9yIGFycmF5IGluZGljZXMgKGUuZy4sIGAhWzEsIDIsIDNdLmhhc093blByb3BlcnR5KFwiMFwiKWApLlxuICAgICAgICAgICAgaWYgKGdldENsYXNzLmNhbGwodmFsdWUpID09IGFycmF5Q2xhc3MpIHtcbiAgICAgICAgICAgICAgZm9yIChsZW5ndGggPSB2YWx1ZS5sZW5ndGg7IGxlbmd0aC0tOykge1xuICAgICAgICAgICAgICAgIHVwZGF0ZSh2YWx1ZSwgbGVuZ3RoLCBjYWxsYmFjayk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIGZvckVhY2godmFsdWUsIGZ1bmN0aW9uIChwcm9wZXJ0eSkge1xuICAgICAgICAgICAgICAgIHVwZGF0ZSh2YWx1ZSwgcHJvcGVydHksIGNhbGxiYWNrKTtcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiBjYWxsYmFjay5jYWxsKHNvdXJjZSwgcHJvcGVydHksIHZhbHVlKTtcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBQdWJsaWM6IGBKU09OLnBhcnNlYC4gU2VlIEVTIDUuMSBzZWN0aW9uIDE1LjEyLjIuXG4gICAgICAgIGV4cG9ydHMucGFyc2UgPSBmdW5jdGlvbiAoc291cmNlLCBjYWxsYmFjaykge1xuICAgICAgICAgIHZhciByZXN1bHQsIHZhbHVlO1xuICAgICAgICAgIEluZGV4ID0gMDtcbiAgICAgICAgICBTb3VyY2UgPSBcIlwiICsgc291cmNlO1xuICAgICAgICAgIHJlc3VsdCA9IGdldChsZXgoKSk7XG4gICAgICAgICAgLy8gSWYgYSBKU09OIHN0cmluZyBjb250YWlucyBtdWx0aXBsZSB0b2tlbnMsIGl0IGlzIGludmFsaWQuXG4gICAgICAgICAgaWYgKGxleCgpICE9IFwiJFwiKSB7XG4gICAgICAgICAgICBhYm9ydCgpO1xuICAgICAgICAgIH1cbiAgICAgICAgICAvLyBSZXNldCB0aGUgcGFyc2VyIHN0YXRlLlxuICAgICAgICAgIEluZGV4ID0gU291cmNlID0gbnVsbDtcbiAgICAgICAgICByZXR1cm4gY2FsbGJhY2sgJiYgZ2V0Q2xhc3MuY2FsbChjYWxsYmFjaykgPT0gZnVuY3Rpb25DbGFzcyA/IHdhbGsoKHZhbHVlID0ge30sIHZhbHVlW1wiXCJdID0gcmVzdWx0LCB2YWx1ZSksIFwiXCIsIGNhbGxiYWNrKSA6IHJlc3VsdDtcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBleHBvcnRzW1wicnVuSW5Db250ZXh0XCJdID0gcnVuSW5Db250ZXh0O1xuICAgIHJldHVybiBleHBvcnRzO1xuICB9XG5cbiAgaWYgKGZyZWVFeHBvcnRzICYmICFpc0xvYWRlcikge1xuICAgIC8vIEV4cG9ydCBmb3IgQ29tbW9uSlMgZW52aXJvbm1lbnRzLlxuICAgIHJ1bkluQ29udGV4dChyb290LCBmcmVlRXhwb3J0cyk7XG4gIH0gZWxzZSB7XG4gICAgLy8gRXhwb3J0IGZvciB3ZWIgYnJvd3NlcnMgYW5kIEphdmFTY3JpcHQgZW5naW5lcy5cbiAgICB2YXIgbmF0aXZlSlNPTiA9IHJvb3QuSlNPTixcbiAgICAgICAgcHJldmlvdXNKU09OID0gcm9vdFtcIkpTT04zXCJdLFxuICAgICAgICBpc1Jlc3RvcmVkID0gZmFsc2U7XG5cbiAgICB2YXIgSlNPTjMgPSBydW5JbkNvbnRleHQocm9vdCwgKHJvb3RbXCJKU09OM1wiXSA9IHtcbiAgICAgIC8vIFB1YmxpYzogUmVzdG9yZXMgdGhlIG9yaWdpbmFsIHZhbHVlIG9mIHRoZSBnbG9iYWwgYEpTT05gIG9iamVjdCBhbmRcbiAgICAgIC8vIHJldHVybnMgYSByZWZlcmVuY2UgdG8gdGhlIGBKU09OM2Agb2JqZWN0LlxuICAgICAgXCJub0NvbmZsaWN0XCI6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgaWYgKCFpc1Jlc3RvcmVkKSB7XG4gICAgICAgICAgaXNSZXN0b3JlZCA9IHRydWU7XG4gICAgICAgICAgcm9vdC5KU09OID0gbmF0aXZlSlNPTjtcbiAgICAgICAgICByb290W1wiSlNPTjNcIl0gPSBwcmV2aW91c0pTT047XG4gICAgICAgICAgbmF0aXZlSlNPTiA9IHByZXZpb3VzSlNPTiA9IG51bGw7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIEpTT04zO1xuICAgICAgfVxuICAgIH0pKTtcblxuICAgIHJvb3QuSlNPTiA9IHtcbiAgICAgIFwicGFyc2VcIjogSlNPTjMucGFyc2UsXG4gICAgICBcInN0cmluZ2lmeVwiOiBKU09OMy5zdHJpbmdpZnlcbiAgICB9O1xuICB9XG5cbiAgLy8gRXhwb3J0IGZvciBhc3luY2hyb25vdXMgbW9kdWxlIGxvYWRlcnMuXG4gIGlmIChpc0xvYWRlcikge1xuICAgIGRlZmluZShmdW5jdGlvbiAoKSB7XG4gICAgICByZXR1cm4gSlNPTjM7XG4gICAgfSk7XG4gIH1cbn0pLmNhbGwodGhpcyk7XG5cbn0pLmNhbGwodGhpcyx0eXBlb2Ygc2VsZiAhPT0gXCJ1bmRlZmluZWRcIiA/IHNlbGYgOiB0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiID8gd2luZG93IDoge30pIiwiLypcbiAqIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIEpTVE9SQUdFIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAqIFNpbXBsZSBsb2NhbCBzdG9yYWdlIHdyYXBwZXIgdG8gc2F2ZSBkYXRhIG9uIHRoZSBicm93c2VyIHNpZGUsIHN1cHBvcnRpbmdcbiAqIGFsbCBtYWpvciBicm93c2VycyAtIElFNissIEZpcmVmb3gyKywgU2FmYXJpNCssIENocm9tZTQrIGFuZCBPcGVyYSAxMC41K1xuICpcbiAqIEF1dGhvcjogQW5kcmlzIFJlaW5tYW4sIGFuZHJpcy5yZWlubWFuQGdtYWlsLmNvbVxuICogUHJvamVjdCBob21lcGFnZTogd3d3LmpzdG9yYWdlLmluZm9cbiAqXG4gKiBMaWNlbnNlZCB1bmRlciBVbmxpY2Vuc2U6XG4gKlxuICogVGhpcyBpcyBmcmVlIGFuZCB1bmVuY3VtYmVyZWQgc29mdHdhcmUgcmVsZWFzZWQgaW50byB0aGUgcHVibGljIGRvbWFpbi5cbiAqIFxuICogQW55b25lIGlzIGZyZWUgdG8gY29weSwgbW9kaWZ5LCBwdWJsaXNoLCB1c2UsIGNvbXBpbGUsIHNlbGwsIG9yXG4gKiBkaXN0cmlidXRlIHRoaXMgc29mdHdhcmUsIGVpdGhlciBpbiBzb3VyY2UgY29kZSBmb3JtIG9yIGFzIGEgY29tcGlsZWRcbiAqIGJpbmFyeSwgZm9yIGFueSBwdXJwb3NlLCBjb21tZXJjaWFsIG9yIG5vbi1jb21tZXJjaWFsLCBhbmQgYnkgYW55XG4gKiBtZWFucy5cbiAqIFxuICogSW4ganVyaXNkaWN0aW9ucyB0aGF0IHJlY29nbml6ZSBjb3B5cmlnaHQgbGF3cywgdGhlIGF1dGhvciBvciBhdXRob3JzXG4gKiBvZiB0aGlzIHNvZnR3YXJlIGRlZGljYXRlIGFueSBhbmQgYWxsIGNvcHlyaWdodCBpbnRlcmVzdCBpbiB0aGVcbiAqIHNvZnR3YXJlIHRvIHRoZSBwdWJsaWMgZG9tYWluLiBXZSBtYWtlIHRoaXMgZGVkaWNhdGlvbiBmb3IgdGhlIGJlbmVmaXRcbiAqIG9mIHRoZSBwdWJsaWMgYXQgbGFyZ2UgYW5kIHRvIHRoZSBkZXRyaW1lbnQgb2Ygb3VyIGhlaXJzIGFuZFxuICogc3VjY2Vzc29ycy4gV2UgaW50ZW5kIHRoaXMgZGVkaWNhdGlvbiB0byBiZSBhbiBvdmVydCBhY3Qgb2ZcbiAqIHJlbGlucXVpc2htZW50IGluIHBlcnBldHVpdHkgb2YgYWxsIHByZXNlbnQgYW5kIGZ1dHVyZSByaWdodHMgdG8gdGhpc1xuICogc29mdHdhcmUgdW5kZXIgY29weXJpZ2h0IGxhdy5cbiAqIFxuICogVEhFIFNPRlRXQVJFIElTIFBST1ZJREVEIFwiQVMgSVNcIiwgV0lUSE9VVCBXQVJSQU5UWSBPRiBBTlkgS0lORCxcbiAqIEVYUFJFU1MgT1IgSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRlxuICogTUVSQ0hBTlRBQklMSVRZLCBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULlxuICogSU4gTk8gRVZFTlQgU0hBTEwgVEhFIEFVVEhPUlMgQkUgTElBQkxFIEZPUiBBTlkgQ0xBSU0sIERBTUFHRVMgT1JcbiAqIE9USEVSIExJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1IgT1RIRVJXSVNFLFxuICogQVJJU0lORyBGUk9NLCBPVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEUgVVNFIE9SXG4gKiBPVEhFUiBERUFMSU5HUyBJTiBUSEUgU09GVFdBUkUuXG4gKiBcbiAqIEZvciBtb3JlIGluZm9ybWF0aW9uLCBwbGVhc2UgcmVmZXIgdG8gPGh0dHA6Ly91bmxpY2Vuc2Uub3JnLz5cbiAqL1xuXG4gKGZ1bmN0aW9uKCl7XG4gICAgdmFyXG4gICAgICAgIC8qIGpTdG9yYWdlIHZlcnNpb24gKi9cbiAgICAgICAgSlNUT1JBR0VfVkVSU0lPTiA9IFwiMC40LjhcIixcblxuICAgICAgICAvKiBkZXRlY3QgYSBkb2xsYXIgb2JqZWN0IG9yIGNyZWF0ZSBvbmUgaWYgbm90IGZvdW5kICovXG4gICAgICAgICQgPSB3aW5kb3cualF1ZXJ5IHx8IHdpbmRvdy4kIHx8ICh3aW5kb3cuJCA9IHt9KSxcblxuICAgICAgICAvKiBjaGVjayBmb3IgYSBKU09OIGhhbmRsaW5nIHN1cHBvcnQgKi9cbiAgICAgICAgSlNPTiA9IHtcbiAgICAgICAgICAgIHBhcnNlOlxuICAgICAgICAgICAgICAgIHdpbmRvdy5KU09OICYmICh3aW5kb3cuSlNPTi5wYXJzZSB8fCB3aW5kb3cuSlNPTi5kZWNvZGUpIHx8XG4gICAgICAgICAgICAgICAgU3RyaW5nLnByb3RvdHlwZS5ldmFsSlNPTiAmJiBmdW5jdGlvbihzdHIpe3JldHVybiBTdHJpbmcoc3RyKS5ldmFsSlNPTigpO30gfHxcbiAgICAgICAgICAgICAgICAkLnBhcnNlSlNPTiB8fFxuICAgICAgICAgICAgICAgICQuZXZhbEpTT04sXG4gICAgICAgICAgICBzdHJpbmdpZnk6XG4gICAgICAgICAgICAgICAgT2JqZWN0LnRvSlNPTiB8fFxuICAgICAgICAgICAgICAgIHdpbmRvdy5KU09OICYmICh3aW5kb3cuSlNPTi5zdHJpbmdpZnkgfHwgd2luZG93LkpTT04uZW5jb2RlKSB8fFxuICAgICAgICAgICAgICAgICQudG9KU09OXG4gICAgICAgIH07XG5cbiAgICAvLyBCcmVhayBpZiBubyBKU09OIHN1cHBvcnQgd2FzIGZvdW5kXG4gICAgaWYoIShcInBhcnNlXCIgaW4gSlNPTikgfHwgIShcInN0cmluZ2lmeVwiIGluIEpTT04pKXtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiTm8gSlNPTiBzdXBwb3J0IGZvdW5kLCBpbmNsdWRlIC8vY2RuanMuY2xvdWRmbGFyZS5jb20vYWpheC9saWJzL2pzb24yLzIwMTEwMjIzL2pzb24yLmpzIHRvIHBhZ2VcIik7XG4gICAgfVxuXG4gICAgdmFyXG4gICAgICAgIC8qIFRoaXMgaXMgdGhlIG9iamVjdCwgdGhhdCBob2xkcyB0aGUgY2FjaGVkIHZhbHVlcyAqL1xuICAgICAgICBfc3RvcmFnZSA9IHtfX2pzdG9yYWdlX21ldGE6e0NSQzMyOnt9fX0sXG5cbiAgICAgICAgLyogQWN0dWFsIGJyb3dzZXIgc3RvcmFnZSAobG9jYWxTdG9yYWdlIG9yIGdsb2JhbFN0b3JhZ2VbXCJkb21haW5cIl0pICovXG4gICAgICAgIF9zdG9yYWdlX3NlcnZpY2UgPSB7alN0b3JhZ2U6XCJ7fVwifSxcblxuICAgICAgICAvKiBET00gZWxlbWVudCBmb3Igb2xkZXIgSUUgdmVyc2lvbnMsIGhvbGRzIHVzZXJEYXRhIGJlaGF2aW9yICovXG4gICAgICAgIF9zdG9yYWdlX2VsbSA9IG51bGwsXG5cbiAgICAgICAgLyogSG93IG11Y2ggc3BhY2UgZG9lcyB0aGUgc3RvcmFnZSB0YWtlICovXG4gICAgICAgIF9zdG9yYWdlX3NpemUgPSAwLFxuXG4gICAgICAgIC8qIHdoaWNoIGJhY2tlbmQgaXMgY3VycmVudGx5IHVzZWQgKi9cbiAgICAgICAgX2JhY2tlbmQgPSBmYWxzZSxcblxuICAgICAgICAvKiBvbmNoYW5nZSBvYnNlcnZlcnMgKi9cbiAgICAgICAgX29ic2VydmVycyA9IHt9LFxuXG4gICAgICAgIC8qIHRpbWVvdXQgdG8gd2FpdCBhZnRlciBvbmNoYW5nZSBldmVudCAqL1xuICAgICAgICBfb2JzZXJ2ZXJfdGltZW91dCA9IGZhbHNlLFxuXG4gICAgICAgIC8qIGxhc3QgdXBkYXRlIHRpbWUgKi9cbiAgICAgICAgX29ic2VydmVyX3VwZGF0ZSA9IDAsXG5cbiAgICAgICAgLyogcHVic3ViIG9ic2VydmVycyAqL1xuICAgICAgICBfcHVic3ViX29ic2VydmVycyA9IHt9LFxuXG4gICAgICAgIC8qIHNraXAgcHVibGlzaGVkIGl0ZW1zIG9sZGVyIHRoYW4gY3VycmVudCB0aW1lc3RhbXAgKi9cbiAgICAgICAgX3B1YnN1Yl9sYXN0ID0gK25ldyBEYXRlKCksXG5cbiAgICAgICAgLyogTmV4dCBjaGVjayBmb3IgVFRMICovXG4gICAgICAgIF90dGxfdGltZW91dCxcblxuICAgICAgICAvKipcbiAgICAgICAgICogWE1MIGVuY29kaW5nIGFuZCBkZWNvZGluZyBhcyBYTUwgbm9kZXMgY2FuJ3QgYmUgSlNPTidpemVkXG4gICAgICAgICAqIFhNTCBub2RlcyBhcmUgZW5jb2RlZCBhbmQgZGVjb2RlZCBpZiB0aGUgbm9kZSBpcyB0aGUgdmFsdWUgdG8gYmUgc2F2ZWRcbiAgICAgICAgICogYnV0IG5vdCBpZiBpdCdzIGFzIGEgcHJvcGVydHkgb2YgYW5vdGhlciBvYmplY3RcbiAgICAgICAgICogRWcuIC1cbiAgICAgICAgICogICAkLmpTdG9yYWdlLnNldChcImtleVwiLCB4bWxOb2RlKTsgICAgICAgIC8vIElTIE9LXG4gICAgICAgICAqICAgJC5qU3RvcmFnZS5zZXQoXCJrZXlcIiwge3htbDogeG1sTm9kZX0pOyAvLyBOT1QgT0tcbiAgICAgICAgICovXG4gICAgICAgIF9YTUxTZXJ2aWNlID0ge1xuXG4gICAgICAgICAgICAvKipcbiAgICAgICAgICAgICAqIFZhbGlkYXRlcyBhIFhNTCBub2RlIHRvIGJlIFhNTFxuICAgICAgICAgICAgICogYmFzZWQgb24galF1ZXJ5LmlzWE1MIGZ1bmN0aW9uXG4gICAgICAgICAgICAgKi9cbiAgICAgICAgICAgIGlzWE1MOiBmdW5jdGlvbihlbG0pe1xuICAgICAgICAgICAgICAgIHZhciBkb2N1bWVudEVsZW1lbnQgPSAoZWxtID8gZWxtLm93bmVyRG9jdW1lbnQgfHwgZWxtIDogMCkuZG9jdW1lbnRFbGVtZW50O1xuICAgICAgICAgICAgICAgIHJldHVybiBkb2N1bWVudEVsZW1lbnQgPyBkb2N1bWVudEVsZW1lbnQubm9kZU5hbWUgIT09IFwiSFRNTFwiIDogZmFsc2U7XG4gICAgICAgICAgICB9LFxuXG4gICAgICAgICAgICAvKipcbiAgICAgICAgICAgICAqIEVuY29kZXMgYSBYTUwgbm9kZSB0byBzdHJpbmdcbiAgICAgICAgICAgICAqIGJhc2VkIG9uIGh0dHA6Ly93d3cubWVyY3VyeXRpZGUuY28udWsvbmV3cy9hcnRpY2xlL2lzc3Vlcy13aGVuLXdvcmtpbmctYWpheC9cbiAgICAgICAgICAgICAqL1xuICAgICAgICAgICAgZW5jb2RlOiBmdW5jdGlvbih4bWxOb2RlKSB7XG4gICAgICAgICAgICAgICAgaWYoIXRoaXMuaXNYTUwoeG1sTm9kZSkpe1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHRyeXsgLy8gTW96aWxsYSwgV2Via2l0LCBPcGVyYVxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gbmV3IFhNTFNlcmlhbGl6ZXIoKS5zZXJpYWxpemVUb1N0cmluZyh4bWxOb2RlKTtcbiAgICAgICAgICAgICAgICB9Y2F0Y2goRTEpIHtcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHsgIC8vIElFXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4geG1sTm9kZS54bWw7XG4gICAgICAgICAgICAgICAgICAgIH1jYXRjaChFMil7fVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICB9LFxuXG4gICAgICAgICAgICAvKipcbiAgICAgICAgICAgICAqIERlY29kZXMgYSBYTUwgbm9kZSBmcm9tIHN0cmluZ1xuICAgICAgICAgICAgICogbG9vc2VseSBiYXNlZCBvbiBodHRwOi8vb3V0d2VzdG1lZGlhLmNvbS9qcXVlcnktcGx1Z2lucy94bWxkb20vXG4gICAgICAgICAgICAgKi9cbiAgICAgICAgICAgIGRlY29kZTogZnVuY3Rpb24oeG1sU3RyaW5nKXtcbiAgICAgICAgICAgICAgICB2YXIgZG9tX3BhcnNlciA9IChcIkRPTVBhcnNlclwiIGluIHdpbmRvdyAmJiAobmV3IERPTVBhcnNlcigpKS5wYXJzZUZyb21TdHJpbmcpIHx8XG4gICAgICAgICAgICAgICAgICAgICAgICAod2luZG93LkFjdGl2ZVhPYmplY3QgJiYgZnVuY3Rpb24oX3htbFN0cmluZykge1xuICAgICAgICAgICAgICAgICAgICB2YXIgeG1sX2RvYyA9IG5ldyBBY3RpdmVYT2JqZWN0KFwiTWljcm9zb2Z0LlhNTERPTVwiKTtcbiAgICAgICAgICAgICAgICAgICAgeG1sX2RvYy5hc3luYyA9IFwiZmFsc2VcIjtcbiAgICAgICAgICAgICAgICAgICAgeG1sX2RvYy5sb2FkWE1MKF94bWxTdHJpbmcpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4geG1sX2RvYztcbiAgICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgICByZXN1bHRYTUw7XG4gICAgICAgICAgICAgICAgaWYoIWRvbV9wYXJzZXIpe1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJlc3VsdFhNTCA9IGRvbV9wYXJzZXIuY2FsbChcIkRPTVBhcnNlclwiIGluIHdpbmRvdyAmJiAobmV3IERPTVBhcnNlcigpKSB8fCB3aW5kb3csIHhtbFN0cmluZywgXCJ0ZXh0L3htbFwiKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5pc1hNTChyZXN1bHRYTUwpP3Jlc3VsdFhNTDpmYWxzZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcblxuXG4gICAgLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8gUFJJVkFURSBNRVRIT0RTIC8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vL1xuXG4gICAgLyoqXG4gICAgICogSW5pdGlhbGl6YXRpb24gZnVuY3Rpb24uIERldGVjdHMgaWYgdGhlIGJyb3dzZXIgc3VwcG9ydHMgRE9NIFN0b3JhZ2VcbiAgICAgKiBvciB1c2VyRGF0YSBiZWhhdmlvciBhbmQgYmVoYXZlcyBhY2NvcmRpbmdseS5cbiAgICAgKi9cbiAgICBmdW5jdGlvbiBfaW5pdCgpe1xuICAgICAgICAvKiBDaGVjayBpZiBicm93c2VyIHN1cHBvcnRzIGxvY2FsU3RvcmFnZSAqL1xuICAgICAgICB2YXIgbG9jYWxTdG9yYWdlUmVhbGx5V29ya3MgPSBmYWxzZTtcbiAgICAgICAgaWYoXCJsb2NhbFN0b3JhZ2VcIiBpbiB3aW5kb3cpe1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICB3aW5kb3cubG9jYWxTdG9yYWdlLnNldEl0ZW0oXCJfdG1wdGVzdFwiLCBcInRtcHZhbFwiKTtcbiAgICAgICAgICAgICAgICBsb2NhbFN0b3JhZ2VSZWFsbHlXb3JrcyA9IHRydWU7XG4gICAgICAgICAgICAgICAgd2luZG93LmxvY2FsU3RvcmFnZS5yZW1vdmVJdGVtKFwiX3RtcHRlc3RcIik7XG4gICAgICAgICAgICB9IGNhdGNoKEJvZ3VzUXVvdGFFeGNlZWRlZEVycm9yT25Jb3M1KSB7XG4gICAgICAgICAgICAgICAgLy8gVGhhbmtzIGJlIHRvIGlPUzUgUHJpdmF0ZSBCcm93c2luZyBtb2RlIHdoaWNoIHRocm93c1xuICAgICAgICAgICAgICAgIC8vIFFVT1RBX0VYQ0VFREVEX0VSUlJPUiBET00gRXhjZXB0aW9uIDIyLlxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYobG9jYWxTdG9yYWdlUmVhbGx5V29ya3Mpe1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBpZih3aW5kb3cubG9jYWxTdG9yYWdlKSB7XG4gICAgICAgICAgICAgICAgICAgIF9zdG9yYWdlX3NlcnZpY2UgPSB3aW5kb3cubG9jYWxTdG9yYWdlO1xuICAgICAgICAgICAgICAgICAgICBfYmFja2VuZCA9IFwibG9jYWxTdG9yYWdlXCI7XG4gICAgICAgICAgICAgICAgICAgIF9vYnNlcnZlcl91cGRhdGUgPSBfc3RvcmFnZV9zZXJ2aWNlLmpTdG9yYWdlX3VwZGF0ZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGNhdGNoKEUzKSB7LyogRmlyZWZveCBmYWlscyB3aGVuIHRvdWNoaW5nIGxvY2FsU3RvcmFnZSBhbmQgY29va2llcyBhcmUgZGlzYWJsZWQgKi99XG4gICAgICAgIH1cbiAgICAgICAgLyogQ2hlY2sgaWYgYnJvd3NlciBzdXBwb3J0cyBnbG9iYWxTdG9yYWdlICovXG4gICAgICAgIGVsc2UgaWYoXCJnbG9iYWxTdG9yYWdlXCIgaW4gd2luZG93KXtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgaWYod2luZG93Lmdsb2JhbFN0b3JhZ2UpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYod2luZG93LmxvY2F0aW9uLmhvc3RuYW1lID09IFwibG9jYWxob3N0XCIpe1xuICAgICAgICAgICAgICAgICAgICAgICAgX3N0b3JhZ2Vfc2VydmljZSA9IHdpbmRvdy5nbG9iYWxTdG9yYWdlW1wibG9jYWxob3N0LmxvY2FsZG9tYWluXCJdO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGVsc2V7XG4gICAgICAgICAgICAgICAgICAgICAgICBfc3RvcmFnZV9zZXJ2aWNlID0gd2luZG93Lmdsb2JhbFN0b3JhZ2Vbd2luZG93LmxvY2F0aW9uLmhvc3RuYW1lXTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBfYmFja2VuZCA9IFwiZ2xvYmFsU3RvcmFnZVwiO1xuICAgICAgICAgICAgICAgICAgICBfb2JzZXJ2ZXJfdXBkYXRlID0gX3N0b3JhZ2Vfc2VydmljZS5qU3RvcmFnZV91cGRhdGU7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBjYXRjaChFNCkgey8qIEZpcmVmb3ggZmFpbHMgd2hlbiB0b3VjaGluZyBsb2NhbFN0b3JhZ2UgYW5kIGNvb2tpZXMgYXJlIGRpc2FibGVkICovfVxuICAgICAgICB9XG4gICAgICAgIC8qIENoZWNrIGlmIGJyb3dzZXIgc3VwcG9ydHMgdXNlckRhdGEgYmVoYXZpb3IgKi9cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBfc3RvcmFnZV9lbG0gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwibGlua1wiKTtcbiAgICAgICAgICAgIGlmKF9zdG9yYWdlX2VsbS5hZGRCZWhhdmlvcil7XG5cbiAgICAgICAgICAgICAgICAvKiBVc2UgYSBET00gZWxlbWVudCB0byBhY3QgYXMgdXNlckRhdGEgc3RvcmFnZSAqL1xuICAgICAgICAgICAgICAgIF9zdG9yYWdlX2VsbS5zdHlsZS5iZWhhdmlvciA9IFwidXJsKCNkZWZhdWx0I3VzZXJEYXRhKVwiO1xuXG4gICAgICAgICAgICAgICAgLyogdXNlckRhdGEgZWxlbWVudCBuZWVkcyB0byBiZSBpbnNlcnRlZCBpbnRvIHRoZSBET00hICovXG4gICAgICAgICAgICAgICAgZG9jdW1lbnQuZ2V0RWxlbWVudHNCeVRhZ05hbWUoXCJoZWFkXCIpWzBdLmFwcGVuZENoaWxkKF9zdG9yYWdlX2VsbSk7XG5cbiAgICAgICAgICAgICAgICB0cnl7XG4gICAgICAgICAgICAgICAgICAgIF9zdG9yYWdlX2VsbS5sb2FkKFwialN0b3JhZ2VcIik7XG4gICAgICAgICAgICAgICAgfWNhdGNoKEUpe1xuICAgICAgICAgICAgICAgICAgICAvLyB0cnkgdG8gcmVzZXQgY2FjaGVcbiAgICAgICAgICAgICAgICAgICAgX3N0b3JhZ2VfZWxtLnNldEF0dHJpYnV0ZShcImpTdG9yYWdlXCIsIFwie31cIik7XG4gICAgICAgICAgICAgICAgICAgIF9zdG9yYWdlX2VsbS5zYXZlKFwialN0b3JhZ2VcIik7XG4gICAgICAgICAgICAgICAgICAgIF9zdG9yYWdlX2VsbS5sb2FkKFwialN0b3JhZ2VcIik7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgdmFyIGRhdGEgPSBcInt9XCI7XG4gICAgICAgICAgICAgICAgdHJ5e1xuICAgICAgICAgICAgICAgICAgICBkYXRhID0gX3N0b3JhZ2VfZWxtLmdldEF0dHJpYnV0ZShcImpTdG9yYWdlXCIpO1xuICAgICAgICAgICAgICAgIH1jYXRjaChFNSl7fVxuXG4gICAgICAgICAgICAgICAgdHJ5e1xuICAgICAgICAgICAgICAgICAgICBfb2JzZXJ2ZXJfdXBkYXRlID0gX3N0b3JhZ2VfZWxtLmdldEF0dHJpYnV0ZShcImpTdG9yYWdlX3VwZGF0ZVwiKTtcbiAgICAgICAgICAgICAgICB9Y2F0Y2goRTYpe31cblxuICAgICAgICAgICAgICAgIF9zdG9yYWdlX3NlcnZpY2UualN0b3JhZ2UgPSBkYXRhO1xuICAgICAgICAgICAgICAgIF9iYWNrZW5kID0gXCJ1c2VyRGF0YUJlaGF2aW9yXCI7XG4gICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICBfc3RvcmFnZV9lbG0gPSBudWxsO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIExvYWQgZGF0YSBmcm9tIHN0b3JhZ2VcbiAgICAgICAgX2xvYWRfc3RvcmFnZSgpO1xuXG4gICAgICAgIC8vIHJlbW92ZSBkZWFkIGtleXNcbiAgICAgICAgX2hhbmRsZVRUTCgpO1xuXG4gICAgICAgIC8vIHN0YXJ0IGxpc3RlbmluZyBmb3IgY2hhbmdlc1xuICAgICAgICBfc2V0dXBPYnNlcnZlcigpO1xuXG4gICAgICAgIC8vIGluaXRpYWxpemUgcHVibGlzaC1zdWJzY3JpYmUgc2VydmljZVxuICAgICAgICBfaGFuZGxlUHViU3ViKCk7XG5cbiAgICAgICAgLy8gaGFuZGxlIGNhY2hlZCBuYXZpZ2F0aW9uXG4gICAgICAgIGlmKFwiYWRkRXZlbnRMaXN0ZW5lclwiIGluIHdpbmRvdyl7XG4gICAgICAgICAgICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcihcInBhZ2VzaG93XCIsIGZ1bmN0aW9uKGV2ZW50KXtcbiAgICAgICAgICAgICAgICBpZihldmVudC5wZXJzaXN0ZWQpe1xuICAgICAgICAgICAgICAgICAgICBfc3RvcmFnZU9ic2VydmVyKCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSwgZmFsc2UpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUmVsb2FkIGRhdGEgZnJvbSBzdG9yYWdlIHdoZW4gbmVlZGVkXG4gICAgICovXG4gICAgZnVuY3Rpb24gX3JlbG9hZERhdGEoKXtcbiAgICAgICAgdmFyIGRhdGEgPSBcInt9XCI7XG5cbiAgICAgICAgaWYoX2JhY2tlbmQgPT0gXCJ1c2VyRGF0YUJlaGF2aW9yXCIpe1xuICAgICAgICAgICAgX3N0b3JhZ2VfZWxtLmxvYWQoXCJqU3RvcmFnZVwiKTtcblxuICAgICAgICAgICAgdHJ5e1xuICAgICAgICAgICAgICAgIGRhdGEgPSBfc3RvcmFnZV9lbG0uZ2V0QXR0cmlidXRlKFwialN0b3JhZ2VcIik7XG4gICAgICAgICAgICB9Y2F0Y2goRTUpe31cblxuICAgICAgICAgICAgdHJ5e1xuICAgICAgICAgICAgICAgIF9vYnNlcnZlcl91cGRhdGUgPSBfc3RvcmFnZV9lbG0uZ2V0QXR0cmlidXRlKFwialN0b3JhZ2VfdXBkYXRlXCIpO1xuICAgICAgICAgICAgfWNhdGNoKEU2KXt9XG5cbiAgICAgICAgICAgIF9zdG9yYWdlX3NlcnZpY2UualN0b3JhZ2UgPSBkYXRhO1xuICAgICAgICB9XG5cbiAgICAgICAgX2xvYWRfc3RvcmFnZSgpO1xuXG4gICAgICAgIC8vIHJlbW92ZSBkZWFkIGtleXNcbiAgICAgICAgX2hhbmRsZVRUTCgpO1xuXG4gICAgICAgIF9oYW5kbGVQdWJTdWIoKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBTZXRzIHVwIGEgc3RvcmFnZSBjaGFuZ2Ugb2JzZXJ2ZXJcbiAgICAgKi9cbiAgICBmdW5jdGlvbiBfc2V0dXBPYnNlcnZlcigpe1xuICAgICAgICBpZihfYmFja2VuZCA9PSBcImxvY2FsU3RvcmFnZVwiIHx8IF9iYWNrZW5kID09IFwiZ2xvYmFsU3RvcmFnZVwiKXtcbiAgICAgICAgICAgIGlmKFwiYWRkRXZlbnRMaXN0ZW5lclwiIGluIHdpbmRvdyl7XG4gICAgICAgICAgICAgICAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoXCJzdG9yYWdlXCIsIF9zdG9yYWdlT2JzZXJ2ZXIsIGZhbHNlKTtcbiAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgIGRvY3VtZW50LmF0dGFjaEV2ZW50KFwib25zdG9yYWdlXCIsIF9zdG9yYWdlT2JzZXJ2ZXIpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9ZWxzZSBpZihfYmFja2VuZCA9PSBcInVzZXJEYXRhQmVoYXZpb3JcIil7XG4gICAgICAgICAgICBzZXRJbnRlcnZhbChfc3RvcmFnZU9ic2VydmVyLCAxMDAwKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEZpcmVkIG9uIGFueSBraW5kIG9mIGRhdGEgY2hhbmdlLCBuZWVkcyB0byBjaGVjayBpZiBhbnl0aGluZyBoYXNcbiAgICAgKiByZWFsbHkgYmVlbiBjaGFuZ2VkXG4gICAgICovXG4gICAgZnVuY3Rpb24gX3N0b3JhZ2VPYnNlcnZlcigpe1xuICAgICAgICB2YXIgdXBkYXRlVGltZTtcbiAgICAgICAgLy8gY3VtdWxhdGUgY2hhbmdlIG5vdGlmaWNhdGlvbnMgd2l0aCB0aW1lb3V0XG4gICAgICAgIGNsZWFyVGltZW91dChfb2JzZXJ2ZXJfdGltZW91dCk7XG4gICAgICAgIF9vYnNlcnZlcl90aW1lb3V0ID0gc2V0VGltZW91dChmdW5jdGlvbigpe1xuXG4gICAgICAgICAgICBpZihfYmFja2VuZCA9PSBcImxvY2FsU3RvcmFnZVwiIHx8IF9iYWNrZW5kID09IFwiZ2xvYmFsU3RvcmFnZVwiKXtcbiAgICAgICAgICAgICAgICB1cGRhdGVUaW1lID0gX3N0b3JhZ2Vfc2VydmljZS5qU3RvcmFnZV91cGRhdGU7XG4gICAgICAgICAgICB9ZWxzZSBpZihfYmFja2VuZCA9PSBcInVzZXJEYXRhQmVoYXZpb3JcIil7XG4gICAgICAgICAgICAgICAgX3N0b3JhZ2VfZWxtLmxvYWQoXCJqU3RvcmFnZVwiKTtcbiAgICAgICAgICAgICAgICB0cnl7XG4gICAgICAgICAgICAgICAgICAgIHVwZGF0ZVRpbWUgPSBfc3RvcmFnZV9lbG0uZ2V0QXR0cmlidXRlKFwialN0b3JhZ2VfdXBkYXRlXCIpO1xuICAgICAgICAgICAgICAgIH1jYXRjaChFNSl7fVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZih1cGRhdGVUaW1lICYmIHVwZGF0ZVRpbWUgIT0gX29ic2VydmVyX3VwZGF0ZSl7XG4gICAgICAgICAgICAgICAgX29ic2VydmVyX3VwZGF0ZSA9IHVwZGF0ZVRpbWU7XG4gICAgICAgICAgICAgICAgX2NoZWNrVXBkYXRlZEtleXMoKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICB9LCAyNSk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUmVsb2FkcyB0aGUgZGF0YSBhbmQgY2hlY2tzIGlmIGFueSBrZXlzIGFyZSBjaGFuZ2VkXG4gICAgICovXG4gICAgZnVuY3Rpb24gX2NoZWNrVXBkYXRlZEtleXMoKXtcbiAgICAgICAgdmFyIG9sZENyYzMyTGlzdCA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkoX3N0b3JhZ2UuX19qc3RvcmFnZV9tZXRhLkNSQzMyKSksXG4gICAgICAgICAgICBuZXdDcmMzMkxpc3Q7XG5cbiAgICAgICAgX3JlbG9hZERhdGEoKTtcbiAgICAgICAgbmV3Q3JjMzJMaXN0ID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShfc3RvcmFnZS5fX2pzdG9yYWdlX21ldGEuQ1JDMzIpKTtcblxuICAgICAgICB2YXIga2V5LFxuICAgICAgICAgICAgdXBkYXRlZCA9IFtdLFxuICAgICAgICAgICAgcmVtb3ZlZCA9IFtdO1xuXG4gICAgICAgIGZvcihrZXkgaW4gb2xkQ3JjMzJMaXN0KXtcbiAgICAgICAgICAgIGlmKG9sZENyYzMyTGlzdC5oYXNPd25Qcm9wZXJ0eShrZXkpKXtcbiAgICAgICAgICAgICAgICBpZighbmV3Q3JjMzJMaXN0W2tleV0pe1xuICAgICAgICAgICAgICAgICAgICByZW1vdmVkLnB1c2goa2V5KTtcbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmKG9sZENyYzMyTGlzdFtrZXldICE9IG5ld0NyYzMyTGlzdFtrZXldICYmIFN0cmluZyhvbGRDcmMzMkxpc3Rba2V5XSkuc3Vic3RyKDAsMikgPT0gXCIyLlwiKXtcbiAgICAgICAgICAgICAgICAgICAgdXBkYXRlZC5wdXNoKGtleSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgZm9yKGtleSBpbiBuZXdDcmMzMkxpc3Qpe1xuICAgICAgICAgICAgaWYobmV3Q3JjMzJMaXN0Lmhhc093blByb3BlcnR5KGtleSkpe1xuICAgICAgICAgICAgICAgIGlmKCFvbGRDcmMzMkxpc3Rba2V5XSl7XG4gICAgICAgICAgICAgICAgICAgIHVwZGF0ZWQucHVzaChrZXkpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIF9maXJlT2JzZXJ2ZXJzKHVwZGF0ZWQsIFwidXBkYXRlZFwiKTtcbiAgICAgICAgX2ZpcmVPYnNlcnZlcnMocmVtb3ZlZCwgXCJkZWxldGVkXCIpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEZpcmVzIG9ic2VydmVycyBmb3IgdXBkYXRlZCBrZXlzXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge0FycmF5fFN0cmluZ30ga2V5cyBBcnJheSBvZiBrZXkgbmFtZXMgb3IgYSBrZXlcbiAgICAgKiBAcGFyYW0ge1N0cmluZ30gYWN0aW9uIFdoYXQgaGFwcGVuZWQgd2l0aCB0aGUgdmFsdWUgKHVwZGF0ZWQsIGRlbGV0ZWQsIGZsdXNoZWQpXG4gICAgICovXG4gICAgZnVuY3Rpb24gX2ZpcmVPYnNlcnZlcnMoa2V5cywgYWN0aW9uKXtcbiAgICAgICAga2V5cyA9IFtdLmNvbmNhdChrZXlzIHx8IFtdKTtcbiAgICAgICAgaWYoYWN0aW9uID09IFwiZmx1c2hlZFwiKXtcbiAgICAgICAgICAgIGtleXMgPSBbXTtcbiAgICAgICAgICAgIGZvcih2YXIga2V5IGluIF9vYnNlcnZlcnMpe1xuICAgICAgICAgICAgICAgIGlmKF9vYnNlcnZlcnMuaGFzT3duUHJvcGVydHkoa2V5KSl7XG4gICAgICAgICAgICAgICAgICAgIGtleXMucHVzaChrZXkpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGFjdGlvbiA9IFwiZGVsZXRlZFwiO1xuICAgICAgICB9XG4gICAgICAgIGZvcih2YXIgaT0wLCBsZW4gPSBrZXlzLmxlbmd0aDsgaTxsZW47IGkrKyl7XG4gICAgICAgICAgICBpZihfb2JzZXJ2ZXJzW2tleXNbaV1dKXtcbiAgICAgICAgICAgICAgICBmb3IodmFyIGo9MCwgamxlbiA9IF9vYnNlcnZlcnNba2V5c1tpXV0ubGVuZ3RoOyBqPGpsZW47IGorKyl7XG4gICAgICAgICAgICAgICAgICAgIF9vYnNlcnZlcnNba2V5c1tpXV1bal0oa2V5c1tpXSwgYWN0aW9uKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZihfb2JzZXJ2ZXJzW1wiKlwiXSl7XG4gICAgICAgICAgICAgICAgZm9yKHZhciBqPTAsIGpsZW4gPSBfb2JzZXJ2ZXJzW1wiKlwiXS5sZW5ndGg7IGo8amxlbjsgaisrKXtcbiAgICAgICAgICAgICAgICAgICAgX29ic2VydmVyc1tcIipcIl1bal0oa2V5c1tpXSwgYWN0aW9uKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBQdWJsaXNoZXMga2V5IGNoYW5nZSB0byBsaXN0ZW5lcnNcbiAgICAgKi9cbiAgICBmdW5jdGlvbiBfcHVibGlzaENoYW5nZSgpe1xuICAgICAgICB2YXIgdXBkYXRlVGltZSA9ICgrbmV3IERhdGUoKSkudG9TdHJpbmcoKTtcblxuICAgICAgICBpZihfYmFja2VuZCA9PSBcImxvY2FsU3RvcmFnZVwiIHx8IF9iYWNrZW5kID09IFwiZ2xvYmFsU3RvcmFnZVwiKXtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgX3N0b3JhZ2Vfc2VydmljZS5qU3RvcmFnZV91cGRhdGUgPSB1cGRhdGVUaW1lO1xuICAgICAgICAgICAgfSBjYXRjaCAoRTgpIHtcbiAgICAgICAgICAgICAgICAvLyBzYWZhcmkgcHJpdmF0ZSBtb2RlIGhhcyBiZWVuIGVuYWJsZWQgYWZ0ZXIgdGhlIGpTdG9yYWdlIGluaXRpYWxpemF0aW9uXG4gICAgICAgICAgICAgICAgX2JhY2tlbmQgPSBmYWxzZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfWVsc2UgaWYoX2JhY2tlbmQgPT0gXCJ1c2VyRGF0YUJlaGF2aW9yXCIpe1xuICAgICAgICAgICAgX3N0b3JhZ2VfZWxtLnNldEF0dHJpYnV0ZShcImpTdG9yYWdlX3VwZGF0ZVwiLCB1cGRhdGVUaW1lKTtcbiAgICAgICAgICAgIF9zdG9yYWdlX2VsbS5zYXZlKFwialN0b3JhZ2VcIik7XG4gICAgICAgIH1cblxuICAgICAgICBfc3RvcmFnZU9ic2VydmVyKCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogTG9hZHMgdGhlIGRhdGEgZnJvbSB0aGUgc3RvcmFnZSBiYXNlZCBvbiB0aGUgc3VwcG9ydGVkIG1lY2hhbmlzbVxuICAgICAqL1xuICAgIGZ1bmN0aW9uIF9sb2FkX3N0b3JhZ2UoKXtcbiAgICAgICAgLyogaWYgalN0b3JhZ2Ugc3RyaW5nIGlzIHJldHJpZXZlZCwgdGhlbiBkZWNvZGUgaXQgKi9cbiAgICAgICAgaWYoX3N0b3JhZ2Vfc2VydmljZS5qU3RvcmFnZSl7XG4gICAgICAgICAgICB0cnl7XG4gICAgICAgICAgICAgICAgX3N0b3JhZ2UgPSBKU09OLnBhcnNlKFN0cmluZyhfc3RvcmFnZV9zZXJ2aWNlLmpTdG9yYWdlKSk7XG4gICAgICAgICAgICB9Y2F0Y2goRTYpe19zdG9yYWdlX3NlcnZpY2UualN0b3JhZ2UgPSBcInt9XCI7fVxuICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgIF9zdG9yYWdlX3NlcnZpY2UualN0b3JhZ2UgPSBcInt9XCI7XG4gICAgICAgIH1cbiAgICAgICAgX3N0b3JhZ2Vfc2l6ZSA9IF9zdG9yYWdlX3NlcnZpY2UualN0b3JhZ2U/U3RyaW5nKF9zdG9yYWdlX3NlcnZpY2UualN0b3JhZ2UpLmxlbmd0aDowO1xuXG4gICAgICAgIGlmKCFfc3RvcmFnZS5fX2pzdG9yYWdlX21ldGEpe1xuICAgICAgICAgICAgX3N0b3JhZ2UuX19qc3RvcmFnZV9tZXRhID0ge307XG4gICAgICAgIH1cbiAgICAgICAgaWYoIV9zdG9yYWdlLl9fanN0b3JhZ2VfbWV0YS5DUkMzMil7XG4gICAgICAgICAgICBfc3RvcmFnZS5fX2pzdG9yYWdlX21ldGEuQ1JDMzIgPSB7fTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFRoaXMgZnVuY3Rpb25zIHByb3ZpZGVzIHRoZSBcInNhdmVcIiBtZWNoYW5pc20gdG8gc3RvcmUgdGhlIGpTdG9yYWdlIG9iamVjdFxuICAgICAqL1xuICAgIGZ1bmN0aW9uIF9zYXZlKCl7XG4gICAgICAgIF9kcm9wT2xkRXZlbnRzKCk7IC8vIHJlbW92ZSBleHBpcmVkIGV2ZW50c1xuICAgICAgICB0cnl7XG4gICAgICAgICAgICBfc3RvcmFnZV9zZXJ2aWNlLmpTdG9yYWdlID0gSlNPTi5zdHJpbmdpZnkoX3N0b3JhZ2UpO1xuICAgICAgICAgICAgLy8gSWYgdXNlckRhdGEgaXMgdXNlZCBhcyB0aGUgc3RvcmFnZSBlbmdpbmUsIGFkZGl0aW9uYWxcbiAgICAgICAgICAgIGlmKF9zdG9yYWdlX2VsbSkge1xuICAgICAgICAgICAgICAgIF9zdG9yYWdlX2VsbS5zZXRBdHRyaWJ1dGUoXCJqU3RvcmFnZVwiLF9zdG9yYWdlX3NlcnZpY2UualN0b3JhZ2UpO1xuICAgICAgICAgICAgICAgIF9zdG9yYWdlX2VsbS5zYXZlKFwialN0b3JhZ2VcIik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBfc3RvcmFnZV9zaXplID0gX3N0b3JhZ2Vfc2VydmljZS5qU3RvcmFnZT9TdHJpbmcoX3N0b3JhZ2Vfc2VydmljZS5qU3RvcmFnZSkubGVuZ3RoOjA7XG4gICAgICAgIH1jYXRjaChFNyl7LyogcHJvYmFibHkgY2FjaGUgaXMgZnVsbCwgbm90aGluZyBpcyBzYXZlZCB0aGlzIHdheSovfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEZ1bmN0aW9uIGNoZWNrcyBpZiBhIGtleSBpcyBzZXQgYW5kIGlzIHN0cmluZyBvciBudW1iZXJpY1xuICAgICAqXG4gICAgICogQHBhcmFtIHtTdHJpbmd9IGtleSBLZXkgbmFtZVxuICAgICAqL1xuICAgIGZ1bmN0aW9uIF9jaGVja0tleShrZXkpe1xuICAgICAgICBpZih0eXBlb2Yga2V5ICE9IFwic3RyaW5nXCIgJiYgdHlwZW9mIGtleSAhPSBcIm51bWJlclwiKXtcbiAgICAgICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJLZXkgbmFtZSBtdXN0IGJlIHN0cmluZyBvciBudW1lcmljXCIpO1xuICAgICAgICB9XG4gICAgICAgIGlmKGtleSA9PSBcIl9fanN0b3JhZ2VfbWV0YVwiKXtcbiAgICAgICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJSZXNlcnZlZCBrZXkgbmFtZVwiKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZW1vdmVzIGV4cGlyZWQga2V5c1xuICAgICAqL1xuICAgIGZ1bmN0aW9uIF9oYW5kbGVUVEwoKXtcbiAgICAgICAgdmFyIGN1cnRpbWUsIGksIFRUTCwgQ1JDMzIsIG5leHRFeHBpcmUgPSBJbmZpbml0eSwgY2hhbmdlZCA9IGZhbHNlLCBkZWxldGVkID0gW107XG5cbiAgICAgICAgY2xlYXJUaW1lb3V0KF90dGxfdGltZW91dCk7XG5cbiAgICAgICAgaWYoIV9zdG9yYWdlLl9fanN0b3JhZ2VfbWV0YSB8fCB0eXBlb2YgX3N0b3JhZ2UuX19qc3RvcmFnZV9tZXRhLlRUTCAhPSBcIm9iamVjdFwiKXtcbiAgICAgICAgICAgIC8vIG5vdGhpbmcgdG8gZG8gaGVyZVxuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY3VydGltZSA9ICtuZXcgRGF0ZSgpO1xuICAgICAgICBUVEwgPSBfc3RvcmFnZS5fX2pzdG9yYWdlX21ldGEuVFRMO1xuXG4gICAgICAgIENSQzMyID0gX3N0b3JhZ2UuX19qc3RvcmFnZV9tZXRhLkNSQzMyO1xuICAgICAgICBmb3IoaSBpbiBUVEwpe1xuICAgICAgICAgICAgaWYoVFRMLmhhc093blByb3BlcnR5KGkpKXtcbiAgICAgICAgICAgICAgICBpZihUVExbaV0gPD0gY3VydGltZSl7XG4gICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBUVExbaV07XG4gICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBDUkMzMltpXTtcbiAgICAgICAgICAgICAgICAgICAgZGVsZXRlIF9zdG9yYWdlW2ldO1xuICAgICAgICAgICAgICAgICAgICBjaGFuZ2VkID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgZGVsZXRlZC5wdXNoKGkpO1xuICAgICAgICAgICAgICAgIH1lbHNlIGlmKFRUTFtpXSA8IG5leHRFeHBpcmUpe1xuICAgICAgICAgICAgICAgICAgICBuZXh0RXhwaXJlID0gVFRMW2ldO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIHNldCBuZXh0IGNoZWNrXG4gICAgICAgIGlmKG5leHRFeHBpcmUgIT0gSW5maW5pdHkpe1xuICAgICAgICAgICAgX3R0bF90aW1lb3V0ID0gc2V0VGltZW91dChNYXRoLm1pbihfaGFuZGxlVFRMLCBuZXh0RXhwaXJlIC0gY3VydGltZSwgMHg3RkZGRkZGRikpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gc2F2ZSBjaGFuZ2VzXG4gICAgICAgIGlmKGNoYW5nZWQpe1xuICAgICAgICAgICAgX3NhdmUoKTtcbiAgICAgICAgICAgIF9wdWJsaXNoQ2hhbmdlKCk7XG4gICAgICAgICAgICBfZmlyZU9ic2VydmVycyhkZWxldGVkLCBcImRlbGV0ZWRcIik7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDaGVja3MgaWYgdGhlcmUncyBhbnkgZXZlbnRzIG9uIGhvbGQgdG8gYmUgZmlyZWQgdG8gbGlzdGVuZXJzXG4gICAgICovXG4gICAgZnVuY3Rpb24gX2hhbmRsZVB1YlN1Yigpe1xuICAgICAgICB2YXIgaSwgbGVuO1xuICAgICAgICBpZighX3N0b3JhZ2UuX19qc3RvcmFnZV9tZXRhLlB1YlN1Yil7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHB1YmVsbSxcbiAgICAgICAgICAgIF9wdWJzdWJDdXJyZW50ID0gX3B1YnN1Yl9sYXN0O1xuXG4gICAgICAgIGZvcihpPWxlbj1fc3RvcmFnZS5fX2pzdG9yYWdlX21ldGEuUHViU3ViLmxlbmd0aC0xOyBpPj0wOyBpLS0pe1xuICAgICAgICAgICAgcHViZWxtID0gX3N0b3JhZ2UuX19qc3RvcmFnZV9tZXRhLlB1YlN1YltpXTtcbiAgICAgICAgICAgIGlmKHB1YmVsbVswXSA+IF9wdWJzdWJfbGFzdCl7XG4gICAgICAgICAgICAgICAgX3B1YnN1YkN1cnJlbnQgPSBwdWJlbG1bMF07XG4gICAgICAgICAgICAgICAgX2ZpcmVTdWJzY3JpYmVycyhwdWJlbG1bMV0sIHB1YmVsbVsyXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBfcHVic3ViX2xhc3QgPSBfcHVic3ViQ3VycmVudDtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBGaXJlcyBhbGwgc3Vic2NyaWJlciBsaXN0ZW5lcnMgZm9yIGEgcHVic3ViIGNoYW5uZWxcbiAgICAgKlxuICAgICAqIEBwYXJhbSB7U3RyaW5nfSBjaGFubmVsIENoYW5uZWwgbmFtZVxuICAgICAqIEBwYXJhbSB7TWl4ZWR9IHBheWxvYWQgUGF5bG9hZCBkYXRhIHRvIGRlbGl2ZXJcbiAgICAgKi9cbiAgICBmdW5jdGlvbiBfZmlyZVN1YnNjcmliZXJzKGNoYW5uZWwsIHBheWxvYWQpe1xuICAgICAgICBpZihfcHVic3ViX29ic2VydmVyc1tjaGFubmVsXSl7XG4gICAgICAgICAgICBmb3IodmFyIGk9MCwgbGVuID0gX3B1YnN1Yl9vYnNlcnZlcnNbY2hhbm5lbF0ubGVuZ3RoOyBpPGxlbjsgaSsrKXtcbiAgICAgICAgICAgICAgICAvLyBzZW5kIGltbXV0YWJsZSBkYXRhIHRoYXQgY2FuJ3QgYmUgbW9kaWZpZWQgYnkgbGlzdGVuZXJzXG4gICAgICAgICAgICAgICAgdHJ5e1xuICAgICAgICAgICAgICAgICAgICBfcHVic3ViX29ic2VydmVyc1tjaGFubmVsXVtpXShjaGFubmVsLCBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KHBheWxvYWQpKSk7XG4gICAgICAgICAgICAgICAgfWNhdGNoKEUpe307XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZW1vdmUgb2xkIGV2ZW50cyBmcm9tIHRoZSBwdWJsaXNoIHN0cmVhbSAoYXQgbGVhc3QgMnNlYyBvbGQpXG4gICAgICovXG4gICAgZnVuY3Rpb24gX2Ryb3BPbGRFdmVudHMoKXtcbiAgICAgICAgaWYoIV9zdG9yYWdlLl9fanN0b3JhZ2VfbWV0YS5QdWJTdWIpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIHJldGlyZSA9ICtuZXcgRGF0ZSgpIC0gMjAwMDtcblxuICAgICAgICBmb3IodmFyIGk9MCwgbGVuID0gX3N0b3JhZ2UuX19qc3RvcmFnZV9tZXRhLlB1YlN1Yi5sZW5ndGg7IGk8bGVuOyBpKyspe1xuICAgICAgICAgICAgaWYoX3N0b3JhZ2UuX19qc3RvcmFnZV9tZXRhLlB1YlN1YltpXVswXSA8PSByZXRpcmUpe1xuICAgICAgICAgICAgICAgIC8vIGRlbGV0ZUNvdW50IGlzIG5lZWRlZCBmb3IgSUU2XG4gICAgICAgICAgICAgICAgX3N0b3JhZ2UuX19qc3RvcmFnZV9tZXRhLlB1YlN1Yi5zcGxpY2UoaSwgX3N0b3JhZ2UuX19qc3RvcmFnZV9tZXRhLlB1YlN1Yi5sZW5ndGggLSBpKTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmKCFfc3RvcmFnZS5fX2pzdG9yYWdlX21ldGEuUHViU3ViLmxlbmd0aCl7XG4gICAgICAgICAgICBkZWxldGUgX3N0b3JhZ2UuX19qc3RvcmFnZV9tZXRhLlB1YlN1YjtcbiAgICAgICAgfVxuXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUHVibGlzaCBwYXlsb2FkIHRvIGEgY2hhbm5lbFxuICAgICAqXG4gICAgICogQHBhcmFtIHtTdHJpbmd9IGNoYW5uZWwgQ2hhbm5lbCBuYW1lXG4gICAgICogQHBhcmFtIHtNaXhlZH0gcGF5bG9hZCBQYXlsb2FkIHRvIHNlbmQgdG8gdGhlIHN1YnNjcmliZXJzXG4gICAgICovXG4gICAgZnVuY3Rpb24gX3B1Ymxpc2goY2hhbm5lbCwgcGF5bG9hZCl7XG4gICAgICAgIGlmKCFfc3RvcmFnZS5fX2pzdG9yYWdlX21ldGEpe1xuICAgICAgICAgICAgX3N0b3JhZ2UuX19qc3RvcmFnZV9tZXRhID0ge307XG4gICAgICAgIH1cbiAgICAgICAgaWYoIV9zdG9yYWdlLl9fanN0b3JhZ2VfbWV0YS5QdWJTdWIpe1xuICAgICAgICAgICAgX3N0b3JhZ2UuX19qc3RvcmFnZV9tZXRhLlB1YlN1YiA9IFtdO1xuICAgICAgICB9XG5cbiAgICAgICAgX3N0b3JhZ2UuX19qc3RvcmFnZV9tZXRhLlB1YlN1Yi51bnNoaWZ0KFsrbmV3IERhdGUsIGNoYW5uZWwsIHBheWxvYWRdKTtcblxuICAgICAgICBfc2F2ZSgpO1xuICAgICAgICBfcHVibGlzaENoYW5nZSgpO1xuICAgIH1cblxuXG4gICAgLyoqXG4gICAgICogSlMgSW1wbGVtZW50YXRpb24gb2YgTXVybXVySGFzaDJcbiAgICAgKlxuICAgICAqICBTT1VSQ0U6IGh0dHBzOi8vZ2l0aHViLmNvbS9nYXJ5Y291cnQvbXVybXVyaGFzaC1qcyAoTUlUIGxpY2Vuc2VkKVxuICAgICAqXG4gICAgICogQGF1dGhvciA8YSBocmVmPVwibWFpbHRvOmdhcnkuY291cnRAZ21haWwuY29tXCI+R2FyeSBDb3VydDwvYT5cbiAgICAgKiBAc2VlIGh0dHA6Ly9naXRodWIuY29tL2dhcnljb3VydC9tdXJtdXJoYXNoLWpzXG4gICAgICogQGF1dGhvciA8YSBocmVmPVwibWFpbHRvOmFhcHBsZWJ5QGdtYWlsLmNvbVwiPkF1c3RpbiBBcHBsZWJ5PC9hPlxuICAgICAqIEBzZWUgaHR0cDovL3NpdGVzLmdvb2dsZS5jb20vc2l0ZS9tdXJtdXJoYXNoL1xuICAgICAqXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHN0ciBBU0NJSSBvbmx5XG4gICAgICogQHBhcmFtIHtudW1iZXJ9IHNlZWQgUG9zaXRpdmUgaW50ZWdlciBvbmx5XG4gICAgICogQHJldHVybiB7bnVtYmVyfSAzMi1iaXQgcG9zaXRpdmUgaW50ZWdlciBoYXNoXG4gICAgICovXG5cbiAgICBmdW5jdGlvbiBtdXJtdXJoYXNoMl8zMl9nYyhzdHIsIHNlZWQpIHtcbiAgICAgICAgdmFyXG4gICAgICAgICAgICBsID0gc3RyLmxlbmd0aCxcbiAgICAgICAgICAgIGggPSBzZWVkIF4gbCxcbiAgICAgICAgICAgIGkgPSAwLFxuICAgICAgICAgICAgaztcblxuICAgICAgICB3aGlsZSAobCA+PSA0KSB7XG4gICAgICAgICAgICBrID1cbiAgICAgICAgICAgICAgICAoKHN0ci5jaGFyQ29kZUF0KGkpICYgMHhmZikpIHxcbiAgICAgICAgICAgICAgICAoKHN0ci5jaGFyQ29kZUF0KCsraSkgJiAweGZmKSA8PCA4KSB8XG4gICAgICAgICAgICAgICAgKChzdHIuY2hhckNvZGVBdCgrK2kpICYgMHhmZikgPDwgMTYpIHxcbiAgICAgICAgICAgICAgICAoKHN0ci5jaGFyQ29kZUF0KCsraSkgJiAweGZmKSA8PCAyNCk7XG5cbiAgICAgICAgICAgIGsgPSAoKChrICYgMHhmZmZmKSAqIDB4NWJkMWU5OTUpICsgKCgoKGsgPj4+IDE2KSAqIDB4NWJkMWU5OTUpICYgMHhmZmZmKSA8PCAxNikpO1xuICAgICAgICAgICAgayBePSBrID4+PiAyNDtcbiAgICAgICAgICAgIGsgPSAoKChrICYgMHhmZmZmKSAqIDB4NWJkMWU5OTUpICsgKCgoKGsgPj4+IDE2KSAqIDB4NWJkMWU5OTUpICYgMHhmZmZmKSA8PCAxNikpO1xuXG4gICAgICAgICAgICBoID0gKCgoaCAmIDB4ZmZmZikgKiAweDViZDFlOTk1KSArICgoKChoID4+PiAxNikgKiAweDViZDFlOTk1KSAmIDB4ZmZmZikgPDwgMTYpKSBeIGs7XG5cbiAgICAgICAgICAgIGwgLT0gNDtcbiAgICAgICAgICAgICsraTtcbiAgICAgICAgfVxuXG4gICAgICAgIHN3aXRjaCAobCkge1xuICAgICAgICAgICAgY2FzZSAzOiBoIF49IChzdHIuY2hhckNvZGVBdChpICsgMikgJiAweGZmKSA8PCAxNjtcbiAgICAgICAgICAgIGNhc2UgMjogaCBePSAoc3RyLmNoYXJDb2RlQXQoaSArIDEpICYgMHhmZikgPDwgODtcbiAgICAgICAgICAgIGNhc2UgMTogaCBePSAoc3RyLmNoYXJDb2RlQXQoaSkgJiAweGZmKTtcbiAgICAgICAgICAgICAgICBoID0gKCgoaCAmIDB4ZmZmZikgKiAweDViZDFlOTk1KSArICgoKChoID4+PiAxNikgKiAweDViZDFlOTk1KSAmIDB4ZmZmZikgPDwgMTYpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGggXj0gaCA+Pj4gMTM7XG4gICAgICAgIGggPSAoKChoICYgMHhmZmZmKSAqIDB4NWJkMWU5OTUpICsgKCgoKGggPj4+IDE2KSAqIDB4NWJkMWU5OTUpICYgMHhmZmZmKSA8PCAxNikpO1xuICAgICAgICBoIF49IGggPj4+IDE1O1xuXG4gICAgICAgIHJldHVybiBoID4+PiAwO1xuICAgIH1cblxuICAgIC8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vIFBVQkxJQyBJTlRFUkZBQ0UgLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vL1xuXG4gICAgJC5qU3RvcmFnZSA9IHtcbiAgICAgICAgLyogVmVyc2lvbiBudW1iZXIgKi9cbiAgICAgICAgdmVyc2lvbjogSlNUT1JBR0VfVkVSU0lPTixcblxuICAgICAgICAvKipcbiAgICAgICAgICogU2V0cyBhIGtleSdzIHZhbHVlLlxuICAgICAgICAgKlxuICAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30ga2V5IEtleSB0byBzZXQuIElmIHRoaXMgdmFsdWUgaXMgbm90IHNldCBvciBub3RcbiAgICAgICAgICogICAgICAgICAgICAgIGEgc3RyaW5nIGFuIGV4Y2VwdGlvbiBpcyByYWlzZWQuXG4gICAgICAgICAqIEBwYXJhbSB7TWl4ZWR9IHZhbHVlIFZhbHVlIHRvIHNldC4gVGhpcyBjYW4gYmUgYW55IHZhbHVlIHRoYXQgaXMgSlNPTlxuICAgICAgICAgKiAgICAgICAgICAgICAgY29tcGF0aWJsZSAoTnVtYmVycywgU3RyaW5ncywgT2JqZWN0cyBldGMuKS5cbiAgICAgICAgICogQHBhcmFtIHtPYmplY3R9IFtvcHRpb25zXSAtIHBvc3NpYmxlIG9wdGlvbnMgdG8gdXNlXG4gICAgICAgICAqIEBwYXJhbSB7TnVtYmVyfSBbb3B0aW9ucy5UVExdIC0gb3B0aW9uYWwgVFRMIHZhbHVlLCBpbiBtaWxsaXNlY29uZHNcbiAgICAgICAgICogQHJldHVybiB7TWl4ZWR9IHRoZSB1c2VkIHZhbHVlXG4gICAgICAgICAqL1xuICAgICAgICBzZXQ6IGZ1bmN0aW9uKGtleSwgdmFsdWUsIG9wdGlvbnMpe1xuICAgICAgICAgICAgX2NoZWNrS2V5KGtleSk7XG5cbiAgICAgICAgICAgIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xuXG4gICAgICAgICAgICAvLyB1bmRlZmluZWQgdmFsdWVzIGFyZSBkZWxldGVkIGF1dG9tYXRpY2FsbHlcbiAgICAgICAgICAgIGlmKHR5cGVvZiB2YWx1ZSA9PSBcInVuZGVmaW5lZFwiKXtcbiAgICAgICAgICAgICAgICB0aGlzLmRlbGV0ZUtleShrZXkpO1xuICAgICAgICAgICAgICAgIHJldHVybiB2YWx1ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYoX1hNTFNlcnZpY2UuaXNYTUwodmFsdWUpKXtcbiAgICAgICAgICAgICAgICB2YWx1ZSA9IHtfaXNfeG1sOnRydWUseG1sOl9YTUxTZXJ2aWNlLmVuY29kZSh2YWx1ZSl9O1xuICAgICAgICAgICAgfWVsc2UgaWYodHlwZW9mIHZhbHVlID09IFwiZnVuY3Rpb25cIil7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDsgLy8gZnVuY3Rpb25zIGNhbid0IGJlIHNhdmVkIVxuICAgICAgICAgICAgfWVsc2UgaWYodmFsdWUgJiYgdHlwZW9mIHZhbHVlID09IFwib2JqZWN0XCIpe1xuICAgICAgICAgICAgICAgIC8vIGNsb25lIHRoZSBvYmplY3QgYmVmb3JlIHNhdmluZyB0byBfc3RvcmFnZSB0cmVlXG4gICAgICAgICAgICAgICAgdmFsdWUgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KHZhbHVlKSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIF9zdG9yYWdlW2tleV0gPSB2YWx1ZTtcblxuICAgICAgICAgICAgX3N0b3JhZ2UuX19qc3RvcmFnZV9tZXRhLkNSQzMyW2tleV0gPSBcIjIuXCIgKyBtdXJtdXJoYXNoMl8zMl9nYyhKU09OLnN0cmluZ2lmeSh2YWx1ZSksIDB4OTc0N2IyOGMpO1xuXG4gICAgICAgICAgICB0aGlzLnNldFRUTChrZXksIG9wdGlvbnMuVFRMIHx8IDApOyAvLyBhbHNvIGhhbmRsZXMgc2F2aW5nIGFuZCBfcHVibGlzaENoYW5nZVxuXG4gICAgICAgICAgICBfZmlyZU9ic2VydmVycyhrZXksIFwidXBkYXRlZFwiKTtcbiAgICAgICAgICAgIHJldHVybiB2YWx1ZTtcbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgICogTG9va3MgdXAgYSBrZXkgaW4gY2FjaGVcbiAgICAgICAgICpcbiAgICAgICAgICogQHBhcmFtIHtTdHJpbmd9IGtleSAtIEtleSB0byBsb29rIHVwLlxuICAgICAgICAgKiBAcGFyYW0ge21peGVkfSBkZWYgLSBEZWZhdWx0IHZhbHVlIHRvIHJldHVybiwgaWYga2V5IGRpZG4ndCBleGlzdC5cbiAgICAgICAgICogQHJldHVybiB7TWl4ZWR9IHRoZSBrZXkgdmFsdWUsIGRlZmF1bHQgdmFsdWUgb3IgbnVsbFxuICAgICAgICAgKi9cbiAgICAgICAgZ2V0OiBmdW5jdGlvbihrZXksIGRlZil7XG4gICAgICAgICAgICBfY2hlY2tLZXkoa2V5KTtcbiAgICAgICAgICAgIGlmKGtleSBpbiBfc3RvcmFnZSl7XG4gICAgICAgICAgICAgICAgaWYoX3N0b3JhZ2Vba2V5XSAmJiB0eXBlb2YgX3N0b3JhZ2Vba2V5XSA9PSBcIm9iamVjdFwiICYmIF9zdG9yYWdlW2tleV0uX2lzX3htbCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gX1hNTFNlcnZpY2UuZGVjb2RlKF9zdG9yYWdlW2tleV0ueG1sKTtcbiAgICAgICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIF9zdG9yYWdlW2tleV07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHR5cGVvZihkZWYpID09IFwidW5kZWZpbmVkXCIgPyBudWxsIDogZGVmO1xuICAgICAgICB9LFxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBEZWxldGVzIGEga2V5IGZyb20gY2FjaGUuXG4gICAgICAgICAqXG4gICAgICAgICAqIEBwYXJhbSB7U3RyaW5nfSBrZXkgLSBLZXkgdG8gZGVsZXRlLlxuICAgICAgICAgKiBAcmV0dXJuIHtCb29sZWFufSB0cnVlIGlmIGtleSBleGlzdGVkIG9yIGZhbHNlIGlmIGl0IGRpZG4ndFxuICAgICAgICAgKi9cbiAgICAgICAgZGVsZXRlS2V5OiBmdW5jdGlvbihrZXkpe1xuICAgICAgICAgICAgX2NoZWNrS2V5KGtleSk7XG4gICAgICAgICAgICBpZihrZXkgaW4gX3N0b3JhZ2Upe1xuICAgICAgICAgICAgICAgIGRlbGV0ZSBfc3RvcmFnZVtrZXldO1xuICAgICAgICAgICAgICAgIC8vIHJlbW92ZSBmcm9tIFRUTCBsaXN0XG4gICAgICAgICAgICAgICAgaWYodHlwZW9mIF9zdG9yYWdlLl9fanN0b3JhZ2VfbWV0YS5UVEwgPT0gXCJvYmplY3RcIiAmJlxuICAgICAgICAgICAgICAgICAga2V5IGluIF9zdG9yYWdlLl9fanN0b3JhZ2VfbWV0YS5UVEwpe1xuICAgICAgICAgICAgICAgICAgICBkZWxldGUgX3N0b3JhZ2UuX19qc3RvcmFnZV9tZXRhLlRUTFtrZXldO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGRlbGV0ZSBfc3RvcmFnZS5fX2pzdG9yYWdlX21ldGEuQ1JDMzJba2V5XTtcblxuICAgICAgICAgICAgICAgIF9zYXZlKCk7XG4gICAgICAgICAgICAgICAgX3B1Ymxpc2hDaGFuZ2UoKTtcbiAgICAgICAgICAgICAgICBfZmlyZU9ic2VydmVycyhrZXksIFwiZGVsZXRlZFwiKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgICogU2V0cyBhIFRUTCBmb3IgYSBrZXksIG9yIHJlbW92ZSBpdCBpZiB0dGwgdmFsdWUgaXMgMCBvciBiZWxvd1xuICAgICAgICAgKlxuICAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30ga2V5IC0ga2V5IHRvIHNldCB0aGUgVFRMIGZvclxuICAgICAgICAgKiBAcGFyYW0ge051bWJlcn0gdHRsIC0gVFRMIHRpbWVvdXQgaW4gbWlsbGlzZWNvbmRzXG4gICAgICAgICAqIEByZXR1cm4ge0Jvb2xlYW59IHRydWUgaWYga2V5IGV4aXN0ZWQgb3IgZmFsc2UgaWYgaXQgZGlkbid0XG4gICAgICAgICAqL1xuICAgICAgICBzZXRUVEw6IGZ1bmN0aW9uKGtleSwgdHRsKXtcbiAgICAgICAgICAgIHZhciBjdXJ0aW1lID0gK25ldyBEYXRlKCk7XG4gICAgICAgICAgICBfY2hlY2tLZXkoa2V5KTtcbiAgICAgICAgICAgIHR0bCA9IE51bWJlcih0dGwpIHx8IDA7XG4gICAgICAgICAgICBpZihrZXkgaW4gX3N0b3JhZ2Upe1xuXG4gICAgICAgICAgICAgICAgaWYoIV9zdG9yYWdlLl9fanN0b3JhZ2VfbWV0YS5UVEwpe1xuICAgICAgICAgICAgICAgICAgICBfc3RvcmFnZS5fX2pzdG9yYWdlX21ldGEuVFRMID0ge307XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgLy8gU2V0IFRUTCB2YWx1ZSBmb3IgdGhlIGtleVxuICAgICAgICAgICAgICAgIGlmKHR0bD4wKXtcbiAgICAgICAgICAgICAgICAgICAgX3N0b3JhZ2UuX19qc3RvcmFnZV9tZXRhLlRUTFtrZXldID0gY3VydGltZSArIHR0bDtcbiAgICAgICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICAgICAgZGVsZXRlIF9zdG9yYWdlLl9fanN0b3JhZ2VfbWV0YS5UVExba2V5XTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBfc2F2ZSgpO1xuXG4gICAgICAgICAgICAgICAgX2hhbmRsZVRUTCgpO1xuXG4gICAgICAgICAgICAgICAgX3B1Ymxpc2hDaGFuZ2UoKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgICogR2V0cyByZW1haW5pbmcgVFRMIChpbiBtaWxsaXNlY29uZHMpIGZvciBhIGtleSBvciAwIHdoZW4gbm8gVFRMIGhhcyBiZWVuIHNldFxuICAgICAgICAgKlxuICAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30ga2V5IEtleSB0byBjaGVja1xuICAgICAgICAgKiBAcmV0dXJuIHtOdW1iZXJ9IFJlbWFpbmluZyBUVEwgaW4gbWlsbGlzZWNvbmRzXG4gICAgICAgICAqL1xuICAgICAgICBnZXRUVEw6IGZ1bmN0aW9uKGtleSl7XG4gICAgICAgICAgICB2YXIgY3VydGltZSA9ICtuZXcgRGF0ZSgpLCB0dGw7XG4gICAgICAgICAgICBfY2hlY2tLZXkoa2V5KTtcbiAgICAgICAgICAgIGlmKGtleSBpbiBfc3RvcmFnZSAmJiBfc3RvcmFnZS5fX2pzdG9yYWdlX21ldGEuVFRMICYmIF9zdG9yYWdlLl9fanN0b3JhZ2VfbWV0YS5UVExba2V5XSl7XG4gICAgICAgICAgICAgICAgdHRsID0gX3N0b3JhZ2UuX19qc3RvcmFnZV9tZXRhLlRUTFtrZXldIC0gY3VydGltZTtcbiAgICAgICAgICAgICAgICByZXR1cm4gdHRsIHx8IDA7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gMDtcbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgICogRGVsZXRlcyBldmVyeXRoaW5nIGluIGNhY2hlLlxuICAgICAgICAgKlxuICAgICAgICAgKiBAcmV0dXJuIHtCb29sZWFufSBBbHdheXMgdHJ1ZVxuICAgICAgICAgKi9cbiAgICAgICAgZmx1c2g6IGZ1bmN0aW9uKCl7XG4gICAgICAgICAgICBfc3RvcmFnZSA9IHtfX2pzdG9yYWdlX21ldGE6e0NSQzMyOnt9fX07XG4gICAgICAgICAgICBfc2F2ZSgpO1xuICAgICAgICAgICAgX3B1Ymxpc2hDaGFuZ2UoKTtcbiAgICAgICAgICAgIF9maXJlT2JzZXJ2ZXJzKG51bGwsIFwiZmx1c2hlZFwiKTtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9LFxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBSZXR1cm5zIGEgcmVhZC1vbmx5IGNvcHkgb2YgX3N0b3JhZ2VcbiAgICAgICAgICpcbiAgICAgICAgICogQHJldHVybiB7T2JqZWN0fSBSZWFkLW9ubHkgY29weSBvZiBfc3RvcmFnZVxuICAgICAgICAqL1xuICAgICAgICBzdG9yYWdlT2JqOiBmdW5jdGlvbigpe1xuICAgICAgICAgICAgZnVuY3Rpb24gRigpIHt9XG4gICAgICAgICAgICBGLnByb3RvdHlwZSA9IF9zdG9yYWdlO1xuICAgICAgICAgICAgcmV0dXJuIG5ldyBGKCk7XG4gICAgICAgIH0sXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIFJldHVybnMgYW4gaW5kZXggb2YgYWxsIHVzZWQga2V5cyBhcyBhbiBhcnJheVxuICAgICAgICAgKiBbXCJrZXkxXCIsIFwia2V5MlwiLC4uXCJrZXlOXCJdXG4gICAgICAgICAqXG4gICAgICAgICAqIEByZXR1cm4ge0FycmF5fSBVc2VkIGtleXNcbiAgICAgICAgKi9cbiAgICAgICAgaW5kZXg6IGZ1bmN0aW9uKCl7XG4gICAgICAgICAgICB2YXIgaW5kZXggPSBbXSwgaTtcbiAgICAgICAgICAgIGZvcihpIGluIF9zdG9yYWdlKXtcbiAgICAgICAgICAgICAgICBpZihfc3RvcmFnZS5oYXNPd25Qcm9wZXJ0eShpKSAmJiBpICE9IFwiX19qc3RvcmFnZV9tZXRhXCIpe1xuICAgICAgICAgICAgICAgICAgICBpbmRleC5wdXNoKGkpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBpbmRleDtcbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgICogSG93IG11Y2ggc3BhY2UgaW4gYnl0ZXMgZG9lcyB0aGUgc3RvcmFnZSB0YWtlP1xuICAgICAgICAgKlxuICAgICAgICAgKiBAcmV0dXJuIHtOdW1iZXJ9IFN0b3JhZ2Ugc2l6ZSBpbiBjaGFycyAobm90IHRoZSBzYW1lIGFzIGluIGJ5dGVzLFxuICAgICAgICAgKiAgICAgICAgICAgICAgICAgIHNpbmNlIHNvbWUgY2hhcnMgbWF5IHRha2Ugc2V2ZXJhbCBieXRlcylcbiAgICAgICAgICovXG4gICAgICAgIHN0b3JhZ2VTaXplOiBmdW5jdGlvbigpe1xuICAgICAgICAgICAgcmV0dXJuIF9zdG9yYWdlX3NpemU7XG4gICAgICAgIH0sXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIFdoaWNoIGJhY2tlbmQgaXMgY3VycmVudGx5IGluIHVzZT9cbiAgICAgICAgICpcbiAgICAgICAgICogQHJldHVybiB7U3RyaW5nfSBCYWNrZW5kIG5hbWVcbiAgICAgICAgICovXG4gICAgICAgIGN1cnJlbnRCYWNrZW5kOiBmdW5jdGlvbigpe1xuICAgICAgICAgICAgcmV0dXJuIF9iYWNrZW5kO1xuICAgICAgICB9LFxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBUZXN0IGlmIHN0b3JhZ2UgaXMgYXZhaWxhYmxlXG4gICAgICAgICAqXG4gICAgICAgICAqIEByZXR1cm4ge0Jvb2xlYW59IFRydWUgaWYgc3RvcmFnZSBjYW4gYmUgdXNlZFxuICAgICAgICAgKi9cbiAgICAgICAgc3RvcmFnZUF2YWlsYWJsZTogZnVuY3Rpb24oKXtcbiAgICAgICAgICAgIHJldHVybiAhIV9iYWNrZW5kO1xuICAgICAgICB9LFxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBSZWdpc3RlciBjaGFuZ2UgbGlzdGVuZXJzXG4gICAgICAgICAqXG4gICAgICAgICAqIEBwYXJhbSB7U3RyaW5nfSBrZXkgS2V5IG5hbWVcbiAgICAgICAgICogQHBhcmFtIHtGdW5jdGlvbn0gY2FsbGJhY2sgRnVuY3Rpb24gdG8gcnVuIHdoZW4gdGhlIGtleSBjaGFuZ2VzXG4gICAgICAgICAqL1xuICAgICAgICBsaXN0ZW5LZXlDaGFuZ2U6IGZ1bmN0aW9uKGtleSwgY2FsbGJhY2spe1xuICAgICAgICAgICAgX2NoZWNrS2V5KGtleSk7XG4gICAgICAgICAgICBpZighX29ic2VydmVyc1trZXldKXtcbiAgICAgICAgICAgICAgICBfb2JzZXJ2ZXJzW2tleV0gPSBbXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIF9vYnNlcnZlcnNba2V5XS5wdXNoKGNhbGxiYWNrKTtcbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgICogUmVtb3ZlIGNoYW5nZSBsaXN0ZW5lcnNcbiAgICAgICAgICpcbiAgICAgICAgICogQHBhcmFtIHtTdHJpbmd9IGtleSBLZXkgbmFtZSB0byB1bnJlZ2lzdGVyIGxpc3RlbmVycyBhZ2FpbnN0XG4gICAgICAgICAqIEBwYXJhbSB7RnVuY3Rpb259IFtjYWxsYmFja10gSWYgc2V0LCB1bnJlZ2lzdGVyIHRoZSBjYWxsYmFjaywgaWYgbm90IC0gdW5yZWdpc3RlciBhbGxcbiAgICAgICAgICovXG4gICAgICAgIHN0b3BMaXN0ZW5pbmc6IGZ1bmN0aW9uKGtleSwgY2FsbGJhY2spe1xuICAgICAgICAgICAgX2NoZWNrS2V5KGtleSk7XG5cbiAgICAgICAgICAgIGlmKCFfb2JzZXJ2ZXJzW2tleV0pe1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYoIWNhbGxiYWNrKXtcbiAgICAgICAgICAgICAgICBkZWxldGUgX29ic2VydmVyc1trZXldO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgZm9yKHZhciBpID0gX29ic2VydmVyc1trZXldLmxlbmd0aCAtIDE7IGk+PTA7IGktLSl7XG4gICAgICAgICAgICAgICAgaWYoX29ic2VydmVyc1trZXldW2ldID09IGNhbGxiYWNrKXtcbiAgICAgICAgICAgICAgICAgICAgX29ic2VydmVyc1trZXldLnNwbGljZShpLDEpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgICogU3Vic2NyaWJlIHRvIGEgUHVibGlzaC9TdWJzY3JpYmUgZXZlbnQgc3RyZWFtXG4gICAgICAgICAqXG4gICAgICAgICAqIEBwYXJhbSB7U3RyaW5nfSBjaGFubmVsIENoYW5uZWwgbmFtZVxuICAgICAgICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBjYWxsYmFjayBGdW5jdGlvbiB0byBydW4gd2hlbiB0aGUgc29tZXRoaW5nIGlzIHB1Ymxpc2hlZCB0byB0aGUgY2hhbm5lbFxuICAgICAgICAgKi9cbiAgICAgICAgc3Vic2NyaWJlOiBmdW5jdGlvbihjaGFubmVsLCBjYWxsYmFjayl7XG4gICAgICAgICAgICBjaGFubmVsID0gKGNoYW5uZWwgfHwgXCJcIikudG9TdHJpbmcoKTtcbiAgICAgICAgICAgIGlmKCFjaGFubmVsKXtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiQ2hhbm5lbCBub3QgZGVmaW5lZFwiKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmKCFfcHVic3ViX29ic2VydmVyc1tjaGFubmVsXSl7XG4gICAgICAgICAgICAgICAgX3B1YnN1Yl9vYnNlcnZlcnNbY2hhbm5lbF0gPSBbXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIF9wdWJzdWJfb2JzZXJ2ZXJzW2NoYW5uZWxdLnB1c2goY2FsbGJhY2spO1xuICAgICAgICB9LFxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBQdWJsaXNoIGRhdGEgdG8gYW4gZXZlbnQgc3RyZWFtXG4gICAgICAgICAqXG4gICAgICAgICAqIEBwYXJhbSB7U3RyaW5nfSBjaGFubmVsIENoYW5uZWwgbmFtZVxuICAgICAgICAgKiBAcGFyYW0ge01peGVkfSBwYXlsb2FkIFBheWxvYWQgdG8gZGVsaXZlclxuICAgICAgICAgKi9cbiAgICAgICAgcHVibGlzaDogZnVuY3Rpb24oY2hhbm5lbCwgcGF5bG9hZCl7XG4gICAgICAgICAgICBjaGFubmVsID0gKGNoYW5uZWwgfHwgXCJcIikudG9TdHJpbmcoKTtcbiAgICAgICAgICAgIGlmKCFjaGFubmVsKXtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiQ2hhbm5lbCBub3QgZGVmaW5lZFwiKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgX3B1Ymxpc2goY2hhbm5lbCwgcGF5bG9hZCk7XG4gICAgICAgIH0sXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIFJlbG9hZHMgdGhlIGRhdGEgZnJvbSBicm93c2VyIHN0b3JhZ2VcbiAgICAgICAgICovXG4gICAgICAgIHJlSW5pdDogZnVuY3Rpb24oKXtcbiAgICAgICAgICAgIF9yZWxvYWREYXRhKCk7XG4gICAgICAgIH0sXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIFJlbW92ZXMgcmVmZXJlbmNlIGZyb20gZ2xvYmFsIG9iamVjdHMgYW5kIHNhdmVzIGl0IGFzIGpTdG9yYWdlXG4gICAgICAgICAqXG4gICAgICAgICAqIEBwYXJhbSB7Qm9vbGVhbn0gb3B0aW9uIGlmIG5lZWRlZCB0byBzYXZlIG9iamVjdCBhcyBzaW1wbGUgXCJqU3RvcmFnZVwiIGluIHdpbmRvd3MgY29udGV4dFxuICAgICAgICAgKi9cbiAgICAgICAgIG5vQ29uZmxpY3Q6IGZ1bmN0aW9uKCBzYXZlSW5HbG9iYWwgKSB7XG4gICAgICAgICAgICBkZWxldGUgd2luZG93LiQualN0b3JhZ2VcblxuICAgICAgICAgICAgaWYgKCBzYXZlSW5HbG9iYWwgKSB7XG4gICAgICAgICAgICAgICAgd2luZG93LmpTdG9yYWdlID0gdGhpcztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgICAgICB9XG4gICAgfTtcblxuICAgIC8vIEluaXRpYWxpemUgalN0b3JhZ2VcbiAgICBfaW5pdCgpO1xuXG59KSgpO1xuIiwiLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vXG4vL1xuLy8gQXhvbiBCcmlkZ2UgQVBJIEZyYW1ld29ya1xuLy9cbi8vIEF1dGhvcmVkIGJ5OiAgIEF4b24gSW50ZXJhY3RpdmVcbi8vXG4vLyBMYXN0IE1vZGlmaWVkOiBKdW5lIDQsIDIwMTRcbi8vXG4vLyBEZXBlbmRlbmNpZXM6ICBjcnlwdG8tanMgKGh0dHBzOi8vZ2l0aHViLmNvbS9ldmFudm9zYmVyZy9jcnlwdG8tanMpXG4vLyAgICAgICAgICAgICAgICBqUXVlcnkgMS4xMS4xIChodHRwOi8vanF1ZXJ5LmNvbS8pXG4vLyAgICAgICAgICAgICAgICBqc29uMyAoaHR0cHM6Ly9naXRodWIuY29tL2Jlc3RpZWpzL2pzb24zKVxuLy8gICAgICAgICAgICAgICAgalN0b3JhZ2UgKGh0dHBzOi8vZ2l0aHViLmNvbS9hbmRyaXM5L2pTdG9yYWdlKVxuLy9cbi8vICoqKiBIaXN0b3J5ICoqKlxuLy9cbi8vIFZlcnNpb24gICAgRGF0ZSAgICAgICAgICAgICAgICAgIE5vdGVzXG4vLyA9PT09PT09PT0gID09PT09PT09PT09PT09PT09PT09ICA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyAwLjEgICAgICAgIEp1bmUgNCwgMjAxNCAgICAgICAgICBGaXJzdCBzdGFibGUgdmVyc2lvbi4gXG4vL1xuLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vXG5cbi8vIFJlcXVpcmUgdGhlIHJvb3QgQXhvbkJyaWRnZSBtb2R1bGVcbi8vdmFyIEJyaWRnZUNsaWVudCA9IHJlcXVpcmUoICcuL0JyaWRnZUNsaWVudCcgKTtcblxudmFyIGJyaWRnZSA9IHJlcXVpcmUoICcuL0JyaWRnZScgKTtcbm1vZHVsZS5leHBvcnRzID0gbmV3IGJyaWRnZSgpO1xuIl19
(10)
});
