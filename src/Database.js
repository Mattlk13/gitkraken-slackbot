const _ = require('lodash');

module.exports = (controller, bot, SLACKUP_CHANNEL_ID) => {
  const Database = {
    getAllUserMessages: () =>
      controller.storage.channels.getAsync(SLACKUP_CHANNEL_ID)
        .then((channelRecord) => {
          const today = (new Date()).getDate();

          const {
            userInfo = {},
            userMessages = {}
          } = channelRecord;
          userMessages[today] = userMessages[today] || {};

          const usersWithInfoAndMessage = _(userMessages[today])
            .keys().filter((user) => !!userInfo[user]).value(); // eslint-disable-line newline-per-chained-call

          return _.reduce(userMessages[today], (result, text, user) => { // eslint-disable-line arrow-body-style
            return _.includes(usersWithInfoAndMessage, user) ?
              `${result}${result ? '\n' : ''} • ${userInfo[user].name}: ${text}` : result;
          }, '');
        }),

    getSlackupMessage: () =>
      Database.getAllUserMessages()
        .then((messages) => `Here's the slackup messages I got today: \n${messages}`),

    saveUserMessage: (user, text) => {
      const today = (new Date()).getDate();

      return controller.storage.channels.getAsync(SLACKUP_CHANNEL_ID)
        .then((channelRecord) => {
          const {
            userMessages: previousMessages = {}
          } = channelRecord;
          previousMessages[today] = previousMessages[today] || {};

          // Delete messages from previous days
          const userMessages = _.pick(previousMessages, today);

          userMessages[today][user] = text;

          return Database.updateChannelRecord({ userMessages });
        })
        .then(({ userMessages }) => userMessages);
    },

    updateChannelRecord: (newData) =>
      controller.storage.channels.getAsync(SLACKUP_CHANNEL_ID)
        .then((record) => {
          _.merge(record, newData);
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
