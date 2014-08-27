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
var url       = require( 'url' );

var config = server.config;
var app    = server.app;

function deleteFile( pathToPDF, timesCalled ) {

    if ( _.isUndefined( timesCalled ) ) {
        timesCalled = 0;
    }

    if ( !_.isNumber( timesCalled ) ) {
        timesCalled = 0;
    }

    fs.exists( pathToPDF )
        .then( function( exists ) {
            if ( exists ) {
                fs.remove( pathToPDF )
                    .then( function( err ) {
                        app.log.debug( "Successfully deleted file: " + pathToPDF );
                    } )
                    .fail( function( err ) {
                        app.log.warn( "Could not delete file: " + pathToPDF );
                        timesCalled += 1;
                        setTimeout( deleteFile, 10000, pathToPDF, timesCalled );
                        throw err;
                    });
            }
        } )
        .fail( function( err ) {
            app.log.debug( 'fs exists failed: ', err );
            return;
        });
}

// Normal module behaviour here if wkhtmltopdf is found
function wkHTMLToPDFFound() {
    app.log.info( "wkhtmltopdf found on your system. module is now available" );

    // Normalize the path locations to remove abnormalities
    config.pdfGenerator.templatePath = path.normalize( config.pdfGenerator.templatePath );
    config.pdfGenerator.cachePath    = path.normalize( config.pdfGenerator.cachePath );

    var dir = path.resolve( config.pdfGenerator.templatePath );

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

    dir = path.resolve( config.pdfGenerator.cachePath );

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

    module.exports = function( ejsTemplate, variables, folder, fileName ) {
        return Q.Promise( function( resolve, reject ) {

            var extentsion = path.extname( fileName );

            if ( extentsion !== '.pdf' ) {
                fileName = fileName.append( ".pdf" );
            }

            var invalidCharacterRegex = /(\/|\\|:|\*|\?|"|<|>|\|)/;

            var invalid = invalidCharacterRegex.exec( fileName );

            if ( invalid ) {
                reject( "Filename contains invalid characters" );
                return;
            }

            var folderPath = path.join( config.server.wwwRoot, config.pdfGenerator.cachePath, folder );

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
                    var ejsPath = path.join( config.pdfGenerator.templatePath, ejsTemplate );

                    ejsPath = path.resolve( ejsPath );

                    return fs.read( ejsPath );
                } )
                .then( function( text ) {
                    var html = ejs.render( text, variables );

                    htmlToPdf( html, { output: pathToPDF }, function( code, signal ) {

                        setTimeout( deleteFile, config.pdfGenerator.cacheLifetimeMinutes * 60 * 1000, pathToPDF );

                        var pdfURL = url.format( {
                            protocol: config.server.mode,
                            host: config.server.hostname,
                            pathName: config.pdfGenerator.cachePath
                        } );

                        var urlPathToFile = path.join( config.pdfGenerator.cachePath, folder, path.basename( pathToPDF ) );

                        pdfURL = url.resolve( pdfURL, urlPathToFile );

                        pdfURL = pdfURL.replace( /\\+/g, '/');

                        resolve( pdfURL );

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
