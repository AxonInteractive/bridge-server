// Run this once the window is ready
window.onload = function () {

  'use strict';


  // =================
  // MOVE ALONG PLEASE
  // =================

  // Just a help that shows up later.
  function timestamp ( message ) {
    return '<p>' + new Date().toLocaleTimeString() + ': ' + message + '</p>';
  }


  // ================
  // PROMISE HANDLERS
  // ================

  var loginSuccessHandler = function ( data, jqXHR ) {
    $( '#notify' ).prepend( timestamp( '<strong>requestLogin() successful!</strong>' ) );
    $( '#notify' ).prepend( timestamp( 'Bridge.user: ' + JSON.stringify( Bridge.user ) ) );
    $( '#notify' ).prepend( timestamp( 'Bridge.isLoggedIn() result: ' + Bridge.isLoggedIn() ) );
    $( '#notify' ).prepend( timestamp( 'HTML5 stored identity:' +
      JSON.stringify( jQuery.jStorage.get( 'bridge-client-identity', 'Not found!' ) ) ) );
  };

  var loginFailHandler = function ( error, jqXHR ) {
    if ( error.status === 0 ) {
      $( '#notify' ).prepend( timestamp( '<strong>requestLogin() timed out!</strong>' ) );
      $( '#notify' ).prepend( timestamp( 'Check your internet connection...' ) );
    }
    else {
      $( '#notify' ).prepend( timestamp( '<strong>requestLogin() error!</strong>  ' + JSON.stringify( error ) ) );
      $( '#notify' ).prepend( timestamp( 'Login request failed...' ) );
    }
  };

  var registerSuccessHandler = function ( data, jqXHR ) {
    $( '#notify' ).prepend( timestamp( '<strong>requestRegister() successful!</strong>' ) );
    // You could perform an immediate login after regsitration completes right here!
  };

  var registerFailHandler = function ( error, jqXHR ) {
    if ( error.status === 0 ) {
      $( '#notify' ).prepend( timestamp( '<strong>requestRegister() timed out!</strong>' ) );
      $( '#notify' ).prepend( timestamp( 'Check your internet connection...' ) );
    }
    else {
      $( '#notify' ).prepend( timestamp( '<strong>requestRegister() error!</strong>  ' + JSON.stringify( error ) ) );
      $( '#notify' ).prepend( timestamp( 'Registration request failed...' ) );
    }
  };


  // ===============
  // EVENT CALLBACKS
  // ===============

  // You can listen for the changePassword function being called:
  Bridge.onChangePasswordCalled = function () {
    $( '#notify' ).prepend( timestamp( '<strong>requestChangePassword() called!</strong>' ) );
    $( '#notify' ).prepend( timestamp( 'Waiting for a response from the server...' ) );
  };

  // You can listen for the forgotPassword function being called:
  Bridge.onForgotPasswordCalled = function ( email ) {
    $( '#notify' ).prepend( timestamp( '<strong>requestForgotPassword() called!</strong>' ) );
    $( '#notify' ).prepend( timestamp( 'Waiting for a response from the server...' ) );
  };

  // You can listen for the login function being called:
  Bridge.onLoginCalled = function () {
    $( '#notify' ).prepend( timestamp( '<strong>requestLogin() called!</strong>' ) );
    $( '#notify' ).prepend( timestamp( 'Waiting for a response from the server...' ) );
  };

  // You can listen for the logout() function being called:
  Bridge.onLogoutCalled = function ( data ) {
    $( '#notify' ).prepend( timestamp( '<strong>logout() called!</strong>' ) );
    $( '#notify' ).prepend( timestamp( 'Bridge.user: ' + JSON.stringify( Bridge.user ) ) );
    $( '#notify' ).prepend( timestamp( 'Bridge.additionalData: ' + JSON.stringify( Bridge.additionalData ) ) );
    $( '#notify' ).prepend( timestamp( 'Bridge.isLoggedIn() result: ' + Bridge.isLoggedIn() ) );
    $( '#notify' ).prepend( timestamp( 'HTML5 stored identity:' +
      JSON.stringify( jQuery.jStorage.get( 'bridge-client-identity', 'Not found!' ) ) ) );
  };

  // You can listen for the recover password function being called:
  Bridge.onRecoverPasswordCalled = function () {
    $( '#notify' ).prepend( timestamp( '<strong>requestRecoverPassword() called!</strong>' ) );
    $( '#notify' ).prepend( timestamp( 'Waiting for a response from the server...' ) );
  };

  // You can listen for the register function being called:
  Bridge.onRegisterCalled = function () {
    $( '#notify' ).prepend( timestamp( '<strong>requestRegister() called!</strong>' ) );
    $( '#notify' ).prepend( timestamp( 'Waiting for a response from the server...' ) );
  };

  // You can listen for each request:
  Bridge.onRequestCalled = function ( method, resource, payload ) {
    jQuery( '#notify' ).prepend( timestamp( 'Request >> ' + method + ' resource ' + resource +
      ' = ' + JSON.stringify( payload ) ) );
  };

  // You can listen for the verify email function being called:
  Bridge.onVerifyEmailCalled = function () {
    $( '#notify' ).prepend( timestamp( '<strong>requestVerifyEmail() called!</strong>' ) );
    $( '#notify' ).prepend( timestamp( 'Waiting for a response from the server...' ) );
  };


  // =====
  // USAGE
  // =====


  // Hook up the registration process to a button:
  $( '#register' ).click( function ( evt ) {

    // Read in the input fields
    var email = $( '#email' ).val();
    var password = $( '#password' ).val();
    var firstName = $( '#first-name' ).val();
    var lastName = $( '#last-name' ).val();
    var appData = JSON.parse( $( '#app-data' ).val() );

    // Send a register request using Bridge.
    Bridge.register( 'https://localhost:3000/api/', email, password, firstName, lastName, appData )
      .then( registerSuccessHandler )
      .fail( registerFailHandler );

  } );

  // Hook up the email verification to a button:
  $( '#verify-email' ).click( function ( evt ) {

    // Read in the input fields
    var hash = $( '#hash' ).val();

    // Send a verify email request using Bridge.
    Bridge.verifyEmail( "/api", hash )
      .then( function ( data, jqXHR ) {

        $( '#notify' ).prepend( timestamp( '<strong>Email account verified successfully!</strong>' ) );

      } )
      .fail( function ( data, jqXHR ) {

        $( '#notify' ).prepend( timestamp( '<strong>Verification failed...</strong>' ) );

      } );

  } );

  // Hook up the the login process to a button:
  $( '#login' ).click( function ( evt ) {

    // Read in the input fields
    var email = $( '#email2' ).val();
    var password = $( '#password2' ).val();
    var rememberMe = $( '#use-local-storage' ).prop( 'checked' );

    // Send a login request using Bridge.
    Bridge.login( 'https://localhost:3000/api', email, password, rememberMe )
      .then( loginSuccessHandler )
      .fail( loginFailHandler );

  } );

  // Hook up the password change process to a button:
  $( '#change-password' ).click( function ( evt ) {

    // Read in the input fields
    var oldPassword = $( '#old-password' ).val();
    var newPassword = $( '#new-password' ).val();

    // Send a change password request using Bridge.
    Bridge.saveUser( '/api', oldPassword, newPassword )
      .then( function ( data, jqXHR ) {

        $( '#notify' ).prepend( timestamp( '<strong>Password changed successfully!</strong>' ) );

      } )
      .fail( function ( data, jqXHR ) {

        $( '#notify' ).prepend( timestamp( '<strong>Password change failed...</strong>' ) );

      } );

  } );

  // Hook up the forgot password process to a button:
  $( '#forgot-password' ).click( function ( evt ) {

    // Read in the input fields
    var email = $( '#email5' ).val();

    // Send a recover password request using Bridge.
    Bridge.forgotPassword( 'https://localhost:3000/api/', email )
      .then( function ( data, jqXHR ) {

        $( '#notify' ).prepend( timestamp( '<strong>Password recovery email sent successfully!</strong>' ) );

      } )
      .fail( function ( data, jqXHR ) {

        $( '#notify' ).prepend( timestamp( '<strong>Password recovery email failed to send...</strong>' ) );

      } );

  } );

  // Hook up the recover email process to a button:
  $( '#recover-password' ).click( function ( evt ) {

    // Read in the input fields
    var email = $( '#email4' ).val();
    var newPassword = $( '#new-password2' ).val();
    var hash = $( '#hash2' ).val();

    // Send a recover password request using Bridge.
    Bridge.recoverPassword( 'https://localhost:3000/api/', email, newPassword, hash )
      .then( function ( data, jqXHR ) {

        $( '#notify' ).prepend( timestamp( '<strong>Password recovered successfully!</strong>' ) );

      } )
      .fail( function ( data, jqXHR ) {

        $( '#notify' ).prepend( timestamp( '<strong>Password recovery failed...</strong>' ) );

      } );

  } );

  // Hook up the logout process to a button:
  $( '#logout' ).click( function ( evt ) {

    // Call Bridge.logout() to clear the user from Bridge.
    Bridge.logout( "/api/" );

  } );

  // Hook up a button to clear HTML5 local storage:
  $( '#clear-local-storage' ).click( function ( evt ) {

    // Delete the HTML5 local storage key Bridge uses to store a user
    $.jStorage.deleteKey( 'bridge-client-identity' );

  } );

};
