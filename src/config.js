'use strict';

var jsonminify  = require( 'jsonminify' );
var fs          = require( 'fs' );
var winston     = require( 'winston' );
var _           = require( 'lodash' );
var revalidator = require( 'revalidator');
var path        = require( 'path' );
var moment      = require( 'moment' );

function postMergeDefaults( configObj ) {
    if (_.isUndefined( configObj.security.tokenExpiryDurationRememberMe ) ) {
        configObj.security.tokenExpiryDurationRememberMe = { 'weeks': 2 };
    }
}

var defaults = {
    server: {
        supportEmail: 'theteam@axoninteractive.ca',
        mode: 'http',
        environment: 'production',
        port: 3000,
        emailVerification: false,
        wwwRoot: 'client/',
        apiRoute: '/api',
        indexPath: 'index.html',
        httpRedirect: false
    },

    security: {
        tokenSecret: '!$Th3_X<OSgS0T^{RA4BVRZV$E&aA5NAugzO1)tV<8*LP}sAaHxd9#1eIeg69k>!lUVIf*UB6Ne8SGXzgCFdK%]pSIvfF*xSW0jaIix<45-Hr)$l}beFskzm',
        sshKeys: {
            privateKeyfilepath: 'key.pem',
            certificatefilepath: 'cert.pem',
            ca: []
        }
    },

    database: {
        user    : 'root',
        password: '',
        host    : 'localhost',
        database: 'peir',
        connectionLimit: 10
    },

    logger: {
        server: {
            filename: 'logs/server.log',
            level: 'verbose',
            consoleLevel: 'info'
        },

        exception: {
            filename: 'logs/exceptions.log',
            writetoconsole: true
        }
    },

    accounts: {
        recoveryStateDuration: { days: 1 }
    },

    mailer: {

        fromAddress: '',

        templateDirectory: 'templates/',

        verificationEmail: {
            subject: 'Bridge Example Email Verification',
            viewName: 'registration.ejs'
        },

        recoverAccountEmail: {
            subject: 'Bridge Example Account Recovery',
            viewName: 'recoverPassword.ejs'
        },

        updatedUserInfoEmail: {
            subject: 'Your account information has been updated',
            viewName: 'updatedUserInformation.ejs'
        },

        welcomeEmail: {
            subject: 'Welcome to the site',
            viewName: 'welcome.ejs'
        },

        updatedUserPasswordEmail: {
            subject: 'Your Password has been updated',
            viewName: 'updatedUserPassword.ejs'
        },

        // The options for the mailer to use
        // See node mailer SMTP transport documentation for examples
        // https://github.com/andris9/nodemailer-smtp-transport#usage
        options: {
            service: 'gmail',
            auth: {             // The authentication to use for the GMail Service
                user: 'BridgeSMTPTest@gmail.com',
                pass: 'passwordGoesHere'
            }
        }
    },

    pdfGenerator: {
        templatePath: 'templates/pdfs',
        cacheLifetimeMinutes: 10,
        outputPath: "resources/pdfs/generated/"
    },

    excelGenerator: {
        templatePath: 'templates/xlsx',
        cacheLifetimeMinutes: 10,
        outputPath: 'resources/xlsx/generated/'
    }
};

