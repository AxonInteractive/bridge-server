"use strict";

var nodeFs    = require( 'fs' );
var fs        = require( 'q-io/fs' );
var htmlToPdf = require( 'wkhtmltopdf' );
var path      = require( 'path' );
var mkdirp    = require( 'mkdirp' );
var server    = require( '../server' );
var Q         = require( 'q' );
var _         = require( 'lodash')._;
var ejs       = require( 'ejs' );
var uri       = require( 'uri-js' );
var utilities = require( './utilities' );

var config = server.config;
var app    = server.app;

// Normal module behaviour here if wkhtmltopdf is found
function wkHTMLToPDFFound() {
    app.log.info( "wkhtmltopdf found on your system. module is now available" );

    // Normalize the path locations to remove abnormalities
    config.pdfGenerator.templatePath = path.normalize( config.pdfGenerator.templatePath );
    config.pdfGenerator.outputPath   = path.normalize( config.pdfGenerator.outputPath );
    var dir;

    if ( config.pdfGenerator.templatePath[ 0 ] === '/' ) {
        dir = path.resolve( config.pdfGenerator.templatePath );
    } else {
        dir = path.resolve( path.join( path.dirname( require.main.filename ), config.pdfGenerator.templatePath ) );
    }

    app.log.verbose( "Verifying that PDF template directory exists..." );
    app.log.debug( dir );

    if ( !nodeFs.existsSync( dir ) ) {
        app.log.warn("PDF template directory '" + dir +"' doesn't exist. Attempting to make directory" );
        mkdirp( dir, function( err ) {
            if ( err ) {
                app.log.error( "Error making directory '" + dir + "', Reason: " + err );
                return;
            }

            app.log.info( "PDF template directory created successfully" );
        } );
    } else {
        app.log.verbose( "PDF template directory found." );
    }

    if ( config.pdfGenerator.outputPath[ 0 ] === '/' ) {
        dir = path.resolve( config.pdfGenerator.outputPath );
    } else {
        dir = path.resolve( path.join( path.dirname( require.main.filename ), config.pdfGenerator.outputPath ) );
    }

    app.log.verbose( "Verifying that PDF cache directory exists..." );
    app.log.debug( dir );

    if ( !nodeFs.existsSync( dir ) ) {
        app.log.warn("PDF cache directory '" + dir +"' doesn't exist. Attempting to make directory" );
        mkdirp( dir, function( err ) {
            if ( err ) {
                app.log.error( "Error making directory '" + dir + "', Reason: " + err );
                return;
            }

            app.log.info( "PDF cache directory created successfully" );
        } );
    } else {
        app.log.verbose( "PDF cache directory found." );
    }

    module.exports = function( ejsTemplate, variables, folder, fileName, title ) {
        return Q.Promise( function( resolve, reject ) {

            var extentsion = path.extname( fileName );

            if ( extentsion !== '.pdf' ) {
                fileName = fileName.append( ".pdf" );
            }

            variables.siteURL = app.get( 'rootURL' );
            variables.title = title;

            var invalidCharacterRegex = /(\/|\\|:|\*|\?|"|<|>|\|)/;

            var invalid = invalidCharacterRegex.exec( fileName );

            if ( invalid ) {
                reject( "Filename contains invalid characters" );
                return;
            }

            var folderPath = path.join( config.server.wwwRoot, config.pdfGenerator.outputPath, folder );

            var outputPath = config.pdfGenerator.outputPath;

            if ( outputPath.substr( -1 ) !== '/' ) {
              outputPath = outputPath + '/';
            }

            var wwwPath = outputPath.split( path.sep ).join('/') + folder;

            if ( wwwPath.substr( -1 ) !== '/' ) {
              wwwPath = wwwPath + '/';
            }

            app.log.debug( folderPath );

            var pathToPDF = "";
            var pathToPDFWithoutExtentsion = "";

            var fileIterations = 0;

            var makeUniquePath = function( path ) {
                return Q.Promise( function( resolve, reject ) {
                    fs.exists( path )
                        .then( function( exists ) {
                            if ( exists ) {

                                fileIterations += 1;

                                pathToPDF = pathToPDFWithoutExtentsion + " (" + ( fileIterations ) + ").pdf";

                                makeUniquePath( pathToPDF )
                                .then( function( result ){
                                    resolve( result );
                                })
                                .fail( function( err ) {
                                    reject( err );
                                });
                                return;
                            }
                            resolve( true );
                        } )
                        .fail( function( err ) {
                            reject( err );
                        } );
                } );
            };

            fs.exists( folderPath )
                .then( function( exists ) {
                    if ( !exists ) {
                        mkdirp.sync( folderPath );
                    }

                    pathToPDF = path.join( folderPath, fileName );

                    pathToPDFWithoutExtentsion = pathToPDF.substring( 0, pathToPDF.length - 4 );
                } )
                .then( function() {
                    return makeUniquePath( pathToPDF );
                } )
                .then( function() {
                    return Q.Promise( function ( resolve, reject ) {
                        var cssPath = path.join( config.pdfGenerator.templatePath, 'style.css' );
                        fs.exists( cssPath )
                        .then( function ( exists ) {
                            if ( exists ) {
                                return fs.read( cssPath );
                            } else {
                                return false;
                            }
                        } )
                        .then( function ( data ) {
                            if ( data ) {
                                variables.css = data;
                            } else {
                                variables.css = "";
                            }
                            resolve();
                        } );
                    } );
                } )
                .then( function() {
                    var ejsPath = path.join( config.pdfGenerator.templatePath, ejsTemplate );

                    ejsPath = path.resolve( ejsPath );

                    return fs.read( ejsPath );
                } )
                .then( function( text ) {

                    app.log.debug( "EJS Render Variables: ", variables );
                    variables.filename = path.resolve( path.join( config.pdfGenerator.templatePath, ejsTemplate ) );
                    var html = ejs.render( text, variables );


                    htmlToPdf( html, { output: pathToPDF }, function( code, signal ) {

                        setTimeout( utilities.deleteFile, config.pdfGenerator.cacheLifetimeMinutes * 60 * 1000, pathToPDF );

                        var pdfPathParts = pathToPDF.split( path.sep );
                        wwwPath = wwwPath + pdfPathParts[ pdfPathParts.length -1 ];

                        var url = uri.parse( app.get( 'rootURL' ) );

                        url.path = wwwPath;

                        resolve( uri.serialize( url ) );

                    } );
                } )
                .fail( function(err) {
                    reject( err );
                } );
        } );
    };
}

// else the module returns an error if attempted to use.
function wkHTMLToPDFNotFound() {

    app.log.warn( "Could not find wkhtmltopdf on your systems PATH variable. ");

    module.exports = function() {
        return Q.Promise( function( resolve, reject ) {
            app.log.error("Cannot use htmltopdf feature without wkhtmltopdf installed on your system. please install it and make sure it is available on your systems PATH variable");
            reject( "wkhtmltopdf could not be found on your system. Please install it if you wish to use this feature." );
        } );
    };
}

// Make a variable to track if wkhtmltopdf has been found on the system
var found = false;

// The regex to use to check for wkhtmltopdf as the filename of a file in the PATH variable
var wkhtml2pdfRegex = /^wkhtmltopdf($|\.exe$)/;

// Get all the path locations on the current machine.
var pathLocations = process.env.PATH.split( path.delimiter );

// iterate though each path location
for ( var i = 0; i < pathLocations.length; i+=1 ) {

    // if wkhtmltopdf has been found break the loop.
    // no need to continue searching for it.
    if ( found ) {
        break;
    }

    try {
        // read each dir from the PATH variable and call findwkhtmltopdf on it to find wkhtmltopdf
        var files = nodeFs.readdirSync( path.normalize( pathLocations[ i ] ) );
    } catch ( err ) {
        continue;
    }

    // Check if there are no files
    if ( _.isUndefined( files ) ) {
        return;
    }

    // If the file has been found stop looking
    if ( found ) {
        return;
    }

    // Iterate through each file in the files array
    for ( var j = 0; j < files.length; j+=1 ) {

        // Check against the regex
        var result = wkhtml2pdfRegex.exec( files[ j ] );

        // continue the loop if the regex failed the check
        if ( _.isUndefined( result ) || _.isNull( result ) ) {
            continue;
        }

        // If regex passed set found to true
        found = true;

        // log that the file has been found
        app.log.verbose( "wkhtmltopdf FOUND!" );

        wkHTMLToPDFFound();

        // break the for loop. once wkhtmltopdf has been found.
        // don't need to search more files than necessary
        break;
    }
}
