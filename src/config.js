"use strict";

var resourceful = require( 'resourceful' );
resourceful.use('memory');

var jsonminify = require( 'jsonminify' );
var fs         = require( 'fs'         );
var winston    = require( 'winston'    );

var SecureServerConfig = resourceful.define( 'secureServerConfig', function () {

    this.string( 'keyfilepath', {
        required: true,
        allowEmpty: false,
        default: "./key.pem"
    } );
    this.string( 'certificatefilepath', {
        required: true,
        allowEmpty: false,
        default: "./cert.pem"
    } );
} );

var errors = [];

var ServerConfig = resourceful.define( 'serverConfig', function () {
    this.string( 'mode', {
        enum: [ "http", "https" ],
        required: true,
        allowEmpty: false,
        default: "http"
    } );

    this.string( 'environment', {
        enum: ["development","production"],
        required: true,
        allowEmpty: false,
        default: "production"
    });

    this.number( 'port', {
        minimum: 0,
        maximum: 65535,
        required: true,
        divisibleBy: 1,
        default: 3000
    } );

    this.object( 'secure', {
        required: true,
        default: new SecureServerConfig(),
        conform: function(val) {
            if (val.resource === "SecureServerConfig")
            {
                var validation = val.validate(val, SecureServerConfig);
                if(validation.errors.length !== 0) errors.push(validation.errors);
                return validation.valid;
            }
            return false;
        }
    } );

    this.bool( 'emailVerification', {
        required: true,
        default: true
    } );

    this.string( 'wwwRoot', {
        required: true,
        default: 'client/'
    } );

    this.string( 'indexPath', {
        required: true,
        default: 'index.html'
    } );
} );

var DatabaseConfig = resourceful.define( 'databaseConfig', function () {
    this.string( 'user', {
        required: true,
        allowEmpty: false,
        default: "root"
    } );

    this.string( 'password', {
        required: true,
        allowEmpty: true,
        default: ""
    } );

    this.string( 'host', {
        required: true,
        allowEmpty: false,
        default: "localhost"
    } );

    this.string( 'database', {
        required: true,
        allowEmpty: false,
        default: "bridge"
    } );
} );

var ExceptionLoggerConfig = resourceful.define('exceptionLoggerConfig', function() {
    this.string( 'filename', {
        required: true,
        allowEmpty: false,
        default: "logs/exceptions.log"
    } );

    this.bool( 'writetoconsole', {
        required: true,
        default: false,
    } );
} );

var ServerLoggerConfig    = resourceful.define('serverLoggerConfig', function() {
    this.string('filename', {
        required: true,
        default: "logs/server.log",
        allowEmpty: false
    });

    this.string('level', {
        required: true,
        default: 'info',
        allowEmpty: false,
        enum: ['silly', 'debug', 'verbose', 'info', 'warn', 'error']
    });

    this.string('consoleLevel', {
        required: true,
        default: 'warn',
        allowEmpty: false,
        enum: ['silly', 'debug', 'verbose', 'info', 'warn', 'error']
    } );
} );

var LoggerConfig = resourceful.define('loggerConfig', function() {
    this.object('exception', {
        required: true,
        default: new ExceptionLoggerConfig(),
        conform: function(val){
            if (val.resource === "ExceptionLoggerConfig")
            {
                var validation = val.validate(val, ExceptionLoggerConfig);
                if(validation.errors.length !== 0) errors.push(validation.errors);
                return validation.valid;
            }
            return false;
        }
    });

    this.object('server', {
        required: true,
        default: new ServerLoggerConfig(),
        conform: function(val) {
            if (val.resource === "ServerLoggerConfig")
            {
                var validation = val.validate(val, ServerLoggerConfig);
                if(validation.errors.length !== 0) errors.push(validation.errors);
                return validation.valid;
            }
            return false;
        }
    });
} );

var OptionsMailerConfig = resourceful.define('optionsMailerConfig', function() {
    this.string('from', {
        required: true,
        allowEmpty: false,
        format: 'email',
        default: "theteam@axoninteractive.ca"
    });

    this.string('transportMethod', {
        required: true,
        allowEmpty: false,
        default: 'direct'
    });
} );