var emailInfoSchema = {
    type: 'object',
    required: true,
    properties: {
        subject: {
            type: 'string',
            required: true,
            allowEmpty: false
        },

        viewName: {
            type: 'string',
            required: true,
            allowEmpty: false
        }
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

                supportEmail: {
                    type: 'string',
                    required: true,
                    format: 'email'
                },

                mode: {
                    type: 'string',
                    required: true,
                    enum: [ 'http', 'https' ],
                    messages: {
                        enum: 'Server mode must be http or https'
                    }
                },

                environment: {
                    type: 'string',
                    required: true,
                    enum: [ 'development', 'production' ],
                    messages: {
                        enum: 'Server environment must be \'development\' or \'production\''
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

                protectedResources: {
                    type: 'array',
                    required: false,
                    items: {
                        type: 'object',
                        required: true,
                        properties: {

                            path: {
                                type: 'string',
                                required: true,
                                allowEmpty: false
                            },

                            roles: {
                                type: ['array'],
                                required: true,
                                allowEmpty: false,
                                items: {
                                    type: 'string',
                                    required: true,
                                    enum: [ 'user', 'admin' ]
                                }
                            }

                        }
                    }
                },

                apiRoute: {
                    type: 'string',
                    required: true,
                    allowEmpty: false
                },

                indexPath: {
                    type: 'string',
                    required: true,
                    allowEmpty: false
                },

                httpRedirect: {
                    type: 'boolean',
                    required: true
                }
            }
        },

        security: {
            type: 'object',
            required: true,
            properties: {

                tokenSecret: {
                    type: 'string',
                    required: true,
                    allowEmpty: false
                },

                tokenExpiryDurationRememberMe: {
                    type: 'object',
                    required: true
                },

                sshKeys: {
                    type: 'object',
                    required: true,
                    properties: {
                        privateKeyfilepath: {
                            type:'string',
                            required: true,
                            allowEmpty: false
                        },

                        certificatefilepath: {
                            type: 'string',
                            required: true,
                            allowEmpty: false
                        },
                        ca: {
                            type: 'array',
                            required: false,
                            allowEmpty: true
                        }
                    }
                },
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
                },

                connectionLimit: {
                    type: 'integer',
                    required: false
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
                                enum: 'Server logger level must by one of the following levels: silly, debug, verbose, info, warn, error'
                            }
                        },

                        consoleLevel: {
                            type: 'string',
                            required: true,
                            enum: [ 'silly', 'debug', 'verbose', 'info', 'warn', 'error' ],
                            messages: {
                                enum: 'Server console logger level must by one of the following levels: silly, debug, verbose, info, warn, error'
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

        accounts: {
            recoveryStateDuration: {
                type: 'object',
                required: true,
                allowEmpty: false
            }
        },

        mailer: {
            type: 'object',
            required: true,
            properties: {

                fromAddress: {
                    type: 'string',
                    required: true,
                    allowEmpty: false
                },

                templateDirectory: {
                    type: 'string',
                    required: true,
                    allowEmpty: false
                },

                verificationEmail: emailInfoSchema,

                recoverAccountEmail: emailInfoSchema,

                updatedUserInfoEmail: emailInfoSchema,

                welcomeEmail: emailInfoSchema,

                updatedUserPasswordEmail: emailInfoSchema,

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

            cacheLifetimeMinutes: {
                type: 'number',
                required: true,
                allowEmpty: false
            },

            outputPath: {
              type: 'string',
              required: true,
              allowEmpty: false
            }
        },

        excelGenerator: {
            type: 'object',
            required: false,
            properties: {

                templatePath: {
                    type: 'string',
                    required: true,
                    allowEmpty: false
                },

                cacheLifetimeMinutes: {
                    type: 'number',
                    required: true,
                    allowEmpty: false
                },

                outputPath: {
                    type: 'string',
                    required: false,
                    allowEmpty: false
                }
            }
        }

    }
};

var config;

winston.verbose( 'Verifying that BridgeConfig.json exists' );
winston.debug( path.resolve( 'BridgeConfig.json' ) );


var configPath = path.dirname( require.main.filename );
configPath = path.join( configPath, 'BridgeConfig.json' );

// Check if a user config can be loaded
if ( fs.existsSync( configPath ) ) {

    winston.verbose( 'BridgeConfig.json found. Reading file....' );

    // Read and parse the Config file to make a User Configuration Object
    var userConfigString = fs.readFileSync( configPath, 'utf8' );

    var userConfig;

    try {
        userConfig = JSON.parse( JSON.minify( userConfigString ) );
    }
    catch (err) {
        winston.error( 'Could not parse BridgeConfig.json as JSON. ', err );
    }

    winston.verbose( 'Bridge config successfully read and parsed as JSON' );

    // Use the complete user configuration object to make a complete configuration object
    config = _.merge( defaults, userConfig );

    // Apply any defaults that can't be merged nicely with _.merge().
    // Note: Token expiry ends up adding/unioning durations rather than overrriding with _.merge().
    postMergeDefaults( config );

    if ( config.server.protectedResources ) {
        _( config.server.protectedResources ).forEach( function ( element ) {
            if ( _.isString( element.roles ) ) {
                element.roles = [ element.roles ];
            }
        } );
    }

}
// If no user config can be loaded make a default one
else {



    config = _.cloneDeep( defaults );
    config.isDefault = true;

    // Apply any defaults that can't be merged nicely with _.merge().
    // Note: Token expiry ends up adding/unioning durations rather than overrriding with _.merge().
    postMergeDefaults( config );

    winston.warn('File Location: ', configPath );
    winston.warn('Configuration file not found. Using defaults. This may have undesired effects. Please make "BridgeConfig.json"');

}

var validation = revalidator.validate( config, schema );

if ( validation.valid === false ) {
    winston.error( 'Configuration file is not valid and could not be loaded. Errors: ', JSON.stringify( validation.errors ) );
} else {

    config.accounts.recoveryStateDuration = moment.duration( config.accounts.recoveryStateDuration ).asMilliseconds();

    // If protected folders exists then iterate the set and normalize each path.
    if ( _.has( config.server, 'protectedResources' ) ) {
        _( config.server.protectedResources ).forEach( function( element, index ) {
            config.server.protectedResources[ index ].path = element.path.replace( '\\', '/' );
        } );
    }

    winston.info( 'Configuration file loaded successfully' );
}

// Export the object
module.exports = config;
