"use strict";

var jsonminify  = require( 'jsonminify' );
var fs          = require( 'fs' );
var winston     = require( 'winston' );
var _           = require( 'lodash' )._;
var revalidator = require( 'revalidator');
var path        = require( 'path' );

var defaults = {
    server: {
        mode                   : "http",
        environment            : "production",
        port                   : 3000,
        emailVerification      : false,
        wwwRoot                : "client/",
        indexPath              : "index.html",
        secure: {
            keyfilepath: "key.pem",
            certificatefilepath: "cert.pem"
        }
    },

    database: {
        user    : 'root',
        password: '',
        host    : 'localhost',
        database: 'peir'
    },

    logger: {
        server: {
            filename: "logs/server.log",
            level: 'verbose',
            consoleLevel: 'info'
        },

        exception: {
            filename: 'logs/exceptions.log',
            writetoconsole: true
        }
    },

    mailer: {
        templateDirectory: "templates/email",
        verificationEmailSubject: "Bridge Example Email Verification",
        verifyEmailViewName: "registrationTemplate.ejs",
        recoveryEmailSubject: "Bridge Example Account Recovery",
        recoverPasswordViewName: "recoverPasswordTemplate.ejs",
        options: {
            from: "BridgeSMTPTest@gmail.com",
            host: "smtp.gmail.com",
            secureConnection: true,
            port:465,
            transportMethod: "SMTP",
            auth: {
                user: "BridgeSMTPTest@gmail.com",
                pass: "mS2JY78Ao5bI8df3teFUxUCXyKK1ASYV4GFBLR5P"
            }
        }
    },

    pdfGenerator: {
        templatePath: "templates/pdfs",
        cachePath: "pdfs/",
        cacheLifetimeMinutes: 10
    },

    excelGenerator: {
        cachePath: "xlsx/"
    }
};

var schema = {
    type: 'object',
    required: true,
    properties: {

        server: {
            type:'object',
            required: true,
            properties: {

                mode: {
                    type: 'string',
                    required: true,
                    enum: [ 'http', 'https' ],
                    messages: {
                        enum: "Server mode must be http or https"
                    }
                },

                environment: {
                    type: 'string',
                    required: true,
                    enum: [ 'development', 'production' ],
                    messages: {
                        enum: "Server environment must be 'development' or 'production'"
                    }
                },

                port: {
                    type: 'integer',
                    required: true,
                    minimum: 1,
                    maximum: 65535
                },

                emailVerification: {
                    type: 'boolean',
                    required: true
                },

                wwwRoot: {
                    type: 'string',
                    required: true,
                    allowEmpty: false
                },

                indexPath: {
                    type: 'string',
                    required: true,
                    allowEmpty: false
                },

                secure: {
                    type: 'object',
                    required: true,
                    properties: {
                        keyfilepath: {
                            type:'string',
                            required: true,
                            allowEmpty: false
                        },

                        certificatefilepath: {
                            type: 'string',
                            required: true,
                            allowEmpty: false
                        }
                    }
                }
            }
        },

        database: {
            type: 'object',
            required: false,
            properties: {
                user: {
                    type: 'string',
                    required: true,
                    allowEmpty: false
                },

                password: {
                    type: 'string',
                    required: true,
                    allowEmpty: true
                },

                host: {
                    type: 'string',
                    required: true,
                    allowEmpty: false
                },

                database: {
                    type: 'string',
                    required: true,
                    allowEmpty: false
                }
            }
        },

        logger: {
            type:'object',
            required: true,
            properties: {
                server: {
                    type: 'object',
                    required: true,
                    properties: {

                        filename: {
                            type: 'string',
                            required: true,
                            allowEmpty: false
                        },

                        level: {
                            type: 'string',
                            required: true,
                            enum: [ 'silly', 'debug', 'verbose', 'info', 'warn', 'error' ],
                            messages: {
                                enum: "Server logger level must by one of the following levels: silly, debug, verbose, info, warn, error"
                            }
                        },

                        consoleLevel: {
                            type: 'string',
                            required: true,
                            enum: [ 'silly', 'debug', 'verbose', 'info', 'warn', 'error' ],
                            messages: {
                                enum: "Server console logger level must by one of the following levels: silly, debug, verbose, info, warn, error"
                            }
                        }
                    }
                },

                exception: {
                    type: 'object',
                    required: true,
                    properties: {

                        filename: {
                            type: 'string',
                            required: true,
                            allowEmpty: false
                        },

                        writetoconsole: {
                            type: 'boolean',
                            required: true
                        }

                    }
                }
            }
        },

        mailer: {
            type: 'object',
            required: true,
            properties: {

                templateDirectory: {
                    type: 'string',
                    required: true,
                    allowEmpty: false
                },

                verificationEmailSubject: {
                    type: 'string',
                    required: true,
                    allowEmpty: false
                },

                verifyEmailViewName: {
                    type: 'string',
                    required: true,
                    allowEmpty: false
                },

                recoveryEmailSubject: {
                    type: 'string',
                    required: true,
                    allowEmpty: false
                },

                recoverPasswordViewName: {
                    type: 'string',
                    required: true,
                    allowEmpty: false
                },

                options: {
                    type: 'object',
                    required: true
                }
            }
        },

        pdfGenerator: {

            templatePath: {
                type: 'string',
                required: true,
                allowEmpty: false
            },

            cachePath: {
                type: 'string',
                required: true,
                allowEmpty: false
            },

            cacheLifetimeMinutes: {
                type: 'number',
                required: true,
                allowEmpty: false
            }
        }

    }
};

var config;

winston.verbose( "Verifying that BridgeConfig.json exists" );
winston.debug  ( path.resolve( 'BridgeConfig.json' ) );

// Check if a user config can be loaded
if ( fs.existsSync( 'BridgeConfig.json' ) ) {

    winston.verbose( "BridgeConfig.json found. Reading file...." );

    // Read and parse the Config file to make a User Configuration Object
    var userConfigString = fs.readFileSync( 'BridgeConfig.json', 'utf8' );

    var userConfig;

    try {
        userConfig = JSON.parse( JSON.minify( userConfigString ) );
    }
    catch (err) {
        winston.error( "Could not parse BridgeConfig.json as JSON. ", err );
    }

    winston.verbose( "Bridge config successfully read and parsed as JSON" );

    // Use the complete user configuration object to make a complete configuration object
    config = _.merge( defaults, userConfig );

}
// If no user config can be loaded make a default one
else {

    config = _.cloneDeep( defaults );
    config.isDefault = true;
    winston.warn('Configuration file not found. Using defaults. This may have undesired effects. Please make "BridgeConfig.json"');
}

var validation = revalidator.validate( config, schema );

if ( validation.valid === false ) {
    winston.error( 'Configuration file is not valid and could not be loaded. Errors: ', JSON.stringify( validation.errors ) );
} else {
    winston.info( 'Configuration file loaded successfully' );
}

// Export the object
module.exports = config;