var MailerConfig = resourceful.define('mailerConfig', function() {
    this.object('options', {
        required: true,
        default: new OptionsMailerConfig(),
        conform: function(val) {
            if (val.resource === "OptionsMailerConfig")
            {
                var validation = val.validate(val, OptionsMailerConfig);
                if(validation.errors.length !== 0) errors.push(validation.errors);
                return validation.valid;
            }
            return false;
        }
    });
} );

var Config = resourceful.define('config', function(){

    this.object('server', {
        required: true,
        default: new ServerConfig(),
        conform: function(val) {
            if (val.resource === "ServerConfig")
            {
                var validation = val.validate(val, ServerConfig);
                if(validation.errors.length !== 0) errors.push(validation.errors);
                return validation.valid;
            }
            return false;
        }
    });

    this.object('database', {
        required: true,
        default: new DatabaseConfig(),
        conform: function(val) {
            if (val.resource === "DatabaseConfig")
            {
                var validation = val.validate(val, DatabaseConfig);
                if(validation.errors.length !== 0) errors.push(validation.errors);
                return validation.valid;
            }
            return false;
        }
    });

    this.object('logger', {
        required: true,
        default: new LoggerConfig(),
        conform: function(val) {
            if (val.resource === "LoggerConfig")
            {
                var validation = val.validate(val, LoggerConfig);
                if(validation.errors.length !== 0) errors.push(validation.errors);
                return validation.valid;
            }
            return false;
        }
    });

    this.object('mailer', {
        required: true,
        default: new MailerConfig(),
        conform: function(val) {
            if (val.resource === "MailerConfig")
            {
                var validation = val.validate(val, MailerConfig);
                if(validation.errors.length !== 0) errors.push(validation.errors);
                return validation.valid;
            }
            return false;
        }
    });
} );

var config;

// Check if a user config can be loaded 
if ( fs.existsSync( 'BridgeConfig.json' ) ) {

    // Read and parse the Config file to make a User Configuration Object
    var userConfigString = fs.readFileSync( 'BridgeConfig.json', 'utf8' );
    var userConfig = JSON.parse( JSON.minify( userConfigString ) );

    // Fill in the gaps that the user configuration file might have.
    if ( _.has( userConfig, 'server' ) ) {
        if ( _.has( userConfig.server, 'secure' ) ) {
            userConfig.server.secure = new SecureServerConfig( userConfig.server.secure );
        }
        userConfig.server = new ServerConfig( userConfig.server );
    }

    if ( _.has( userConfig, 'database' ) ) {
        userConfig.database = new DatabaseConfig( userConfig.database );
    }

    if ( _.has( userConfig, 'logger' ) ) {
        if ( _.has( userConfig.logger, 'exception' ) ) {
            userConfig.logger.exception = new ExceptionLoggerConfig( userConfig.logger.exception );
        }
        if ( _.has( userConfig.logger, 'server' ) ) {
            userConfig.logger.server = new ServerLoggerConfig( userConfig.logger.server );
        }
        userConfig.logger = new LoggerConfig( userConfig.logger );
    }

    if ( _.has( userConfig, 'mailer' ) ) {
        if ( _.has( userConfig.mailer, 'options' ) ) {
            userConfig.mailer.options = new OptionsMailerConfig( userConfig.mailer.options );
        }
        userConfig.mailer = new MailerConfig( userConfig.mailer );
    }

    // Use the complete user configuration object to make a complete configuration object
    config = new Config( userConfig );

}
// If no user config can be loaded make a default one
else {
    config = new Config();
    winston.warn('Configuration file not found. Using defaults. This may have undesired effects. Please make "BridgeConfig.json"');
}

var validation = config.validate( config, Config );

if (validation.valid === false)
{
    winston.error('Configuration file is not valid and could not be loaded. Errors: ', _.flatten(errors), ", Other Errors: ", JSON.stringify(validation.errors));
}
else
{
    winston.info('Configuration file loaded successfully');
}

// Export the object
module.exports = config;



//////////////////////////////////////////
