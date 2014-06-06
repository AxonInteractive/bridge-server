"use strict";

module.exports = function(){

    var actions = [];

    var req           = null, 
        res           = null,
        currentAction = 0,
        isExecuting   = false,
        stopExecuting = false;

    var next = function(){
        if (stopExecuting)
            return;

        currentAction++;
        if (currentAction < actions.length)
            actions[currentAction](req, res, next, error);
        else 
            done(res);
    };

    var error = function(err){
        stopExecuting = true;
        
        done(undefined, err);
    };

    var done = null;

    return {

        pipe: function(func){
            if (typeof func !== 'function')
                return;

            actions.push(func);
            return this;
        },

        execute: function(request, complete){
            if (isExecuting === true)
                return;

            isExecuting = true;
            req = request;
            res = {};
            res.content = {};
            done = complete;
            stopExecuting = false;
            
            actions[currentAction](req, res, next, error);
            
        }
    };
};

