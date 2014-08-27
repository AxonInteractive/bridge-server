"use strict";

var _      = require( "lodash" )._;
var Q      = require( 'q' );
var xlsx   = require( 'xlsx' );
var path   = require( 'path' );
var bridge = require( '../server' );


var config = bridge.config;

function columnNumberToColumnName( columnNumber ) {

    // Check that the parameter is a number
    if ( !_.isNumber( columnNumber ) ) {
        throw "param is not a number";
    }

    // Check if the number is an integer
    if ( columnNumber % 1 !== 0 ) {
        throw "number is not a integer";
    }

    // Check for the limit against excel
    if ( columnNumber > 16383 ) {
        throw "number is too large";
    }

    columnNumber += 1;

    var dividend = columnNumber;
    var columnName = '';
    var modulo;

    while (dividend > 0)
    {
        modulo = (dividend - 1) % 26;
        columnName = String.fromCharCode(65 + modulo ) + columnName;
        dividend = Math.floor((dividend - modulo) / 26);
    }

    return ( columnName );
}

function convert2DArrayToSheet( array ) {
    return Q.Promise( function( resolve, reject ) {

        var excelObject = {};

        var largestColNumber = 0;

        if ( !_.isArray( array ) ) {
            reject( "argument is not an array" );
            return;
        }

        array.forEach( function( element, rowIndex ) {

            if ( !_.isArray( element ) ) {
                return true;
            }


            var rowNumber = rowIndex + 1;

            if (largestColNumber < element.length ) {
                largestColNumber = element.length;
            }

            element.forEach( function( element2, colIndex ) {

                var currentRowNumber = rowNumber;

                var columnLetter = columnNumberToColumnName( colIndex );

                var cellAddress = columnLetter + currentRowNumber;

                excelObject[ cellAddress ] = element2;

            } );
        } );

        var bottomRightCellAddress = columnNumberToColumnName( largestColNumber ) + array.length - 1;

        excelObject["!ref"] = "A1:" + bottomRightCellAddress;

        resolve( excelObject );
    } );
}

exports.Author = "Bridge Web Server";

/**
 * Covert arracy to an xlsx file using a specific sheet name and a
 * @param  {2DArray} array       A 2D array containing the information for the XLSX Table
 * @param  {String} fileName     The filename to use when writing the file to the FS
 * @param  {String} sheetName    The name of the sheet to put the Table on
 * @param  {Array} columnWidths  An array of objects containing either a wpx or wch properties
 * @return {Promise}             A Q style promise object
 */
module.exports = function( array, filePath, sheetName, columnWidths ) {
    return Q.Promise( function( resolve, reject ) {

        var workbook = {
            Props: {},
            Sheets: {},
        };

        workbook.Props.Author     = exports.Author;
        workbook.Props.LastAuthor = exports.Author;
        workbook.Props.SheetNames = [ sheetName ];
        workbook.SheetNames       = [ sheetName ];

        convert2DArrayToSheet( array )
        .then( function( sheet ) {

            sheet["!cols"] = columnWidths;

            workbook.Sheets[ sheetName ] = sheet;

            if ( path.extname( filePath ) !== '.xlsx' ) {
                filePath = filePath.concat( '.xlsx' );
            }

            var rootFilePath = path.join( config.excelGenerator.cachePath, filePath );

            xlsx.writeFile( workbook, rootFilePath );

            resolve( rootFilePath );

        } )
        .fail( function( err ) {

            reject( err );

        } );
    } );
};
