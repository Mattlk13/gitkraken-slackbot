const Promise = require('bluebird');
const _ = require('lodash');
const moment = require('moment');

module.exports = (controller, bot, SLACKUP_CHANNEL_ID) => {
  const Database = {
    getTodaysUserMessages: () =>
      controller.storage.channels.getAsync(SLACKUP_CHANNEL_ID)
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
        }),

    getUserReminders: () =>
      controller.storage.channels.getAsync(SLACKUP_CHANNEL_ID)
        .then(({ userReminders }) => (userReminders || {})),

    getSlackupMessage: () =>
      Database.getTodaysUserMessages()
        .then((messages) => {
          const messageList = _.reduce(messages, (result, { username, text }) =>
              `${result}${result ? '\n' : ''} • ${username}: ${text}`
          , '');

          return `Here's the slackup messages I got today: \n${messageList}`;
        }),

    saveUserReminder: (user, timeString) =>
      Promise.resolve()
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
        ),

    saveUserMessage: (user, text) => {
      const today = moment().date();

      return controller.storage.channels.getAsync(SLACKUP_CHANNEL_ID)
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
    updateChannelRecord: (newData) =>
      controller.storage.channels.getAsync(SLACKUP_CHANNEL_ID)
        .then((record) => {
          _.mergeWith(record, newData, (objValue, srcValue) => {
            if (srcValue === undefined) {
              // source values should not be undefined, but if that happens then
              // map them to null to properly "un-set" the key
              return null;
            }
            return undefined; // otherwise default to _.merge behavior
          });
          return controller.storage.channels.saveAsync(record)
            .then(() => record);
        }),

  /**
   * @param {Boolean} skipKnownMembers An optimization to not hammer the api with user info requests.
   *                                   User info is unlikely to change over time, so we can skip it a lot and only cause
   *                                   teeny tiny UX bugs by not detecting user info changes after the bot is loaded.
   *                                   This is an internal tool so teeny tiny bugs aren't a big deal.
   */
    updateChannelMembers: (skipKnownMembers) =>
      bot.api.channels.infoAsync({ channel: SLACKUP_CHANNEL_ID })
        .then((channelInfo) => {
          if (skipKnownMembers) {
            return controller.storage.channels.getAsync(SLACKUP_CHANNEL_ID)
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
        .then(({ userInfo }) => userInfo)
  };

  return Database;
};
