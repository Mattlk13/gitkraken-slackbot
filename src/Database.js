const Promise = require('bluebird');
const _ = require('lodash');
const moment = require('moment');

const VERBOSE_LOGGING = 2;

module.exports = (controller, bot, SLACKUP_CHANNEL_ID, LOGGING_LEVEL = 1) => {
  const Util = require('./Util.js')(LOGGING_LEVEL); // eslint-disable-line global-require

  const Database = {
    getTodaysUserMessages: () => {
      Util.log('Database', 'getTodaysUserMessages called.', VERBOSE_LOGGING);
      controller.storage.channels.getAsync(SLACKUP_CHANNEL_ID)
        .catch(() => ({}))
        .then((channelRecord) => {
          const today = moment().date();
          const {
            userInfo = {},
            userMessages = {}
          } = channelRecord;
          userMessages[today] = userMessages[today] || {};

          return _(userMessages[today])
            .pickBy((message, user) => !!userInfo[user])
            .mapValues((message, user) => ({ username: userInfo[user].name, text: message }))
            .value();
        });
    },

    getUserReminders: () => {
      Util.log('Database', 'getUserReminders called.', VERBOSE_LOGGING);
      controller.storage.channels.getAsync(SLACKUP_CHANNEL_ID)
        .catch(() => ({}))
        .then(({ userReminders }) => (userReminders || {}));
    },

    getSlackupMessage: () => {
      Util.log('Database', 'getSlackupMessage called.', VERBOSE_LOGGING);
      return Database.getTodaysUserMessages()
        .then((messages) => {
          const messageList = _.reduce(messages, (result, { username, text }) =>
              `${result}${result ? '\n' : ''} • ${username}: ${text}`
          , '');

          return `Here's the slackup messages I got today: \n${messageList}`;
        });
    },

    saveUserReminder: (user, timeString) => {
      Util.log('Database', 'saveUserReminder called.', VERBOSE_LOGGING);
      return Promise.resolve()
        .then(() => {
          if (!timeString) {
            return null;
          }

          let [hours, minutes] = _.map(timeString.split(':'), (v) => parseInt(v, 10));
          if (_.isNaN(hours) || _.isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
            return Promise.reject('I couldn\'t figure out that time. Use 24-hour `HH:MM` format.');
          }
          if (hours >= 19) {
            return Promise.reject('I can\'t remind you that late - that\'s after the slackup time!');
          }

          hours = '' + hours; // eslint-disable-line prefer-template
          minutes = '' + minutes; // eslint-disable-line prefer-template
          while (hours.length < 2) {
            hours = `0${hours}`;
          }
          while (minutes.length < 2) {
            minutes = `0${minutes}`;
          }

          return moment(`2000-01-01 ${hours}:${minutes}`);
        })
        .then((parsedTime) =>
          Database.updateChannelRecord({
            userReminders: {
              [user]: {
                lastReminder: moment().toISOString(),
                timeOfDay: parsedTime && parsedTime.toISOString()
              }
            }
          })
          .then(() => parsedTime)
        );
    },

    saveUserMessage: (user, text) => {
      Util.log('Database', 'saveUserMessage called.', VERBOSE_LOGGING);
      const today = moment().date();

      return controller.storage.channels.getAsync(SLACKUP_CHANNEL_ID)
        .catch(() => ({}))
        .then((channelRecord) => {
          const {
            userMessages: previousMessages = {}
          } = channelRecord;
          previousMessages[today] = previousMessages[today] || {};

          // Delete messages from previous days
          const userMessages = _.mapValues(previousMessages, (v, k) => (parseInt(k, 10) === today ? v : null));

          userMessages[today][user] = text;

          return Database.updateChannelRecord({ userMessages });
        })
        .then(({ userMessages }) => userMessages);
    },

    /**
     * @param {Object} newData An object that will be merged with the existing slackup channel data.
     *                         Recursively, no defined properties in newData ought to resolve to `undefined`;
     *                         these will be treated as `null`, which is the "explicitly update to not a value" value.
     */
    updateChannelRecord: (newData) => {
      Util.log('Database', 'updateChannelRecord called.', VERBOSE_LOGGING);
      return controller.storage.channels.getAsync(SLACKUP_CHANNEL_ID)
        .catch(() => ({}))
        .then((record) => {
          Util.log('updateChannelRecord', `saving data: ${JSON.stringify(_.keys(newData))}`, VERBOSE_LOGGING);
          _.mergeWith(record, newData, (objValue, srcValue) => {
            if (srcValue === undefined) {
              // source values should not be undefined, but if that happens then
              // map them to null to properly "un-set" the key
              return null;
            }
            return undefined; // otherwise default to _.merge behavior
          });

          record.id = SLACKUP_CHANNEL_ID; // eslint-disable-line no-param-reassign

          return controller.storage.channels.saveAsync(record)
            .then(() => record);
        });
    },

  /**
   * @param {Boolean} skipKnownMembers An optimization to not hammer the api with user info requests.
   *                                   User info is unlikely to change over time, so we can skip it a lot and only cause
   *                                   teeny tiny UX bugs by not detecting user info changes after the bot is loaded.
   *                                   This is an internal tool so teeny tiny bugs aren't a big deal.
   */
    updateChannelMembers: (skipKnownMembers) => {
      Util.log('Database', `updateChannelMembers called, skipKnownMembers: ${skipKnownMembers}`, VERBOSE_LOGGING);
      return bot.api.channels.infoAsync({ channel: SLACKUP_CHANNEL_ID })
        .then((channelInfo) => {
          if (skipKnownMembers) {
            return controller.storage.channels.getAsync(SLACKUP_CHANNEL_ID)
              .catch(() => ({}))
              .then(({ userInfo }) =>
                _.filter(channelInfo.channel.members, (value, key) => !_.keys(userInfo).includes(key))
              );
          }

          return channelInfo.channel.members;
        })
        .then((members) => {
          const promises = _(members).map((user) =>
            bot.api.users.infoAsync({ user })
              .then((_info) => [user, _info.user])
          );
          return Promise.all(promises);
        })
        .then((pairs) => {
          const userInfo = _(pairs)
            .fromPairs()
            .omitBy(({ is_bot }) => is_bot) // eslint-disable-line camelcase
            .value();

          return Database.updateChannelRecord({ userInfo });
        })
        .then(({ userInfo }) => userInfo);
    }
  };

  return Database;
};
