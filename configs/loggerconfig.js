"use strict";
module.exports = {
    "logger": {
        "api": {
            filename: "logs/api.log",
            level: "debug",
            consoleLevel: "warn"
        },
        "exception": {
            filename: "logs/exceptions.log"
        },
        "server": {
            filename: "logs/server.log",
            level: "debug",
            consoleLevel: "warn"
        },
        "console": {
            level: "info"
        }
    }
};