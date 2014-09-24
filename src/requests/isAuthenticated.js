"use strict";

module.exports = function( req, res, next ) {
    res.status( 200 );
    res.send( { content: "You are authenticated" } );
    next();
};
