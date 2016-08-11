const moment = require('moment');

module.exports = (logLevel) => {
  const Util = {
    log: (type, message, level = 1) => {
      const theTime = moment();
      if (!type) {
        console // eslint-disable-line no-console
          .log(`## ${theTime} ## error: Util.log was called with no arguments or falsy first argument`);
      }

      if (logLevel < level) {
        return;
      }

      if (!message) {
        console.log(`## ${theTime} ## log: ${type}`); // eslint-disable-line no-console
        return;
      }

      console.log(`## ${theTime} ## ${type}: ${message}`); // eslint-disable-line no-console
    }
  };

  return Util;
};
