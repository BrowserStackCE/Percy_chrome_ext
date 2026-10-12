process.env.GLOBAL_AGENT_HTTP_PROXY="http://127.0.0.1:50922";
                    process.env.GLOBAL_AGENT_NO_PROXY="localhost,127.0.0.1,::1";
                   let bootstrap;
                   try {
                    bootstrap = require("global-agent").bootstrap;
                  }catch{
                    // This is a failsafe if global-agent present inside sdk node_modules
                    try {
                      bootstrap = require("./node_modules/browserstack-node-sdk/node_modules/global-agent").bootstrap;
                    } catch {
                      bootstrap = require("/Users/jostanmathias/Desktop/Development/Percy_chrome_ext/tests/node_modules/global-agent/dist/index.js").bootstrap;
                    }
                  };
                  bootstrap();

    const modifyPWConfig = require("/Users/jostanmathias/Desktop/Development/Percy_chrome_ext/tests/node_modules/browserstack-node-sdk/src/index.js")._modifyPlaywright;

    module.exports = modifyPWConfig();
