"use strict";

var fs        = require( 'fs' );
var htmlToPdf = require( 'wkhtmltopdf' );
var path      = require( 'path' );
var mkdirp    = require( 'mkdirp' );
var server    = require( '../server' );
var Q         = require( 'q' );
var _         = require( 'lodash')._;
var ejs       = require( 'ejs' );


var config = server.config;
var app    = server.app;

config.server.pdfPath = path.normalize( config.server.pdfPath );

var dir = config.server.pdfPath;

app.log.info( dir );

if ( !fs.existsSync( config.server.pdfPath ) ) {
    app.log.warn("PDF directory '" + dir +"' doesn't exist. Attempting to make directory" );
    mkdirp( dir, function( err ) {
        if ( err ) {
            app.log.error( "Error making directory '" + dir + "', Reason: " + err );
            return;
        }

        app.log.info( "Log directory created successfully" );
    } );
} else {
    app.log.info( "PDF directory found." );
}

app.log.debug( "PDF Path: " + path.resolve( dir ) );

function deleteFile( pathToPDF, timesCalled ) {

    if ( _.isUndefined( timesCalled ) ) {
        timesCalled = 0;
    }

    if ( !_.isNumber( timesCalled ) ) {
        timesCalled = 0;
    }

    fs.exists( pathToPDF, function ( exists ) {
        if ( exists ) {
            fs.unlink( pathToPDF, function ( err ) {
                if ( err ) {
                    app.log.warn( "Could not delete file: " + pathToPDF );
                    timesCalled += 1;
                    setTimeout( deleteFile, 10000, pathToPDF, timesCalled );
                    return;
                }
            } );

            app.log.debug( "Successfully deleted file: " + pathToPDF );
        }
    } );

}


module.exports = function( ejsTemplate, variables, fileName ) {
    return Q.Promise( function( resolve, reject ) {

        var pathToPDF = _.clone( config.server.pdfPath );

        pathToPDF = path.join( pathToPDF, fileName );

        var html = ejs.render( ejsTemplate, variables );

        htmlToPdf( html, { output: pathToPDF } );

        setTimeout( deleteFile , config.server.pdfLifetimeMinutes * 60 * 1000, pathToPDF );

        resolve( pathToPDF );

    } );
};

